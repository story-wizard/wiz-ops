import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {mediaSearchAnswer,formatDialogAnswer,mediaInsertionOutcome,inspectorParameterAnswer,inspectorOutcome,timelineClipAnswer} from '../desktop/ui-query.mjs';
import {selectUI,readyUI} from '../desktop/agent-tools.mjs';
import {validateToolParams,validateNativeParams} from '../desktop/agent-proof.mjs';
import {modelItemPoint,defaultClickPoint} from '../desktop/physical-input.mjs';
import {reviewAgentPlan} from '../desktop/agent-plan.mjs';
import {digest} from '../runner/files.mjs';
import {prepareAgentTask} from '../desktop/agent-task.mjs';
import {observationBinding,observationChanges} from '../desktop/observations.mjs';

const ui=()=>({actions:[{id:'name-mode',text:'Name',checkable:true,checked:true,enabled:true}],widgets:[{id:'main',class:'MainWindow'},{id:'media',class:'MediaPanel',parent:'main'},
 {id:'field',class:'MediaSearchField',parent:'media',text:'motion'},
 {id:'status',name:'mediaSearchStatus',parent:'media',text:'1 match in 1 clip'},
 {id:'view',class:'QTreeView',parent:'media',viewport:'viewport',rows:1,model:[['motion.mp4']],selectedRows:[0],itemRects:[{row:0,x:0,y:0,width:200,height:24}]},
 {id:'other',class:'QTreeView',parent:'main',rows:100,model:[]} ]});
const before=()=>({timeline:{timeline_id:'timeline',name:'Main',duration_seconds:0,fps:24,width:1920,height:1080},tracks:[{track_id:'v',address:'V1',enabled:true,locked:false,items:[],has_placed_items:false},{track_id:'a',address:'A1',enabled:true,locked:false,items:[],has_placed_items:false}],links:[],multicam_catalogs:[],next_cursor:null});
test('one media answer uses parent relationships and scoped waits ignore unrelated models',()=>{
 const original=ui(),answer=mediaSearchAnswer(original);assert.deepEqual(answer.names,['motion.mp4']);assert.equal(answer.inspectionIncomplete,false);assert.deepEqual(answer.selectedRows,[0]);
 const query={within:{class:'MediaPanel'},selectors:[{class:'MediaSearchField'},{class:'QTreeView'},{name:'mediaSearchStatus'}],details:true};validateToolParams('observe',query);const selected=selectUI(original,query);assert.equal(selected.matchCount,3);assert.equal(selected.inspectionIncomplete,false);
 const wait={within:{class:'MediaPanel'},conditions:[{selector:{class:'QTreeView'},condition:'modelNames',expected:['motion.mp4']},{selector:{class:'MediaSearchField'},condition:'text',expected:'motion'}],details:true,limit:2};validateToolParams('wait',wait);assert.equal(readyUI(original,wait).matched,true);
 const stale=ui();stale.widgets.find(w=>w.id==='view').model=[['other.mp4']];assert.equal(readyUI(stale,wait),false);
 stale.widgets.find(w=>w.id==='view').rows=2;assert.equal(mediaSearchAnswer(stale).inspectionIncomplete,true);assert.equal(readyUI(stale,wait),false);
 original.widgets.push({id:'duplicate',class:'MediaPanel'});assert.throws(()=>mediaSearchAnswer(original),e=>e.code==='ambiguous_scope');
 const idle=ui();idle.widgets=idle.widgets.filter(w=>w.id!=='status');assert.throws(()=>mediaSearchAnswer(idle),e=>e.code==='ambiguous_target');idle.widgets.find(w=>w.id==='field').text='';assert.equal(mediaSearchAnswer(idle).status,null);
 for(const bad of [{within:{}},{within:{class:'MediaPanel'},scope:'other'},{question:'invented'}])assert.throws(()=>validateToolParams(bad.question?'query':'observe',bad));
 const snapshot=within=>({binding:observationBinding({pid:1},{within}),value:{matches:[]}});
 assert.throws(()=>observationChanges(snapshot({id:'media'}),snapshot({id:'other'})),e=>e.code==='observation_binding_changed');
 const wrongMode=ui();wrongMode.actions[0].checked=false;assert.equal(mediaSearchAnswer(wrongMode).searchMode,'unknown');
});

