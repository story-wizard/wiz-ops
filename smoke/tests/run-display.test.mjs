import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDuration,runTiming,progressBar,buildImportProgress} from '../public/run-display.js';

test('run clocks freeze at completion and estimate only comparable completed executions',()=>{
  const start='2026-09-30T20:00:00Z',now=Date.parse(start)+600_000;
  const packageIdentity={packageHash:'build',courseHash:'course',runnerHash:'assertions',fixtureHash:'media',runtime:{appHash:'desktop',qtHash:'plugin'}};
  const run={id:'current',created_at:start,execution:{state:'Running',updated_at:start,package:packageIdentity,recipe:{cases:[{id:'A'},{id:'B'}]}},results:[{status:'Pass'},{status:'Running'}]};
  const history=seconds=>({...run,id:'history-'+seconds,execution:{...run.execution,state:'Failed',updated_at:new Date(Date.parse(start)+seconds*1000).toISOString()},results:[{status:'Pass'},{status:'Fail'}]});
  const otherBuild=history(900);otherBuild.execution.package={...packageIdentity,packageHash:'other-build'};
  const otherRunner=history(800);otherRunner.execution.package={...packageIdentity,runnerHash:'different-assertions'};
  const otherPlugin=history(1000);otherPlugin.execution.package={...packageIdentity,runtime:{...packageIdentity.runtime,qtHash:'other-plugin'}};
  const incomplete=history(700);incomplete.results=[{status:'Pass'},{status:'Unknown'}];
  const missing=history(600);delete missing.results;
  const waiting=history(500);waiting.execution.recipe={...run.execution.recipe,checkpoint:{id:'human'}};
  const timing=runTiming(run,[history(70),history(90),otherBuild,otherRunner,otherPlugin,incomplete,missing,waiting],now);
  assert.equal(timing.elapsedMs,600_000);assert.equal(timing.totalMs,null);
  assert.equal(timing.estimatedTotalMs,80_000);assert.equal(timing.samples,2);
  const done=history(70);assert.equal(runTiming(done,[],now).totalMs,70_000);assert.equal(runTiming(done,[],now+999_000).elapsedMs,70_000);
  assert.equal(runTiming(run,[],now).estimatedTotalMs,null);
  assert.equal(runTiming({...done,execution:{...done.execution,state:'Unknown'}},[],now).totalMs,null);
  assert.equal(runTiming({...done,execution:{...done.execution,updated_at:'invalid'}},[],now).elapsedMs,null);
  assert.equal(runTiming({created_at:start},[],now),null);
  assert.equal(formatDuration(70_000),'1:10');assert.equal(formatDuration(3_661_000),'1:01:01');assert.equal(formatDuration(null),'—');
});

test('smoke progress reports completed checks separately from success and keeps empty runs valid',()=>{
  const html=progressBar([{status:'Pass'},{status:'Fail'},{status:'Blocked'},{status:'Running'},{status:'Not run'}],'Running');
  assert.match(html,/aria-valuemax="5" aria-valuenow="3"/);assert.match(html,/1 pass, 1 fail, 1 blocked, 1 running/);
  assert.match(html,/data-active="true"/);assert.match(progressBar([{status:'Fail'}],'Failed'),/data-active="false"/);
  assert.match(progressBar([{status:'Pass'}],'Waiting for human'),/data-active="false"/);assert.match(progressBar([{status:'Not run'}],'Queued'),/data-active="false"/);
  const empty=progressBar([],'Queued');assert.ok(!empty.includes('NaN'));assert.match(empty,/aria-valuemax="1" aria-valuenow="0"/);
  assert.match(html,/class="progress-fill" style="width:80%"/);
  assert.match(html,/class="segment pass" style="width:25%"/);
  assert.match(html,/class="energy-edge" aria-hidden="true"/);
  for(const state of ['Queued','Waiting for human','Passed','Failed','Unknown'])assert.ok(!progressBar([{status:'Pass'}],state).includes('class="energy-edge"'));
  assert.ok(!progressBar([{status:'Not run'}],'Preflight').includes('class="energy-edge"'));
});

test('build progress shows actual transfer bytes and does not invent totals during validation',()=>{
 const known=buildImportProgress({stage:'Downloading',bytes:25*1024**2,totalBytes:100*1024**2});
 assert.match(known,/25.0 MB of 100.0 MB · 25%/);assert.match(known,/aria-valuenow="25"/);assert.match(known,/class="energy-edge"/);
 const unknown=buildImportProgress({stage:'Downloading',bytes:7*1024**2});assert.match(unknown,/7.0 MB transferred/);assert.ok(!unknown.includes('aria-valuenow'));assert.match(unknown,/indeterminate/);
 const checking=buildImportProgress({stage:'Checking archive',bytes:100,totalBytes:100});assert.ok(!checking.includes('aria-valuenow'));assert.match(checking,/Checking archive/);
 const verifying=[0,1,2,3,4].map(completedSteps=>buildImportProgress({stage:'Fingerprinting app',phase:'validation',completedSteps,totalSteps:4}));assert.deepEqual(verifying.map(html=>Number(html.match(/aria-valuenow="(\d+)"/)[1])),[0,25,50,75,100]);assert.ok(verifying.every(html=>!html.includes('indeterminate')));assert.match(verifying[3],/3 of 4 verification steps complete/);
 const ready=buildImportProgress({stage:'Ready',complete:true});assert.match(ready,/aria-valuenow="100"/);assert.ok(!ready.includes('class="energy-edge"'));
 assert.match(buildImportProgress({stage:'Failed',complete:true}),/data-active="false"/);
 assert.ok(!buildImportProgress({stage:'<script>',bytes:NaN}).includes('<script>'));
});
