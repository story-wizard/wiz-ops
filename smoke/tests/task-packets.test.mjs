import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {prepareAgentTask} from '../desktop/agent-task.mjs';
import {timelineClipAnswer,rightTrimOutcome} from '../desktop/ui-query.mjs';
import {validateToolParams,toolInterface} from '../desktop/agent-proof.mjs';
import {compactToolResult,validateSequence} from '../desktop/agent-connection.mjs';
import {runAgentPlan} from '../desktop/agent-plan.mjs';
import {compileAgentRecipe} from '../desktop/agent-recipes.mjs';
import {learnProcedure,procedureLearning} from '../desktop/agent-learning.mjs';
import {sha,digest} from '../runner/files.mjs';

const fixture=()=>({bundle_revision:'a'.repeat(40),timeline:{timeline_id:'timeline',name:'Main',fps:24,duration_seconds:5},tracks:[
 {track_id:'v',address:'V1',items:[{kind:'gap',timeline_range:{start_seconds:0,end_seconds:1}},
  {kind:'clip',clip_id:'clip',track_id:'v',speed:1,source:{asset_id:'asset',timing:'timed',fps:24,source_availability:'bounded',projection_status:'exact',projection_diagnostics:[],source_range:{start_seconds:1,end_seconds:5}},timeline_range:{start_seconds:1,end_seconds:5}}]},
 {track_id:'a',address:'A1',items:[{kind:'gap',timeline_range:{start_seconds:0,end_seconds:5}}]}],links:[],multicam_catalogs:[],next_cursor:null});
