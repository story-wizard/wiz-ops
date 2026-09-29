import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {dataDirectory,digest,writeJSON} from '../runner/files.mjs';
import {localReport,exportLocalReport,renderReport} from '../reports.mjs';
import {startPrepared} from '../scripts/run-packaged.mjs';

test('report retains exact outcomes, detects missing or mismatched evidence and exports without rerunning',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'smoke-report-'))),id='11111111-1111-4111-8111-111111111111',root=path.join(data,'runs',id);
 try{
  await mkdir(path.join(root,'media'),{recursive:true});
  const recipe={id:'test-course',revision:1,target:'Test package only',cases:[{id:'CHECK',sourceId:'SOURCE',expected:'Independent state readback is correct',operations:['project.read']}]};
  const fixtureContent={format:'wizard-smoke-fixtures/v1',version:1,files:[]},fixtures={...fixtureContent,sha256:digest(fixtureContent)};
  const content={app:'/fake/Selected.app',version:'test-only',packageHash:'a'.repeat(64),fixtureHash:fixtures.sha256,courseHash:digest(recipe),runnerHash:'b'.repeat(64)},plan={...content,planHash:digest(content)};
  const results=[{test_id:'CHECK',status:'Pass',note:'Observed expected state',snapshot:{title:'<script>bad()</script>',area:'Project'}}];
  const run={id,title:'test',name:'Report <img src=x>',operator:'Test',created_at:'2026-01-01',execution:{state:'Passed',updated_at:'2026-01-02',artifact_root:root,package:plan,plan_hash:plan.planHash,recipe},results};
  await writeJSON(path.join(root,'plan.json'),plan);await writeJSON(path.join(root,'course.json'),recipe);
  await writeJSON(path.join(root,'report.json'),{runId:id,state:'Passed',planHash:plan.planHash,results:[{id:'CHECK',status:'Pass',note:results[0].note}]});
  await writeJSON(path.join(root,'media/manifest.json'),fixtures);
  await writeJSON(path.join(root,'scope.json'),{id:'test-proposal',status:'Proposed',sourceRows:[{id:'SOURCE',checkIds:['CHECK'],disposition:'Partial',remaining:'UI not exercised'}]});
  await writeJSON(path.join(root,'execution-context.json'),{platform:'test',runnerHash:plan.runnerHash});
  await writeFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:'CHECK',operation:'project.read',durationMs:12})+'\n');
  let {report}=await localReport(run,data);assert.equal(report.acceptance.evidenceStatus,'Ready for review');assert.equal(report.acceptance.scopeAcceptance,'Not assessed');assert.equal(report.scope.sourceRows[0].disposition,'Partial');
  const html=renderReport(report);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Not assessed'));
  const subsetHTML=renderReport({...report,selection:{project:'fresh',requestedIds:['CHECK'],addedPrerequisites:[],notSelected:['OTHER'],groups:[{title:'My <group>',checks:['CHECK']}],courseRevisions:[{id:'custom',revision:2}]}});
  assert.ok(subsetHTML.includes('1 requested checks'));assert.ok(subsetHTML.includes('1 checks not selected'));assert.ok(subsetHTML.includes('My &lt;group&gt;'));assert.ok(subsetHTML.includes('does not claim full Smoke Test acceptance'));
  const first=await exportLocalReport(run,data),second=await exportLocalReport(run,data);assert.equal(first.path,second.path,'Identical report delivery is idempotent');
  assert.equal(JSON.parse(await readFile(path.join(path.dirname(first.path),'report.json'))).cases[0].status,'Pass');
  // A paused course can publish a snapshot; successful automated checks do not supply a human verdict.
  recipe.checkpoint={id:'test-human'};run.execution.state='Waiting for human';
  run.checkpoint={state:'Waiting',definition:{title:'Human playback'},observations:[{operator:'Fixture tester',recordedVia:'agent-transcription',outcome:'Fail',note:'Synthetic <finding>',handsOnSeconds:17}]};
  await writeJSON(path.join(root,'course.json'),recipe);await writeJSON(path.join(root,'checkpoint.json'),run.checkpoint);
  await writeJSON(path.join(root,'report.json'),{runId:id,state:'Waiting for human',planHash:plan.planHash,results:[{id:'CHECK',status:'Pass',note:results[0].note}]});
  report=(await localReport(run,data)).report;
  assert.equal(report.execution.state,'Waiting for human');assert.equal(report.cases[0].status,'Pass');assert.equal(report.checkpoint.observations[0].outcome,'Fail');
  const humanHTML=renderReport(report);assert.match(humanHTML,/Synthetic &lt;finding&gt;/);assert.match(humanHTML,/17 seconds/);assert.match(humanHTML,/Fixture tester/);
  await writeJSON(path.join(root,'checkpoint.json'),{...run.checkpoint,observations:[]});
  report=(await localReport(run,data)).report;assert.ok(report.acceptance.gaps.some(s=>s.includes('Checkpoint artifact differs')));
  delete recipe.checkpoint;delete run.checkpoint;run.execution.state='Passed';
  await writeJSON(path.join(root,'course.json'),recipe);await writeJSON(path.join(root,'report.json'),{runId:id,state:'Passed',planHash:plan.planHash,results:[{id:'CHECK',status:'Pass',note:results[0].note}]});
  await writeFile(path.join(root,'operations.jsonl'),'');
  report=(await localReport(run,data)).report;assert.equal(report.acceptance.evidenceStatus,'Gaps found');assert.equal(report.cases[0].status,'Pass','Do not rewrite the original assertion result');assert.ok(report.acceptance.gaps.some(s=>s.includes('no operation receipts')));
  await writeJSON(path.join(root,'report.json'),{runId:'other',state:'Passed',planHash:plan.planHash,results:[]});
  report=(await localReport(run,data)).report;assert.ok(report.acceptance.gaps.some(s=>s.includes('identity/state')));
  run.execution.state='Running';await assert.rejects(()=>localReport(run,data),/Wait for the run/);
  run.execution.state='Unknown';run.results[0].status='Unknown';
  await rm(root,{recursive:true});report=(await localReport(run,data)).report;
  assert.equal(report.cases[0].status,'Unknown');assert.equal(report.acceptance.evidenceStatus,'Gaps found');assert.match(report.scope.basis,/not frozen/);
 }finally{await rm(data,{recursive:true,force:true});}
});

