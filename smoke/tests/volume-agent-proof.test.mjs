import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beginProof,verifyCheckpoint,physicalAction} from '../desktop/agent-proof.mjs';
const definitions=JSON.parse(readFileSync(new URL('../desktop/course.json',import.meta.url))).cases;
const timeline=(id='source',count=1)=>({timeline:{timeline_id:id,name:count===1?'Long history seed 50':id,frame_rate:{numerator:24,denominator:1}},tracks:[{track_id:id+'v',address:'V1',items:Array.from({length:count},(_,i)=>({kind:'clip',clip_id:id+i,track_id:id+'v',source:{asset_id:'plate',source_range:{start_seconds:1,end_seconds:3}},timeline_range:{start_seconds:1+i*2,end_seconds:3+i*2},enabled:true}))}],links:[]});
const view=t=>({id:'view',window:'window',class:'TimelineWidget',clipIds:t.tracks[0].items.map(c=>c.clip_id)});
function freeze(proof,observed,ui,session){const result=verifyCheckpoint(proof,'baseline',observed,ui,session);proof.baseline=observed;proof.binding=result.binding;return result;}
test('history agent contract expands all 150 required action/verification pairs and uses the scripted nudge oracle',()=>{
 const proof=beginProof(definitions.find(c=>c.id==='D-HISTORY-50'),'physical'),base={timeline:timeline()},ui={widgets:[view(base.timeline)]},session={assets:{plate:'plate'},proofTarget:'view',proofRead:{timeline_id:'source'}};
 freeze(proof,base,ui,session);assert.equal(proof.contract.checkpoints.length,150);
 for(const point of proof.contract.checkpoints){
  const action=proof.contract.actions.find(a=>a.checkpoint===point.id);
  assert.throws(()=>verifyCheckpoint(proof,point.id,base,ui,session),e=>e.code==='required_action_missing');
  proof.actions.push({...action,receipt:{status:'Dispatched'}});
  const observed=structuredClone(base);for(const key of ['start_seconds','end_seconds'])observed.timeline.tracks[0].items[0].timeline_range[key]+=point.frame/24;
  assert.equal(verifyCheckpoint(proof,point.id,observed,ui,session).matched,true);
  observed.timeline.tracks[0].items[0].timeline_range.start_seconds+=1/24;
  assert.throws(()=>verifyCheckpoint(proof,point.id,observed,ui,session),e=>e.status==='Fail');
 }
 assert.throws(()=>beginProof({...proof.definition,proof:{...proof.definition.proof,repetitions:49}}));
});
test('agent search freezes its query and rejects incomplete empty results through the shared oracle',()=>{
 const proof=beginProof(definitions.find(c=>c.id==='D-SEARCH-EMPTY')),base={timeline:timeline()},ui={widgets:[view(base.timeline),{id:'field',window:'window',class:'MediaSearchField',text:'',editableText:true},{id:'bin',window:'window',class:'QTreeView',rows:1,model:[['pattern_24.mov']]},{id:'status',name:'mediaSearchStatus',text:'1 match'}],actions:[{text:'Name',checked:true}]},session={assets:{plate:'plate'},proofTarget:'view',proofRead:{timeline_id:'source'},harnessId:'owned'};
 freeze(proof,base,ui,session);
 for(const point of proof.contract.checkpoints){
  proof.actions.push(...proof.contract.actions.filter(a=>a.checkpoint===point.id).map(a=>({...a,receipt:{status:'Dispatched'}})));
  ui.widgets[1].text=point.id==='missing'?'athanor_missing_owned':'pattern_24';ui.widgets[2].model=point.id==='missing'?[]:[['pattern_24.mov']];ui.widgets[2].rows=ui.widgets[2].model.length;ui.widgets[3].text=point.id==='missing'?'No results for query':'1 match';
  const result=verifyCheckpoint(proof,point.id,base,ui,session);assert.equal(result.matched,true);proof.checkpoints[point.id]=result;
  if(point.id==='missing'){ui.widgets[3].text='Searching…';assert.throws(()=>verifyCheckpoint(proof,point.id,base,ui,session));ui.widgets[3].text='No results for query';}
 }
 const action=proof.contract.actions.find(a=>a.id==='positive-type');proof.checkpoints={};
 // Earlier actions are recorded, so checking the declared text still cannot admit an arbitrary query.
 proof.actions=proof.actions.filter(a=>a.checkpoint==='positive'&&a.command!=='type'&&a.key!=='Return');
 assert.throws(()=>physicalAction(proof,{command:'type',text:'other',actionId:action.id},ui.widgets[1]),e=>e.code==='wrong_test_action');
});
test('clipboard agent oracle verifies all identities and source preservation, not just the pasted count',()=>{
 const proof=beginProof(definitions.find(c=>c.id==='D-CLIPBOARD-LARGE')),source=timeline('source',100),empty=timeline('destination',0),base={timeline:source,empty},ui={widgets:[view(source),{id:'bin',window:'window',class:'QTreeView',viewport:'viewport',model:[['destination']],itemRects:[{row:0,x:0,y:0,width:100,height:20}]}]},session={assets:{plate:'plate'},proofTarget:'view',proofRead:{timeline_id:'source'}};
 freeze(proof,base,ui,session);
 const pasted=timeline('destination',100);pasted.timeline.name='destination';
 for(const point of proof.contract.checkpoints){
  proof.actions.push(...proof.contract.actions.filter(a=>a.checkpoint===point.id).map(a=>({...a,receipt:{status:'Dispatched'}})));
  const t=point.id==='copied'?source:['destination','undone'].includes(point.id)?empty:pasted;ui.widgets[0]={...view(t),id:point.id==='copied'?'view':'destination-view'};
  if(point.id==='destination'){session.proofTarget='destination-view';ui.widgets.push({name:'panelSubtabSelector',window:'window',text:'destination (1)'});}else session.proofTarget=null;
  const observed={timeline:t,source,clipboard:{formats:['application/x-wizard-timeline-clips']}};
  const result=verifyCheckpoint(proof,point.id,observed,ui,session);assert.equal(result.matched,true);proof.checkpoints[point.id]=result;if(result.bindingUpdate)Object.assign(proof.binding,result.bindingUpdate);
  if(point.id==='destination'){
   const wrong=structuredClone(ui);wrong.widgets.at(-1).text='source';assert.throws(()=>verifyCheckpoint(proof,point.id,observed,wrong,session),e=>e.status==='Fail');
   const wrongCanvas=structuredClone(ui);wrongCanvas.widgets[0].clipIds=['foreign'];assert.throws(()=>verifyCheckpoint(proof,point.id,observed,wrongCanvas,session),e=>e.status==='Fail');
  }
  const bad=structuredClone(observed);bad.source.tracks[0].items[0].source.asset_id='foreign';assert.throws(()=>verifyCheckpoint(proof,point.id,bad,ui,session),e=>e.status==='Fail');
 }
});