const controls=()=>({focus:'search',widgets:[{id:'main',keyWindow:true},{id:'canvas',class:'TimelineWidget',window:'main',clipIds:['clip'],clipIdsTruncated:false},{name:'panelSubtabSelector',window:'main',text:'Main'}]});
async function workspace(run){
 const data=await realpath(await mkdtemp('/private/tmp/athanor-task-packet-')),root=data+'/session';await mkdir(root);
 const previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 const file=root+'/session.json',session={dataDir:data,root,bundle:root+'/Golden.wiz',native:root+'/native',executable:root+'/Wizard Smoke.app/Contents/MacOS/wizard',schema:{operations:{'project.get_name':{properties:{}}}}};
 await mkdir(session.bundle);await mkdir(session.native);await writeFile(session.native+'/ready.json',JSON.stringify({capabilities:{}}));
 await writeFile(file,JSON.stringify(session));
 try{await run(file,session);}finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
}
test('timeline packet supplies complete shapes through one read, without input or file changes',async()=>workspace(async(file,session)=>{
 const baseline=fixture(),ui=controls(),seen=[],before=await readFile(file),listing=await readdir(session.root);
 const execute=async(_file,op,params)=>{seen.push({op,params});return timelineClipAnswer(ui,baseline,'clip',params);};
 const packet=await prepareAgentTask(file,{intent:'timeline-trim',values:{timelineId:'timeline',clipId:'clip',endSeconds:4}},execute);
 assert.deepEqual(seen,[{op:'query',params:{question:'timeline-clip',timelineId:'timeline',clipId:'clip',includeBaseline:true}}]);
 assert.equal(packet.executed,false);assert.equal(packet.status,'Observed');assert.equal(packet.runRequest,undefined);
 assert.deepEqual(packet.context.baseline,baseline);assert.equal(packet.context.focus.canvasFocused,false);
 assert.equal(packet.baselineHash,digest(baseline));assert.equal(packet.schemaHash,digest(session.schema));
 assert.equal(packet.requests.undo.params.requireFocus,true);assert.equal(packet.requests.redo.params.key,'cmd+shift+z');
 assert.deepEqual(packet.requests.trim.params.toTimelinePoint,{trackIndex:0,timeSeconds:4});
 for(const phase of packet.procedure)validateSequence(phase.steps.map(name=>packet.requests[name]),session.schema);
 assert(!packet.procedure.find(p=>p.id==='restored').steps.includes('save'));
 assert.deepEqual(await readFile(file),before);assert.deepEqual(await readdir(session.root),listing);
 const reply=await compactToolResult(file,'task',packet);assert.deepEqual(reply.summary.requests,packet.requests);assert.deepEqual(reply.summary.procedure,packet.procedure);assert.deepEqual(reply.summary.context.focus,packet.context.focus);
 assert.equal(JSON.parse(await readFile(reply.receipt.path)).result.context.baseline.tracks[0].items[1].source.asset_id,'asset');
 assert.equal(toolInterface('task').intents[0].id,'timeline-trim');
 assert.equal(timelineClipAnswer(ui,baseline,'clip').baseline,undefined,'Existing queries do not add a large baseline by default');
}));
test('task packet rejects bad requests and unsupported fixtures without returning input instructions',async()=>workspace(async file=>{
 const values={timelineId:'timeline',clipId:'clip',endSeconds:4};let reads=0;
 for(const params of [{intent:'unknown',values},{intent:'timeline-trim',recipe:'project-identity',values},{intent:'timeline-trim',values:{...values,oldTarget:'old'}},{intent:'timeline-trim',values:{...values,endSeconds:null}}]){
  await assert.rejects(()=>prepareAgentTask(file,params,async()=>{reads++;}));
 }assert.equal(reads,0);
 for(const mutate of [b=>b.next_cursor='next',b=>b.tracks[0].items[1].speed=2,b=>b.tracks[0].items[1].source.fps=25,b=>b.tracks[0].items[1].source.projection_status='rejected',b=>b.tracks[0].address='A2']){
  const baseline=fixture();mutate(baseline);
  await assert.rejects(()=>prepareAgentTask(file,{intent:'timeline-trim',values},async()=>timelineClipAnswer(controls(),baseline,'clip',{includeBaseline:true})));
 }
 await assert.rejects(()=>prepareAgentTask(file,{intent:'timeline-trim',values:{...values,endSeconds:4.01}},async()=>timelineClipAnswer(controls(),fixture(),'clip',{includeBaseline:true})),e=>e.code==='unsupported_fixture');
 for(const params of [{question:'timeline-clip',timelineId:'t',clipId:'c',includeBaseline:'yes'},{question:'timeline-trim',timelineId:'t',clipId:'c',includeBaseline:true}])assert.throws(()=>validateToolParams('query',params));
}));
test('packet verification catches a no-op and unrelated changes instead of accepting dispatch',async()=>workspace(async file=>{
 const baseline=fixture(),packet=await prepareAgentTask(file,{intent:'timeline-trim',values:{timelineId:'timeline',clipId:'clip',endSeconds:4}},async()=>timelineClipAnswer(controls(),baseline,'clip',{includeBaseline:true}));
 assert.equal(rightTrimOutcome(baseline,baseline,packet.requests.changed.params).matched,false);
 const changed=structuredClone(baseline),item=changed.tracks[0].items[1];item.timeline_range.end_seconds=4;item.source.source_range.end_seconds=4;changed.tracks[0].items.push({kind:'gap',timeline_range:{start_seconds:4,end_seconds:5}});
 assert.equal(rightTrimOutcome(baseline,changed,packet.requests.changed.params).matched,true);
 changed.timeline.duration_seconds=4;assert.equal(rightTrimOutcome(baseline,changed,packet.requests.changed.params).matched,false);
}));
test('reusable trim recipe stops before stale-baseline input and after a no-op without claiming success',async()=>workspace(async file=>{
 const baseline=fixture(),packet=await prepareAgentTask(file,{intent:'timeline-trim',values:{timelineId:'timeline',clipId:'clip',endSeconds:4}},async()=>timelineClipAnswer(controls(),baseline,'clip',{includeBaseline:true}));
 const recipe=JSON.parse(await readFile(new URL('../examples/recipes/timeline-right-trim.json',import.meta.url))),compiled=compileAgentRecipe(recipe,packet.reuse.recipeRequest.values);
 for(const behavior of ['stale','no-op','changed']){
  const current=structuredClone(baseline);if(behavior==='stale')current.timeline.name='Different';let inputs=0,captures=0;
  const result=await runAgentPlan(file,compiled.plan,async(_file,op,p)=>{
   if(op==='preflight')return {ready:true};
   if(op==='query')return rightTrimOutcome(p.baseline,current,p);
   if(op==='capture'){captures++;return {sha256:'a'.repeat(64),kind:'image'};}
   if(op==='physical'){
    inputs++;if(behavior==='changed'){current.tracks[0].items[1].timeline_range.end_seconds=4;current.tracks[0].items[1].source.source_range.end_seconds=4;current.tracks[0].items.push({kind:'gap',timeline_range:{start_seconds:4,end_seconds:5}});}
    return {status:'Dispatched'};
   }throw Error('Unexpected operation');
  },{requestId:behavior});
  assert.equal(result.status,behavior==='changed'?'Completed':'Fail');
  assert.equal(inputs,behavior==='stale'?0:1);assert.equal(captures,behavior==='stale'?0:behavior==='no-op'?1:2);
  assert.equal(compiled.plan.phases[0].next,null,'Review before Undo or another edit');
 }
}));
test('learning reads real executor receipts, preserves failure/Unknown and exports no replayable state',async()=>workspace(async(file,session)=>{
 const plan={format:'athanor-agent-plan/v1',start:'observe',phases:[{id:'observe',steps:[{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'secret-project-name'}}],next:null}]};
 for(const status of ['Completed','Fail','Unknown']){
  const result=await runAgentPlan(file,plan,async()=>{if(status==='Unknown')throw Object.assign(Error('lost input'),{status:'Unknown'});return {name:status==='Fail'?'wrong':'secret-project-name'};},{requestId:status,compact:true});
  assert.equal(result.status,status);
  const receipt=JSON.parse(await readFile(result.receipt.path)),learning=await learnProcedure(result.receipt.path,result.receipt.sha256);
  assert.equal(receipt.schemaHash,digest(session.schema));assert.equal(learning.source.schemaHash,receipt.schemaHash);
  assert.equal(learning.observed.outcome,status);assert.equal(learning.executable,false);assert.equal(learning.accepted,false);
  assert.equal(learning.plan,undefined);assert(!JSON.stringify(learning).includes('secret-project-name'));assert(!JSON.stringify(learning).includes(file));
  if(status==='Fail')assert.equal(learning.observed.phases[0].steps[0].gateMatched,false);
  if(status==='Unknown')assert.match(learning.nextActions.join(' '),/Reconcile/);
  const before=await readFile(result.receipt.path),listing=await readdir(session.root);
  const cli=spawnSync(process.execPath,[new URL('../desktop/session.mjs',import.meta.url).pathname,'learn',result.receipt.path,'--sha256',result.receipt.sha256],{encoding:'utf8'});
  assert.equal(cli.status,0);assert.deepEqual(JSON.parse(cli.stdout),learning);
  assert.deepEqual(await readFile(result.receipt.path),before);assert.deepEqual(await readdir(session.root),listing);
  await assert.rejects(()=>learnProcedure(result.receipt.path,'0'.repeat(64)),e=>e.code==='learning_receipt_mismatch');
  const incomplete=structuredClone(receipt);incomplete.status='Running';assert.throws(()=>procedureLearning(incomplete,result.receipt.sha256));
  const corrupt=structuredClone(receipt);corrupt.phases[0].result.results[0].operation='physical';assert.throws(()=>procedureLearning(corrupt,result.receipt.sha256));
 }
}));
test('learning marks only the exercised branch and does not copy its values into guidance',()=>{
 const plan={format:'athanor-agent-plan/v1',start:'check',phases:[{id:'check',steps:[{operation:'observe',params:{selector:{id:'old-widget'}}}],next:{step:0,path:['value'],cases:[{equals:'private-value',phase:null},{equals:'other',phase:null}]}}]};
 const receipt={format:plan.format,status:'Completed',durationMs:10,plan,phases:[{id:'check',branch:{caseIndex:0},result:{status:'Completed',results:[{index:0,operation:'observe',durationMs:3,result:{value:'private-value'}}]}}]};
 const learning=procedureLearning(receipt,'a'.repeat(64));assert.deepEqual(learning.observed.phases[0].branch,{selectedCaseIndex:0,declaredCases:2,otherPathsObserved:false});
 assert(!JSON.stringify(learning).includes('private-value'));assert(!JSON.stringify(learning).includes('old-widget'));
 receipt.phases[0].branch.caseIndex=2;assert.throws(()=>procedureLearning(receipt,'a'.repeat(64)));
});
