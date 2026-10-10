import path from 'node:path';
import {mkdir,copyFile,lstat} from 'node:fs/promises';
import {uiWorkflows} from './ui-workflows.mjs';
import {withMissingSource,mediaPlacementState,rawNotesHistory} from './functional-cohort-proof.mjs';
import {waitForPreview} from './recorder.mjs';
import {widgetPixelDifference} from './check-support.mjs';
import {assert,same,clips} from '../runner/engine.mjs';
const file=process.argv[2],verify=process.argv[3]==='verify',h=await uiWorkflows(file,verify?'desktop-functional-cohort-reopen-report.json':'desktop-functional-cohort-report.json');
const {s,c,ui,until,check,physical,openTimeline,activate,observe,capture,unique,finish}=h;
if(!verify)await check('D-MISSING-MEDIA-LIVE',async()=>{
 const id='D-MISSING-MEDIA-LIVE',directory=path.join(s.root,'availability-fixture'),source=path.join(directory,'availability.mov');await mkdir(directory);await copyFile((await c('media.resolve_path',{asset_id:s.assets.plate})).path,source);
 await c('media.add_media_root',{path:directory});const asset=(await c('media.import_asset',{path:source})).asset_id;assert(asset,'Availability fixture import has no identity');
 const t=await c('timeline.create',{name:'Live source availability',video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),track=t.tracks.find(t=>t.kind==='video').track_id;
 await c('timeline.place_cuts',{id:'availability-fixture',timeline_id:t.timeline_id,cuts:[{id:'source',source:{asset_id:asset},source_range:{start_seconds:0,end_seconds:8},streams:'video_only',destination:{at:{seconds:0,track}}}]});
 const view=await openTimeline('Live source availability',track),before=await c('timeline.inspect',{timeline_id:t.timeline_id}),placement=mediaPlacementState(before);assert(clips(before).length===1,'Availability fixture has extra clips');
 async function preview(phase,predicate){await c('playback.seek',{time:5});const q=await until(async()=>{const t=await c('playback.query_transport');return t.frame===120&&!t.playing&&!t.scrubbing?t:null;});const target=unique(await ui(),w=>w.class==='MetalPreviewWidget','Owned Preview');const result=await waitForPreview(file,{target:target.id,frame:q.frame,playbackGeneration:q.playback_generation},predicate);h.retained.set(id,[...(h.retained.get(id)||[]),...result.artifacts]);return result;}
 let previous;const baseline=await preview('baseline',image=>{const sameFrame=previous&&widgetPixelDifference(previous,image)<1.5;previous=image;return sameFrame&&Buffer.from(image.sampleRgb,'base64').some(v=>v>80);});
 const timelineBefore=await capture(id,'before-timeline',view.id,'widget');await observe(id,'baseline',{asset,placement,preview:baseline});
 const missing=await withMissingSource(s.root,source,async()=>{
  assert(await lstat(source).catch(e=>{if(e.code==='ENOENT')return null;throw e;})===null,'Source loss did not occur');await c('media.probe',{path:source},['probe_failed']);
  const shown=await preview('missing',image=>widgetPixelDifference(image,baseline.image)>3);
  const timelineMissing=await capture(id,'missing-timeline',view.id,'widget');assert(widgetPixelDifference(timelineBefore,timelineMissing)>.1,'Timeline did not repaint its unavailable media marks');
  same(mediaPlacementState(await c('timeline.inspect',{timeline_id:t.timeline_id})),placement,'Unavailable source preserves placement');await observe(id,'missing',{asset,preview:shown,timelineDelta:widgetPixelDifference(timelineBefore,timelineMissing)});return {preview:shown,timelineDelta:widgetPixelDifference(timelineBefore,timelineMissing)};
 });
 const restored=await preview('restored',image=>widgetPixelDifference(image,baseline.image)<=1.5),timelineRestored=await capture(id,'restored-timeline',view.id,'widget');assert(widgetPixelDifference(timelineBefore,timelineRestored)<=1.5,'Restored timeline kept stale missing marks');
 same(mediaPlacementState(await c('timeline.inspect',{timeline_id:t.timeline_id})),placement,'Recovered placement');same((await c('media.resolve_path',{asset_id:asset})).path,source,'Recovered source path');
 await activate(view);await physical('key',{target:view.id,key:'Space'});await until(async()=>{const t=await c('playback.query_transport');return t.playing&&t.frame>123?t:null;},{description:'Recovered playback advances'});await physical('key',{target:view.id,key:'Space'});await until(async()=>!(await c('playback.query_transport')).playing,{description:'Recovered playback pauses'});
 await observe(id,'restored',{source,asset,preview:restored,placement});
 return {asset,source,sourceHash:missing.sha256,missing:missing.observation,restored,artifacts:[...baseline.artifacts,...missing.observation.preview.artifacts,...restored.artifacts],scope:'Hot removal/restoration in the same instrumented GUI process. No restart, relink, cache clearing or NAS; ordinary uninstrumented-build coverage remains separate.'};
});
await check('D-RAW-NOTES-PERSIST',()=>rawNotesHistory(h,{verify}));finish();
