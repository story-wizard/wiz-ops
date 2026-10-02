import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {generatedPlacement,createLocalGraphic} from '../desktop/generated-fixture.mjs';
import {verifyNativeCapabilities,parseNativeResponse} from '../desktop/adapter.mjs';
import {waitForObservation} from '../desktop/check-support.mjs';
import {executeDesktop} from '../desktop/run.mjs';
import {writeJSON} from '../runner/files.mjs';
import {stageObservation} from '../runner/stages.mjs';

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

test('failure collection keeps the original error, observed UI and actual captured bytes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-failure-capture-'));
 try{
  const source=await readFile(new URL('../desktop/adapter.mjs',import.meta.url),'utf8'),start=source.indexOf('export async function captureDesktopFailure('),end=source.indexOf('export async function terminateOwnedDesktop(',start);
  assert.ok(start>=0&&end>start);
  const image=path.join(root,'observed.png');await writeFile(image,Buffer.from('captured-window-bytes'));
  const prefix=`import path from 'node:path';import {randomUUID} from 'node:crypto';import {cp} from 'node:fs/promises';import {readJSON,writeJSON,inside} from '${new URL('../runner/files.mjs',import.meta.url).href}';import {assert} from '${new URL('../runner/engine.mjs',import.meta.url).href}';const nativeCall=async(file,op)=>op==='inspect'?{widgets:[{id:'window',window:'window',class:'MainWindow',active:true,title:'Golden.wiz — Wizard'}]}:{path:${JSON.stringify(image)},width:100,height:80};\n`;
  const module=path.join(root,'capture.mjs');await writeFile(module,prefix+source.slice(start,end));
  const file=path.join(root,'session.json');await writeJSON(file,{root});
  const {captureDesktopFailure}=await import(pathToFileURL(module).href),error=Object.assign(Error('Expected two tracks'),{status:'Fail',diagnostics:{attempts:5}});
  const evidence=await captureDesktopFailure(file,error,'D-TRACK');
  assert.deepEqual(await readFile(evidence.failureScreenshot),await readFile(image));
  const state=JSON.parse(await readFile(evidence.failureState));assert.equal(state.error,error.message);assert.equal(state.ui.widgets[0].title,'Golden.wiz — Wizard');assert.equal(state.wait.attempts,5);assert.equal(state.image.source,'Qt widget raster');
  const next=await captureDesktopFailure(file,error,'D-TRACK');assert.notEqual(next.failureState,evidence.failureState);assert.deepEqual(await readFile(evidence.failureScreenshot),await readFile(image),'A later capture must preserve the first evidence');
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
