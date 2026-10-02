import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assert,clips,OutcomeError} from '../runner/engine.mjs';

export function generatedPlacement(result){
  const d=result?.destination,p=d?.parent;
  const direct=d?.schema_version===2&&d.placement_kind==='direct_generation';
  const compound=d?.nested?.kind==='compound'&&typeof d.nested.timeline_id==='string';
  if(d?.state!=='committed'||d.kind!=='timeline'||!p?.clip_id||!p.timeline_id||!p.track_id||!direct&&!compound)
    throw new OutcomeError('Unsupported or incomplete committed MGFX placement: '+JSON.stringify(d),'Blocked');
  return {kind:direct?'direct_generation':'compound',...p,...(compound?{nestedTimelineId:d.nested.timeline_id}:{})};
}

export async function createLocalGraphic(call,session,{groupLabel,label='Synthetic smoke title'}={}){
  const id=randomUUID(),d=await call('generate.renderers',{detail:'full'}),p=d.profile;
  const t=await call('timeline.create',{name:`Local MGFX ${id}`,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),source=`.wiz/generate/staging/smoke-${id}`;
  const adapter=d.renderers.find(r=>r.id==='web').adapters.find(a=>a.id==='hyperframes');assert(adapter.contract.execution.network==='disabled','MGFX fixture must be local');
  const scaffold=adapter.contract.entry.scaffold.find(f=>f.path==='src/index.html').content.replace('<body>','<body style="margin:0;background:#ff0000">');await mkdir(path.join(session.bundle,source,'src'),{recursive:true});await writeFile(path.join(session.bundle,source,'src/index.html'),scaffold);
  const g=await call('generate.graphics',{renderer:{id:'web',adapter:'hyperframes'},content:{source_path:source,entry:'src/index.html'},parameters:{profile_id:p.profile_id,profile_version:p.profile_version,profile_hash:p.profile_hash,descriptors:[{param_path:'title.text',param_type:'string',default_value:label,display_label:'Title',...(groupLabel===undefined?{}:{group_label:groupLabel})}],initial_values:{}},label,render:{duration_frames:48,width:1920,height:1080,fps:{num:24,den:1}},destination:{kind:'timeline',timeline_id:t.timeline_id,track:{id:t.tracks.find(x=>x.kind==='video').track_id},at:{offset_seconds:0},fit:{mode:'fit_to_timeline'},overlap:'reject'}});
  const placement=generatedPlacement(g);
  assert(placement.timeline_id===t.timeline_id,'MGFX fixture published to another timeline');
  const placed=clips(await call('timeline.inspect',{timeline_id:t.timeline_id})).find(c=>c.clip_id===placement.clip_id);
  assert(placed&&placed.track_id===placement.track_id,'MGFX placement was not present in independent timeline readback');
  return {...g,placement,timeline:t.timeline_id,source};
}