test('explicit build launch binds to reviewed plan and never retries an uncertain start',async()=>{
 const app=await realpath(await mkdtemp(path.join(tmpdir(),'smoke-selected-app-')));let posts=0,mode='normal';
 const hash='a'.repeat(64);
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET')return res.end(JSON.stringify({prepared:true,plan:{app,planHash:hash,packageHash:'b'.repeat(64)}}));
  posts++;if(mode==='lost'){req.socket.destroy();return;}
  let body='';req.on('data',d=>body+=d);req.on('end',()=>{assert.deepEqual(JSON.parse(body),{planHash:hash,operator:'Tester'});res.end(JSON.stringify({runId:'test-admitted'}));});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  await assert.rejects(()=>startPrepared({app,planHash:'c'.repeat(64),operator:'Tester',base}),/differs/);assert.equal(posts,0);
  const r=await startPrepared({app,planHash:hash,operator:'Tester',base});assert.equal(r.runId,'test-admitted');assert.match(r.execution,/pending/);
  mode='lost';await assert.rejects(()=>startPrepared({app,planHash:hash,operator:'Tester',base}),/outcome unknown/);assert.equal(posts,2);
  await assert.rejects(()=>startPrepared({app,planHash:hash,operator:'Tester',base:'https://example.com'}),/loopback/);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(app,{recursive:true,force:true});}
});
