import {beginCheck,endCheck} from './check-support.mjs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {desktopCall,nativeCall} from './adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,pause,same,snapshotState} from '../runner/engine.mjs';
const file=process.argv[2],s=await readJSON(file),report={scope:s.scope,pid:s.pid,generation:s.generation,guiHash:s.guiHash,bridgeHash:s.bridgeHash,results:[]};
async function check(id,fn){if(!await beginCheck(file,id))return;try{const evidence=await fn();report.results.push({id,status:'Pass',evidence});}catch(e){report.results.push({id,status:e.status||'Fail',error:e.message});if(e.status==='Unknown'){await writeJSON(path.join(s.root,'desktop-core-report.json'),report);await endCheck(file,report.results.at(-1));throw e;}}await writeJSON(path.join(s.root,'desktop-core-report.json'),report);await endCheck(file,report.results.at(-1));}
async function until(fn){for(let i=0;i<50;i++){const value=await fn();if(value)return value;await pause(100);}throw new Error('GUI observation did not arrive within five seconds.');}
const ui=()=>nativeCall(file,'inspect');
const tc=state=>state.widgets.find(w=>w.name==='previewCurrentTimecode')?.text;
await check('D-CLI-01',async()=>{const state=await ui();assert(state.widgets.some(w=>w.class==='MainWindow'&&/^Golden\.wiz — Wizard(?: [•*])?$/.test(w.title)),'Owned project window is absent.');const failed=state.widgets.filter(w=>w.text?.includes('failed to load'));assert(!failed.length,'Panel startup failed: '+failed.map(w=>w.text).join('; '));return {endpoint:s.endpoint,window:state.widgets.find(w=>w.class==='MainWindow')};});
await check('D-CLI-02',async()=>{
  const name=`Smoke GUI ${s.harnessId} ${Date.now()}`;await desktopCall(file,'timeline.update',{id:'gui-rename',timeline_id:s.main.id,changes:{name}});
  const observed=await until(async()=>{const state=await ui();return state.widgets.some(w=>w.name==='panelSubtabSelector'&&w.text.startsWith(name))&&state.widgets.some(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name))?state:null;});
  await writeJSON(path.join(s.root,'gui-rename-observed.json'),observed);return {expected:name,selector:observed.widgets.find(w=>w.name==='panelSubtabSelector').text,observation:'Qt UI selector and media model, independent of WizServer readback'};
});
await check('D-PB-01',async()=>{
  await desktopCall(file,'render.bind_timeline',{timeline_id:s.main.id,playhead_frame:0});await desktopCall(file,'playback.seek',{time:1.25});
  const sought=await until(async()=>{const state=await ui();return tc(state)==='00:00:01:06'?state:null;});
  const before=await desktopCall(file,'playback.query_transport');assert(before.frame===30&&!before.playing,'Seek missed frame 30.');
  await desktopCall(file,'playback.play');await pause(600);const playing=await desktopCall(file,'playback.query_transport');const visiblePlaying=await ui();
  await desktopCall(file,'playback.pause');const paused=await desktopCall(file,'playback.query_transport');await pause(250);const settled=await desktopCall(file,'playback.query_transport');
  assert(playing.playing&&playing.frame>before.frame,'Live transport did not advance.');assert(tc(visiblePlaying)!==tc(sought),'GUI timecode did not advance.');assert(!paused.playing&&settled.frame===paused.frame,'Pause did not hold the playhead.');
  await desktopCall(file,'playback.seek',{time:2});await until(async()=>tc(await ui())==='00:00:02:00');
  return {before,playing,paused,settled,visibleTimecode:tc(visiblePlaying),scope:'Live transport and visible timecode; no dropped-frame or audible-sync claim'};
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
