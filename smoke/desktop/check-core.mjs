import {beginCheck,endCheck,waitForObservation,visiblePlayhead} from './check-support.mjs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {desktopCall,nativeCall,captureDesktopFailure} from './adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,pause,same,snapshotState} from '../runner/engine.mjs';
const file=process.argv[2],s=await readJSON(file),report={scope:s.scope,pid:s.pid,generation:s.generation,guiHash:s.guiHash,bridgeHash:s.bridgeHash,results:[]};
async function check(id,fn){if(!await beginCheck(file,id))return;try{const evidence=await fn();report.results.push({id,status:'Pass',evidence});}catch(e){report.results.push({id,status:e.status||'Fail',error:e.message,diagnostics:e.diagnostics||null,evidence:await captureDesktopFailure(file,e,id)});if(e.status==='Unknown'){await writeJSON(path.join(s.root,'desktop-core-report.json'),report);await endCheck(file,report.results.at(-1));throw e;}}await writeJSON(path.join(s.root,'desktop-core-report.json'),report);await endCheck(file,report.results.at(-1));}
const until=waitForObservation;
const ui=()=>nativeCall(file,'inspect');
await check('D-CLI-01',async()=>{const state=await ui();assert(state.widgets.some(w=>w.class==='MainWindow'&&/^Golden\.wiz — Wizard(?: [•*])?$/.test(w.title)),'Owned project window is absent.');const failed=state.widgets.filter(w=>w.text?.includes('failed to load'));assert(!failed.length,'Panel startup failed: '+failed.map(w=>w.text).join('; '));return {endpoint:s.endpoint,window:state.widgets.find(w=>w.class==='MainWindow')};});
await check('D-CLI-02',async()=>{
  const name=`Smoke GUI ${s.harnessId} ${Date.now()}`;await desktopCall(file,'timeline.update',{id:'gui-rename',timeline_id:s.main.id,changes:{name}});
  const observed=await until(async()=>{const state=await ui();return state.widgets.some(w=>w.name==='panelSubtabSelector'&&w.text.startsWith(name))&&state.widgets.some(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name))?state:null;});
  await writeJSON(path.join(s.root,'gui-rename-observed.json'),observed);return {expected:name,selector:observed.widgets.find(w=>w.name==='panelSubtabSelector').text,observation:'Qt UI selector and media model, independent of WizServer readback'};
});
await check('D-PB-01',async()=>{
  await desktopCall(file,'render.bind_timeline',{timeline_id:s.main.id,playhead_frame:0});await desktopCall(file,'playback.seek',{time:1.25});
  const sought=await until(async()=>{const readout=visiblePlayhead(await ui());return Math.abs(readout.seconds-1.25)<.001?readout:null;},{description:'Visible playhead at frame 30'});
  const before=await desktopCall(file,'playback.query_transport');assert(before.frame===30&&!before.playing,'Seek missed frame 30.');
  let playing,visiblePlaying,paused,settled,uncertain=false;
  try{await desktopCall(file,'playback.play');await pause(600);playing=await desktopCall(file,'playback.query_transport');visiblePlaying=await until(async()=>{const readout=visiblePlayhead(await ui());return readout.seconds>sought.seconds?readout:null;},{description:'Visible playhead advances during playback'});}
  catch(e){uncertain=e.status==='Unknown';throw e;}
  finally{if(!uncertain)await desktopCall(file,'playback.pause');}
  paused=await desktopCall(file,'playback.query_transport');await pause(250);settled=await desktopCall(file,'playback.query_transport');
  assert(playing.playing&&playing.frame>before.frame,'Live transport did not advance.');assert(!paused.playing&&settled.frame===paused.frame,'Pause did not hold the playhead.');
  await desktopCall(file,'playback.seek',{time:2});await until(async()=>Math.abs(visiblePlayhead(await ui()).seconds-2)<.001,{description:'Visible playhead at two seconds'});
  return {before,playing,paused,settled,visibleReadout:visiblePlaying,scope:'Live transport and visible timecode or scrubber position; no dropped-frame or audible-sync claim'};
});
await check('D-LP-02-SAVE',async()=>{
  const expected=snapshotState(await desktopCall(file,'timeline.inspect',{timeline_id:s.main.id}));
  const readRef=ref=>execFileSync('/usr/bin/git',['-C',s.bundle,'rev-parse',`refs/heads/${ref}`],{encoding:'utf8'}).trim();
  const before=readRef('main');assert(before!==readRef('autosave'),'Save check needs an unsaved edit.');
  const state=await ui(),save=state.actions.filter(a=>a.text==='Save'&&a.enabled);assert(save.length===1,'Save action is ambiguous.');await nativeCall(file,'action',{target:save[0].id});
  const tip=await until(async()=>{const actual=readRef('main');return actual!==before&&actual===readRef('autosave')?actual:null;});
  const saved=await desktopCall(file,'timeline.inspect',{timeline_id:s.main.id});same(snapshotState(saved),expected,'Saved timeline');await writeJSON(path.join(s.root,'gui-saved-timeline.json'),saved);
  return {mainTip:tip,name:saved.timeline.name,scope:'Real Save QAction; relaunch verified separately'};
});
report.completed=true;await writeJSON(path.join(s.root,'desktop-core-report.json'),report);console.log(JSON.stringify(report,null,2));if(report.results.some(r=>r.status!=='Pass'))process.exitCode=1;
