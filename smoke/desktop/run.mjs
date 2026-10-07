import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,appendFile,readFile} from 'node:fs/promises';
import {prepareDesktop,launchDesktop,stopDesktop,terminateOwnedDesktop,captureDesktopFailure,retainChild,desktopCall,nativeCall} from './adapter.mjs';
import {physicalChecks} from '../runner/catalog.mjs';
import {readJSON,writeJSON,sha,dataDirectory} from '../runner/files.mjs';
import {failureStatus,command,assert,same,snapshotState} from '../runner/engine.mjs';
import {saveDiscard} from './check-lifecycle.mjs';
import {unsetRateExport} from './check-unset-rate.mjs';
import {projectWorkflow} from './check-projects.mjs';
import {beginCheck,endCheck,selectorNamesTimeline,requireScriptCompletion,requireScriptReceipt,desktopScriptTimeout,missingCheckOperations} from './check-support.mjs';
export async function executeDesktopGroup(prepared,{onResult=async()=>{},onSession=async()=>{},isCancelled=()=>false,signal}={}){
const original=await readJSON(new URL('./course.json',import.meta.url)),fullCourse={...original,cases:[...original.cases,...physicalChecks]},ids=prepared?.ids||fullCourse.cases.map(c=>c.id),course={...fullCourse,cases:fullCourse.cases.filter(c=>ids.includes(c.id))},total=course.cases.length;
const source=prepared?.runtime.app||process.argv[2],qtCocoaPlugin=prepared?.runtime.qtPlugin||process.argv[3];assert(source?.endsWith('.app'),'Choose an instrumented desktop app.');
const session=await prepareDesktop(source,qtCocoaPlugin,prepared?.runtime.cli||process.argv[4],prepared),file=path.join(session.root,'session.json');session.selectedChecks=ids;session.agentDefinitions=fullCourse.cases.filter(c=>ids.includes(c.id));await writeJSON(file,session);
await onSession(session);
const report={course,scope:session.scope,startedAt:new Date().toISOString(),guiHash:session.guiHash,cliHash:session.desktopCliHash,qtCocoa:session.qtCocoa,results:[],sources:{}};
const map=await readJSON(new URL('./check-map.json',import.meta.url)),wants=name=>map[name]?.some(id=>ids.includes(id));
const here=path.dirname(fileURLToPath(import.meta.url));
for(const name of ['adapter.mjs','run.mjs','check-physical-editor.mjs','check-physical.mjs','check-checklist.mjs','check-checklist-expansion.mjs','checklist-proof.mjs','check-projects.mjs','project-proof.mjs','check-volume-search.mjs','volume-proof.mjs','volume-contract.mjs','volume-agent-proof.mjs','ui-workflows.mjs','ui-cohort-proof.mjs','recorder.mjs','check-recorded-playback.mjs','ingest-fixture.mjs','check-media-search-ui.mjs','check-colour-panels.mjs','check-controls-audio.mjs','editor-proof.mjs','agent-proof.mjs','agent-tools.mjs','observations.mjs','physical-input.mjs','macos-input.mjs','macos-input.swift','check-core.mjs','check-editor.mjs','check-paths.mjs','check-support.mjs','check-workspace.mjs','check-scopes.mjs','check-spellbook.mjs','check-compounds.mjs','check-selection-bin.mjs','check-next.mjs','check-surface.mjs','check-lifecycle.mjs','check-unset-rate.mjs','check-offline-export.mjs','check-playback.mjs','check-spell-ui.mjs','check-relink.mjs','check-curves.mjs','export-dialog.mjs','generated-fixture.mjs','course.json','native/bridge.cpp','native/build.sh','native/smoke-style.json','check-guards.mjs'])report.sources[name]=await sha(path.join(here,name));
const unsupported=course.cases.filter(c=>missingCheckOperations(c.id,session.schema).length);
if(unsupported.length&&course.cases.every(c=>c.id==='D-CLI-01'||unsupported.includes(c))){
  const evidence=path.join(session.root,'build-capabilities.json');await writeJSON(evidence,{packageHash:session.guiHash,checks:unsupported.map(c=>({id:c.id,missingOperations:missingCheckOperations(c.id,session.schema)}))});
  for(const c of course.cases){const missing=missingCheckOperations(c.id,session.schema),value={id:c.id,status:'Blocked',error:missing.length?'Selected build lacks '+missing.join(', ')+'. Choose a build supporting this check.':'Desktop was not launched because this group requires unavailable build capabilities.',evidence:{capabilities:evidence}};report.results.push(value);await endCheck(file,value);await onResult(value,session.root);}
  report.completed=true;report.status='Fail';report.finishedAt=new Date().toISOString();await writeJSON(path.join(session.root,'desktop-course-report.json'),report);return {report,sessionFile:file,root:session.root};
}
let live,currentCheck,pendingVerification=[];
async function script(name,result,expectedCount=0,args=[],merge=false){
 if(!wants(name))return;if(isCancelled())throw Object.assign(Error('Course cancelled; no further actions dispatched.'),{status:'Unknown'});
 const receipt=await command(process.execPath,[path.join(here,name),file,...args],{timeout:desktopScriptTimeout(course.cases.filter(c=>map[name]?.includes(c.id))),signal,processGroup:true,onSpawn:pid=>retainChild(session,pid)});await writeJSON(path.join(session.root,name+args.join('-')+'.execution.json'),receipt);
 requireScriptReceipt(receipt,name);const r=await readJSON(path.join(session.root,result));
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
  await script('check-physical-editor.mjs','desktop-physical-report.json');
  await script('check-physical.mjs','desktop-physical-report.json');
  await script('check-checklist.mjs','desktop-checklist-report.json');
  await script('check-checklist-expansion.mjs','desktop-checklist-expansion-report.json');
  await script('check-volume-search.mjs','desktop-volume-report.json');
  await script('check-media-search-ui.mjs','desktop-media-search-report.json');
  await script('check-colour-panels.mjs','desktop-colour-panels-report.json');
  await script('check-controls-audio.mjs','desktop-controls-audio-report.json');
  await script('check-recorded-playback.mjs','desktop-recorded-playback-report.json');
  for(const id of map['check-projects.mjs']||[])if(ids.includes(id)){
    currentCheck=id;await beginCheck(file,id);const holder={live};let value;
    try{value=await projectWorkflow(file,holder,id);}finally{live=holder.live;}
    report.results.push(value);await endCheck(file,value);await onResult(value,session.root);currentCheck=null;
    if(value.status==='Unknown')throw Object.assign(Error(value.error),{status:'Unknown',evidence:value.evidence});
  }
  await script('check-paths.mjs','desktop-paths-report.json',15);
  await script('check-editor.mjs','desktop-editor-report.json');
  await script('check-compounds.mjs','desktop-compounds-report.json',6);
  await script('check-spellbook.mjs','desktop-spellbook-report.json',9);
  if(wants('check-spellbook.mjs')){pendingVerification=['D-SB-PERSIST'];await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));await script('check-spellbook.mjs','desktop-spellbook-reopen-report.json',2,['verify']);pendingVerification=[];}
  await script('check-next.mjs','desktop-next-report.json',4);
  await script('check-surface.mjs','desktop-surface-report.json',3);
  if(ids.includes('D-SAVE-DISCARD')){await beginCheck(file,'D-SAVE-DISCARD');const holder={live};let lifecycle;try{lifecycle=await saveDiscard(file,holder);}finally{live=holder.live;}
  report.results.push(lifecycle);await endCheck(file,lifecycle);await onResult(lifecycle,session.root);assert(lifecycle.status==='Pass','Lifecycle did not restore a running saved project; inspect its report.');}
  if(ids.includes('D-DOCUMENT-EDIT')){pendingVerification=['D-DOCUMENT-EDIT'];await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));}
  await script('check-surface.mjs','desktop-document-reopen-report.json',1,['verify'],true);
  pendingVerification=[];
  await script('check-playback.mjs','desktop-playback-report.json',4);
  await script('check-spell-ui.mjs','desktop-spell-ui-report.json',4);
  if(ids.includes('D-SB-TAB-RENAME')){pendingVerification=['D-SB-TAB-RENAME'];await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));await script('check-spell-ui.mjs','desktop-spell-ui-reopen-report.json',1,['verify'],true);pendingVerification=[];}
  if(ids.includes('D-MEDIA-RELINK')){const relinkPrep=await command(process.execPath,[path.join(here,'check-relink.mjs'),file,'prepare'],{timeout:120000});
  await writeJSON(path.join(session.root,'relink-prepare-execution.json'),relinkPrep);assert(relinkPrep.code===0,'Local relink fixture preparation failed');
  pendingVerification=['D-MEDIA-RELINK'];await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file),{missingMediaFixture:path.join(session.root,'relink-prepared.json')});
  await script('check-relink.mjs','desktop-relink-report.json',1);
  await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));
  await script('check-relink.mjs','desktop-relink-reopen-report.json',1,['verify'],true);pendingVerification=[];}
  await script('check-curves.mjs','desktop-curves-report.json',2);
  // Bin-duplication persistence can expose a display-name defect. Keep its
  // fixture changes after the established baseline checks to avoid cascading failures.
  await script('check-selection-bin.mjs','desktop-selection-bin-report.json',8);
  pendingVerification=ids.filter(id=>['D-BIN-RENAME','D-BIN-DUPLICATE','D-BIN-DELETE','D-BIN-MGFX'].includes(id));
  if(pendingVerification.length){await stopDesktop(file);await live.closed;live=await launchDesktop(await readJSON(file));await script('check-selection-bin.mjs','desktop-bin-reopen-report.json',4,['verify'],true);pendingVerification=[];}
  if(ids.includes('S-EXPORT-UNSET-RATE')){await beginCheck(file,'S-EXPORT-UNSET-RATE');const holder={live};let value;try{value=await unsetRateExport(file,holder);}finally{live=holder.live;}report.results.push(value);await endCheck(file,value);await onResult(value,session.root);}
}catch(e){report.error=e.message;report.failureEvidence=e.evidence||await captureDesktopFailure(file,e,currentCheck||'group');if(currentCheck){const value={id:currentCheck,status:failureStatus(e),error:e.message,evidence:report.failureEvidence};report.results.push(value);await endCheck(file,value);}
  for(const id of pendingVerification){const prior=report.results.find(r=>r.id===id);if(prior?.status==='Pass'){prior.initial={status:prior.status,evidence:prior.evidence};prior.status=e.status==='Unknown'?'Unknown':'Blocked';prior.error='Persistence verification did not complete: '+e.message;prior.evidence={...prior.evidence,...report.failureEvidence};await endCheck(file,prior);}}
}
finally{
  if(live&&live.child.exitCode===null&&!live.child.signalCode)try{await stopDesktop(file);await live.closed;}catch(e){try{await terminateOwnedDesktop(file,live);report.cleanupRecovery={error:e.message,terminated:true};}catch(cleanup){report.cleanupError=cleanup.message;}}
  let events=[];try{events=(await readFile(path.join(session.root,'check-events.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
  report.results.push(...missingDesktopResults(course.cases,report.results,events,report.error,report.failureEvidence));
  report.qtCocoa=(await readJSON(file)).qtCocoa;report.finishedAt=new Date().toISOString();report.status=!report.error&&!report.cleanupError&&report.results.length===total&&report.results.every(r=>r.status==='Pass')?'Pass':'Fail';
  await writeJSON(path.join(session.root,'desktop-course-report.json'),report);console.log(JSON.stringify({report:path.join(session.root,'desktop-course-report.json'),status:report.status,passed:report.results.filter(r=>r.status==='Pass').length,total},null,2));
}

return {report,sessionFile:file,root:session.root};
}
export function missingDesktopResults(cases,results,events,error='',evidence=null){
 return cases.filter(c=>!results.some(r=>r.id===c.id)).map(c=>{
  const started=events.some(e=>e.id===c.id&&e.status==='Running');
  return {id:c.id,status:started?'Unknown':'Blocked',notExecuted:!started,error:(started?'Check began without a safely completed driver report; inspect retained actions. ':'Not executed because an earlier check or restoration failed. ')+error,evidence};
 });
}
export function desktopGroups(ids,map,mode='grouped'){
  assert(['grouped','isolated'].includes(mode),'Unknown desktop execution mode');
  const remaining=new Set(ids),groups=[];
  for(const name of ['check-physical-editor.mjs','check-physical.mjs','check-checklist.mjs','check-checklist-expansion.mjs','check-projects.mjs','check-volume-search.mjs','check-media-search-ui.mjs','check-colour-panels.mjs','check-controls-audio.mjs','check-recorded-playback.mjs'])for(const id of map[name]||[])if(remaining.delete(id)){
    // Lifecycle, disk reload and preference-changing gestures keep their own session.
    const isolated=mode==='isolated'||name==='check-projects.mjs'||['D-EXTERNAL-RELOAD','D-SHORTCUT-CONFLICT','D-DOCK-MODIFIER','D-HISTORY-50','D-IMPORT-DIALOG','D-INGEST-SEARCH-LIVE'].includes(id);
    const nameKey=isolated?name+'#'+id:name,group=groups.find(g=>g.name===nameKey);
    if(group)group.ids.push(id);else groups.push({name:nameKey,ids:[id],recoverUnstarted:mode==='grouped'&&!isolated});
  }
  for(const [name,members] of Object.entries({...map,'check-core.mjs':[...map['check-core.mjs'],'D-LP-02-RELAUNCH']})){
    const selected=members.filter(id=>remaining.delete(id));if(selected.length)groups.push({name,ids:selected});
  }
  if(remaining.delete('D-SAVE-DISCARD'))groups.push({name:'lifecycle',ids:['D-SAVE-DISCARD']});
  if(remaining.size)throw Error('Unmapped desktop checks: '+[...remaining].join(', '));
  return groups.sort((a,b)=>(b.name==='check-core.mjs')-(a.name==='check-core.mjs'));
}
export async function executeDesktop(prepared={}, {onResult=async()=>{},isCancelled=()=>false,signal,executeGroup=executeDesktopGroup}={}){
  const original=await readJSON(new URL('./course.json',import.meta.url)),full={...original,cases:[...original.cases,...physicalChecks]},ids=prepared?.ids||full.cases.map(c=>c.id),map=await readJSON(new URL('./check-map.json',import.meta.url));
  const mode=prepared.plan?(prepared.plan.recipe?.selection?.desktopMode||'isolated'):'grouped',groups=desktopGroups(ids,map,mode),directory=prepared.directory||path.join(dataDirectory(prepared.dataDir),'desktop-runs'),runtime=prepared.runtime||{app:process.argv[2],qtPlugin:process.argv[3],cli:process.argv[4]};await mkdir(directory,{recursive:true});const root=await mkdtemp(path.join(directory,'desktop-course-'));
  const report={course:{...full,cases:full.cases.filter(c=>ids.includes(c.id))},startedAt:new Date().toISOString(),scope:'Fresh owned project and session per independent desktop group',desktopMode:mode,results:[],groups:[]};
  let sessionFile;
  for(const group of groups){
    if(isCancelled()||report.cleanupError)break;
    // Keep report identities intact; '#' becomes a URL fragment in renderer file URLs.
    const groupStartedAt=new Date().toISOString(),owned=path.join(root,'groups',group.name.replace('.mjs','').replaceAll('#','--'));await mkdir(owned,{recursive:true});let session,offset=0,pending=Promise.resolve();
    const poll=()=>pending=pending.then(async()=>{if(!session)return;let text;try{text=await readFile(path.join(session.root,'check-events.jsonl'),'utf8');}catch(e){if(e.code==='ENOENT')return;throw e;}
      const lines=text.split('\n').filter(Boolean);for(const line of lines.slice(offset)){let event;try{event=JSON.parse(line);}catch{break;}offset++;if(group.ids.includes(event.id))await appendFile(path.join(root,'check-events.jsonl'),line+'\n');}
    });
    const timer=setInterval(()=>void poll().catch(()=>{}),500);
    try{
      const result=await executeGroup({...prepared,runtime,directory:owned,ids:[...new Set(['D-CLI-01',...group.ids])]},{isCancelled,signal,onSession:s=>{session=s;},onResult:async()=>{}});
      clearInterval(timer);await poll();sessionFile=result.sessionFile;report.guiHash=result.report.guiHash;report.cliHash=result.report.cliHash;
      report.groups.push({name:group.name,root:result.root,sessionFile,status:result.report.status,error:result.report.error||null,cleanupRecovery:result.report.cleanupRecovery||null,startedAt:groupStartedAt,preparedAt:result.report.startedAt||null,finishedAt:result.report.finishedAt||new Date().toISOString(),durationMs:Date.now()-Date.parse(groupStartedAt)});
      for(const id of group.ids){const value=result.report.results.find(r=>r.id===id)||{id,status:'Blocked',error:'Group did not retain this observation.'};if(value.notExecuted&&group.recoverUnstarted&&!group.recovery&&!isCancelled()&&!result.report.cleanupError){
        // Only untouched checks may start in a fresh session. Never replay an attempted mutation.
        groups.push({name:group.name+'#unstarted-'+id,ids:[id],recovery:true});continue;
      }
      const final={...value,group:group.name,source:path.join(result.root,'desktop-course-report.json')};report.results.push(final);
      await appendFile(path.join(root,'check-events.jsonl'),JSON.stringify({...final,final:true,at:new Date().toISOString()})+'\n');await onResult(final,root);}
      for(const filename of ['operations.jsonl','native-events.jsonl','native-input.jsonl','agent-tools.jsonl','agent-results.jsonl','steps.jsonl']){try{const lines=(await readFile(path.join(result.root,filename),'utf8')).split('\n').filter(Boolean);for(const line of lines){const receipt=JSON.parse(line);await appendFile(path.join(root,filename),JSON.stringify({...receipt,source:receipt.source||path.join(result.root,filename)})+'\n');}}catch(e){if(e.code!=='ENOENT')throw e;}}
      if(result.report.cleanupError)report.cleanupError=result.report.cleanupError;
    }catch(e){report.error=e.message;break;}
    finally{clearInterval(timer);await pending.catch(()=>{});}
    await writeJSON(path.join(root,'desktop-course-report.json'),report);
  }
  for(const id of ids)if(!report.results.some(r=>r.id===id))report.results.push({id,status:'Blocked',error:report.error||report.cleanupError||'Cancelled before this independent group.'});
  if(report.groups.some(g=>g.error)&&report.results.every(r=>r.status==='Pass'))report.error='A desktop group did not finalize: '+report.groups.find(g=>g.error).error;
  report.finishedAt=new Date().toISOString();report.completed=!report.error&&!report.cleanupError&&!isCancelled();report.status=report.completed&&!report.groups.some(g=>g.error)&&report.results.every(r=>r.status==='Pass')?'Pass':'Fail';
  await writeJSON(path.join(root,'desktop-course-report.json'),report);return {root,sessionFile,report};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const {report}=await executeDesktop();if(report.status!=='Pass')process.exitCode=1;}
