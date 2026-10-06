import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import {agentTool,compareObservation,isAgentMutation} from './agent-tools.mjs';
import {validateSequence,sequenceAdvice,agentSequence,toolError} from './agent-connection.mjs';
import {fields,proofError} from './agent-proof.mjs';
import {verifyDesktopPaths} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';

const readKinds=['observe','find','model','model_value','call','native'];
export const planLimits={maxPhases:8,maxDeclaredSteps:32,maxRequestBytes:65536,maxDurationMs:120000};
const invalid=message=>proofError('invalid_plan',message,['correct_parameters']);
export function validateAgentPlan(plan,schema){
 fields(plan,['format','start','phases','maxDurationMs'],'plan');
 if(plan.format!=='athanor-agent-plan/v1'||!Array.isArray(plan.phases)||!plan.phases.length||plan.phases.length>planLimits.maxPhases||Buffer.byteLength(JSON.stringify(plan))>planLimits.maxRequestBytes)throw invalid('Use athanor-agent-plan/v1 with 1–8 phases within 64 KiB');
 if(plan.maxDurationMs!==undefined&&(!Number.isInteger(plan.maxDurationMs)||plan.maxDurationMs<1||plan.maxDurationMs>planLimits.maxDurationMs))throw invalid('maxDurationMs must be 1–120000');
 const phases=new Map();let count=0;
 for(const phase of plan.phases){
  fields(phase,['id','steps','next'],'phase');
  if(typeof phase.id!=='string'||! /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(phase.id)||phases.has(phase.id))throw invalid('Supply distinct phase IDs of 1–64 letters, digits, underscores or hyphens');
  validateSequence(phase.steps,schema);count+=phase.steps.length;phases.set(phase.id,phase);
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
 visit(plan.start);if(visited.size!==phases.size)throw invalid('Every phase must be reachable from start');
 return phases;
}
export async function checkAgentPlan(file,plan){
 validateAgentPlan(plan,(await readJSON(file)).schema);
 return {format:'athanor-agent-plan-check/v1',status:'Valid',executed:false,validation:'all-paths-parameters-schema-and-acyclic-graph',limits:planLimits,maxDurationMs:plan.maxDurationMs??planLimits.maxDurationMs,phases:plan.phases.map(p=>({id:p.id,steps:p.steps.length,next:p.next,...sequenceAdvice(p.steps)}))};
}
// Branches require complete snapshots. Delta views and partial pages cannot prove an alternate path.
function requireComplete(value){
 if(value===null||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(/(?:truncated|incomplete)$/i.test(key)&&item!==false&&item!==null&&item!==undefined||['hasMore','partial'].includes(key)&&item===true||['complete','inspectionComplete'].includes(key)&&item===false||key==='completion'&&item!=='complete'||key==='offset'&&Object.hasOwn(value,'model')&&item!==0||key==='encoding'&&item==='delta'||['next_cursor','nextCursor'].includes(key)&&item!==null&&item!==undefined)throw proofError('incomplete_branch_observation','A branch requires a full, untruncated readback',['observe']);
  requireComplete(item);
 }
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
export async function runAgentPlan(file,plan,execute=agentTool,{compact=false}={}){
 const session=await readJSON(file),phases=validateAgentPlan(plan,session.schema);
 if(typeof compact!=='boolean')throw invalid('compact must be boolean');
 verifyDesktopPaths(session);const directory=await mkdtemp(path.join(session.root,'plan-')),progress=path.join(directory,'progress.json'),started=performance.now();
 const state={format:'athanor-agent-plan/v1',status:'Running',session:file,build:{packageHash:session.guiHash},process:{pid:session.pid,started:session.processStart,generation:session.generation},plan,phases:[],activePhase:null,startedAt:new Date().toISOString()};
 const budget=()=>{if(performance.now()-started>= (plan.maxDurationMs??planLimits.maxDurationMs))throw proofError('plan_budget_exceeded','Plan dispatch budget expired; inspect returned steps before further work',['inspect']);};
 const retain=async()=>writeJSON(progress,state);
 let next=plan.start;
 try{
  while(next!==null){
   budget();const phase=phases.get(next);state.activePhase=next;await retain();
   const result=await agentSequence(file,phase.steps,async(...args)=>{budget();return execute(...args);});
   const record={id:phase.id,result};state.phases.push(record);state.activePhase=null;
   if(result.status!=='Completed'){state.status=result.status;state.failure={phase:phase.id,...result.failure};state.continuation=result.summary.continuation;break;}
   budget();
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
 const summary={phases:state.phases.map(p=>({id:p.id,status:p.result.status,summary:p.result.summary,branch:p.branch,next:p.next})),activePhase:state.activePhase,continuation:state.continuation};
 try{
  await retain();const retained=path.join(directory,'receipt.json');await writeJSON(retained,{...state,summary});const receipt={path:retained,sha256:await sha(retained)};
  if(!compact)return {...state,summary,progress,receipt};
  return {format:state.format,status:state.status,failure:state.failure,durationMs:state.durationMs,encoding:'compact',summary,progress,receipt};
 }catch(error){return {...state,summary:{...summary,continuation:{state:'retain_receipt',automatic:false,nextActions:['retain_full_response','inspect_storage']}},progress,retentionError:{code:'receipt_retention_failed',error:error.message}};}
}
