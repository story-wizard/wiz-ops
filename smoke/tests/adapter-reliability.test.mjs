import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm,mkdir,readFile,writeFile,realpath,open,unlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {generatedPlacement,createLocalGraphic} from '../desktop/generated-fixture.mjs';
import {verifyNativeCapabilities,parseNativeResponse,acquireNativeLock} from '../desktop/adapter.mjs';
import {waitForObservation,recordStep,endCheck} from '../desktop/check-support.mjs';
import {executeDesktop,desktopGroups,missingDesktopResults} from '../desktop/run.mjs';
import {writeJSON} from '../runner/files.mjs';
import {stageObservation,liveStageObservation} from '../runner/stages.mjs';
import {failureStatus} from '../runner/engine.mjs';
import {withAdapterAction} from '../desktop/agent-proof.mjs';
test('overlapping native observations wait for the mailbox and never remove a busy lock',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-native-mailbox-')),lock=path.join(root,'native-call.lock');let held;
 try{held=await open(lock,'wx');await assert.rejects(()=>acquireNativeLock(lock,{timeoutMs:20}),e=>e.status==='Blocked');await readFile(lock);
  const queued=acquireNativeLock(lock,{timeoutMs:1000});await held.close();held=null;await unlink(lock);const next=await queued;await next.close();await unlink(lock);
  await assert.rejects(()=>acquireNativeLock(path.join(root,'missing','lock')),e=>e.code==='ENOENT');
 }finally{await held?.close();await rm(root,{recursive:true,force:true});}
});

