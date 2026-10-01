import path from 'node:path';
import {readlink,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,dataDirectory,readJSON,sha,digest} from '../runner/files.mjs';
import {prepare} from '../runner/prepare.mjs';
import {resolveSelection} from '../runner/catalog.mjs';
import {client,waitForRun} from './smoke.mjs';

const base=path.dirname(ROOT),manifest=await readJSON(path.join(base,'kit.json'));
if(manifest.format!=='wizard-smoke-kit/v1'||digest(manifest.inventory)!==manifest.inventoryHash)throw Error('Kit manifest is invalid.');
if(process.platform!==manifest.requirements.platform||process.arch!==manifest.requirements.architecture)throw Error('Kit platform or architecture differs.');
for(const [file,size,hash] of manifest.inventory){
 const full=path.resolve(base,file);if(!full.startsWith(base+path.sep))throw Error('Kit inventory path escapes its root.');
 if(size==='symlink'){if(await readlink(full)!==hash)throw Error('Kit link changed: '+file);}
 else if((await stat(full)).size!==size||await sha(full)!==hash)throw Error('Kit file changed: '+file);
}
for(const dep of manifest.externalDependencies)if(await sha(dep.path)!==dep.sha256)throw Error('Required local dependency differs: '+dep.path);
console.log(JSON.stringify({format:'wizard-smoke-kit-check/v1',verified:true,runId:manifest.runId,externalDependencies:manifest.externalDependencies.length}));
if(process.argv[2]==='run'){
 const i=process.argv.indexOf('--operator'),operator=i>=0?process.argv[i+1]:null;if(!operator)throw Error('Supply --operator NAME.');
 const data=dataDirectory();
 let server,log='';
 try{
  server=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{cwd:ROOT,env:{...process.env,SMOKE_DATA_DIR:data,PORT:'0'},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Kit service startup timed out.')),20000);server.on('error',e=>{clearTimeout(timer);reject(e);});server.on('exit',()=>{clearTimeout(timer);reject(Error('Kit service stopped: '+log));});server.stderr.on('data',d=>{log+=d;});server.stdout.on('data',d=>{log+=d;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
  const call=client(url),db=new DatabaseSync(path.join(data,'smoke.sqlite'));
  let selection;try{selection=resolveSelection(db,manifest.selection);}finally{db.close();}
  const plan=await prepare({app:path.join(base,'inputs/Package.app'),fixtureRoot:path.join(base,'inputs/media'),speechDirectory:manifest.speechModel?path.join(base,'inputs/speech-model'):undefined,selection,runtime:manifest.desktopHash&&!manifest.selectedAttachment?{app:path.join(base,'inputs/Desktop.app'),cli:path.join(base,'inputs/wiz-cli'),qtPlugin:path.join(base,'inputs/libqcocoa.dylib'),bridge:path.join(base,'inputs/libwizard_smoke.dylib'),...(manifest.retainedLibraries?{libraries:path.join(base,'inputs/libraries')}:{})}:undefined});
  if(plan.packageHash!==manifest.packageHash||plan.runtime&&plan.runtime.appHash!==manifest.desktopHash)throw Error('Relocated package identity differs from the original run.');
  const admitted=await call('/api/runner/start',{planHash:plan.planHash,operator,requestId:'kit-'+crypto.randomUUID()});console.log(JSON.stringify(admitted));
  const result=await waitForRun(call,admitted.runId,{timeout:3600});
  if(result.complete)result.report=await call('/api/runs/'+admitted.runId+'/report',{});
  console.log(JSON.stringify(result,null,2));process.exitCode=result.exitCode;
 }finally{server?.kill('SIGTERM');}
}else if(process.argv[2]!=='check')throw Error('Usage: node workspace/scripts/kit.mjs check | run --operator NAME');
