import {mkdir,appendFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,inside,writeJSON} from './files.mjs';
import {assert,OutcomeError,command,retainProcess} from './engine.mjs';

export const ingestPython=app=>path.join(app,'Contents/Resources/python',process.arch==='arm64'?'arm64':'x86_64','bin/python3');
export function validateIngestProfile(app,{profile=path.join(ROOT,'runner/ingest-local.toml'),speech=false,modelDirectory=''}={}){
  const directory=path.dirname(profile);
  execFileSync(ingestPython(app),[fileURLToPath(new URL('./ingest-profile.py',import.meta.url)),profile,String(speech),modelDirectory],{cwd:directory,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,WIZARD_SETTINGS:directory,XDG_CONFIG_HOME:directory,PYTHONDONTWRITEBYTECODE:'1'},timeout:20000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
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
export function verifyIngestSidecar(sidecar,assetId,{bundle,jobId}={}){
  assert(sidecar.id===assetId,'Ingest sidecar asset identity mismatch.');
  const hash=sidecar.technical?.file_hash,marker=sidecar.coverage?.ingest_complete;
  const message=`Asset ${assetId} has no current completed ingest record.`;
  assert(typeof hash==='string'&&hash.length>0,message);
  if(marker!==undefined){assert(marker?.source_hash===hash,message);return;}
  // Current SDKs retain completion in the project job ledger, not clip coverage.
  // Read the exact observed job; never infer completion from metadata or exit zero.
  assert(typeof bundle==='string'&&path.isAbsolute(bundle)&&typeof jobId==='string'&&jobId.length>0,message);
  const db=new DatabaseSync(path.join(bundle,'.wizindex.db'),{readOnly:true});
  try{
    const row=db.prepare('SELECT wiz_path,status,error,finished_at,request_json,summary_json FROM ingest_jobs WHERE job_id=?').get(jobId);
    assert(row?.wiz_path===bundle&&row.status==='succeeded'&&!row.error&&row.finished_at,message);
    const request=JSON.parse(row.request_json),summary=JSON.parse(row.summary_json);
    assert(request.wiz_path===bundle&&Array.isArray(summary.operations_failed)&&summary.operations_failed.length===0,message);
    const requested=request.clips?.filter(c=>c.asset_id===assetId)||[];
    const completed=summary.operations_run?.filter(o=>o.operation==='add_clip'&&o.asset_id===assetId)||[];
    assert(requested.length===1&&requested[0].media_path===sidecar.path&&completed.length===1,message);
    const op=completed[0];assert(op.status==='ok'&&!op.error&&op.media_path===sidecar.path&&op.source_hash===hash,message);
    assert(summary.operations_run.some(o=>o.operation==='finalize_project'&&o.status==='ok'&&!o.error),message);
  }finally{db.close();}
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
  validateIngestProfile(engine.plan.app,{profile:config,speech,modelDirectory:speech?engine.plan.speechModel.directory:''});
  const python=ingestPython(engine.plan.app);
  const env={...engine.env,PATH:path.dirname(python)+':'+engine.env.PATH,WIZSERVER_ADDR:engine.url,WIZARD_SETTINGS:settings,XDG_CONFIG_HOME:configRoot,PYTHONDONTWRITEBYTECODE:'1'};
  assert(engine.child?.exitCode===null&&!engine.child.signalCode,'Owned engine stopped before ingest.');
  const request={wiz_path:bundle,clips,operations:['all'],force_rerun:false};
  engine.ingestController=new AbortController();
  let receipt;
  try{receipt=await command(python,['-m','wiz_ingest','submit','--request-json',JSON.stringify(request)],{env,cwd:engine.root,timeout:Math.max(1,Math.min(speech?150000:60000,(engine.deadline||Infinity)-Date.now())),signal:engine.ingestController.signal,processGroup:true,onSpawn:pid=>retainProcess(engine.root,pid,true)});}
  finally{engine.ingestController=null;}
  await appendFile(path.join(engine.root,'operations.jsonl'),JSON.stringify({sequence:++engine.counter,caseId:engine.caseId,operation:'wiz-ingest.submit',profile:speech?'offline-speech':'local-source-preparation',params:request,...receipt})+'\n');
  const snapshot=parseIngest(receipt,bundle,clips.map(c=>c.asset_id));
  await writeJSON(path.join(path.dirname(bundle),'ingest.json'),snapshot);
  for(const c of clips)verifyIngestSidecar(JSON.parse(await readFile(path.join(bundle,'assets/clips',c.asset_id+'.json'),'utf8')),c.asset_id,{bundle,jobId:snapshot.job_id});
  // Ingest publishes through the shared project store; refresh the registry and its revision before editorial mutations.
  await engine.call(bundle,'project.close');await engine.call(bundle,'project.open');
  return snapshot;
}
