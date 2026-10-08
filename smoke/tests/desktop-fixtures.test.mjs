import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checks,requirePassed,requireExactTimingFixture,requireOrdinaryTimingFixture,timelineDockToOpen,gapFixture} from '../desktop/check-support.mjs';
import {writeJSON} from '../runner/files.mjs';
test('a rejected timing fixture blocks a gesture instead of blaming the edit',()=>{
 const snapshot=status=>({tracks:[{items:[{kind:'clip',clip_id:'fixture',source:{timing:'timed',projection_status:status,projection_diagnostics:status==='exact'?[]:['exact_authority_carrier_mismatch']}}]}]});
 assert.doesNotThrow(()=>requireExactTimingFixture(snapshot('exact')));
 for(const status of ['authority_rejected','carrier','projection_unavailable'])assert.throws(()=>requireExactTimingFixture(snapshot(status)),e=>e.status==='Blocked'&&/fixture/.test(e.message));
 assert.throws(()=>requireExactTimingFixture({tracks:[{items:[]}]}),e=>e.status==='Blocked');
});
test('opening a timeline restores its dock after a prior Mixer check without choosing an arbitrary canvas',()=>{
 const tab={id:'tab',name:'dockWidgetTabLabel',text:'Timeline'},mixer={id:'mixer',name:'panelSubtabSelector',text:'Mixer (6)'},canvas={id:'canvas',class:'TimelineWidget'};
 assert.equal(timelineDockToOpen({widgets:[mixer,tab]}).id,'tab');assert.equal(timelineDockToOpen({widgets:[canvas,tab]}),null);
 for(const widgets of [[mixer],[tab,{...tab,id:'other'}],[canvas,{...canvas,id:'other'},tab]])assert.throws(()=>timelineDockToOpen({widgets}),e=>e.status==='Blocked');
});

test('ordinary UI fixtures accept a valid carrier while rejecting retime, mixed clocks and invalid authority',()=>{
 const snapshot={timeline:{fps:24},tracks:[{items:[{kind:'clip',clip_id:'fixture',speed:1,timeline_range:{start_seconds:0,end_seconds:4},source:{timing:'timed',projection_status:'carrier',projection_diagnostics:[],source_availability:'bounded',fps:24,source_range:{start_seconds:1,end_seconds:5}}}]}]};
 assert.doesNotThrow(()=>requireOrdinaryTimingFixture(snapshot,'fixture'));
 for(const mutate of [s=>s.tracks[0].items[0].speed=2,s=>s.tracks[0].items[0].source.fps=25,s=>s.tracks[0].items[0].source.projection_status='authority_rejected',s=>s.tracks[0].items[0].source.projection_diagnostics=['mismatch'],s=>s.tracks[0].items[0].source.source_range.end_seconds=6,s=>s.tracks[0].items[0].timeline_range.start_seconds=.01,s=>s.next_cursor='more']){const bad=structuredClone(snapshot);mutate(bad);assert.throws(()=>requireOrdinaryTimingFixture(bad,'fixture'),e=>e.status==='Blocked');}
 assert.throws(()=>requireOrdinaryTimingFixture(snapshot,'other'),e=>e.status==='Blocked');
});

