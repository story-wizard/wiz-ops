import {performance} from 'node:perf_hooks';
import {agentTool,compareObservation} from './agent-tools.mjs';
import {fields,validateToolParams,validateApplicationParams,validateNativeParams,normalizeToolError,proofError} from './agent-proof.mjs';
import {readJSON} from '../runner/files.mjs';

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
// Every step enters the ordinary tool boundary separately. No target or lock is reserved between steps.
export async function agentSequence(file,steps,execute=agentTool){
 validateSequence(steps,(await readJSON(file)).schema);
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
   return {format:'athanor-agent-sequence/v1',status:failure.status,completed:results.filter(r=>r.result!==undefined).length,stoppedAt:index,remaining:steps.length-index-1,results,failure,durationMs:performance.now()-started};
  }
 }
 return {format:'athanor-agent-sequence/v1',status:'Completed',completed:steps.length,remaining:0,results,durationMs:performance.now()-started};
}
export async function toolRequest(file,request){
 fields(request,['id','operation','params','steps'],'request');
 if(typeof request.id!=='string'||!request.id.length||request.id.length>128)throw proofError('invalid_request_id','Supply a request ID of 1–128 characters',['correct_parameters']);
 if(request.steps!==undefined){
  if(request.operation!==undefined||request.params!==undefined)throw proofError('invalid_sequence','Use steps or an operation, not both',['correct_parameters']);
  return {id:request.id,...await agentSequence(file,request.steps)};
 }
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
