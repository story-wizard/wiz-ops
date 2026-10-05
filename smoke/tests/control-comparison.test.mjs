import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreControlTask,controlProtocol} from '../desktop/control-comparison.mjs';
import {windowPoint,postInputFocus} from '../desktop/physical-input.mjs';
import {keyboardWindowProof} from '../desktop/macos-input.mjs';

function timeline(placed=false){return {next_cursor:null,timeline:{timeline_id:'timeline',frame_rate:{numerator:24,denominator:1},name:'Fixture'},links:[],tracks:[{track_id:'video',address:'V1',items:placed?[{kind:'clip',clip_id:'clip',track_id:'video',timeline_range:{start_seconds:1,end_seconds:5},source:{asset_id:'plate',fps:24,source_range:{start_seconds:1,end_seconds:5},projection_status:'exact',projection_diagnostics:[],source_availability:'bounded'}}]:[]},{track_id:'audio',address:'A1',items:[]}]};}
function trimTask(){const baseline=timeline(true),changed=structuredClone(baseline);changed.tracks[0].items[0].timeline_range.end_seconds=3.5;changed.tracks[0].items[0].source.source_range.end_seconds=3.5;return {task:'trim',baseline,finished:true,checkpoints:[{phase:'changed',observation:{timeline:changed}},{phase:'restored',observation:{timeline:structuredClone(baseline)}},{phase:'redone',observation:{timeline:structuredClone(changed)}}]};}
function searchTask(){const baseline=timeline(true),values=[{query:'pattern_24',status:'1 match',names:['pattern_24.mov']},{query:'athanor_missing_benchmark',status:'No results',names:[]},{query:'pattern_24',status:'1 match',names:['pattern_24.mov']},{query:'',status:'2 matches',names:['pattern_24.mov','other']}];return {task:'search',baseline,finished:true,checkpoints:['positive','missing','restore','cleanup'].map((phase,i)=>({phase,observation:{timeline:structuredClone(baseline),search:{...values[i],complete:true}}}))};}
test('baseline tasks score behavior and reject missing or reordered checkpoints',()=>{
 assert.equal(scoreControlTask(trimTask()).status,'Pass');assert.equal(scoreControlTask(searchTask()).status,'Pass');
 const baseline=timeline(),changed=structuredClone(baseline);changed.tracks.push({track_id:'new',address:'V2',items:[]});
 const track={task:'track',baseline,finished:true,checkpoints:[{phase:'changed',observation:{timeline:changed}},{phase:'restored',observation:{timeline:baseline}}]};assert.equal(scoreControlTask(track).status,'Pass');
 for(const mutate of [t=>t.finished=false,t=>t.checkpoints.pop(),t=>t.checkpoints.reverse(),t=>t.checkpoints.push(t.checkpoints[0])]){const bad=trimTask();mutate(bad);assert.equal(scoreControlTask(bad).status,'Blocked');}
 changed.tracks[0].items.push({kind:'clip'});assert.equal(scoreControlTask(track).status,'Fail','An extra track cannot hide changes to original tracks');
 assert.ok(Object.isFrozen(controlProtocol.tasks.trim));
});
test('controlled trim defects cannot receive Pass; failed Undo keeps Redo inconclusive',()=>{
 for(const mutate of [t=>t.timeline.timeline_id='wrong',t=>t.next_cursor='more',t=>t.tracks[0].items[0].source.asset_id='other',t=>t.tracks[0].items[0].clip_id='other',t=>{t.tracks[0].items[0].source.source_range.end_seconds+=.01;t.tracks[0].items[0].timeline_range.end_seconds+=.01;},t=>t.tracks[0].track_id='other']){const bad=trimTask();mutate(bad.checkpoints[0].observation.timeline);assert.equal(scoreControlTask(bad).status,'Fail');}
 const undone=trimTask();undone.checkpoints[1].observation=structuredClone(undone.checkpoints[0].observation);const result=scoreControlTask(undone);assert.equal(result.status,'Fail');assert.equal(result.checkpoints[1].status,'Fail');assert.equal(result.checkpoints[2].status,'Blocked');
});
test('controlled search defects reject pending, wrong query, truncated and unrelated results',()=>{
 for(const mutate of [t=>t.checkpoints[1].observation.search.status='Searching',t=>t.checkpoints[1].observation.search.query='wrong',t=>t.checkpoints[1].observation.search.complete=false,t=>t.checkpoints[1].observation.search.names=['unexpected.mov'],t=>t.checkpoints[2].observation.search.names=['unrelated.mov'],t=>t.checkpoints[1].observation.timeline.timeline.timeline_id='wrong',t=>t.checkpoints[0].observation.search.names=[]]){const bad=searchTask();mutate(bad);assert.equal(scoreControlTask(bad).status,'Fail');}
});
test('input guards reject stale window geometry and lost focus independently of dispatch success',()=>{
 const w={id:'field',window:'main',x:10,y:10,width:100,height:30,editableText:true},window={id:'main',window:'main',width:500,height:400},native={frame:{width:500,height:428}};
 assert.deepEqual(windowPoint(w,window,native,20,15),{x:30,y:53});assert.throws(()=>windowPoint(w,window,{frame:{width:600,height:428}},20,15));assert.throws(()=>windowPoint(w,window,native,100,15));
 const ui={focus:'field',widgets:[w,{id:'main',keyWindow:true,nativeWindow:100}]},request={command:'type',window:100,focusTarget:'field'};
 assert.equal(keyboardWindowProof(ui,request).verifiedKeyWindow,100);assert.doesNotThrow(()=>postInputFocus(ui,w,{window:100,status:'Dispatched'},'type'));
 const lost={...ui,focus:'other'};assert.throws(()=>keyboardWindowProof(lost,request),e=>e.status==='Blocked');assert.throws(()=>postInputFocus(lost,w,{window:100,status:'Dispatched'},'type'),e=>e.status==='Unknown'&&e.code==='input_focus_lost');
 assert.throws(()=>keyboardWindowProof(ui,{...request,window:101}),e=>e.status==='Blocked');
});
