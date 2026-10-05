import path from 'node:path';
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {ingestPython,speechProfile,parseIngest,verifyIngestSidecar} from '../runner/ingest.mjs';
import {ROOT,inside,writeJSON,readJSON} from '../runner/files.mjs';
import {command,assert,retainProcess} from '../runner/engine.mjs';
import {verifyDesktopOwner} from './adapter.mjs';
// Use the selected package's offline worker against the verified GUI endpoint.
// Observe natural adoption in the running editor; do not restart or silently
// reopen the project to conceal a missing live-ingest update.
export async function ingestFixture(file,assets,{speech=false,audioAnalysis=false,onStarted=()=>{},onFinished=()=>{}}={}){
 const s=await readJSON(file);verifyDesktopOwner(s);assert(s.state==='Running','Desktop ingest requires a running owned session');
 assert(inside(s.root,s.bundle)&&assets.length>0&&assets.length<=16&&assets.every(a=>/^[A-Za-z0-9_-]+$/.test(a.asset_id)&&inside(s.root,a.media_path)),'Ingest exceeds the owned fixture');
 const configRoot=path.join(s.root,'ui-ingest'),settings=path.join(configRoot,'wizard');await mkdir(settings,{recursive:true});
 let local=await readFile(path.join(ROOT,'runner/ingest-local.toml'),'utf8');
 if(audioAnalysis){assert(local.includes('[audio_analysis]\nenabled = false'),'Offline audio analysis profile is not mapped');local=local.replace('[audio_analysis]\nenabled = false','[audio_analysis]\nenabled = true');}
 await writeFile(path.join(settings,'wiz-ingest.toml'),speech?speechProfile(local,s.plan.speechModel?.directory):local);
 const python=ingestPython(s.plan.app),request={wiz_path:s.bundle,clips:assets,operations:['all'],force_rerun:false};
 const tools=path.join(s.app,'Contents/MacOS');
 const env={...s.env,PATH:path.dirname(python)+':'+s.env.PATH,FFMPEG_BIN:path.join(tools,'ffmpeg'),FFMPEG_DIR:tools,WIZSERVER_ADDR:s.url,WIZARD_SETTINGS:settings,XDG_CONFIG_HOME:configRoot,PYTHONDONTWRITEBYTECODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
 const receipt=await command(python,['-m','wiz_ingest','submit','--request-json',JSON.stringify(request)],{env,cwd:s.root,timeout:speech?150000:60000,processGroup:true,onSpawn:pid=>{retainProcess(s.root,pid,true);onStarted({pid,startedAt:Date.now()});}});
 onFinished({finishedAt:Date.now()});
 const latest=await readJSON(file);await appendFile(path.join(s.root,'operations.jsonl'),JSON.stringify({caseId:latest.currentCheck,stepId:latest.currentStep,operation:'wiz-ingest.submit',params:request,profile:speech?'offline-speech':audioAnalysis?'offline-audio-analysis':'local-source-preparation',pid:s.pid,...receipt})+'\n');
 const snapshot=parseIngest(receipt,s.bundle,assets.map(a=>a.asset_id));
 for(const a of assets)verifyIngestSidecar(JSON.parse(await readFile(path.join(s.bundle,'assets/clips',a.asset_id+'.json'),'utf8')),a.asset_id);
 await writeJSON(path.join(s.root,'ui-ingest-'+snapshot.job_id+'.json'),{pid:s.pid,snapshot});
 verifyDesktopOwner(await readJSON(file));return snapshot;
}
