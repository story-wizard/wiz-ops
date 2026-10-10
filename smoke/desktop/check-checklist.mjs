import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {checks,widgetPixelDifference,requireRedGraphic,sourceColorControl,selectMenuValue,hasAuthoredSourceColor} from './check-support.mjs';
import {physicalInput} from './physical-input.mjs';
import {createLocalGraphic} from './generated-fixture.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,same,clips,snapshotState,OutcomeError,pause} from '../runner/engine.mjs';
const file=process.argv[2],{s,n,c,ui,until,check,step,action,openTimeline,mediaItem,finish}=await checks(file,'desktop-checklist-report.json');
const inspect=id=>c('timeline.inspect',{timeline_id:id}),graph=scope=>c('graph.get_clip_graph',scope);
async function fixture(name){const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}});await c('timeline.place_cuts',{id:randomUUID(),timeline_id:t.timeline_id,cuts:[{id:'clip',source:{asset_id:s.assets.plate},source_range:{start_seconds:1,end_seconds:5},streams:'video_only',destination:{at:{seconds:0,track:t.tracks.find(x=>x.kind==='video').track_id}}}]});const before=await inspect(t.timeline_id),view=await openTimeline(name);return {id:t.timeline_id,before,view,scope:{timeline_id:t.timeline_id,clip_id:clips(before)[0].clip_id}};}
async function select(f){await n('key',{target:f.view.id,key:'V'});const r=await n('timeline-clip-rect',{target:f.view.id,clipId:f.scope.clip_id});await n('click',{target:f.view.id,x:r.visibleRect.x+10,y:r.visibleRect.y+r.visibleRect.height/2});await c('playback.seek',{time:1});}
async function displayed(label){const preview=(await ui()).widgets.find(w=>w.class==='MetalPreviewWidget');assert(preview,'Displayed preview missing');const receipt=await physicalInput(file,'screenshot',{target:preview.id,crop:true}),image={...receipt,path:receipt.output};await writeJSON(path.join(s.root,label+'.json'),image);return image;}
await check('D-EXTERNAL-RELOAD',async()=>{
 const f=await fixture('External reload smoke'),disk=path.join(s.bundle,'timelines',f.id,'timeline.otio');await c('project.checkpoint');
 await c('timeline.update',{id:randomUUID(),timeline_id:f.id,changes:{name:'Unsaved reload smoke'}});await until(async()=>(await ui()).widgets.some(w=>w.name==='panelSubtabSelector'&&w.text.startsWith('Unsaved reload smoke')));
 const before=await inspect(f.id),external=await readJSON(disk),name='External disk '+randomUUID();external.name=name;
 await step({id:'external-edit',title:'Edit the owned timeline on disk while the editor is dirty',phase:'execute'},()=>writeJSON(disk,external));
 await writeJSON(path.join(s.root,'external-reload-before.json'),{before,external});
 let toast;try{toast=await until(async()=>{const a=await ui();return a.widgets.find(w=>w.text?.includes('External edit detected')&&w.text.includes('reload from disk'));},{description:'External-edit reload notification',timeoutMs:15000});}
 finally{const observed={reloadShortcutSent:false};try{observed.timeline=await inspect(f.id);observed.ui=await ui();}catch(e){observed.captureError=e.message;}await writeJSON(path.join(s.root,'external-reload-observed.json'),observed);}
 assert((await inspect(f.id)).timeline.name===before.timeline.name,'External edit silently overwrote the dirty live timeline');
 await writeJSON(path.join(s.root,'external-reload-before.json'),{before,external,toast});
 await step({id:'reload',title:'Use the Reload Timeline shortcut and inspect the adopted content',phase:'execute'},()=>n('key',{target:f.view.id,key:'Ctrl+Shift+R'}));
 const after=await until(async()=>{const t=await inspect(f.id);return t.timeline.name===name?t:null;},{description:'Reloaded external timeline name'});
 same(after.tracks,before.tracks,'Reload preserves every track and clip');assert((await ui()).widgets.some(w=>w.name==='panelSubtabSelector'&&w.text.startsWith(name)),'Reloaded name not visible');
 await c('project.checkpoint');assert((await readJSON(disk)).name===name,'Reloaded state was not saved');return {before,after,toast:toast.text,externalFile:disk,screen:await n('snapshot-presented',{target:f.view.id})};
});
await check('D-SOURCE-COLOR',async()=>{
 const f=await fixture('Source colour override');await select(f);if(!(await ui()).widgets.some(w=>w.class==='RenderGraphView'))await action('Render Graph');
 const before=await graph(f.scope),source=before.nodes.find(n=>n.type==='wiz.color.input_color_space_transform');assert(source,'Source colour transform absent');const original=source.params['input.cst.src'];
 const view=await until(async()=>(await ui()).widgets.find(w=>w.class==='RenderGraphView'&&w.timelineId===f.id)),control=sourceColorControl(await ui(),view.id);
 const baseline=await displayed('source-colour-before');let selected,choice;
 await step({id:'override',title:'Choose a different source colour space',phase:'execute'},async()=>{
  if(control.class==='QComboBox'){
   const index=control.itemValues?.findIndex((value,i)=>typeof value==='string'&&value&&value!==original&&!/auto|detect/i.test(control.items[i])&&/sRGB|ACEScg|Rec\.709/.test(control.items[i]));
   if(!(index>=0))throw new OutcomeError('Source colour picker has no distinct semantic choice','Blocked');selected=control.itemValues[index];choice=control.items[index];await n('select',{target:control.id,index});
  }else{
   selected=original==='ACEScg'?'sRGB - Texture':'ACEScg';await n('click',{target:control.id});
   const menu=await until(async()=>{const menus=(await ui()).widgets.filter(w=>w.class==='QMenu');return menus.length===1?menus[0]:null;},{description:'Source colour options menu'});
   await writeJSON(path.join(s.root,'source-colour-menu.json'),menu);choice=await selectMenuValue({n,ui,until},menu,selected);
  }
 });
 const changed=await until(async()=>{const g=await graph(f.scope);return hasAuthoredSourceColor(g,source.type,selected)?g:null;},{description:'Authored source colour override'});await pause(300);const image=await displayed('source-colour-changed');assert(widgetPixelDifference(baseline,image)>.5,'Colour override did not change the displayed pixels');
 await n('activate',{target:view.window});await n('key',{target:view.id,key:'Ctrl+Z'});
 const restored=await until(async()=>{const g=await graph(f.scope);return JSON.stringify(g.nodes)===JSON.stringify(before.nodes)&&JSON.stringify(g.edges)===JSON.stringify(before.edges)?g:null;},{description:'Undo restores original source colour and provenance'});await pause(300);assert(widgetPixelDifference(baseline,await displayed('source-colour-restored'))<1.5,'Reverting source colour did not restore the displayed image');same(snapshotState(await inspect(f.id)),snapshotState(f.before),'Colour override preserves timeline identity and timing');return {original,choice,selected,before,changed,restored,baseline:baseline.path,image:image.path};
});
await check('D-MGFX-BIN-DROP',async()=>{
 let g;try{g=await createLocalGraphic(c,s,{groupLabel:'Title',label:'Drag graphic'});}catch(e){throw new OutcomeError('Local graphic fixture unavailable: '+e.message,e.status==='Unknown'?'Unknown':'Blocked');}
 const sourceId=g.placement.nestedTimelineId||g.timeline,sourceName=(await inspect(sourceId)).timeline.name;
 await openTimeline(sourceName);await c('render.bind_timeline',{timeline_id:sourceId});await c('playback.seek',{time:.5});await pause(300);const reference=await displayed('graphic-source-preview');requireRedGraphic(reference);
 const t=await c('timeline.create',{name:'Graphic drag destination',video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),before=await inspect(t.timeline_id),view=await openTimeline('Graphic drag destination',t.tracks.find(t=>t.kind==='video').track_id),bin=await mediaItem(sourceName);await n('item-click',{target:bin.id,text:sourceName});
 const observed=(await ui()).widgets.find(w=>w.id===bin.id),row=observed.model.findIndex(r=>r[0]===sourceName),r=observed.itemRects.find(r=>r.row===row);assert(r?.width>0&&r.height>0,'Generated graphic bin row is not visible');
 const receipt=await step({id:'drag',title:'Physically drag the local generated graphic from Media onto V1',phase:'execute'},()=>physicalInput(file,'drag',{target:bin.viewport,x:r.x+Math.min(70,r.width/2),y:r.y+r.height/2,toTarget:view.id,toX:0,toY:view.height-30}));
 const after=await until(async()=>{const a=await inspect(t.timeline_id);return clips(a).length===1?a:null;},{description:'Generated graphic placement from the bin'}),clip=clips(after)[0];assert(clip.track_id===before.tracks.find(t=>t.address==='V1').track_id&&clip.timeline_range.start_seconds===0&&clip.timeline_range.end_seconds===2,'Generated graphic placed on the wrong track or range');assert(clip.source.timeline_ref===g.placement.nestedTimelineId||clip.source.timeline_ref===g.timeline,'Drop does not reference the generated graphic timeline');
 await c('render.bind_timeline',{timeline_id:t.timeline_id});await c('playback.seek',{time:.5});await pause(300);const image=await displayed('graphic-drag-preview');requireRedGraphic(image);assert(widgetPixelDifference(reference,image)<1.5,'Dropped graphic differs from the known source preview');await c('playback.play');await pause(500);const transport=await c('playback.query_transport');await c('playback.pause');assert(transport.playing&&transport.frame>12,'Generated graphic playback did not advance');
 await physicalInput(file,'key',{target:view.id,key:'cmd+z'});await until(async()=>JSON.stringify(snapshotState(await inspect(t.timeline_id)))===JSON.stringify(snapshotState(before)));return {generation:g.generation.generation_id,sourceName,sourceTimeline:g.placement.nestedTimelineId||g.timeline,receipt,after,transport,image:image.path,reference:reference.path,scope:'Local deterministic MGFX fixture; bin drag, playback and Undo. Oz conversation generation is a separate path.'};
});
finish();
