import path from 'node:path';
import {realpath,lstat} from 'node:fs/promises';
import {checks} from './check-support.mjs';
import {retainChild} from './adapter.mjs';
import {createLocalGraphic,proveGraphicMotion} from './generated-fixture.mjs';
import {verifyTailTiming,verifyTailFrames} from './functional-cohort-proof.mjs';
import {readJSON,writeJSON,sha,inside} from '../runner/files.mjs';
import {assert,same,clips,snapshotState,command,OutcomeError} from '../runner/engine.mjs';
import {readPPM} from '../runner/pixels.mjs';
const file=process.argv[2],verify=process.argv[3]==='verify',id='S-MGFX-TAIL-TIMING',h=await checks(file,verify?'service-generated-tail-reopen-report.json':'service-generated-tail-report.json'),{s,c,check,finish}=h;
const expectedFile=path.join(s.root,'generated-tail-expected.json');let sequence=0,artifacts=[];
async function frames(timelineId,values,label){
 const result=[];
 for(const frame of values){
  const output=path.join(s.root,`mgfx-tail-${label}-${++sequence}-${frame}.ppm`),preview=output.replace(/\.ppm$/,'.png');
  await c('render.export_still',{timeline_id:timelineId,time:{value:frame,rate:24},output});
  const receipt=await command(path.join(s.app,'Contents/MacOS/ffmpeg'),['-v','error','-i',output,preview],{timeout:10000,processGroup:true,onSpawn:pid=>retainChild(s,pid)});await writeJSON(preview+'.conversion.json',receipt);assert(receipt.code===0&&!receipt.timedOut&&!receipt.overflow,'Tail preview conversion failed');
  artifacts.push(output,preview,preview+'.conversion.json');result.push({frame,image:await readPPM(output),path:output,preview,sha256:await sha(output),previewHash:await sha(preview)});
 }
 return result;
}
await check(id,async()=>{
 try{
  if(verify){
   let e;try{e=await readJSON(expectedFile);}catch(error){if(error.code==='ENOENT')throw new OutcomeError('Animated tail did not retain a reopen fixture','Blocked');throw error;}
   assert(e.pid!==s.pid,'Animated tail persistence requires a fresh process');
   const actual=await c('timeline.inspect',{timeline_id:e.timelineId});same(snapshotState(actual),e.timeline,'Reopened animated tail and copy');
   assert(Array.isArray(e.reference)&&e.reference.length===6,'Tail reference inventory changed');same(e.reference.map(r=>r.frame),[0,24,30,35,42,47],'Retained original frame IDs');
   const reference=[];for(const r of e.reference){for(const p of [r.path,r.preview])assert(typeof p==='string'&&inside(s.root,p)&&await realpath(p)===p&&(await lstat(p)).isFile()&&!(await lstat(p)).isSymbolicLink(),'Tail reference escaped its owned fixture');assert(await sha(r.path)===r.sha256&&await sha(r.preview)===r.previewHash,'Frozen tail reference changed');reference.push({...r,image:await readPPM(r.path)});artifacts.push(r.path,r.preview);}
   const tailProof=verifyTailFrames(reference,await frames(e.timelineId,[24,30,42,47],'reopened-tail'),[24,30,42,47]);
   const copied=(await frames(e.timelineId,[72,78,90,95],'reopened-copy')).map(f=>({...f,frame:f.frame-48})),copyProof=verifyTailFrames(reference,copied,[24,30,42,47]);
   for(const clipId of [e.head,e.tail,e.copy])assert((await c('generate.inspect',{target:{kind:'generated_placement',timeline_id:e.timelineId,clip_id:clipId}})).generation_id===e.generationId,'Reopened placement lost the source generation');
   return {freshPid:s.pid,tailProof,copyProof,artifacts,scope:'Retained animated split tail and same-generation application copy; keyboard MGFX clipboard remains separate.'};
  }
  const g=await createLocalGraphic(c,s,{animated:true,label:'Animated split-tail clock fixture'}),timelineId=g.timeline,head=g.placement.clip_id,before=await c('timeline.inspect',{timeline_id:timelineId}),reference=await frames(timelineId,[0,24,30,35,42,47],'reference');
  assert(clips(before).length===1,'Animated fixture must start with exactly one clip');const motion=proveGraphicMotion([0,24,47].map(value=>reference.find(r=>r.frame===value))),proof=[];
  await c('timeline.split_clips',{id:'animated-tail-split',timeline_id:timelineId,splits:[{id:'split',clips:[{clip_id:head}],points:{timeline_seconds:[1]}}],streams:'video_only'});
  const split=await c('timeline.inspect',{timeline_id:timelineId}),added=clips(split).filter(x=>x.clip_id!==head);assert(added.length===1,'Split did not produce one tail');const tail=added[0].clip_id;verifyTailTiming(split,{head,tail});
  async function phase(label,expected,end=2){
   const actual=await c('timeline.inspect',{timeline_id:timelineId});same(snapshotState(actual),snapshotState(expected),'Animated tail '+label);verifyTailTiming(actual,{head,tail,end});
   const wanted=end===1.5?[24,30,35]:[24,30,42,47],pixels=verifyTailFrames(reference,await frames(timelineId,wanted,label),wanted);proof.push({phase:label,end,pixels});await writeJSON(path.join(s.root,'generated-tail-phases.json'),proof);
  }
  await phase('split',split);
  await c('timeline.trim_extend_edges',{id:'animated-tail-trim',timeline_id:timelineId,edits:[{id:'tail',clip:{clip_id:tail},change:{adjust_edges:{out:{trim_seconds:.5}}}}],ripple:false,streams:'video_only'});
  const trimmed=await c('timeline.inspect',{timeline_id:timelineId});await phase('trimmed',trimmed,1.5);
  await c('timeline.trim_extend_edges',{id:'animated-tail-extend',timeline_id:timelineId,edits:[{id:'tail',clip:{clip_id:tail},change:{adjust_edges:{out:{extend_seconds:.5}}}}],ripple:false,streams:'video_only'});
  const extended=await c('timeline.inspect',{timeline_id:timelineId});await phase('extended',extended);
  for(const [label,snapshot,end] of [['undo-extension',trimmed,1.5],['undo-trim',split,2]]){assert((await c('undo.undo')).moved,'Undo '+label+' did not move');await phase(label,snapshot,end);}
  assert((await c('undo.undo')).moved,'Undo split did not move');same(snapshotState(await c('timeline.inspect',{timeline_id:timelineId})),snapshotState(before),'Undo split restores original graphic');
  verifyTailFrames(reference,await frames(timelineId,[24,30,42,47],'undo-split'),[24,30,42,47]);
  for(const [label,snapshot,end] of [['redo-split',split,2],['redo-trim',trimmed,1.5],['redo-extension',extended,2]]){assert((await c('undo.redo')).moved,'Redo '+label+' did not move');await phase(label,snapshot,end);}
  await c('timeline.move_clips',{id:'animated-tail-copy',source:{timeline_id:timelineId,selection:{clip_ids:[tail]}},destination:{timeline_id:timelineId,at:{seconds:3,track:g.placement.track_id}},copy:true});
  const copied=await c('timeline.inspect',{timeline_id:timelineId}),newClips=clips(copied).filter(x=>![head,tail].includes(x.clip_id));assert(newClips.length===1&&newClips[0].timeline_range.start_seconds===3&&newClips[0].timeline_range.end_seconds===4,'Tail copy has the wrong identity or range');
  verifyTailFrames(reference,(await frames(timelineId,[72,78,90,95],'copy')).map(f=>({...f,frame:f.frame-48})),[24,30,42,47]);
  await c('project.checkpoint');await writeJSON(expectedFile,{pid:s.pid,timelineId,head,tail,copy:newClips[0].clip_id,generationId:g.generation.generation_id,timeline:snapshotState(await c('timeline.inspect',{timeline_id:timelineId})),reference:reference.map(({image,...r})=>r)});artifacts.push(expectedFile,path.join(s.root,'generated-tail-phases.json'));
  return {generationId:g.generation.generation_id,fixture:g.evidence,motion,proof,copy:newClips[0].clip_id,artifacts,reopenPending:true,scope:'Original source-frame captures precede split; tail extension remains within its two-second source. Copy uses timeline.move_clips, not keyboard clipboard.'};
 }catch(e){e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...artifacts]};throw e;}
});finish();