test('clipboard destination opens through a double click on the frozen row, rejecting Return and other geometry',()=>{
 const proof=beginProof(definitions.find(c=>c.id==='D-CLIPBOARD-LARGE')),source=timeline('source',100),empty=timeline('destination',0),ui={widgets:[view(source),{id:'bin',window:'window',class:'QTreeView',viewport:'viewport',model:[['destination']],itemRects:[{row:0,x:0,y:27,width:100,height:20}]}]};
 freeze(proof,{timeline:source,empty},ui,{assets:{plate:'plate'},proofTarget:'view',proofRead:{timeline_id:'source'}});
 proof.checkpoints.copied={capture:{}};const target={id:'viewport',window:'window',class:'QWidget'},point=proof.binding.points['destination-click'];
 const clicked=physicalAction(proof,{actionId:'destination-click',command:'click',...point},target);proof.actions.push(clicked);
 assert.throws(()=>physicalAction(proof,{actionId:'destination-open',command:'key',key:'Return'},target),e=>e.code==='wrong_action_target');
 assert.throws(()=>physicalAction(proof,{actionId:'destination-open',command:'click',...point},target),e=>e.code==='wrong_action_target');
 assert.throws(()=>physicalAction(proof,{actionId:'destination-open',command:'click',clickCount:2,x:point.x,y:point.y+27},target),e=>e.code==='wrong_action_target');
 assert.equal(physicalAction(proof,{actionId:'destination-open',command:'click',clickCount:2,...point},target).id,'destination-open');
});
