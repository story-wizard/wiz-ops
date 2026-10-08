import test from 'node:test';
import assert from 'node:assert/strict';
import {configureExport,setExportOutput} from '../desktop/export-dialog.mjs';

function harness(modern){
 const widget=(id,extra)=>({id,window:'dialog',enabled:true,...extra});
 const widgets=[widget('start',{name:'exportStartEdit',text:'00:00:01:00'}),widget('end',{name:'exportEndEdit',text:'00:00:08:00'}),widget('export',{class:'QPushButton',text:'Export'}),widget('foreign',{window:'other',name:'exportNameEdit',text:'untouched'})];
 if(modern)widgets.push(widget('preset',{name:'exportPreset_h264',checked:false}),widget('still',{name:'exportPreset_still',checked:false}),widget('custom',{name:'exportRange2'}),widget('name',{name:'exportNameEdit',text:'movie'}),widget('location',{name:'exportLocationEdit',text:'/default'}));
 else widgets.push(widget('format',{name:'exportFormatCombo',items:['MP4 (H.264)','Still at Playhead']}),widget('output',{class:'QLineEdit',text:'movie.mp4'}));
 const actions=[],ui=async()=>({widgets:structuredClone(widgets)}),n=async(op,p)=>{actions.push({op,...p});const w=widgets.find(w=>w.id===p.target);assert.ok(w);if(op==='text')w.text=p.text;if(op==='click')w.checked=true;if(op==='select'){w.index=p.index;widgets.find(w=>w.id==='output').text=p.index?'still.jpg':'movie.mp4';}};
 return {widgets,actions,ui,n,until:async fn=>{const result=await fn();assert.ok(result,'Expected control state never appeared');return result;}};
}
test('export configuration supports both reviewed dialogs and sets custom range and exact destination',async()=>{
 for(const modern of [false,true])for(const still of [false,true]){
  const h=harness(modern),output='/tmp/owned/'+(still?'frame.jpg':'movie.mp4');
  assert.equal((await configureExport(h,'dialog',output,{still,seconds:2})).id,'export');
  assert.equal(h.widgets.find(w=>w.id==='foreign').text,'untouched');
  if(modern){assert.equal(h.widgets.find(w=>w.id==='name').text,still?'frame.jpg':'movie.mp4');assert.equal(h.widgets.find(w=>w.id==='location').text,'/tmp/owned');assert.equal(h.widgets.find(w=>w.id===(still?'still':'preset')).checked,true);}
  else assert.equal(h.widgets.find(w=>w.id==='output').text,output);
  if(!still){assert.equal(h.widgets.find(w=>w.id==='start').text,'00:00:00:00');assert.equal(h.widgets.find(w=>w.id==='end').text,'00:00:02:00');if(modern)assert.equal(h.widgets.find(w=>w.id==='custom').checked,true);}
  else assert.ok(!h.actions.some(a=>a.target==='start'||a.target==='end'));
 }
});
test('export binds owned controls and blocks missing or ambiguous fields rather than dispatching arbitrary input',async()=>{
 for(const fault of ['missing','duplicate']){
  const h=harness(true);if(fault==='missing')h.widgets.splice(h.widgets.findIndex(w=>w.id==='location'),1);else h.widgets.push({...h.widgets.find(w=>w.id==='location'),id:'duplicate'});
  await assert.rejects(()=>setExportOutput(h,'dialog','/tmp/output.mp4'),e=>e.status==='Blocked');assert.equal(h.actions.length,0);
 }
 const h=harness(true);h.widgets.splice(h.widgets.findIndex(w=>w.id==='preset'),1);await assert.rejects(()=>configureExport(h,'dialog','/tmp/movie.mp4'),e=>e.status==='Blocked');assert.equal(h.actions.length,0);
});
