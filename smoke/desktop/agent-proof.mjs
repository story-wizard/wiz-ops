import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {open,unlink,readFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {readJSON,writeJSON,digest} from '../runner/files.mjs';
import {clips,snapshotState} from '../runner/engine.mjs';
import {verifyTrimmedClip,requireExactTimingFixture} from './check-support.mjs';
import {editorCheckpoint} from './editor-proof.mjs';
import {volumeContract} from './volume-contract.mjs';
import {volumeCheckpoint} from './volume-agent-proof.mjs';

const actionContext=new AsyncLocalStorage();
export function proofError(code,message,nextActions=['observe','report'],status='Blocked'){
 return Object.assign(Error(message),{code,status,nextActions,origin:status==='Fail'?'assertion':'harness'});
}
export function normalizeToolError(error){
 if(error.origin)return error;
 error.code=error.code||(error instanceof SyntaxError?'invalid_json':error.status==='Unknown'?'mutation_unknown':'tool_failed');error.origin='harness';error.nextActions=error.status==='Unknown'?['observe','verify_resolution','resolve']:['inspect','correct_parameters'];if(error.status!=='Unknown')error.status='Blocked';return error;
}
export function requireProof(value,code,message,nextActions){if(!value)throw proofError(code,message,nextActions);}
export function fields(value,allowed,label='parameters'){
 requireProof(value&&typeof value==='object'&&!Array.isArray(value),'invalid_params','Supply an object for '+label,['correct_parameters']);
 const unknown=Object.keys(value).filter(k=>!allowed.includes(k));
 requireProof(!unknown.length,'unknown_parameter','Unknown '+label+' field: '+unknown.join(', '),['correct_parameters']);
}
const selectors=['id','class','name','text','tooltip','title','window','parent','enabled','active','focused','editableText','keyWindow','accessibleName','accessibleDescription','contains'];
const toolFields={context:[],report:[],preflight:[],schema:['operation'],observe:['selector','selectors','kind','limit','details','scope','since'],find:['selector','kind','scope'],model:['target','selector','offset','limit','cursor'],model_value:['target','selector','offset','column','role','cursor'],reveal:['target','selector','offset','cursor'],geometry:['target','selector','clipId','part'],
 physical:['command','target','selector','toTarget','x','y','toX','toY','xRatio','yRatio','toXRatio','toYRatio','button','durationMs','chrome','key','text','deltaX','deltaY','clipId','part','actionId','modifiers','path','clickCount'],
 call:['operation','params'],native:['operation','params'],wait:['selector','kind','scope','condition','expected','timeoutMs','intervalMs','stableForMs'],capture:['target','selector','kind','assertion'],recording:['target','timelineTarget','timelineId','durationMs','intervalMs','maxSamples'],evidence:['file','kind'],
 begin:['id','mode'],verify:['assertion','target','read','selector','kind','expect','fixture'],resolve:['actionId','verification','note'],record:['status','note']};
export function validateToolParams(operation,params){
 requireProof(Object.hasOwn(toolFields,operation),'unknown_tool','Unknown agent tool: '+operation,['context']);
 fields(params,[...toolFields[operation],'title','stepId']);
 if(operation==='observe')observationSelectors(params);
 if(operation==='wait'){
  requireProof(['exists','absent','enabled','value','text','checked','focused','keyWindow','geometry'].includes(params.condition||'exists'),'invalid_wait','Choose an advertised readiness condition',['context']);
  if(['value','text','checked'].includes(params.condition))requireProof(Object.hasOwn(params,'expected')&&params.expected!==undefined,'invalid_wait','Supply the expected value for this wait condition',['correct_parameters']);
  for(const [key,min,max] of [['timeoutMs',1,60000],['intervalMs',1,10000],['stableForMs',0,2000]])if(params[key]!==undefined)requireProof(Number.isInteger(params[key])&&params[key]>=min&&params[key]<=max,'invalid_wait','Use bounded integer wait options',['correct_parameters']);
  requireProof((params.stableForMs??(params.condition==='geometry'?250:0))<=(params.timeoutMs??5000),'invalid_wait','The stable interval must fit within the wait deadline',['correct_parameters']);
 }
 for(const k of ['selector','target','toTarget'])if(params[k]!==undefined){requireProof(typeof params[k]==='string'||params[k]&&typeof params[k]==='object','invalid_params','Supply an observed target',['correct_parameters']);if(typeof params[k]!=='string')fields(params[k],selectors,k);}
 if(params.read!==undefined)fields(params.read,['operation','params'],'read');
 if(params.expect!==undefined)fields(params.expect,['path','equals','notEquals','length','includes'],'expect');
 if(params.fixture!==undefined)fields(params.fixture,['destinationTimelineId'],'fixture');
 if(operation==='model'||operation==='reveal'||operation==='model_value')validateModelPage(params);
 if(operation==='model_value')validateModelValue(params);
 if(params.scope!==undefined)requireProof(typeof params.scope==='string'&&params.scope.length>0,'invalid_scope','Supply the ID of an observed scope',['observe']);
}
export function observationSelectors(params){
 if(params.selectors===undefined){const selector=params.selector??{};fields(selector,selectors,'selector');return [selector];}
 requireProof(params.selector===undefined&&Array.isArray(params.selectors)&&params.selectors.length>=1&&params.selectors.length<=8,'invalid_params','Use one selector or a bundle of 1–8 selectors',['correct_parameters']);
 for(const selector of params.selectors){fields(selector,selectors,'selector');requireProof(Object.keys(selector).some(k=>k!=='contains'),'invalid_params','Each bundled selector must identify a control',['correct_parameters']);}
 return params.selectors;
}
export function validateModelValue(params){requireProof(Number.isInteger(params.column)&&params.column>=0&&params.column<=63&&Number.isInteger(params.role)&&params.role>=0&&params.role<=1280,'invalid_model_value','Use a bounded column and Qt role',['model']);}
export function validateModelPage(params){
 const offset=params.offset===undefined?0:params.offset,limit=params.limit===undefined?32:params.limit;
 requireProof(Number.isInteger(offset)&&offset>=0&&offset<=2147483647&&Number.isInteger(limit)&&limit>=1&&limit<=64,'invalid_model_page','Use an integer offset from 0 to 2147483647 and a limit from 1 to 64',['correct_parameters']);
 if(params.cursor!==undefined){const c=params.cursor;fields(c,['modelIdentity','revision','root'],'cursor');requireProof(typeof c.modelIdentity==='string'&&c.modelIdentity.length>0&&Number.isSafeInteger(c.revision)&&c.revision>=0&&Array.isArray(c.root)&&c.root.length<=32&&c.root.every(r=>Number.isInteger(r)&&r>=0),'invalid_model_cursor','Use the cursor returned by the first page',['restart_model_inspection']);}
}
const nativeFields={'bug-report-prefill':['target','summary','reproduction_steps','expected_result'],capabilities:[],inspect:['target'],'model-page':['target','offset','limit','cursor'],'model-value':['target','offset','column','role','cursor'],'model-reveal':['target','offset','limit','cursor'],quit:['target'],'clipboard-save':[],'clipboard-mark':[],'clipboard-restore':[],screenshot:['target'],'snapshot-widget':['target'],'snapshot-presented':['target'],'snapshot-node-preview':['target','label'],
 'timeline-clip-rect':['target','clipId'],'item-click':['target','row','text','double','context'],'context-click':['target','x','y'],'drop-model-item':['target','source','text','x','y'],drag:['target','x','y','toX','toY'],
 'close-window':['target'],'resize-window':['target','width','height'],activate:['target'],action:['target'],click:['target','x','y','double'],'type-text':['target','text'],text:['target','text'],key:['target','key'],'spellbook-run-local':['target','documentId'],select:['target','index']};
export function validateNativeParams(op,params){requireProof(Object.hasOwn(nativeFields,op),'unsupported_native_operation','Unsupported native operation: '+op,['capabilities']);fields(params,nativeFields[op],op);if(['model-page','model-reveal','model-value'].includes(op))validateModelPage(params);if(op==='model-value')validateModelValue(params);if(op==='resize-window')requireProof(['width','height'].every(k=>Number.isInteger(params[k])&&params[k]>=200&&params[k]<=4096),'invalid_window_size','Use observed-window dimensions from 200 to 4096 points',['observe']);}
// Use the shipped schema for field admission; the app remains the authority for values.
export function validateApplicationParams(schema,operation,params){
 const definition=schema?.operations?.[operation];requireProof(definition,'unsupported_operation','The selected build does not expose '+operation,['schema','prepare_supported_build']);
 function inspect(value,spec,label){
  if(!spec||value===null||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)inspect(item,spec.items,label+'[]');return;}
  const alternatives=spec.oneOf||spec.anyOf;
  if(alternatives){const failures=[];for(const alternative of alternatives){try{inspect(value,{...spec,oneOf:undefined,anyOf:undefined,...alternative,properties:{...spec.properties,...alternative.properties}},label);return;}catch(e){failures.push(e);}}throw failures[0];}
  requireProof(!spec.$ref,'unsupported_parameter_schema','Resolve the parameter schema reference before using '+operation,['review_schema']);
  const properties=spec.properties||{};
  if(spec.additionalProperties===false)fields(value,Object.keys(properties),label);
  for(const [k,v] of Object.entries(value))inspect(v,properties[k]||(typeof spec.additionalProperties==='object'?spec.additionalProperties:null),label+'.'+k);
 }
 fields(params,Object.keys(definition.properties||{}).filter(k=>k!=='bundle'),operation);inspect(params,definition,operation);
}

