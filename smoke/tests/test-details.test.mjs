import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {recordStep} from '../desktop/check-support.mjs';
import {OutcomeError} from '../runner/engine.mjs';
import {writeJSON,readJSON,digest} from '../runner/files.mjs';
import {testSpecification,actionHistory,stepHistory,evidenceSpec,evidenceCoverage,evidenceItems,exportAgentContext,agentContext,candidateChecks} from '../test-details.mjs';
import {checkRegistry} from '../runner/catalog.mjs';

test('recorded agent actions make a step Observed without inventing a completion receipt',()=>{
 const spec={steps:[{id:'edit',title:'Edit'},{id:'verify',title:'Verify'},{id:'unused',title:'Unused'}]},actions=[{stepId:'edit',at:'2026-10-01T10:00:00Z',status:'Completed'}];
 const history=stepHistory(spec,[],actions);assert.deepEqual(history.map(s=>s.status),['Observed','Not run','Not run']);assert.equal(history[0].actionCount,1);assert.equal(history[0].startedAt,actions[0].at);assert.equal(history[0].finishedAt,null);
 assert.equal(stepHistory(spec,[{stepId:'edit',status:'Fail',observation:'Wrong state'}],actions)[0].status,'Fail');
 assert.equal(stepHistory(spec,[{stepId:'edit',status:'Running',at:actions[0].at}],actions)[0].status,'Unknown');
});

