import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {assert,same,snapshotState,clips,clip,bounds,OutcomeError} from './engine.mjs';
import {ingestAssets} from './ingest.mjs';
import {writeJSON} from './files.mjs';

export class ProjectSession{
  constructor(engine,id,fixtures){this.engine=engine;this.id=id;this.fixtures=fixtures;this.bundle=path.join(engine.root,'projects',id,'Golden.wiz');this.mediaRoot=path.join(engine.root,'media');this.assets={};this.sequence=0;}
  call(op,params={},error){return this.engine.call(this.bundle,op,params,error);}
  async create(){await mkdir(path.dirname(this.bundle),{recursive:true});await this.call('project.create',{name:`Golden ${this.id}`});}
  async import(id,from){const file=this.fixtures.files.find(f=>f.id===id);assert(file,`Unknown fixture ${id}`);const result=await this.call('media.import_asset',{path:from||path.join(this.mediaRoot,file.file)});assert(typeof result.asset_id==='string'&&result.asset_id.length>0,'Import did not return a stable asset identity.');this.assets[id]=result.asset_id;return result.asset_id;}
  async timeline(name,fps=24){const t=await this.call('timeline.create',{name,video_format:{preset:`hd_1080p_${String(fps).replace('.','_')}`},audio:{sample_rate:48000,channels:2}});assert(typeof t.timeline_id==='string'&&t.tracks?.length===2,'New timeline is missing its identity or tracks.');return {id:t.timeline_id,video:t.tracks.find(t=>t.kind==='video').track_id,audio:t.tracks.find(t=>t.kind==='audio').track_id,fps:({'23.976':24000/1001,'29.97':30000/1001,'59.94':60000/1001})[fps]||fps};}
  async place(timeline,asset,start,sourceStart,sourceEnd,{streams='video_only',track=timeline.video}={}){
    const response=await this.call('timeline.place_cuts',{id:`place-${++this.sequence}`,timeline_id:timeline.id,cuts:[{id:'fixture',source:{asset_id:asset},source_range:{start_seconds:sourceStart,end_seconds:sourceEnd},streams,destination:{at:{seconds:start,track}}}]});
    const item=response.result?.items?.[0];assert(item&&item.placements.length>0&&item.omitted.length===0,'Fixture placement is incomplete.');return item.placements;
  }
  async inspect(timeline){const result=await this.call('timeline.inspect',{timeline_id:timeline.id,page:{max_items:500}});snapshotState(result);return result;}
  async move(source,ids,destination,seconds,extra={}){return this.call('timeline.move_clips',{id:`move-${++this.sequence}`,source:{timeline_id:source.id,selection:{clip_ids:ids,...(ids.length>1?{anchor_clip_id:ids[0]}:{})}},destination:{timeline_id:destination.id,at:{seconds,track:destination.video}},...extra});}
  async ingest(){return ingestAssets(this.engine,this.bundle,['plate','motion'].map(id=>({asset_id:this.assets[id],media_path:path.join(this.mediaRoot,this.fixtures.files.find(f=>f.id===id).file)})));}
  async setup(){
    await this.create();await this.call('media.add_media_root',{path:this.mediaRoot});await this.import('plate');await this.import('motion');
    try{await this.ingest();}catch(error){throw new OutcomeError(`Golden Project ingest prerequisite: ${error.message}`,error.status==='Unknown'?'Unknown':'Blocked');}
    this.main=await this.timeline('Main',24);this.alternate=await this.timeline('Secondary',25);
    this.a=(await this.place(this.main,this.assets.plate,0,1,5))[0].clip_id;
    this.b=(await this.place(this.main,this.assets.motion,6,0,2))[0].clip_id;
    this.c=(await this.place(this.alternate,this.assets.motion,0,2,4))[0].clip_id;
    const main=await this.inspect(this.main),alt=await this.inspect(this.alternate);
    same(main.timeline.frame_rate,{denominator:1,numerator:24},'Main frame rate');same(alt.timeline.frame_rate,{denominator:1,numerator:25},'Secondary frame rate');
    assert(clips(main).length===2&&clips(alt).length===1,'Unexpected GP baseline clip count.');
    bounds(clip(main,this.a),0,4,1,5);bounds(clip(main,this.b),6,8,0,2);bounds(clip(alt,this.c),0,2,2,4);
    assert(clip(main,this.a).source.asset_id===this.assets.plate&&clip(main,this.b).source.asset_id===this.assets.motion,'GP source identity mismatch.');
    await writeJSON(path.join(path.dirname(this.bundle),'baseline.json'),{main,secondary:alt,assets:this.assets});
  }
  async both(){return [snapshotState(await this.inspect(this.main)),snapshotState(await this.inspect(this.alternate))];}
}

export {PackagedEngine} from './engine.mjs';
export {ingestAssets} from './ingest.mjs';
export {still,frame,evidence,reference,insertEffect} from './render-helpers.mjs';

export async function search(c,text,{sources=['name'],scope={kind:'project'},...options}={}){
  const result=await c.call('search.query',{query:{kind:'text',text},sources,scope,...options});
  assert(result.completion==='complete'&&!result.truncated,'Search was incomplete or truncated.');
  for(const source of sources)assert(result.source_runs?.some(r=>r.source===source&&r.state==='ready'&&r.exhaustive&&!r.error),`Search source ${source} was not ready and exhaustive.`);
  return result;
}
export async function reopen(c){await c.call('project.checkpoint');await c.call('project.close');await c.call('project.open');}
export async function mixReport(c,timeline,label,{start_seconds=0,end_seconds=4}={}){
  const result=await c.call('audio.mix_report',{timeline_id:timeline.id,start_seconds,end_seconds,include_plugins:false,include_analysis_blocks:true,analysis_block_seconds:2});
  await writeJSON(path.join(path.dirname(c.bundle),label+'.json'),result);
  assert(result.status==='ok'&&result.stats?.complete&&result.stats.samples_rendered>0&&!result.stats.used_fallback_runtime,'Audio renderer did not complete using the real runtime.');
  assert(result.sample_rate===48000&&result.stats.samples_rendered===Math.round((end_seconds-start_seconds)*48000),'Audio render duration or sample rate is wrong.');
  return result;
}

export async function placeMany(c,timeline,count,{asset=c.assets.plate,spacing=2,sourceStart=1,duration=1,track=timeline.video}={}){
  assert(Number.isInteger(count)&&count>0&&count<=100,'Bulk placement is bounded to 100 clips per operation.');
  const result=await c.call('timeline.place_cuts',{id:`bulk-${++c.sequence}`,timeline_id:timeline.id,cuts:Array.from({length:count},(_,i)=>({id:`cut-${i}`,source:{asset_id:asset},source_range:{start_seconds:sourceStart,end_seconds:sourceStart+duration},streams:'video_only',destination:{at:{seconds:i*spacing,track}}}))});
  const placed=result.result?.items?.flatMap(i=>i.placements)||[];assert(placed.length===count&&new Set(placed.map(p=>p.clip_id)).size===count,'Bulk placement is incomplete or duplicated identities.');return placed;
}

export async function cloneEffect(c,type,params){
  // Copy semantic values through supported operations; UI clipboard routing is a separate check.
  return insertEffectForCopy(c,type,structuredClone(params));
}
import {insertEffect as insertEffectForCopy} from './render-helpers.mjs';
