import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assert,clips,pause,OutcomeError} from '../runner/engine.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {pixelDifference,pixelStats} from '../runner/pixels.mjs';

export function proveGraphicMotion(frames){
  assert(frames.length===3,'MGFX motion needs early, middle and late decoded frames');
  const samples=frames.map(({frame,image})=>{
    assert(image.width===1920&&image.height===1080,'Wrong MGFX motion raster');
    let x=0,y=0,count=0;const p=image.pixels;
    for(let i=0;i<p.length;i+=3)if(p[i]>150&&p[i+1]>100&&p[i+2]<p[i]*0.5){const pixel=i/3;x+=pixel%image.width;y+=Math.floor(pixel/image.width);count++;}
    assert(count>25000&&Math.abs(x/count-(190+frame*20))<=4&&Math.abs(y/count-250)<=4,'Rendered MGFX marker is missing or at the wrong frame position');
    return {frame,centroid:{x:x/count,y:y/count},markerPixels:count,...pixelStats(image)};
  });
  assert(frames.map(f=>f.frame).join(',')==='0,24,47','MGFX motion frames must cover the whole authored range');
  const differences=[pixelDifference(frames[0].image,frames[1].image),pixelDifference(frames[1].image,frames[2].image)];
  assert(differences.every(d=>d>0.01),'MGFX motion frames are static');return {samples,differences};
}

export function generatedPlacement(result){
  const d=result?.destination,p=d?.parent;
  const direct=d?.schema_version===2&&d.placement_kind==='direct_generation';
  const compound=d?.nested?.kind==='compound'&&typeof d.nested.timeline_id==='string';
  if(d?.state!=='committed'||d.kind!=='timeline'||!p?.clip_id||!p.timeline_id||!p.track_id||!direct&&!compound)
    throw new OutcomeError('Unsupported or incomplete committed MGFX placement: '+JSON.stringify(d),'Blocked');
  return {kind:direct?'direct_generation':'compound',...p,...(compound?{nestedTimelineId:d.nested.timeline_id}:{})};
}

export async function localGraphicContract(session){
  const file=path.join(session.app||session.sourceApp,'Contents/Resources/renderers/web/WebRender.app/Contents/Resources/adapters/remotion-4-0-532/authoring-contract.json');
  let facts;try{facts=await readJSON(file);}catch(error){if(error.code==='ENOENT')throw new OutcomeError('Selected build does not include the remotion-4-0-532 MGFX authoring contract.','Blocked');throw error;}
  if(facts.schema_version!==1||facts.adapter?.id!=='remotion-4-0-532'||facts.renderer?.id!=='web'||facts.entry?.entry_file!=='src/index.tsx'||facts.entry?.export_name!=='default'||facts.profile?.profile_id!=='wiz.mgfx.authorable/v1'||facts.profile?.profile_version!==1||facts.execution?.network!=='disabled'||facts.build?.network!=='disabled'||!facts.parameter_access?.accepted_static_forms?.includes('props.params["<param_path>"]')||!['string','int'].every(type=>facts.parameter_support?.some(p=>p.param_type===type)))throw new OutcomeError('Selected MGFX authoring contract needs review before this fixture can run.','Blocked');
  const manual=path.join(path.dirname(file),'AUTHORING.md');await readFile(manual,'utf8');
  return {facts,file,sha256:await sha(file),manualSha256:await sha(manual)};
}

export async function waitForGraphic(call,admission,{timeoutMs=60000}={}){
  assert(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'MGFX completion wait must be bounded');
  const job=admission.artifact?.job?.job_id,generation=admission.generation;
  assert(job&&generation?.generation_id&&generation.content_id&&generation.owner_revision!==undefined&&generation.params_rev!==undefined,'MGFX admission lacks job or generation identity');
  const deadline=Date.now()+timeoutMs;let status;
  do{
    status=await call('generate.status',{job_id:job});
    assert(status.job_id===job&&status.generation_id===generation.generation_id&&String(status.target_owner_revision)===String(generation.owner_revision)&&status.target_params_revision===generation.params_rev,'MGFX completion refers to another job, generation or revision');
    if(status.state==='succeeded')return status;
    if(['failed','cancelled'].includes(status.state))throw new OutcomeError('MGFX job '+status.state+': '+JSON.stringify(status.error));
    assert(['queued','running','retrying'].includes(status.state),'Unknown MGFX job state: '+status.state);
    await pause(Math.min(100,Math.max(0,deadline-Date.now())));
  }while(Date.now()<deadline);
  const error=new OutcomeError('MGFX job did not complete within '+timeoutMs+'ms');error.diagnostics={job,lastStatus:status};throw error;
}

