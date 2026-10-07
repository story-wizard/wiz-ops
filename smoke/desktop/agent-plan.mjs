import path from 'node:path';
import {mkdir,realpath,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import {agentTool,compareObservation,isAgentMutation} from './agent-tools.mjs';
import {validateSequence,sequenceAdvice,agentSequence,toolError} from './agent-connection.mjs';
import {fields,proofError} from './agent-proof.mjs';
import {verifyDesktopPaths} from './adapter.mjs';
import {readJSON,writeJSON,sha,inside,digest} from '../runner/files.mjs';
import {bindingReferences,validatePlanBindings,readPlanBinding} from './plan-bindings.mjs';

const readKinds=['observe','find','model','model_value','call','native','query'];
export const planLimits={maxPhases:8,maxDeclaredSteps:32,maxRequestBytes:65536,maxDurationMs:120000};
const invalid=message=>proofError('invalid_plan',message,['correct_parameters']);
export function validateAgentPlan(plan,schema){
 fields(plan,['format','start','phases','maxDurationMs','bindings'],'plan');
 if(plan.bindings!==undefined)fields(plan.bindings,Object.keys(plan.bindings||{}),'bindings');
 if(plan.format!=='athanor-agent-plan/v1'||!Array.isArray(plan.phases)||!plan.phases.length||plan.phases.length>planLimits.maxPhases||Buffer.byteLength(JSON.stringify(plan))>planLimits.maxRequestBytes)throw invalid('Use athanor-agent-plan/v1 with 1–8 phases within 64 KiB');
 if(plan.maxDurationMs!==undefined&&(!Number.isInteger(plan.maxDurationMs)||plan.maxDurationMs<1||plan.maxDurationMs>planLimits.maxDurationMs))throw invalid('maxDurationMs must be 1–120000');
 const phases=new Map();let count=0;
 for(const phase of plan.phases){
  fields(phase,['id','steps','next','continuationRead'],'phase');
  if(typeof phase.id!=='string'||! /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(phase.id)||phases.has(phase.id))throw invalid('Supply distinct phase IDs of 1–64 letters, digits, underscores or hyphens');
  if(!Array.isArray(phase.steps))throw invalid('Phase steps must be an array');
  try{validateSequence(phase.steps.map(step=>bindingReferences(step,plan.bindings||{}).step),schema);}catch(error){error.diagnostics={...error.diagnostics,phase:phase.id};throw error;}count+=phase.steps.length;phases.set(phase.id,phase);
  if(phase.continuationRead!==undefined){const i=phase.continuationRead,source=phase.steps[i];if(!Number.isInteger(i)||i!==phase.steps.findLastIndex(s=>s.operation!=='capture')||!source||source.expect===undefined||!readKinds.includes(source.operation)||isAgentMutation(source.operation,source.params)||source.params?.since!==undefined)throw invalid('continuationRead must name the final gated full read-only step, followed only by captures');}
  if(phase.next===null||typeof phase.next==='string')continue;
  fields(phase.next,['step','path','cases'],'next');const source=phase.steps[phase.next.step];
  if(!Number.isInteger(phase.next.step)||phase.next.step!==phase.steps.length-1||!source||!readKinds.includes(source.operation)||isAgentMutation(source.operation,source.params)||source.params?.since!==undefined)throw invalid('Branch from the final full read-only step in the same phase');
  if(!Array.isArray(phase.next.cases)||!phase.next.cases.length||phase.next.cases.length>4)throw invalid('Use 1–4 explicit branch cases');
  for(const choice of phase.next.cases){fields(choice,['equals','phase'],'case');if(!Object.hasOwn(choice,'equals')||choice.equals===undefined||!(choice.phase===null||typeof choice.phase==='string'))throw invalid('A case needs an exact equals value and a phase ID or null');compareObservation({}, {path:phase.next.path,equals:choice.equals});}
  if(phase.next.cases.some((c,i)=>phase.next.cases.slice(0,i).some(p=>isDeepStrictEqual(p.equals,c.equals))))throw invalid('Branch values must be distinct');
 }
 if(count>planLimits.maxDeclaredSteps)throw invalid('Use at most 32 declared steps across all paths');
 const visited=new Set(),active=new Set(),targets=phase=>phase.next===null?[]:typeof phase.next==='string'?[phase.next]:phase.next.cases.map(c=>c.phase).filter(v=>v!==null);
 const visit=id=>{if(!phases.has(id))throw invalid('Unknown phase '+String(id));if(active.has(id))throw invalid('Plans must be acyclic');if(visited.has(id))return;active.add(id);for(const next of targets(phases.get(id)))visit(next);active.delete(id);visited.add(id);};
 visit(plan.start);if(visited.size!==phases.size)throw invalid('Every phase must be reachable from start');validatePlanBindings(plan,phases);
 return phases;
}
// Large fixture values remain in the checksummed plan; never silently omit a gate.
export function reviewAgentPlan(plan){
 const value=v=>{const bytes=Buffer.byteLength(JSON.stringify(v));return bytes<=512?v:{retainedInPlan:true,sha256:digest(v),bytes,...Array.isArray(v)?{items:v.length}:{}};};
 return {format:'athanor-agent-plan-review/v1',planHash:digest(plan),start:plan.start,maxDurationMs:plan.maxDurationMs??planLimits.maxDurationMs,
  bindings:plan.bindings||{},phases:plan.phases.map(p=>({id:p.id,steps:p.steps.map((s,index)=>({index,operation:s.operation,title:s.params?.title||s.params?.operation||s.params?.command||s.operation,
   mutation:isAgentMutation(s.operation,s.params),params:Object.fromEntries(Object.entries(s.params||{}).filter(([k])=>k!=='title').map(([k,v])=>[k,value(v)])),...s.expect?{expect:Object.fromEntries(Object.entries(s.expect).map(([k,v])=>[k,value(v)]))}:{}})),next:p.next,reviewAfter:p.next===null})),
  stops:['Failed expectation or tool error','Unexpected branch value or incomplete observation','Changed process/project or stale binding','Unknown input: inspect retained intent; never replay'],
  retention:'Hashed values are available in the full plan. Inspect them when their meaning or fixture provenance is not established. This review performs no input.'};
}
export async function checkAgentPlan(file,plan){
 validateAgentPlan(plan,(await readJSON(file)).schema);
 return {format:'athanor-agent-plan-check/v1',status:'Valid',executed:false,validation:'all-paths-parameters-schema-and-acyclic-graph',limits:planLimits,maxDurationMs:plan.maxDurationMs??planLimits.maxDurationMs,review:reviewAgentPlan(plan),phases:plan.phases.map(p=>({id:p.id,steps:p.steps.length,next:p.next,...sequenceAdvice(p.steps)}))};
}
// Branches require complete snapshots. Delta views and partial pages cannot prove an alternate path.
export function requireComplete(value){
 if(value===null||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(/(?:truncated|incomplete)$/i.test(key)&&item!==false&&item!==null&&item!==undefined||['hasMore','partial'].includes(key)&&item===true||['complete','inspectionComplete'].includes(key)&&item===false||key==='completion'&&item!=='complete'||key==='offset'&&Object.hasOwn(value,'model')&&item!==0||key==='encoding'&&item==='delta'||['next_cursor','nextCursor'].includes(key)&&item!==null&&item!==undefined)throw proofError('incomplete_branch_observation','A branch requires a full, untruncated readback',['observe']);
  requireComplete(item);
 }
}
export function validatePlanRequestId(id){
 if(typeof id!=='string'||!id.length||id.length>128)throw invalid('requestId must contain 1–128 characters');return id;
}
const planDirectory=(session,id)=>path.join(session.root,'plan-'+createHash('sha256').update(validatePlanRequestId(id)).digest('hex'));
const identity=s=>({packageHash:s.guiHash??null,pid:s.pid??null,started:s.processStart??null,generation:s.generation??null,bundle:s.bundle??null});
function planSummary(state){return {phases:state.phases.map(p=>({id:p.id,status:p.result.status,summary:p.result.summary,branch:p.branch,next:p.next})),
 review:{outcomes:state.phases.flatMap(p=>(p.result.summary?.steps||[]).filter(s=>s.gateMatched!==undefined).map(s=>({phase:p.id,...s}))),
  evidence:state.phases.flatMap(p=>(p.result.summary?.evidence||[]).map(e=>({phase:p.id,...e}))),
  scope:'Recorded gates and retained artifacts only. Review declared images; these records do not prove the current screen.'},
 activePhase:state.activePhase,activeStep:state.activeStep,returnedActiveSteps:(state.activeResults||[]).map(r=>({index:r.index,operation:r.operation})),continuation:state.continuation};}
export async function inspectAgentPlan(file,requestId){
 const session=await readJSON(file);verifyDesktopPaths(session);const directory=planDirectory(session,requestId),canonical=await realpath(directory);
 if(!inside(await realpath(session.root),canonical))throw invalid('Plan inspection escaped the owned session');
 const stored=async name=>{const target=await realpath(path.join(directory,name));if(!inside(canonical,target))throw invalid('Plan storage escaped the owned plan directory');return readFile(target);};
 let pointer;try{pointer=JSON.parse(await stored('completed.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let state,receipt;
 if(pointer){
  const retained=path.join(directory,'receipt.json'),bytes=await stored('receipt.json');if(createHash('sha256').update(bytes).digest('hex')!==pointer.sha256)throw proofError('plan_receipt_mismatch','Retained plan receipt checksum differs',['inspect_storage']);state=JSON.parse(bytes);receipt={path:retained,sha256:pointer.sha256};
 }else state=JSON.parse(await stored('progress.json'));
 if(state.format!=='athanor-agent-plan/v1'||state.requestId!==requestId||typeof state.session!=='string'||await realpath(state.session)!==await realpath(file))throw invalid('Plan identity differs from the requested session');
 const interrupted=state.status==='Running',summary=planSummary(state);
 if(interrupted)summary.continuation={state:'inspect_unsettled',automatic:false,nextActions:['inspect_progress','inspect_tool_journals','reconcile_possible_input']};
 return {format:'athanor-agent-plan-inspection/v1',requestId,status:interrupted?'Unsettled':state.status,retainedStatus:state.status,currentSessionMatches:isDeepStrictEqual(state.identity,identity(session)),identity:state.identity,summary,progress:path.join(directory,'progress.json'),receipt,results:state.phases,activeResults:state.activeResults||[],bindings:state.bindings||{},bindingReads:state.bindingReads||[],failure:state.failure,retentionIncomplete:!pointer&&!interrupted,executable:false};
}
export function selectPlanBranch(next,result){
 requireComplete(result);
 const observations=next.cases.map(c=>compareObservation(result,{path:next.path,equals:c.equals}));
 if(observations.some(c=>c.missing))throw proofError('missing_branch_observation','The branch path is missing',['observe']);
 const matches=observations.flatMap((c,i)=>c.matched?[i]:[]);
 if(matches.length!==1)throw proofError('unrecognized_branch_value','The readback does not match exactly one declared value',['inspect']);
 const index=matches[0];return {sourceStep:next.step,path:next.path||[],actual:observations[index].actual,caseIndex:index,next:next.cases[index].phase};
}
// Each phase reuses agentSequence; each operation still enters ordinary admission and fresh input guards.
export async function runAgentPlan(file,plan,execute=agentTool,{compact=false,requestId=randomUUID()}={}){
 const session=await readJSON(file),phases=validateAgentPlan(plan,session.schema);
 if(typeof compact!=='boolean')throw invalid('compact must be boolean');
 verifyDesktopPaths(session);const directory=planDirectory(session,requestId);
 try{await mkdir(directory);}catch(e){if(e.code==='EEXIST')throw proofError('plan_request_exists','This request ID has retained intent; inspect it instead of resending',['plan-inspect']);throw e;}
 const progress=path.join(directory,'progress.json'),started=performance.now();
 const state={format:'athanor-agent-plan/v1',requestId,status:'Running',session:file,identity:identity(session),build:{packageHash:session.guiHash},process:{pid:session.pid,started:session.processStart,generation:session.generation},plan,phases:[],bindings:{},bindingReads:[],activePhase:null,activeStep:null,activeResults:[],startedAt:new Date().toISOString()};
 const budget=()=>{if(performance.now()-started>= (plan.maxDurationMs??planLimits.maxDurationMs))throw proofError('plan_budget_exceeded','Plan dispatch budget expired; inspect returned steps before further work',['inspect']);};
 const retain=async()=>writeJSON(progress,state);
 let next=plan.start,storageError;
 try{
  while(next!==null){
   budget();const phase=phases.get(next);state.activePhase=next;state.activeResults=[];state.activeStep=null;await retain();let index=0;
   const values=Object.fromEntries(Object.entries(state.bindings).map(([name,b])=>[name,b.value]));
   const resolved=phase.steps.map(step=>bindingReferences(step,plan.bindings||{},values).step);validateSequence(resolved,session.schema);
   const result=await agentSequence(file,resolved,async(...args)=>{
    budget();if(storageError)throw proofError('plan_progress_failed','Retain known results before further input',['inspect_storage']);
    if(!isDeepStrictEqual(identity(await readJSON(file)),state.identity))throw proofError('plan_identity_changed','The plan build, process, generation or project changed',['context']);
    const step=index++;
    for(const name of bindingReferences(phase.steps[step],plan.bindings||{}).used){
     const b=plan.bindings[name],source=phases.get(b.phase).steps[b.step];budget();state.activeStep={index:step,operation:source.operation,status:'Started',bindingRefresh:name};await retain();
     const read=await execute(file,source.operation,source.params||{}),refresh={phase:phase.id,index:step,name,result:read};state.bindingReads.push(refresh);state.activeStep={...state.activeStep,status:'Returned'};await retain();requireComplete(read);
     const gate=compareObservation(read,source.expect),value=readPlanBinding(b,read);Object.assign(refresh,{gate,value});await retain();
     if(!gate.matched||!isDeepStrictEqual(value,state.bindings[name].value))throw proofError('stale_plan_binding','The unique entity readback changed before use',['observe']);
    }
    budget();if(!isDeepStrictEqual(identity(await readJSON(file)),state.identity))throw proofError('plan_identity_changed','Identity changed during binding refresh',['context']);
    state.activeStep={index:step,operation:args[1],status:'Started'};await retain();let returned;
    try{returned=await execute(...args);}catch(error){state.activeStep={...state.activeStep,...toolError(error)};try{await retain();}catch(e){storageError=e;}throw error;}
    state.activeResults.push({index:step,operation:args[1],result:returned});state.activeStep={...state.activeStep,status:'Returned'};
    try{await retain();}catch(e){storageError=e;}return returned;
   });
   const record={id:phase.id,result};state.phases.push(record);state.activePhase=null;state.activeStep=null;state.activeResults=[];
   if(result.status!=='Completed'){state.status=result.status;state.failure={phase:phase.id,...result.failure};state.continuation=result.summary.continuation;break;}
   if(storageError)throw proofError('plan_progress_failed','Retain known results before further input',['inspect_storage']);budget();
   if(phase.continuationRead!==undefined)requireComplete(result.results.find(r=>r.index===phase.continuationRead).result);
   for(const [name,b] of Object.entries(plan.bindings||{}))if(b.phase===phase.id){const read=result.results.find(r=>r.index===b.step).result;requireComplete(read);state.bindings[name]={value:readPlanBinding(b,read),phase:phase.id,step:b.step,path:b.path,identity:state.identity};}
   if(phase.next!==null&&typeof phase.next!=='string'){
    record.branch=selectPlanBranch(phase.next,result.results.find(r=>r.index===phase.next.step).result);next=record.branch.next;
   }else next=phase.next;
   record.next=next;await retain();
  }
  if(state.status==='Running'){state.status='Completed';state.continuation={state:'review_checkpoint',automatic:false,nextActions:['inspect_results']};}
 }catch(error){
  const failure=toolError(error);state.status=failure.status;state.failure={phase:state.activePhase||state.phases.at(-1)?.id,...failure};state.continuation={state:failure.status==='Unknown'?'reconcile_unknown':'inspect_blocker',automatic:false,nextActions:failure.nextActions};
 }
 state.durationMs=performance.now()-started;state.finishedAt=new Date().toISOString();
 const summary=planSummary(state);
 try{
  await retain();const retained=path.join(directory,'receipt.json');await writeJSON(retained,{...state,summary});const receipt={path:retained,sha256:await sha(retained)};await writeJSON(path.join(directory,'completed.json'),{requestId,sha256:receipt.sha256});
  if(!compact)return {...state,summary,progress,receipt};
  return {format:state.format,requestId,status:state.status,failure:state.failure,durationMs:state.durationMs,encoding:'compact',summary,progress,receipt};
 }catch(error){return {...state,summary:{...summary,continuation:{state:'retain_receipt',automatic:false,nextActions:['retain_full_response','inspect_storage']}},progress,retentionError:{code:'receipt_retention_failed',error:error.message}};}
}
