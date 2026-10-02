import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,appendFile,readFile,copyFile,realpath,stat} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {nativeCall,desktopCall,verifyDesktopOwner,verifyDesktopPaths,captureDesktopFailure,agentReadOperations,agentReadNative} from './adapter.mjs';
import {physicalInput} from './physical-input.mjs';
import {nativeDesktopInput} from './macos-input.mjs';
import {verifyDesktopLease} from './desktop-lease.mjs';
import {waitForObservation} from './check-support.mjs';
import {readJSON,writeJSON,inside,sha} from '../runner/files.mjs';
import {OutcomeError,assert} from '../runner/engine.mjs';
import {testSpecification,candidateChecks,actionHistory,stepHistory} from '../test-details.mjs';

const readOps=agentReadOperations,readNative=agentReadNative;
const selectorKeys=['id','class','name','text','tooltip','title','window','parent','enabled','active','contains'];
const operations=['context','preflight','observe','find','physical','native','call','wait','capture','begin','verify','resolve','record','report'];

export function selectUI(ui,{kind='widgets',selector={},limit=20,details=false}={}){
 assert(['widgets','actions'].includes(kind)&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Choose widgets/actions and a limit from 1 to 100');
 assert(selector&&typeof selector==='object'&&!Array.isArray(selector)&&Object.keys(selector).every(k=>selectorKeys.includes(k)),'Unsupported target selector');
 const keys=Object.keys(selector).filter(k=>k!=='contains');
 const matches=(ui[kind]||[]).filter(w=>keys.every(k=>selector.contains&&typeof selector[k]==='string'?typeof w[k]==='string'&&w[k].includes(selector[k]):w[k]===selector[k]));
 const summary=['id','class','name','text','tooltip','title','window','parent','enabled','active','x','y','width','height','value','minimum','maximum','checked','index','rows','viewport','handle','minHandle','maxHandle','groove'];
 return {kind,matchCount:matches.length,truncated:matches.length>limit,limits:{modelRows:64,sceneItems:128,sceneText:256},matches:matches.slice(0,limit).map(w=>{
  const result=Object.fromEntries(summary.filter(k=>w[k]!==undefined).map(k=>[k,w[k]]));
  if(details)for(const k of ['model','itemRects','sceneItems','sceneText','tabs','tabRects','items','menuItems','selectedRows'])if(w[k]!==undefined)result[k]=w[k];
  if(w.rows!==undefined)result.modelTruncated=w.rows>(w.model?.length||0);
  return result;
 })};
}
export function uniqueTarget(ui,selector,kind='widgets'){
 const selected=selectUI(ui,{kind,selector:typeof selector==='string'?{id:selector}:selector,details:true,limit:10});
 if(selected.matchCount!==1){const e=new OutcomeError('Target must match exactly one '+kind+' entry; found '+selected.matchCount+'. Narrow the selector.','Blocked');e.diagnostics=selected;throw e;}
 return selected.matches[0];
}
export function compareObservation(value,{path:keys=[],equals,notEquals,length,includes}={}){
 assert(Array.isArray(keys)&&keys.length<=20&&keys.every(k=>(typeof k==='string'||Number.isInteger(k))&&!['__proto__','constructor','prototype'].includes(k)),'Use a bounded array of property names or indexes');
 let actual=value;for(const key of keys){if(actual===null||typeof actual!=='object'||!Object.hasOwn(actual,key))return {matched:false,missing:true,path:keys};actual=actual[key];}
 const expected={};if(equals!==undefined)expected.equals=equals;if(notEquals!==undefined)expected.notEquals=notEquals;if(length!==undefined)expected.length=length;if(includes!==undefined)expected.includes=includes;
 assert(Object.keys(expected).length>0,'Verification needs equals, notEquals, length or includes');
 const matched=(equals===undefined||isDeepStrictEqual(actual,equals))&&(notEquals===undefined||!isDeepStrictEqual(actual,notEquals))&&(length===undefined||actual?.length===length)&&(includes===undefined||(Array.isArray(actual)?actual.some(x=>isDeepStrictEqual(x,includes)):typeof actual==='string'&&actual.includes(includes)));
 return {matched,actual,expected,path:keys};
}
export function requirePassProof(s,evidence,verified,events=[]){
 assert(!s.agentUncertain,'An Unknown mutation cannot be recorded as Pass');
 const current=evidence.filter(e=>e.attempt===s.agentAttempt&&e.caseId===s.currentCheck&&e.revision===(s.agentRevision||0)&&e.generation===s.generation);
 assert(current.some(e=>e.kind==='image'),'Pass needs a current captured result');
 assert(verified.some(e=>current.includes(e)),'Pass needs a successful current independent verification');
 if(s.agentRequiredRoute==='physical')assert(events.some(e=>e.caseId===s.currentCheck&&e.attempt===s.agentAttempt&&e.operation==='physical'&&e.status==='Completed'&&e.result?.status==='Dispatched'),'This check requires a physical input receipt');
}
const definitions=s=>[...(s.plan.cases||[]),...candidateChecks()];
const definition=(s,id)=>definitions(s).find(c=>c.id===id);

export async function sessionContext(file){
 const s=await readJSON(file);verifyDesktopPaths(s);
 const ready=await readJSON(path.join(s.native,'ready.json'));
 const result={format:'athanor-agent-session/v1',session:file,build:{app:s.sourceApp,packageHash:s.guiHash,version:s.plan.version},process:{pid:s.pid,started:s.processStart,generation:s.generation},project:{bundle:s.bundle,main:s.main,alternate:s.alternate,assets:s.assets},adapter:ready.capabilities,physical:{commands:['click','drag','key','screenshot'],keys:['escape','return','tab','space','delete','k','n','s','a','z','d','c','v'],coordinates:'Widget-relative macOS points; target and destination geometry are rechecked before dispatch'},operations,checks:definitions(s).filter(c=>s.plan.cases?.some(x=>x.id===c.id)||c.id.startsWith('P-')).map(testSpecification),evidenceDirectory:path.join(s.root,'evidence'),guidance:[
  'Use CLI/Qt operations to prepare a fixture; perform the action under test with physical input.',
  'Resolve targets from a fresh observation. An ambiguous target is Blocked.',
  'Use wait for read-only conditions. Never replay an Unknown mutation.',
  'Begin a check, describe actions with title, verify independently, capture the displayed result, then record.',
  'Pass recording requires a current verification and image tied to this check, generation and last tool mutation.',
  'Candidate physical checks do not change canonical acceptance. Raw call/native commands are escape hatches; use tool call/native to keep the evidence revision current.',
  'Stop the session when done. The foreground lease is shared across Athanor workspaces and released when its launcher exits.'
 ]};
 await writeJSON(path.join(s.root,'agent-context.json'),result);return result;
}

async function retain(s,label,value,kind='json'){
 s=await readJSON(path.join(s.root,'session.json'));
 await mkdir(path.join(s.root,'evidence'),{recursive:true});const name='agent-'+randomUUID()+(kind==='json'?'.json':'.png'),file=path.join(s.root,'evidence',name);
 if(kind==='json')await writeJSON(file,value);else{assert(inside(s.root,await realpath(value)),'Capture escaped the session');await copyFile(value,file);}
 const evidence={file:name,path:file,kind,caption:label,sha256:await sha(file),caseId:s.currentCheck||null,attempt:s.agentAttempt||null,generation:s.generation,revision:s.agentRevision||0};
 await appendFile(path.join(s.root,'agent-evidence.jsonl'),JSON.stringify(evidence)+'\n');return evidence;
}
async function journal(s,operation,params,start,result,status='Completed'){
 params={...params,stepId:params.stepId||s.currentStep,title:params.title||definition(s,s.currentCheck)?.steps?.find(step=>step.id===s.currentStep)?.title};
 const entry={id:randomUUID(),caseId:s.currentCheck||null,attempt:s.agentAttempt||null,stepId:params.stepId||null,title:params.title||({observe:'Observe the target controls',find:'Locate one target',physical:'Perform physical '+params.command,wait:'Wait for the expected state',capture:'Capture the displayed result',verify:'Verify the expected outcome'}[operation]||operation),operation,channel:operation==='physical'?'Physical input':operation==='call'?'Application':operation==='native'?'Qt adapter':'Agent toolkit',status,at:new Date(start).toISOString(),durationMs:Date.now()-start,revision:s.agentRevision||0,result};
 await appendFile(path.join(s.root,'agent-tools.jsonl'),JSON.stringify(entry)+'\n');return entry;
}

export async function agentTool(file,operation,params={}){
 assert(operations.includes(operation),'Unknown agent tool: '+operation);assert(params&&typeof params==='object'&&!Array.isArray(params),'Supply a JSON object');
 let s=await readJSON(file);verifyDesktopPaths(s);
 if(operation==='context')return sessionContext(file);
 if(operation==='report')return exportAgentReport(file);
 verifyDesktopOwner(s);verifyDesktopLease(s);
 const start=Date.now(),mutating=operation==='physical'&&params.command!=='screenshot'||operation==='call'&&!readOps.includes(params.operation)||operation==='native'&&!readNative.includes(params.operation);
 if(mutating&&s.agentUncertain)throw new OutcomeError('An earlier mutation is Unknown. Inspect and verify it, then use resolve before another edit.','Blocked');
 let result;
 try{
  if(operation==='preflight'){
   const observed=await nativeDesktopInput(file,{command:'inspect',mode:'window-server',depth:0});result={pid:observed.pid,started:observed.started,permissions:observed.permissions,frontmost:observed.frontmost,windows:observed.windows,ready:observed.permissions?.input===true&&observed.permissions?.screenCapture===true};
  }else if(operation==='observe'||operation==='find'){
   const ui=await nativeCall(file,'inspect');result=operation==='find'?uniqueTarget(ui,params.selector,params.kind):selectUI(ui,params);result={...result,observedAt:new Date().toISOString(),generation:s.generation,observationBytes:{full:Buffer.byteLength(JSON.stringify(ui)),returned:Buffer.byteLength(JSON.stringify(result))}};
  }else if(operation==='physical'){
   assert(['click','drag','key','screenshot'].includes(params.command),'Unsupported physical command');
   const ui=await nativeCall(file,'inspect'),target=uniqueTarget(ui,params.target||params.selector);
   const p={target:target.id,expected:target};for(const k of ['button','durationMs','chrome','key'])if(params[k]!==undefined)p[k]=params[k];
   if(!['key','screenshot'].includes(params.command)){p.x=params.x??target.width*(params.xRatio??.5);p.y=params.y??target.height*(params.yRatio??.5);}
   if(params.command==='drag'){const to=uniqueTarget(ui,params.toTarget||params.target||params.selector);p.toTarget=to.id;p.toX=params.toX??to.width*(params.toXRatio??.5);p.toY=params.toY??to.height*(params.toYRatio??.5);}
   result=await physicalInput(file,params.command,p);
  }else if(operation==='call'||operation==='native')result=await (operation==='call'?desktopCall:nativeCall)(file,params.operation,params.params||{});
  else if(operation==='wait'){
   assert(['exists','absent','enabled','value','text','checked'].includes(params.condition||'exists'),'Unsupported wait condition');
   result=await waitForObservation(async()=>{
    const found=selectUI(await nativeCall(file,'inspect'),{selector:params.selector,kind:params.kind,details:true});
    if(params.condition==='absent')return found.matchCount===0?{absent:true}:false;
    if(found.matchCount>1)throw new OutcomeError('Wait target is ambiguous; narrow the selector.','Blocked');
    if(found.matchCount===0)return false;const target=found.matches[0],condition=params.condition||'exists';
    return condition==='exists'||condition==='enabled'&&target.enabled===true||['value','text','checked'].includes(condition)&&isDeepStrictEqual(target[condition],params.expected)?target:false;
   },{description:params.title||'Target '+(params.condition||'exists'),timeoutMs:params.timeoutMs||5000,intervalMs:params.intervalMs||150});
  }else if(operation==='capture'){
   const target=uniqueTarget(await nativeCall(file,'inspect'),params.target||params.selector),kind=params.kind||'presented';assert(['presented','widget','window'].includes(kind),'Choose presented, widget or window capture');
   const capture=kind==='window'?await physicalInput(file,'screenshot',{target:target.id}):await nativeCall(file,kind==='presented'?'snapshot-presented':'snapshot-widget',{target:target.id});
   result=await retain(s,params.title||({presented:'Displayed native window pixels',widget:'Qt widget raster',window:'Owned native window'}[kind]),capture.path||capture.output,'image');
  }else if(operation==='begin'){
   assert(!s.agentUncertain,'Resolve the Unknown action before starting another check');assert(definition(s,params.id),'Choose a check from this session context');assert(params.mode===undefined||['physical','hybrid'].includes(params.mode),'Choose physical or hybrid mode');s.currentCheck=params.id;s.currentStep=null;s.agentTracking=true;s.agentRequiredRoute=params.mode||(params.id.startsWith('P-')?'physical':'hybrid');s.agentAttempt=randomUUID();s.agentRevision=(s.agentRevision||0)+1;await writeJSON(file,s);result={check:testSpecification(definition(s,params.id)),revision:s.agentRevision,attempt:s.agentAttempt,mode:s.agentRequiredRoute};
  }else if(operation==='verify'){
   assert(s.currentCheck,'Begin a check before verification');let observed;
   if(params.read){assert(readOps.includes(params.read.operation),'Verification may only call declared read-only operations');observed=await desktopCall(file,params.read.operation,params.read.params||{});}
   else observed=uniqueTarget(await nativeCall(file,'inspect'),params.selector,params.kind);
   const comparison=compareObservation(observed,params.expect);const evidence=await retain(s,params.title||'Independent verification',{...comparison,read:params.read||null,selector:params.selector||null});
   if(!comparison.matched){const e=new OutcomeError('Verification did not match the expected outcome','Fail');e.diagnostics={comparison,evidence};throw e;}result={verified:true,...evidence};
  }else if(operation==='resolve'){
   assert(s.agentUncertain&&typeof params.note==='string'&&params.note.trim(),'Resolution requires an Unknown action and an explanation');
   const evidence=await evidenceFor(s,s.currentCheck);let verified=false;for(const e of evidence)if(e.kind==='json'&&e.revision===s.agentRevision&&e.generation===s.generation&&(await readJSON(e.path)).matched===true)verified=true;
   assert(verified,'Resolve needs a current independent verification of the actual state');s.agentUncertain=false;await writeJSON(file,s);result={resolved:true,note:params.note.trim()};
  }else if(operation==='record'){
   assert(s.currentCheck&&['Pass','Fail','Blocked','Unknown'].includes(params.status)&&typeof params.note==='string'&&params.note.trim(),'Begin a check and supply its verdict and observation');
   const evidence=await evidenceFor(s,s.currentCheck);
   if(params.status==='Pass'){
    const verified=[];for(const e of evidence.filter(e=>e.kind==='json'))if((await readJSON(e.path)).matched===true)verified.push(e);
    requirePassProof(s,evidence,verified,await jsonLines(path.join(s.root,'agent-tools.jsonl')));
   }
   result={id:s.currentCheck,attempt:s.agentAttempt,status:params.status,observation:params.note.trim(),recordedAt:new Date().toISOString(),generation:s.generation,revision:s.agentRevision,evidence,oracle:'Agent-reviewed computer-use observations with retained verification'};
   await appendFile(path.join(s.root,'agent-results.jsonl'),JSON.stringify(result)+'\n');
  }
  const latest=await readJSON(file);await journal(latest,operation,params,start,result);return result;
 }catch(e){const evidence=await captureDesktopFailure(file,e,'agent-'+operation);const latest=await readJSON(file);if(e.status==='Unknown'&&mutating){latest.agentUncertain=true;await writeJSON(file,latest);}if(evidence.failureScreenshot)await retain(latest,'App state when '+operation+' failed',evidence.failureScreenshot,'image');if(evidence.failureState)await retain(latest,'Failure diagnostics',await readJSON(evidence.failureState));await journal(latest,operation,params,start,{error:e.message,diagnostics:e.diagnostics||null,evidence},e.status||'Fail');e.evidence=evidence;throw e;}
}
async function jsonLines(file){try{return (await readFile(file,'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function evidenceFor(s,id){
 const evidence=(await jsonLines(path.join(s.root,'agent-evidence.jsonl'))).filter(e=>e.caseId===id&&e.attempt===s.agentAttempt);
 for(const e of evidence)assert(inside(path.join(s.root,'evidence'),await realpath(e.path))&&await sha(e.path)===e.sha256,'Recorded agent evidence changed');return evidence;
}
export async function exportAgentReport(file){
 const s=await readJSON(file);verifyDesktopPaths(s);const events=await jsonLines(path.join(s.root,'agent-tools.jsonl')),results=await jsonLines(path.join(s.root,'agent-results.jsonl'));
 const app=await jsonLines(path.join(s.root,'operations.jsonl')),native=await jsonLines(path.join(s.root,'native-events.jsonl')),input=await jsonLines(path.join(s.root,'native-input.jsonl')),steps=await jsonLines(path.join(s.root,'steps.jsonl'));
 const ids=[...new Set(events.filter(e=>e.operation==='begin').map(e=>e.caseId))],directory=path.join(s.root,'agent-report-'+randomUUID());await mkdir(path.join(directory,'evidence'),{recursive:true});
 const artifacts=[],cases=[];
 for(const id of ids){const begin=events.findLast(e=>e.caseId===id&&e.operation==='begin'),recorded=results.findLast(r=>r.id===id&&r.attempt===begin.attempt),spec=testSpecification(definition(s,id)),evidence=await evidenceFor({...s,agentAttempt:begin.attempt},id);
  for(const e of evidence){await copyFile(e.path,path.join(directory,'evidence',e.file));artifacts.push({file:e.file,source:path.relative(s.root,e.path),bytes:(await stat(e.path)).size,sha256:e.sha256});}
  const journal=events.filter(e=>e.caseId===id&&e.attempt===begin.attempt&&!['begin','record'].includes(e.operation)),within=rows=>rows.filter(e=>e.caseId===id&&(e.startedAt||e.at||'')>=begin.at),actions=[...actionHistory(within(app),within(native),within(input)),...journal].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  cases.push({...spec,area:definition(s,id).area||'Agent qualification',target:'computer-use',status:recorded?.status||'Unknown',observation:recorded?.observation||'No verdict was recorded',operations:[...new Set(actions.map(a=>a.operation))],actions,evidence,steps:stepHistory(spec,within(steps),actions),recordedAt:recorded?.recordedAt||null});
 }
 const counts=cases.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{}),report={format:'athanor-agent-report/v1',runId:s.harnessId,title:'Computer-use agent session',operator:'Agent',asOf:new Date().toISOString(),execution:{state:cases.length&&cases.every(c=>c.status==='Pass')?'Passed':'Needs review',target:'Selected build · agent computer use',context:'Agent-reviewed outcomes'},identities:{version:s.plan.version,packageHash:s.guiHash,adapterHash:s.toolHash},counts,cases,artifacts,acceptance:{gaps:cases.filter(c=>c.status==='Unknown').map(c=>c.id+': no terminal verdict')},scope:{sourceRows:[]},fixtures:{bundle:s.bundle,assets:s.assets},selection:{checks:ids},targets:[{target:'computer-use',build:s.plan.version,hash:s.guiHash,counts}]};
 await writeJSON(path.join(directory,'report.json'),report);const {renderReport}=await import('../reports.mjs');await writeJSON(path.join(s.root,'agent-report-location.json'),{directory});
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(directory,'index.html'),renderReport(report));return {path:path.join(directory,'index.html'),counts,report:path.join(directory,'report.json')};
}
