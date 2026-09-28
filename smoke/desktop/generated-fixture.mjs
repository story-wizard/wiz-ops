import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assert} from '../runner/engine.mjs';

export async function createLocalGraphic(call,session,{groupLabel,label='Synthetic smoke title'}={}){
  const id=randomUUID(),d=await call('generate.renderers',{detail:'full'}),p=d.profile;
  const t=await call('timeline.create',{name:`Local MGFX ${id}`,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),source=`.wiz/generate/staging/smoke-${id}`;
  const adapter=d.renderers.find(r=>r.id==='web').adapters.find(a=>a.id==='hyperframes');assert(adapter.contract.execution.network==='disabled','MGFX fixture must be local');
  const scaffold=adapter.contract.entry.scaffold.find(f=>f.path==='src/index.html').content.replace('<body>','<body style="margin:0;background:#ff0000">');await mkdir(path.join(session.bundle,source,'src'),{recursive:true});await writeFile(path.join(session.bundle,source,'src/index.html'),scaffold);
  const g=await call('generate.graphics',{renderer:{id:'web',adapter:'hyperframes'},content:{source_path:source,entry:'src/index.html'},parameters:{profile_id:p.profile_id,profile_version:p.profile_version,profile_hash:p.profile_hash,descriptors:[{param_path:'title.text',param_type:'string',default_value:label,display_label:'Title',...(groupLabel===undefined?{}:{group_label:groupLabel})}],initial_values:{}},label,render:{duration_frames:48,width:1920,height:1080,fps:{num:24,den:1}},destination:{kind:'timeline',timeline_id:t.timeline_id,track:{id:t.tracks.find(x=>x.kind==='video').track_id},at:{offset_seconds:0},fit:{mode:'fit_to_timeline'},overlap:'reject'}});
  assert(g.destination.state==='committed'&&g.destination.nested.kind==='compound','MGFX fixture did not publish a compound placement');return {...g,timeline:t.timeline_id,source};
}
