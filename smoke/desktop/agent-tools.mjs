import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,appendFile,readFile,copyFile,realpath,stat,open,unlink} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {nativeCall,desktopCall,verifyDesktopOwner,verifyDesktopPaths,captureDesktopFailure,agentReadOperations,agentReadNative} from './adapter.mjs';
import {physicalInput,clipPoint} from './physical-input.mjs';
import {nativeDesktopInput,physicalKeys,physicalKeyAliases} from './macos-input.mjs';
import {retainObservation} from './observations.mjs';
import {recordPresented,recordingOptions} from './recorder.mjs';
import {verifyDesktopLease} from './desktop-lease.mjs';
import {briefContext,prepareAgentTask} from './agent-task.mjs';
import {waitForObservation,usableGeometry} from './check-support.mjs';
import {ROOT,readJSON,writeJSON,inside,sha} from '../runner/files.mjs';
import {OutcomeError,assert} from '../runner/engine.mjs';
import {rawChecks} from '../runner/catalog.mjs';
import {testSpecification,candidateChecks,actionHistory,stepHistory} from '../test-details.mjs';
import {validateToolParams,validateApplicationParams,validateNativeParams,observationSelectors,withAgentAction,currentAction,markUnknown,jsonLines,terminalResult,closeAttempt,beginProof,physicalAction,verifyCheckpoint,resolveUnknown,requirePassProof,requireProof,proofError,normalizeToolError} from './agent-proof.mjs';
export {requirePassProof} from './agent-proof.mjs';

const readOps=agentReadOperations,readNative=agentReadNative;
export const isAgentMutation=(operation,params={})=>operation==='reveal'||operation==='physical'&&params.command!=='screenshot'||operation==='call'&&!readOps.includes(params.operation)||operation==='native'&&!readNative.includes(params.operation);
const operations=['context','task','schema','preflight','observe','find','model','model_value','reveal','geometry','physical','native','call','wait','capture','recording','evidence','begin','verify','resolve','record','report'];
export const agentSessionTimeoutMs=30*60*1000;

