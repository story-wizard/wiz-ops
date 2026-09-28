import test from 'node:test';
import assert from 'node:assert/strict';
import {cpuSeconds,idleSummary} from '../desktop/check-idle.mjs';
test('idle CPU distinguishes quiet, sustained and burst workloads and rejects incomplete evidence',()=>{
 assert.equal(cpuSeconds('02:03.50'),123.5);assert.equal(cpuSeconds('01:02:03'),3723);assert.equal(cpuSeconds('1-01:02:03'),90123);
 assert.throws(()=>cpuSeconds('00:80.00'),/Invalid/);
 const samples=(cpu)=>{let used=0;return Array.from({length:121},(_,i)=>{if(i)used+=cpu(i)*5/100;return {elapsedSeconds:i*5,cpuSeconds:used,rssKiB:1024};});};
 const quiet=samples(()=>1);assert.equal(idleSummary(quiet).pass,true);
 assert.equal(idleSummary(samples(()=>3)).pass,false);
 const burst=idleSummary(samples(i=>i>60&&i%10===0?10:0));assert.ok(burst.meanCpuPercent<2);assert.equal(burst.p95CpuPercent,10);assert.equal(burst.pass,false);
 assert.throws(()=>idleSummary(quiet.slice(0,100)),/incomplete/);
 assert.throws(()=>idleSummary(quiet.filter((_,i)=>i<70||i>80)),/gap/);
 const reset=samples(()=>1);reset[70].cpuSeconds=0;assert.throws(()=>idleSummary(reset),/Invalid process/);
});
