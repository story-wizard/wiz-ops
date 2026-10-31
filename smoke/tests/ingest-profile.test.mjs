import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('ingest profile accepts declared prefetch retirement while preserving local-only safety gates',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-ingest-profile-'));
 try{
  await mkdir(path.join(root,'wiz_ingest'));await writeFile(path.join(root,'wiz_ingest/__init__.py'),'');
  const safe={asr_enabled:false,embeddings_enabled:false,llm_enrich_enabled:false,visual_enrichment_enabled:false,project_context_enabled:false,speaker_face_enabled:false,audio_analysis_enabled:false,camera_motion_enabled:false,multicam_enabled:false,model_prefetch_enabled:false,cloud_media_egress:false,diarization_backend:'none',wizserver_backend:'http',asr_backend:'coreml_asr',model_cache_dir:'/pinned/model'};
  await writeFile(path.join(root,'wiz_ingest/settings.py'),"import json\nfrom types import SimpleNamespace\ndef load_settings(file):\n    with open(file) as f: return SimpleNamespace(**json.load(f))\nRETIRED_SETTINGS_FIELDS = {'model_prefetch_enabled'}\n");
  const run=async(settings,speech=false)=>{const file=path.join(root,'profile.json');await writeFile(file,JSON.stringify(settings));return spawnSync('/usr/bin/python3',[fileURLToPath(new URL('../runner/ingest-profile.py',import.meta.url)),file,String(speech),'/pinned/model'],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,PYTHONDONTWRITEBYTECODE:'1'}});};
  assert.equal((await run(safe)).status,0);const retired={...safe};delete retired.model_prefetch_enabled;assert.equal((await run(retired)).status,0);
  for(const changed of [{model_prefetch_enabled:true},{embeddings_enabled:true},{cloud_media_egress:true},{wizserver_backend:'cli'},{asr_enabled:true}])assert.notEqual((await run({...safe,...changed})).status,0);
  const missing={...retired};delete missing.embeddings_enabled;assert.notEqual((await run(missing)).status,0);
  assert.equal((await run({...retired,asr_enabled:true},true)).status,0);assert.notEqual((await run({...retired,asr_enabled:true,asr_backend:'assemblyai'},true)).status,0);
  await writeFile(path.join(root,'wiz_ingest/settings.py'),"from types import SimpleNamespace\nimport json\ndef load_settings(file):\n    with open(file) as f: return SimpleNamespace(**json.load(f))\n");assert.notEqual((await run(retired)).status,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
