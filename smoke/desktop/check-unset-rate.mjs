import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {nativeCall,desktopCall,stopDesktop,launchDesktop} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {assert,same,pause,snapshotState} from '../runner/engine.mjs';
import {exportMovie} from './check-offline-export.mjs';

// New Project owns the unset-rate sentinel. Never manufacture it by editing OTIO.
export async function unsetRateExport(file,holder){
 const original=await readJSON(file),result={id:'S-EXPORT-UNSET-RATE',status:'Pass'},bundle=path.join(original.root,'unset-rate.wiz');
 assert(!existsSync(bundle),'Unset-rate fixture already exists; use a new run workspace');
 const n=(op,p)=>nativeCall(file,op,p),c=(op,p)=>desktopCall(file,op,p),ui=()=>n('inspect');
 async function until(fn){for(let i=0;i<60;i++){const value=await fn();if(value)return value;await pause(100);}throw Error('Unset-rate fixture setup did not settle');}
 async function action(text){const actions=(await ui()).actions.filter(a=>a.text===text&&a.enabled);assert(actions.length===1,'Expected one action: '+text);await n('action',{target:actions[0].id});}
 const baseline=snapshotState(await c('timeline.inspect',{timeline_id:original.main.id}));
 try{
  await action('Save');await pause(200);await action('Project...');
  await until(async()=>{const u=await ui(),box=u.widgets.find(w=>w.class==='QMessageBox');if(box){const save=u.widgets.find(w=>w.window===box.id&&w.text==='Save');assert(save,'Unexpected new-project prompt');await n('click',{target:save.id});}return u.widgets.some(w=>w.class==='ProjectCreationDialog');});
  let u=await ui();const dialog=u.widgets.find(w=>w.class==='ProjectCreationDialog');
  for(const [name,text] of [['projectNameEdit','Unset rate smoke'],['projectPathEdit',bundle]]){const field=u.widgets.find(w=>w.window===dialog.id&&w.name===name);assert(field,'Project field missing: '+name);await n('text',{target:field.id,text});}
  await n('click',{target:u.widgets.find(w=>w.window===dialog.id&&w.text==='Create').id});
  await until(async()=>(await ui()).widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith('unset-rate.wiz — Wizard')));
  const current=await readJSON(file);current.bundle=bundle;current.main={id:(await readdir(path.join(bundle,'timelines'))).find(id=>id.startsWith('tl_'))};assert(current.main.id,'New Project created no timeline');await writeJSON(file,current);
  await action('Timeline Settings...');u=await until(async()=>{const value=await ui();return value.widgets.some(w=>w.class==='TimelineSettingsDialog')?value:null;});
  const settings=u.widgets.find(w=>w.class==='TimelineSettingsDialog');
  for(const [name,text] of [['timelineWidthEdit','1920'],['timelineHeightEdit','1080']])await n('text',{target:u.widgets.find(w=>w.window===settings.id&&w.name===name).id,text});
  await n('click',{target:u.widgets.find(w=>w.window===settings.id&&w.text==='OK').id});await until(async()=>!(await ui()).widgets.some(w=>w.class==='TimelineSettingsDialog'));
  const observed=await c('timeline.inspect',{timeline_id:current.main.id});same(observed.timeline.frame_rate,{numerator:0,denominator:1},'App-created unset rate');assert(observed.timeline.duration_seconds===0&&observed.tracks.every(t=>t.items.length===0),'Fixture must be an empty timeline');
  await writeJSON(path.join(original.root,'unset-rate-fixture.json'),observed);await stopDesktop(file);await holder.live.closed;
  const stopped=await readJSON(file),timelineFile=path.join(bundle,'timelines',current.main.id,'timeline.otio'),beforeHash=await sha(timelineFile);
  same((await readJSON(timelineFile)).metadata.wiz.settings.frame_rate,{value:0,rate:1},'Stored unset rate');
  const output=await exportMovie(stopped,result.id,'mp4','h264',{empty:true});same(await sha(timelineFile),beforeHash,'Export must not rewrite the unset timeline');
  result.evidence={...output,fixture:bundle,creation:'New Project and raster-only Timeline Settings through the app',storedRate:'0/1',resolvedRate:'24/1',timelineHash:beforeHash};
 }catch(e){result.status=e.status||'Fail';result.error=e.message;}
 finally{
  try{
   if(holder.live.child.exitCode===null&&!holder.live.child.signalCode){await stopDesktop(file);await holder.live.closed;}
   const stopped=await readJSON(file);Object.assign(stopped,{bundle:original.bundle,main:original.main});await writeJSON(file,stopped);holder.live=await launchDesktop(stopped);
   same(snapshotState(await c('timeline.inspect',{timeline_id:original.main.id})),baseline,'Restore baseline after unset-rate export');
  }catch(e){result.status='Unknown';result.error=(result.error||'')+'; baseline restoration: '+e.message;}
  await writeJSON(path.join(original.root,'unset-rate-report.json'),{results:[result]});
 }
 return result;
}
