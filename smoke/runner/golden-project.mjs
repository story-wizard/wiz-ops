import {lstat, readdir, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {digest, sha} from './files.mjs';

function assetMetadata(t={}) {
  const probed=Number.isFinite(t.probe_duration)&&t.probe_duration>=0;
  const estimated=Number.isInteger(t.duration_frames)&&t.duration_frames>=0&&Number.isFinite(t.frame_rate)&&t.frame_rate>0;
  return {kind:t.media_kind||null,container:t.container_format||null,codec:t.codec||null,
    durationSeconds:probed?t.probe_duration:estimated?t.duration_frames/t.frame_rate:null,
    durationBasis:probed?'saved-probe-duration':estimated?'estimate-from-saved-frame-count-and-decimal-rate':'Unknown',
    recordedFrameRate:Number.isFinite(t.frame_rate)&&t.frame_rate>0?t.frame_rate:null,
    frameRate:t.frame_rate_num>0&&t.frame_rate_den>0?{numerator:t.frame_rate_num,denominator:t.frame_rate_den}:null,
    resolution:t.resolution||null,hasVideo:typeof t.video_detected==='boolean'?t.video_detected:null,
    hasAudio:typeof t.audio_detected==='boolean'?t.audio_detected:null,audioChannels:Number.isInteger(t.audio_channels)?t.audio_channels:null,
    colorSpace:t.color_space||null,alphaMode:t.alpha_mode||null};
}

function timelineStructure(timeline) {
  const counts={clips:0,tracks:0,gaps:0},stack=[timeline.tracks||timeline];
  while(stack.length){const node=stack.pop();if(!node||typeof node!=='object')continue;const schema=String(node.OTIO_SCHEMA||'').split('.')[0];if(schema==='Clip')counts.clips++;if(schema==='Track')counts.tracks++;if(schema==='Gap')counts.gaps++;if(Array.isArray(node.children))for(const child of node.children)stack.push(child);}
  return counts;
}

// Intake reads saved metadata only. It never opens Wizard, follows media links,
// rebuilds caches, copies a live project or treats stored metadata as a verdict.
export async function inspectGoldenProject(directory) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||!directory.endsWith('.wiz'))throw Error('Supply an absolute .wiz project directory.');
  directory=path.resolve(directory);
  const root=await lstat(directory);
  if(!root.isDirectory()||root.isSymbolicLink())throw Error('The .wiz input must be a regular project directory, not an archive or symlink.');
  directory=await realpath(directory);
  const files=[];let bytes=0;
  async function json(relative) {
    const file=path.join(directory,relative),s=await lstat(file);
    if(!s.isFile()||s.isSymbolicLink()||s.size>16*1024*1024)throw Error('Unsupported or oversized project metadata: '+relative);
    bytes+=s.size;if(bytes>64*1024*1024||files.length>=20000)throw Error('Project intake budget exceeded; use a reviewed larger-project reader.');
    const raw=await readFile(file,'utf8'),value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a metadata object: '+relative);
    files.push({file:relative,bytes:s.size,sha256:digest(raw)});return value;
  }
  async function names(relative) {
    const folder=path.join(directory,relative);
    let s;try{s=await lstat(folder);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    if(!s.isDirectory()||s.isSymbolicLink())throw Error('Unsupported metadata directory: '+relative);
    return (await readdir(folder)).sort();
  }
  const project=await json('project.json');
  if(typeof project.wiz_format_version!=='string'||typeof project.name!=='string')throw Error('Unrecognized saved project metadata.');
  // Check the parent as well as the clips directory; do not traverse links.
  await names('assets');
  const assets=[],seen=new Set();
  for(const file of await names('assets/clips')) {
    if(!file.endsWith('.json'))continue;
    const a=await json(path.join('assets/clips',file));
    if(typeof a.id!=='string'||!a.id||seen.has(a.id))throw Error('Missing or duplicate asset identity: '+file);
    seen.add(a.id);const t=a.technical||{};
    assets.push({id:a.id,name:typeof a.asset==='string'?a.asset:null,reference:typeof a.path==='string'?a.path:null,mediaRootId:a.media_root_id||null,
      metadata:assetMetadata(t),metadataRecordPresent:true,
      provenance:{basis:'saved-project-metadata',record:files.at(-1).file,recordSha256:files.at(-1).sha256,sourceIdentity:t.file_hash||null},
      mediaAvailability:'Unchecked',mediaSha256:null});
  }
  let assetIndex;try{assetIndex=await json('assets/index.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  const registered=new Set(),byId=new Map(assets.map(a=>[a.id,a]));
  if(assetIndex){
    if(!Array.isArray(assetIndex.assets))throw Error('Unrecognized asset registry.');
    const registryRecord=files.at(-1);
    for(const entry of assetIndex.assets){
      if(typeof entry.asset_id!=='string'||!entry.asset_id||registered.has(entry.asset_id))throw Error('Missing or duplicate registry asset identity.');registered.add(entry.asset_id);
      const registry={assetUrl:typeof entry.asset_url==='string'?entry.asset_url:null,localPath:typeof entry.local_path==='string'?entry.local_path:null,mediaRootId:entry.media_root_id||null,declaredBytes:Number.isSafeInteger(entry.bytes)&&entry.bytes>=0?entry.bytes:null,declaredSha256:typeof entry.sha256==='string'?entry.sha256:null};
      const existing=byId.get(entry.asset_id);
      if(existing){existing.registry=registry;continue;}
      assets.push({id:entry.asset_id,name:registry.assetUrl,reference:registry.localPath||registry.assetUrl,mediaRootId:registry.mediaRootId,registry,metadata:assetMetadata(),metadataRecordPresent:false,
        provenance:{basis:'saved-asset-registry-only',record:registryRecord.file,recordSha256:registryRecord.sha256,sourceIdentity:null},mediaAvailability:'Unchecked',mediaSha256:null});
    }
  }
  const timelines=[],timelineDirectories=await names('timelines');
  for(const id of timelineDirectories) {
    if(id==='index.json'){await json('timelines/index.json');continue;}
    if(id==='.DS_Store')continue;
    const folder=path.join('timelines',id);await names(folder);
    let timeline;try{timeline=await json(path.join(folder,'timeline.otio'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    timelines.push({id,name:typeof timeline.name==='string'?timeline.name:null,kind:timeline.metadata?.wiz?.kind||null,structure:timelineStructure(timeline),record:files.at(-1).file,recordSha256:files.at(-1).sha256});
  }
  // Stable metadata set, not a coherent save/checkpoint guarantee for a live app.
  const currentAssetFiles=(await names('assets/clips')).filter(f=>f.endsWith('.json')).map(f=>path.join('assets/clips',f));
  if(digest(currentAssetFiles)!==digest(files.filter(f=>f.file.startsWith('assets/clips'+path.sep)).map(f=>f.file)))throw Error('Project changed during intake; retry only after its owner saves and closes it.');
  if(digest(await names('timelines'))!==digest(timelineDirectories))throw Error('Project timelines changed during intake.');
  for(const id of timelineDirectories)if(!['index.json','.DS_Store'].includes(id))await names(path.join('timelines',id));
  for(const file of files){const p=path.join(directory,file.file),s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size!==file.bytes||await sha(p)!==file.sha256)throw Error('Project changed during intake: '+file.file);}
  const content={format:'athanor-golden-project-intake/v1',state:'Inventoried',source:{path:directory,name:project.name,wizFormatVersion:project.wiz_format_version,entryTimelineId:project.entry_timeline_id||null},
    mediaRoots:Array.isArray(project.media_roots)?project.media_roots.map(r=>({id:r.id||null,path:r.path||null})):[],
    registryMediaRoots:Array.isArray(assetIndex?.media_roots)?assetIndex.media_roots.map(r=>({id:r.id||null,path:r.path||null})):[],
    registryPresent:!!assetIndex,registeredAssetCount:assetIndex?registered.size:null,
    metadataGaps:assets.filter(a=>!a.metadataRecordPresent).map(a=>({assetId:a.id,reason:'Registered asset has no technical sidecar; media availability and properties require verification.'})),
    assets,timelines,files,
    identityScope:'project.json, asset registry and clip records, timeline index and timeline OTIO files only',
    qualification:{state:'Needs review',projectOpened:false,mediaVerified:false,checkpointCaptured:false,executionEnabled:false},
    nextSteps:['Review saved inventory and media root mappings.','Capture a settled project through an application-owned checkpoint or a reviewed closed-project recipe.','Verify referenced media bytes and probe streams on explicitly approved local roots.','Bind semantic roles and independent expected results; qualify adapted checks on disposable copies.']};
  return {...content,sha256:digest(content)};
}

export function goldenRoleCandidates(inventory,requirements) {
  const {sha256,...content}=inventory||{};
  if(content.format!=='athanor-golden-project-intake/v1'||sha256!==digest(content))throw Error('Golden Project inventory changed or unsupported.');
  if(!Array.isArray(requirements)||!requirements.length||requirements.length>100)throw Error('Supply 1–100 role requirements.');
  const seen=new Set();
  return {format:'athanor-golden-role-candidates/v1',inventorySha256:sha256,source:content.source,executionEnabled:false,roles:requirements.map(r=>{
    if(!r||Object.keys(r).some(k=>!['role','kind','minDurationSeconds','maxDurationSeconds','hasAudio','codec'].includes(k))||typeof r.role!=='string'||!r.role||seen.has(r.role))throw Error('Invalid or duplicate role requirement.');
    seen.add(r.role);
    if(r.kind!==undefined&&(typeof r.kind!=='string'||!r.kind)||r.codec!==undefined&&(typeof r.codec!=='string'||!r.codec)||r.hasAudio!==undefined&&typeof r.hasAudio!=='boolean')throw Error('Invalid media role predicate.');
    for(const k of ['minDurationSeconds','maxDurationSeconds'])if(r[k]!==undefined&&(!Number.isFinite(r[k])||r[k]<0))throw Error('Invalid duration requirement.');
    if(r.minDurationSeconds!==undefined&&r.maxDurationSeconds!==undefined&&r.minDurationSeconds>r.maxDurationSeconds)throw Error('Invalid duration range.');
    const candidates=content.assets.filter(a=>{const m=a.metadata;return (r.kind===undefined||m.kind===r.kind)&&(r.codec===undefined||m.codec===r.codec)&&(r.hasAudio===undefined||m.hasAudio===r.hasAudio)&&(r.minDurationSeconds===undefined||m.durationSeconds!==null&&m.durationSeconds>=r.minDurationSeconds)&&(r.maxDurationSeconds===undefined||m.durationSeconds!==null&&m.durationSeconds<=r.maxDurationSeconds);}).map(a=>({assetId:a.id,name:a.name,metadata:a.metadata,mediaAvailability:a.mediaAvailability}));
    return {requirement:r,state:candidates.length?'Candidates need qualification':'No matching recorded asset',candidates};
  })};
}
