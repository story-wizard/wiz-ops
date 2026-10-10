import test from 'node:test';
import assert from 'node:assert/strict';
import {workerRun,checkWorkerProfile} from '../runner/worker.mjs';

const request={planHash:'a'.repeat(64),requestId:'request-1',operator:'Tester'};
test('managed dispatch returns the existing run when busy and leaves admission atomic in the runner',async()=>{
 const calls=[],call=async(route,body)=>{calls.push({route,body});return route==='/api/worker'?{active:{run_id:'existing',url:'http://127.0.0.1:4317/#run/existing'}}:{runId:'new'};};
 const result=await workerRun(call,request);assert.equal(result.state,'Busy');assert.equal(result.runId,'existing');assert.deepEqual(calls.map(c=>c.route),['/api/worker']);
 for(const state of [{preparing:true},{ownedSessions:[{}]},{activeDesktopJobs:[{}]}]){
  let inputs=0;assert.equal((await workerRun(async route=>{if(route!=='/api/worker')inputs++;return {ownedSessions:[],activeDesktopJobs:[],...state};},request)).state,'Busy');assert.equal(inputs,0);
 }
 const seen=[];const admitted=await workerRun(async(route,body)=>{seen.push({route,body});return route==='/api/worker'?{ownedSessions:[],activeDesktopJobs:[]}:{runId:'new',reused:true};},request);
 assert.equal(admitted.runId,'new');assert.deepEqual(seen[1].body,request);assert.equal(seen[1].route,'/api/runner/start');
});
test('malformed worker profiles and dispatches fail before requests or GUI input',async()=>{
 for(const change of [{planHash:'HEAD'},{requestId:'../../escape'},{operator:''}])await assert.rejects(()=>workerRun(async()=>{throw Error('Must not call');},{...request,...change}),/Supply/);
 const profile={format:'athanor-worker/v1',name:'Athanor MBP',dataDir:'/private/tmp/athanor-worker-fixture',port:4317,sourceHash:'a'.repeat(64),runnerHash:'b'.repeat(64)};
 for(const change of [{format:'wrong'},{name:''},{port:0},{sourceHash:'HEAD'},{dataDir:undefined},{dataDir:'relative'}])await assert.rejects(()=>checkWorkerProfile({...profile,...change}),/Invalid/);
 await assert.rejects(()=>checkWorkerProfile(profile),/Worker source changed/);
});
