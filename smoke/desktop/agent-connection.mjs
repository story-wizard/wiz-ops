import {performance} from 'node:perf_hooks';
import {agentTool,compareObservation,isAgentMutation} from './agent-tools.mjs';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {verifyDesktopPaths} from './adapter.mjs';
import {fields,validateToolParams,validateApplicationParams,validateNativeParams,normalizeToolError,proofError} from './agent-proof.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';

const maxBytes=65536;
const decisionFields=['status','question','matched','state','reason','ready','name','expected','actual','targets','focus','identity','revision','generation','observedAt','complete','completion','inspectionComplete','inspectionIncomplete','truncated','hasMore','partial','next_cursor','nextCursor'];
const taskFields=['format','status','executed','recipes','recipeId','requestId','plan','values','run','runRequest','inspect','recipeHash','valuesHash','timing','fixture','reviewPlan','review'];
// Keep whole values: a shortened list must never look like a complete observation.
export function resultPreview(result,budget=1024){
 if(Buffer.byteLength(JSON.stringify(result))<=budget)return {encoding:'full',result};
 if(result===null||typeof result!=='object'||Array.isArray(result))return {encoding:'summary',summary:{},omitted:[{field:null,bytes:Buffer.byteLength(JSON.stringify(result))}],completeResult:false};
 const summary=Object.create(null),omitted=[];let used=0;
 const entries=[...decisionFields.filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]]),...Object.entries(result).filter(([k])=>!decisionFields.includes(k))];
 for(const [key,value] of entries.slice(0,32)){
  const bytes=Buffer.byteLength(JSON.stringify({[key]:value}));
  if(used+bytes<=budget){summary[key]=value;used+=bytes;}
  else omitted.push({field:key.slice(0,160),bytes,...Array.isArray(value)?{items:value.length}:{}});
 }
 return {encoding:'summary',summary,omitted,...entries.length>32?{additionalFields:entries.length-32}:{},completeResult:false};
}
export function operationCategory(operation,params={}){
 if(operation==='capture'||operation==='physical'&&params.command==='screenshot')return 'capture';
 if(operation==='wait')return 'wait';
 if(operation==='physical')return 'physicalInput';
 if(['observe','find','model','model_value','geometry','preflight','query'].includes(operation))return 'observation';
 if(operation==='call')return isAgentMutation(operation,params)?'applicationEdit':'applicationRead';
 if(operation==='native')return isAgentMutation(operation,params)?'qtEdit':'qtRead';
 if(operation==='verify')return 'verification';
 return 'other';
}
export async function compactToolResult(file,operation,result){
 if(Buffer.byteLength(JSON.stringify(result))<=2048)return {encoding:'full',result};
 try{const session=await readJSON(file);verifyDesktopPaths(session);const directory=await mkdtemp(path.join(session.root,'tool-reply-')),retained=path.join(directory,'receipt.json');await writeJSON(retained,{operation,result,session:file,build:{packageHash:session.guiHash},process:{pid:session.pid,started:session.processStart,generation:session.generation}});
  let preview=resultPreview(result);
  if(operation==='task'&&result.format==='athanor-agent-task/v1'){
   // Known procedures need their complete review and commands, not a second discovery turn.
   const selected=Object.fromEntries(taskFields.filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]])),view=resultPreview(selected,16384);
   preview={summary:view.result??view.summary,omitted:[...(view.omitted||[]),...Object.entries(result).filter(([k])=>!taskFields.includes(k)).map(([field,value])=>({field,bytes:Buffer.byteLength(JSON.stringify(value))}))],completeResult:false};
  }
  return {...preview,encoding:'compact',receipt:{path:retained,sha256:await sha(retained)},review:'Use the returned exact fields. Read omitted values from the receipt when needed; this summary cannot establish completeness of the full result.'};
 }catch(error){return {encoding:'full',result,retentionError:{code:'receipt_retention_failed',error:error.message}};}
}
export function toolError(error){
 const e=normalizeToolError(error);
 return {status:e.status,code:e.code,origin:e.origin,error:e.message,nextActions:e.nextActions,diagnostics:e.diagnostics||null,evidence:e.evidence||null};
}
export function validateSequence(steps,schema){
 if(!Array.isArray(steps)||steps.length<1||steps.length>8||Buffer.byteLength(JSON.stringify(steps))>maxBytes)throw proofError('invalid_sequence','Use 1–8 steps within 64 KiB',['correct_parameters']);
 for(const [index,step] of steps.entries()){
  try{
  fields(step,['operation','params','expect'],'step');validateToolParams(step.operation,step.params===undefined?{}:step.params);
  if(step.operation==='call')validateApplicationParams(schema,step.params?.operation,step.params?.params||{});
  if(step.operation==='native')validateNativeParams(step.params?.operation,step.params?.params||{});
  if(step.params?.read)validateApplicationParams(schema,step.params.read.operation,step.params.read.params||{});
  if(step.params?.commit)validateApplicationParams(schema,'spellbook.inspect',{document_id:step.params.commit.documentId,view:'raw'});
  if(step.expect!==undefined){fields(step.expect,['path','equals','notEquals','length','includes'],'expect');compareObservation({},step.expect);}
  }catch(error){error.diagnostics={...error.diagnostics,step:index,...step?.expect!==undefined?{expectation:{path:'Array of property names or indexes',fields:['path','equals','notEquals','length','includes'],example:{path:['matched'],equals:true}}}:{}};throw error;}
 }
}
export async function checkSequence(file,steps){
 validateSequence(steps,(await readJSON(file)).schema);
 return {format:'athanor-agent-sequence-check/v1',status:'Valid',executed:false,validation:'parameters-and-schema',steps:steps.length,...sequenceAdvice(steps)};
}
export function sequenceAdvice(steps){
 const gateIndexes=steps.flatMap((s,i)=>s.expect===undefined?[]:[i]),mutationIndexes=steps.flatMap((s,i)=>isAgentMutation(s.operation,s.params)?[i]:[]),captureIndexes=steps.flatMap((s,i)=>s.operation==='capture'?[i]:[]),advice=[];
 if(mutationIndexes.length){
  if(!gateIndexes.some(i=>i<mutationIndexes[0]))advice.push({code:'precondition_gate',index:mutationIndexes[0],message:'Add a readback gate before the first dependent edit.'});
  if(!gateIndexes.some(i=>i>mutationIndexes.at(-1)))advice.push({code:'outcome_gate',index:mutationIndexes.at(-1),message:'Read and assert the domain outcome after the last edit.'});
  if(!captureIndexes.some(i=>i>mutationIndexes.at(-1)))advice.push({code:'capture_checkpoint',index:mutationIndexes.at(-1),message:'Retain the declared visual evidence after verification.'});
 }
 if(steps.length>6)advice.push({code:'review_checkpoint',message:'Consider splitting at a decision or new binding; preserve every required assertion and capture.'});
 return {gateIndexes,mutationIndexes,captureIndexes,advice};
}
export function sequenceSummary(steps,receipt){
 const state=receipt.status==='Completed'?'review_checkpoint':receipt.status==='Unknown'?'reconcile_unknown':receipt.status==='Fail'?'inspect_failure':receipt.failure?.code==='input_binding_rejected'?'rebind_target':'inspect_blocker';
 const byCategory={};for(const r of receipt.results){const category=operationCategory(r.operation,steps[r.index].params);byCategory[category]=(byCategory[category]||0)+(r.durationMs||0);}
 return {steps:receipt.results.map(r=>({index:r.index,operation:r.operation,label:String(steps[r.index].params?.title||steps[r.index].params?.operation||r.operation+(steps[r.index].params?.command?' '+steps[r.index].params.command:'')).slice(0,160),status:r.expectation?.matched===false?'Fail':r.status||'Returned',gateMatched:r.expectation?.matched,
  ...(r.expectation?{expectation:resultPreview(r.expectation,512)}:{}),
  ...(r.result!==undefined&&['observation','applicationRead','qtRead','wait','verification'].includes(operationCategory(r.operation,steps[r.index].params))?{observation:resultPreview(r.result)}:{})})),
  timing:{operationMs:byCategory,totalOperationMs:Object.values(byCategory).reduce((a,b)=>a+b,0),scope:'Public operations; includes their guards and retention. Nested Qt/native timings overlap and must not be added.'},
  returnedMutationIndexes:receipt.results.filter(r=>r.result!==undefined&&isAgentMutation(r.operation,steps[r.index].params)).map(r=>r.index),
  uncertainStep:receipt.status==='Unknown'?receipt.stoppedAt:null,
  evidence:receipt.results.filter(r=>['capture','evidence','verify'].includes(r.operation)&&r.result?.path&&r.result?.sha256).map(r=>({index:r.index,...Object.fromEntries(['path','sha256','kind','assertion','caption','recordedAt','identity','revision','generation','method','target'].filter(k=>r.result[k]!==undefined).map(k=>[k,r.result[k]])),use:'Review this retained artifact; it describes this checkpoint, not the current screen.'})),
  continuation:{state,automatic:false,nextActions:receipt.failure?.nextActions||['inspect_results'],
   ...(receipt.failure?.diagnostics||receipt.failure?.evidence?{context:resultPreview({diagnostics:receipt.failure.diagnostics,evidence:receipt.failure.evidence})}:{})}};
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
 fields(request,['id','operation','params','steps','plan','compact'],'request');
 if(typeof request.id!=='string'||!request.id.length||request.id.length>128)throw proofError('invalid_request_id','Supply a request ID of 1–128 characters',['correct_parameters']);
 if(request.plan!==undefined){
  if(request.operation!==undefined||request.params!==undefined||request.steps!==undefined)throw proofError('invalid_plan','Use a plan, steps or an operation, not a combination',['correct_parameters']);
  const {runAgentPlan}=await import('./agent-plan.mjs');
  return {id:request.id,...await runAgentPlan(file,request.plan,undefined,{compact:request.compact===undefined?false:request.compact,requestId:request.id})};
 }
 if(request.steps!==undefined){
  if(request.operation!==undefined||request.params!==undefined)throw proofError('invalid_sequence','Use steps or an operation, not both',['correct_parameters']);
  return {id:request.id,...await agentSequence(file,request.steps,undefined,{compact:request.compact===undefined?false:request.compact})};
 }
 if(request.compact!==undefined&&typeof request.compact!=='boolean')throw proofError('invalid_sequence','compact must be boolean',['correct_parameters']);
 if(request.operation==='plan-inspect'){
  fields(request.params,['requestId'],'params');const {inspectAgentPlan}=await import('./agent-plan.mjs');return {id:request.id,...await inspectAgentPlan(file,request.params.requestId)};
 }
 if(request.operation==='plan-run'){
  fields(request.params,['plan'],'params');const {runRetainedAgentPlan}=await import('./agent-plan.mjs');return {id:request.id,...await runRetainedAgentPlan(file,request.params.plan,undefined,{compact:request.compact===undefined?false:request.compact,requestId:request.id})};
 }
 if(request.operation==='recipe-check'){
  fields(request.params,['recipe','values'],'params');const {checkAgentRecipe}=await import('./agent-recipes.mjs');return {id:request.id,...await checkAgentRecipe(file,request.params.recipe,request.params.values)};
 }
 if(request.operation==='workflow-check'){
  fields(request.params,['workflow'],'params');const {checkAgentWorkflow}=await import('./agent-recipes.mjs');return {id:request.id,...await checkAgentWorkflow(file,request.params.workflow)};
 }
 const started=performance.now();
 const result=await agentTool(file,request.operation,request.params===undefined?{}:request.params);
 return {format:'athanor-agent-tool/v1',id:request.id,operation:request.operation,...request.compact?await compactToolResult(file,request.operation,result):{result},durationMs:performance.now()-started};
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
