import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {recordStep,endCheck} from '../desktop/check-support.mjs';
import {OutcomeError} from '../runner/engine.mjs';
import {writeJSON,readJSON,digest} from '../runner/files.mjs';
import {testSpecification,actionHistory,stepHistory,caseConclusion,compactConclusion,failureDiagnostics,evidenceSpec,evidenceCoverage,evidenceItems,exportAgentContext,agentContext,candidateChecks} from '../test-details.mjs';
import {checkRegistry} from '../runner/catalog.mjs';
import {briefContext} from '../desktop/agent-task.mjs';
import {renderConclusion} from '../public/check-conclusion.js';

test('setup failure identifies the untested behavior and cleanup never becomes its last successful action',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-setup-conclusion-')),file=path.join(root,'session.json');
 try{
  await writeJSON(file,{root,currentCheck:'D-MISSING-MEDIA-LIVE'});
  const spec={steps:[{id:'setup',title:'Create timeline',phase:'prepare'},{id:'remove',title:'Remove media',phase:'execute'},{id:'restore',title:'Restore fixture',phase:'cleanup'}]};
  await assert.rejects(()=>recordStep(file,spec.steps[0],()=>{throw Object.assign(new OutcomeError('Timeline recovery failed'),{diagnostics:{expected:'Created timeline',attempts:1}});}),/recovery failed/);
  await recordStep(file,spec.steps[2],async()=>{});
  const events=(await readFile(root+'/steps.jsonl','utf8')).trim().split('\n').map(JSON.parse),conclusion=caseConclusion({steps:stepHistory(spec,events)});
  assert.equal(conclusion.failedStep.phase,'prepare');assert.equal(conclusion.lastCompletedStep,null);assert.equal(conclusion.notRun[0].id,'remove');assert.equal(conclusion.diagnostics.expected,'Created timeline');
  assert.match(compactConclusion(conclusion).unansweredQuestion,/fixture setup/);
  assert.equal(caseConclusion({steps:[{id:'action',title:'Actual action',status:'Completed',phase:'execute'},{id:'restore',title:'Cleanup',status:'Completed',phase:'cleanup'}]}).lastCompletedStep.id,'action');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('compact guard diagnostics retain ownership and dispatch facts without window titles or full receipts',()=>{
 const value={receipt:{status:'Unknown',code:'pointer_occluded',inputDispatched:true,diagnostics:{point:[20,30],expectedPid:123,expectedWindow:4,occluder:{pid:456,window:9,owner:'Another App',title:'Private document',layer:3,frame:{x:10,y:20,width:100,height:100}},elements:['unrelated']}},ui:{title:'Private'}};
 const safe=failureDiagnostics(value);assert.equal(safe.inputDispatched,true);assert.equal(safe.occluder.pid,456);assert(!JSON.stringify(safe).includes('Private'));assert(!('receipt' in safe));assert.deepEqual(failureDiagnostics(safe),safe);
 const conclusion=caseConclusion({diagnostics:value,steps:[]});assert.match(compactConclusion(conclusion).unansweredQuestion,/Did the input occur/);
 assert.match(renderConclusion(conclusion),/pointer_occluded/);assert.equal(renderConclusion(caseConclusion({steps:[]})),'');
 assert.match(failureDiagnostics({expected:'x'.repeat(5000)}).summary,/exceeds/);
});

test('dependencies explain unreached work and recorded blocks without changing Unknown or inferring app defects',()=>{
 const spec=testSpecification({id:'C',steps:[{id:'identity',title:'Independent generation'},{id:'edit',title:'Edit copy',requires:['identity']},{id:'reopen',title:'Persistence',requires:['edit']}]});
 const history=stepHistory(spec,[{stepId:'identity',status:'Fail'},{stepId:'reopen',status:'Blocked',observation:'No persistence fixture'}]);
 assert.deepEqual(history.map(s=>s.status),['Fail','Not run','Blocked']);assert.match(history[1].reason,/Independent generation \(Fail\)/);assert.match(history[2].reason,/Edit copy \(Not run\)/);
 const summary=caseConclusion({steps:history});assert.equal(summary.failedStep.id,'identity');assert.equal(summary.blocked[0].id,'reopen');assert.match(renderConclusion(summary),/Blocked: Persistence/);
 const unknown=stepHistory(spec,[{stepId:'identity',status:'Unknown'}]);assert.equal(unknown[0].status,'Unknown');assert.match(unknown[1].reason,/Unknown/);
 const unbound=stepHistory(spec,[],[{operation:'project.checkpoint'}]);assert.ok(unbound.every(s=>s.status==='No step record'));assert.ok(unbound.every(s=>!s.reason));
 for(const requires of [['absent'],['edit'],['identity','identity']])assert.throws(()=>testSpecification({id:'C',steps:[{id:'identity',title:'Identity'},{id:'edit',title:'Edit',requires}]}),/dependencies/);
});

test('compact conclusions keep decisive values and proof but leave source excerpts in the immutable evidence',()=>{
 const summary={failedStep:{id:'identity',status:'Fail'},assertions:[{stepId:'identity',title:'Identity',status:'Fail',expected:{distinct:true},actual:{source:'same',copy:'same'},artifact:'proof.json',sources:[{excerpt:'large source'}],invariant:'Copy must be independent.',question:'Which saved reference was reused?',evidenceStatus:'Needs review'}]},before=JSON.stringify(summary),brief=compactConclusion(summary);
 assert.deepEqual(brief.assertions[0].actual,summary.assertions[0].actual);assert.equal(brief.assertions[0].artifact,'proof.json');assert.equal(brief.assertions[0].sources,undefined);assert.equal(brief.unansweredQuestion,summary.assertions[0].question);assert.equal(brief.assertions[0].evidenceStatus,'Needs review');assert.equal(JSON.stringify(summary),before);
 assert.match(renderConclusion(brief),/Copy must be independent/);assert.match(renderConclusion(brief),/Which saved reference/);assert.equal(compactConclusion(null),null);
});

test('recording an existing verification preserves wrong-result values and never downgrades unknown input',async()=>{
 const {recordVerification}=await import('../desktop/check-support.mjs');const root=await mkdtemp(path.join(tmpdir(),'athanor-verification-')),file=path.join(root,'session.json');
 try{
  await writeJSON(file,{root,currentCheck:'CHECK'});const definition={id:'timing',title:'Matching durations'},comparison={invariant:'Durations must agree.',expected:{seconds:3},actual:{seconds:4}};
  let failure;try{await recordVerification(file,definition,comparison,()=>{throw new OutcomeError('Duration mismatch');});}catch(e){failure=e;}
  const proof=await readJSON(failure.evidence.artifacts[0]);assert.equal(proof.status,'Fail');assert.equal(proof.failureReason,'Duration mismatch');assert.deepEqual(proof.actual,comparison.actual);
  await assert.rejects(()=>recordVerification(file,{...definition,id:'unknown'},comparison,async()=>{throw new OutcomeError('Response lost','Unknown');}),e=>e.status==='Unknown');
  const events=(await readFile(path.join(root,'steps.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(!events.some(e=>e.stepId==='unknown'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('conclusion UI shows the same comparison and unreached work while escaping authored text',()=>{
 const summary={failedStep:{title:'<img src=x onerror=bad()>',phase:'verify',status:'Fail'},lastCompletedStep:{title:'Duplicate'},assertions:[{title:'Identity',status:'Fail',expected:{independent:true},actual:{copy:'<script>bad()</script>'},artifact:'proof.json'}],notRun:[{title:'Edit copy'}]};
 const html=renderConclusion(summary,file=>'evidence/'+file);assert.match(html,/Failed assertion/);assert.match(html,/Not reached:.*Edit copy/);assert.match(html,/evidence\/proof.json/);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>bad()'));assert.ok(!html.includes('<img src=x'));assert.equal(renderConclusion(null),'');
});

test('an assertion retains its exact comparison on failure and later steps stay unexecuted',async()=>{
 const {recordAssertion}=await import('../desktop/check-support.mjs');
 const root=await mkdtemp(path.join(tmpdir(),'athanor-assertion-')),file=path.join(root,'session.json');
 const definition={id:'identity',title:'Copy has independent generation state',phase:'verify'},comparison={expected:{independent:true},actual:{source:'gen-one',copy:'gen-one'},sources:[{timelineId:'copy',sha256:'a'.repeat(64),generationIds:['gen-one']}]};
 try{
  await writeJSON(file,{root,currentCheck:'CHECK',pid:123,generation:1});
  let failure;try{await recordAssertion(file,definition,comparison,false);}catch(e){failure=e;}
  assert.equal(failure.status,'Fail');assert.equal(failure.message,definition.title);
  const proof=await readJSON(failure.evidence.artifacts[0]);assert.deepEqual(proof.actual,comparison.actual);assert.deepEqual(proof.sources,comparison.sources);assert.equal(proof.caseId,'CHECK');assert.equal(proof.status,'Fail');
  const events=(await readFile(path.join(root,'steps.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),history=stepHistory({steps:[definition,{id:'edit',title:'Edit copy'}]},events,[]);
  assert.equal(history[0].status,'Fail');assert.deepEqual(history[0].assertion.actual,comparison.actual);assert.equal(history[1].status,'Not run');assert.equal((await readJSON(file)).currentStep,null);
  const passed=await recordAssertion(file,{...definition,id:'different'}, {...comparison,actual:{source:'gen-one',copy:'gen-two'}},true);assert.equal(passed.status,'Pass');assert.notEqual(passed.artifact,proof.artifact);
  await assert.rejects(()=>recordAssertion(file,definition,{expected:'x'.repeat(20000),actual:null},false),/16 KiB/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('recorded agent actions make a step Observed without inventing a completion receipt',()=>{
 const spec={steps:[{id:'edit',title:'Edit'},{id:'verify',title:'Verify'},{id:'unused',title:'Unused'}]},actions=[{stepId:'edit',at:'2026-10-01T10:00:00Z',status:'Completed'}];
 const history=stepHistory(spec,[],actions);assert.deepEqual(history.map(s=>s.status),['Observed','Not run','Not run']);assert.equal(history[0].actionCount,1);assert.equal(history[0].startedAt,actions[0].at);assert.equal(history[0].finishedAt,null);
 assert.equal(stepHistory(spec,[{stepId:'edit',status:'Fail',observation:'Wrong state'}],actions)[0].status,'Fail');
 assert.equal(stepHistory(spec,[{stepId:'edit',status:'Running',at:actions[0].at}],actions)[0].status,'Unknown');
});

test('unbound actions leave step execution unrecorded rather than claiming it did not run',()=>{
 const spec={steps:[{id:'prepare',title:'Prepare'},{id:'verify',title:'Verify'}]},actions=[{stepId:null,status:'Completed'}];
 assert.deepEqual(stepHistory(spec,[],actions).map(s=>s.status),['No step record','No step record']);
 assert.deepEqual(stepHistory(spec,[],[]).map(s=>s.status),['Not run','Not run']);
 assert.deepEqual(stepHistory(spec,[{stepId:'prepare',status:'Fail'}],actions).map(s=>s.status),['Fail','No step record']);
});

test('diagnostic state reads do not hide phases skipped after the MGFX identity failure',()=>{
 const spec={steps:[{id:'identity',title:'Verify independent generation'},{id:'edit',title:'Edit copy'},{id:'reopen',title:'Verify persistence'}]},events=[{stepId:'identity',status:'Fail'}];
 const reads=actionHistory([{operation:'timeline.inspect',stdout:'{"ok":true}'},{operation:'media.list_assets',stdout:'{"ok":true}'},{operation:'diagnostic.capture',status:'Completed'}], [{request:{op:'screenshot'},response:{ok:true}}]);
 assert.deepEqual(stepHistory(spec,events,reads).map(s=>s.status),['Fail','Not run','Not run']);
 const mutation=actionHistory([{operation:'project.checkpoint',stdout:'{"ok":true}'}]);
 assert.deepEqual(stepHistory(spec,events,[...reads,...mutation]).map(s=>s.status),['Fail','No step record','No step record']);
});

test('a settled check releases action attribution while uncertain and later checks keep their context',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-check-scope-')),file=path.join(root,'session.json');
 try{
  for(const status of ['Pass','Fail','Blocked','N/A']){
   await writeJSON(file,{root,currentCheck:'CHECK',currentStep:null});
   await endCheck(file,{id:'CHECK',status});
   const state=await readJSON(file);assert.equal(state.currentCheck,null);
   await assert.rejects(()=>recordStep(file,{id:'edit',title:'Edit copy'},async()=>{}),/active check/);
   const spec={steps:[{id:'identity',title:'Verify identity'},{id:'edit',title:'Edit copy'}]};
   const journal=[{caseId:'CHECK',operation:'timeline.inspect',stdout:'{"ok":true}'},{caseId:state.currentCheck||'desktop-agent',operation:'project.checkpoint',stdout:'{"ok":true}'}];
   assert.deepEqual(stepHistory(spec,[{stepId:'identity',status:'Fail'}],actionHistory(journal.filter(x=>x.caseId==='CHECK'))).map(x=>x.status),['Fail','Not run']);
  }
  await writeJSON(file,{root,currentCheck:'CHECK',currentStep:null});await endCheck(file,{id:'CHECK',status:'Unknown'});assert.equal((await readJSON(file)).currentCheck,'CHECK');
  await writeJSON(file,{root,currentCheck:'NEXT',currentStep:null});await endCheck(file,{id:'CHECK',status:'Fail'});assert.equal((await readJSON(file)).currentCheck,'NEXT');
  const events=(await readFile(path.join(root,'check-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(events.find(e=>e.status==='Unknown').id,'CHECK');
 }finally{await rm(root,{recursive:true,force:true});}
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
 assert.equal(actionHistory([{operation:'worker.export',status:'Rejected',code:1}])[0].status,'Rejected');
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

test('packaged regression state observations satisfy their declared collection phase without substituting input receipts',()=>{
 const spec=testSpecification(checkRegistry().find(c=>c.id==='D-AGENT-HEADER'));
 const coverage=files=>evidenceCoverage(spec,evidenceItems(files,spec),[],'Pass').find(e=>e.id==='observations').status;
 assert.equal(coverage(['D-AGENT-HEADER-3-graph-observations-wide.txt']),'Collected');
 assert.equal(coverage(['D-AGENT-HEADER-1-graph-observations-before.txt']),'Missing');
 assert.equal(coverage(['native-receipt.txt']),'Missing');
});

test('an agent pack snapshots its definition, guides and sources outside Git with a reproducible manifest',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'smoke-agent-pack-'));
 try{
  const check=checkRegistry().find(c=>c.id==='D-TRACK-ADD'),first=await exportAgentContext(check,data,{accepted:check.accepted}),second=await exportAgentContext(check,data,{accepted:check.accepted});assert.equal(first.path,second.path);
  const manifest=await readJSON(first.manifest),context=await readJSON(path.join(first.path,'context.json'));assert.equal(context.check.definitionHash,check.definitionHash);assert.match(context.prompt,/candidate; submit it for lead review/);assert.match(context.commands.plan,/D-CLI-01/);assert.match(context.commands.run,/session.mjs start/);
  const accepted=checkRegistry().find(c=>c.id==='A-CLI-01');assert.match(agentContext(accepted,{accepted:accepted.accepted}).prompt,/changed definition needs lead review/);
  const bound=agentContext(accepted,{accepted:accepted.accepted,servicePort:51290});assert.equal(bound.serviceUrl,'http://127.0.0.1:51290');assert.match(bound.commands.run,/--server http:\/\/127\.0\.0\.1:51290$/);
  const physical=agentContext(checkRegistry().find(c=>c.id==='P-RG-WIRE'),{servicePort:51290});assert.match(physical.commands.plan,/--server http:\/\/127\.0\.0\.1:51290$/);assert.doesNotMatch(physical.commands.run,/--server/,'The direct physical probe does not accept a service option');
  for(const port of [0,65536,'51290 --extra'])assert.throws(()=>agentContext(accepted,{servicePort:port}),/valid local service port/);
  for(const item of manifest.inventory){const bytes=await readFile(path.join(first.path,item.file));assert.equal(bytes.length,item.bytes);assert.equal(digest(bytes.toString()),item.sha256);}
  for(const file of ['docs/functional-testing-agent.md','docs/agent-sequences.md','docs/golden-project-intake.md','docs/agent-tools.md','docs/source-handoff.md','docs/maintaining-harness.md','docs/build-finder.md','docs/shared-build-catalog.md','docs/demo-guide.md','examples/agent-onboarding.txt','docs/build-repair.md','runner/contracts/packaged-schema-qualifications.json','runner/contracts/installed-schema.json'])assert.ok(manifest.inventory.some(x=>x.file==='reference/'+file),file);assert.ok(manifest.inventory.some(x=>x.file==='reference/desktop/check-paths.mjs'));
  const brief=briefContext({session:'/external/session.json',checks:[]});assert.ok(brief.guidance.some(line=>line.includes('docs/functional-testing-agent.md')&&line.includes('script dependencies')));
  const start=await readFile(path.join(first.path,'START-HERE.md'),'utf8');assert.match(start,/Athanor agent context/);assert.match(context.repairPrompt,/independent assertions/);assert.match(context.commands.schemaReview,/--schema --no-spawn$/);assert.equal((await readFile(path.join(first.path,'BUILD-REPAIR-PROMPT.txt'),'utf8')).trim(),context.repairPrompt);assert.match(start,/Build or feature repair/);assert.ok(start.includes(context.commands.run));assert.match(start,/Candidate definitions require lead review/);
 }finally{await rm(data,{recursive:true,force:true});}
});
