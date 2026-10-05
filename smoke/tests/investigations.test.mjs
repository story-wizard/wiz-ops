import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {initializeInvestigations,investigation,investigationList,createInvestigation,triageInvestigation,linkReproduction,reproSelection,bugDraft,reviewDraft,exportInvestigation,diagnosticCaptures,readInvestigationFile,previewTriage,editBugDraft,investigationTask,investigationEvidence,readInvestigationArtifact,recordRepro,updateRepro,reconcileRepros,closeRepro,verifyReviewEvidence,caseNextAction} from '../investigations.mjs';
import {initializeCourses,resolveSelection,selectedRecipe,validateRecipe} from '../runner/catalog.mjs';
import {dataDirectory,digest,writeJSON,sha} from '../runner/files.mjs';
import {captureInvestigation} from '../desktop/check-support.mjs';

async function fixture(data,{status='Fail',packageHash='a'.repeat(64),diagnostics=false,desktop=false,steps=['Import the fixture clip','Apply the colour change','Compare the rendered pixels']}={}){
 const id=randomUUID(),root=path.join(data,'runs',id);await mkdir(path.join(root,'media'),{recursive:true});
 const recipe={id:'fixture',revision:1,target:'Test only',cases:['A-CO-01','A-CO-02'].map(id=>({id,...(desktop?{target:'desktop'}:{}),expected:'Expected pixel change',steps,operations:['render.frame']})),selection:{qualificationIds:[],...(diagnostics?{diagnostics:'investigation'}:{})}};
 const fixtureContent={files:[]},fixtures={...fixtureContent,sha256:digest(fixtureContent)},content={app:'/fake/Wizard.app',version:'Synthetic regression fixture',packageHash,fixtureHash:fixtures.sha256,courseHash:digest(recipe),runnerHash:'b'.repeat(64)},plan={...content,planHash:digest(content)};
 const results=recipe.cases.map(c=>({test_id:c.id,status,note:'Unexpected unchanged pixels',snapshot:{title:c.id,area:'Colour'}})),run={id,name:'Fixture run',operator:'Framework test',created_at:'2026-10-02',execution:{state:status==='Pass'?'Passed':'Failed',artifact_root:root,package:plan,plan_hash:plan.planHash,recipe,updated_at:'2026-10-02'},results};
 for(const [file,value] of Object.entries({'plan.json':plan,'course.json':recipe,'report.json':{runId:id,state:run.execution.state,planHash:plan.planHash,results:results.map(r=>({id:r.test_id,status:r.status,note:r.note}))},'media/manifest.json':fixtures,'scope.json':{sourceRows:[]},'execution-context.json':{runnerHash:plan.runnerHash}}))await writeJSON(path.join(root,file),value);
 await writeFile(path.join(root,'operations.jsonl'),recipe.cases.map(c=>JSON.stringify({caseId:c.id,operation:'render.frame'})).join('\n')+'\n');return run;
}
test('investigation preserves first results, groups hypotheses, links build-bound attempts and requires diagnostic human review',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-investigation-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);initializeCourses(db);
 try{
  const first=await fixture(data),original=JSON.stringify(first),record=await createInvestigation(db,first,data,{actor:'Test agent',title:'Review <img src=x onerror=bad()>'});
  assert.equal(record.cases.length,2);assert.equal(record.cases[0].classification,'Unresolved');assert.throws(()=>reproSelection(record),/Mark at least/);
  const updates=record.cases.map((c,i)=>({id:c.id,classification:'App',disposition:'Reproduce',reason:'Captured pixels remained unchanged',duplicateOf:i?record.cases[0].id:null}));
  let current=triageInvestigation(db,record.id,{revision:1,actor:'Test agent',updates,log:'Compared render responses'});
  assert.throws(()=>triageInvestigation(db,record.id,{revision:1,actor:'Test agent',updates}),/changed/);
  assert.throws(()=>triageInvestigation(db,record.id,{revision:2,actor:'Test agent',updates:[{...updates[0],duplicateOf:updates[1].id}]}),/cycles/);
  const selection=reproSelection(current);assert.deepEqual(selection.checkIds,['A-CO-01']);assert.equal(selection.diagnostics,'investigation');
  const resolved=resolveSelection(db,selection);assert.equal(resolved.diagnostics,'investigation');validateRecipe(selectedRecipe(resolved));assert.ok(resolved.addedPrerequisites.some(c=>c.id==='A-CLI-01'));
  assert.throws(()=>resolveSelection(db,{...selection,diagnostics:'anything'}),/profile/);
  assert.equal(bugDraft(current,current.cases[0]).state,'Needs work');
  await assert.rejects(()=>linkReproduction(db,current.id,first,data,{revision:2,actor:'Test',runId:first.id}),/original run/);
  const wrong=await fixture(data,{packageHash:'f'.repeat(64)});await assert.rejects(()=>linkReproduction(db,current.id,wrong,data,{revision:2,actor:'Test',runId:wrong.id}),/different build/);
  const baseline=await fixture(data);current=await linkReproduction(db,current.id,baseline,data,{revision:2,actor:'Test',runId:baseline.id});
  assert.equal(bugDraft(current,current.cases[0]).nextAction,'Run the diagnostic repro course');
  assert.throws(()=>reviewDraft(db,current.id,{revision:3,actor:'Person',caseId:'A-CO-01',decision:'Confirmed',note:'Observed'}),/Complete diagnostic/);
  const repro=await fixture(data,{diagnostics:true,steps:['Import the fixture clip','Apply the colour change','Save, reopen and compare pixels']});current=await linkReproduction(db,current.id,repro,data,{revision:3,actor:'Test',runId:repro.id});
  const listing=investigationList(db,repro.id);assert.equal(listing.length,1,'A focused repro returns its original investigation');assert.equal(listing[0].runId,first.id);assert.deepEqual(listing[0].relatedRunIds,[first.id,baseline.id,repro.id]);assert.equal(listing[0].needsReviewCount,1,'Duplicate cases do not inflate review counts');assert.equal(listing[0].needsReproCount,0);assert.equal(investigationList(db,wrong.id).length,0);assert.equal(bugDraft(current,current.cases[0]).state,'Draft');assert.match(bugDraft(current,current.cases[0]).body,/1\. Import the fixture clip\n2\. Apply the colour change\n3\. Save, reopen and compare pixels/);assert.equal(current.cases[0].attempts.at(-1).definitionChanged,true);
  const packed=await exportInvestigation(db,current.id,data);assert.equal(packed.drafts.length,1);assert.match(packed.prompt,/Harness, Environment, App or Unresolved/);assert.match(await readFile(path.join(packed.path,'START-HERE.md'),'utf8'),/A person reviews/);
  const viewer=await readFile(path.join(packed.path,'index.html'),'utf8');assert.match(viewer,/Investigation review/);assert.match(viewer,/&lt;img src=x onerror=bad\(\)&gt;/);assert.ok(!viewer.includes('<img src=x onerror=bad()>'));assert.match(viewer,/Reproduction steps/);assert.match(viewer,/First run/);assert.match(viewer,/Awaiting human review/);assert.match(viewer,/data:image\/jpeg;base64,/);
  assert.equal(await readFile(path.join(packed.path,packed.drafts[0].file),'utf8'),packed.drafts[0].body+'\n');
  assert.ok(packed.url.endsWith('/index.html'));assert.equal((await readInvestigationFile(data,path.basename(packed.path),'index.html')).toString(),viewer);
  await assert.rejects(()=>readInvestigationFile(data,path.basename(packed.path),'../smoke.sqlite'),/Invalid/);await assert.rejects(()=>readInvestigationFile(data,path.basename(packed.path),'missing.txt'),/inventory/);
  const manifest=JSON.parse(await readFile(packed.manifest,'utf8'));for(const [file,bytes,hash]of manifest.inventory){assert.equal((await readFile(path.join(packed.path,file))).length,bytes);assert.equal(await sha(path.join(packed.path,file)),hash);}
  assert.equal((await exportInvestigation(db,current.id,data)).path,packed.path);
  const needs=reviewDraft(db,current.id,{revision:4,actor:'Actual reviewer',caseId:'A-CO-01',decision:'Needs work',note:'Review the independent state proof'});assert.equal(bugDraft(needs,needs.cases[0]).state,'Needs work');
  current=reviewDraft(db,current.id,{revision:5,actor:'Actual reviewer',caseId:'A-CO-01',decision:'Confirmed',note:'Reviewed steps and render evidence'});
  assert.equal(bugDraft(current,current.cases[0]).state,'Confirmed for submission');assert.equal(investigationList(db,repro.id)[0].needsReviewCount,0);assert.equal(investigationList(db,repro.id)[0].confirmedCount,1);assert.equal(current.history.at(-1).action,'Human review');assert.equal(JSON.stringify(first),original,'Triage never edits original run results');
  assert.equal(investigation(db,current.id).cases[0].original.status,'Fail');
  const fixed=await fixture(data,{status:'Pass',diagnostics:true});current=await linkReproduction(db,current.id,fixed,data,{revision:6,actor:'Test',runId:fixed.id});assert.equal(current.cases[0].review,null);assert.equal(bugDraft(current,current.cases[0]).state,'Needs work');
  await assert.rejects(()=>createInvestigation(db,fixed,data,{actor:'Test'}),/no outcomes/);
  await assert.rejects(()=>linkReproduction(db,current.id,fixed,data,{revision:7,actor:'Test',runId:fixed.id}),/already linked/);
  const reportFile=path.join(path.dirname(current.cases[0].attempts[0].reportPath),'report.json');await writeFile(reportFile,'{}');await assert.rejects(()=>exportInvestigation(db,current.id,data),/report changed/);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});
