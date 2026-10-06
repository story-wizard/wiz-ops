import {performance} from 'node:perf_hooks';
import {agentTool,compareObservation,isAgentMutation} from './agent-tools.mjs';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {verifyDesktopPaths} from './adapter.mjs';
import {fields,validateToolParams,validateApplicationParams,validateNativeParams,normalizeToolError,proofError} from './agent-proof.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';

const maxBytes=65536;
export function toolError(error){
 const e=normalizeToolError(error);
 return {status:e.status,code:e.code,origin:e.origin,error:e.message,nextActions:e.nextActions,diagnostics:e.diagnostics||null,evidence:e.evidence||null};
}
export function validateSequence(steps,schema){
 if(!Array.isArray(steps)||steps.length<1||steps.length>8||Buffer.byteLength(JSON.stringify(steps))>maxBytes)throw proofError('invalid_sequence','Use 1–8 steps within 64 KiB',['correct_parameters']);
 for(const step of steps){
  fields(step,['operation','params','expect'],'step');validateToolParams(step.operation,step.params===undefined?{}:step.params);
  if(step.operation==='call')validateApplicationParams(schema,step.params?.operation,step.params?.params||{});
  if(step.operation==='native')validateNativeParams(step.params?.operation,step.params?.params||{});
  if(step.params?.read)validateApplicationParams(schema,step.params.read.operation,step.params.read.params||{});
  if(step.expect!==undefined){fields(step.expect,['path','equals','notEquals','length','includes'],'expect');compareObservation({},step.expect);}
 }
}
export async function checkSequence(file,steps){
 validateSequence(steps,(await readJSON(file)).schema);
 return {format:'athanor-agent-sequence-check/v1',status:'Valid',executed:false,validation:'parameters-and-schema',steps:steps.length,gateIndexes:steps.flatMap((s,i)=>s.expect===undefined?[]:[i])};
}
export function sequenceSummary(steps,receipt){
 const state=receipt.status==='Completed'?'review_checkpoint':receipt.status==='Unknown'?'reconcile_unknown':receipt.status==='Fail'?'inspect_failure':receipt.failure?.code==='input_binding_rejected'?'rebind_target':'inspect_blocker';
 return {steps:receipt.results.map(r=>({index:r.index,operation:r.operation,label:String(steps[r.index].params?.title||steps[r.index].params?.operation||r.operation+(steps[r.index].params?.command?' '+steps[r.index].params.command:'')).slice(0,160),status:r.expectation?.matched===false?'Fail':r.status||'Returned',gateMatched:r.expectation?.matched})),
  returnedMutationIndexes:receipt.results.filter(r=>r.result!==undefined&&isAgentMutation(r.operation,steps[r.index].params)).map(r=>r.index),
  uncertainStep:receipt.status==='Unknown'?receipt.stoppedAt:null,
  evidence:receipt.results.filter(r=>['capture','evidence','verify'].includes(r.operation)&&r.result?.path&&r.result?.sha256).map(r=>({index:r.index,path:r.result.path,sha256:r.result.sha256,kind:r.result.kind,assertion:r.result.assertion})),
  continuation:{state,automatic:false,nextActions:receipt.failure?.nextActions||['inspect_results']}};
}
// Every step enters the ordinary tool boundary separately. No target or lock is reserved between steps.
export async function agentSequence(file,steps,execute=agentTool,{compact=false}={}){
 const session=await readJSON(file);validateSequence(steps,session.schema);
 if(typeof compact!=='boolean')throw proofError('invalid_sequence','compact must be boolean',['correct_parameters']);
 let directory;
 if(compact){verifyDesktopPaths(session);directory=await mkdtemp(path.join(session.root,'sequence-'));}
 const finish=async receipt=>{
  const summary=sequenceSummary(steps,receipt),full={...receipt,summary};if(!compact)return full;
  try{const retained=path.join(directory,'receipt.json');await writeJSON(retained,{...full,session:file,build:{packageHash:session.guiHash},process:{pid:session.pid,started:session.processStart,generation:session.generation},steps});const {results,failure,...brief}=full;return {...brief,...failure?{failure:Object.fromEntries(['index','operation','status','code','origin','error','nextActions'].map(k=>[k,failure[k]]))}:{},encoding:'compact',receipt:{path:retained,sha256:await sha(retained)}};}
  catch(error){return {...full,retentionError:{code:'receipt_retention_failed',error:error.message},summary:{...summary,continuation:{state:'retain_receipt',automatic:false,nextActions:['retain_full_response','inspect_storage']}}};}
 };
 const started=performance.now(),results=[];
 for(const [index,step] of steps.entries()){
  const at=performance.now();let result;
  try{
   result=await execute(file,step.operation,step.params===undefined?{}:step.params);
   results.push({index,operation:step.operation,result,durationMs:performance.now()-at});
   if(step.expect!==undefined){const comparison=compareObservation(result,step.expect);results.at(-1).expectation=comparison;if(!comparison.matched)throw proofError('sequence_expectation_failed','Step '+index+' did not match its expected result',['inspect'],'Fail');}
  }catch(error){
   const failure={index,operation:step.operation,...toolError(error)};
   if(result===undefined)results.push({...failure,durationMs:performance.now()-at});
   return finish({format:'athanor-agent-sequence/v1',status:failure.status,completed:results.filter(r=>r.result!==undefined).length,stoppedAt:index,remaining:steps.length-index-1,results,failure,durationMs:performance.now()-started});
  }
 }
 return finish({format:'athanor-agent-sequence/v1',status:'Completed',completed:steps.length,remaining:0,results,durationMs:performance.now()-started});
}
export async function toolRequest(file,request){
 fields(request,['id','operation','params','steps','compact'],'request');
 if(typeof request.id!=='string'||!request.id.length||request.id.length>128)throw proofError('invalid_request_id','Supply a request ID of 1–128 characters',['correct_parameters']);
 if(request.steps!==undefined){
  if(request.operation!==undefined||request.params!==undefined)throw proofError('invalid_sequence','Use steps or an operation, not both',['correct_parameters']);
  return {id:request.id,...await agentSequence(file,request.steps,undefined,{compact:request.compact===undefined?false:request.compact})};
 }
 if(request.compact!==undefined)throw proofError('invalid_sequence','compact is only available for steps',['correct_parameters']);
 const started=performance.now();
 return {format:'athanor-agent-tool/v1',id:request.id,operation:request.operation,result:await agentTool(file,request.operation,request.params===undefined?{}:request.params),durationMs:performance.now()-started};
}
export async function serveAgentTools(file,input=process.stdin,output=process.stdout){
 let pending=Buffer.alloc(0),oversized=false;
 const reply=async line=>{
  let request;
  try{request=JSON.parse(line);output.write(JSON.stringify(await toolRequest(file,request))+'\n');}
  catch(error){output.write(JSON.stringify({format:'athanor-agent-tool/v1',id:typeof request?.id==='string'?request.id:null,...toolError(error)})+'\n');}
 };
 for await(const chunk of input){
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
  for(let i=0;i<=bytes.length;i++)if(i===bytes.length||bytes[i]===10){
   const part=bytes.subarray(start,i);start=i+1;
   if(!oversized){if(pending.length+part.length>maxBytes){pending=Buffer.alloc(0);oversized=true;}else pending=Buffer.concat([pending,part]);}
   if(i<bytes.length){
    if(oversized)output.write(JSON.stringify({format:'athanor-agent-tool/v1',id:null,...toolError(proofError('request_too_large','Request exceeds 64 KiB',['correct_parameters']))})+'\n');
    else if(pending.length)await reply(pending.toString('utf8'));
    pending=Buffer.alloc(0);oversized=false;
   }
  }
 }
 if(oversized)output.write(JSON.stringify({format:'athanor-agent-tool/v1',id:null,...toolError(proofError('request_too_large','Request exceeds 64 KiB',['correct_parameters']))})+'\n');
 else if(pending.length)await reply(pending.toString('utf8'));
}