test('Inspector answers bind the selected graph node and exact row, and focusing uses the fresh thumb',()=>{
 const graph={graph_id:'g',timeline_id:'timeline',clip_id:'clip',nodes:[{node_id:'node',params:{radius:16}}]},params={nodeId:'node',parameter:'radius',label:'Radius'};
 const observation={widgets:[{id:'view',class:'RenderGraphView',window:'main',graphId:'g',timelineId:'timeline',sceneItems:[{nodeId:'node',selected:true}]},{id:'row'},{id:'label',name:'InspectorParamLabel',text:'Radius',parent:'row',window:'main',y:10},{id:'slider',name:'InspectorSliderControl',parent:'row',window:'main',y:10,enabled:true,value:16,handle:[20,8],width:100,height:16},{id:'canvas',class:'TimelineWidget',window:'main',clipIds:['clip']} ]};
 assert.equal(inspectorParameterAnswer(observation,graph,params).value,16);assert.equal(inspectorParameterAnswer(observation,graph,params).targets.control.id,'slider');
 for(const mutate of [u=>u.widgets[0].sceneItems[0].nodeId='other',u=>u.widgets[0].sceneItemsTruncated=true,u=>u.widgets[3].parent='other',u=>u.widgets.push({...u.widgets[3],id:'duplicate'}),u=>u.modalWindow='dialog']){const bad=structuredClone(observation);mutate(bad);assert.throws(()=>inspectorParameterAnswer(bad,graph,params));}
 const slider=observation.widgets[3];assert.deepEqual(defaultClickPoint(slider),{x:20,y:8});assert.deepEqual(defaultClickPoint({...slider,handle:[40,8]}),{x:40,y:8});assert.throws(()=>defaultClickPoint({...slider,handle:[-1,8]}),e=>e.code==='clipped_slider_thumb');
 validateToolParams('query',{question:'inspector-parameter',graphScope:{timeline_id:'timeline',clip_id:'clip'},...params});
 assert.throws(()=>validateToolParams('query',{question:'inspector-parameter',graphScope:{timeline_id:'timeline',clip_id:'clip'},...params,parameter:'__proto__'}));
});
test('Inspector outcomes require one increasing parameter and unchanged graph wiring and timeline',()=>{
 const graph={graph_id:'g',timeline_id:'timeline',clip_id:'clip',nodes:[{node_id:'node',type:'gaussian_blur',params:{radius:16,other:1}}],edges:[]},after=structuredClone(graph),timeline=before(),params={nodeId:'node',parameter:'radius',state:'changed'};after.nodes[0].params.radius=17;
 assert.equal(inspectorOutcome(graph,after,timeline,timeline,params).matched,true);
 for(const mutate of [g=>g.nodes[0].params.other=2,g=>g.edges.push({unexpected:true}),g=>g.clip_id='other',g=>g.nodes[0].params.radius=15]){const bad=structuredClone(after);mutate(bad);assert.equal(inspectorOutcome(graph,bad,timeline,timeline,params).matched,false);}
 const changedTimeline=structuredClone(timeline);changedTimeline.tracks[0].name='other';assert.equal(inspectorOutcome(graph,after,timeline,changedTimeline,params).matched,false);
 assert.equal(inspectorOutcome(graph,graph,timeline,timeline,{...params,state:'restored'}).matched,true);assert.equal(inspectorOutcome(graph,after,timeline,timeline,{...params,state:'restored'}).matched,false);
});
test('timeline clip questions reject a wrong or incomplete displayed canvas',()=>{
 const timeline=before();timeline.tracks[0].items=[{kind:'clip',clip_id:'clip',source:{asset_id:'asset'}}];
 const observation={widgets:[{id:'canvas',class:'TimelineWidget',window:'main',clipIds:['clip']},{id:'tab',name:'panelSubtabSelector',window:'main',text:'Main'}]};
 assert.equal(timelineClipAnswer(observation,timeline,'clip').targets.canvas.id,'canvas');
 for(const mutate of [u=>u.widgets[0].clipIdsTruncated=true,u=>u.widgets[1].text='Other',u=>u.widgets.push({...u.widgets[0],id:'duplicate'}),u=>u.popupWindow='popup']){const bad=structuredClone(observation);mutate(bad);assert.throws(()=>timelineClipAnswer(bad,timeline,'clip'));}
 validateToolParams('query',{question:'timeline-clip',timelineId:'timeline',clipId:'clip'});assert.throws(()=>validateToolParams('query',{question:'timeline-clip',timelineId:'timeline',clipId:''}));
});
test('compact plan review retains every action, expectation and branch and fingerprints large baselines',()=>{
 const baseline=Array.from({length:100},(_,i)=>({id:i,value:'retained'})),plan={format:'athanor-agent-plan/v1',start:'edit',phases:[{id:'edit',steps:[{operation:'physical',params:{command:'key',key:'right',target:{id:'slider'},requireFocus:true}},{operation:'call',params:{operation:'timeline.inspect',params:{timeline_id:'timeline'}},expect:{path:['tracks'],equals:baseline}}],next:{step:1,path:['ready'],cases:[{equals:true,phase:null}]}}]};
 const review=reviewAgentPlan(plan);assert.equal(review.planHash,digest(plan));assert.equal(review.phases[0].steps[0].mutation,true);assert.equal(review.phases[0].steps[0].params.requireFocus,true);assert.deepEqual(review.phases[0].next,plan.phases[0].next);assert.equal(review.phases[0].steps[1].expect.equals.sha256,digest(baseline));assert.equal(review.phases[0].steps[1].expect.equals.items,100);assert(Buffer.byteLength(JSON.stringify(review))<Buffer.byteLength(JSON.stringify(plan)));
 const altered=structuredClone(plan);altered.phases[0].steps[0].params.key='left';assert.notEqual(reviewAgentPlan(altered).planHash,review.planHash);
});
test('format branching recognises the complete exact dialog and rejects changed or missing content',()=>{
 const dialog={modalWindow:'dialog',widgets:[{id:'dialog',class:'QMessageBox'},
 {window:'dialog',class:'QLabel',text:"This timeline is empty. Use the source clip's settings?"},
 {window:'dialog',class:'QLabel',text:"You can adopt the clip's frame rate and format, or keep the current timeline settings."},
 {window:'dialog',id:'keep',class:'QPushButton',text:'Keep Timeline Settings',enabled:true},
 {window:'dialog',id:'adopt',class:'QPushButton',text:'Use Clip Settings',enabled:true}]};
 assert.equal(formatDialogAnswer(dialog).state,'format-mismatch');assert.deepEqual(formatDialogAnswer(dialog).matches,[{id:'keep'}]);
 for(const mutate of [x=>x.widgets[1].text='Unexpected confirmation',x=>x.widgets[3].enabled=false,x=>x.widgets.push({...x.widgets[3],id:'duplicate'}),x=>x.popupWindow='popup',x=>x.widgets=[]]){const bad=structuredClone(dialog);mutate(bad);assert.equal(formatDialogAnswer(bad).state,'unexpected');}
 assert.equal(formatDialogAnswer({widgets:[]}).state,'none');
});
test('the insertion oracle rejects wrong media, ranges, tracks, settings and partial results',()=>{
 const baseline=before(),after=structuredClone(baseline),expected={assetId:'asset',durationSeconds:8,state:'inserted'},range={start_seconds:0,end_seconds:8};
 after.timeline.duration_seconds=8;after.tracks[0].has_placed_items=true;after.tracks[0].items=[{kind:'clip',clip_id:'new',track_id:'v',enabled:true,speed:1,link_group:null,multicam:null,source:{asset_id:'asset',source_range:range},timeline_range:range}];after.tracks[1].items=[{kind:'gap',timeline_range:range}];
 assert.equal(mediaInsertionOutcome(baseline,after,expected).matched,true);
 for(const mutate of [x=>x.timeline.fps=25,x=>x.timeline.duration_seconds=9,x=>x.tracks[0].items[0].source.asset_id='wrong',x=>x.tracks[0].items[0].timeline_range={...range,start_seconds:1},x=>x.tracks[0].items[0].source.source_range={...range,end_seconds:7},x=>x.tracks[0].items.push({...x.tracks[0].items[0]}),x=>x.tracks[0].track_id='other',x=>x.links.push({unexpected:true}),x=>x.next_cursor='next']){const bad=structuredClone(after);mutate(bad);assert.equal(mediaInsertionOutcome(baseline,bad,expected).matched,false);}
 assert.equal(mediaInsertionOutcome(baseline,baseline,{...expected,state:'restored'}).matched,true);assert.equal(mediaInsertionOutcome(baseline,after,{...expected,state:'restored'}).matched,false);
 assert.throws(()=>mediaInsertionOutcome(after,after,expected),e=>e.code==='unsupported_fixture');
});
test('physical model targeting requires one complete visible row and bounded track/time geometry',()=>{
 const view=ui().widgets.find(w=>w.id==='view'),viewport={id:'viewport',width:200,height:24,visibleRect:{x:0,y:0,width:200,height:24}};
 assert.deepEqual(modelItemPoint(view,viewport,'motion.mp4'),{x:99.5,y:11.5,row:0,text:'motion.mp4'});
 for(const changed of [{...view,rows:2},{...view,rows:2,model:[['motion.mp4'],['motion.mp4']],itemRects:[...view.itemRects,{row:1,x:0,y:24,width:200,height:24}]},{...view,itemRects:[{row:0,x:0,y:100,width:200,height:24}]}])assert.throws(()=>modelItemPoint(changed,viewport,'motion.mp4'));
 const drag={command:'drag',target:{id:'view'},itemText:'motion.mp4',toTarget:{id:'video'},toTimelinePoint:{trackIndex:0,timeSeconds:0}};validateToolParams('physical',drag);
 for(const bad of [{x:1},{toX:1},{path:[{x:0,y:0},{x:1,y:1}]},{toTimelinePoint:{trackIndex:-1,timeSeconds:0}},{toTimelinePoint:{trackIndex:0,timeSeconds:Infinity}}])assert.throws(()=>validateToolParams('physical',{...drag,...bad}));
 validateNativeParams('timeline-point',{target:'video',trackIndex:0,timeSeconds:0});assert.throws(()=>validateNativeParams('timeline-point',{target:'video',trackIndex:1024,timeSeconds:0}));
});
test('media task overlaps independent preflight/baseline reads and retains a guarded plan without input',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-media-task-'),file=root+'/session.json';
 try{
  await writeFile(file,JSON.stringify({root,dataDir:'/private/tmp',schema:{operations:{'timeline.inspect':{properties:{timeline_id:{type:'string'}}}}}}));
  const values={timelineId:'timeline',query:'motion',expectedName:'motion.mp4',expectedStatus:'1 match in 1 clip',assetId:'asset',durationSeconds:8},answer={...mediaSearchAnswer(ui()),timelineTabs:[{text:'Main',window:'main'}],timelineCanvases:[{id:'audio',window:'main',x:0,y:200,width:200,height:100,clipIds:[]},{id:'video',window:'main',x:0,y:0,width:200,height:100,clipIds:[]}]};
  const calls=[];let began=0,release;const together=new Promise(r=>release=r);
  const execute=async(f,op,p)=>{calls.push(op);if(op==='geometry')return {target:'video',point:{x:0,y:80}};if(++began===2)release();await together;return op==='preflight'?{ready:true,keyWindow:{id:'main',class:'MainWindow'},answer}:before();};
  const task=await prepareAgentTask(file,{recipe:'media-insert-undo',values},execute),plan=JSON.parse(await readFile(task.plan.path));assert.equal(task.executed,false);assert.deepEqual(calls,['preflight','call','geometry']);assert.equal(plan.phases.length,7);assert(plan.phases.some(p=>p.id==='keep'));assert(plan.phases.find(p=>p.id==='undo').steps.some(s=>s.params?.requireFocus));
  answer.timelineTabs[0].text='Other';await assert.rejects(()=>prepareAgentTask(file,{recipe:'media-insert-undo',values},execute),e=>e.code==='wrong_fixture');
  answer.timelineTabs[0].text='Main';answer.searchMode='unknown';await assert.rejects(()=>prepareAgentTask(file,{recipe:'media-insert-undo',values},execute),e=>e.code==='wrong_search_mode');
 }finally{await rm(root,{recursive:true,force:true});}
});
