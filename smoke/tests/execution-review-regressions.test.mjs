import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT,readJSON} from '../runner/files.mjs';

// Keep the actual executor body; substitute app boundaries and run real child
// processes in disposable fixtures instead of launching Wizard.
async function boundaryModule(source,destination,mocks={}){
 const filename=path.join(ROOT,source),text=await readFile(filename,'utf8');
 await writeFile(destination,text.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,(_,start,spec,end)=>start+(mocks[spec]||pathToFileURL(path.resolve(path.dirname(filename),spec)).href)+end));
 return import(pathToFileURL(destination).href);
}

test('script completion separates assertion verdicts from crashes after Pass or Fail',async t=>{
 for(const [priorStatus,completed] of [['Pass',false],['Fail',false],['Fail',true]])await t.test(`${completed?'completed':'crashed'} script after ${priorStatus}`,async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-exit-review-'));
 try{
  for(const name of ['service-course.json','check-map.json'])await copyFile(path.join(ROOT,'desktop',name),path.join(root,name));
  for(const name of ['adapter.mjs','check-support.mjs','generated-fixture.mjs','check-generated-tail.mjs','functional-cohort-proof.mjs','check-offline-export.mjs','check-idle.mjs','native/bridge.cpp','native/build.sh','native/smoke-style.json']){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),'boundary fixture');}
  const adapter=path.join(root,'fake-adapter.mjs');await writeFile(adapter,`
   import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';let live;
   export async function prepareDesktop(a,b,c,p){const root=path.join(p.directory,'owned'),app=path.join(root,'Fixture.app');await mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await writeFile(path.join(app,'Contents/MacOS/wizard-export-worker'),'fixture');return {root,app,scope:'isolated fixture'};}
   export async function launchDesktop(s){await writeFile(path.join(s.root,'session.json'),JSON.stringify({...s,bridgeHash:'fixture'}));return live={child:{exitCode:null,signalCode:null},closed:Promise.resolve()};}
   export async function stopDesktop(){live.child.exitCode=0;}
   export function retainChild(){}
   export async function nativeCall(){throw Error('cannot dispatch UI input');}
  `);
  await writeFile(path.join(root,'check-generated.mjs'),`
   import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';
   const s=JSON.parse(await readFile(process.argv[2]));
   await writeFile(path.join(s.root,'service-generated-report.json'),JSON.stringify({completed:${completed},results:[{id:'S-MGFX-UNDO-PUBLISH',status:${JSON.stringify(priorStatus)},evidence:{asserted:true}}]}));
   if(!${completed})throw Error('final checkpoint failed after assertions');
   process.exitCode=1;
  `);
  const {executeService}=await boundaryModule('desktop/service-run.mjs',path.join(root,'service-run.mjs'),{'./adapter.mjs':pathToFileURL(adapter).href});
  const result=await executeService({runtime:{app:'Fixture.app'},directory:path.join(root,'run'),ids:['S-MGFX-UNDO-PUBLISH']});
  const receipt=await readJSON(path.join(result.root,'check-generated.mjs-execution.json'));
  assert.equal(receipt.code,1);
  assert.equal(result.report.results[0].status,priorStatus,'Completed assertions retain their outcome');
  assert.equal(result.report.status,'Fail','Crashes and assertion failures cannot become a successful stage');
  if(completed){assert.equal(receipt.stderr,'');assert.equal(result.report.error,undefined,'An explicit normal finish with a failed assertion is not an executor crash');}
  else{assert.match(receipt.stderr,/final checkpoint failed/);assert.ok(result.report.error,'The executor crash must remain visible even after a failed assertion');}
 }finally{await rm(root,{recursive:true,force:true});}
 });
});

