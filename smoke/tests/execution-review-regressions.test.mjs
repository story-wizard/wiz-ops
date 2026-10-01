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
  for(const name of ['adapter.mjs','check-support.mjs','generated-fixture.mjs','check-offline-export.mjs','check-idle.mjs','native/bridge.cpp','native/build.sh','native/smoke-style.json']){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),'boundary fixture');}
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
