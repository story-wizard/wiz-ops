import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {checks,gapFixture} from './check-support.mjs';
import {createLocalGraphic} from './generated-fixture.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {assert,same,near,clips,snapshotState,pause,OutcomeError} from '../runner/engine.mjs';
import {readPPM,pixelDifference,visibleImage} from '../runner/pixels.mjs';
const verify=process.argv[3]==='verify';
const {s,n,c,ui,until,check,activate,mediaItem,mediaMenu,openTimeline,finish}=await checks(process.argv[2],verify?'desktop-bin-reopen-report.json':'desktop-selection-bin-report.json');
const inspect=timeline_id=>c('timeline.inspect',{timeline_id});
const assets=async()=>(await c('media.list_assets')).assets;
const byId=async id=>(await assets()).find(a=>a.asset_id===id);
const key=(v,key)=>n('key',{target:v.id,key});
const expectedFile=path.join(s.root,'bin-expected.json');
const binIds=['D-BIN-RENAME','D-BIN-DUPLICATE','D-BIN-DELETE','D-BIN-MGFX'];
let serial=0,duplicate;
const retained={pid:s.pid,generation:s.generation,cases:{}};
async function frame(timeline_id,label){const output=path.join(s.root,`selection-bin-${label}-${++serial}.ppm`);await c('render.export_still',{timeline_id,time:{value:24,rate:24},output});return {file:output,image:await readPPM(output)};}
async function undo(v,id,before){try{await key(v,'Ctrl+Z');await until(async()=>JSON.stringify(snapshotState(await inspect(id)))===JSON.stringify(snapshotState(before)));}catch(e){e.fatal=true;throw e;}}
async function linked(enabled){const b=(await ui()).widgets.find(w=>w.name==='panelChromeAction'&&w.text==='Linked');assert(b,'Linked selection control absent');if(b.checked!==enabled){const v=(await ui()).widgets.filter(w=>w.class==='TimelineWidget').sort((a,b)=>a.y-b.y)[0];await key(v,'Ctrl+Shift+L');await until(async()=>(await ui()).widgets.find(w=>w.id===b.id)?.checked===enabled);}}
async function newTimeline(name){const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}});return {id:t.timeline_id,video:t.tracks.find(x=>x.kind==='video').track_id,audio:t.tracks.find(x=>x.kind==='audio').track_id};}
async function place(t,streams='video_only',track=t.video){await c('timeline.place_cuts',{id:`selection-fixture-${++serial}`,timeline_id:t.id,cuts:[{id:'source',source:{asset_id:s.assets.plate},source_range:{start_seconds:1,end_seconds:5},streams,destination:{at:{seconds:0,track}}}]});}
async function header(kind,button){
  const labels=(await ui()).widgets.filter(w=>w.class==='TrackLabelWidget').sort((a,b)=>a.y-b.y),l=labels[kind==='video'?0:1];assert(l&&l.width===120,'Unexpected track-header layout');
  // ponytail: default 60px tracks and flat fixtures; use app geometry hooks if layouts vary.
  await n('click',{target:l.id,x:button==='lock'?55:22,y:kind==='video'?l.height-60+15:15});
}
async function activeOnDisk(id,track){await c('project.checkpoint');const saved=await readJSON(path.join(s.bundle,'timelines',id,'timeline.otio'));const row=saved.tracks.children.find(t=>t.metadata.wiz.track_id===track);assert(row,'Track missing from saved fixture');return row.metadata.wiz.active!==false;}
async function rename(name,next){await mediaMenu(name,'Rename...');const e=await until(async()=>(await ui()).widgets.find(w=>['QLineEdit','QExpandingLineEdit'].includes(w.class)&&w.text===name));await n('text',{target:e.id,text:next});await key(e,'Return');await mediaItem(next);}
async function generationIn(id){await c('project.checkpoint');const t=await readJSON(path.join(s.bundle,'timelines',id,'timeline.otio'));const ids=t.tracks.children.flatMap(t=>t.children||[]).map(x=>x.metadata?.wiz?.generator?.generation_id).filter(Boolean);assert(ids.length===1,'Expected one saved generator in the copied compound');return ids[0];}
if(verify){
  const expected=await readJSON(expectedFile);await writeJSON(path.join(s.root,'bin-reopen-observed.json'),{ui:await ui(),assets:await assets()});assert(expected.pid!==s.pid&&s.generation>expected.generation,'Bin persistence must use a fresh process');
  for(const id of binIds)await check(id,async()=>{
    const e=expected.cases[id];if(!e)throw new OutcomeError('Initial bin check did not establish a persistence fixture','Blocked');
    for(const a of e.assets||[]){same(await byId(a.asset_id),a,'Reopened asset identity/name/path');const name=a.display_name||path.basename(a.local_path);try{await mediaItem(name);}catch{const names=(await ui()).widgets.filter(w=>w.class==='QTreeView').flatMap(w=>w.model.map(r=>r[0]));throw new Error(`Reopened bin is missing ${name}; displayed names: ${JSON.stringify(names)}`);}assert(await sha(a.local_path)===e.sourceHash,'Reopened source bytes changed');}
    if(e.graphic){for(const g of e.graphic.generations)same((await c('generate.inspect',{target:{kind:'generation',generation_id:g.id}})).parameters,g.parameters,'Reopened generated parameters');const actual=await frame(e.graphic.timeline,'reopened');assert(pixelDifference(await readPPM(e.graphic.reference),actual.image)<=1,'Reopened copied graphic pixels changed');}
    return {freshPid:s.pid,generation:s.generation,restored:true};
  });finish();
}else{
  await check('D-LINKED-SELECTION',async()=>{
    const t=await newTimeline('Linked selection smoke');await place(t,'linked');const before=await inspect(t.id),v=await openTimeline(before.timeline.name),original=(await ui()).widgets.find(w=>w.text==='Linked'&&w.name==='panelChromeAction').checked;
    const video=before.tracks.find(t=>t.address==='V1').items.find(i=>i.kind==='clip'),audio=before.tracks.find(t=>t.address==='A1').items.find(i=>i.kind==='clip');assert(video&&audio&&before.links.length===1,'Linked fixture missing');
    try{for(const on of [true,false]){await linked(on);await key(v,'V');await n('click',{target:v.id,x:400,y:v.height-30});await n('click',{target:v.id,x:25,y:v.height-30});await key(v,'.');const changed=await until(async()=>{const t=await inspect(before.timeline.timeline_id);return clips(t).find(x=>x.clip_id===video.clip_id).timeline_range.start_seconds>0?t:null;});await undo(v,t.id,before);const vc=clips(changed).find(x=>x.clip_id===video.clip_id),ac=clips(changed).find(x=>x.clip_id===audio.clip_id);near(vc.timeline_range.start_seconds,1/24,'Video nudge');near(ac.timeline_range.start_seconds,on?1/24:0,'Linked audio nudge');same(vc.source,video.source,'Video source retained');same(ac.source,audio.source,'Audio source retained');same(changed.links,before.links,'Toggle does not unlink material');}return {linkedMove:'both streams',unlinkedSelectionMove:'video only',undoRestored:true};}
    finally{await linked(original);}
  });
  await check('D-TRACK-LOCK-UI',async()=>{
    const t=await newTimeline('Track lock smoke');await place(t);const before=await inspect(t.id),v=await openTimeline(before.timeline.name);await key(v,'V');await n('click',{target:v.id,x:25,y:v.height-30});await header('video','lock');
    await until(async()=>(await inspect(t.id)).tracks.find(x=>x.track_id===t.video).locked);const locked=snapshotState(await inspect(t.id));
    try{await c('playback.seek',{time:2});await key(v,'B');await pause(250);same(snapshotState(await inspect(t.id)),locked,'Locked blade');await key(v,'V');await n('drag',{target:v.id,x:25,y:v.height-30,toX:41,toY:v.height-30});await pause(250);same(snapshotState(await inspect(t.id)),locked,'Locked drag');}
    finally{await header('video','lock');await until(async()=>!(await inspect(t.id)).tracks.find(x=>x.track_id===t.video).locked);}
    same(snapshotState(await inspect(t.id)),snapshotState(before),'Unlock restores state');await n('drag',{target:v.id,x:25,y:v.height-30,toX:41,toY:v.height-30});const moved=await until(async()=>{const a=await inspect(t.id);return clips(a)[0].timeline_range.start_seconds>0?a:null;});await undo(v,t.id,before);same(clips(moved)[0].source,clips(before)[0].source,'Unlocked drag source');return {lockControl:true,refused:['blade','drag'],unlockedDragSeconds:clips(moved)[0].timeline_range.start_seconds,undoRestored:true};
  });
  await check('D-TRACK-TARGETING',async()=>{
    const t=await newTimeline('Track target smoke');await place(t);await place(t,'audio_only',t.audio);await c('timeline.manage_tracks',{id:'second-target-track',timeline_id:t.id,edits:[{id:'v2',action:'add',kind:'video',name:'Target control'}]});const second=(await inspect(t.id)).tracks.find(x=>x.address==='V2').track_id;await place(t,'video_only',second);
    const before=await inspect(t.id),v=await openTimeline(before.timeline.name),original=(await ui()).widgets.find(w=>w.text==='Linked'&&w.name==='panelChromeAction').checked;await linked(false);
    try{
      await header('video','target');assert(await activeOnDisk(t.id,t.video)===false,'V1 targeting did not switch off');await header('audio','target');assert(await activeOnDisk(t.id,t.audio)===false,'A1 targeting did not switch off');
      for(const phase of ['V2 only','Both video tracks']){const baseline=await inspect(t.id);await key(v,'Ctrl+A');await key(v,'Backspace');const remaining=phase==='V2 only'?2:1;const after=await until(async()=>{const a=await inspect(t.id);return clips(a).length===remaining?a:null;});await undo(v,t.id,baseline);const expected=clips(baseline).filter(x=>phase==='V2 only'?x.track_id!==second:x.track_id===t.audio);same(clips(after),expected,'Untargeted clips remain exactly unchanged');if(phase==='V2 only'){await header('video','target');assert(await activeOnDisk(t.id,t.video),'V1 targeting did not restore');}}
      return {scenarios:['only V2 selected','V1 and V2 selected; A1 preserved'],undoRestored:true};
    }finally{if(!(await activeOnDisk(t.id,t.video)))await header('video','target');if(!(await activeOnDisk(t.id,t.audio)))await header('audio','target');await linked(original);}
  });
  await check('D-RIPPLE-GAP',async()=>{
    const before=await gapFixture(c,s.assets,'Ripple gap smoke'),id=before.timeline.timeline_id,v=await openTimeline(before.timeline.name);await writeJSON(path.join(s.root,'gap-baseline.json'),before);await key(v,'V');await n('click',{target:v.id,x:80,y:v.height-30});await writeJSON(path.join(s.root,'gap-click.json'),await n('snapshot-widget',{target:v.id}));await key(v,'Shift+Del');
    const after=await until(async()=>{const a=await inspect(id);return clips(a)[1]?.timeline_range.start_seconds===4?a:null;});await undo(v,id,before);const original=clips(before),changed=clips(after);same(changed[0],original[0],'Ripple preserves preceding clip');same(changed[1].source,original[1].source,'Ripple preserves later source');same(changed[1].timeline_range,{start_seconds:4,end_seconds:6},'Two-second gap removal');return {removedSeconds:2,contentEndSeconds:6,timelineDurationSeconds:after.timeline.duration_seconds,undoRestored:true};
  });
  const main=await gapFixture(c,s.assets,'Bin render smoke'),binTimeline=main.timeline.timeline_id;await writeJSON(path.join(s.root,'bin-render-baseline.json'),main);await openTimeline(main.timeline.name);
  await check('D-BIN-RENAME',async()=>{
    const original=await byId(s.assets.plate),name=original.display_name||path.basename(original.local_path),sourceHash=await sha(original.local_path),reference=await frame(binTimeline,'rename-before');visibleImage(reference.image);
    try{await rename(name,'Renamed smoke plate');const renamed=await byId(original.asset_id);same({...renamed,display_name:original.display_name},original,'Rename preserves asset identity and path');assert(renamed.display_name==='Renamed smoke plate','Rename missing from asset state');await c('project.checkpoint');assert((await readJSON(path.join(s.bundle,'assets/index.json'))).assets.find(a=>a.asset_id===original.asset_id).display_name==='Renamed smoke plate','Rename missing from saved asset');assert(pixelDifference(reference.image,(await frame(binTimeline,'renamed')).image)<=1,'Rename changed timeline rendering');}
    finally{if((await byId(original.asset_id)).display_name!==original.display_name)await rename('Renamed smoke plate',name);}
    same(await byId(original.asset_id),original,'Rename restoration');assert(await sha(original.local_path)===sourceHash,'Rename changed source bytes');retained.cases['D-BIN-RENAME']={assets:[original],sourceHash};return {assetId:original.asset_id,sourceHash,renamedAndRestored:true,renderUnchanged:true};
  });
  await check('D-BIN-DUPLICATE',async()=>{
    const before=await assets(),source=await byId(s.assets.motion),sourceHash=await sha(source.local_path);await mediaMenu(source.display_name||path.basename(source.local_path),'Duplicate');const after=await until(async()=>{const a=await assets();return a.length===before.length+1?a:null;});const added=after.filter(a=>!before.some(b=>b.asset_id===a.asset_id));assert(added.length===1,'Duplicate did not mint one independent asset');duplicate=added[0];assert(await sha(duplicate.local_path)===sourceHash,'Duplicate refers to different source bytes');await rename(duplicate.display_name||path.basename(duplicate.local_path),'Bin duplicate renamed');duplicate=await byId(duplicate.asset_id);assert(duplicate.display_name==='Bin duplicate renamed','Copy rename absent');same(await byId(source.asset_id),source,'Copy rename preserves original');retained.cases['D-BIN-DUPLICATE']={assets:[source,duplicate],sourceHash};return {original:source.asset_id,copy:duplicate.asset_id,sourceHash,independentName:true};
  });
  await check('D-BIN-DELETE',async()=>{
    const original=await byId(s.assets.plate),name=original.display_name||path.basename(original.local_path),sourceHash=await sha(original.local_path),before=await inspect(binTimeline),reference=await frame(binTimeline,'delete-before');visibleImage(reference.image);await mediaMenu(name,'Delete from Bin');
    await until(async()=>!(await ui()).widgets.some(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name)));let changedPixels;
    try{same(snapshotState(await inspect(binTimeline)),snapshotState(before),'Bin delete preserves placed clips');assert(await sha(original.local_path)===sourceHash,'Bin delete removed or changed source');changedPixels=pixelDifference(reference.image,(await frame(binTimeline,'deleted')).image);assert(changedPixels<=1,'Bin deletion broke placed rendering');}
    finally{const mainWindow=(await ui()).widgets.find(w=>w.class==='MainWindow');await activate(mainWindow);await key(mainWindow,'Ctrl+Z');await mediaItem(name);}
    same(await byId(original.asset_id),original,'Delete undo restores original asset');retained.cases['D-BIN-DELETE']={assets:[original],sourceHash};return {assetId:original.asset_id,sourceHash,placedClipsIntact:true,pixelDelta:changedPixels,undoRestored:true};
  });
  await check('D-BIN-MGFX',async()=>{
    const g=await createLocalGraphic(c,s,{groupLabel:'Title',label:'Bin graphic'}),sourceId=g.generation.generation_id,source=await c('generate.inspect',{target:{kind:'generation',generation_id:sourceId}}),reference=await frame(g.timeline,'bin-mgfx-original');
    await mediaMenu('Generated Bin graphic','Duplicate');await mediaItem('Generated Bin graphic copy');await c('project.checkpoint');const rows=[];for(const id of await readdir(path.join(s.bundle,'timelines'))){if(!/^(cmp|tl)_[a-z0-9-]+$/.test(id))continue;const t=await readJSON(path.join(s.bundle,'timelines',id,'timeline.otio'));if(t.name==='Generated Bin graphic copy')rows.push({timeline_id:id,name:t.name});}assert(rows.length===1,'Expected one copied graphic timeline');const copy=rows[0];const copyId=await generationIn(copy.timeline_id);assert(copyId!==sourceId,'Bin duplicate shares source generation');const target={kind:'generation',generation_id:copyId},before=await c('generate.inspect',{target});assert(pixelDifference(reference.image,(await frame(copy.timeline_id,'bin-mgfx-copy')).image)<=1,'Initial copied image differs');await c('generate.set_params',{target,expected_owner_revision:before.owner_revision,expected_params_revision:before.params_rev,values:{'title.text':'INDEPENDENT BIN DUPLICATE 123456789'},reset:[]});same((await c('generate.inspect',{target:{kind:'generation',generation_id:sourceId}})).parameters,source.parameters,'Copy edit leaves original parameters');assert(pixelDifference(reference.image,(await frame(g.timeline,'bin-mgfx-preserved')).image)<=1,'Copy edit changed original image');const edited=await frame(copy.timeline_id,'bin-mgfx-edited');assert(pixelDifference(reference.image,edited.image)>.01,'Copied text did not change pixels');retained.cases['D-BIN-MGFX']={graphic:{timeline:copy.timeline_id,reference:edited.file,generations:[{id:sourceId,parameters:source.parameters},{id:copyId,parameters:(await c('generate.inspect',{target})).parameters}]}};return {source:sourceId,copy:copyId,independentValuesAndPixels:true,scope:'Actual bin context-menu duplication; omitted-group-label failure is retained separately in service course'};
  });
  await openTimeline(main.timeline.name);await c('project.checkpoint');await writeJSON(expectedFile,retained);finish();
}
