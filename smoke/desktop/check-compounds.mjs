import path from 'node:path';
import {checks,visiblePlayhead} from './check-support.mjs';
import {createLocalGraphic} from './generated-fixture.mjs';
import {exportDialog,exportStillDialog} from './export-dialog.mjs';
import {writeJSON} from '../runner/files.mjs';
import {assert,same,clips,snapshotState,command,OutcomeError} from '../runner/engine.mjs';
import {readPPM,pixelDifference} from '../runner/pixels.mjs';
const context=await checks(process.argv[2],'desktop-compounds-report.json'),{s,n,c,ui,until,check,activate,finish}=context;
const inspect=timeline_id=>c('timeline.inspect',{timeline_id});
const focus=async()=>{const v=(await ui()).widgets.filter(w=>w.class==='TimelineWidget').sort((a,b)=>a.y-b.y)[0];assert(v,'Timeline is not visible');await activate(v);return v;};
async function open(name){const u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name))?a:null;});const m=u.widgets.find(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name));await n('item-click',{target:m.id,text:name,double:true});await until(async()=>(await ui()).widgets.some(w=>w.name==='panelSubtabSelector'&&w.text.startsWith(name)));return focus();}
let seq=0;
async function frame(timeline_id,seconds=1){const output=path.join(s.root,`compound-frame-${++seq}.ppm`);await c('render.export_still',{timeline_id,time:{value:seconds*24,rate:24},output});return readPPM(output);}
let parent,child,compound,baseline,graphic;
async function restore(fn){try{return await fn();}catch(e){e.fatal=true;throw e;}}
const needCompound=()=>{if(!child)throw new OutcomeError('Compound creation prerequisite failed','Blocked');};
await check('D-COMPOUND-CREATE',async()=>{
  const t=await c('timeline.duplicate',{source_timeline_id:s.main.id,name:'Compound smoke parent'});parent=t.timeline_id;baseline=await inspect(parent);const before=await frame(parent),v=await open(baseline.timeline.name);
  // ponytail: hit points are tied to the tiny GP and default timeline zoom.
  await n('key',{target:v.id,key:'V'});await n('click',{target:v.id,x:25,y:115});await n('key',{target:v.id,key:'Ctrl+G'});
  const u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.class==='QInputDialog'&&w.title==='Convert to Timeline')?a:null;}),d=u.widgets.find(w=>w.class==='QInputDialog');
  try{await n('text',{target:u.widgets.find(w=>w.window===d.id&&w.class==='QLineEdit').id,text:'Smoke compound child'});await n('click',{target:u.widgets.find(w=>w.window===d.id&&w.text==='OK').id});await until(async()=>!(await ui()).widgets.some(w=>w.id===d.id));}
  finally{const cancel=(await ui()).widgets.find(w=>w.window===d.id&&w.text==='Cancel');if(cancel)await n('click',{target:cancel.id});}
  const after=await until(async()=>{const a=await inspect(parent);return clips(a).some(x=>x.source.kind==='timeline_ref')?a:null;});compound=clips(after).find(x=>x.source.kind==='timeline_ref');child=compound.source.timeline_id;assert(child&&child!==parent,'Conversion omitted its child identity');same(compound.timeline_range,clips(baseline)[0].timeline_range,'Compound placement');assert(pixelDifference(before,await frame(parent))<=1,'Conversion changed rendered content');
  const inner=await inspect(child);assert(clips(inner).length===1&&clips(inner)[0].source.asset_id===clips(baseline)[0].source.asset_id,'Converted child lost its source');await writeJSON(path.join(s.root,'compound-created.json'),{parent:after,child:inner});return {parent,child,clip:compound.clip_id,createdThrough:'Command+G dialog',pixelsPreserved:true};
});
await check('D-COMPOUND-EDIT',async()=>{
  needCompound();const before=await inspect(child),original=await frame(parent),v=await open(before.timeline.name);await n('click',{target:v.id,x:25,y:115});await n('key',{target:v.id,key:'D'});
  const disabled=await until(async()=>{const a=await inspect(child);return clips(a)[0].enabled===false?a:null;});let delta;
  try{await open((await inspect(parent)).timeline.name);delta=pixelDifference(original,await frame(parent));assert(delta>10,'Child disable did not change parent pixels');}
  finally{await restore(async()=>{const inner=await open(before.timeline.name);await n('key',{target:inner.id,key:'Ctrl+Z'});await until(async()=>JSON.stringify(snapshotState(await inspect(child)))===JSON.stringify(snapshotState(before)));await open((await inspect(parent)).timeline.name);});}
  assert(pixelDifference(original,await frame(parent))<=1,'Undo did not restore parent pixels');return {child,editedClip:clips(disabled)[0].clip_id,pixelDelta:delta,undoRestored:true,scope:'Open converted child from Media, edit it, return to parent; inline expansion gestures remain separate'};
});
await check('D-MGFX-CLIPBOARD',async()=>{
  graphic=await createLocalGraphic(c,s,{groupLabel:'Title'});const name=(await inspect(graphic.timeline)).timeline.name,v=await open(name),before=await inspect(graphic.timeline),original=await frame(graphic.timeline);await n('click',{target:v.id,x:16,y:115});await n('clipboard-save');
  try{
    await n('key',{target:v.id,key:'Ctrl+C'});assert((await n('clipboard-mark')).formats.includes('application/x-wizard-timeline-clips'),'MGFX copy omitted clipboard data');await c('playback.seek',{time:2});await n('key',{target:v.id,key:'Ctrl+V'});
    const pasted=await until(async()=>{const a=await inspect(graphic.timeline);return clips(a).length===clips(before).length+1?a:null;}),added=clips(pasted).find(x=>!clips(before).some(y=>y.clip_id===x.clip_id));assert(added,'Pasted clip is absent');
    const target={kind:'generated_placement',timeline_id:graphic.timeline,clip_id:added.clip_id},copy=await c('generate.inspect',{target}),source=await c('generate.inspect',{target:{kind:'generation',generation_id:graphic.generation.generation_id}});assert(copy.generation_id!==source.generation_id,'Keyboard paste shares the original generation');
    await c('generate.set_params',{target,expected_owner_revision:copy.owner_revision,expected_params_revision:copy.params_rev,values:{'title.text':'KEYBOARD COPY IS INDEPENDENT 123456789'},reset:[]});same((await c('generate.inspect',{target:{kind:'generation',generation_id:source.generation_id}})).parameters,source.parameters,'Keyboard copy edit preserves original');assert(pixelDifference(original,await frame(graphic.timeline))<=1,'Keyboard copy changed original pixels');assert(pixelDifference(original,await frame(graphic.timeline,3))>.01,'Keyboard copy edit did not change copied pixels');return {source:source.generation_id,copy:copy.generation_id,clip:added.clip_id,clipboard:true,independentPixels:true};
  }finally{await restore(async()=>assert((await n('clipboard-restore')).restored,'Clipboard restoration failed'));}
});
await check('D-EXPORT-COMPOUND',async()=>{
  needCompound();const g=await createLocalGraphic(c,s,{groupLabel:'Title'}),t=await inspect(g.timeline),track=t.tracks.find(x=>x.address==='V1').track_id;
  const originalParent=snapshotState(await inspect(parent));
  await c('timeline.move_clips',{id:'compound-export-placement',source:{timeline_id:parent,selection:{clip_ids:[compound.clip_id]}},destination:{timeline_id:g.timeline,at:{seconds:2,track}},copy:true,ripple:{source:false,destination:false}});
  same(snapshotState(await inspect(parent)),originalParent,'Export fixture copy preserves parent');
  const expected=[await frame(g.timeline,1),await frame(g.timeline,3)];assert(pixelDifference(...expected)>10,'Export fixture does not distinguish MGFX and converted media');await open((await inspect(g.timeline)).timeline.name);
  const output=path.join(s.root,'compound-mgfx-export.mp4'),result=await exportDialog(context,output,4),deltas=[];
  for(let i=0;i<2;i++){const decoded=output+`.${i}.ppm`,r=await command(path.join(s.cliApp,'Contents/MacOS/ffmpeg'),['-v','error','-i',output,'-ss',String(1+i*2),'-frames:v','1','-pix_fmt','rgb24',decoded]);assert(r.code===0,'Cannot decode compound export');const pixels=await readPPM(decoded),delta=pixelDifference(pixels,expected[i]);assert(delta+5<pixelDifference(pixels,expected[1-i]),'Export does not contain the expected segment imagery');deltas.push(delta);}
  return {...result,mgfx:g.generation.generation_id,ordinaryChild:child,pixelDeltas:deltas,scope:'Real export dialog prepares authorized MGFX bindings; decoded frames distinguish graphic and converted timeline. Not calibrated colour or audio sync.'};
});
await check('D-COMPOUND-DISSOLVE',async()=>{
  needCompound();const before=await inspect(parent),original=await frame(parent),v=await open(before.timeline.name);await n('click',{target:v.id,x:25,y:115});await n('key',{target:v.id,key:'Ctrl+Shift+G'});
  const dissolved=await until(async()=>{const a=await inspect(parent);return !clips(a).some(x=>x.source.kind==='timeline_ref')?a:null;});assert(clips(dissolved).length===clips(baseline).length,'Dissolve changed clip count');assert(pixelDifference(original,await frame(parent))<=1,'Dissolve changed pixels');await restore(async()=>{await n('key',{target:v.id,key:'Ctrl+Z'});await until(async()=>JSON.stringify(snapshotState(await inspect(parent)))===JSON.stringify(snapshotState(before)));});return {dissolved:true,undoRestored:true,pixelsPreserved:true};
});
await check('D-EXPORT-STILL',async()=>{
  const main=await inspect(s.main.id);await open(main.timeline.name);await c('playback.seek',{time:1});const readout=await until(async()=>{const observed=visiblePlayhead(await ui());return Math.abs(observed.seconds-1)<.001?observed:null;},{description:'Still-export playhead at one second'});
  const expected=await frame(s.main.id,1),other=await frame(s.main.id,7),result=await exportStillDialog(context,path.join(s.root,'playhead.jpg')),actual=await readPPM(result.decoded),delta=pixelDifference(actual,expected);assert(delta+.5<pixelDifference(actual,other),'Dialog still does not correspond to the selected playhead frame');return {...result,playheadFrame:24,visibleReadout:readout,pixelDelta:delta,scope:'Actual Still at Playhead dialog; correspondence, not calibrated colour matching'};
});
await open((await inspect(s.main.id)).timeline.name);await c('project.checkpoint');finish();