test('failed and absent prerequisites block dependent actions and retain the original failure',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smoke-dependencies-')),file=path.join(root,'session.json');
 try{
  await writeJSON(file,{root,pid:1,generation:1,selectedChecks:['AUTHOR','PERSIST','UNRELATED']});
  const {check,report}=await checks(file,'test-report.json');let mutations=0;
  await check('AUTHOR',async()=>{throw Error('Graph authoring failed');});
  await check('PERSIST',async()=>{mutations++;},['AUTHOR']);
  await check('UNRELATED',async()=>({observed:true}));
  assert.equal(mutations,0);assert.deepEqual(report.results.map(r=>r.status),['Fail','Blocked','Pass']);assert.match(report.results[1].error,/AUTHOR \(Fail\)/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'test-report.json'))).results,report.results);
  for(const status of ['Fail','Unknown','Blocked','Not run'])assert.throws(()=>requirePassed([{id:'AUTHOR',status}],['AUTHOR']),e=>e.status==='Blocked');
  assert.throws(()=>requirePassed([],['AUTHOR']),/not executed/);
  assert.doesNotThrow(()=>requirePassed([{id:'AUTHOR',status:'Pass'}],['AUTHOR']));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('gap checks create independent timelines and reject incomplete or wrong-source fixtures before gestures',async()=>{
 const assets={plate:'plate-id',motion:'motion-id'},timelines=new Map([['dirty-main',[]]]);let number=0,corrupt=false;
 const call=async(op,p)=>{
  if(op==='timeline.create'){const id='new-'+ ++number;timelines.set(id,[]);return {timeline_id:id,tracks:[{kind:'video',track_id:'video'}]};}
  if(op==='timeline.place_cuts'){timelines.set(p.timeline_id,p.cuts.map(c=>({kind:'clip',source:{...c.source,source_range:c.source_range},timeline_range:{start_seconds:c.destination.at.seconds,end_seconds:c.destination.at.seconds+c.source_range.end_seconds-c.source_range.start_seconds}})));return {};}
  if(op==='timeline.inspect')return {timeline:{timeline_id:p.timeline_id},tracks:[{items:corrupt?timelines.get(p.timeline_id).slice(1):timelines.get(p.timeline_id)}]};
  throw Error('Unexpected fixture operation');
 };
 const first=await gapFixture(call,assets,'Ripple'),second=await gapFixture(call,assets,'Scrub');
 assert.notEqual(first.timeline.timeline_id,second.timeline.timeline_id);assert.deepEqual(timelines.get('dirty-main'),[]);
 assert.deepEqual(first.tracks[0].items.map(c=>c.timeline_range),[{start_seconds:0,end_seconds:4},{start_seconds:6,end_seconds:8}]);
 corrupt=true;await assert.rejects(()=>gapFixture(call,assets,'Missing clip'),e=>e.status==='Blocked'&&/two fixture clips/.test(e.message));
 corrupt=false;const wrongSource=async(op,p)=>{const r=await call(op,p);if(op==='timeline.inspect')r.tracks[0].items[0].source.asset_id='wrong';return r;};
 await assert.rejects(()=>gapFixture(wrongSource,assets,'Wrong source'),e=>e.status==='Blocked'&&/source identities/.test(e.message));
 await assert.rejects(()=>gapFixture(async()=>{throw Object.assign(Error('Unknown mutation'),{status:'Unknown'});},assets,'Uncertain setup'),e=>e.status==='Unknown');
});


test('background native input is denied before foreground lease or mutation admission',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-service-admission-'));
 try{
  const source=await readFile(new URL('../desktop/adapter.mjs',import.meta.url),'utf8'),start=source.indexOf('export async function nativeCall('),end=source.indexOf('\nexport function parseNativeResponse(',start+1);assert.ok(start>=0&&end>start);
  const {pathToFileURL}=await import('node:url'),{writeFile}=await import('node:fs/promises');
  const module=path.join(root,'admission.mjs');await writeFile(module,`import {assert} from '${new URL('../runner/engine.mjs',import.meta.url).href}';import {validateNativeParams} from '${new URL('../desktop/agent-proof.mjs',import.meta.url).href}';const readJSON=async()=>({inputMode:'service',plan:{runtime:{kind:'selected-build-attachment'}}});const verifyDesktopOwner=()=>{};const verifyDesktopLease=()=>{throw Error('Foreground lease must not be requested');};const markAgentMutation=()=>{throw Error('Denied input must not mutate admission state');};const agentReadNative=['inspect','capabilities','screenshot','snapshot-widget'];const withAdapterAction=async(f,m,o,p,fn)=>fn();\n`+source.slice(start,end));
  const {nativeCall}=await import(pathToFileURL(module).href);
  for(const op of ['context-click','drop-model-item','snapshot-presented','type-text','key','click','action','activate','text','select','drag','item-click','close-window','clipboard-save','spellbook-run-local','snapshot-node-preview'])await assert.rejects(()=>nativeCall('fixture',op,{}),/cannot dispatch UI input/);
  await assert.rejects(()=>nativeCall('fixture','resize-window',{target:'window',width:800,height:600}),/cannot dispatch UI input/);
 }finally{await rm(root,{recursive:true,force:true});}
});
