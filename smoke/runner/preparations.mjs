import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {dataDirectory,writeJSON,readJSON} from './files.mjs';
import {prepare} from './prepare.mjs';

const live=new Set();
const phases=[['tools','Set up matching desktop instrumentation'],['fixtures','Prepare project media and local tools'],['build','Verify selected build and command interface'],['attach','Attach and verify the selected desktop build'],['ready','Freeze the ready workspace']];
const location=(data,id)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid preparation ID.');return path.join(dataDirectory(data),'preparations',id+'.json');};
export async function startPreparation(options,{execute=prepare,onFinished=()=>{}}={}){
 const data=dataDirectory(options.dataDir),id=randomUUID(),file=location(data,id);await mkdir(path.dirname(file),{recursive:true});
 const job={id,state:'Preparing',app:options.app,selection:options.selection,startedAt:new Date().toISOString(),steps:phases.map(([id,title])=>({id,title,status:'Not run'}))};
 await writeJSON(file,job);live.add(id);
 const progress=async phase=>{
  const index=job.steps.findIndex(s=>s.id===phase);if(index<0)throw Error('Unknown preparation phase.');
  for(let i=0;i<index;i++)job.steps[i].status='Pass';job.steps[index].status='Running';await writeJSON(file,job);
 };
 const completion=(async()=>{
  try{const plan=await execute({...options,dataDir:data,onProgress:progress});job.state='Ready';job.planHash=plan.planHash;job.version=plan.version;job.packageHash=plan.packageHash;job.steps.forEach(s=>s.status='Pass');}
  catch(e){job.state='Failed';job.error=e.message;const running=job.steps.find(s=>s.status==='Running');if(running)running.status='Fail';
   job.repairPrompt=`Repair Athanor preparation ${id}. Selected build: ${options.app}. Error: ${e.message}.\nRead AGENTS.md, docs/desktop-tools-setup.md and docs/build-repair.md in the Athanor checkout. Inspect ${file} and the external workspace ${data}.\nUse the selected build and its shipped CLI. Do not substitute an instrumented app or overwrite prior evidence. Verify matching plugin/Qt versions, isolated settings, package identity, required operations and fixture prerequisites. Fix the setup or test mapping, run framework checks and retry preparation as a new attempt. Return the cause and evidence. Do not start a test course until preparation is Ready.`;
  }finally{job.finishedAt=new Date().toISOString();try{await writeJSON(file,job);}finally{live.delete(id);onFinished();}}
  return job;
 })();
 // Callers can await completion; the HTTP route keeps the job running after admission.
 completion.catch(()=>{});
 return {job,completion};
}
export async function readPreparation(data,id){
 const job=await readJSON(location(data,id));
 if(job.state==='Preparing'&&!live.has(id))return {...job,state:'Interrupted',error:'Preparation was interrupted. Inspect its retained files before starting a new attempt.',repairPrompt:`Inspect interrupted Athanor preparation ${id} in ${location(data,id)}. Read AGENTS.md and docs/desktop-tools-setup.md. Verify any owned process has stopped, preserve its evidence, and prepare ${job.app} again as a new attempt. Use this selected build and its shipped CLI; do not substitute another app or start a course before Ready.`};
 return job;
}