test('scripted mutations with an unknown outcome prohibit further writes but allow inspection',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-script-uncertainty-')),file=path.join(root,'session.json');
 try{
  await writeJSON(file,{root,currentCheck:'D-PROJECT-NEW',generation:1});let writes=0;
  await assert.rejects(()=>withAdapterAction(file,true,'action',{target:'create'},async()=>{writes++;throw Object.assign(Error('Lost response'),{status:'Unknown'});}),e=>e.status==='Unknown');
  assert.equal(JSON.parse(await readFile(file)).agentUncertain,true);
  await assert.rejects(()=>withAdapterAction(file,true,'action',{target:'create'},async()=>{writes++;}),e=>e.status==='Blocked');assert.equal(writes,1);
  assert.equal(await withAdapterAction(file,false,'inspect',{},async()=>'observed'),'observed');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('lost or mismatched native replies remain Unknown rather than a retryable failure',()=>{
 const identity={id:'request',pid:123,generation:2},reply={...identity,ok:true,result:{done:true}};
 assert.deepEqual(parseNativeResponse(JSON.stringify(reply),identity).result,{done:true});
 assert.equal(parseNativeResponse(JSON.stringify({...reply,ok:false,error:'Rejected'}),identity).ok,false);
 for(const raw of ['{','null',JSON.stringify({...reply,id:'other'}),JSON.stringify({...reply,pid:124}),JSON.stringify({...reply,generation:3}),JSON.stringify({...reply,ok:undefined})])assert.throws(()=>parseNativeResponse(raw,identity),e=>e.status==='Unknown');
});

test('final blocked results cannot inherit a passing fixture preparation receipt',()=>{
 const id='D-MEDIA-RELINK',blocked={id,status:'Blocked',error:'Missing Media prevented the actual test'},events=[{id,status:'Pass',evidence:{prepared:true}}];
 assert.deepEqual(stageObservation(id,{results:[blocked]},events),blocked);
 assert.equal(stageObservation(id,{results:[]},events).status,'Pass');
 assert.equal(stageObservation(id,{results:[blocked]},[...events,{id,status:'Running'}]).status,'Unknown');
});

test('live persistence waits for the merged group result without hiding an earlier failure',()=>{
 const id='D-BIN-DUPLICATE',initial={id,status:'Fail',error:'Copy lost the original asset'},pass={id,status:'Pass'},blocked={id,status:'Blocked',error:'Required checks failed'};
 assert.equal(liveStageObservation(pass),null);
 assert.equal(liveStageObservation(blocked,initial),null);
 assert.equal(liveStageObservation({id,status:'Running'},initial),null);
 const final={...initial,final:true};assert.deepEqual(liveStageObservation(final,initial),final);
 assert.equal(liveStageObservation(blocked,final),null);
 assert.equal(liveStageObservation({...pass,final:true}).status,'Pass');
 assert.equal(liveStageObservation({id:'D-SB-PERSIST',status:'Pass'}),null);
});

test('grouping preserves selected checks and only untouched checks get a bounded fresh continuation',async()=>{
 const map=JSON.parse(await readFile(new URL('../desktop/check-map.json',import.meta.url))),ids=['P-TL-BIN-DROP','P-TL-TRIM','D-PROJECT-NEW','D-PROJECT-SAVE-AS'];
 const grouped=desktopGroups(ids,map),isolated=desktopGroups(ids,map,'isolated');
 assert.equal(grouped.length,3);assert.equal(isolated.length,4);
 assert.equal(desktopGroups(['P-RG-WIRE','P-CURVE-LIVE'],map,'grouped').length,2,'Live scripted input cannot inherit a completed agent-proof attempt');assert.deepEqual(new Set(grouped.flatMap(g=>g.ids)),new Set(ids));
 for(const repeat of [false,true]){
  const root=await mkdtemp(path.join(tmpdir(),'athanor-group-unstarted-'));const calls=[],live=[];
  try{
   const result=await executeDesktop({directory:root,ids:ids.slice(0,2),plan:{recipe:{selection:{desktopMode:'grouped'}}}},{onResult:async r=>live.push(r),executeGroup:async p=>{
    calls.push(p.ids);const owned=path.join(p.directory,'owned');await mkdir(owned);
    return {root:owned,report:{status:'Fail',results:p.ids.map(id=>({id,status:id==='P-TL-BIN-DROP'?'Unknown':id==='P-TL-TRIM'&&(repeat||calls.length===1)?'Blocked':'Pass',...(id==='P-TL-TRIM'&&(repeat||calls.length===1)?{notExecuted:true}:{})}))}};
   }});
   assert.equal(calls.length,2,'An untouched check gets at most one fresh continuation');
   assert.ok(!calls[1].includes('P-TL-BIN-DROP'),'Unknown is never replayed');
   assert.equal(result.report.results.find(r=>r.id==='P-TL-BIN-DROP').status,'Unknown');
   assert.equal(result.report.results.find(r=>r.id==='P-TL-TRIM').status,repeat?'Blocked':'Pass');
   assert.equal(live.filter(r=>r.id==='P-TL-TRIM').length,1,'No transient Blocked verdict for a queued untouched check');
   const events=(await readFile(path.join(result.root,'check-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(events.every(e=>e.final));
   assert.ok(result.report.groups.every(g=>Number.isFinite(g.durationMs)));
  }finally{await rm(root,{recursive:true,force:true});}
 }
});

test('failure collection keeps the original error, observed UI and actual captured bytes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-failure-capture-'));
 try{
  const source=await readFile(new URL('../desktop/adapter.mjs',import.meta.url),'utf8'),start=source.indexOf('export async function captureDesktopFailure('),end=source.indexOf('export async function terminateOwnedDesktop(',start);
  assert.ok(start>=0&&end>start);
  const image=path.join(root,'observed.png');await writeFile(image,Buffer.from('captured-window-bytes'));
  const prefix=`import path from 'node:path';import {randomUUID} from 'node:crypto';import {cp} from 'node:fs/promises';import {readJSON,writeJSON,inside} from '${new URL('../runner/files.mjs',import.meta.url).href}';import {assert} from '${new URL('../runner/engine.mjs',import.meta.url).href}';const nativeCall=async(file,op)=>op==='inspect'?{widgets:[{id:'window',window:'window',class:'MainWindow',active:true,title:'Golden.wiz — Wizard'}]}:{path:${JSON.stringify(image)},width:100,height:80};\n`;
  const module=path.join(root,'capture.mjs');await writeFile(module,prefix+source.slice(start,end));
  const file=path.join(root,'session.json');await writeJSON(file,{root});
  const {captureDesktopFailure}=await import(pathToFileURL(module).href),error=Object.assign(Error('Expected two tracks'),{status:'Fail',diagnostics:{expected:'Two tracks present',attempts:5}});
  const evidence=await captureDesktopFailure(file,error,'D-TRACK');
  assert.deepEqual(await readFile(evidence.failureScreenshot),await readFile(image));
  const state=JSON.parse(await readFile(evidence.failureState));assert.equal(state.error,error.message);assert.equal(state.ui.widgets[0].title,'Golden.wiz — Wizard');assert.equal(state.wait.attempts,5);assert.equal(state.image.source,'Qt widget raster');
  const next=await captureDesktopFailure(file,error,'D-TRACK');assert.notEqual(next.failureState,evidence.failureState);assert.deepEqual(await readFile(evidence.failureScreenshot),await readFile(image),'A later capture must preserve the first evidence');
  const blocked=await captureDesktopFailure(file,Object.assign(Error('Covered pointer'),{status:'Blocked',code:'pointer_occluded',nextActions:['clear_target'],diagnostics:{occluder:{pid:77,owner:'NotificationCenter'}}}),'P-TRACK');
  const diagnostic=JSON.parse(await readFile(blocked.failureState));assert.equal(diagnostic.code,'pointer_occluded');assert.equal(diagnostic.diagnostics.occluder.pid,77);assert.deepEqual(diagnostic.nextActions,['clear_target']);assert.equal(diagnostic.wait,null);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('MGFX admission accepts both reviewed placement shapes and verifies actual clip readback',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-mgfx-contract-'));
 try{
  for(const kind of ['direct_generation','compound']){
   const destination={kind:'timeline',state:'committed',parent:{timeline_id:'timeline',track_id:'track',clip_id:'clip'},...(kind==='direct_generation'?{schema_version:2,placement_kind:kind}:{nested:{kind,timeline_id:'child'}})};
   const calls=[],call=async(op,p)=>{calls.push(op);if(op==='generate.renderers')return {profile:{},renderers:[{id:'web',adapters:[{id:'hyperframes',contract:{execution:{network:'disabled'},entry:{scaffold:[{path:'src/index.html',content:'<body></body>'}]}}}]}]};if(op==='timeline.create')return {timeline_id:'timeline',tracks:[{kind:'video',track_id:'track'}]};if(op==='generate.graphics')return {destination};if(op==='timeline.inspect')return {tracks:[{track_id:'track',items:[{kind:'clip',clip_id:'clip',track_id:'track'}]}]};throw Error(op);};
   assert.equal((await createLocalGraphic(call,{bundle:root})).placement.kind,kind);
   assert.ok(calls.includes('timeline.inspect'),'Admission alone does not prove placement');
   await assert.rejects(()=>createLocalGraphic((op,p)=>op==='timeline.inspect'?Promise.resolve({tracks:[]}):call(op,p),{bundle:root}),/independent timeline readback/);
  }
  for(const d of [null,{state:'queued'},{kind:'timeline',state:'committed',placement_kind:'future',parent:{clip_id:'c',timeline_id:'t',track_id:'v'}}])assert.throws(()=>generatedPlacement({destination:d}),e=>e.status==='Blocked');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('adapter negotiation rejects missing protocols and unavailable commands before dispatch',()=>{
 const ready={capabilities:{protocol:1,version:2,operations:['inspect','click']}};
 assert.equal(verifyNativeCapabilities(ready,['inspect','click']).version,2);
 for(const input of [{},{capabilities:{protocol:2,version:2,operations:['inspect']}},ready])assert.throws(()=>verifyNativeCapabilities(input,['inspect','screenshot']),e=>e.status==='Blocked');
});

test('observation waits retain the condition, attempts and last value when timing out',async()=>{
 let count=0;assert.equal(await waitForObservation(async()=>++count===3?'ready':null,{timeoutMs:100,intervalMs:1,description:'Panel ready'}),'ready');
 await assert.rejects(()=>waitForObservation(async()=>false,{description:'Two tracks present',timeoutMs:10,intervalMs:1}),e=>e.status==='Fail'&&e.diagnostics.expected==='Two tracks present'&&e.diagnostics.attempts>0&&e.diagnostics.lastObservation===false);
});

test('a failed reopen preserves its result and later independent groups get a fresh fixture',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-group-recovery-'));let number=0;const fixtures=[];
 try{
  const result=await executeDesktop({directory:root,ids:['D-DOCUMENT-EDIT','D-MEDIA-RELINK']},{executeGroup:async(p,{onSession})=>{
   const owned=path.join(p.directory,'owned');await mkdir(owned);await onSession({root:owned});fixtures.push(p.directory);number++;
   const values=p.ids.map(id=>({id,status:id==='D-DOCUMENT-EDIT'?'Blocked':'Pass',...(id==='D-DOCUMENT-EDIT'?{error:'Missing Media during reopen'}:{})}));
   await writeJSON(path.join(owned,'desktop-course-report.json'),{results:values});
   return {root:owned,sessionFile:path.join(owned,'session.json'),report:{status:number===1?'Fail':'Pass',...(number===1?{error:'Project did not reopen'}:{}),results:values}};
  }});
  assert.equal(number,2);assert.notEqual(fixtures[0],fixtures[1]);
  assert.deepEqual(result.report.results.map(r=>[r.id,r.status]),[['D-DOCUMENT-EDIT','Blocked'],['D-MEDIA-RELINK','Pass']]);
  assert.equal(result.report.completed,true);assert.equal(result.report.status,'Fail');assert.equal(result.report.error,undefined);
  assert.match((await readFile(path.join(result.root,'desktop-course-report.json'),'utf8')),/Missing Media/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('check identities retain their hash delimiter while new renderer fixture paths do not',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-url-fixture-'));
 try{
  const result=await executeDesktop({directory:root,ids:['D-SOURCE-COLOR'],plan:{recipe:{selection:{desktopMode:'isolated'}}}},{executeGroup:async p=>{
   assert.ok(!p.directory.includes('#'));assert.ok(p.directory.includes('D-SOURCE-COLOR'));
   const owned=path.join(p.directory,'owned');await mkdir(owned);
   return {root:owned,report:{status:'Pass',results:p.ids.map(id=>({id,status:'Pass'}))}};
  }});
  assert.equal(result.report.results[0].id,'D-SOURCE-COLOR');assert.ok(result.report.groups[0].name.includes('#D-SOURCE-COLOR'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unconfirmed cleanup blocks later groups instead of launching another desktop',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-group-cleanup-'));let calls=0;
 try{
  const result=await executeDesktop({directory:root,ids:['D-DOCUMENT-EDIT','D-MEDIA-RELINK']},{executeGroup:async p=>{calls++;const owned=path.join(p.directory,'owned');await mkdir(owned);return {root:owned,report:{status:'Fail',cleanupError:'Owned process remains',results:p.ids.map(id=>({id,status:'Fail'}))}};}});
  assert.equal(calls,1);assert.equal(result.report.completed,false);assert.match(result.report.cleanupError,/remains/);assert.equal(result.report.results.find(r=>r.id==='D-MEDIA-RELINK').status,'Blocked');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a group crash after passing assertions cannot produce a successful desktop course',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-group-finalize-'));
 try{
  const result=await executeDesktop({directory:root,ids:['D-DOCUMENT-EDIT']},{executeGroup:async p=>{const owned=path.join(p.directory,'owned');await mkdir(owned);return {root:owned,report:{status:'Fail',error:'Final checkpoint failed',results:p.ids.map(id=>({id,status:'Pass'}))}};}});
  assert.equal(result.report.results[0].status,'Pass');assert.equal(result.report.status,'Fail');assert.match(result.report.error,/Final checkpoint failed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('standalone desktop execution retains external workspace defaults after grouping',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-standalone-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=root;let calls=0;
 try{
  const result=await executeDesktop(undefined,{isCancelled:()=>calls>0,executeGroup:async(p)=>{calls++;assert.ok(p.directory.startsWith(path.join(root,'desktop-runs')));assert.ok(p.runtime);const owned=path.join(p.directory,'owned');await mkdir(owned);return {root:owned,report:{status:'Pass',results:p.ids.map(id=>({id,status:'Pass'}))}};}});
  assert.equal(calls,1);assert.ok(result.root.startsWith(path.join(root,'desktop-runs')));assert.equal(result.report.completed,false);
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('process exit codes stay diagnostics rather than test or step verdicts',async()=>{
 const error=Object.assign(Error('process exited'),{status:1});
 assert.equal(failureStatus(error),'Fail');for(const status of ['Fail','Blocked','Unknown'])assert.equal(failureStatus({status}),status);
 assert.equal(stageObservation('D-X',{results:[{id:'D-X',status:1,error:error.message}]},[]).status,'Fail');
 const root=await mkdtemp(path.join(tmpdir(),'athanor-step-exit-')),file=path.join(root,'session.json');
 try{await writeJSON(file,{root,currentCheck:'D-X'});await assert.rejects(()=>recordStep(file,{id:'reopen',title:'Reopen'},async()=>{throw error;}),error);
 const entries=(await readFile(path.join(root,'steps.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(entries.at(-1).status,'Fail');assert.equal(entries.at(-1).observation,error.message);
 const result={id:'D-X',status:1,error:error.message};await endCheck(file,result);assert.equal(result.status,'Fail');const event=JSON.parse((await readFile(path.join(root,'check-events.jsonl'),'utf8')).trim());assert.equal(event.status,'Fail');
 }finally{await rm(root,{recursive:true,force:true});}
});


test('interrupted check admission cannot be mistaken for an untouched check eligible for continuation',()=>{
 const results=missingDesktopResults([{id:'done'},{id:'active'},{id:'later'}],[{id:'done',status:'Fail'}],[{id:'active',status:'Running'}],'Driver timed out');
 assert.deepEqual(results.map(r=>[r.id,r.status,r.notExecuted]),[['active','Unknown',false],['later','Blocked',true]]);
 assert.equal(missingDesktopResults([{id:'active'}],[],[{id:'active',status:'Running'},{id:'active',status:'Pass'}])[0].notExecuted,false,'A partial script ending after an observation cannot authorize a replay');
});
