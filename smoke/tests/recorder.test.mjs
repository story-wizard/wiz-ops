import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingOptions,verifyPlaybackRecording} from '../desktop/recorder.mjs';
import {validateToolParams} from '../desktop/agent-proof.mjs';
import {withAdapterAction} from '../desktop/agent-proof.mjs';
import {agentReadOperations} from '../desktop/adapter.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('transport observation remains available after an uncertain edit without changing the attempt',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-recorder-read-')),file=path.join(root,'session.json');
 const session={root,agentTracking:true,agentUncertain:true,agentRevision:7};await writeFile(file,JSON.stringify(session));
 try{
  const mutating=!agentReadOperations.includes('playback.query_transport');
  assert.equal(await withAdapterAction(file,mutating,'playback.query_transport',{},async()=> 'observed'),'observed');
  await assert.rejects(()=>withAdapterAction(file,true,'playback.seek',{},async()=> 'dispatched'),e=>e.code==='mutation_unknown');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('timed recording rejects unbounded sample budgets and caller-assigned outputs',()=>{
 assert.deepEqual(recordingOptions(),{durationMs:12000,intervalMs:1000,maxSamples:8});
 for(const options of [{durationMs:0},{durationMs:60001},{durationMs:NaN},{intervalMs:499},{intervalMs:10001},{maxSamples:2},{maxSamples:33},{output:'/tmp/unowned.mp4'}])assert.throws(()=>recordingOptions(options));
 validateToolParams('recording',{target:'preview',timelineTarget:'canvas',timelineId:'timeline',durationMs:10000,maxSamples:4});assert.throws(()=>validateToolParams('recording',{output:'/tmp/unowned.mp4'}));
});
const fixture=()=>({complete:true,binding:{pid:12,started:'owned'},totalObservationCostMs:30,samples:Array.from({length:4},(_,i)=>({startedAt:i*100,finishedAt:i*100+10,transportBefore:{playing:true,frame:i*24},transportAfter:{playing:true,frame:i*24+1},resources:{cpuSeconds:10+i,rssKiB:1024},image:{pid:12,started:'owned',sampleWidth:64,sampleHeight:32,capture:{frameStatus:'complete',requestedTick:10+i*10,displayedTick:11+i*10},sampleRgb:Buffer.alloc(6144,60+i*20).toString('base64')}}))});
test('playback evidence requires fresh owned frames, advancing transport and evolving pixels',()=>{
 assert.equal(verifyPlaybackRecording(fixture()).evolving,3);
 for(const breakEvidence of [r=>r.complete=false,r=>r.samples.length=2,r=>r.samples[1].image.pid=99,r=>r.samples[1].image.started='other',r=>r.samples[1].image.capture.displayedTick=0,r=>r.samples[1].transportAfter.playing=false,r=>r.samples[1].transportBefore.frame=0,r=>r.samples[2].resources.cpuSeconds=0,r=>r.samples.forEach(x=>x.image.sampleRgb=Buffer.alloc(6144,60).toString('base64')),r=>r.samples[1].image.sampleRgb=Buffer.alloc(6144).toString('base64')]){const recording=fixture();breakEvidence(recording);assert.throws(()=>verifyPlaybackRecording(recording));}
});
test('a background workload must overlap complete playback samples, not just dispatch time',()=>{
 assert.equal(verifyPlaybackRecording(fixture(),{overlap:{startedAt:0,finishedAt:310}}).overlappingSamples,4);
 for(const overlap of [{startedAt:10,finishedAt:100},{startedAt:400,finishedAt:500},{startedAt:10,finishedAt:10}])assert.throws(()=>verifyPlaybackRecording(fixture(),{overlap}));
});
