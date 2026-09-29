import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {initializeCheckpoints,checkpoint,saveCheckpoint,checkpointRequest,checkpointOutcome} from '../runner/checkpoints.mjs';
import {recoverInterrupted} from '../runner/store.mjs';
import {initializeCourses,resolveSelection,selectedRecipe,validateRecipe,humanCheckpoint,saveCourse} from '../runner/catalog.mjs';
import {resultSummary,waitForRun} from '../scripts/smoke.mjs';

test('checkpoint selection freezes its contract and requires the explicit desktop runtime',()=>{
 const db=new DatabaseSync(':memory:');initializeCourses(db);
 try{
  const course=saveCourse(db,{id:'human-pilot',revision:0,title:'Human pilot',project:'fresh',groups:[{id:'core',title:'Core',checks:['A-CLI-01']}],checkpoint:humanCheckpoint.id});
  const selection=resolveSelection(db,{courseIds:[course.id]}),recipe=selectedRecipe(selection);validateRecipe(recipe);
  assert.deepEqual(selection.requirements.targets,['packaged','desktop']);assert.equal(selection.requirements.foreground,true);
  assert.equal(recipe.checkpoint.id,humanCheckpoint.id);assert.equal(recipe.cases.length,1,'Human observation is not an accepted automated check');
  assert.throws(()=>resolveSelection(db,{checkIds:['A-CLI-01'],checkpoint:'made-up'}),/Unknown human/);
  assert.throws(()=>selectedRecipe({...selection,checkpoint:{...selection.checkpoint,steps:['Just pass']}}),/definition changed/);
 }finally{db.close();}
});

test('durable checkpoints survive restart, reject stale/duplicate continuation and preserve human failures',()=>{
 const data=mkdtempSync(path.join(tmpdir(),'smoke-checkpoint-')),id='11111111-1111-4111-8111-111111111111',root=path.join(data,'runs',id),file=path.join(data,'smoke.sqlite');mkdirSync(root,{recursive:true});let db=new DatabaseSync(file);
 try{
  db.exec('CREATE TABLE runs(id TEXT PRIMARY KEY);CREATE TABLE executions(run_id TEXT PRIMARY KEY,state TEXT,message TEXT,pid INTEGER,updated_at TEXT,artifact_root TEXT);CREATE TABLE results(run_id TEXT,test_id TEXT,status TEXT);');
  db.prepare('INSERT INTO runs VALUES (?)').run(id);db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?)').run(id,'Waiting for human','Prepared',null,'now',root);initializeCheckpoints(db);
  let c=saveCheckpoint(db,id,{state:'Waiting',definition:humanCheckpoint,observations:[],requests:[],baseline:{clips:['retained']}});
  db.close();db=new DatabaseSync(file);recoverInterrupted(db);assert.equal(checkpoint(db,id).state,'Waiting');assert.deepEqual(checkpoint(db,id).baseline,{clips:['retained']});
  assert.throws(()=>checkpointRequest(db,id,'resume',{revision:c.revision,requestId:'premature'}),/Record a human/);
  const observation={revision:c.revision,requestId:'human-finding',operator:'Synthetic test fixture',outcome:'Fail',note:'Synthetic observation; no runtime acceptance',handsOnSeconds:17,recordedVia:'agent-transcription'};
  c=checkpointRequest(db,id,'observe',observation).checkpoint;
  assert.equal(checkpointRequest(db,id,'observe',observation).reused,true);assert.equal(checkpoint(db,id).observations.length,1);
  assert.throws(()=>checkpointRequest(db,id,'observe',{...observation,note:'Changed'}),/different inputs/);
  assert.throws(()=>checkpointRequest(db,id,'resume',{revision:1,requestId:'stale'}),/changed/);
  const request={revision:c.revision,requestId:'continue-once'};c=checkpointRequest(db,id,'resume',request).checkpoint;
  assert.equal(c.state,'Working');assert.equal(checkpointRequest(db,id,'resume',request).reused,true);
  assert.throws(()=>checkpointRequest(db,id,'resume',{revision:c.revision,requestId:'another'}),/not waiting/);
  recoverInterrupted(db);c=checkpoint(db,id);assert.equal(c.state,'Interrupted');assert.equal(c.verification.status,'Unknown');assert.equal(c.observations[0].outcome,'Fail');
  assert.equal(checkpointRequest(db,id,'resume',request).reused,true,'A lost request cannot replay an interrupted mutation');
  assert.equal(JSON.parse(readFileSync(path.join(root,'checkpoint.json'))).state,'Interrupted');
  assert.equal(checkpointOutcome([{status:'Pass'}],{...c,state:'Completed',verification:{status:'Pass'}}),'Failed','Successful persistence cannot erase human failure');
  assert.equal(checkpointOutcome([{status:'Pass'}],{state:'Completed',verification:{status:'Pass'},observations:[{outcome:'Pass'}]}),'Passed');
  assert.equal(checkpointOutcome([{status:'Pass'}],{state:'Completed',verification:{status:'Unknown'},observations:[{outcome:'Pass'}]}),'Unknown');
 }finally{db.close();rmSync(data,{recursive:true,force:true});}
});

test('agent waiting returns at a human checkpoint without reporting course completion',async()=>{
 const run={id:'paused',execution:{state:'Waiting for human',recipe:{}},checkpoint:{state:'Waiting'},results:[{test_id:'A',snapshot:{title:'Automated setup'},status:'Pass'}]};
 const status=resultSummary(run);assert.equal(status.complete,false);assert.equal(status.needsHuman,true);assert.equal(status.exitCode,4);
 const waited=await waitForRun(async()=>run,'paused',{timeout:1});assert.equal(waited.needsHuman,true);assert.equal(waited.waitTimedOut,undefined);
});
