import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {validateApplicationParams} from '../desktop/agent-proof.mjs';
import {requireValidSourceTiming,scopeSelections,visiblePlayhead,curveResetControl,isNeutralCurve,sourceColorControl,menuValuePath,verifyLoopSamples,missingCheckOperations,hasAuthoredSourceColor,twentyCutFixture} from '../desktop/check-support.mjs';
import {missingMediaContinuation} from '../desktop/adapter.mjs';
import {completedExportClose} from '../desktop/export-dialog.mjs';
import {exportCommand} from '../desktop/check-offline-export.mjs';
import {evidenceCoverage} from '../test-details.mjs';
import {writeJSON,sha} from '../runner/files.mjs';
import {OutcomeError} from '../runner/engine.mjs';

test('union schemas admit common generation fields and reject nested typos',()=>{
 for(const union of ['oneOf','anyOf']){
  const schema={operations:{'generate.duplicate':{properties:{destination:{properties:{kind:{type:'string'}},additionalProperties:false,[union]:[{properties:{timeline_id:{type:'string'},at:{properties:{offset_seconds:{type:'number'}},additionalProperties:false}}},{properties:{bin_id:{type:'string'}}}]}},additionalProperties:false}}};
  assert.doesNotThrow(()=>validateApplicationParams(schema,'generate.duplicate',{destination:{kind:'timeline',timeline_id:'t',at:{offset_seconds:2}}}));
  assert.throws(()=>validateApplicationParams(schema,'generate.duplicate',{destination:{kind:'timeline',timeline_id:'t',at:{offset_second:2}}}),e=>e.code==='unknown_parameter');
  assert.throws(()=>validateApplicationParams(schema,'generate.duplicate',{destinaton:{kind:'timeline'}}),e=>e.code==='unknown_parameter');
 }
});

test('valid carrier timing remains frame aligned and cannot admit rejected source authority',()=>{
 const source={projection_status:'carrier',projection_diagnostics:[],source_availability:'bounded',fps:24,source_range:{start_seconds:1,end_seconds:2}};
 assert.equal(requireValidSourceTiming(source),'carrier');
 for(const change of [{projection_status:'authority_rejected'},{projection_diagnostics:['mismatch']},{source_availability:'unknown'},{fps:0},{source_range:{start_seconds:1.01,end_seconds:2}},{source_range:{start_seconds:2,end_seconds:1}}])assert.throws(()=>requireValidSourceTiming({...source,...change}));
});

test('scope additions and ordering do not hide missing promised modes',()=>{
 const modes=['Vectorscope','RGB Parade','Histogram','Waveform (RGB)','Waveform (Luma)'],taps={items:['Pre DVT','Post IDT','Post Primary']};
 assert.deepEqual(scopeSelections({items:modes},taps).map(x=>modes[x.index]),['Histogram','Waveform (Luma)','Waveform (RGB)','RGB Parade']);
 assert.throws(()=>scopeSelections({items:modes.filter(x=>x!=='Histogram')},taps));
});

test('playback readout belongs to the owned preview and rejects ambiguous or invalid controls',()=>{
 const main={id:'main',class:'MainWindow'},bar={id:'scrub',window:'main',name:'previewScrubBar',value:1250,minimum:0,maximum:8000},ui={widgets:[main,bar,{...bar,id:'other',window:'foreign',value:9999}]};
 assert.equal(visiblePlayhead(ui).seconds,1.25);assert.equal(visiblePlayhead(ui).kind,'scrubber');
 assert.equal(visiblePlayhead({widgets:[main,{window:'main',id:'tc',name:'previewCurrentTimecode',text:'00:00:01:06'}]}).seconds,1.25);
 for(const widgets of [[main,bar,{...bar,id:'duplicate'}],[main,{...bar,value:9000}],[main,bar,{window:'main',name:'previewCurrentTimecode',text:'invalid'}],[main,{window:'main',name:'previewCurrentTimecode',text:'00:60:01:06'}]])assert.throws(()=>visiblePlayhead({widgets}),e=>e.status==='Blocked');
});

