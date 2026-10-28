import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,rename,symlink,access,realpath,cp,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {fingerprint,sha,writeJSON,readJSON} from '../runner/files.mjs';
import {configureStorage,storageStatus,storageDefaults,storagePolicy,registerBuildStorage,registerToolStorage,maintainStorage,requireStorageCapacity,storageSize} from '../runner/worker-storage.mjs';
import {backupStorage,verifyStorageBackup,restoreStorageBackup} from '../runner/storage-backup.mjs';
const idle=async()=>true,processes=()=>[],room=async()=>({bsize:1,bavail:1e9,blocks:1e9});
async function workspace(t){const base=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-storage-')));t.after(()=>rm(base,{recursive:true,force:true}));const data=path.join(base,'worker');await mkdir(data);return {base,data};}
async function build(data,id){const folder=path.join(data,'builds','gh-'+id),app=path.join(folder,'unpacked/Wizard.app');await mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await writeFile(path.join(app,'Contents/MacOS/wizard'),Buffer.alloc(8192,id));const result={source:'github',app,packageHash:(await fingerprint(app,{packageTree:true})).sha256,archiveHash:String(id).repeat(64).slice(0,64)};await writeJSON(path.join(folder,'build.json'),result);await registerBuildStorage(data,result);return {folder,...result};}
function databases(data){const controller=new DatabaseSync(path.join(data,'controller.sqlite')),smoke=new DatabaseSync(path.join(data,'smoke.sqlite'));controller.exec('PRAGMA journal_mode=WAL; CREATE TABLE controller_schedule(id INTEGER PRIMARY KEY,record TEXT); CREATE TABLE jobs(record TEXT);');controller.prepare('INSERT INTO controller_schedule VALUES (1,?)').run(JSON.stringify({enabled:true,hour:3,timeZone:'America/Los_Angeles',nextDue:'2026-10-28T10:00:00Z',selection:{effectiveIds:Array.from({length:176},(_,i)=>String(i))}}));smoke.exec('PRAGMA journal_mode=WAL; CREATE TABLE executions(state TEXT,package_json TEXT); CREATE TABLE results(status TEXT,note TEXT);');smoke.prepare('INSERT INTO results VALUES (?,?)').run('Fail','Original immutable failure');return {controller,smoke};}

test('unused imported caches are reclaimed by budget; current, rollback, live and uncertain work remain protected',async t=>{
 const {data}=await workspace(t);await configureStorage(data,{...storageDefaults,cacheBytes:24000,minFreeBytes:0,reserveFraction:0});
 const old=await build(data,1);await mkdir(path.join(old.app,'Contents/MacOS/logs'));await writeFile(path.join(old.app,'Contents/MacOS/logs/run.log'),'preserve');const second=await build(data,2),current=await build(data,3);
 let result=await maintainStorage(data,{idle:async()=>false,filesystem:room,processes});assert.equal(result.state,'Busy');await access(old.folder);
 result=await maintainStorage(data,{idle,filesystem:room,processes});assert.deepEqual(result.removed.map(r=>r.name),['gh-1']);await assert.rejects(access(old.folder));await access(second.folder);await access(current.folder);const retained=(await readdir(path.join(data,'retained-cache-logs'))).find(n=>n.startsWith('build-gh-1-'));assert.equal(await readFile(path.join(data,'retained-cache-logs',retained,'run.log'),'utf8'),'preserve');assert.equal((await lstat(path.join(data,'retained-cache-logs'))).mode&0o777,0o700);
 assert.equal((await maintainStorage(data,{idle,filesystem:room,processes})).removed.length,0);
 const d=databases(data);d.controller.prepare('INSERT INTO jobs VALUES (?)').run(JSON.stringify({state:'Complete',outcome:'Unknown',imported:{app:second.app}}));d.controller.prepare('INSERT INTO jobs VALUES (?)').run(JSON.stringify({state:'Unknown',imported:{app:current.app}}));d.smoke.prepare('INSERT INTO executions VALUES (?,?)').run('Running',JSON.stringify({app:second.app}));d.controller.close();d.smoke.close();await build(data,4);await build(data,5);
 result=await maintainStorage(data,{idle,filesystem:room,processes});assert.equal(result.removed.length,0);await access(second.folder);await access(current.folder);await assert.rejects(requireStorageCapacity(data,{filesystem:room}),/Storage needs cleanup/);
});

test('changed packages, redirected cache roots and open files cannot become deletion targets',async t=>{
 const {data,base}=await workspace(t);await configureStorage(data,{...storageDefaults,cacheBytes:1,minFreeBytes:0,reserveFraction:0,keepBuilds:1});const old=await build(data,1);await build(data,2);
 let result=await maintainStorage(data,{idle,filesystem:room,processes:()=>[{pid:123,path:old.app}]});assert.equal(result.removed.length,0);await access(old.folder);
 await writeFile(path.join(old.app,'Contents/MacOS/wizard'),'modified for investigation');result=await maintainStorage(data,{idle,filesystem:room,processes});assert.ok(result.retained.some(r=>/content changed/.test(r.reason)));await access(old.folder);
 await rename(path.join(data,'builds'),path.join(base,'saved'));await symlink(path.join(base,'saved'),path.join(data,'builds'));await assert.rejects(maintainStorage(data,{idle,filesystem:room,processes}),/redirected/);await access(path.join(base,'saved/gh-1'));
});

test('registered interrupted retirement resumes once, without touching durable results or outside files',async t=>{
 const {data}=await workspace(t);await configureStorage(data,{...storageDefaults,cacheBytes:1,minFreeBytes:0,reserveFraction:0,keepBuilds:1});const old=await build(data,1);await build(data,2);const rows=await readJSON(path.join(data,'storage-control/caches.json')),row=rows.find(r=>r.name==='gh-1'),tombstone=path.join(data,'builds/.retired-gh-1');await rename(old.folder,tombstone);await writeJSON(path.join(data,'storage-control/retire-build-gh-1.json'),{...row,target:old.folder,tombstone,logsRetained:true});await writeFile(path.join(data,'run.log'),'diagnostics');
 const result=await maintainStorage(data,{idle,filesystem:room,processes});assert.ok(result.removed.some(r=>r.resumed));await assert.rejects(access(tombstone));assert.equal(await readFile(path.join(data,'run.log'),'utf8'),'diagnostics');assert.equal((await maintainStorage(data,{idle,filesystem:room,processes})).removed.length,0);
});

test('interrupted cache retirement rechecks changed content, rollback protection and retained logs',async t=>{
 for(const mode of ['changed','rollback','logs']){
  const {data}=await workspace(t);await configureStorage(data,{...storageDefaults,cacheBytes:1,minFreeBytes:0,reserveFraction:0,keepBuilds:1});const old=await build(data,1);await build(data,2);
  const row=(await readJSON(path.join(data,'storage-control/caches.json'))).find(r=>r.name==='gh-1'),tombstone=path.join(data,'builds/.retired-gh-1');await rename(old.folder,tombstone);await writeJSON(path.join(data,'storage-control/retire-build-gh-1.json'),{...row,target:old.folder,tombstone,logsRetained:true});
  const app=path.join(tombstone,path.relative(old.folder,old.app));
  if(mode==='changed')await writeFile(path.join(app,'Contents/MacOS/wizard'),'changed after interruption');
  if(mode==='rollback')await writeJSON(path.join(data,'storage-policy.json'),{...storageDefaults,cacheBytes:1,minFreeBytes:0,reserveFraction:0,keepBuilds:2});
  if(mode==='logs'){await mkdir(path.join(app,'Contents/MacOS/logs'));await writeFile(path.join(app,'Contents/MacOS/logs/recovery.log'),'late diagnostics');}
  const result=await maintainStorage(data,{idle,filesystem:room,processes});
  if(mode!=='logs'){await access(tombstone);assert.equal(result.removed.length,0,mode);assert.ok(result.retained.some(r=>mode==='changed'?/content changed/.test(r.reason):/rollback/.test(r.reason)),JSON.stringify(result));}
  else{assert.ok(result.removed.some(r=>r.resumed));const logs=(await readdir(path.join(data,'retained-cache-logs'))).find(n=>n.startsWith('build-gh-1-'));assert.equal(await readFile(path.join(data,'retained-cache-logs',logs,'recovery.log'),'utf8'),'late diagnostics');}
 }
});

test('volume reserve and scratch budget reject new work without mutating retained files, on either worker layout',async t=>{
 const {base,data}=await workspace(t);for(const root of [data,path.join(base,'dedicated-mini')]){await mkdir(root,{recursive:true});await configureStorage(root,{...storageDefaults,minFreeBytes:100,reserveFraction:0.15,scratchBytes:10});await mkdir(path.join(root,'runs'));await writeFile(path.join(root,'runs/project.wiz'),'retained project');const before=await sha(path.join(root,'runs/project.wiz'));const filesystem=async()=>({bsize:1,bavail:100,blocks:1000});const s=await storageStatus(root,{filesystem});assert.equal(s.reserveBytes,150);assert.equal(s.capacityReady,false);await assert.rejects(requireStorageCapacity(root,{filesystem}),/Storage needs cleanup/);assert.equal(await sha(path.join(root,'runs/project.wiz')),before);assert.equal((await storageSize(path.join(root,'runs'))).logicalBytes,16);}
 assert.throws(()=>storagePolicy({...storageDefaults,cacheBytes:-1}),/Invalid/);assert.throws(()=>storagePolicy({...storageDefaults,deleteEverything:true}),/Unknown/);
});

test('WAL databases and config restore privately with original results, 176 checks and 3AM cadence, but schedule disabled',async t=>{
 const {data,base}=await workspace(t),d=databases(data);await writeFile(path.join(data,'worker.json'),JSON.stringify({name:'Synthetic MBP',secret:'synthetic-not-a-real-key'}));const schedule=d.controller.prepare('SELECT record FROM controller_schedule').get().record;
 const dest=path.join(base,'backup');const result=await backupStorage(data,dest,{files:['worker.json'],idle});assert.equal(result.files,3);assert.equal((await lstat(dest)).mode&0o777,0o700);assert.equal((await lstat(path.join(dest,'worker.json'))).mode&0o777,0o600);await verifyStorageBackup(dest);
 assert.equal(d.controller.prepare('SELECT record FROM controller_schedule').get().record,schedule);d.controller.close();d.smoke.close();
 const restored=await restoreStorageBackup(dest,path.join(base,'mini-restored'));assert.equal(restored.scheduleDisabled,true);assert.equal(restored.servicesStarted,false);const c=new DatabaseSync(path.join(restored.path,'controller.sqlite'),{readOnly:true}),s=new DatabaseSync(path.join(restored.path,'smoke.sqlite'),{readOnly:true});const record=JSON.parse(c.prepare('SELECT record FROM controller_schedule').get().record);assert.equal(record.enabled,false);assert.equal(record.hour,3);assert.equal(record.timeZone,'America/Los_Angeles');assert.equal(record.selection.effectiveIds.length,176);assert.deepEqual(s.prepare('SELECT status,note FROM results').get(),Object.assign(Object.create(null),{status:'Fail',note:'Original immutable failure'}));c.close();s.close();await assert.rejects(restoreStorageBackup(dest,restored.path),/EEXIST/);
 await writeFile(path.join(dest,'worker.json'),'tampered');await assert.rejects(verifyStorageBackup(dest),/changed/);
});

test('busy/oversize backups preserve existing backups and release SQLite locks after failure',async t=>{
 const {base,data}=await workspace(t),d=databases(data);t.after(()=>{d.controller.close();d.smoke.close();});await assert.rejects(backupStorage(data,path.join(base,'busy'),{idle:async()=>false}),/idle/);await assert.rejects(backupStorage(data,path.join(base,'large'),{idle,maxBytes:1}),/byte budget/);await assert.rejects(access(path.join(base,'large')));d.smoke.exec("INSERT INTO results VALUES ('Pass','after rejected backup')");await backupStorage(data,path.join(base,'valid'),{idle});await verifyStorageBackup(path.join(base,'valid'));
});

test('idle cycles make verified bounded backups once per interval, without deleting unrelated content',async t=>{
 const {base,data}=await workspace(t),d=databases(data),backupDirectory=path.join(base,'backups');t.after(()=>{d.controller.close();d.smoke.close();});await configureStorage(data,{...storageDefaults,minFreeBytes:0,reserveFraction:0,backupDirectory,backupIntervalHours:24,backupKeep:2});
 const first=await maintainStorage(data,{idle,filesystem:room,processes});assert.equal(first.backup.state,'Created');await verifyStorageBackup(first.backup.path);const again=await maintainStorage(data,{idle,filesystem:room,processes});assert.equal(again.backup.state,'Current');assert.equal(again.backup.path,first.backup.path);
});

test('real worker HTTP maintenance and admission use the same policy without dispatching a test',async t=>{
 const {data}=await workspace(t);await configureStorage(data,{...storageDefaults,cacheBytes:1,keepBuilds:1,minFreeBytes:0,reserveFraction:0});const old=await build(data,1);await build(data,2);
 const {fork}=await import('node:child_process'),{once}=await import('node:events');const child=fork(new URL('../server.mjs',import.meta.url),[],{env:{...process.env,PORT:'0',SMOKE_DATA_DIR:data},stdio:['ignore','ignore','pipe','ipc']});let errors='';child.stderr.on('data',b=>{errors+=b.toString();});const closed=once(child,'exit');
 try{
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker did not listen: '+errors)),15000);child.once('message',m=>{clearTimeout(timer);resolve(m.url);});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
  const post=async(route,body={})=>{const r=await fetch(new URL(route,url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const initial=await (await fetch(new URL('/api/storage',url))).json();assert.equal(initial.enabled,true);
  const sweep=await post('/api/storage/maintain');assert.equal(sweep.status,200);assert.ok(sweep.body.removed.some(r=>r.name==='gh-1'),JSON.stringify(sweep.body));await assert.rejects(access(old.folder));
  for(const route of ['/api/plans','/api/preparations','/api/desktop/start','/api/runner/start','/api/builds/import']){
   const rejected=await post(route,{app:'/must-not-launch/Wizard.app',selection:{}});assert.equal(rejected.status,409,route);assert.match(rejected.body.error,/Storage needs cleanup/);
  }
  const worker=await(await fetch(new URL('/api/worker',url))).json();assert.equal(worker.active,null);assert.equal(worker.preparing,false);assert.equal(worker.ownedSessions.length,0);
 }finally{child.kill('SIGTERM');await closed;}
});

test('two workers sharing a backup volume keep separate identities and never rotate each other snapshots',async t=>{
 const {base,data}=await workspace(t),second=path.join(base,'mini'),backupDirectory=path.join(base,'shared-backups');await mkdir(second);const a=databases(data),b=databases(second);t.after(()=>{for(const d of [a,b]){d.controller.close();d.smoke.close();}});const p={...storageDefaults,minFreeBytes:0,reserveFraction:0,backupDirectory,backupKeep:2};await configureStorage(data,p);await configureStorage(second,p);const first=await maintainStorage(data,{idle,filesystem:room,processes}),other=await maintainStorage(second,{idle,filesystem:room,processes});assert.equal(first.backup.state,'Created');assert.equal(other.backup.state,'Created');const one=await verifyStorageBackup(first.backup.path),two=await verifyStorageBackup(other.backup.path);assert.notEqual(one.workerId,two.workerId);assert.equal((await maintainStorage(data,{idle,filesystem:room,processes})).backup.path,first.backup.path);await access(other.backup.path);
 const otherHash=await sha(path.join(other.backup.path,'manifest.json'));await writeFile(path.join(backupDirectory,'unrelated.txt'),'leave alone');
 const snapshots=[first.backup.path];for(let i=1;i<=2;i++){const out=path.join(backupDirectory,'snapshot-'+(Date.now()-i*100000000)+'-'+randomUUID());await cp(first.backup.path,out,{recursive:true});snapshots.push(out);}
 for(let i=0;i<snapshots.length;i++){const f=path.join(snapshots[i],'manifest.json'),{sha256,...content}=await readJSON(f);content.createdAt=new Date(Date.now()-(i+2)*86400000).toISOString();await writeJSON(f,{...content,sha256:(await import('../runner/files.mjs')).digest(content)});}
 const rotated=await maintainStorage(data,{idle,filesystem:room,processes});assert.equal(rotated.backup.state,'Created');const all=[];for(const name of await readdir(backupDirectory))if(name.startsWith('snapshot-'))all.push(await verifyStorageBackup(path.join(backupDirectory,name)));assert.equal(all.filter(r=>r.workerId===one.workerId).length,2);assert.equal(await sha(path.join(other.backup.path,'manifest.json')),otherHash);assert.equal(await readFile(path.join(backupDirectory,'unrelated.txt'),'utf8'),'leave alone');
});

test('verified attachment tools use the shared cache budget and keep current/rollback tools pinned',async t=>{
 const {data}=await workspace(t);await configureStorage(data,{...storageDefaults,cacheBytes:1,keepBuilds:2,minFreeBytes:0,reserveFraction:0});const tools=[];
 for(let i=1;i<=3;i++){const name=String(i).repeat(64),folder=path.join(data,'attachment-tools',name),directory=path.join(folder,'tools');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'libwizard_smoke.dylib'),Buffer.alloc(1024,i));const descriptor={kind:'selected-build-attachment',directory,sha256:(await fingerprint(directory)).sha256};await writeJSON(path.join(folder,'tools.json'),descriptor);await registerToolStorage(data,descriptor);tools.push({folder,descriptor});}
 const result=await maintainStorage(data,{idle,filesystem:room,processes});assert.equal(result.removed.length,1);await assert.rejects(access(tools[0].folder));await access(tools[1].folder);await access(tools[2].folder);await writeFile(path.join(tools[1].descriptor.directory,'libwizard_smoke.dylib'),'changed');await assert.rejects(registerToolStorage(data,tools[1].descriptor),/identity changed/);
});
