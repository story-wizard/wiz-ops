import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,cp,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startPreparation,readPreparation} from '../runner/preparations.mjs';
import {testSpecification} from '../test-details.mjs';
import {checkRegistry} from '../runner/catalog.mjs';
import {assertSelectedRuntime} from '../runner/runtime.mjs';
import {writeJSON} from '../runner/files.mjs';
import {ownedDesktopSessions} from '../desktop/hub.mjs';

test('desktop planning rejects a substitute app, a different package and a foreign CLI',()=>{
 const runtime={kind:'selected-build-attachment',app:'/Selected.app',appHash:'selected-hash',cli:'/Selected.app/Contents/MacOS/wiz-cli'};
 assert.doesNotThrow(()=>assertSelectedRuntime(runtime,runtime.app,runtime.appHash));
 for(const change of [{app:'/Other.app'},{appHash:'other-hash'},{cli:'/Other.app/Contents/MacOS/wiz-cli'},{kind:'legacy-instrumented'}])assert.throws(()=>assertSelectedRuntime({...runtime,...change},runtime.app,runtime.appHash),/selected build/);
});

test('preparation retains progress, binds readiness to the selected build and stops with agent repair context',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'athanor-preparation-'));let release,enteredResolve,completion;
 try{
  const pending=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>enteredResolve=resolve),options={app:'/Chosen.app',dataDir:data,selection:{checkIds:['D-CLI-01']}};
  const first=await startPreparation(options,{execute:async({app,onProgress})=>{assert.equal(app,options.app);await onProgress('tools');enteredResolve();await pending;await onProgress('attach');return {planHash:'frozen-selected-plan',packageHash:'selected-bytes'};}});completion=first.completion;await entered;
  const running=await readPreparation(data,first.job.id);assert.equal(running.state,'Preparing');assert.equal(running.steps[0].status,'Running');
  release();await first.completion;const ready=await readPreparation(data,first.job.id);assert.equal(ready.state,'Ready');assert.equal(ready.planHash,'frozen-selected-plan');assert.ok(ready.steps.every(s=>s.status==='Pass'));
  const failed=await startPreparation(options,{execute:async({onProgress})=>{await onProgress('attach');throw Error('Plugin version mismatch');}});await failed.completion;
  const result=await readPreparation(data,failed.job.id);assert.equal(result.state,'Failed');assert.equal(result.planHash,undefined);assert.equal(result.steps[3].status,'Fail');assert.equal(result.steps[4].status,'Not run');assert.match(result.repairPrompt,/Chosen.app/);assert.match(result.repairPrompt,/Plugin version mismatch/);assert.match(result.repairPrompt,/Do not substitute/);
 }finally{release?.();await completion;await rm(data,{recursive:true,force:true});}
});
test('grade context explains the actual procedure without inventing recorded step receipts or changing acceptance',()=>{
 for(const id of ['A-CO-01','A-CO-02','A-CO-04']){
  const check=checkRegistry().find(c=>c.id===id),spec=testSpecification(check);assert.equal(check.accepted,true);assert.equal(spec.definitionHash,check.definitionHash);assert.equal(spec.steps.length,0);assert.equal(spec.procedure.length,6);assert.match(spec.procedure[4],/reopen/);assert.match(spec.procedure[5],/Reset/);
 }
});
test('an interrupted preparation retains a repair prompt for its selected build',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'athanor-interrupted-')),id='11111111-1111-4111-8111-111111111111';
 try{await mkdir(path.join(data,'preparations'));await writeJSON(path.join(data,'preparations',id+'.json'),{id,state:'Preparing',app:'/Selected.app'});const job=await readPreparation(data,id);assert.equal(job.state,'Interrupted');assert.match(job.repairPrompt,/Selected.app/);assert.match(job.repairPrompt,/before Ready/);}finally{await rm(data,{recursive:true,force:true});}
});
test('a live preparation attachment blocks another launch even after its coordinator exits',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-owned-attachment-'))),root=path.join(data,'attachments/attach-Test'),executable=path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard-bin'),bundle=path.join(root,'projects');let child,closed;
 try{
  await mkdir(path.dirname(executable),{recursive:true});await mkdir(bundle);await cp('/bin/sleep',executable);child=spawn(executable,['30']);closed=new Promise(resolve=>child.once('close',resolve));await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  await writeJSON(path.join(root,'session.json'),{dataDir:data,root,bundle,executable,executableName:'wizard-bin',pid:child.pid,state:'Attached'});
  assert.equal(ownedDesktopSessions(data)[0]?.pid,child.pid);child.kill('SIGTERM');await closed;assert.equal(ownedDesktopSessions(data).length,0);
 }finally{child?.kill('SIGTERM');await closed;await rm(data,{recursive:true,force:true});}
});