export function currentAction(file){const context=actionContext.getStore();return context?.file===file?context:null;}
export async function withAgentAction(file,fn,{raw=false,operation,params,purpose}={}){
 if(currentAction(file))return fn();
 const s=await readJSON(file),lock=path.join(s.root,'agent-action.lock');let held;
 try{held=await open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw proofError('action_in_progress','Another agent command is in progress; wait for its receipt',['wait_for_receipt']);throw e;}
 try{return await actionContext.run({file,id:randomUUID(),raw,operation,params,purpose},async()=>{try{return await fn();}catch(e){if(purpose==='shutdown'&&e.status==='Unknown')await markUnknown(file,e);throw e;}});}finally{await held.close();await unlink(lock);}
}
export async function withAdapterAction(file,mutating,operation,params,fn){
 const s=await readJSON(file),run=async()=>{
  const latest=await readJSON(file);
  if(mutating&&latest.agentUncertain&&!latest.resolving)requireProof(currentAction(file)?.purpose==='shutdown','mutation_unknown','An earlier mutation has an unknown outcome; inspect and resolve it before another edit',['observe','verify_resolution','resolve']);
  if(latest.agentTracking&&mutating)requireProof(!terminalResult(await jsonLines(path.join(latest.root,'agent-results.jsonl')),latest.agentAttempt)||currentAction(file)?.purpose==='shutdown'&&operation==='quit','attempt_closed','Begin a new attempt before another edit',['begin_new_attempt','report']);
  try{return await fn();}catch(e){if(mutating&&e.status==='Unknown'&&!(await readJSON(file)).agentUncertain)await markUnknown(file,e);throw latest.agentTracking?normalizeToolError(e):e;}
 };
 return s.agentTracking&&mutating&&!currentAction(file)?withAgentAction(file,run,{raw:true,operation,params}):run();
}
export async function markUnknown(file,error){
 const s=await readJSON(file);if(s.agentUncertain)return;
 const action=currentAction(file)||s.agentLastMutation||{id:randomUUID(),operation:'unqualified mutation'};
 const previous=s.agentUnknown?.id;s.agentUncertain=true;s.agentUnknown={id:action.id,caseId:s.currentCheck,attempt:s.agentAttempt,operation:action.operation,params:action.params,purpose:action.purpose||null,revision:s.agentRevision,generation:s.generation,error:error.message,at:new Date().toISOString()};
 if(s.agentProof?.baseline)s.agentProof.tainted=true;await writeJSON(file,s);if(previous!==action.id)await appendFile(path.join(s.root,'agent-uncertainty.jsonl'),JSON.stringify(s.agentUnknown)+'\n');
}
export async function jsonLines(file){try{return (await readFile(file,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}}
export function terminalResult(results,attempt){
 const found=results.filter(r=>r.attempt===attempt);
 requireProof(found.length<=1,'conflicting_attempt_history','This attempt has multiple terminal records; preserve and review it',['report','begin_new_attempt']);return found[0]||null;
}
export function closeAttempt(results,result){
 const previous=terminalResult(results,result.attempt);
 if(previous){requireProof(previous.status===result.status&&previous.observation===result.observation,'attempt_closed','This attempt is already '+previous.status+'; retest in a new attempt',['begin_new_attempt','report']);return previous;}return result;
}
export function proofContract(definition){
 const contract=volumeContract(definition);if(!contract)return null;
 requireProof(contract.version===1&&['physical','hybrid'].includes(contract.mode)&&Array.isArray(contract.checkpoints)&&contract.checkpoints.length,'invalid_proof_contract','This definition has an unsupported proof contract',['review_definition']);
 return structuredClone(contract);
}
export function beginProof(definition,mode){
 const contract=proofContract(definition),required=contract?.mode||(definition.id.startsWith('P-')?'physical':'hybrid');
 requireProof(!(required==='physical'&&mode==='hybrid'),'required_physical_mode','This definition requires physical input',['begin_physical_attempt']);
 return {definition:structuredClone(definition),definitionHash:digest(definition),contract,mode:required==='physical'?'physical':mode||required,actions:[],checkpoints:{},baseline:null,tainted:false};
}
const matches=(actual,expected)=>Object.entries(expected).every(([k,v])=>actual?.[k]===v);
export function physicalAction(proof,params,target){
 if(!params.actionId)return null;
 requireProof(proof?.baseline&&proof.contract,'proof_baseline_required','Verify the declared baseline before the tested action',['verify_baseline']);
 const spec=proof.contract.actions.find(a=>a.id===params.actionId);
 requireProof(spec,'unknown_test_action','Choose an action from the frozen definition',['context']);
 const point=proof.contract.checkpoints.find(p=>p.id===spec.checkpoint),index=proof.contract.checkpoints.indexOf(point);
 for(const prior of proof.contract.checkpoints.slice(0,index))requireProof(proof.checkpoints[prior.id]?.capture,'previous_checkpoint_missing','Verify and capture '+prior.id+' before '+spec.id,['verify','capture']);
 requireProof(!proof.checkpoints[point.id]?.capture,'checkpoint_closed','This checkpoint is already captured',['next_declared_action']);
 const done=proof.actions.filter(a=>a.checkpoint===point.id&&!a.optional),expected=point.actions[done.length];
 requireProof(spec.optional&&expected===undefined&&!proof.actions.some(a=>a.id===spec.id)||expected===spec.id,'wrong_test_action','Next required action is '+expected,['perform_declared_action']);
 requireProof(params.command===spec.command&&(!spec.key||params.key===spec.key)&&matches(target,spec.target),'wrong_action_target','The physical command/target differs from the frozen action',['find','perform_declared_action']);
 if(spec.text!==undefined)requireProof(params.text===(spec.text==='@missing'?proof.binding.missing:spec.text),'wrong_test_action','Type the query declared by this check',['context']);
 requireProof(params.stepId===undefined||params.stepId===spec.stepId,'wrong_test_step','Use the step declared for this action',['context']);
 requireProof(spec.dialog||target.window===proof.binding.window,'wrong_action_target','Use the baseline editor window',['find']);
 requireProof((params.button||'left')===(spec.button||'left'),'wrong_action_target','Use the declared pointer button',['correct_parameters']);
 requireProof((params.clickCount||1)===(spec.clickCount||1)&&isDeepStrictEqual(params.modifiers||[],spec.modifiers||[]),'wrong_action_target','Use the declared click count and held modifiers',['context']);
 const bound=spec.surface==='search'?proof.binding.search:spec.surface==='media'?proof.binding.media:spec.surface==='bin'?proof.binding.binViewport:spec.surface==='viewport'?proof.binding.viewport:spec.surface==='view'?proof.binding.target:null;
 if(bound)requireProof(target.id===bound,'wrong_action_target','Use the frozen editor surface',['find']);
 const points=proof.binding.points?.[spec.id];if(points)requireProof(Object.entries(points).every(([k,v])=>Number.isFinite(params[k])&&Math.abs(params[k]-v)<1),'wrong_action_target','Use the frozen node, port or media-row geometry',['find']);
 if(target.class==='TimelineWidget')requireProof(target.id===(spec.timeline==='destination'?proof.binding.destinationTarget:proof.binding.target),'wrong_action_target','Use the timeline bound by this checkpoint',['find']);
 if(spec.part)requireProof(params.part===spec.part&&params.clipId===proof.binding.clipId,'wrong_action_target','Use the frozen clip and '+spec.part,['geometry']);
 if(params.toTarget)requireProof((typeof params.toTarget==='string'?params.toTarget:params.toTarget.id)===(spec.destination==='timeline'?proof.binding.target:target.id),'wrong_action_target','Use the declared drag destination',['geometry']);
 return {...spec,target:{id:target.id,window:target.window,...spec.target},clipId:params.clipId||null,part:params.part||null};
}
export function verifyCheckpoint(proof,assertion,observed,ui,session){
 requireProof(proof?.contract,'proof_contract_missing','This definition is not qualified for toolkit Pass',['review_definition']);
 const checkpoint=proof.contract.checkpoints.find(c=>c.id===assertion);
 requireProof(assertion==='baseline'||checkpoint||['resolve-unchanged','resolve-completed'].includes(assertion),'unknown_assertion','Choose a declared assertion',['context']);
 try{
  if(assertion==='baseline')requireProof(!proof.baseline,'baseline_frozen','The baseline is already frozen',['begin_new_attempt']);
  if(proof.contract.oracle==='volume-v1'){
   requireProof(assertion!=='resolve-completed','resolution_unavailable','Inspect the uncertain action and retain Unknown; begin a fresh volume attempt',['observe','record_unknown']);
   if(!['baseline','resolve-unchanged'].includes(assertion)){
    const point=proof.contract.checkpoints.find(p=>p.id===assertion),done=proof.actions.filter(a=>a.checkpoint===assertion);
    requireProof(point.actions.every((id,i)=>done[i]?.id===id&&done[i].receipt?.status==='Dispatched'),'required_action_missing','Perform each declared action before verification',['context','perform_declared_action']);
   }
   return volumeCheckpoint(proof,assertion,observed,ui,session);
  }
  if(proof.contract.oracle==='editor-v1'){
   if(assertion==='resolve-unchanged')return editorCheckpoint(proof,assertion,observed,ui,session);
   if(assertion==='resolve-completed'){
    const pending=proof.contract.actions.find(a=>a.id===session.agentUnknown?.params?.actionId);
    requireProof(pending,'resolution_unavailable','The uncertain action has no declared outcome',['inspect','record_unknown']);
    return editorCheckpoint(proof,pending.checkpoint,observed,ui,session);
   }
   const point=proof.contract.checkpoints.find(c=>c.id===assertion),done=proof.actions.filter(a=>a.checkpoint===assertion);
   if(assertion!=='baseline')requireProof(point&&point.actions.every((id,i)=>done.filter(a=>!a.optional)[i]?.id===id&&done.filter(a=>!a.optional)[i]?.receipt?.status==='Dispatched'),'required_action_missing','Perform the required checkpoint actions',['perform_declared_action']);
   return editorCheckpoint(proof,assertion,observed,ui,session);
  }
  if(assertion==='baseline'){
   requireProof(!proof.baseline,'baseline_frozen','The baseline is already frozen',['begin_new_attempt']);
   const target=ui.widgets.filter(w=>w.class==='TimelineWidget'&&(!session.proofTarget||w.id===session.proofTarget));requireProof(target.length===1,'ambiguous_timeline','Supply the observed video timeline target for baseline verification',['find']);
   const name=observed.timeline?.name;requireProof(name&&ui.widgets.some(w=>w.name==='panelSubtabSelector'&&w.text?.replace(/ \(\d+\)$/,'')===name),'wrong_fixture','Open the timeline being inspected',['open_fixture']);
   requireProof(observed.timeline&&Array.isArray(observed.tracks)&&observed.tracks.every(t=>Array.isArray(t.items))&&observed.next_cursor==null,'invalid_fixture_observation','Use a complete timeline observation',['inspect']);const items=clips(observed);
   if(proof.definition.id==='P-TRACK-ADD')requireProof(items.length===0&&observed.tracks.length===2&&observed.tracks.some(t=>t.address==='V1')&&observed.tracks.some(t=>t.address==='A1'),'wrong_fixture','Add Track needs the fresh empty two-track timeline',['prepare_fixture']);
   else{requireProof(items.length===1&&items[0].source.asset_id===session.assets.plate&&items[0].timeline_range.start_seconds===0&&items[0].timeline_range.end_seconds===4&&isDeepStrictEqual(observed.timeline.frame_rate,{numerator:24,denominator:1}),'wrong_fixture','Trim needs the four-second Fresh plate clip at 24 fps',['prepare_fixture']);requireExactTimingFixture(observed);}
   snapshotState(observed);return {matched:true,binding:{timelineId:observed.timeline.timeline_id,target:target[0].id,window:target[0].window,clipId:items[0]?.clip_id||null},observed};
  }
  if(assertion==='resolve-unchanged'){requireProof(proof.baseline,'resolution_unavailable','No frozen state is available for resolution');const previous=proof.lastObserved||proof.baseline;return {matched:isDeepStrictEqual(snapshotState(observed),snapshotState(previous)),observed};}
  if(assertion==='resolve-completed'){const pending=proof.contract.actions.find(a=>a.id===session.agentUnknown?.params?.actionId);requireProof(pending,'resolution_unavailable','The uncertain action has no declared outcome',['inspect','record_unknown']);return verifyCheckpoint({...proof,actions:[...proof.actions,{...pending,receipt:{status:'Unknown'}}]},pending.checkpoint,observed,ui,{...session,resolving:true});}
  if(checkpoint.verifier==='connection'){
   const main=ui.widgets.filter(w=>w.class==='MainWindow'&&/^Golden\.wiz — Wizard(?: [•*])?$/.test(w.title));
   return {matched:observed.name==='Golden '+session.harnessId&&typeof observed.bundleRevision==='string'&&observed.bundleRevision.length>0&&session.endpoint?.pid===session.pid&&main.length===1&&!ui.widgets.some(w=>w.text?.includes('failed to load')),captureTarget:main[0]?.id,observed};
  }
  requireProof(proof.baseline&&observed.timeline?.timeline_id===proof.binding.timelineId,'wrong_fixture','Inspect the frozen baseline timeline',['inspect']);
  const done=proof.actions.filter(a=>a.checkpoint===assertion);
  requireProof(session.resolving||checkpoint.actions.every((id,i)=>done[i]?.id===id&&done[i].receipt?.status==='Dispatched'),'required_action_missing','Perform the required '+assertion+' actions',['perform_declared_action']);
  let matched;
  if(checkpoint.verifier==='track-added'){
   const before=proof.baseline.tracks,added=observed.tracks.filter(t=>!before.some(b=>b.track_id===t.track_id));
   matched=observed.tracks.length===before.length+1&&added.length===1&&added[0].address==='V2'&&Array.isArray(added[0].items)&&added[0].items.every(i=>i.kind!=='clip')&&before.every(b=>isDeepStrictEqual(b,observed.tracks.find(t=>t.track_id===b.track_id)));
  }else if(checkpoint.verifier==='clip-trimmed'){verifyTrimmedClip(clips(proof.baseline)[0],clips(observed)[0],24);matched=clips(observed).length===1&&isDeepStrictEqual(proof.baseline.tracks.map(t=>t.track_id),observed.tracks.map(t=>t.track_id));}
  else if(checkpoint.verifier==='timeline-restored')matched=isDeepStrictEqual(snapshotState(observed),snapshotState(proof.baseline));
  else throw proofError('unknown_verifier','The definition names an unsupported verifier',['review_definition']);
  return {matched,observed};
 }catch(e){if(e.code)throw e;if(e.status==='Blocked'||e instanceof TypeError)throw proofError('observation_unavailable',e.message,['inspect','prepare_fixture']);throw proofError('assertion_failed',e.message,['inspect','record_fail'],'Fail');}
}
export function resolveUnknown(s,params,evidence,observed){
 requireProof(s.agentUncertain&&s.agentUnknown?.id===params.actionId&&typeof params.note==='string'&&params.note.trim(),'invalid_resolution','Reference the Unknown action and explain its resolution',['verify_resolution']);
 requireProof(evidence?.file===params.verification&&evidence.provenance==='resolution'&&evidence.unknownAction===params.actionId&&evidence.attempt===s.agentAttempt&&evidence.caseId===s.currentCheck&&evidence.definitionHash===s.agentProof?.definitionHash&&evidence.revision===s.agentRevision&&evidence.generation===s.generation&&observed?.matched===true,'resolution_verification_missing','Resolve needs current verification for this specific Unknown action',['verify_resolution']);
 const result={resolved:true,action:s.agentUnknown,verification:evidence.file,note:params.note.trim(),requiresRetest:true};s.agentUncertain=false;s.agentUnknown=null;return result;
}
export function requirePassProof(s,evidence,verified=[],events=[]){
 const proof=s.agentProof;requireProof(!s.agentUncertain,'unresolved_mutation','Resolve the Unknown mutation before recording Pass',['verify_resolution','resolve','record_unknown']);
 requireProof(proof?.contract,'proof_contract_missing','This definition has no qualified toolkit proof contract',['review_definition']);
 requireProof(proof.contract.mode!=='physical'||proof.mode==='physical'&&s.agentRequiredRoute==='physical','required_physical_mode','The frozen definition requires physical mode',['begin_physical_attempt']);
 requireProof(!proof.tainted,'unqualified_mutation','An unqualified mutation invalidated this attempt',['record_blocked','begin_new_attempt']);
 const current=e=>e.attempt===s.agentAttempt&&e.caseId===s.currentCheck&&e.generation===s.generation&&e.definitionHash===proof.definitionHash;
 for(const checkpoint of proof.contract.checkpoints){
  const point=proof.checkpoints[checkpoint.id],v=evidence.find(e=>e.file===point?.verification&&current(e)&&e.provenance==='verification'&&e.assertion===checkpoint.id),c=evidence.find(e=>e.file===point?.capture&&current(e)&&e.provenance==='explicit-capture'&&e.assertion===checkpoint.id);
  requireProof(v&&verified.some(e=>e.file===v.file),'verification_missing','Missing qualifying verification for '+checkpoint.id,['verify']);
  requireProof(c&&c.verification===v.file&&c.method===checkpoint.capture&&c.target===point.captureTarget&&c.revision===v.revision&&c.sequence>v.sequence,'capture_missing','Capture '+checkpoint.id+' after its successful verification without an intervening mutation',['capture']);
  for(const id of checkpoint.actions){const action=proof.actions.find(a=>a.id===id&&a.checkpoint===checkpoint.id);requireProof(action?.receipt?.status==='Dispatched'&&action.revision<=v.revision&&events.some(e=>e.id===action.eventId&&e.caseId===s.currentCheck&&e.attempt===s.agentAttempt&&e.generation===s.generation&&e.revision===action.revision&&e.operation==='physical'&&e.status==='Completed'&&e.result?.status==='Dispatched'&&e.params?.actionId===id),'required_action_missing','Missing action-specific physical receipt for '+id,['perform_declared_action']);}
 }
 const final=proof.checkpoints[proof.contract.checkpoints.at(-1).id];requireProof(final?.revision===s.agentRevision,'stale_proof','Mutation occurred after the final proof',['verify','capture']);
}