test('stage finalization failure stops the course while retaining completed assertion evidence',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-stage-review-'));
 try{
  const mock=path.join(root,'executors.mjs');await writeFile(mock,`
   import {mkdir} from 'node:fs/promises';import path from 'node:path';export let desktopCalls=0;
   export async function executeService(p){const root=path.join(p.directory,'owned');await mkdir(root);return {root,sessionFile:path.join(root,'session.json'),report:{status:'Fail',error:'owned app shutdown failed',results:p.ids.map(id=>({id,status:'Pass',evidence:{asserted:true}}))}};}
   export async function executeDesktop(){desktopCalls++;throw Error('Later stage must not launch');}
  `);
  const {executeStages}=await boundaryModule('runner/stages.mjs',path.join(root,'stages.mjs'),{'../desktop/run.mjs':pathToFileURL(mock).href,'../desktop/service-run.mjs':pathToFileURL(mock).href});
  const events=[];
  await assert.rejects(()=>executeStages({plan:{runtime:{}},course:{cases:[{id:'S-MGFX-UNDO-PUBLISH'},{id:'D-CLI-01'}]},root,dataDir:root,isCancelled:()=>false,onResult:async(item,status)=>events.push({id:item.id,status})}),/owned app shutdown failed/);
  assert.equal((await import(pathToFileURL(mock).href)).desktopCalls,0,'No desktop dispatch after failed finalization');
  assert.deepEqual(events,[{id:'S-MGFX-UNDO-PUBLISH',status:'Pass'}],'A stage-level failure must preserve completed check evidence');
  const retained=await readJSON(path.join(root,'stages/service/stage.json'));assert.equal(retained.report.status,'Fail');assert.match(retained.report.error,/shutdown/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('an ordinary completed assertion failure preserves Fail and still executes the next independent stage',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-assertion-fail-'));
 try{
  const mock=path.join(root,'executors.mjs');await writeFile(mock,`
   import {mkdir} from 'node:fs/promises';import path from 'node:path';export let desktopCalls=0;
   async function result(p,status){const root=path.join(p.directory,'owned');await mkdir(root);return {root,sessionFile:path.join(root,'session.json'),report:{completed:true,status,results:p.ids.map(id=>({id,status,evidence:{asserted:true}}))}};}
   export async function executeService(p){return result(p,'Fail');}
   export async function executeDesktop(p){desktopCalls++;return result(p,'Pass');}
  `);
  const {executeStages}=await boundaryModule('runner/stages.mjs',path.join(root,'stages.mjs'),{'../desktop/run.mjs':pathToFileURL(mock).href,'../desktop/service-run.mjs':pathToFileURL(mock).href});
  const events=[];const results=await executeStages({plan:{runtime:{}},course:{cases:[{id:'S-MGFX-UNDO-PUBLISH'},{id:'D-CLI-01'}]},root,dataDir:root,isCancelled:()=>false,onResult:async(item,status)=>events.push({id:item.id,status})});
  assert.equal((await import(pathToFileURL(mock).href)).desktopCalls,1,'Independent stages continue after an assertion Fail');
  assert.deepEqual(results.map(r=>r.status),['Fail','Pass'],'Continuation never erases the failed assertion');
  assert.deepEqual(events,[{id:'S-MGFX-UNDO-PUBLISH',status:'Fail'},{id:'D-CLI-01',status:'Pass'}]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('desktop live progress publishes a verified reopen before later groups and preserves the first Fail',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-live-reopen-')),events=[];
 try{
  const mock=path.join(root,'executors.mjs');await writeFile(mock,`
   import {mkdir,appendFile} from 'node:fs/promises';import path from 'node:path';
   export async function executeService(){throw Error('No service selected');}
   export async function executeDesktop(p){
    const root=path.join(p.directory,'owned');await mkdir(root);const file=path.join(root,'check-events.jsonl');
    const emit=async(id,status,final=false)=>appendFile(file,JSON.stringify({id,status,...(final?{final:true}:{})})+'\\n');
    await emit('D-BIN-DUPLICATE','Running');await emit('D-BIN-DUPLICATE','Pass');await emit('D-BIN-DUPLICATE','Pass',true);
    await new Promise(r=>setTimeout(r,650));await globalThis.liveCheckpoint('reopen');
    await emit('D-DOCUMENT-EDIT','Running');await emit('D-DOCUMENT-EDIT','Fail');await emit('D-DOCUMENT-EDIT','Blocked');await emit('D-DOCUMENT-EDIT','Fail',true);
    await new Promise(r=>setTimeout(r,650));await globalThis.liveCheckpoint('failure');
    return {root,report:{completed:true,status:'Fail',results:[{id:'D-BIN-DUPLICATE',status:'Pass'},{id:'D-DOCUMENT-EDIT',status:'Fail'}]}};
   }
  `);
  globalThis.liveCheckpoint=phase=>{
   if(phase==='reopen')assert.ok(events.some(e=>e.id==='D-BIN-DUPLICATE'&&e.status==='Pass'),'Reopen must become Pass while later groups are still pending');
   else{assert.ok(events.some(e=>e.id==='D-DOCUMENT-EDIT'&&e.status==='Fail'));assert.ok(!events.some(e=>e.id==='D-DOCUMENT-EDIT'&&e.status==='Blocked'),'Dependency verification must not hide the original failure');}
  };
  const {executeStages}=await boundaryModule('runner/stages.mjs',path.join(root,'stages.mjs'),{'../desktop/run.mjs':pathToFileURL(mock).href,'../desktop/service-run.mjs':pathToFileURL(mock).href});
  await executeStages({plan:{runtime:{}},course:{cases:[{id:'D-BIN-DUPLICATE'},{id:'D-DOCUMENT-EDIT'}]},root,dataDir:root,isCancelled:()=>false,onResult:async(c,status)=>events.push({id:c.id,status})});
 }finally{delete globalThis.liveCheckpoint;await rm(root,{recursive:true,force:true});}
});

test('animated-tail service finalizes only after fresh-process verification and retains both capture sets',async()=>{
 for(const mode of ['verified','reopen-fail','launch-blocked']){
  const root=await mkdtemp(path.join(tmpdir(),'athanor-tail-executor-'));
  try{
   for(const name of ['service-course.json','check-map.json'])await copyFile(path.join(ROOT,'desktop',name),path.join(root,name));
   for(const name of ['adapter.mjs','check-support.mjs','generated-fixture.mjs','functional-cohort-proof.mjs','check-generated.mjs','check-offline-export.mjs','check-idle.mjs','native/bridge.cpp','native/build.sh','native/smoke-style.json']){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),'component boundary fixture');}
   const adapter=path.join(root,'boundary-adapter.mjs');await writeFile(adapter,`
    import {mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';let live;
    export async function prepareDesktop(a,b,c,p){const root=path.join(p.directory,'owned'),app=path.join(root,'Fixture.app');await mkdir(path.join(app,'Contents/MacOS'),{recursive:true});await writeFile(path.join(app,'Contents/MacOS/wizard-export-worker'),'fixture');return {root,app,pid:0,generation:0,scope:'component-only'};}
    export async function launchDesktop(s){if(s.generation===1&&${JSON.stringify(mode)}==='launch-blocked')throw Object.assign(Error('fresh process blocked'),{status:'Blocked'});const state={...s,pid:100+s.generation+1,generation:s.generation+1,bridgeHash:'fixture'};await writeFile(path.join(s.root,'session.json'),JSON.stringify(state));return live={child:{exitCode:null,signalCode:null},closed:Promise.resolve()};}
    export async function stopDesktop(){live.child.exitCode=0;}
    export function retainChild(){} export async function nativeCall(){throw Error('cannot dispatch UI input');}
   `);
   await writeFile(path.join(root,'check-generated-tail.mjs'),`
    import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';const s=JSON.parse(await readFile(process.argv[2])),verify=process.argv[3]==='verify',status=verify&&${JSON.stringify(mode)}==='reopen-fail'?'Fail':'Pass',image=path.join(s.root,verify?'reopened.png':'original.png');await writeFile(image,'synthetic component evidence');
    await writeFile(path.join(s.root,verify?'service-generated-tail-reopen-report.json':'service-generated-tail-report.json'),JSON.stringify({completed:true,results:[{id:'S-MGFX-TAIL-TIMING',status,evidence:{artifacts:[image],pid:s.pid,reopenPending:!verify}}]}));process.exitCode=status==='Pass'?0:1;
   `);
   const {executeService}=await boundaryModule('desktop/service-run.mjs',path.join(root,'service-run.mjs'),{'./adapter.mjs':pathToFileURL(adapter).href});
   const result=await executeService({runtime:{app:'Fixture.app'},directory:path.join(root,'run'),ids:['S-MGFX-TAIL-TIMING']}),value=result.report.results[0];
   assert.equal(result.report.results.length,1);assert.equal(value.status,mode==='verified'?'Pass':mode==='reopen-fail'?'Fail':'Blocked');
   const events=(await readFile(path.join(result.root,'check-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).final,true);assert.equal(events.at(-1).status,value.status);
   if(mode!=='launch-blocked'){assert.deepEqual(value.evidence.artifacts.map(p=>path.basename(p)),['original.png','reopened.png']);assert.notEqual(value.evidence.pid,value.evidence.reopen.pid);assert.equal(value.evidence.reopenPending,false);}
   else assert.match(value.error,/reopen did not complete/);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
