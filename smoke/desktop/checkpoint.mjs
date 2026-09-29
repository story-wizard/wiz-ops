import path from 'node:path';
import {appendFile,readFile,writeFile,realpath} from 'node:fs/promises';
import {prepareDesktop,launchDesktop,stopDesktop,desktopCall,nativeCall,verifyDesktopOwner,verifyDesktopPaths} from './adapter.mjs';
import {captureDesktop} from './diagnostics.mjs';
import {readJSON,writeJSON,fingerprint,sha,inside} from '../runner/files.mjs';
import {checkPrepared} from '../runner/prepare.mjs';
import {validateFixtures} from '../runner/fixtures.mjs';
import {assert,same,snapshotState} from '../runner/engine.mjs';
import {checkpoint,saveCheckpoint,checkpointOutcome} from '../runner/checkpoints.mjs';
import {execution,updateExecution} from '../runner/store.mjs';

async function projectState(file){const s=await readJSON(file),states=[];for(const t of [s.main,s.alternate])states.push(snapshotState(await desktopCall(file,'timeline.inspect',{timeline_id:t.id,page:{max_items:500}})));return states;}
async function boundSession(file,data){
 const s=await readJSON(file);verifyDesktopPaths(s,data);verifyDesktopOwner(s,data);
 const ui=await nativeCall(file,'inspect');assert(ui.widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(s.bundle)+' — Wizard')),'Owned app has a different project open.');return s;
}
async function receipts(root,c){
 c.receiptOffsets||={};
 for(const name of ['operations.jsonl','native-events.jsonl']){
  let lines;try{lines=(await readFile(path.join(path.dirname(c.sessionFile),name),'utf8')).split('\n').filter(Boolean);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const line of lines.slice(c.receiptOffsets[name]||0)){const r=JSON.parse(line);await appendFile(path.join(root,'operations.jsonl'),JSON.stringify({...r,caseId:'human-checkpoint',stage:'checkpoint',operation:r.operation||'native.'+r.request.op})+'\n');}
  c.receiptOffsets[name]=lines.length;
 }
}
export async function checkpointReport(db,id){
 const row=execution(db,id),results=db.prepare('SELECT test_id AS id,status,note FROM results WHERE run_id=? ORDER BY rowid').all(id);
 await writeJSON(path.join(row.artifact_root,'report.json'),{runId:id,state:row.state,planHash:row.plan_hash,packageHash:row.package.packageHash,fixtureHash:row.package.fixtureHash,courseRevision:row.recipe.revision,results,checkpoint:checkpoint(db,id),snapshotAt:new Date().toISOString()});
}
export async function prepareCheckpoint(db,id,data){
 const row=execution(db,id),plan=row.package,definition=row.recipe.checkpoint;let live,file;
 try{
  const s=await prepareDesktop(plan.runtime.app,plan.runtime.qtPlugin,plan.runtime.cli,{plan,dataDir:data,directory:path.join(row.artifact_root,'stages/desktop')});
  file=path.join(s.root,'session.json');s.currentCheck='human-checkpoint';await writeJSON(file,s);live=await launchDesktop(s);
  // The shared GP is video-only. Add the known source audio through the app for this explicit human playback check.
  await desktopCall(file,'timeline.place_cuts',{id:'checkpoint-audio',timeline_id:s.main.id,cuts:[{id:'audio',source:{asset_id:s.assets.plate},source_range:{start_seconds:1,end_seconds:5},streams:'audio_only',destination:{at:{seconds:0,track:s.main.audio}}}]});
  await desktopCall(file,'playback.pause');await desktopCall(file,'playback.seek',{time:0});
  const baseline=await projectState(file);await captureDesktop(file,path.join(s.root,'checkpoint-captures/before'));
  const ui=await nativeCall(file,'inspect'),save=ui.actions.filter(a=>a.text==='Save'&&a.enabled);assert(save.length===1,'Owned Save action missing');await nativeCall(file,'action',{target:save[0].id});
  const parcel={definition,runId:id,planHash:row.plan_hash,sessionFile:file,bundle:s.bundle,timeline:s.main.id,scope:s.scope,diagnostics:definition.diagnostics,notCaptured:definition.notCaptured};
  const prompt=`Help the tester complete ${definition.title}. Use only the prepared project ${s.bundle}.\nRead the current checkpoint through the smoke CLI before every session; endpoint/PID can change after reopen. Do not fall back to another app, rebuild this project, edit its structure, or invent a human observation.\n${definition.steps.map((v,i)=>`${i+1}. ${v}`).join('\n')}\nRecord only the tester's actual finding, attributed to them with recordedVia=agent-transcription. A human failure remains a failure after structural verification. Ask before taking over app control. Do not upload or publish evidence.\n`;
  await writeJSON(path.join(s.root,'checkpoint-parcel.json'),parcel);await writeFile(path.join(s.root,'oz-prompt.txt'),prompt);
  let c={state:'Waiting',definition,planHash:row.plan_hash,sessionFile:file,sessionIdentity:{root:s.root,bundle:s.bundle,guiHash:s.guiHash,cliHash:s.desktopCliHash,fixtureHash:s.fixtureHash},baseline,preparedAt:new Date().toISOString(),observations:[],requests:[],captures:[path.join(s.root,'checkpoint-captures/before')],prompt,diagnostics:definition.diagnostics,notCaptured:definition.notCaptured};
  await receipts(row.artifact_root,c);saveCheckpoint(db,id,c);updateExecution(db,id,'Waiting for human','Prepared project is waiting for a human observation. No automated project mutations are running.');await checkpointReport(db,id);
  live.child.unref();live=null;
 }finally{if(live&&live.child.exitCode===null&&!live.child.signalCode){await stopDesktop(file);await live.closed;}}
}
export async function continueCheckpoint(db,id,data){
 const row=execution(db,id);let c=checkpoint(db,id),live,verifying=false,file=c?.sessionFile;
 assert(c?.state==='Working'&&row.state==='Continuing','Checkpoint was not claimed.');const action=c.inFlight.action;
 try{
  assert(row.artifact_root===path.join(data,'runs',id)&&await realpath(row.artifact_root)===row.artifact_root,'Run path changed');
  assert(file===path.join(c.sessionIdentity.root,'session.json')&&inside(path.join(row.artifact_root,'stages/desktop'),c.sessionIdentity.root),'Checkpoint session binding changed');
  let s=await readJSON(file);verifyDesktopPaths(s,data);
  same({root:s.root,bundle:s.bundle,guiHash:s.guiHash,cliHash:s.desktopCliHash,fixtureHash:s.fixtureHash},c.sessionIdentity,'Checkpoint project identity');
  if(action!=='cancel'){
   await checkPrepared(data,row.package);assert(c.planHash===row.plan_hash,'Checkpoint plan changed');
   assert((await fingerprint(s.app,{packageTree:true})).sha256===s.guiHash&&await sha(s.desktopCli)===s.desktopCliHash,'Prepared runtime changed');
   assert((await validateFixtures(path.join(s.root,'media'))).sha256===s.fixtureHash,'Prepared project media changed');
  }
  let alive=true;try{process.kill(s.pid,0);}catch(e){if(e.code!=='ESRCH')throw e;alive=false;}
  if(alive)await boundSession(file,data);
  else if(action!=='cancel'){s.state='Stopped';await writeJSON(file,s);live=await launchDesktop(s);await boundSession(file,data);}
  if(action==='cancel'){
   if(alive)await stopDesktop(file);c.state='Cancelled';c.verification={status:'Blocked',note:'Human checkpoint cancelled; no continuation verification claimed.'};
  }else if(action==='open'||action==='capture'){
   if(action==='open'){const ui=await nativeCall(file,'inspect');await nativeCall(file,'activate',{target:ui.widgets.find(w=>w.class==='MainWindow').id});}
   const directory=path.join(path.dirname(file),'checkpoint-captures',action+'-'+c.inFlight.requestId);await captureDesktop(file,directory);c.captures.push(directory);c.state='Waiting';
  }else{
   verifying=true;await desktopCall(file,'playback.pause');same(await projectState(file),c.baseline,'Human playback must preserve the prepared timelines');
   const before=await readJSON(file);await captureDesktop(file,path.join(before.root,'checkpoint-captures/before-reopen'));await stopDesktop(file);if(live)await live.closed;
   live=await launchDesktop(await readJSON(file));const after=await boundSession(file,data);assert(after.pid!==before.pid&&after.generation===before.generation+1,'Verification must use a fresh desktop process');
   same(await projectState(file),c.baseline,'Desktop save and reopen preserve the prepared timelines');
   await captureDesktop(file,path.join(after.root,'checkpoint-captures/after-reopen'));await stopDesktop(file);await live.closed;
   c.state='Completed';c.verification={status:'Pass',previousPid:before.pid,pid:after.pid,completedAt:new Date().toISOString(),scope:'Timeline state persisted through native Save, owned-process SIGTERM and fresh-process Reopen; the Quit menu and human playback judgment remain separate.'};
  }
  delete c.error;
 }catch(e){c.state='Interrupted';c.error=e.message;c.verification={status:e.status||(verifying?'Fail':'Blocked'),note:e.message};}
 finally{
  // A failed binding or preflight never saves, closes or targets an unverified human session.
  if(live){if(c.state==='Waiting')live.child.unref();else if(live.child.exitCode===null&&!live.child.signalCode)try{await stopDesktop(file);await live.closed;}catch(e){c.error=(c.error||'')+'; cleanup: '+e.message;c.verification={status:'Unknown',note:c.error};}}
  await receipts(row.artifact_root,c);c.lastAction=c.inFlight;delete c.inFlight;saveCheckpoint(db,id,c);
  const automated=db.prepare('SELECT status FROM results WHERE run_id=?').all(id),state=c.state==='Waiting'?'Waiting for human':checkpointOutcome(automated,c);
  updateExecution(db,id,state,c.error|| (c.state==='Waiting'?'Prepared project is waiting for the tester.':'Human finding and automated continuation retained separately.'));await checkpointReport(db,id);
 }
}