test('diagnostic capture is opt-in, retains collected files, and records collection failures without rewriting the verdict',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-diagnostic-'))),file=path.join(root,'session.json');let calls=0;
 try{
  const session={root,pid:123,generation:2,state:'Running',plan:{recipe:{selection:{}}}};await writeJSON(file,session);
  const capture=async(file,directory)=>{calls++;await mkdir(directory,{recursive:true});for(const name of ['state.json','window.png','stdout.log','stderr.log'])await writeFile(path.join(directory,name),'fixture');};
  assert.equal(await captureInvestigation(file,'D-TEST','before',capture),null);assert.equal(calls,0);
  session.plan.recipe.selection.diagnostics='investigation';await writeJSON(file,session);
  const kept=await captureInvestigation(file,'D-TEST','before',capture);assert.equal(kept.error,null);assert.equal(kept.artifacts.length,4);assert.equal(JSON.parse(await readFile(kept.manifest)).generation,2);assert.equal(calls,1);
  const failed=await captureInvestigation(file,'D-TEST','after',async()=>{throw Error('Owned window absent');});assert.match(failed.error,/Owned window absent/);
  assert.equal(JSON.parse(await readFile(failed.manifest)).status,'Collection incomplete');assert.equal(failed.artifacts.length,0);
  const journal=(await readFile(path.join(root,'operations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(journal.length,2);assert.equal(journal[0].phase,'before');assert.equal(journal[0].generation,2);assert.ok(Date.parse(journal[0].at));assert.equal(journal[1].status,'Incomplete');assert.equal(journal[1].caseId,'D-TEST');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('requesting diagnostics without both successful case-bound captures cannot qualify a desktop draft',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-diagnostic-proof-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  const first=await fixture(data,{desktop:true}),created=await createInvestigation(db,first,data,{actor:'Framework test'});
  let current=triageInvestigation(db,created.id,{revision:1,actor:'Agent',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Independent state mismatch'}]});
  const repro=await fixture(data,{diagnostics:true,desktop:true});current=await linkReproduction(db,current.id,repro,data,{revision:2,actor:'Agent',runId:repro.id});
  assert.equal(current.cases[0].attempts[0].diagnosticComplete,false);assert.equal(bugDraft(current,current.cases[0]).nextAction,'Complete the required diagnostic captures');
  assert.throws(()=>reviewDraft(db,current.id,{revision:3,actor:'Person',caseId:'A-CO-01',decision:'Confirmed',note:'Ready'}),/Complete diagnostic/);
  const complete=await fixture(data,{diagnostics:true,desktop:true}),root=complete.execution.artifact_root;
  const manifests=[];for(const phase of ['before','after']){const directory=path.join(root,'evidence',phase);await mkdir(directory,{recursive:true});const artifacts=[];for(const name of ['state.json','window.png','stdout.txt','stderr.txt']){const artifact=path.join(directory,name);await writeFile(artifact,'synthetic capture');artifacts.push(artifact);}const file=path.join(root,'diagnostic-'+randomUUID()+'.json');await writeJSON(file,{profile:'investigation',id:'A-CO-01',phase,status:'Collected',pid:123,generation:1,artifacts,files:await Promise.all(artifacts.map(async file=>({path:file,sha256:await sha(file)})))});manifests.push(file,...artifacts);}
  await writeFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:'A-CO-01',operation:'diagnostic.capture',evidence:{artifacts:manifests}})+'\n');
  current=await linkReproduction(db,current.id,complete,data,{revision:3,actor:'Agent',runId:complete.id});assert.equal(current.cases[0].attempts.at(-1).diagnosticComplete,true);
  const pack=await exportInvestigation(db,current.id,data),artifact=JSON.parse(await readFile(path.join(path.dirname(current.cases[0].attempts.at(-1).reportPath),'report.json'),'utf8')).artifacts.find(a=>a.file.includes('diagnostic-'));
  const original=path.join(path.dirname(current.cases[0].attempts.at(-1).reportPath),'evidence',artifact.file);await writeFile(original,'changed');await assert.rejects(()=>exportInvestigation(db,current.id,data),/artifact changed/);assert.ok(pack.path);
  const review=JSON.parse(await readFile(path.join(pack.path,'review-data.json'))).find(r=>r.caseId==='A-CO-01'&&r.runId===complete.id);assert.equal(review.captures.length,2);assert.ok(review.captures.every(c=>c.complete));
  const page=await readFile(path.join(pack.path,'index.html'),'utf8');assert.match(page,/Before the check/);assert.match(page,/After the check/);assert.match(page,/Application error log/);
  await writeFile(path.join(pack.path,pack.drafts[0].file),'changed');await assert.rejects(()=>readInvestigationFile(data,path.basename(pack.path),pack.drafts[0].file),/file changed/);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('capture attachment identity cannot be satisfied by same-named files or another case',()=>{
 const root='/retained/run',file='diagnostic-11111111-1111-4111-8111-111111111111.json',names=['state.json','window.png','stdout.txt','stderr.txt'];
 const manifest={id:'CHECK',phase:'before',profile:'investigation',status:'Collected',pid:123,generation:1,artifacts:names.map(n=>root+'/before/'+n),files:names.map(n=>({path:root+'/before/'+n,sha256:'a'.repeat(64)}))};
 const report={artifacts:names.map(n=>({file:n,source:'other/'+n,sha256:'a'.repeat(64)}))},item={id:'CHECK',evidence:[file,...names].map(file=>({file}))},buffers={[file]:JSON.stringify(manifest)};
 assert.equal(diagnosticCaptures(item,report,buffers,root)[0].complete,false,'Same bytes with unretained paths do not qualify a capture');
 for(const a of report.artifacts)a.sources=['before/'+a.file];
 assert.equal(diagnosticCaptures(item,report,buffers,root)[0].complete,true,'Verified deduplicated source aliases retain identity');
 assert.equal(diagnosticCaptures({...item,evidence:[{file}]},report,buffers,root)[0].complete,false,'Another case cannot supply the attachments');
 buffers[file]=JSON.stringify({...manifest,generation:null});assert.equal(diagnosticCaptures(item,report,buffers,root)[0].complete,false,'Missing generation cannot establish a process-bound capture');
 buffers[file]=JSON.stringify({...manifest,id:'OTHER'});assert.deepEqual(diagnosticCaptures(item,report,buffers,root),[]);
});

test('before and after from different editor processes cannot qualify a draft',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-capture-pair-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  const first=await fixture(data,{desktop:true}),created=await createInvestigation(db,first,data,{actor:'Test'});
  const current=triageInvestigation(db,created.id,{revision:1,actor:'Test',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Observed mismatch'}]});
  const repro=await fixture(data,{desktop:true,diagnostics:true}),root=repro.execution.artifact_root,manifests=[];
  for(const [i,phase]of ['before','after'].entries()){
   const dir=path.join(root,phase);await mkdir(dir);const artifacts=[];
   for(const name of ['state.json','window.png','stdout.txt','stderr.txt']){const file=path.join(dir,name);await writeFile(file,phase+' '+name);artifacts.push(file);}
   const file=path.join(root,'diagnostic-'+randomUUID()+'.json');await writeJSON(file,{id:'A-CO-01',profile:'investigation',phase,pid:123+i,generation:1,status:'Collected',artifacts,files:await Promise.all(artifacts.map(async path=>({path,sha256:await sha(path)})))});manifests.push(file,...artifacts);
  }
  await writeFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:'A-CO-01',operation:'diagnostic.capture',evidence:{artifacts:manifests}})+'\n');
  const linked=await linkReproduction(db,current.id,repro,data,{revision:2,actor:'Test',runId:repro.id});assert.equal(linked.cases[0].attempts[0].diagnosticComplete,false);assert.equal(bugDraft(linked,linked.cases[0]).ready,false);const legacy=structuredClone(linked);legacy.cases[0].attempts[0].diagnosticComplete=true;legacy.cases[0].attempts[0].gaps=[];await assert.rejects(()=>verifyReviewEvidence(legacy,'A-CO-01',data),/verified diagnostic captures/,'A cached old assessment cannot bypass current process-pair verification');
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('agent proposal preview is read-only, validated and revision-bound before application',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-proposal-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  const r=await createInvestigation(db,await fixture(data),data,{actor:'Test'}),original=JSON.stringify(r),input={revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'Harness',disposition:'Reproduce',reason:'Receipt shows the wrong assertion, not a pixel defect'}],log:'Compared receipts'};
  const packet=investigationTask(r,{task:'triage',caseId:'A-CO-01'});assert.deepEqual(packet.caseIds,['A-CO-01']);assert.equal(packet.build.packageHash,r.baseline.identities.packageHash);assert.match(packet.prompt,/do not apply it/i);assert.throws(()=>investigationTask(r,{task:'submit'}),/Unknown/);
  const preview=previewTriage(r,input);assert.equal(preview.changes[0].before.classification,'Unresolved');assert.equal(preview.changes[0].after.classification,'Harness');assert.equal(JSON.stringify(investigation(db,r.id)),original);
  assert.throws(()=>previewTriage(r,{...input,submit:true}),/field/);assert.throws(()=>previewTriage(r,{...input,updates:[{...input.updates[0],duplicateOf:'OUTSIDE'}]}),/outside/);
  const saved=triageInvestigation(db,r.id,input);assert.equal(saved.cases[0].classification,'Harness');assert.equal(saved.history.at(-1).log,'Compared receipts');assert.doesNotThrow(()=>resolveSelection(db,reproSelection({...saved,title:'A'.repeat(200)})),'A valid long investigation title must still allow diagnostic preparation');assert.throws(()=>previewTriage(saved,input),/changed/);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('draft edits reach exported parcels, clear review and need renewed review after a new attempt',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-draft-edit-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  let r=await createInvestigation(db,await fixture(data),data,{actor:'Test'});r=triageInvestigation(db,r.id,{revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Pixels differ from the independent expectation'}]});
  const repro=await fixture(data,{diagnostics:true});r=await linkReproduction(db,r.id,repro,data,{revision:r.revision,actor:'Agent',runId:repro.id});r=reviewDraft(db,r.id,{revision:r.revision,actor:'Human',caseId:'A-CO-01',decision:'Confirmed',note:'Inspected the pixels'});
  const fields={summary:'Colour remains unchanged after Save',reproduction_steps:'1. Open the retained fixture\n2. Change the saturation\n3. Save and inspect the output',expected_result:'The output should change'};
  r=editBugDraft(db,r.id,{revision:r.revision,actor:'Editor',caseId:'A-CO-01',fields});assert.equal(r.cases[0].review,null);assert.equal(bugDraft(r,r.cases[0]).fields.summary,fields.summary);assert.equal(r.cases[0].original.status,'Fail');
  const pack=await exportInvestigation(db,r.id,data),parcel=JSON.parse(await readFile(path.join(pack.path,pack.parcels[0].path)));assert.equal(parcel.fields.summary,fields.summary);assert.match(parcel.fields.reproduction_steps,/Change the saturation/);assert.equal(parcel.delivery,'not_submitted');assert.equal(parcel.readyForSubmission,false);assert.ok((await readFile(path.join(pack.path,'tasks/repair.json'),'utf8')).includes('athanor-investigation-task/v1'));
  const next=await fixture(data,{diagnostics:true});r=await linkReproduction(db,r.id,next,data,{revision:r.revision,actor:'Agent',runId:next.id});const stale=bugDraft(r,r.cases[0]);assert.equal(stale.staleEdits,true);assert.equal(stale.ready,false);assert.deepEqual(stale.previousEdits.fields,fields);assert.notEqual(stale.fields.summary,fields.summary);
  assert.throws(()=>reviewDraft(db,r.id,{revision:r.revision,actor:'Human',caseId:'A-CO-01',decision:'Confirmed',note:'Inspected'}),/Complete diagnostic/);
  r=editBugDraft(db,r.id,{revision:r.revision,actor:'Editor',caseId:'A-CO-01',fields});assert.equal(bugDraft(r,r.cases[0]).staleEdits,false);assert.equal(bugDraft(r,r.cases[0]).ready,true);
  r=editBugDraft(db,r.id,{revision:r.revision,actor:'Editor',caseId:'A-CO-01',fields:{...fields,reproduction_steps:'x'.repeat(16000)}});assert.equal(bugDraft(r,r.cases[0]).ready,false,'Formatted reporter context also counts toward field limits');assert.equal(caseNextAction(r,r.cases[0]).action,'draft','A wording problem must open the editor rather than suggest another repro');
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('repro intent survives restart and a lost response recovers its original selection and request',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-intent-'))),file=path.join(data,'intent.sqlite');let db=new DatabaseSync(file);initializeInvestigations(db);
 try{
  let r=await createInvestigation(db,await fixture(data),data,{actor:'Test'});r=triageInvestigation(db,r.id,{revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'Harness',disposition:'Reproduce',reason:'Retest repaired assertion'}]});
  const input={revision:r.revision,actor:'Operator',requestId:randomUUID(),app:'/Selected/Wizard.app'},intent=recordRepro(db,r.id,input);db.close();db=new DatabaseSync(file);
  const recovered=recordRepro(db,r.id,input);assert.equal(recovered.reused,true);assert.equal(recovered.repro.id,intent.repro.id);assert.equal(recovered.record.repros.length,1);assert.equal(recovered.repro.selection.diagnostics,'investigation');assert.deepEqual(recovered.repro.selection.checkIds,['A-CO-01']);
  assert.throws(()=>recordRepro(db,r.id,{...input,app:'/Different.app'}),/different inputs/);assert.throws(()=>recordRepro(db,r.id,{...input,revision:recovered.record.revision,requestId:randomUUID()}),/existing repro/);
  const wrong=await reconcileRepros(db,r.id,data,{preparation:async()=>({id:intent.repro.preparationId,app:intent.repro.app,state:'Ready',packageHash:'f'.repeat(64),planHash:'wrong'}),request:()=>null,getRun:()=>null});assert.equal(wrong.repros[0].state,'Failed');assert.match(wrong.repros[0].error,/differs/);
  const closed=closeRepro(db,r.id,{revision:wrong.revision,actor:'Operator',reproId:intent.repro.id});assert.equal(closed.repros[0].state,'Closed');assert.equal(closed.repros[0].preparationId,intent.repro.preparationId);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('repro recovery binds original admission, links once and retains passing or blocked outcomes',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-repro-recovery-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  let r=await createInvestigation(db,await fixture(data),data,{actor:'Test'});r=triageInvestigation(db,r.id,{revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Inspect independent output'}]});
  for(const status of ['Pass','Blocked','Unknown']){
   const input={revision:r.revision,actor:'Operator',requestId:randomUUID(),app:'/Selected/Wizard.app'},intent=recordRepro(db,r.id,input),repro=await fixture(data,{status,diagnostics:true}),planHash='c'.repeat(64);
   r=await reconcileRepros(db,r.id,data,{preparation:async()=>({id:intent.repro.preparationId,app:intent.repro.app,state:'Ready',packageHash:r.baseline.identities.packageHash,planHash}),request:()=>null,getRun:()=>null});assert.equal(r.repros.at(-1).state,'Ready');
   r=updateRepro(db,r.id,intent.repro.id,{state:'Starting'});
   assert.throws(()=>closeRepro(db,r.id,{revision:r.revision,actor:'Operator',reproId:intent.repro.id}),/uncertain/);
   await assert.rejects(()=>reconcileRepros(db,r.id,data,{preparation:async()=>null,request:()=>({run_id:repro.id,plan_hash:planHash,operator:'Other'}),getRun:()=>repro}),/differs/);
   const services={preparation:async()=>null,request:()=>({run_id:repro.id,plan_hash:planHash,operator:'Operator'}),getRun:()=>repro},terminalState=repro.execution.state;repro.execution.state='Running';r=await reconcileRepros(db,r.id,data,services);assert.equal(r.repros.at(-1).state,'Running');assert.equal(investigationList(db,repro.id)[0].id,r.id,'An admitted repro finds its parent before automatic linking');repro.execution.state=terminalState;
   r=await reconcileRepros(db,r.id,data,services);assert.equal(r.repros.at(-1).state,'Linked');assert.equal(r.cases[0].attempts.at(-1).status,status);assert.equal(r.cases[0].original.status,'Fail');
   const revision=r.revision;r=await reconcileRepros(db,r.id,data,services);assert.equal(r.revision,revision);assert.equal(r.cases[0].attempts.filter(a=>a.runId===repro.id).length,1);
  }
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('missing preparation admission is uncertain and is not silently replayed',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-repro-missing-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  let r=await createInvestigation(db,await fixture(data),data,{actor:'Test'});r=triageInvestigation(db,r.id,{revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'Harness',disposition:'Reproduce',reason:'Inspect setup failure'}]});const intent=recordRepro(db,r.id,{revision:r.revision,actor:'Agent',requestId:randomUUID(),app:'/Selected.app'});
  const saved=investigation(db,r.id);saved.repros[0].createdAt='2000-01-01T00:00:00Z';db.prepare('UPDATE investigations SET content=? WHERE id=?').run(JSON.stringify(saved),r.id);let reads=0;
  const services={preparation:async()=>{reads++;throw Object.assign(Error('Absent'),{code:'ENOENT'});},request:()=>null,getRun:()=>null};r=await reconcileRepros(db,r.id,data,services);assert.equal(r.repros[0].state,'Unknown');assert.throws(()=>closeRepro(db,r.id,{revision:r.revision,actor:'Agent',reproId:intent.repro.id}),/uncertain/);await reconcileRepros(db,r.id,data,services);assert.equal(reads,1);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('case evidence rejects foreign attempts, unsafe paths and altered retained bytes',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-case-evidence-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  const run=await fixture(data),root=run.execution.artifact_root,artifacts=['A-CO-01','A-CO-02'].map(id=>({id,file:path.join(root,id+'.json')}));for(const a of artifacts)await writeFile(a.file,JSON.stringify({case:a.id}));await writeFile(path.join(root,'operations.jsonl'),artifacts.map(a=>JSON.stringify({caseId:a.id,operation:'render.frame',evidence:{artifacts:[a.file]}})).join('\n')+'\n');const r=await createInvestigation(db,run,data,{actor:'Test'}),view=await investigationEvidence(r,'A-CO-01',data);assert.equal(view.attempts[0].status,'Fail');assert.deepEqual(view.attempts[0].procedure,['Import the fixture clip','Apply the colour change','Compare the rendered pixels']);assert.equal(view.attempts[0].actions.length,1);
  const proof=view.attempts[0].evidence[0];assert.ok(proof);assert.match(proof.url,/\/api\/investigations\/.*\/artifact/);assert.equal(JSON.parse(await readInvestigationArtifact(r,'A-CO-01',run.id,proof.file,data)).case,'A-CO-01');const other=await investigationEvidence(r,'A-CO-02',data);await assert.rejects(()=>readInvestigationArtifact(r,'A-CO-01',run.id,other.attempts[0].evidence[0].file,data),/not owned/);
  await assert.rejects(()=>readInvestigationArtifact(r,'A-CO-01',randomUUID(),proof.file,data),/not owned/);await assert.rejects(()=>readInvestigationArtifact(r,'A-CO-01',run.id,'../smoke.sqlite',data),/filename/);
  const evidenceRoot=path.join(path.dirname(r.baseline.reportPath),'evidence');await writeFile(path.join(evidenceRoot,proof.file),'altered');await assert.rejects(()=>readInvestigationArtifact(r,'A-CO-01',run.id,proof.file,data),/changed/);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('a foreign or corrupt preparation cannot advance a repro to Ready',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-foreign-preparation-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  let r=await createInvestigation(db,await fixture(data),data,{actor:'Test'});r=triageInvestigation(db,r.id,{revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Inspect mismatched output'}]});const intent=recordRepro(db,r.id,{revision:r.revision,actor:'Operator',requestId:randomUUID(),app:'/Selected.app'});
  r=await reconcileRepros(db,r.id,data,{preparation:async()=>({id:intent.repro.preparationId,app:'/Other.app',state:'Ready',packageHash:r.baseline.identities.packageHash}),request:()=>null,getRun:()=>null});assert.equal(r.repros[0].state,'Unknown');assert.match(r.repros[0].error,/does not match/);assert.equal(r.repros[0].planHash,undefined);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});

test('human confirmation verifies retained repro bytes even after collection originally qualified',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-review-integrity-'))),db=new DatabaseSync(':memory:');initializeInvestigations(db);
 try{
  let r=await createInvestigation(db,await fixture(data),data,{actor:'Test'});r=triageInvestigation(db,r.id,{revision:r.revision,actor:'Agent',updates:[{id:'A-CO-01',classification:'App',disposition:'Reproduce',reason:'Independent state mismatch'}]});const run=await fixture(data,{diagnostics:true});r=await linkReproduction(db,r.id,run,data,{revision:r.revision,actor:'Agent',runId:run.id});
  assert.equal(bugDraft(r,r.cases[0]).ready,true);await verifyReviewEvidence(r,'A-CO-01',data);
  const retained=path.join(path.dirname(r.cases[0].attempts.at(-1).reportPath),'evidence','operations.jsonl');await writeFile(retained,'changed');await assert.rejects(()=>verifyReviewEvidence(r,'A-CO-01',data),/review evidence changed/);assert.equal(investigation(db,r.id).cases[0].review,null);
 }finally{db.close();await rm(data,{recursive:true,force:true});}
});
