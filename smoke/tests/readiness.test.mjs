import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForObservation} from '../desktop/check-support.mjs';

test('readiness waits through transient success and resets its stable interval when observed state changes',async()=>{
 const start=performance.now();let attempts=0;
 const value=await waitForObservation(async()=>{attempts++;const at=performance.now()-start;return at<20?{id:'old'}:at<40?false:{id:'new'};},{timeoutMs:300,intervalMs:10,stableForMs:40});
 assert.equal(value.id,'new');assert.ok(performance.now()-start>=75);assert.ok(attempts>=4);
});
test('readiness never accepts a successful observation that arrives after its deadline',async()=>{
 await assert.rejects(()=>waitForObservation(async()=>{await new Promise(r=>setTimeout(r,30));return {ready:true};},{timeoutMs:10,intervalMs:1}),e=>e.diagnostics?.elapsedMs>=10);
});

const {readyUI,agentTool}=await import('../desktop/agent-tools.mjs');
const {validateToolParams}=await import('../desktop/agent-proof.mjs');
const {previewTransportMatches}=await import('../desktop/recorder.mjs');
const target=()=>({id:'panel',window:'window',nativeWindow:4,enabled:true,x:10,y:20,width:300,height:200,visibleRect:{x:0,y:0,width:300,height:200}});
test('absence requires a complete scoped observation rather than an omitted model or menu row',()=>{
 assert.deepEqual(readyUI({scope:'panel',widgets:[]},{selector:{id:'missing'},condition:'absent'}),{absent:true,scope:'panel'});
 for(const entry of [{rows:65,model:[]},{menuTruncated:true},{clipIdsTruncated:true},{nativeViewsTruncated:true},{sceneItemsTruncated:true},{sceneTextTruncated:true}])assert.throws(()=>readyUI({widgets:[entry]},{selector:{id:'missing'},condition:'absent'}),e=>e.code==='incomplete_observation'&&e.status==='Blocked');
 assert.equal(readyUI({widgets:[target()]},{selector:{id:'panel'},condition:'absent'}),false);
});
test('geometry readiness requires usable finite geometry and no unrelated modal or popup',()=>{
 const ui={widgets:[target()],modalWindow:null,popupWindow:null};
 assert.equal(readyUI(ui,{selector:{id:'panel'},condition:'geometry'}).id,'panel');
 for(const mutate of [u=>u.widgets[0].enabled=false,u=>u.widgets[0].width=0,u=>u.widgets[0].x=NaN,u=>u.widgets[0].visibleRect.height=0,u=>u.widgets[0].visibleRect.width=Infinity,u=>u.modalWindow='dialog',u=>u.popupWindow='menu']){const u=structuredClone(ui);mutate(u);assert.equal(readyUI(u,{selector:{id:'panel'},condition:'geometry'}),false);}
 ui.modalWindow='window';assert.ok(readyUI(ui,{selector:{id:'panel'},condition:'geometry'}));
 assert.throws(()=>readyUI({widgets:[target(),target()]},{selector:{id:'panel'},condition:'geometry'}),e=>e.status==='Blocked');
});
test('focus and key-window waits require observed true state and reject malformed parameters before session access',async()=>{
 for(const condition of ['focused','keyWindow']){
  const w=target();assert.equal(readyUI({widgets:[w]},{selector:{id:w.id},condition}),false);w[condition]=true;assert.equal(readyUI({widgets:[w]},{selector:{id:w.id},condition}).id,w.id);
 }
 validateToolParams('wait',{selector:{id:'panel'},condition:'geometry',scope:'window',timeoutMs:1000,stableForMs:250});
 for(const params of [{condition:'geometery'},{timeoutMs:0},{intervalMs:0},{stableForMs:2001},{timeoutMs:100,condition:'geometry'},{timeoutMs:100,stableForMs:101}])await assert.rejects(()=>agentTool('/does-not-exist/session.json','wait',{selector:{id:'panel'},...params}),e=>e.code!=='ENOENT'&&e.status==='Blocked');
});
test('preview readiness rejects logical state changing around a fresh capture',()=>{
 const state={frame:120,playback_generation:7,playing:false,scrubbing:false},expected={frame:120,playbackGeneration:7},sample={transportBefore:state,transportAfter:{...state}};
 assert.equal(previewTransportMatches(sample,expected),true);
 for(const changed of [{frame:119},{playback_generation:8},{playing:true},{scrubbing:true},{playing:undefined},{frame:NaN}])assert.equal(previewTransportMatches({...sample,transportAfter:{...state,...changed}},expected),false);
 assert.equal(previewTransportMatches({...sample,transportBefore:null},expected),false);
});
test('value waits cannot qualify an unspecified expected value',()=>{
 for(const condition of ['value','text','checked'])assert.throws(()=>validateToolParams('wait',{selector:{id:'field'},condition}),e=>e.code==='invalid_wait');
 validateToolParams('wait',{selector:{id:'field'},condition:'checked',expected:false});
});

test('bundled readiness requires simultaneous conditions and returns the exact successful observation',async()=>{
 const params={conditions:[{selector:{id:'box'},condition:'checked',expected:true},{selector:{id:'field'},condition:'enabled'}],details:true};validateToolParams('wait',params);
 const ui=(checked,enabled)=>({widgets:[{id:'box',checked},{id:'field',enabled,text:'current value'}]});
 assert.equal(readyUI(ui(true,false),params),false);assert.equal(readyUI(ui(false,true),params),false);
 let reads=0;const result=await waitForObservation(async()=>readyUI(++reads===1?ui(true,false):reads===2?ui(false,true):ui(true,true),params),{timeoutMs:500,intervalMs:1});
 assert.equal(reads,3);assert.equal(result.matched,true);assert.equal(result.matchCount,2);assert.equal(result.matches[1].text,'current value');assert.deepEqual(result.conditions.map(c=>c.targetId),['box','field']);
 const absent={conditions:[{selector:{id:'missing'},condition:'absent'},{selector:{id:'field'},condition:'enabled'}]};
 assert.ok(readyUI(ui(false,true),absent));assert.throws(()=>readyUI({widgets:[{id:'field',enabled:true,rows:65,model:[]}]},absent),e=>e.code==='incomplete_observation');
 assert.throws(()=>readyUI({widgets:[{id:'box',checked:true},{id:'box',checked:true},{id:'field',enabled:true}]},params),/ambiguous/);
 const capped=readyUI(ui(true,true),{...params,limit:1});assert.equal(capped.truncated,true);assert.equal(capped.matchCount,2);
});

test('every bundled readiness condition validates before accessing the session',async()=>{
 const condition={selector:{id:'field'},condition:'enabled'};
 for(const params of [
  {conditions:[]},{conditions:Array(9).fill(condition)},{conditions:[condition,{selector:{id:'box'},condition:'checked'}]},
  {conditions:[condition],selector:{id:'field'}},{conditions:[condition],condition:'exists'},
  {conditions:[{selector:{},condition:'exists'}]},{conditions:[{selector:{id:'field'},unknown:true}]},
  {conditions:[condition],limit:0},{conditions:[condition],details:'yes'},
  {conditions:[{selector:{id:'field'},condition:'geometry'}],timeoutMs:100},
 ])await assert.rejects(()=>agentTool('/does-not-exist/session.json','wait',params),e=>e.code!=='ENOENT'&&e.status==='Blocked');
});
