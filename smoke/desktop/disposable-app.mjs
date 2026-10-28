import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {lstat,realpath,cp,rename,rm,readFile} from 'node:fs/promises';
import {dataDirectory,inside,readJSON,writeJSON} from '../runner/files.mjs';
import {acquireDesktopLease} from './desktop-lease.mjs';

const registration='disposable-app.json',receipt='disposable-app-retirement.json';
const mirrorFor=(root,app)=>path.join(root,'home/Library/Caches/Wizard/python',app.replace(/^\/+/,''));
async function ownedPaths(session){
 const dataDir=dataDirectory(session.dataDir),root=await realpath(session.root),app=path.join(root,'Wizard Smoke.app');
 if(root!==session.root||!inside(dataDir,root)||session.app!==app||session.sourceApp===app||!inside(root,app))throw Error('Disposable App ownership differs from its canonical session.');
 const source=await realpath(session.sourceApp);if(source===app||inside(app,source))throw Error('The selected source package is not disposable.');
 return {dataDir,root,app,source,mirror:mirrorFor(root,app)};
}
export async function registerDisposableApp(session){
 const p=await ownedPaths(session),stat=await lstat(p.app);
 if(stat.isSymbolicLink()||!stat.isDirectory()||await realpath(p.app)!==p.app||!/^[a-f0-9]{64}$/.test(session.guiHash||''))throw Error('Disposable App registration requires the verified owned directory.');
 const record={format:'athanor-disposable-app/v1',...p,packageHash:session.guiHash,dev:stat.dev,ino:stat.ino,registeredAt:new Date().toISOString()};
 const file=path.join(p.root,registration);try{const old=await readJSON(file);if(old.app!==record.app||old.source!==record.source||old.packageHash!==record.packageHash||old.dev!==record.dev||old.ino!==record.ino)throw Error('Disposable App registration changed.');return old;}catch(e){if(e.code!=='ENOENT')throw e;}
 await writeJSON(file,record);return record;
}
const absent=pid=>{
 if(!Number.isInteger(pid)||pid<2)throw Error('Missing stopped process identity.');
 try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw Object.assign(Error('Recorded process absence could not be verified.'),{diagnostics:{pid,code:e.code||null}});}
 let identity;try{identity=execFileSync('/bin/ps',['-p',String(pid),'-o','ppid=,lstart=,comm='],{encoding:'utf8',timeout:2000,maxBuffer:8192}).trim().slice(0,2048);}catch(e){identity='Inspection unavailable: '+(e.code||e.status||'unknown');}
 throw Object.assign(Error('A recorded process is still alive.'),{diagnostics:{pid,identity}});
};
const within=(root,file)=>file===root||inside(root,file);
// Arguments may quote an App as data. Only real executable or open-file paths
// count as use; recorded owned children are checked separately below.
export function inspectProcesses(targets){
 const text=execFileSync('/bin/ps',['-axww','-o','pid=,ppid=,comm='],{encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024}),table=new Map();
 for(const line of text.split('\n').filter(Boolean)){const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);if(!match)throw Error('Process identity inspection was incomplete.');const [,pid,ppid,executable]=match;table.set(+pid,{pid:+pid,ppid:+ppid,executable});}
 const refs=new Map();for(const proc of table.values())if(targets.some(target=>within(target,proc.executable)))refs.set(proc.pid,{...proc,kind:'executable',paths:[proc.executable]});
 if(targets.length){
  const result=spawnSync('/usr/sbin/lsof',['-nP','-Fpn'],{encoding:'utf8',timeout:5000,maxBuffer:16*1024*1024});
  if(result.error||result.signal||result.stderr?.trim()||result.status!==0||!result.stdout?.trim())throw Object.assign(Error('Open-file process inspection was incomplete.'),{diagnostics:{code:result.error?.code||null,status:result.status,signal:result.signal||null}});
  let pid;for(const field of (result.stdout||'').split('\n')){if(/^p\d+$/.test(field))pid=+field.slice(1);else if(field.startsWith('n')&&targets.some(target=>within(target,field.slice(1)))){if(!pid||!table.has(pid))throw Object.assign(Error('Open-file owner changed during inspection.'),{diagnostics:{pid:pid||null,path:field.slice(1).slice(0,2048)}});const proc=refs.get(pid)||{...table.get(pid),kind:'open-file',paths:[]};if(proc.paths.length<4&&!proc.paths.includes(field.slice(1)))proc.paths.push(field.slice(1));refs.set(pid,proc);}}
 }
 return [...refs.values()];
}
async function canonicalRecord(file){const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||await realpath(file)!==file)throw Error('Ownership record was redirected.');return readJSON(file);}
export async function inspectDisposableApp(file){const s=await canonicalRecord(file),p=await ownedPaths(s),record=await canonicalRecord(path.join(p.root,registration));return {session:s.state,record,paths:await Promise.all([p.app,p.mirror].map(async target=>{try{const st=await lstat(target);return {path:target,exists:true,directory:st.isDirectory(),symlink:st.isSymbolicLink()};}catch(e){if(e.code!=='ENOENT')throw e;return {path:target,exists:false};}}))};}
export async function retireDisposableApp(file,terminal,{acquire=acquireDesktopLease,processes=inspectProcesses}={}){
 let root,lease,registered=false;const outcome={format:'athanor-disposable-app-retirement/v1',state:'Retained',at:new Date().toISOString(),terminal,removed:[]};
 try{
  const session=await canonicalRecord(file),p=await ownedPaths(session);root=p.root;
  if(path.resolve(file)!==path.join(root,'session.json'))throw Error('Retirement requires the owned session record.');
  const record=await canonicalRecord(path.join(root,registration)),recordText=JSON.stringify(record);
  if(record.format!=='athanor-disposable-app/v1'||record.root!==root||record.app!==p.app||record.dataDir!==p.dataDir||record.source!==p.source||record.mirror!==p.mirror||record.packageHash!==session.guiHash)throw Error('No matching disposable App registration.');registered=true;
  if(!terminal?.known||!['Pass','Fail','Blocked'].includes(terminal.status)||session.agentUncertain||session.state!=='Stopped')throw Error('Session or terminal outcome remains active or uncertain.');
  if(session.pid)absent(session.pid);else if(session.generation!==0)throw Error('Missing stopped session PID.');
  const noPending=async()=>{for(const lock of ['agent-action.lock','call.lock','native-call.lock'])try{await lstat(path.join(root,lock));throw Error('An input or API call remains pending.');}catch(e){if(e.code!=='ENOENT')throw e;}};await noPending();
  lease=await acquire(p.dataDir);
  const revalidate=async()=>{
   const current=await canonicalRecord(file);if(JSON.stringify(await canonicalRecord(path.join(root,registration)))!==recordText)throw Error('Disposable registration changed during retirement.');await noPending();if(current.state!=='Stopped'||current.agentUncertain||current.pid!==session.pid||current.generation!==session.generation||current.app!==p.app||current.guiHash!==session.guiHash)throw Error('Session changed during retirement.');
   if(current.pid)absent(current.pid);
   const present=[];for(const target of [p.app,p.mirror])try{await lstat(target);present.push(target);}catch(e){if(e.code!=='ENOENT')throw e;}const refs=processes(present);if(!Array.isArray(refs))throw Error('Process reference inspection returned an invalid result.');if(refs.length)throw Object.assign(Error('A process still uses the disposable App.'),{diagnostics:{references:refs.slice(0,16),additionalReferences:Math.max(0,refs.length-16)}});
   for(const name of ['owned-children.jsonl','owned-processes.jsonl'])try{for(const line of (await readFile(path.join(root,name),'utf8')).split('\n').filter(Boolean))absent(JSON.parse(line).pid);}catch(e){if(e.code!=='ENOENT')throw e;}
  };
  await revalidate();
  const targets=[];
  for(const target of [p.mirror,p.app])try{
   const stat=await lstat(target);if(stat.isSymbolicLink()||!stat.isDirectory()||await realpath(target)!==target)throw Error('Disposable App path was redirected.');
   if(target===p.app&&(stat.dev!==record.dev||stat.ino!==record.ino))throw Error('Registered App directory was replaced.');targets.push({path:target,dev:stat.dev,ino:stat.ino});
  }catch(e){if(e.code!=='ENOENT')throw e;}
  for(const target of targets){const logs=path.join(target.path,'Contents/MacOS/logs'),destination=path.join(root,target.path===p.app?'retired-app-logs':'retired-mirror-logs');try{if(await realpath(logs)!==logs)throw Error('App logs were redirected.');await cp(logs,destination,{recursive:true,verbatimSymlinks:true});(outcome.retainedLogs??=[]).push(destination);}catch(e){if(e.code!=='ENOENT')throw e;}}
  await revalidate();outcome.state='Retiring';outcome.app=p.app;outcome.mirror=p.mirror;await writeJSON(path.join(root,receipt),outcome);
  for(const target of targets){await revalidate();const st=await lstat(target.path);if(st.isSymbolicLink()||!st.isDirectory()||await realpath(target.path)!==target.path||st.dev!==target.dev||st.ino!==target.ino)throw Error('Disposable App changed immediately before deletion.');const tombstone=target.path+'.athanor-retired-'+randomUUID();await rename(target.path,tombstone);const moved=await lstat(tombstone);if(moved.dev!==target.dev||moved.ino!==target.ino||moved.isSymbolicLink()||await realpath(tombstone)!==tombstone)throw Error('Retired App identity changed.');await rm(tombstone,{recursive:true});outcome.removed.push(target.path);}
  outcome.state='Retired';outcome.finishedAt=new Date().toISOString();await writeJSON(path.join(root,receipt),outcome);
 }catch(error){outcome.reason=error.message;if(error.diagnostics)outcome.diagnostics=error.diagnostics;if(registered)try{await writeJSON(path.join(root,receipt),outcome);}catch(retention){outcome.retentionError=retention.message;}}
 finally{await lease?.release();}
 return outcome;
}
