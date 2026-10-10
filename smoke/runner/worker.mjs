import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {ROOT,dataDirectory,externalPath,fingerprint,readJSON} from './files.mjs';
import {sourceProvenance} from './source-provenance.mjs';
import {client} from '../scripts/smoke.mjs';
import {sourceIdentity} from './prepare.mjs';

export async function createWorkerProfile({name,dataDir,port=4317}){
 if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('Worker name is required (maximum 120 characters).');
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Worker port must be 1–65535.');
 const provenance=await sourceProvenance(ROOT);
 if(provenance.available&&provenance.dirty)throw Error('Commit and review the source before pinning a managed worker. Developer clones need no worker profile.');
 return {format:'athanor-worker/v1',name:name.trim(),dataDir:dataDirectory(dataDir),port,sourceHash:(await fingerprint(ROOT)).sha256,runnerHash:await sourceIdentity(),sourceCommit:provenance.commit||null};
}
export async function checkWorkerProfile(profile){
 if(!profile||profile.format!=='athanor-worker/v1'||typeof profile.name!=='string'||!profile.name.trim()||profile.name.length>120||!Number.isInteger(profile.port)||profile.port<1||profile.port>65535||!/^[a-f0-9]{64}$/.test(profile.sourceHash)||!/^[a-f0-9]{64}$/.test(profile.runnerHash)||typeof profile.dataDir!=='string'||!path.isAbsolute(profile.dataDir))throw Error('Invalid worker profile.');
 const dataDir=dataDirectory(profile.dataDir);
 if((await fingerprint(ROOT)).sha256!==profile.sourceHash)throw Error('Worker source changed. Qualify the new version and create a new profile before starting it.');
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Athanor requires Node.js 24 or newer.');
 return {...profile,dataDir,server:'http://127.0.0.1:'+profile.port};
}
export async function saveWorkerProfile(file,options){
 file=externalPath(path.resolve(file));const profile=await createWorkerProfile(options);
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(profile,null,2)+'\n',{flag:'wx',mode:0o600});return {profile,file,wizardLaunched:false};
}
export async function workerRun(call,{planHash,requestId,operator}){
 if(!/^[a-f0-9]{64}$/.test(planHash)||typeof requestId!=='string'||!requestId.match(/^[A-Za-z0-9-]{1,100}$/)||typeof operator!=='string'||!operator.trim()||operator.length>120)throw Error('Supply a frozen plan hash, retained request ID and operator.');
 const state=await call('/api/worker');
 if(state.active)return {state:'Busy',runId:state.active.run_id,url:state.active.url,inputDispatched:false};
 if(state.preparing||state.ownedSessions.length||state.activeDesktopJobs.length)return {state:'Busy',runId:null,inputDispatched:false,message:'Finish the active preparation or desktop session.'};
 // The server repeats admission checks atomically; this observation reserves nothing.
 const result=await call('/api/runner/start',{planHash,requestId,operator});return {...result,state:'Admitted'};
}
export async function workerClient(profileFile){
 const profile=await checkWorkerProfile(await readJSON(profileFile)),call=client(profile.server),state=await call('/api/worker');
 if(state.sourceMatches!==true||state.fullSourceHash!==profile.sourceHash||state.sourceHash!==profile.runnerHash||state.dataDir!==profile.dataDir||state.name!==profile.name)throw Error('The listening service differs from the pinned worker. Inspect its source/workspace before dispatch.');
 return {profile,call};
}
