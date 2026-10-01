import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareDesktop,launchDesktop,stopDesktop,retainChild,desktopCall,nativeCall} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {command,assert,same,snapshotState} from '../runner/engine.mjs';
import {saveDiscard} from './check-lifecycle.mjs';
import {unsetRateExport} from './check-unset-rate.mjs';
import {beginCheck,endCheck,selectorNamesTimeline,requireScriptCompletion} from './check-support.mjs';
export async function executeDesktop(prepared,{onResult=async()=>{},isCancelled=()=>false,signal}={}){
const fullCourse=await readJSON(new URL('./course.json',import.meta.url)),ids=prepared?.ids||fullCourse.cases.map(c=>c.id),course={...fullCourse,cases:fullCourse.cases.filter(c=>ids.includes(c.id))},total=course.cases.length;
const source=prepared?.runtime.app||process.argv[2],qtCocoaPlugin=prepared?.runtime.qtPlugin||process.argv[3];assert(source?.endsWith('.app'),'Choose an instrumented desktop app.');
const session=await prepareDesktop(source,qtCocoaPlugin,prepared?.runtime.cli||process.argv[4],prepared),file=path.join(session.root,'session.json');session.selectedChecks=ids;await writeJSON(file,session);
const report={course,scope:session.scope,startedAt:new Date().toISOString(),guiHash:session.guiHash,cliHash:session.desktopCliHash,qtCocoa:session.qtCocoa,results:[],sources:{}};
const map=await readJSON(new URL('./check-map.json',import.meta.url)),wants=name=>map[name]?.some(id=>ids.includes(id));
const here=path.dirname(fileURLToPath(import.meta.url));
for(const name of ['adapter.mjs','run.mjs','check-core.mjs','check-editor.mjs','check-paths.mjs','check-support.mjs','check-workspace.mjs','check-scopes.mjs','check-spellbook.mjs','check-compounds.mjs','check-selection-bin.mjs','check-next.mjs','check-surface.mjs','check-lifecycle.mjs','check-unset-rate.mjs','check-offline-export.mjs','check-playback.mjs','check-spell-ui.mjs','check-relink.mjs','check-curves.mjs','export-dialog.mjs','generated-fixture.mjs','course.json','native/bridge.cpp','native/build.sh','native/smoke-style.json','check-guards.mjs'])report.sources[name]=await sha(path.join(here,name));
let live,currentCheck;
async function script(name,result,expectedCount=0,args=[],merge=false){
 if(!wants(name))return;if(isCancelled())throw Object.assign(Error('Course cancelled; no further actions dispatched.'),{status:'Unknown'});
 const receipt=await command(process.execPath,[path.join(here,name),file,...args],{timeout:120000,signal,processGroup:true,onSpawn:pid=>retainChild(session,pid)});await writeJSON(path.join(session.root,name+args.join('-')+'.execution.json'),receipt);
 const r=await readJSON(path.join(session.root,result));
 for(const value of r.results){assert(ids.includes(value.id),'Script executed an unselected check: '+value.id);const initial=report.results.find(x=>x.id===value.id);if(initial){initial.reopen=value;if(initial.status==='Pass'&&value.status!=='Pass'){initial.status=value.status;initial.error=value.error;}}else report.results.push(value);await onResult(report.results.find(x=>x.id===value.id),session.root);}
 requireScriptCompletion(receipt,r,name);
}
try{
  live=await launchDesktop(session);report.bridgeHash=(await readJSON(file)).bridgeHash;
  const guards=await command(process.execPath,[path.join(here,'check-guards.mjs'),file],{timeout:15000});assert(guards.code===0,`Desktop guards failed: ${guards.stderr}`);report.guards=await readJSON(path.join(session.root,'desktop-guards-report.json'));
  await script('check-core.mjs','desktop-core-report.json');
  assert(report.results.find(r=>r.id==='D-CLI-01')?.status==='Pass','Owned desktop connection failed');
  await script('check-workspace.mjs','desktop-workspace-report.json',8);
  await script('check-scopes.mjs','desktop-scopes-report.json',1);
  if(ids.includes('D-LP-02-RELAUNCH')){
  currentCheck='D-LP-02-RELAUNCH';await beginCheck(file,currentCheck);
  const before=await readJSON(file),ui=await nativeCall(file,'inspect'),selector=ui.widgets.find(w=>w.name==='panelSubtabSelector').text,expected=await readJSON(path.join(session.root,'gui-saved-timeline.json'));
  await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));const after=await readJSON(file);
  assert(after.pid!==before.pid&&after.generation===before.generation+1,'Relaunch reused process identity');
  same(snapshotState(await desktopCall(file,'timeline.inspect',{timeline_id:session.main.id})),snapshotState(expected),'GUI relaunch persistence');
  const reopened=await nativeCall(file,'inspect'),reopenedSelector=reopened.widgets.find(w=>w.name==='panelSubtabSelector')?.text;assert(selectorNamesTimeline(selector,expected.timeline.name)&&selectorNamesTimeline(reopenedSelector,expected.timeline.name),'GUI selector did not restore saved timeline');
  report.results.push({id:currentCheck,status:'Pass',evidence:{previousPid:before.pid,pid:after.pid,selector,reopenedSelector,scope:'Saved content and selected timeline; harness startup opens its designated timeline, not all previous tabs'}});await endCheck(file,report.results.at(-1));await onResult(report.results.at(-1),session.root);currentCheck=null;}
  await script('check-paths.mjs','desktop-paths-report.json',15);
  await script('check-editor.mjs','desktop-editor-report.json');
  await script('check-compounds.mjs','desktop-compounds-report.json',6);
  await script('check-spellbook.mjs','desktop-spellbook-report.json',9);
  if(wants('check-spellbook.mjs')){await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));await script('check-spellbook.mjs','desktop-spellbook-reopen-report.json',2,['verify']);}
  await script('check-next.mjs','desktop-next-report.json',4);
  await script('check-surface.mjs','desktop-surface-report.json',3);
  if(ids.includes('D-SAVE-DISCARD')){await beginCheck(file,'D-SAVE-DISCARD');const holder={live};let lifecycle;try{lifecycle=await saveDiscard(file,holder);}finally{live=holder.live;}
  report.results.push(lifecycle);await endCheck(file,lifecycle);await onResult(lifecycle,session.root);assert(lifecycle.status==='Pass','Lifecycle did not restore a running saved project; inspect its report.');}
  if(ids.includes('D-DOCUMENT-EDIT')){await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));}
  await script('check-surface.mjs','desktop-document-reopen-report.json',1,['verify'],true);
  await script('check-playback.mjs','desktop-playback-report.json',4);
  await script('check-spell-ui.mjs','desktop-spell-ui-report.json',4);
  if(ids.includes('D-SB-TAB-RENAME')){await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));await script('check-spell-ui.mjs','desktop-spell-ui-reopen-report.json',1,['verify'],true);}
  if(ids.includes('D-MEDIA-RELINK')){const relinkPrep=await command(process.execPath,[path.join(here,'check-relink.mjs'),file,'prepare'],{timeout:120000});
  await writeJSON(path.join(session.root,'relink-prepare-execution.json'),relinkPrep);assert(relinkPrep.code===0,'Local relink fixture preparation failed');
  await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));
  await script('check-relink.mjs','desktop-relink-report.json',1);
  await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));
  await script('check-relink.mjs','desktop-relink-reopen-report.json',1,['verify'],true);}
  await script('check-curves.mjs','desktop-curves-report.json',2);
  // Bin-duplication persistence can expose a display-name defect. Keep its
  // fixture changes after the established baseline checks to avoid cascading failures.
  await script('check-selection-bin.mjs','desktop-selection-bin-report.json',8);
  if(wants('check-selection-bin.mjs')){await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));await script('check-selection-bin.mjs','desktop-bin-reopen-report.json',4,['verify'],true);}
  if(ids.includes('S-EXPORT-UNSET-RATE')){await beginCheck(file,'S-EXPORT-UNSET-RATE');const holder={live};let value;try{value=await unsetRateExport(file,holder);}finally{live=holder.live;}report.results.push(value);await endCheck(file,value);await onResult(value,session.root);}
}catch(e){report.error=e.message;if(currentCheck)report.results.push({id:currentCheck,status:e.status||'Fail',error:e.message});}
finally{
  if(live&&live.child.exitCode===null&&!live.child.signalCode)try{await stopDesktop(file);await live.closed;}catch(e){report.cleanupError=e.message;}
  for(const c of course.cases)if(!report.results.some(r=>r.id===c.id))report.results.push({id:c.id,status:'Blocked',error:'Not executed because an earlier check or restoration failed. '+(report.error||'')});
  report.qtCocoa=(await readJSON(file)).qtCocoa;report.finishedAt=new Date().toISOString();report.status=!report.error&&!report.cleanupError&&report.results.length===total&&report.results.every(r=>r.status==='Pass')?'Pass':'Fail';
  await writeJSON(path.join(session.root,'desktop-course-report.json'),report);console.log(JSON.stringify({report:path.join(session.root,'desktop-course-report.json'),status:report.status,passed:report.results.filter(r=>r.status==='Pass').length,total},null,2));
}

return {report,sessionFile:file,root:session.root};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const {report}=await executeDesktop();if(report.status!=='Pass')process.exitCode=1;}
