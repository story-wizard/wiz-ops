import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {beginPerformance,endPerformance,parseProcessSample,summarizePerformance} from '../runner/performance.mjs';
import {prepareDelivery,recordDelivery,inspectDelivery,verifyOwnerRoute,ownerDelivery} from '../runner/delivery.mjs';
import {blockedPreparationReport,nightlyHTML} from '../runner/nightly.mjs';
import {actionHistory,evidenceItems,evidenceCoverage} from '../test-details.mjs';

const binding={pid:123,processStart:'Sat Oct 10 11:00:00 2026',generation:1,packageHash:'a'.repeat(64)};
const route={workspace:'story-company',userId:ownerDelivery.userId,user:ownerDelivery.userId,type:'im',channelId:'DTEST123'};
test('preparation blockers retain the requested build and never manufacture a run or functional Pass',()=>{
 const job={id:'11111111-1111-4111-8111-111111111111',state:'Failed',app:'/Selected.app',error:'Synthetic schema mismatch',steps:[{id:'build',status:'Fail'}]},suite={cases:[{id:'TEST',steps:['Open project'],expected:['Project opens']}]},catalog=[{id:'A-CLI-01',title:'Connection'}],identity={build:'requested-test-build',runnerHash:'b'.repeat(64)};
 const report=blockedPreparationReport(job,suite,catalog,identity,{effectiveIds:['A-CLI-01']});assert.equal(report.executionStarted,false);assert.equal(report.runId,null);assert.equal(report.identity.packageHash,null);assert.equal(report.identity.packageVerified,false);assert.deepEqual(report.catalog.counts,{Blocked:1});assert.deepEqual(report.assertionCounts,{NOT_RUN:1});
 assert.match(nightlyHTML(report),/requested-test-build/);
 for(const bad of [{...job,state:'Ready'},{...job,state:'Preparing'},{...job,id:'invalid'}])assert.throws(()=>blockedPreparationReport(bad,suite,catalog,identity,{effectiveIds:['A-CLI-01']}));
 assert.throws(()=>blockedPreparationReport(job,suite,catalog,identity,{effectiveIds:['MISSING']}));
 assert.throws(()=>blockedPreparationReport({...job,runnerHash:'c'.repeat(64)},suite,catalog,identity,{effectiveIds:['A-CLI-01']}),/source differs/);
});
test('performance evidence rejects foreign/restarted processes and invalid counters',()=>{
 assert.equal(parseProcessSample(binding.processStart+' 1:02.50 1234',binding).cpuSeconds,62.5);
 assert.equal(parseProcessSample(binding.processStart+' 1-01:02:03.25 1234',binding).cpuSeconds,90123.25);
 for(const text of ['Sun Oct 11 11:00:00 2026 1:02.50 1234',binding.processStart+' 1:60 1234',binding.processStart+' 1:02 0',''])assert.throws(()=>parseProcessSample(text,binding));
 const record={startTick:process.hrtime.bigint().toString(),before:{sample:{binding,cpuSeconds:1,rssKiB:10},collectionMs:1}};
 const complete=summarizePerformance(record,{sample:{binding,cpuSeconds:2,rssKiB:12},collectionMs:2});assert.equal(complete.status,'Collected');assert.equal(complete.metrics.cpuSeconds,1);assert.equal(complete.collectionMs,3);
 for(const after of [{binding:{...binding,pid:124},cpuSeconds:2},{binding:{...binding,generation:2},cpuSeconds:2},{binding,cpuSeconds:0}])assert.equal(summarizePerformance(record,{sample:after,collectionMs:1}).metrics,null);
});
test('check resources retain collection gaps and artifacts without inventing zero measurements',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-performance-');try{
  const file=await beginPerformance(root,'D-TEST',binding,{sample:async()=>{throw Error('Permission denied');}});
  const result=await endPerformance(file,binding,{sample:async()=>({binding,cpuSeconds:3,rssKiB:10})});
  assert.equal(result.status,'Incomplete');assert.equal(result.metrics,null);assert.match(result.gaps[0],/Permission/);
  const journal=(await readFile(path.join(root,'operations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).at(-1);assert.equal(journal.status,'Incomplete');assert.deepEqual(journal.evidence.artifacts,[file]);
  await assert.rejects(()=>beginPerformance(root,'../escape',binding),/Invalid check/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('delivery is exact-owner, terminal, immutable and separate from QA verdict',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-delivery-');try{
  const report={format:'athanor-nightly-report/v1',runId:'run-original',identity:{build:'synthetic-test-build'},catalog:{state:'Failed',counts:{Fail:1}},assertionCounts:{NOT_RUN:2}};
  await writeFile(path.join(root,'report.json'),JSON.stringify(report));
  for(const change of [{type:'mpim'},{channelId:'CTEAM'},{user:'UOTHER'},{workspace:'other'},{userId:'UOTHER'}])assert.throws(()=>verifyOwnerRoute({...route,...change}));
  const {intent}=await prepareDelivery(root,route);assert.equal(intent.state,'DELIVERY_PENDING');assert.equal(intent.identity,report.runId);assert.match(intent.message,/Failed/);
  await assert.rejects(()=>prepareDelivery(root,route),/EEXIST/);
  const receipt={intentId:intent.id,state:'DELIVERY_CONFIRMED',route,messageId:'1791659000.123456',messageUrl:'https://story-company.slack.com/archives/DTEST123/p1791659000123456',observation:'Synthetic connector receipt for framework test'};
  for(const change of [{intentId:'other'},{messageId:'missing'},{route:{...route,channelId:'DOTHER'}},{messageUrl:'https://example.test/message'},{messageUrl:receipt.messageUrl+'?token=secret'}])await assert.rejects(()=>recordDelivery(root,{...receipt,...change}));
  await recordDelivery(root,{intentId:intent.id,state:'DELIVERY_UNKNOWN',observation:'Synthetic lost response; inspect before retrying'});
  assert.equal((await inspectDelivery(root)).state,'DELIVERY_UNKNOWN');
  assert.equal((await recordDelivery(root,receipt)).receipt.state,'DELIVERY_CONFIRMED');assert.equal((await recordDelivery(root,receipt)).receipt.messageId,receipt.messageId);assert.equal((await inspectDelivery(root)).history.length,2);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'report.json'),'utf8')),report);
  await assert.rejects(()=>recordDelivery(root,{...receipt,state:'DELIVERY_UNKNOWN'}),/already has/);
  await writeFile(path.join(root,'report.json'),JSON.stringify({...report,runId:'other'}));await assert.rejects(()=>recordDelivery(root,receipt),/Report changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('resource artifacts and receipts cannot satisfy an application-state evidence requirement',()=>{
 const spec={evidence:[{id:'app-state',kind:'json',when:'after',required:true},{id:'operations',kind:'json',when:'during',required:true}]};
 const items=evidenceItems(['computer-use-aaaaaaaaaaaa-performance-D-TEST-fixture.json'],spec),actions=actionHistory([{operation:'performance.collect',status:'Completed'}]);
 assert.equal(actions.length,0);assert.equal(items[0].specId,null);assert.match(items[0].caption,/CPU/);assert.deepEqual(evidenceCoverage(spec,items,actions,'Pass').map(e=>e.status),['Missing','Missing']);
});
