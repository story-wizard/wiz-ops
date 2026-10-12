import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {packetMetrics,executionMetrics,reviewSessionMetrics} from '../scripts/review-cost.mjs';
import {measurePhase} from '../runner/performance.mjs';

test('review metrics retain missing timings, distinguish incorrect conclusions and do not label parsing as review time',async()=>{
 const packet={cases:[{conclusion:{assertions:[{expected:3,actual:4,artifact:'proof.json'}]}}]},cost=packetMetrics(packet);assert.equal(cost.casesWithComparison,1);assert.equal(cost.proofLinks,1);assert.equal(cost.estimatedTokens,Math.ceil(cost.bytes/4));
 const historical=executionMetrics({groups:[{name:'bin',durationMs:8000}]},[{operation:'diagnostic.capture',caseId:'C',status:'Completed'}]);assert.equal(historical.wallMs,null);assert.equal(historical.diagnostics[0].durationMs,null);assert.equal(historical.gaps.length,2);
 const measured=executionMetrics({timings:[{phase:'launch',durationMs:10}]},[{operation:'performance.collect',caseId:'C',summary:{elapsedMs:20,collectionMs:2}},{operation:'diagnostic.capture',caseId:'C',durationMs:4}]);assert.equal(measured.phases[0].durationMs,10);assert.equal(measured.checks[0].elapsedMs,20);assert.equal(measured.diagnostics[0].durationMs,4);
 const root=await mkdtemp('/private/tmp/athanor-review-cost-');try{
  const file=root+'/brief.json';await writeFile(file,'12345678');const session={lane:'same evidence',startedAt:'2026-10-11T12:00:00Z',concludedAt:'2026-10-11T12:00:02Z',correctConclusion:false,files:[file,file],unsupportedClaims:['Editing the copy was verified.']};
  const review=await reviewSessionMetrics(session);assert.equal(review.elapsedMs,2000);assert.equal(review.timeToCorrectConclusionMs,null);assert.equal(review.uniqueFiles,1);assert.equal(review.filesOpened,2);assert.equal(review.bytesRead,8);assert.equal(review.unsupportedClaims.length,1);
  assert.equal((await reviewSessionMetrics({...session,correctConclusion:true})).timeToCorrectConclusionMs,2000);await assert.rejects(()=>reviewSessionMetrics({...session,concludedAt:'bad'}),/timestamps/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('phase timers retain results and original failures, including Unknown',async()=>{
 const timings=[];assert.equal(await measurePhase(timings,'prepare',async()=>42),42);const error=Object.assign(Error('Uncertain'),{status:'Unknown'});
 await assert.rejects(()=>measurePhase(timings,'reopen',async()=>{throw error;}),e=>e===error);assert.equal(timings[1].status,'Unknown');assert.ok(timings.every(t=>t.durationMs>=0&&t.startedAt&&t.finishedAt));
});
