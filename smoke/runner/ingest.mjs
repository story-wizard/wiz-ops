import {mkdir,appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT,inside,writeJSON} from './files.mjs';
import {assert,OutcomeError,command} from './engine.mjs';

export const ingestPython=app=>path.join(app,'Contents/Resources/python',process.arch==='arm64'?'arm64':'x86_64','bin/python3');
export function validateIngestProfile(app){
  const directory=path.join(ROOT,'runner');
  const script="import sys; from wiz_ingest.settings import load_settings; s=load_settings(sys.argv[1]); flags=['asr_enabled','embeddings_enabled','llm_enrich_enabled','visual_enrichment_enabled','project_context_enabled','speaker_face_enabled','audio_analysis_enabled','camera_motion_enabled','multicam_enabled','model_prefetch_enabled']; assert all(getattr(s,k) is False for k in flags), 'Local ingest must disable model analysis and downloads'; assert s.diarization_backend=='none' and s.wizserver_backend=='http', 'Local ingest must use the owned HTTP engine'; print('Local ingest profile valid')";
  execFileSync(ingestPython(app),['-c',script,path.join(directory,'ingest-local.toml')],{cwd:directory,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,WIZARD_SETTINGS:directory,XDG_CONFIG_HOME:directory,PYTHONDONTWRITEBYTECODE:'1'},timeout:20000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
}
export function parseIngest(receipt,bundle,assetIds){
  if(receipt.timedOut||receipt.overflow||receipt.aborted)throw new OutcomeError('Ingest outcome is unknown; no retry was made.','Unknown');
  const begin='===WIZ_INGEST_SNAPSHOT_BEGIN_v1===',end='===WIZ_INGEST_SNAPSHOT_END_v1===';
  let snapshot;
  try{
    const chunks=receipt.stdout.split(begin);if(chunks.length!==2||chunks[1].split(end).length!==2)throw new Error('missing or duplicate snapshot');
    snapshot=JSON.parse(chunks[1].split(end)[0]);
  }catch{throw new OutcomeError(`Ingest returned no valid final snapshot (exit ${receipt.code}). ${(receipt.stderr||'').trim().slice(-500)}`,'Unknown');}
  assert(receipt.code===0&&snapshot.status==='succeeded'&&!snapshot.error,`Ingest ${snapshot.status||'invalid'}: ${snapshot.error||'process exit '+receipt.code}`);
  assert(snapshot.wiz_path===bundle&&typeof snapshot.job_id==='string','Ingest returned a snapshot for the wrong project.');
  assert(Array.isArray(snapshot.summary?.operations_failed)&&snapshot.summary.operations_failed.length===0,'Ingest reported failed operations.');
  const ran=snapshot.summary?.operations_run;
  assert(Array.isArray(ran),'Ingest operation evidence is absent.');
  for(const id of assetIds)assert(ran.some(o=>o.operation==='add_clip'&&o.asset_id===id&&o.status==='ok'),`Ingest did not complete source preparation for ${id}.`);
  assert(ran.some(o=>o.operation==='finalize_project'&&o.status==='ok'),'Ingest did not finalize the project.');
  return snapshot;
}
export function verifyIngestSidecar(sidecar,assetId){
  assert(sidecar.id===assetId,'Ingest sidecar asset identity mismatch.');
  const hash=sidecar.technical?.file_hash;
  assert(typeof hash==='string'&&hash.length>0&&sidecar.coverage?.ingest_complete?.source_hash===hash,`Asset ${assetId} has no current completed ingest record.`);
}
export function speechProfile(local,modelDirectory){
  assert(typeof modelDirectory==='string'&&path.isAbsolute(modelDirectory),'A pinned local speech model is required.');
  return local.replace('[asr]\nenabled = false','[asr]\nenabled = true\nbackend = "coreml_asr"\ncompute_units = "CPU_AND_GPU"').replace('[embeddings]\nenabled = false','[embeddings]\nenabled = false\nmodel_cache_dir = '+JSON.stringify(modelDirectory));
}
export async function ingestAssets(engine,bundle,clips,{speech=false}={}){
  assert(inside(engine.root,bundle)&&bundle.endsWith('.wiz'),'Ingest bundle is outside the run directory.');
  for(const c of clips)assert(/^[A-Za-z0-9_-]+$/.test(c.asset_id)&&inside(engine.root,c.media_path),'Ingest source or identity is outside the fixture scope.');
  const configRoot=path.join(engine.root,'ingest-config'),settings=path.join(configRoot,'wizard');
  await mkdir(settings,{recursive:true,mode:0o700});
  const local=await readFile(path.join(ROOT,'runner/ingest-local.toml'),'utf8');
  const profile=speech?speechProfile(local,engine.plan.speechModel?.directory):local;
  const config=path.join(settings,'wiz-ingest.toml');await writeFile(config,profile);
  const verify="import sys; from wiz_ingest.settings import load_settings; s=load_settings(sys.argv[1]); assert s.asr_enabled==(sys.argv[2]=='true'); assert all(getattr(s,k) is False for k in ['embeddings_enabled','llm_enrich_enabled','visual_enrichment_enabled','project_context_enabled','speaker_face_enabled','audio_analysis_enabled','camera_motion_enabled','multicam_enabled','model_prefetch_enabled']); assert s.diarization_backend=='none' and s.wizserver_backend=='http'; assert sys.argv[2]=='false' or (s.asr_backend=='coreml_asr' and s.model_cache_dir==sys.argv[3])";
  execFileSync(ingestPython(engine.plan.app),['-c',verify,config,String(speech),speech?engine.plan.speechModel.directory:''],{cwd:engine.root,env:{...engine.env,WIZARD_SETTINGS:settings,XDG_CONFIG_HOME:configRoot,PYTHONDONTWRITEBYTECODE:'1'},timeout:20000,maxBuffer:1024*1024});
  const python=ingestPython(engine.plan.app);
  const env={...engine.env,PATH:path.dirname(python)+':'+engine.env.PATH,WIZSERVER_ADDR:engine.url,WIZARD_SETTINGS:settings,XDG_CONFIG_HOME:configRoot,PYTHONDONTWRITEBYTECODE:'1'};
  assert(engine.child?.exitCode===null&&!engine.child.signalCode,'Owned engine stopped before ingest.');
  const request={wiz_path:bundle,clips,operations:['all'],force_rerun:false};
  engine.ingestController=new AbortController();
  let receipt;
  try{receipt=await command(python,['-m','wiz_ingest','submit','--request-json',JSON.stringify(request)],{env,cwd:engine.root,timeout:Math.max(1,Math.min(speech?150000:60000,(engine.deadline||Infinity)-Date.now())),signal:engine.ingestController.signal,processGroup:true});}
  finally{engine.ingestController=null;}
  await appendFile(path.join(engine.root,'operations.jsonl'),JSON.stringify({sequence:++engine.counter,caseId:engine.caseId,operation:'wiz-ingest.submit',profile:speech?'offline-speech':'local-source-preparation',params:request,...receipt})+'\n');
  const snapshot=parseIngest(receipt,bundle,clips.map(c=>c.asset_id));
  await writeJSON(path.join(path.dirname(bundle),'ingest.json'),snapshot);
  for(const c of clips)verifyIngestSidecar(JSON.parse(await readFile(path.join(bundle,'assets/clips',c.asset_id+'.json'),'utf8')),c.asset_id);
  // Ingest publishes through the shared project store; refresh the registry and its revision before editorial mutations.
  await engine.call(bundle,'project.close');await engine.call(bundle,'project.open');
  return snapshot;
}