export function selectUI(ui,{kind='widgets',selector,selectors,limit=20,details=false}={}){
 assert(['widgets','actions'].includes(kind)&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Choose widgets/actions and a limit from 1 to 100');
 const queries=observationSelectors({selector,selectors});
 const matches=(ui[kind]||[]).filter(w=>queries.some(query=>Object.keys(query).filter(k=>k!=='contains').every(k=>query.contains&&typeof query[k]==='string'?typeof w[k]==='string'&&w[k].includes(query[k]):w[k]===query[k])));
 const summary=['id','class','name','text','tooltip','title','window','parent','enabled','active','focused','editableText','keySequenceCapture','keyWindow','nativeWindow','visibleRect','clickRect','x','y','width','height','value','minimum','maximum','checked','index','rows','clipIds','clipIdsTruncated','graphId','timelineId','viewport','handle','minHandle','maxHandle','groove','accessibleName','accessibleDescription'];
 const incomplete=w=>w.nativeViewsTruncated||w.clipIdsTruncated||w.rows>(w.model?.length||0)||w.menuTruncated||w.sceneItemsTruncated===true||w.sceneTextTruncated===true||w.sceneItemsTruncated===undefined&&w.sceneItems?.length>=128||w.sceneTextTruncated===undefined&&w.sceneText?.length>=256;
 return {kind,scope:ui.scope||null,coordinates:{units:'macOS points',physicalInput:'target-widget-local',modelItemRects:'returned-viewport-local'},...Object.fromEntries(['modalWindow','popupWindow','mouseGrabber'].filter(k=>Object.hasOwn(ui,k)).map(k=>[k,ui[k]])),matchCount:matches.length,truncated:matches.length>limit,inspectionIncomplete:(ui.widgets||[]).some(w=>Boolean(incomplete(w))),limits:{modelRows:64,modelPageRows:64,timelineClipIds:1024,sceneItems:128,sceneText:256},matches:matches.slice(0,limit).map(w=>{
  const result=Object.fromEntries(summary.filter(k=>w[k]!==undefined).map(k=>[k,w[k]]));
  if(details)for(const k of ['model','itemRects','sceneItems','sceneText','tabs','tabRects','items','itemValues','menuItems','selectedRows'])if(w[k]!==undefined)result[k]=w[k];
  if(w.rows!==undefined)result.modelTruncated=w.rows>(w.model?.length||0);
  if(w.sceneItems!==undefined)result.sceneItemsTruncated=w.sceneItemsTruncated??w.sceneItems.length>=128;
  if(w.sceneText!==undefined)result.sceneTextTruncated=w.sceneTextTruncated??w.sceneText.length>=256;
  if(w.menuTruncated!==undefined)result.menuTruncated=w.menuTruncated;
  return result;
 })};
}
export function uniqueTarget(ui,selector,kind='widgets'){
 const selected=selectUI(ui,{kind,selector:typeof selector==='string'?{id:selector}:selector,details:true,limit:10});
 if(selected.matchCount!==1){const e=new OutcomeError('Target must match exactly one '+kind+' entry; found '+selected.matchCount+'. Narrow the selector.','Blocked');e.diagnostics=selected;throw e;}
 return selected.matches[0];
}
export function readyUI(ui,params={}){
 if(params.conditions){
  const values=params.conditions.map(c=>readyUI(ui,{...c,kind:params.kind}));
  if(values.some(v=>!v))return false;
  return {...selectUI(ui,{kind:params.kind,selectors:params.conditions.map(c=>c.selector),details:params.details,limit:params.limit}),matched:true,conditions:params.conditions.map((c,i)=>({...c,condition:c.condition||'exists',matched:true,targetId:values[i].id||null}))};
 }
 const found=selectUI(ui,{selector:params.selector,kind:params.kind,details:true}),condition=params.condition||'exists';
 if(condition==='absent'){
  requireProof(!found.inspectionIncomplete&&!found.truncated,'incomplete_observation','Absence needs a complete inspection; narrow the scope or inspect the model',['observe']);
  return found.matchCount===0?{absent:true,scope:found.scope}:false;
 }
 if(found.matchCount>1)throw new OutcomeError('Wait target is ambiguous; narrow the selector.','Blocked');
 if(found.matchCount===0)return false;const target=found.matches[0];
 if(condition==='geometry')return usableGeometry(ui,target);
 return condition==='exists'||['enabled','focused','keyWindow'].includes(condition)&&target[condition]===true||['value','text','checked'].includes(condition)&&isDeepStrictEqual(target[condition],params.expected)?target:false;
}
export function compareObservation(value,{path:keys=[],equals,notEquals,length,includes}={}){
 assert(Array.isArray(keys)&&keys.length<=20&&keys.every(k=>(typeof k==='string'||Number.isInteger(k))&&!['__proto__','constructor','prototype'].includes(k)),'Use a bounded array of property names or indexes');
 const expected={};if(equals!==undefined)expected.equals=equals;if(notEquals!==undefined)expected.notEquals=notEquals;if(length!==undefined)expected.length=length;if(includes!==undefined)expected.includes=includes;
 assert(Object.keys(expected).length>0,'Verification needs equals, notEquals, length or includes');
 let actual=value;for(const key of keys){if(actual===null||typeof actual!=='object'||!Object.hasOwn(actual,key))return {matched:false,missing:true,path:keys};actual=actual[key];}
 const matched=(equals===undefined||isDeepStrictEqual(actual,equals))&&(notEquals===undefined||!isDeepStrictEqual(actual,notEquals))&&(length===undefined||actual?.length===length)&&(includes===undefined||(Array.isArray(actual)?actual.some(x=>isDeepStrictEqual(x,includes)):typeof actual==='string'&&actual.includes(includes)));
 return {matched,actual,expected,path:keys};
}
export function sessionDefinitions(s){
 const candidates=[...rawChecks.filter(c=>c.id.startsWith('P-')), ...candidateChecks()],catalog=rawChecks;
 const planned=(s.plan?.cases||[]).map(c=>typeof c==='string'?catalog.find(item=>item.id===c):c);assert(planned.every(Boolean),'A planned check is missing from the source catalog');
 return [...planned,...candidates.filter(c=>!planned.some(p=>p.id===c.id))];
}
const definitions=s=>s.agentDefinitions||sessionDefinitions(s);
const definition=(s,id)=>definitions(s).find(c=>c.id===id);

export async function sessionContext(file){
 const s=await readJSON(file);verifyDesktopPaths(s);
 const ready=await readJSON(path.join(s.native,'ready.json'));if(!s.agentDefinitions){s.agentDefinitions=sessionDefinitions(s);await writeJSON(file,s);}
 const command=['env','SMOKE_DATA_DIR='+s.dataDir,'node',path.join(ROOT,'desktop/session.mjs')];
 const result={format:'athanor-agent-session/v1',session:file,workspace:s.dataDir,build:{app:s.sourceApp,packageHash:s.guiHash,version:s.plan?.version||null},process:{pid:s.pid,started:s.processStart,generation:s.generation},lifetime:{deadlineAt:s.agentDeadlineAt||null,timeoutMs:s.agentDeadlineAt?agentSessionTimeoutMs:null,onExpiry:s.agentDeadlineAt?'Owned app receives SIGTERM; retain evidence and start a fresh session for further work':null},project:{bundle:s.bundle,main:s.main,alternate:s.alternate,assets:s.assets},adapter:ready.capabilities,physical:{commands:['click','drag','key','type','scroll','screenshot'],keys:physicalKeys,keyAliases:physicalKeyAliases,coordinates:'Widget-relative macOS points; target and destination geometry are rechecked before dispatch'},operations,checks:definitions(s).map(testSpecification),verdicts:{scripted:'Courses run their authored assertions; discover definitions with smoke.mjs list and courses',toolkitPassIds:definitions(s).filter(c=>c.proof).map(c=>c.id),exploration:'Observe, act and retain diagnostics; toolkit Pass requires a frozen proof contract'},evidenceDirectory:path.join(s.root,'evidence'),guidance:[
  'Use CLI/Qt operations to prepare a fixture; perform the action under test with physical input.',
  'Use wait.conditions for controls that must be ready simultaneously. Its successful reply already contains the selected observation and identity; reuse it instead of immediately inspecting again. Input still refreshes targets and visual proof still requires capture.',
  'Plan short known phases before acting: current targets, precondition gate, physical action, independent readback and declared capture. Read docs/agent-sequences.md and adapt its examples. Check parameters without input using session.mjs batch-check SESSION.json STEPS.json, then run batch SESSION.json STEPS.json (1–8 steps). Split at new dialogs, unknown geometry, asynchronous outcomes or a decision that needs interpretation. Each step keeps fresh guards and its own receipt. Sequences stop on errors or false expectations without rollback or replay; inspect results before continuing. Keep frozen verification and capture checkpoints.',
  'For a failed repro, read docs/bug-reporter-interop.md. The reporter helper only prefills an empty draft in the same build/project and never submits or imports historical attachments.',
  'Resolve targets from a fresh observation. An ambiguous target is Blocked.',
  'Observe returns an observationId and encoding: full or delta. Repeat the same query with since: observationId; the smaller full selection (matches) or delta (changes) is returned. Use selectors: [selector, ...] for 1–8 related controls from one inspection. These retained diagnostics cannot qualify Pass. Omitted or truncated entries are not proof of deletion. Drop since for a full current observation.',
  'Use scoped observe/find for a widget subtree. Scoped absence applies only there. Model pages return an identity/revision/root cursor: supply it on following pages and restart on model change. Reveal is setup scrolling; refresh geometry. Model_value reads observed columns or bounded roles; qualify role meanings against CLI identities. Respect clipIdsTruncated.',
  'Inspect truncation and adapter limits. Missing data in an incomplete inspection does not establish absence. The adapter observes public AppKit file-panel controls; qualify each dialog path on the selected build. Outside applications remain outside the owned session.',
  'Physical input verifies foreground ownership after dispatch. Editable clicks and typing also verify the exact field and key window; lost focus remains Unknown and is not replayed.',
  'Capture presented or window uses a complete compositor frame newer than the capture request. Receipts retain frame timing, source, process and window. Keep the owned window fully on one display. Widget captures retain Qt raster source separately.',
  'Use wait for read-only conditions: exists, absent, enabled, value, text, checked, focused, keyWindow or geometry. Geometry defaults to a 250ms unchanged interval; stableForMs can be 0–2000 within timeoutMs. Absence requires a complete inspection. Waits do not reserve targets: physical input still rechecks bindings. Never replay an Unknown mutation.',
  'Begin a check, describe actions with title, verify independently, capture the displayed result, then record.',
  'Pass requires the frozen definition’s named assertions, action-bound receipts and explicit captures after verification at each declared checkpoint. Arbitrary expectations and diagnostic images cannot qualify Pass.',
  'Physical mode cannot downgrade. Give tested actions their declared actionId. Use CLI/Qt for setup before baseline; unqualified later mutations invalidate the attempt. Raw call/native share admission and cannot supply physical proof.',
  'Record one terminal verdict per attempt. Close before beginning a retest. Reports retain every attempt and any earlier failures.',
  'Unknown responses contain a stable code and nextActions. Resolve the specific Unknown action with a named resolution assertion and retained verification reference; begin a fresh retest afterward.',
  'Stop the session when done. The foreground lease is shared across Athanor workspaces and released when its launcher exits.'
 ]};
 result.applicationOperations=Object.keys(s.schema?.operations||{});result.readOnlyOperations=readOps.filter(op=>Object.hasOwn(s.schema?.operations||{},op));
 result.connection={command:[...command,'tools',file],protocol:'JSON lines',maxRequestBytes:65536,maxSequenceSteps:8,request:{id:'unique-request-id',operation:'observe',params:{selector:{class:'MainWindow'}}},requestIds:'Ordinary tool requests are not idempotent; never retry a lost mutation. Plan IDs additionally retain intent and reject duplicate execution: use plan-inspect with the original ID.'};
 result.connection.sequencePlanning={guide:'docs/agent-sequences.md',examples:['examples/sequences/add-video-track.json','examples/sequences/search-known-term.json'],checkCommand:[...command,'batch-check',file,'/absolute/steps.json'],runCommand:[...command,'batch',file,'/absolute/steps.json'],checkScope:'Parameters and selected-build schema only; no target lookup, expected-result evaluation, input, reservation or Pass.'};
 result.connection.sequencePlanning.compactCommand=[...result.connection.sequencePlanning.runCommand,'--compact'];
 result.connection.sequencePlanning.continuation='Inspect summary.continuation, gate outcomes and returnedMutationIndexes. Compact replies retain full results at receipt.path with a checksum. Review checkpoints do not automatically start another request.';
 result.connection.sequencePlanning.plan={format:'athanor-agent-plan/v1',checkCommand:[...command,'plan-check',file,'/absolute/control-plan.json'],runCommand:[...command,'plan',file,'/absolute/control-plan.json','--request-id','known-plan-id','--compact'],inspectCommand:[...command,'plan-inspect',file,'known-plan-id'],recipeCheckCommand:[...command,'recipe-check',file,'/absolute/recipe.json','/absolute/values.json'],recipes:['examples/recipes/project-identity.json','examples/recipes/media-search.json','examples/recipes/add-video-track.json','examples/recipes/inspector-edit.json','examples/recipes/timeline-undo.json'],example:'examples/sequences/find-media-plan.json',limits:{maxPhases:8,maxDeclaredSteps:32,maxDurationMs:120000},guidance:'Validate every authored path. Branch only from the final complete read-only step using explicit values. Missing, partial, unexpected, Fail or Unknown stops; no loops, recovery or replay. Typed recipes compile without app input. Optional ID/model-offset bindings require a gated complete unique readback on every path and refresh that source before use; geometry and new-dialog choices remain review checkpoints. Plans retain intent before every action, returned prefixes and a checksummed receipt. Use a known request ID and plan-inspect after a lost response; duplicate IDs cannot execute again. Inspection is read-only and Unsettled requires journal/effect reconciliation, never resumption.'};
 result.connection.sequencePlanning.plan.workflowCheckCommand=[...command,'workflow-check',file,'/absolute/workflow.json'];
 result.connection.sequencePlanning.plan.workflowGuidance='Compose ordered typed recipes with workflow-check. Only explicitly declared continueAfter exits can join; every undeclared exit remains a review stop. Check every returned segment before executing one with a known plan ID. Never dispatch later segments automatically or replay Unknown. Preserve independent gates and captures; geometry, new dialogs and interpretation need review. Namespaced phases/bindings and hashes retain recipe provenance.';
 await writeJSON(path.join(s.root,'agent-context.json'),result);await writeJSON(path.join(s.root,'agent-brief.json'),briefContext(result));return result;
}

async function retain(s,label,value,kind='json',imported=false,metadata={}){
 s=await readJSON(path.join(s.root,'session.json'));
 assert(['json','image','video'].includes(kind),'Unsupported retained evidence kind');
 await mkdir(path.join(s.root,'evidence'),{recursive:true});const name='agent-'+randomUUID()+(kind==='json'?'.json':kind==='video'?'.mp4':'.png'),file=path.join(s.root,'evidence',name);
 if(kind==='json')await writeJSON(file,value);else{assert(inside(s.root,await realpath(value)),'Capture escaped the session');await copyFile(value,file);}
 s.agentEvidenceSequence=(s.agentEvidenceSequence||0)+1;await writeJSON(path.join(s.root,'session.json'),s);
 const evidence={file:name,path:file,kind,caption:label,sha256:await sha(file),recordedAt:new Date().toISOString(),identity:imported?null:{packageHash:s.guiHash,pid:s.pid,started:s.processStart},caseId:s.currentCheck||null,attempt:s.agentAttempt||null,generation:s.generation,revision:imported?null:s.agentRevision||0,sequence:s.agentEvidenceSequence,definitionHash:s.agentProof?.definitionHash||null,provenance:imported?'imported':'diagnostic',...metadata};
 await appendFile(path.join(s.root,'agent-evidence.jsonl'),JSON.stringify(evidence)+'\n');return evidence;
}
async function journal(s,operation,params,start,result,status='Completed'){
 params={...params,stepId:params.stepId||s.currentStep,title:params.title||definition(s,s.currentCheck)?.steps?.find(step=>step.id===s.currentStep)?.title};
 const entry={id:currentAction(path.join(s.root,'session.json'))?.id||randomUUID(),caseId:s.currentCheck||null,attempt:s.agentAttempt||null,generation:s.generation,stepId:params.stepId||null,title:params.title||({observe:'Observe the target controls',find:'Locate one target',physical:'Perform physical '+params.command,wait:'Wait for the expected state',capture:'Capture the displayed result',verify:'Verify the expected outcome'}[operation]||operation),operation,params,channel:operation==='physical'?'Physical input':operation==='call'?'Application':operation==='native'?'Qt adapter':'Agent toolkit',status,at:new Date(start).toISOString(),durationMs:Date.now()-start,revision:s.agentRevision||0,result};
 await appendFile(path.join(s.root,'agent-tools.jsonl'),JSON.stringify(entry)+'\n');return entry;
}

export async function agentTool(file,operation,params={}){
 try{
 validateToolParams(operation,params);
 const s=await readJSON(file);verifyDesktopPaths(s);
 if(operation==='call')validateApplicationParams(s.schema,params.operation,params.params||{});
 if(operation==='native')validateNativeParams(params.operation,params.params||{});
 if(params.read)validateApplicationParams(s.schema,params.read.operation,params.read.params||{});
 if(params.commit)validateApplicationParams(s.schema,'spellbook.inspect',{document_id:params.commit.documentId,view:'raw'});
 // Reads can sample a held gesture; state admission and evidence capture must not race edits.
 if(['observe','find','model','model_value','wait','schema','preflight'].includes(operation))return await runAgentTool(file,operation,params);
 return await withAgentAction(file,()=>runAgentTool(file,operation,params),{operation,params});
 }catch(e){throw normalizeToolError(e);}
}
async function runAgentTool(file,operation,params={}){
 assert(operations.includes(operation),'Unknown agent tool: '+operation);assert(params&&typeof params==='object'&&!Array.isArray(params),'Supply a JSON object');
 let s=await readJSON(file);verifyDesktopPaths(s);
 if(operation==='context'){const context=await sessionContext(file);return params.detail==='brief'?briefContext(context):context;}
 if(operation==='report')return exportAgentReport(file);
 const records=await jsonLines(path.join(s.root,'agent-results.jsonl')),terminal=s.agentAttempt?terminalResult(records,s.agentAttempt):null;
 const mutating=isAgentMutation(operation,params);
 if(operation==='record'&&terminal)return closeAttempt(records,{attempt:s.agentAttempt,status:params.status,observation:params.note?.trim()});
 requireProof(!(terminal&&mutating),'attempt_closed','Begin a new attempt before another edit',['begin_new_attempt','report']);
 if(operation==='begin')requireProof(!s.agentAttempt||terminal,'attempt_open','Close the current attempt before beginning another',['record','report']);
 verifyDesktopOwner(s);verifyDesktopLease(s);
 const start=Date.now();
 if(mutating&&s.agentUncertain)throw new OutcomeError('An earlier mutation is Unknown. Inspect and verify it, then use resolve before another edit.','Blocked');
 let result;
 try{
  if(mutating&&s.agentProof&&(s.agentProof.baseline||Object.keys(s.agentProof.checkpoints).length)&&!(operation==='physical'&&params.actionId)){s.agentProof.tainted=true;await writeJSON(file,s);}
  if(operation==='task')result=await prepareAgentTask(file,params,agentTool);
  else if(operation==='preflight'){
   const observed=await nativeDesktopInput(file,{command:'inspect',mode:'window-server',depth:0});const ui=await nativeCall(file,'inspect');result={pid:observed.pid,started:observed.started,permissions:observed.permissions,frontmost:observed.frontmost,frontWindow:observed.frontWindow,windows:observed.windows,keyWindow:ui.widgets.find(w=>w.id===w.window&&w.keyWindow)||null,focusedControl:ui.widgets.find(w=>w.id===ui.focus)||null,ready:observed.permissions?.input===true&&observed.permissions?.screenCapture===true};
  }else if(operation==='schema'){
   assert(typeof params.operation==='string'&&Object.hasOwn(s.schema.operations,params.operation),'Choose an advertised application operation');result={operation:params.operation,params:s.schema.operations[params.operation],result:s.schema.results?.[params.operation],errors:s.schema.errors?.[params.operation]};
  }else if(operation==='evidence'){
   assert(s.currentCheck&&typeof params.file==='string'&&typeof params.title==='string','Begin a check and supply a file and title');
   assert(inside(s.root,await realpath(params.file)),'Evidence escaped the session');
   // Imported observations illustrate the attempt; they cannot satisfy its current capture gate.
   result=await retain(s,params.title,params.kind==='image'?params.file:await readJSON(params.file),params.kind==='image'?'image':'json',true);
  }else if(operation==='observe'||operation==='find'){
    const ui=await nativeCall(file,'inspect',params.scope?{target:params.scope}:{});result=operation==='find'?uniqueTarget(ui,params.selector,params.kind):selectUI(ui,params);result={...result,observedAt:new Date().toISOString(),generation:s.generation,identity:{packageHash:s.guiHash,pid:s.pid,started:s.processStart}};if(operation==='observe')result=await retainObservation(s,params,result);result.observationBytes={full:Buffer.byteLength(JSON.stringify(ui)),selectedPayload:Buffer.byteLength(JSON.stringify(result))};
  }else if(operation==='model'||operation==='reveal'){
   const target=uniqueTarget(await nativeCall(file,'inspect'),params.target||params.selector);
   result=await nativeCall(file,operation==='model'?'model-page':'model-reveal',{target:target.id,offset:params.offset??0,limit:operation==='reveal'?1:params.limit??32,...params.cursor?{cursor:params.cursor}:{}});
   result={...result,observedAt:new Date().toISOString(),generation:s.generation};
  }else if(operation==='model_value'){
   const target=uniqueTarget(await nativeCall(file,'inspect'),params.target||params.selector);
   result=await nativeCall(file,'model-value',{target:target.id,offset:params.offset??0,column:params.column,role:params.role,...(params.cursor?{cursor:params.cursor}:{})});
  }else if(operation==='recording'){
   recordingOptions({durationMs:params.durationMs,intervalMs:params.intervalMs,maxSamples:params.maxSamples});
   const captured=await recordPresented(file,params);result={binding:captured.binding,samples:captured.samples.length,elapsedMs:captured.elapsedMs,totalObservationCostMs:captured.totalObservationCostMs,artifacts:captured.artifacts,scope:captured.scope};
   if(s.currentCheck){await retain(s,params.title||'Timed playback observations',captured);for(const sample of captured.samples)await retain(s,'Presented playback sample',sample.image.output,'image');await retain(s,'Sampled playback with original capture intervals',captured.video.path,'video');}
  }else if(operation==='geometry'){
   const target=uniqueTarget(await nativeCall(file,'inspect'),params.target||params.selector);result=await nativeCall(file,'timeline-clip-rect',{target:target.id,clipId:params.clipId});result={...result,target:target.id,point:clipPoint(result,params.part)};
  }else if(operation==='physical'){
   assert(['click','drag','key','type','scroll','screenshot'].includes(params.command),'Unsupported physical command');
   const ui=await nativeCall(file,'inspect'),target=uniqueTarget(ui,params.target||params.selector);
   const qualified=params.command==='screenshot'?null:physicalAction(s.agentProof,params,target);
   if(qualified)params={...params,stepId:qualified.stepId};
   const p={target:target.id,expected:target};for(const k of ['button','durationMs','chrome','key','text','deltaX','deltaY','modifiers','path','clickCount','commit'])if(params[k]!==undefined)p[k]=params[k];
   if(!['key','type','screenshot'].includes(params.command)&&!(params.command==='click'&&['x','y','xRatio','yRatio'].every(k=>params[k]===undefined))){p.x=params.x??target.width*(params.xRatio??.5);p.y=params.y??target.height*(params.yRatio??.5);}
   if(params.clipId){assert(['click','drag'].includes(params.command),'Clip targeting supports click and drag');const geometry=await nativeCall(file,'timeline-clip-rect',{target:target.id,clipId:params.clipId});Object.assign(p,clipPoint(geometry,params.part),{clipId:params.clipId,expectedClip:geometry.rect});}
   if(params.command==='drag'){const to=uniqueTarget(ui,params.toTarget||params.target||params.selector);p.toTarget=to.id;p.toX=params.toX??to.width*(params.toXRatio??.5);p.toY=params.toY??to.height*(params.toYRatio??.5);}
   result=await physicalInput(file,params.command,p);
   if(qualified){const latest=await readJSON(file);requireProof(result.status==='Dispatched','physical_receipt_missing','The tested action has no dispatched physical receipt',['inspect','record_unknown']);latest.agentProof.actions.push({...qualified,receipt:result,revision:latest.agentRevision,eventId:currentAction(file).id});await writeJSON(file,latest);result={...result,testAction:qualified};}
   if(params.command==='screenshot')result.capture=await retain(s,params.title||'Owned native window',result.output,'image');
  }else if(operation==='call'||operation==='native')result=await (operation==='call'?desktopCall:nativeCall)(file,params.operation,params.params||{});
  else if(operation==='wait'){
   let lastUI;const query=params.conditions?{kind:params.kind,scope:params.scope,selectors:params.conditions.map(c=>c.selector),details:params.details,limit:params.limit}:null;
   try{result=await waitForObservation(async()=>{lastUI=await nativeCall(file,'inspect',params.scope?{target:params.scope}:{});return readyUI(lastUI,params);},{description:params.title||(query?'All requested UI conditions':'Target '+(params.condition||'exists')),timeoutMs:params.timeoutMs??5000,intervalMs:params.intervalMs??150,stableForMs:params.stableForMs??(params.condition==='geometry'||params.conditions?.some(c=>c.condition==='geometry')?250:0)});}
   catch(error){if(query&&lastUI)error.diagnostics={...error.diagnostics,conditions:params.conditions,lastObservation:selectUI(lastUI,query),generation:s.generation,identity:{packageHash:s.guiHash,pid:s.pid,started:s.processStart}};throw error;}
   if(query)result=await retainObservation(s,query,{...result,observedAt:new Date().toISOString(),generation:s.generation,identity:{packageHash:s.guiHash,pid:s.pid,started:s.processStart}});
  }else if(operation==='capture'){
   const target=uniqueTarget(await nativeCall(file,'inspect'),params.target||params.selector),kind=params.kind||'presented';assert(['presented','widget','window'].includes(kind),'Choose presented, widget or window capture');
   const assertion=params.assertion,point=s.agentProof?.checkpoints?.[assertion];
   if(assertion){requireProof(point&&point.revision===s.agentRevision&&!point.capture,'verification_missing','Verify this checkpoint at the current revision before capturing it',['verify']);requireProof(s.agentProof.contract.checkpoints.find(c=>c.id===assertion)?.capture===kind,'wrong_capture_method','Use the capture method declared by the definition',['capture']);requireProof(target.id===point.captureTarget,'wrong_capture_target','Capture the verified test surface',['find','capture']);}
   const capture=kind==='widget'?await nativeCall(file,'snapshot-widget',{target:target.id}):await physicalInput(file,'screenshot',{target:target.id,crop:kind==='presented'});
   const metadata={method:kind,target:target.id,captureSource:kind==='widget'?'qt-widget-raster':capture.capture?.source,captureReceipt:kind==='widget'?null:capture};
   result=await retain(s,params.title||({presented:'Displayed compositor pixels',widget:'Qt widget raster',window:'Owned native window'}[kind]),capture.path||capture.output,'image',false,assertion?{...metadata,provenance:'explicit-capture',assertion,verification:point.verification}:{...metadata,provenance:'diagnostic'});
   if(assertion){const latest=await readJSON(file);latest.agentProof.checkpoints[assertion].capture=result.file;await writeJSON(file,latest);}
  }else if(operation==='begin'){
   requireProof(!s.agentUncertain,'unresolved_mutation','Resolve the Unknown action before beginning another attempt',['resolve','record_unknown']);requireProof(definition(s,params.id),'unknown_check','Choose a check from this session context',['context']);requireProof(params.mode===undefined||['physical','hybrid'].includes(params.mode),'invalid_params','Choose physical or hybrid mode',['correct_parameters']);
   if(!s.agentDefinitions)s.agentDefinitions=sessionDefinitions(s);
   requireProof(s.plan&&s.schema&&s.main,'prepared_fixture_required','Start a prepared owned fixture session before tracking a test',['prepare','start']);
   s.agentProof=beginProof(definition(s,params.id),params.mode);s.currentCheck=params.id;s.currentStep=null;s.agentTracking=true;s.agentRequiredRoute=s.agentProof.mode;s.agentAttempt=randomUUID();s.agentRevision=(s.agentRevision||0)+1;await writeJSON(file,s);result={check:testSpecification(s.agentProof.definition),contract:s.agentProof.contract,revision:s.agentRevision,attempt:s.agentAttempt,mode:s.agentRequiredRoute};
  }else if(operation==='verify'){
   assert(s.currentCheck,'Begin a check before verification');let observed;
   if(params.assertion){
    requireProof(!params.expect&&!params.selector&&!params.kind,'definition_owned_assertion','Use the declared verifier without an agent-selected expectation',['context']);
    const connection=s.agentProof?.contract?.checkpoints.find(c=>c.id===params.assertion)?.verifier==='connection',read=params.read;
    const readOp=s.agentProof.contract.readOperation||'timeline.inspect';
    requireProof(connection?!read||read.operation==='project.get_name':read?.operation===readOp,'wrong_verification_read','Use the read declared by this check',['context']);
    if(read)validateApplicationParams(s.schema,read.operation,read.params||{});
    requireProof(Object.keys(read?.params||{}).every(k=>!connection&&(k==='timeline_id'||readOp==='graph.get_clip_graph'&&k==='clip_id')),'definition_owned_read','Declared assertions require an unfiltered read of the owned fixture',['context']);
    const volume=s.agentProof.contract.oracle==='volume-v1',clipboard=volume&&s.currentCheck==='D-CLIPBOARD-LARGE';
    requireProof(!params.fixture||clipboard&&params.assertion==='baseline','wrong_fixture','Fixture binding is only available at the clipboard baseline',['context']);
    if(!connection&&params.assertion!=='baseline'){
     const expected=clipboard?{timeline_id:params.assertion==='copied'?s.agentProof.binding.timelineId:s.agentProof.binding.destinationId}:s.agentProof.binding.readParams;
     requireProof(expected?isDeepStrictEqual(read.params,expected):read?.params?.timeline_id===s.agentProof?.binding?.timelineId,'wrong_fixture','Read the frozen baseline fixture',['context']);
    }
    const destinationBinding=clipboard&&params.assertion==='destination'&&!s.agentProof.binding?.destinationTarget;
    requireProof(!params.target||params.assertion==='baseline'||destinationBinding,'definition_owned_assertion','Bind a target only at baseline or the declared empty destination checkpoint',['context']);
    requireProof(!destinationBinding||params.target,'definition_owned_assertion','Bind the newly observed empty destination canvas',['find','verify']);
    observed=await desktopCall(file,connection?'project.get_name':readOp,volume?{...read.params,page:{max_items:500}}:read?.params||{});
    if(volume){
     observed={timeline:observed};
     if(clipboard){
      if(params.assertion==='baseline'){
       requireProof(typeof params.fixture?.destinationTimelineId==='string'&&params.fixture.destinationTimelineId,'wrong_fixture','Bind the prepared empty destination',['context']);
       observed.empty=await desktopCall(file,'timeline.inspect',{timeline_id:params.fixture.destinationTimelineId,page:{max_items:500}});
      }else observed.source=await desktopCall(file,'timeline.inspect',{timeline_id:s.agentProof.binding.timelineId,page:{max_items:500}});
      if(params.assertion==='copied')observed.clipboard=await nativeCall(file,'clipboard-mark');
     }
    }
    if(connection)observed={...observed,bundleRevision:(await readJSON(file)).observedRevision};const ui=await nativeCall(file,'inspect'),proofTarget=params.target?uniqueTarget(ui,params.target).id:null,comparison=verifyCheckpoint(s.agentProof,params.assertion,observed,ui,{...s,proofTarget,proofRead:read?.params});
    if(!comparison.matched)throw proofError('assertion_failed','The '+params.assertion+' outcome did not match the frozen definition',['inspect','record_fail'],'Fail');
    const evidence=await retain(s,params.title||'Verify '+params.assertion,{...comparison,matched:true,read:read||{operation:'project.get_name'},assertion:params.assertion,unknownAction:s.agentUnknown?.id||null},'json',false,{provenance:params.assertion.startsWith('resolve-')?'resolution':'verification',assertion:params.assertion,unknownAction:s.agentUnknown?.id||null});
    const latest=await readJSON(file);
    if(params.assertion==='baseline'){latest.agentProof.baseline=observed;latest.agentProof.binding=comparison.binding;latest.agentProof.tainted=false;}
    else if(!params.assertion.startsWith('resolve-')){latest.agentProof.checkpoints[params.assertion]={verification:evidence.file,revision:latest.agentRevision,capture:null,captureTarget:comparison.captureTarget||latest.agentProof.binding?.target,observed,observedUI:comparison.observedUI};if(comparison.bindingUpdate)Object.assign(latest.agentProof.binding,comparison.bindingUpdate);}
    latest.agentProof.lastObserved=observed;await writeJSON(file,latest);result={verified:true,...evidence};
   }else{
   if(params.read){assert(readOps.includes(params.read.operation),'Verification may only call declared read-only operations');observed=await desktopCall(file,params.read.operation,params.read.params||{});}
   else observed=uniqueTarget(await nativeCall(file,'inspect'),params.selector,params.kind);
   const comparison=compareObservation(observed,params.expect);const evidence=await retain(s,params.title||'Independent verification',{...comparison,read:params.read||null,selector:params.selector||null});
   if(!comparison.matched){const e=proofError('assertion_failed','Verification did not match the expected outcome',['inspect','record_fail'],'Fail');e.diagnostics={comparison,evidence};throw e;}result={verified:true,...evidence};
   }
  }else if(operation==='resolve'){
   const e=(await evidenceFor(s,s.currentCheck)).find(e=>e.file===params.verification);
   result=resolveUnknown(s,params,e,e?await readJSON(e.path):null);await writeJSON(file,s);
  }else if(operation==='record'){
   assert(s.currentCheck&&['Pass','Fail','Blocked','Unknown'].includes(params.status)&&typeof params.note==='string'&&params.note.trim(),'Begin a check and supply its verdict and observation');
   requireProof(!s.agentUncertain||params.status==='Unknown','unresolved_mutation','An unresolved mutation requires an Unknown verdict',['verify_resolution','resolve','record_unknown']);
   if(params.status!=='Pass'){const failure=await captureDesktopFailure(file,Object.assign(Error(params.note),{status:params.status}),s.currentCheck);if(failure.failureState)await retain(s,'State when the check failed',await readJSON(failure.failureState));if(failure.failureScreenshot)await retain(s,'Qt window raster when the check failed',failure.failureScreenshot,'image');}
   const evidence=await evidenceFor(s,s.currentCheck);
   if(params.status==='Pass'){
    const verified=[];for(const e of evidence.filter(e=>e.kind==='json'))if((await readJSON(e.path)).matched===true)verified.push(e);
    requirePassProof(s,evidence,verified,await jsonLines(path.join(s.root,'agent-tools.jsonl')));
   }
   result={id:s.currentCheck,attempt:s.agentAttempt,status:params.status,observation:params.note.trim(),recordedAt:new Date().toISOString(),generation:s.generation,revision:s.agentRevision,evidence,mode:s.agentRequiredRoute,definition:s.agentProof?.definition||definition(s,s.currentCheck),definitionHash:s.agentProof?.definitionHash||null,proof:s.agentProof||null,uncertainty:s.agentUnknown||null,oracle:'Frozen definition verifiers and action-bound retained evidence'};
   closeAttempt(records,result);
   await appendFile(path.join(s.root,'agent-results.jsonl'),JSON.stringify(result)+'\n');
  }
  const latest=await readJSON(file);await journal(latest,operation,params,start,result);return result;
 }catch(e){e=normalizeToolError(e);
  if(e.status==='Unknown'&&mutating)await markUnknown(file,e);const evidence=await captureDesktopFailure(file,e,'agent-'+operation),latest=await readJSON(file);if(evidence.failureScreenshot)await retain(latest,'App state when '+operation+' failed',evidence.failureScreenshot,'image');if(evidence.failureState)await retain(latest,'Failure diagnostics',await readJSON(evidence.failureState));await journal(latest,operation,params,start,{error:e.message,code:e.code,nextActions:e.nextActions,diagnostics:e.diagnostics||null,evidence},e.status);e.evidence=evidence;throw e;}
}
async function evidenceFor(s,id){
 const evidence=(await jsonLines(path.join(s.root,'agent-evidence.jsonl'))).filter(e=>e.caseId===id&&e.attempt===s.agentAttempt);
 for(const e of evidence)assert(inside(path.join(s.root,'evidence'),await realpath(e.path))&&await sha(e.path)===e.sha256,'Recorded agent evidence changed');return evidence;
}
export async function exportAgentReport(file){
 const s=await readJSON(file);verifyDesktopPaths(s);const events=await jsonLines(path.join(s.root,'agent-tools.jsonl')),results=await jsonLines(path.join(s.root,'agent-results.jsonl'));
 const uncertainties=await jsonLines(path.join(s.root,'agent-uncertainty.jsonl'));
 const app=await jsonLines(path.join(s.root,'operations.jsonl')),native=await jsonLines(path.join(s.root,'native-events.jsonl')),input=await jsonLines(path.join(s.root,'native-input.jsonl')),steps=await jsonLines(path.join(s.root,'steps.jsonl'));
 const ids=[...new Set(events.filter(e=>e.operation==='begin').map(e=>e.caseId))],name='agent-report-'+randomUUID(),directory=path.join(s.dataDir,'exports',name);await mkdir(path.join(directory,'evidence'),{recursive:true});
 const artifacts=[],cases=[];
 for(const id of ids){const attempts=[];
  for(const begin of events.filter(e=>e.caseId===id&&e.operation==='begin')){
  const verdicts=results.filter(r=>r.id===id&&r.attempt===begin.attempt),recorded=verdicts.at(-1),spec=testSpecification(recorded?.definition||begin.result?.check||definition(s,id)),retained=await evidenceFor({...s,agentAttempt:begin.attempt},id),evidence=recorded?retained.filter(e=>(recorded.evidence||[]).some(r=>r.file===e.file&&r.sha256===e.sha256)):retained;
  const resolutions=events.filter(e=>e.attempt===begin.attempt&&e.operation==='resolve'&&e.status==='Completed'),resolutionEvidence=retained.filter(e=>resolutions.some(r=>r.result?.verification===e.file));
  for(const e of [...evidence,...resolutionEvidence]){if(artifacts.some(a=>a.file===e.file))continue;const destination=path.join(directory,'evidence',e.file);await copyFile(e.path,destination);assert(await sha(destination)===e.sha256,'Agent evidence changed during export');artifacts.push({file:e.file,source:path.relative(s.root,e.path),bytes:(await stat(e.path)).size,sha256:e.sha256});}
  const inTime=e=>(e.startedAt||e.at||'')>=begin.at&&(!recorded||(e.startedAt||e.at||'')<=recorded.recordedAt),journal=events.filter(e=>e.caseId===id&&e.attempt===begin.attempt&&inTime(e)&&!['begin','record'].includes(e.operation)),within=rows=>rows.filter(e=>e.caseId===id&&inTime(e)),actions=[...actionHistory(within(app),within(native),within(input)),...journal].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  attempts.push({...spec,definitionHash:recorded?.definitionHash||spec.definitionHash,attempt:begin.attempt,mode:recorded?.mode||begin.result?.mode||'Legacy / unspecified',generation:recorded?.generation||begin.generation,proof:recorded?.proof||null,qualification:recorded?.proof?.contract?'Definition contract':'Historical record',status:recorded?.status||'Unknown',observation:recorded?.observation||'No verdict was recorded',actions,evidence,steps:stepHistory(spec,within(steps),actions),startedAt:begin.at,recordedAt:recorded?.recordedAt||null,verdictHistory:verdicts,uncertainties:uncertainties.filter(u=>u.attempt===begin.attempt),resolutions,resolutionEvidence});
  }
  const latest=attempts.at(-1),earlierFailures=attempts.slice(0,-1).flatMap(a=>a.verdictHistory.filter(v=>v.status==='Fail'));
  cases.push({...latest,id,area:definition(s,id).area||'Agent qualification',target:'computer-use',operations:[...new Set(latest.actions.map(a=>a.operation))],attempts,earlierFailures:earlierFailures.length,historyLabel:latest.status==='Pass'&&earlierFailures.length?'Retest passed · '+earlierFailures.length+' earlier failure'+(earlierFailures.length===1?'':'s')+' retained':attempts.length+' attempt'+(attempts.length===1?'':'s')});
 }
 const counts=cases.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{}),attemptCounts=cases.flatMap(c=>c.attempts.flatMap(a=>a.verdictHistory.length?a.verdictHistory:[{status:'Unknown'}])).reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{}),report={format:'athanor-agent-report/v2',runId:s.harnessId,title:'Computer-use agent session',operator:'Agent',asOf:new Date().toISOString(),execution:{state:cases.length&&cases.every(c=>c.status==='Pass')&&!(attemptCounts.Fail||attemptCounts.Unknown||attemptCounts.Blocked)&&!s.agentUncertain?'Passed':'Needs review',target:'Selected build · agent computer use',context:'Frozen definition outcomes with complete attempt history'},identities:{version:s.plan.version,packageHash:s.guiHash,adapterHash:s.toolHash},counts,attemptCounts,sessionUncertainty:s.agentUncertain?(s.agentUnknown||{error:'Unresolved historical mutation'}):null,cases,artifacts,acceptance:{gaps:cases.filter(c=>c.status==='Unknown').map(c=>c.id+': no terminal verdict')},scope:{sourceRows:[]},fixtures:{bundle:s.bundle,assets:s.assets},selection:{checks:ids},targets:[{target:'computer-use',build:s.plan.version,hash:s.guiHash,counts}]};
 await writeJSON(path.join(directory,'report.json'),report);const {renderReport}=await import('../reports.mjs');
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(directory,'index.html'),renderReport(report));await writeJSON(path.join(s.root,'agent-report-location.json'),{directory});return {path:path.join(directory,'index.html'),url:'/exports/'+name+'/index.html',counts,report:path.join(directory,'report.json')};
}