test('curve reset binds the active panel and neutral curves retain their actual meaning',()=>{
 const widgets=[{id:'panel',class:'CurvesPanel'},{id:'editor',class:'CurveEditor',parent:'panel'},{id:'reset',parent:'panel',enabled:true,tooltip:'Reset every curve to its default'},{id:'foreign',parent:'other',enabled:true,tooltip:'Reset every curve'}];
 assert.equal(curveResetControl({widgets},'editor').id,'reset');assert.throws(()=>curveResetControl({widgets:widgets.filter(w=>w.id!=='reset')},'editor'),e=>e.status==='Blocked');
 const floating=widgets.filter(w=>w.id!=='reset').map(w=>w.id==='editor'?{...w,window:'float'}:w);floating.push({id:'chrome',window:'float',parent:'chrome-row',name:'panelChromeAction',class:'QToolButton',enabled:true,tooltip:'Reset every curve to its default'});
 assert.equal(curveResetControl({widgets:floating},'editor').id,'chrome');assert.throws(()=>curveResetControl({widgets:floating.map(w=>w.id==='chrome'?{...w,window:'foreign'}:w)},'editor'),e=>e.status==='Blocked');
 assert.throws(()=>curveResetControl({widgets:[...floating,{...floating.at(-1),id:'ambiguous'}]},'editor'),e=>e.status==='Blocked');
 const curve=points=>({schema_id:'wiz.color.bspline_curve.v1',schema_version:1,value:{points}});
 assert.ok(isNeutralCurve(curve([{x:0,y:0},{x:1,y:1}]),'rgb'));assert.ok(!isNeutralCurve(curve([{x:0,y:0},{x:.5,y:.8},{x:1,y:1}]),'rgb'));
 assert.ok(isNeutralCurve(curve([{x:0,y:0},{x:1,y:0}]),'hue'));assert.ok(!isNeutralCurve(curve([{x:0,y:0},{x:1,y:.1}]),'hue'));
});

test('source colour binds the editable input and menu semantic values, not a disabled transform',()=>{
 const widgets=[{id:'label',graphView:'g',parent:'row',text:'Color Space'},{id:'input',graphView:'g',parent:'row',class:'RenderGraphEnumButton',enabled:true},{id:'derived',graphView:'g',parent:'other',class:'RenderGraphEnumButton',enabled:false}];
 assert.equal(sourceColorControl({widgets},'g').id,'input');assert.throws(()=>sourceColorControl({widgets},'other'),e=>e.status==='Blocked');
 const items=[{id:'group',enabled:true,submenu:'sub',text:'ACES',items:[{id:'choice',enabled:true,text:'ACEScg',value:'ACEScg'}]}];assert.deepEqual(menuValuePath(items,'ACEScg').map(x=>x.id),['group','choice']);
 assert.throws(()=>menuValuePath([...items,...items],'ACEScg'),e=>e.status==='Blocked');assert.throws(()=>menuValuePath(items,'sRGB'),e=>e.status==='Blocked');
});

test('loop proof requires advancing frames and repeated real wraps within marked bounds',()=>{
 const samples=[24,29,34,39,44,48,24,30,36,42,48,24].map(frame=>({frame,playing:true,scrubbing:false}));assert.equal(verifyLoopSamples(samples,24,49).wraps,2);
 for(const frames of [Array(12).fill(24),[...samples.map(s=>s.frame).slice(0,-1),50]])assert.throws(()=>verifyLoopSamples(frames.map(frame=>({frame,playing:true,scrubbing:false})),24,49));
 assert.deepEqual(missingCheckOperations('D-SB-01',{operations:{}}),['spellbook.list','spellbook.inspect']);assert.deepEqual(missingCheckOperations('D-PB-01',{operations:{}}),[]);
});

test('source colour requires the selected semantic value and authored provenance on a unique transform',()=>{
 const type='wiz.color.input_color_space_transform',node={node_id:'5',type,params:{'input.cst.src':'ACEScg','input.cst.src.provenance':'authored'}};
 assert.ok(hasAuthoredSourceColor({nodes:[node]},type,'ACEScg'));
 for(const nodes of [[],[node,{...node,node_id:'6'}],[{...node,params:{...node.params,'input.cst.src.provenance':'detected'}}],[{...node,params:{...node.params,'input.cst.src':'sRGB'}}]])assert.equal(hasAuthoredSourceColor({nodes},type,'ACEScg'),false);
});

