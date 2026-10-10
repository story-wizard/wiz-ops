import {requireScriptCompletion,requireScriptReceipt,endCheck,mergeReopenResult} from './check-support.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDesktop,launchDesktop,stopDesktop,retainChild,nativeCall} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {assert,command} from '../runner/engine.mjs';
import strict from 'node:assert/strict';
export async function executeService(prepared,{onResult=async()=>{},isCancelled=()=>false,signal}={}){
const full=await readJSON(new URL('./service-course.json',import.meta.url)),ids=prepared?.ids||full.cases.map(c=>c.id),course={...full,cases:full.cases.filter(c=>ids.includes(c.id))},here=path.dirname(fileURLToPath(import.meta.url));
const session=await prepareDesktop(prepared?.runtime.app||process.argv[2],prepared?.runtime.qtPlugin||process.argv[3],prepared?.runtime.cli||process.argv[4],prepared),file=path.join(session.root,'session.json');session.selectedChecks=ids;await writeJSON(file,session);
const map=await readJSON(new URL('./check-map.json',import.meta.url)),wants=name=>map[name]?.some(id=>ids.includes(id));
const report={course,inputMode:'service',scope:course.target,startedAt:new Date().toISOString(),guiHash:session.guiHash,cliHash:session.desktopCliHash,qtCocoa:session.qtCocoa,results:[],sources:{},workerHash:await sha(path.join(session.app,'Contents/MacOS/wizard-export-worker'))};
for(const name of ['service-course.json','service-run.mjs','adapter.mjs','check-support.mjs','generated-fixture.mjs','check-generated.mjs','check-generated-tail.mjs','functional-cohort-proof.mjs','check-offline-export.mjs','check-idle.mjs','native/bridge.cpp','native/build.sh','native/smoke-style.json'])report.sources[name]=await sha(path.join(here,name));
let live,tailVerificationPending=false;
async function script(name,output,count,args=[]){
 if(!wants(name))return;if(isCancelled())throw Object.assign(Error('Course cancelled'),{status:'Unknown'});
 const receipt=await command(process.execPath,[path.join(here,name),file,...args],{timeout:name==='check-idle.mjs'?660000:300000,signal,processGroup:true,onSpawn:pid=>retainChild(session,pid)});await writeJSON(path.join(session.root,name+args.join('-')+'-execution.json'),receipt);
 requireScriptReceipt(receipt,name);const r=await readJSON(path.join(session.root,output));for(const value of r.results){assert(ids.includes(value.id),'Script executed unselected check '+value.id);const prior=report.results.find(r=>r.id===value.id);if(prior)Object.assign(prior,mergeReopenResult(prior,value));else report.results.push(value);await onResult(prior||value,session.root);}
 requireScriptCompletion(receipt,r,name);
}
try{
  live=await launchDesktop(session,{foreground:false});report.bridgeHash=(await readJSON(file)).bridgeHash;
  for(const op of ['context-click','drop-model-item','snapshot-presented','type-text','key','click','action','activate','text','select','drag','item-click','close-window','clipboard-save','spellbook-run-local','snapshot-node-preview'])await strict.rejects(()=>nativeCall(file,op,{}),/cannot dispatch UI input/);
  report.guards={status:'Pass',checks:16,scope:'Background service sessions reject every UI input path tested'};
  await script('check-generated.mjs','service-generated-report.json',4);
  tailVerificationPending=ids.includes('S-MGFX-TAIL-TIMING');
  await script('check-generated-tail.mjs','service-generated-tail-report.json',1);
  await script('check-idle.mjs','service-idle-report.json',1);
  await stopDesktop(file);await live.closed;
  await script('check-offline-export.mjs','service-export-report.json',3);
  if(ids.includes('S-MGFX-PERSIST')||tailVerificationPending){const before=await readJSON(file),previousPid=before.pid,previousGeneration=before.generation;live=await launchDesktop(before,{foreground:false});const after=await readJSON(file);assert(previousPid!==after.pid&&after.generation===previousGeneration+1,'Persistence reused the same process');
  await script('check-generated.mjs','service-generated-reopen-report.json',1,['verify']);
  await script('check-generated-tail.mjs','service-generated-tail-reopen-report.json',1,['verify']);tailVerificationPending=false;}
}catch(e){report.error=e.message;report.errorStatus=e.status;}
finally{
  if(live&&live.child.exitCode===null&&!live.child.signalCode)try{await stopDesktop(file);await live.closed;}catch(e){report.cleanupError=e.message;}
  if(tailVerificationPending){const prior=report.results.find(r=>r.id==='S-MGFX-TAIL-TIMING');if(prior?.status==='Pass'){prior.initial={status:prior.status,evidence:prior.evidence};prior.status=report.errorStatus==='Unknown'?'Unknown':'Blocked';prior.error='Animated tail reopen did not complete: '+(report.error||report.cleanupError||'interrupted');}}
  const tail=report.results.find(r=>r.id==='S-MGFX-TAIL-TIMING');if(tail&&!report.cleanupError)await endCheck(file,{...tail,final:true});
  for(const c of course.cases)if(!report.results.some(r=>r.id===c.id))report.results.push({id:c.id,status:'Blocked',error:'Not executed after an unmet prerequisite. '+(report.error||'')});
  report.finishedAt=new Date().toISOString();report.status=!report.error&&!report.cleanupError&&report.results.length===course.cases.length&&report.results.every(r=>r.status==='Pass')?'Pass':'Fail';
  await writeJSON(path.join(session.root,'desktop-course-report.json'),report);console.log(JSON.stringify({report:path.join(session.root,'desktop-course-report.json'),status:report.status,passed:report.results.filter(r=>r.status==='Pass').length,total:course.cases.length}));
}

return {report,sessionFile:file,root:session.root};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let prepared;
 if(process.argv[2]==='--candidate-idle'){
  assert(process.argv.length===4,'Use --candidate-idle PREPARATION_PLAN.json');
  const plan=await readJSON(process.argv[3]);assert(plan.runtime,'Preparation requires an explicit retained runtime.');
  prepared={plan,runtime:plan.runtime,ids:['S-PF-IDLE']};
  console.log('Candidate PF-25 only. The supplied plan verifies preparation inputs; its selected course is not executed. This does not accept the new definition.');
 }
 const {report}=await executeService(prepared);if(report.status!=='Pass')process.exitCode=1;
}