test('a lost mutation response stays Unknown, later steps remain unexecuted and receipts belong to the active step',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smoke-steps-')),file=path.join(root,'session.json');
 const check={id:'CHECK',title:'Drop clip',expected:'Correct placement',steps:[{id:'setup',title:'Prepare',phase:'prepare'},{id:'drop',title:'Drag',phase:'execute'},{id:'verify',title:'Inspect',phase:'verify'}]};
 try{
  await writeJSON(file,{root,currentCheck:'CHECK'});await recordStep(file,check.steps[0],async()=>{assert.equal((await readJSON(file)).currentStep,'setup');});
  let calls=0;await assert.rejects(()=>recordStep(file,check.steps[1],async()=>{calls++;throw new OutcomeError('No response','Unknown');}),/No response/);assert.equal(calls,1);
  const events=(await readFile(path.join(root,'steps.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),actions=actionHistory([{caseId:'CHECK',stepId:'drop',operation:'timeline.place_cuts',status:'Unknown',error:'Response lost'}]);
  assert.deepEqual(stepHistory(testSpecification(check),events,actions).map(s=>s.status),['Completed','Unknown','Not run']);assert.equal(stepHistory(check,events,actions)[1].actionCount,1);assert.equal(actions[0].status,'Unknown');assert.equal((await readJSON(file)).currentStep,null);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('evidence collection is independent of verdict and an expected rejection is not a successful edit',()=>{
 const check={id:'CHECK',title:'Edit',expected:'Readback',evidence:[{id:'operations',kind:'json',when:'during',required:true,caption:'State readback'},{id:'preview',kind:'image',when:'after',required:true,caption:'Displayed frame'},{id:'audio',kind:'audio',when:'during',required:false,caption:'Playback audio'}]};
 const spec=testSpecification(check),actions=actionHistory([{operation:'graph.edit',stdout:JSON.stringify({ok:false,error:{code:'stale'}}),expectedError:'stale'}]);
 assert.equal(actions[0].status,'Expected rejection');assert.deepEqual(evidenceCoverage(spec,[],actions).map(e=>e.status),['Collected','Missing','Optional']);
 assert.equal(evidenceCoverage(spec,evidenceItems(['CHECK-before.png'],spec),actions)[1].status,'Missing','A before image cannot satisfy an after capture');
 assert.equal(evidenceCoverage(spec,evidenceItems(['CHECK-after.png'],spec),actions)[1].status,'Collected');
 const graphSpec=testSpecification({...check,evidence:[{id:'graph-state',kind:'json',when:'after',required:true,caption:'Before and after node state'}]});
 assert.equal(evidenceCoverage(graphSpec,evidenceItems(['native-receipt.txt'],graphSpec))[0].status,'Missing','An input receipt cannot replace graph state');
 assert.equal(evidenceCoverage(graphSpec,evidenceItems(['CHECK-graph-observations.txt'],graphSpec,'failure'))[0].status,'Collected','A retained graph snapshot remains after evidence when a later step fails');
 assert.equal(evidenceItems(['CHECK-after.png'],spec,'failure')[0].specId,'preview','A later failure must not relabel a captured result as a failure screen');
 assert.throws(()=>evidenceSpec({...check,evidence:[{id:'escape',kind:'html',when:'after',required:true,caption:'Script'}]}),/Invalid evidence/);
 assert.equal(actionHistory([{operation:'check.observation',status:'Pass'}]).length,0,'A verdict summary cannot stand in for a dispatched operation');
 const manual=testSpecification({...check,steps:['Click the button and inspect the track.']});assert.equal(manual.steps.length,0);assert.deepEqual(manual.procedure,['Click the button and inspect the track.'],'Manual instructions must not be presented as recorded execution steps');
});

test('an agent pack snapshots its definition, guides and sources outside Git with a reproducible manifest',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'smoke-agent-pack-'));
 try{
  const check=checkRegistry().find(c=>c.id==='D-TRACK-ADD'),first=await exportAgentContext(check,data,{accepted:check.accepted}),second=await exportAgentContext(check,data,{accepted:check.accepted});assert.equal(first.path,second.path);
  const manifest=await readJSON(first.manifest),context=await readJSON(path.join(first.path,'context.json'));assert.equal(context.check.definitionHash,check.definitionHash);assert.match(context.prompt,/candidate; submit it for lead review/);assert.match(context.commands.plan,/D-CLI-01/);assert.match(context.commands.run,/session.mjs start/);
  const accepted=checkRegistry().find(c=>c.id==='A-CLI-01');assert.match(agentContext(accepted,{accepted:accepted.accepted}).prompt,/changed definition needs lead review/);
  const bound=agentContext(accepted,{accepted:accepted.accepted,servicePort:51290});assert.equal(bound.serviceUrl,'http://127.0.0.1:51290');assert.match(bound.commands.run,/--server http:\/\/127\.0\.0\.1:51290$/);
  const physical=agentContext(candidateChecks().find(c=>c.id==='P-RG-WIRE'),{servicePort:51290});assert.match(physical.commands.plan,/--server http:\/\/127\.0\.0\.1:51290$/);assert.doesNotMatch(physical.commands.run,/--server/,'The direct physical probe does not accept a service option');
  for(const port of [0,65536,'51290 --extra'])assert.throws(()=>agentContext(accepted,{servicePort:port}),/valid local service port/);
  for(const item of manifest.inventory){const bytes=await readFile(path.join(first.path,item.file));assert.equal(bytes.length,item.bytes);assert.equal(digest(bytes.toString()),item.sha256);}
  for(const file of ['docs/agent-tools.md','docs/source-handoff.md','docs/maintaining-harness.md','docs/build-finder.md','docs/shared-build-catalog.md','docs/demo-guide.md','examples/agent-onboarding.txt','docs/build-repair.md','runner/contracts/packaged-schema-qualifications.json','runner/contracts/installed-schema.json'])assert.ok(manifest.inventory.some(x=>x.file==='reference/'+file),file);assert.ok(manifest.inventory.some(x=>x.file==='reference/desktop/check-paths.mjs'));
  const start=await readFile(path.join(first.path,'START-HERE.md'),'utf8');assert.match(start,/Athanor agent context/);assert.match(context.repairPrompt,/independent assertions/);assert.match(context.commands.schemaReview,/--schema --no-spawn$/);assert.equal((await readFile(path.join(first.path,'BUILD-REPAIR-PROMPT.txt'),'utf8')).trim(),context.repairPrompt);assert.match(start,/Build or feature repair/);assert.ok(start.includes(context.commands.run));assert.match(start,/Candidate definitions require lead review/);
 }finally{await rm(data,{recursive:true,force:true});}
});