test('only a completed Export dialog supplies its owned close button',()=>{
 const dialog={id:'done',window:'done',title:'Export'},label={window:'done',text:'Export Complete'},button={id:'close',window:'done',class:'QPushButton',text:'Close',enabled:true};
 assert.equal(completedExportClose({widgets:[dialog,label,button]}).id,'close');assert.equal(completedExportClose({widgets:[dialog,button]}),undefined);
 assert.throws(()=>completedExportClose({widgets:[dialog,label,button,{...button,id:'second'}]}));
});

test('blocked checks keep collected artifacts but identify unreached captures',()=>{
 const spec={evidence:[{id:'after',kind:'image',when:'after',required:true},{id:'failure',kind:'image',when:'failure',required:true}]};
 assert.deepEqual(evidenceCoverage(spec,[],[],'Blocked').map(x=>x.status),['Not reached','Missing']);assert.equal(evidenceCoverage(spec,[],[],'Fail')[0].status,'Missing');assert.equal(evidenceCoverage(spec,[{specId:'after'}],[],'Blocked')[0].status,'Collected');
});

test('intentional relink continuation rejects substituted bytes, extra missing media and redirected fixture files',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-relink-repair-')));
 try{
  const bundle=path.join(root,'Golden.wiz'),original=path.join(root,'media/plate.mov'),moved=path.join(root,'relocated-media/plate.mov'),fixture=path.join(root,'relink-prepared.json');
  for(const folder of ['media','relocated-media','Golden.wiz/assets'])await mkdir(path.join(root,folder),{recursive:true});await writeFile(moved,'known fixture');
  const proof={asset:'plate',pid:2,original,moved,digest:await sha(moved)},session={root,bundle,pid:3,assets:{plate:'plate'},selectedChecks:['D-MEDIA-RELINK']},ui={widgets:[{id:'missing',window:'missing',title:'Missing Media'},{id:'continue',window:'missing',class:'QPushButton',text:'Continue Offline',enabled:true}]};
  await writeJSON(fixture,proof);await writeJSON(path.join(bundle,'project.json'),{media_roots:[]});await writeJSON(path.join(bundle,'assets/index.json'),{assets:[{asset_id:'plate',local_path:original}]});
  assert.equal((await missingMediaContinuation(session,ui,fixture)).target,'continue');
  await assert.rejects(()=>missingMediaContinuation({...session,selectedChecks:[]},ui,fixture),e=>e.status==='Blocked');
  await writeFile(moved,'substituted bytes');await assert.rejects(()=>missingMediaContinuation(session,ui,fixture),e=>e.status==='Blocked');await writeFile(moved,'known fixture');
  await writeJSON(path.join(bundle,'assets/index.json'),{assets:[{asset_id:'plate',local_path:original},{asset_id:'other',local_path:path.join(root,'media/other.mov')}]});await assert.rejects(()=>missingMediaContinuation(session,ui,fixture),e=>e.status==='Blocked');
  await rm(fixture);const redirected=path.join(root,'redirected.json');await writeJSON(redirected,proof);await symlink(redirected,fixture);await assert.rejects(()=>missingMediaContinuation(session,ui,fixture),e=>e.status==='Blocked');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('worker receipts retain a single uncertain export without replay',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-worker-repair-'));let calls=0;
 try{
  const execute=async()=>{calls++;return {code:null,timedOut:true,stdout:'',stderr:''};};
  await assert.rejects(()=>exportCommand({root},'S-EXPORT-PRORES','worker.export','worker',['--request','request.json'],{}, {request:'request.json'},execute),e=>e.status==='Unknown');assert.equal(calls,1);
  const receipt=JSON.parse((await readFile(path.join(root,'operations.jsonl'),'utf8')).trim());assert.equal(receipt.caseId,'S-EXPORT-PRORES');assert.equal(receipt.status,'Unknown');assert.equal(receipt.evidence.request,'request.json');assert.deepEqual(receipt.params.args,['--request','request.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});

function fixtureBackend(){
 const graphs=new Map(),placements=[];
 const call=async(op,p)=>{
  if(op==='timeline.create')return {timeline_id:'t',tracks:[{kind:'video',track_id:'v'}]};
  if(op==='timeline.place_cuts'){placements.push(...p.cuts);return {};}
  if(op==='timeline.inspect')return {tracks:[{items:Array.from({length:20},(_,i)=>({kind:'clip',clip_id:'clip-'+i}))}]};
  if(op==='graph.get_clip_graph')return graphs.get(p.clip_id)||{structural_revision:20,content_revision:20,nodes:[{node_id:'input',type:'transform_2d'},{node_id:'output',type:'composite'}],edges:[{from_node:'input',from_slot:'output',to_node:'output',to_slot:'input',type:'image'}]};
  if(op==='graph.insert_on_edge')throw Object.assign(Error('Projected revision is not clip-local'),{status:'Fail'});
  if(op==='graph.edit_batch'){
   const operation=p.ops[0];graphs.set(p.clip_id,{nodes:[{node_id:'input',type:'transform_2d'},{node_id:'output',type:'composite'},{node_id:'grade',type:operation.type,params:operation.params}],edges:[{from_node:'input',from_slot:'output',to_node:'grade',to_slot:'input'},{from_node:'grade',from_slot:'output',to_node:'output',to_slot:'input'}]});return {};
  }throw Error('Unexpected operation '+op);
 };
 return {call,graphs,placements};
}
test('twenty-cut fixture uses the supported public edit route and validates every grayscale graph',async()=>{
 const {call,graphs,placements}=fixtureBackend();
 const fixture=await twentyCutFixture(call,{plate:'plate',motion:'motion'});
 assert.equal(fixture.clipIds.length,20);assert.equal(fixture.grades.length,10);assert.deepEqual([...graphs.keys()],['clip-1','clip-3','clip-5','clip-7','clip-9','clip-11','clip-13','clip-15','clip-17','clip-19']);
 assert.deepEqual(placements.map(c=>c.source.asset_id),['plate','motion','plate','motion','plate','motion','plate','motion','plate','motion','plate','motion','plate','motion','plate','motion','plate','motion','plate','motion']);
});
test('twenty-cut fixture cannot proceed with a missing, wrong or disconnected grade',async()=>{
 for(const corrupt of [g=>g.nodes.at(-1).params['grade.primary.saturation']=1,g=>g.nodes.pop(),g=>g.edges[0].to_node='output']){
  const backend=fixtureBackend(),call=async(op,p)=>{const result=await backend.call(op,p);if(op==='graph.get_clip_graph'&&backend.graphs.has(p.clip_id))corrupt(result);return result;};
  await assert.rejects(()=>twentyCutFixture(call,{plate:'plate',motion:'motion'}),/Fixture saturation grade|Fixture grade is not inserted/);
 }
});
test('twenty-cut setup rejection preserves uncertainty and does not retry an unexecuted gesture',async()=>{
 for(const status of ['Fail','Unknown']){
  let mutations=0;const call=async op=>{
   if(op==='timeline.create')return {timeline_id:'t',tracks:[{kind:'video',track_id:'v'}]};if(op==='timeline.place_cuts')return {};
   if(op==='timeline.inspect')return {tracks:[{items:Array.from({length:20},(_,i)=>({kind:'clip',clip_id:String(i)}))}]};
   if(op==='graph.get_clip_graph')return {structural_revision:5,content_revision:7,nodes:[{node_id:'input',type:'transform_2d'},{node_id:'output',type:'composite'}],edges:[{from_node:'input',to_node:'output'}]};
   if(op==='graph.edit_batch'){mutations++;throw Object.assign(Error('edit rejected'),{status,diagnostics:{expectedRevision:5,returnedRevision:1}});}throw Error('Unexpected operation '+op);
  };
  await assert.rejects(()=>twentyCutFixture(call,{plate:'plate',motion:'motion'}),e=>e.status===status&&e.diagnostics.expectedRevision===5&&e.diagnostics.returnedRevision===1);assert.equal(mutations,1);
 }
});
