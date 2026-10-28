import path from 'node:path';
import {mkdir,writeFile,rename,rm,lstat,realpath,readdir,statfs,open,cp} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {dataDirectory,externalPath,inside,readJSON,sha,fingerprint} from './files.mjs';

import {backupStorage,verifyStorageBackup,storageWorkerId} from './storage-backup.mjs';
import {inspectProcesses} from '../desktop/disposable-app.mjs';

const format='athanor-storage/v1',policyFile='storage-policy.json';
export const storageDefaults={format,cacheBytes:40*1024**3,scratchBytes:60*1024**3,minFreeBytes:50*1024**3,reserveFraction:0.15,keepBuilds:2,backupDirectory:null,backupKeep:3,backupMaxBytes:2*1024**3,backupIntervalHours:24};
export function storagePolicy(input){
 if(!input||Object.keys(input).some(k=>!Object.hasOwn(storageDefaults,k)))throw Error('Unknown storage policy field.');
 const p={...storageDefaults,...input};
 if(p.format!==format||!['cacheBytes','scratchBytes','minFreeBytes','keepBuilds'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0)||p.keepBuilds<1||!['backupKeep','backupMaxBytes','backupIntervalHours'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=1)||p.backupKeep<2||p.backupDirectory!==null&&(typeof p.backupDirectory!=='string'||!path.isAbsolute(p.backupDirectory))||!Number.isFinite(p.reserveFraction)||p.reserveFraction<0||p.reserveFraction>0.5)throw Error('Invalid storage policy.');
 return p;
}
async function regular(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||await realpath(file)!==file)throw Error('Storage record was redirected: '+file);return s;}
async function directory(file){const s=await lstat(file);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(file)!==file)throw Error('Storage directory was redirected: '+file);return s;}
async function json(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await rm(tmp,{force:true});}}
export async function configureStorage(dataDir,input=storageDefaults){
 dataDir=dataDirectory(dataDir);await mkdir(dataDir,{recursive:true,mode:0o700});await directory(dataDir);const policy=storagePolicy(input);if(policy.backupDirectory){const out=externalPath(policy.backupDirectory);if(out===dataDir||inside(dataDir,out)||inside(out,dataDir))throw Error('Backup directory must be separate from worker data.');}
 await writeFile(path.join(dataDir,policyFile),JSON.stringify(policy,null,2)+'\n',{mode:0o600,flag:'wx'});return {policy,dataDir,enabled:true};
}
export async function readStoragePolicy(dataDir){
 const file=path.join(dataDirectory(dataDir),policyFile);try{await regular(file);return storagePolicy(await readJSON(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
// Count allocated blocks separately; shared APFS extents can still be counted more than once.
export async function storageSize(root){
 let logicalBytes=0,allocatedBytes=0,files=0;const inodes=new Set();
 async function walk(file){const s=await lstat(file);if(s.isSymbolicLink())return;if(!s.isDirectory()&&!s.isFile())throw Error('Unsupported storage entry: '+file);const key=s.dev+':'+s.ino;if(inodes.has(key))return;inodes.add(key);allocatedBytes+=s.blocks*512;if(s.isDirectory()){for(const n of await readdir(file))await walk(path.join(file,n));}else{logicalBytes+=s.size;files++;}}
 try{await directory(root);await walk(root);}catch(e){if(e.code!=='ENOENT')throw e;}
 return {logicalBytes,allocatedBytes,files};
}
const control=dataDir=>path.join(dataDir,'storage-control');
async function registry(dataDir){const f=path.join(control(dataDir),'caches.json');try{await regular(f);const r=await readJSON(f);if(!Array.isArray(r)||new Set(r.map(cacheKey)).size!==r.length||r.some(v=>!Number.isSafeInteger(v.dev)||!Number.isSafeInteger(v.ino)||!Number.isSafeInteger(v.lastUsed)||!/^[a-f0-9]{64}$/.test(v.metadataHash||'')))throw Error('Invalid build storage registry.');return r;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function locked(dataDir,fn){
 const root=control(dataDir);await mkdir(root,{recursive:true,mode:0o700});await directory(root);const lock=path.join(root,'maintenance.lock');let fd;
 try{try{fd=await open(lock,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const st=await regular(lock),owner=await readJSON(lock);if(!Number.isInteger(owner.pid)||owner.pid<2)throw Error('Invalid storage lock; inspect it.');try{process.kill(owner.pid,0);throw Error('Storage maintenance is already active.');}catch(error){if(error.code!=='ESRCH')throw error;}const current=await regular(lock);if(current.dev!==st.dev||current.ino!==st.ino)throw Error('Storage lock changed.');await rm(lock);fd=await open(lock,'wx',0o600);}await fd.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return await fn();}
 finally{if(fd){await fd.close();await rm(lock);}}
}
const cacheKey=r=>(r.kind||'build')+'/'+r.name;
const cacheRoot=(dataDir,kind)=>path.join(dataDir,kind==='tool'?'attachment-tools':'builds');
function cachePath(dataDir,name,kind='build'){if(!['build','tool'].includes(kind)||typeof name!=='string'||!(/^(gh-[0-9]+|[a-f0-9]{64})$/).test(name)||kind==='tool'&&!/^[a-f0-9]{64}$/.test(name))throw Error('Only verified package/tool caches can be managed.');return path.join(cacheRoot(dataDir,kind),name);}
export async function registerBuildStorage(dataDir,build){
 dataDir=dataDirectory(dataDir);if(!await readStoragePolicy(dataDir)||build.source==='local')return;
 // ZIP layouts may nest the app. Locate the direct owned builds child, never an arbitrary app path.
 const canonicalApp=await realpath(build.app),relative=path.relative(path.join(dataDir,'builds'),canonicalApp),name=relative.split(path.sep)[0],target=cachePath(dataDir,name);
 if(!inside(target,canonicalApp)||!build.packageHash||!build.archiveHash)throw Error('Cached package registration differs.');
 return locked(dataDir,async()=>{
  await directory(path.join(dataDir,'builds'));const st=await directory(target),metadata=path.join(target,'build.json');await regular(metadata);
  const stored=await readJSON(metadata);if(stored.app!==build.app||stored.packageHash!==build.packageHash||stored.archiveHash!==build.archiveHash)throw Error('Cached build identity changed.');
  const rows=await registry(dataDir),row={kind:'build',name,dev:st.dev,ino:st.ino,metadataHash:await sha(metadata),lastUsed:Math.max(Date.now(),...rows.map(r=>r.lastUsed+1))};
  await json(path.join(control(dataDir),'caches.json'),[...rows.filter(r=>cacheKey(r)!=='build/'+name),row]);return row;
 });
}

export async function registerToolStorage(dataDir,tools){
 dataDir=dataDirectory(dataDir);if(!await readStoragePolicy(dataDir))return;
 const directoryPath=await realpath(tools.directory),target=path.dirname(directoryPath),name=path.basename(target);if(target!==cachePath(dataDir,name,'tool')||directoryPath!==path.join(target,'tools'))throw Error('Attachment tool cache is outside its managed root.');
 return locked(dataDir,async()=>{
  await directory(cacheRoot(dataDir,'tool'));const st=await directory(target),metadata=path.join(target,'tools.json');await regular(metadata);const stored=await readJSON(metadata);
  if(stored.directory!==tools.directory||stored.sha256!==tools.sha256||(await fingerprint(directoryPath)).sha256!==tools.sha256)throw Error('Attachment tool identity changed.');
  const rows=await registry(dataDir),row={kind:'tool',name,dev:st.dev,ino:st.ino,metadataHash:await sha(metadata),lastUsed:Math.max(Date.now(),...rows.map(r=>r.lastUsed+1))};await json(path.join(control(dataDir),'caches.json'),[...rows.filter(r=>cacheKey(r)!=='tool/'+name),row]);return row;
 });
}
function pathReferences(value,root){if(typeof value==='string'){if(!path.isAbsolute(value))return false;let resolved=value;try{resolved=externalPath(value);}catch{}return resolved===root||inside(root,resolved);}if(Array.isArray(value))return value.some(v=>pathReferences(v,root));return value&&typeof value==='object'&&Object.values(value).some(v=>pathReferences(v,root));}
async function retainedPins(dataDir){
 const records=[];const prepared=path.join(dataDir,'prepared.json');try{await regular(prepared);records.push(await readJSON(prepared));}catch(e){if(e.code!=='ENOENT')throw e;}
 const smoke=path.join(dataDir,'smoke.sqlite');try{await regular(smoke);const db=new DatabaseSync(smoke,{readOnly:true});try{for(const row of db.prepare('SELECT state,package_json FROM executions').all())if(!['Passed','Failed','Blocked','Cancelled'].includes(row.state))records.push(JSON.parse(row.package_json));}finally{db.close();}}catch(e){if(e.code!=='ENOENT')throw e;}
 const file=path.join(dataDir,'controller.sqlite');try{await regular(file);const db=new DatabaseSync(file,{readOnly:true});try{for(const {record} of db.prepare('SELECT record FROM jobs').all()){const job=JSON.parse(record);if(!['Complete','Blocked','Cancelled'].includes(job.state)||job.outcome==='Unknown')records.push(job);}}finally{db.close();}}catch(e){if(e.code!=='ENOENT')throw e;}
 return records;
}
export async function storageStatus(dataDir,{filesystem=statfs}={}){
 dataDir=dataDirectory(dataDir);const policy=await readStoragePolicy(dataDir);if(!policy)return {enabled:false};
 const total=async roots=>{const sizes=await Promise.all(roots.map(r=>storageSize(path.join(dataDir,r))));return {roots,logicalBytes:sizes.reduce((n,s)=>n+s.logicalBytes,0),allocatedBytes:sizes.reduce((n,s)=>n+s.allocatedBytes,0),files:sizes.reduce((n,s)=>n+s.files,0)};};
 const [cache,scratch,fs]=await Promise.all([total(['builds','attachment-tools','native','seeded-templates','fixtures']),total(['runs','desktop-runs','desktop-jobs','functional-runs','preparations']),filesystem(dataDir)]);
 const freeBytes=Number(fs.bavail)*Number(fs.bsize),totalBytes=Number(fs.blocks)*Number(fs.bsize),reserveBytes=Math.max(policy.minFreeBytes,Math.ceil(totalBytes*policy.reserveFraction));
 return {enabled:true,policy,cache,scratch,freeBytes,totalBytes,reserveBytes,capacityReady:freeBytes>=reserveBytes,scratchWithinBudget:scratch.logicalBytes<=policy.scratchBytes,cacheWithinBudget:cache.logicalBytes<=policy.cacheBytes,allocationNote:'Allocated blocks are advisory; APFS shared extents may be counted repeatedly. Free volume bytes govern admission.'};
}
async function retainCacheLogs(dataDir,row,logs){
 try{await directory(logs);}catch(e){if(e.code==='ENOENT')return;throw e;}
 const hash=(await fingerprint(logs)).sha256,root=path.join(dataDir,'retained-cache-logs');await mkdir(root,{recursive:true,mode:0o700});await directory(root);
 const target=path.join(root,(row.kind||'build')+'-'+row.name+'-'+hash);
 try{await directory(target);if((await fingerprint(target)).sha256!==hash)throw Error('Retained logs changed');return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const temporary=target+'.copy-'+randomUUID();try{await cp(logs,temporary,{recursive:true,verbatimSymlinks:true});if((await fingerprint(temporary)).sha256!==hash||(await fingerprint(logs)).sha256!==hash)throw Error('App logs changed during retention');await rename(temporary,target);}finally{await rm(temporary,{recursive:true,force:true});}
}
async function verifiedCacheApp(dataDir,row,root,metadata){
 const original=cachePath(dataDir,row.name,row.kind),selected=row.kind==='tool'?metadata.directory:metadata.app;
 if(typeof selected!=='string'||!path.isAbsolute(selected)||!inside(original,selected))throw Error('Cached package path changed');
 const app=path.join(root,path.relative(original,selected));await directory(app);
 if((await fingerprint(app,{packageTree:row.kind!=='tool'})).sha256!==(row.kind==='tool'?metadata.sha256:metadata.packageHash))throw Error('Cached package content changed');
 return app;
}
export async function maintainStorage(dataDir,{idle=async()=>false,filesystem=statfs,processes=inspectProcesses}={}){
 dataDir=dataDirectory(dataDir);if(!await readStoragePolicy(dataDir))return {enabled:false};
 return locked(dataDir,async()=>{
  const receipt={format:'athanor-storage-maintenance/v1',at:new Date().toISOString(),removed:[],retained:[]};
  if(!await idle())return {...receipt,state:'Busy'};
  let status=await storageStatus(dataDir,{filesystem});const rows=await registry(dataDir),pins=await retainedPins(dataDir),newest=new Set(['build','tool'].flatMap(kind=>rows.filter(r=>(r.kind||'build')===kind).sort((a,b)=>b.lastUsed-a.lastUsed).slice(0,status.policy.keepBuilds).map(cacheKey)));
  for(const name of await readdir(control(dataDir))){
   if(!/^retire-(build|tool)-(gh-[0-9]+|[a-f0-9]{64})\.json$/.test(name))continue;
   try{const file=path.join(control(dataDir),name);await regular(file);const intent=await readJSON(file),row=rows.find(r=>cacheKey(r)===cacheKey(intent)),target=cachePath(dataDir,intent.name,intent.kind),tombstone=path.join(cacheRoot(dataDir,intent.kind),'.retired-'+intent.name);
    if(!row||intent.target!==target||intent.tombstone!==tombstone||intent.ino!==row.ino||intent.dev!==row.dev||intent.logsRetained!==true||pins.some(p=>pathReferences(p,target)))throw Error('Retirement intent needs review');
    if(newest.has(cacheKey(row)))throw Error('Current or rollback cache retained after interruption');
    await directory(cacheRoot(dataDir,intent.kind));const st=await directory(tombstone),metadata=path.join(tombstone,intent.kind==='tool'?'tools.json':'build.json');await regular(metadata);if(await sha(metadata)!==row.metadataHash)throw Error('Retired metadata changed');if(st.dev!==row.dev||st.ino!==row.ino)throw Error('Retired cache changed');
    try{await lstat(target);throw Error('Cache path was recreated');}catch(e){if(e.code!=='ENOENT')throw e;}
    const app=await verifiedCacheApp(dataDir,row,tombstone,await readJSON(metadata));await retainCacheLogs(dataDir,row,path.join(app,'Contents/MacOS/logs'));
    if(!await idle()||processes([target,tombstone]).length)throw Error('Retired cache is in use');
    await rm(tombstone,{recursive:true});await rm(file);await json(path.join(control(dataDir),'caches.json'),(await registry(dataDir)).filter(r=>cacheKey(r)!==cacheKey(row)));receipt.removed.push({name:row.name,resumed:true});
   }catch(e){receipt.retained.push({name,reason:e.message});}
  }
  status=await storageStatus(dataDir,{filesystem});
  for(const row of [...(await registry(dataDir))].sort((a,b)=>a.lastUsed-b.lastUsed)){
   const target=cachePath(dataDir,row.name,row.kind);
   if(newest.has(cacheKey(row))||pins.some(p=>pathReferences(p,target))){receipt.retained.push({name:row.name,reason:'Current, rollback or retained job reference'});continue;}
   if(status.cacheWithinBudget&&status.capacityReady)break;
   try{
    await directory(cacheRoot(dataDir,row.kind));const st=await directory(target),meta=path.join(target,row.kind==='tool'?'tools.json':'build.json');await regular(meta);
    if(st.dev!==row.dev||st.ino!==row.ino||await sha(meta)!==row.metadataHash)throw Error('Registered cache changed');
    const actualApp=await verifiedCacheApp(dataDir,row,target,await readJSON(meta));
    if(!await idle()||processes([target]).length)throw Error('Cache is in use');
    await retainCacheLogs(dataDir,row,path.join(actualApp,'Contents/MacOS/logs'));
    const bytes=await storageSize(target),tombstone=path.join(cacheRoot(dataDir,row.kind),'.retired-'+row.name);
    // Persist intent before rename so interrupted deletion resumes only this exact inode.
    const intent=path.join(control(dataDir),'retire-'+(row.kind||'build')+'-'+row.name+'.json');await json(intent,{...row,target,tombstone,logsRetained:true});
    const fresh=await directory(target);if(fresh.dev!==row.dev||fresh.ino!==row.ino||await sha(meta)!==row.metadataHash||!await idle()||processes([target]).length)throw Error('Cache changed before retirement');
    await rename(target,tombstone);await directory(tombstone);const moved=await lstat(tombstone);if(moved.dev!==row.dev||moved.ino!==row.ino)throw Error('Retired cache identity changed');
    await rm(tombstone,{recursive:true});await rm(intent);receipt.removed.push({name:row.name,...bytes});
    await json(path.join(control(dataDir),'caches.json'),(await registry(dataDir)).filter(r=>cacheKey(r)!==cacheKey(row)));status=await storageStatus(dataDir,{filesystem});
   }catch(e){if(e.code!=='ENOENT')receipt.retained.push({name:row.name,reason:e.message});}
  }
  if(status.policy.backupDirectory)try{receipt.backup=await maintainBackups(dataDir,status.policy,idle);}catch(e){receipt.backup={state:'Needs attention',reason:e.message};}
  receipt.state='Complete';receipt.status=await storageStatus(dataDir,{filesystem});await json(path.join(control(dataDir),'latest.json'),receipt);return receipt;
 });
}
export async function requireStorageCapacity(dataDir,options){const status=await storageStatus(dataDir,options);if(status.enabled&&(!status.capacityReady||!status.scratchWithinBudget||!status.cacheWithinBudget))throw Error(`Storage needs cleanup before new work: free ${status.freeBytes} bytes, reserve ${status.reserveBytes}; run scratch ${status.scratch.logicalBytes}/${status.policy.scratchBytes} bytes; cache ${status.cache.logicalBytes}/${status.policy.cacheBytes} bytes. Logs and results were preserved.`);return status;}

async function maintainBackups(dataDir,policy,idle){
 const root=externalPath(policy.backupDirectory);if(root===dataDir||inside(dataDir,root)||inside(root,dataDir))throw Error('Backup directory overlaps worker data.');
 await mkdir(root,{recursive:true,mode:0o700});await directory(root);
 const workerId=await storageWorkerId(dataDir),backups=[];for(const name of await readdir(root)){if(!/^snapshot-[0-9]{13}-[a-f0-9-]{36}$/.test(name))continue;const file=path.join(root,name);await directory(file);const verified=await verifyStorageBackup(file);if(verified.workerId===workerId)backups.push({file,at:Date.parse(verified.createdAt)});}
 backups.sort((a,b)=>b.at-a.at);
 if(backups[0]&&Date.now()-backups[0].at<policy.backupIntervalHours*3600000)return {state:'Current',path:backups[0].file};
 const files=[];for(const name of ['storage-policy.json','worker-profile.json','worker.json','controller.json','desktop-runtime.json'])try{await regular(path.join(dataDir,name));files.push(name);}catch(e){if(e.code!=='ENOENT')throw e;}
 const result=await backupStorage(dataDir,path.join(root,'snapshot-'+Date.now()+'-'+randomUUID()),{files,idle,maxBytes:policy.backupMaxBytes});
 for(const old of backups.slice(policy.backupKeep-1)){await directory(old.file);await verifyStorageBackup(old.file);await rm(old.file,{recursive:true});}
 return {state:'Created',...result};
}