export async function createLocalGraphic(call,session,{groupLabel,label='Synthetic smoke title',animated=false}={}){
  const id=randomUUID(),contract=await localGraphicContract(session),p=contract.facts.profile;
  const t=await call('timeline.create',{name:`Local MGFX ${id}`,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),source=`.wiz/generate/staging/smoke-${id}`;
  await mkdir(path.join(session.bundle,'.wiz/generate/staging'),{recursive:true});await mkdir(path.join(session.bundle,source));await mkdir(path.join(session.bundle,source,'src'));
  await writeFile(path.join(session.bundle,source,'src/index.tsx'),`import React from 'react';\nimport {AbsoluteFill,useCurrentFrame} from 'remotion';\nexport default function GeneratedGraphic(props){\n const frame=useCurrentFrame(),title=props.params["title.text"],travel=props.params["motion.travel"];\n return <AbsoluteFill style={{backgroundColor:'#401010',color:'#ffffff',fontFamily:'sans-serif',fontSize:80,justifyContent:'center',alignItems:'center'}}><div>{title}</div><div style={{position:'absolute',top:160,left:100+frame*travel,width:180,height:180,backgroundColor:'#ffcc33'}}/></AbsoluteFill>;\n}\n`);
  const g=await call('generate.graphics',{renderer:{id:'web',adapter:contract.facts.adapter.id},content:{source_path:source,entry:'src/index.tsx'},parameters:{profile_id:p.profile_id,profile_version:p.profile_version,descriptors:[{param_path:'title.text',param_type:'string',default_value:label,display_label:'Title',control:'text',...(groupLabel===undefined?{}:{group_label:groupLabel})},{param_path:'motion.travel',param_type:'int',default_value:animated?20:0,display_label:'Pixels per frame',control:'number',range:{min:0,max:20,step:1}}],initial_values:{}},label,render:{duration_frames:48,width:1920,height:1080,fps:{num:24,den:1}},placement_mode:'direct_generation',destination:{kind:'timeline',timeline_id:t.timeline_id,track:{id:t.tracks.find(x=>x.kind==='video').track_id},at:{offset_seconds:0},fit:{mode:'fit_to_timeline'},overlap:'reject'}});
  const completion=await waitForGraphic(call,g);
  const placement=generatedPlacement(g);
  assert(placement.kind==='direct_generation','Native MGFX did not honor direct generation placement');
  assert(placement.timeline_id===t.timeline_id,'MGFX fixture published to another timeline');
  const placed=clips(await call('timeline.inspect',{timeline_id:t.timeline_id})).find(c=>c.clip_id===placement.clip_id);
  assert(placed&&placed.track_id===placement.track_id,'MGFX placement was not present in independent timeline readback');
  const inspected=await call('generate.inspect',{target:{kind:'generated_placement',timeline_id:placement.timeline_id,clip_id:placement.clip_id}});
  assert(inspected.generation_id===g.generation.generation_id&&inspected.content_id===g.generation.content_id,'Placed MGFX generation/content identity differs from admission');
  assert(String(inspected.owner_revision)===String(g.generation.owner_revision)&&inspected.params_rev===g.generation.params_rev,'Placed MGFX revision differs from the completed job');
  for(const [key,value] of [['title.text',label],['motion.travel',animated?20:0]])assert(inspected.parameters?.find(p=>p.descriptor.param_path===key)?.value===value,'MGFX fixture parameter differs from the authored default: '+key);
  const evidence={contract:contract.file,contractHash:contract.sha256,manualHash:contract.manualSha256,sourceHash:await sha(path.join(session.bundle,source,'src/index.tsx')),completion,placement,generationId:inspected.generation_id,contentId:inspected.content_id};
  if(session.root)await writeJSON(path.join(session.root,'mgfx-fixture-'+id+'.json'),evidence);
  return {...g,placement,timeline:t.timeline_id,source,evidence};
}
