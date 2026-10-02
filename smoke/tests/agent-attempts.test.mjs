import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {beginProof,physicalAction,verifyCheckpoint,requirePassProof,closeAttempt,validateToolParams,validateApplicationParams,validateNativeParams,withAgentAction,withAdapterAction,markUnknown,resolveUnknown} from '../desktop/agent-proof.mjs';
import {agentTool,exportAgentReport} from '../desktop/agent-tools.mjs';
import {markAgentMutation} from '../desktop/adapter.mjs';
import {writeJSON,readJSON} from '../runner/files.mjs';
const editor=JSON.parse(await readFile(new URL('../desktop/physical-editor-course.json',import.meta.url))).cases;
const desktop=JSON.parse(await readFile(new URL('../desktop/course.json',import.meta.url))).cases;
const check=id=>[...editor,...desktop].find(c=>c.id===id);
const baseline={timeline:{timeline_id:'timeline',name:'Fixture',frame_rate:{numerator:24,denominator:1}},tracks:[{track_id:'v1',address:'V1',items:[]},{track_id:'a1',address:'A1',items:[]}],links:[]};
const ui={widgets:[{id:'view',window:'main',class:'TimelineWidget'},{name:'panelSubtabSelector',text:'Fixture'}]};
function completeProof(){
 const proof=beginProof(check('P-TRACK-ADD')),base=verifyCheckpoint(proof,'baseline',baseline,ui,{});proof.baseline=baseline;proof.binding=base.binding;
 const s={currentCheck:'P-TRACK-ADD',agentAttempt:'attempt',generation:2,agentRevision:5,agentProof:proof,agentRequiredRoute:'physical'},evidence=[],events=[];let sequence=0;
 for(const [index,point] of proof.contract.checkpoints.entries()){
  for(const id of point.actions){const spec=proof.contract.actions.find(a=>a.id===id),eventId='event-'+id;proof.actions.push({...spec,receipt:{status:'Dispatched'},revision:index+2,eventId});events.push({id:eventId,caseId:s.currentCheck,attempt:s.agentAttempt,generation:2,revision:index+2,operation:'physical',status:'Completed',params:{actionId:id},result:{status:'Dispatched'}});}
  const v={file:point.id+'.json',kind:'json',provenance:'verification',assertion:point.id,caseId:s.currentCheck,attempt:s.agentAttempt,generation:2,revision:index===0?3:5,definitionHash:proof.definitionHash,sequence:++sequence};
  const c={...v,file:point.id+'.png',kind:'image',provenance:'explicit-capture',method:'presented',target:'view',verification:v.file,sequence:++sequence};evidence.push(v,c);proof.checkpoints[point.id]={verification:v.file,capture:c.file,revision:v.revision,captureTarget:'view'};
 }
 return {s,evidence,verified:evidence.filter(e=>e.kind==='json'),events};
}
test('only ordered explicit captures paired with definition verification can qualify Pass',()=>{
 const good=completeProof();assert.doesNotThrow(()=>requirePassProof(good.s,good.evidence,good.verified,good.events));
 const faults=[
  ['missing capture',f=>f.evidence=f.evidence.filter(e=>e.kind!=='image'),'capture_missing'],
  ['failure screenshot',f=>f.evidence.find(e=>e.kind==='image').provenance='diagnostic','capture_missing'],
  ['capture before verify',f=>f.evidence.find(e=>e.kind==='image').sequence=0,'capture_missing'],
  ['mutation between verify and capture',f=>f.evidence.find(e=>e.kind==='image').revision++,'capture_missing'],
  ['stale final proof',f=>f.s.agentRevision++,'stale_proof'],
  ['unqualified mutation',f=>f.s.agentProof.tainted=true,'unqualified_mutation'],
  ['unrelated physical action',f=>f.events[0].params.actionId='unrelated','required_action_missing'],
  ['Qt substituted action',f=>f.events[0].operation='native','required_action_missing'],
  ['other attempt receipt',f=>f.events[0].attempt='different','required_action_missing'],
  ['old generation capture',f=>f.evidence.find(e=>e.kind==='image').generation=1,'capture_missing'],
  ['arbitrary verification',f=>f.evidence.find(e=>e.kind==='json').provenance='diagnostic','verification_missing']
 ];
 for(const [name,mutate,code] of faults){const f=completeProof();mutate(f);assert.throws(()=>requirePassProof(f.s,f.evidence,f.verified,f.events),e=>e.code===code,name);}
});
test('a physical definition cannot be downgraded, and receipts must target its bound action',()=>{
 assert.throws(()=>beginProof(check('P-TRACK-ADD'),'hybrid'),e=>e.code==='required_physical_mode');
 const p=beginProof(check('P-TRACK-ADD')),b=verifyCheckpoint(p,'baseline',baseline,ui,{});p.baseline=baseline;p.binding=b.binding;
 const target={id:'add',window:'main',name:'panelChromeAction',text:'+ Video',enabled:true},params={actionId:'add',command:'click'};
 assert.equal(physicalAction(p,params,target).id,'add');
 for(const bad of [{...target,text:'Play'},{...target,window:'other'}])assert.throws(()=>physicalAction(p,params,bad),e=>e.code==='wrong_action_target');
 assert.throws(()=>physicalAction(p,{...params,command:'drag'},target),e=>e.code==='wrong_action_target');
 assert.throws(()=>physicalAction(p,{...params,stepId:'restore'},target),e=>e.code==='wrong_test_step');
 assert.throws(()=>physicalAction(p,{actionId:'undo',command:'key',key:'cmd+z'},{...ui.widgets[0]}),e=>e.code==='previous_checkpoint_missing');
});
test('restoration does not establish that a track was added; original tracks and empty new identity are checked',()=>{
 const {s}=completeProof(),p=s.agentProof,added=structuredClone(baseline);added.tracks.push({track_id:'new',address:'V2',items:[]});
 assert.equal(verifyCheckpoint(p,'changed',added,ui,s).matched,true);
 assert.equal(verifyCheckpoint(p,'changed',baseline,ui,s).matched,false);
 assert.equal(verifyCheckpoint(p,'restored',baseline,ui,s).matched,true);
 for(const corrupt of [a=>a.tracks[0].track_id='other',a=>a.tracks[2].address='A2',a=>a.tracks[2].items.push({kind:'clip',clip_id:'unexpected'})]){const bad=structuredClone(added);corrupt(bad);assert.equal(verifyCheckpoint(p,'changed',bad,ui,s).matched,false);}
});
test('baseline binds one observed video canvas when the editor also exposes an audio canvas',()=>{
 const p=beginProof(check('P-TRACK-ADD')),two={widgets:[...ui.widgets,{id:'audio',class:'TimelineWidget',window:'main'}]};
 assert.throws(()=>verifyCheckpoint(p,'baseline',baseline,two,{}),e=>e.code==='ambiguous_timeline');
 const result=verifyCheckpoint(p,'baseline',baseline,two,{proofTarget:'view'});assert.equal(result.binding.target,'view');
 assert.throws(()=>verifyCheckpoint(p,'baseline',baseline,two,{proofTarget:'absent'}),e=>e.code==='ambiguous_timeline');
});
test('observation-only connection has definition-owned criteria without requiring a gesture',()=>{
 const p=beginProof(check('D-CLI-01')),s={pid:123,endpoint:{pid:123},harnessId:'fixture'},app={widgets:[{id:'main',class:'MainWindow',title:'Golden.wiz — Wizard'}]};
 assert.equal(verifyCheckpoint(p,'connection',{name:'Golden fixture',bundleRevision:'r1'},app,s).matched,true);
 assert.equal(verifyCheckpoint(p,'connection',{name:'anything',bundleRevision:'r1'},app,s).matched,false);
 assert.equal(verifyCheckpoint(p,'connection',{name:'Golden fixture',bundleRevision:'r1'},app,{...s,endpoint:{pid:124}}).matched,false);
 assert.equal(verifyCheckpoint(p,'connection',{name:'Golden fixture'},app,s).matched,false);
});
test('terminal results are immutable and idempotent; a retest preserves the original failure',()=>{
 const failed={attempt:'first',status:'Fail',observation:'No new track'},history=[failed];assert.equal(closeAttempt(history,{...failed}),failed);
 assert.throws(()=>closeAttempt(history,{...failed,status:'Pass'}),e=>e.code==='attempt_closed');
 const retest={attempt:'second',status:'Pass',observation:'Track added'};history.push(closeAttempt(history,retest));assert.deepEqual(history,[failed,retest]);
});
test('resolution belongs to the original Unknown action and cannot erase its terminal verdict',()=>{
 const {s}=completeProof();s.agentUncertain=true;s.agentUnknown={id:'lost-action',params:{actionId:'add'},revision:5};s.agentProof.tainted=true;
 const e={file:'resolution.json',provenance:'resolution',unknownAction:'lost-action',attempt:s.agentAttempt,caseId:s.currentCheck,definitionHash:s.agentProof.definitionHash,revision:5,generation:2},params={actionId:'lost-action',verification:e.file,note:'The owned timeline is unchanged'};
 for(const bad of [{...e,unknownAction:'other'},{...e,provenance:'verification'},{...e,revision:4},{...e,attempt:'old'}])assert.throws(()=>resolveUnknown(structuredClone(s),params,bad,{matched:true}),x=>x.code==='resolution_verification_missing');
 assert.throws(()=>resolveUnknown(structuredClone(s),{...params,actionId:'other'},e,{matched:true}),x=>x.code==='invalid_resolution');
 const unknown={attempt:s.agentAttempt,status:'Unknown',observation:'Response lost'},history=[unknown],resolved=resolveUnknown(s,params,e,{matched:true});assert.equal(resolved.action.id,'lost-action');assert.equal(s.agentUncertain,false);assert.equal(s.agentProof.tainted,true);assert.equal(resolved.requiresRetest,true);
 assert.throws(()=>closeAttempt(history,{...unknown,status:'Pass'}),x=>x.code==='attempt_closed');assert.deepEqual(history,[unknown]);
});
test('tool and nested application/native field typos are rejected, with structured recovery',()=>{
 for(const [op,p] of [['physical',{command:'click',durationMss:1000}],['verify',{read:{operation:'timeline.inspect',param:{}}}],['observe',{selector:{clas:'Button'}}]])assert.throws(()=>validateToolParams(op,p),e=>e.code==='unknown_parameter'&&e.status==='Blocked'&&e.nextActions.includes('correct_parameters'));
 const schema={operations:{'timeline.inspect':{properties:{timeline_id:{type:'string'},page:{properties:{max_items:{type:'integer'}},additionalProperties:false}},additionalProperties:false}}};
 assert.doesNotThrow(()=>validateApplicationParams(schema,'timeline.inspect',{timeline_id:'t',page:{max_items:5}}));
 assert.throws(()=>validateApplicationParams(schema,'timeline.inspect',{timeline_id:'t',page:{max_item:5}}),e=>e.code==='unknown_parameter');
 assert.throws(()=>validateNativeParams('click',{target:'button',dubbel:true}),e=>e.code==='unknown_parameter');
});
test('shared adapter mutations and uncertainty invalidate proof; rejected field typos never dispatch',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-proof-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=path.join(data,'session'),bundle=path.join(root,'projects/Golden.wiz');await mkdir(bundle,{recursive:true});const file=path.join(root,'session.json'),{s}=completeProof();
  await writeJSON(file,{...s,dataDir:data,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),agentTracking:true,schema:{operations:{}}});
  await assert.rejects(()=>agentTool(file,'physical',{command:'click',durationMss:2}),e=>e.code==='unknown_parameter');assert.equal((await readJSON(file)).agentRevision,5);assert.equal((await readJSON(file)).agentProof.tainted,false);
  const latest=await readJSON(file);await markAgentMutation(file,latest);assert.equal((await readJSON(file)).agentProof.tainted,true);
  await withAgentAction(file,async()=>{await markUnknown(file,Error('Response lost'));},{operation:'physical',params:{actionId:'add'}});
  const uncertain=await readJSON(file);assert.equal(uncertain.agentUncertain,true);assert.equal(uncertain.agentUnknown.operation,'physical');assert.equal(uncertain.agentUnknown.params.actionId,'add');assert.ok(uncertain.agentUnknown.id);
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
test('export preserves failed attempt, mode and later retest alongside each frozen verdict',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-history-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=path.join(data,'session'),bundle=path.join(root,'projects/Golden.wiz');await mkdir(bundle,{recursive:true});const file=path.join(root,'session.json'),definition=check('P-TRACK-ADD');
  await writeJSON(file,{dataDir:data,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),harnessId:'history',generation:1,guiHash:'package',plan:{version:'test',cases:[]},agentDefinitions:[definition],currentCheck:definition.id,agentAttempt:'retest',agentTracking:true});
  const begins=[{id:'b1',operation:'begin',caseId:definition.id,attempt:'failed',at:'2026-10-01T10:00:00Z',result:{mode:'physical',check:definition}},{id:'b2',operation:'begin',caseId:definition.id,attempt:'retest',at:'2026-10-01T10:03:00Z',result:{mode:'physical',check:definition}}];
  const results=[{id:definition.id,attempt:'failed',status:'Fail',observation:'No new track',mode:'physical',recordedAt:'2026-10-01T10:02:00Z',evidence:[],definition},{id:definition.id,attempt:'retest',status:'Pass',observation:'Correct track',mode:'physical',recordedAt:'2026-10-01T10:04:00Z',evidence:[],definition}];
  await writeFile(path.join(root,'agent-tools.jsonl'),begins.map(JSON.stringify).join('\n')+'\n');await writeFile(path.join(root,'agent-results.jsonl'),results.map(JSON.stringify).join('\n')+'\n');
  const exported=await exportAgentReport(file),r=await readJSON(exported.report);assert.deepEqual(r.attemptCounts,{Fail:1,Pass:1});assert.deepEqual(r.cases[0].attempts.map(a=>[a.status,a.mode]),[['Fail','physical'],['Pass','physical']]);assert.equal(r.execution.state,'Needs review');assert.match(r.cases[0].historyLabel,/earlier failure/);
  const html=await readFile(exported.path,'utf8');assert.match(html,/Attempt history/);assert.match(html,/No new track/);assert.match(html,/Retest passed/);
  // The real toolkit returns the same receipt before touching an expired process.
  const duplicate=await agentTool(file,'record',{status:'Pass',note:'Correct track'});assert.deepEqual(duplicate,results[1]);
  await assert.rejects(()=>agentTool(file,'record',{status:'Fail',note:'Changed my mind'}),e=>e.code==='attempt_closed');
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
test('closed attempts reject direct shared-adapter mutations and retain shutdown uncertainty outside the verdict',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-closed-route-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=path.join(data,'session'),bundle=path.join(root,'projects/Golden.wiz');await mkdir(bundle,{recursive:true});const file=path.join(root,'session.json'),definition=check('D-CLI-01'),record={id:definition.id,attempt:'closed',status:'Pass',observation:'Connected',recordedAt:'2026-10-01T10:01:00Z',definition,evidence:[]};
  await writeJSON(file,{dataDir:data,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),harnessId:'closed',generation:1,guiHash:'package',plan:{version:'test',cases:[]},agentDefinitions:[definition],currentCheck:definition.id,agentAttempt:'closed',agentTracking:true,agentRevision:1});
  await writeFile(path.join(root,'agent-tools.jsonl'),JSON.stringify({operation:'begin',caseId:definition.id,attempt:'closed',at:'2026-10-01T10:00:00Z',result:{mode:'hybrid',check:definition}})+'\n');await writeFile(path.join(root,'agent-results.jsonl'),JSON.stringify(record)+'\n');
  let calls=0;for(const operation of ['timeline.update','click','drag'])await assert.rejects(()=>withAdapterAction(file,true,operation,{},async()=>{calls++;}),e=>e.code==='attempt_closed');assert.equal(calls,0);
  await assert.rejects(()=>withAgentAction(file,()=>withAdapterAction(file,true,'timeline.update',{},async()=>{calls++;}),{purpose:'shutdown',operation:'stop'}),e=>e.code==='attempt_closed');assert.equal(calls,0,'Shutdown context must not grant editing authority');
  await assert.rejects(async()=>markAgentMutation(file,await readJSON(file)),e=>e.code==='attempt_closed');assert.equal((await readJSON(file)).agentRevision,1);
  await assert.rejects(()=>withAgentAction(file,()=>withAdapterAction(file,true,'quit',{},async()=>{throw Object.assign(Error('Shutdown response lost'),{status:'Unknown'});}),{purpose:'shutdown',operation:'stop'}),e=>e.status==='Unknown');
  assert.deepEqual(await agentTool(file,'record',{status:'Pass',note:'Connected'}),record);
  const r=await readJSON((await exportAgentReport(file)).report);assert.equal(r.cases[0].status,'Pass');assert.equal(r.execution.state,'Needs review');assert.equal(r.sessionUncertainty.operation,'stop');assert.equal(r.cases[0].attempts[0].uncertainties[0].error,'Shutdown response lost');
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
