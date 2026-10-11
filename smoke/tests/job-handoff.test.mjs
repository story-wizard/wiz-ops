import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {JobStore} from '../runner/jobs.mjs';
import {digest} from '../runner/files.mjs';
import {jobResultBrief,jobRecovery,readJobBrief,readJobReport,retainInvestigationHandoff} from '../runner/job-handoff.mjs';
import {investigationTriageHints,previewTriage} from '../investigations.mjs';
import {retainJobReport,JobController} from '../runner/controller.mjs';

const profile={runnerHash:'a'.repeat(64)},selection={format:'wizard-smoke-selection/v2',courseRevisions:[{id:'smoke-full',revision:10}],effectiveIds:['A','B']};
const request={requestId:'handoff-1',build:{kind:'app',value:'/Selected/Wizard.app'},selection:{checkIds:['A','B']},operator:'Test',timeoutMinutes:60};
const id='11111111-1111-4111-8111-111111111111',identity={build:'Synthetic',packageHash:'b'.repeat(64),runnerHash:profile.runnerHash};
const report={runId:'original-run',identity,catalog:{state:'Failed',counts:{Pass:1,Fail:1},checks:[{id:'A',title:'First',status:'Pass'},{id:'B',title:'Second',status:'Fail',observation:'Independent mismatch'}]},assertionCounts:{NOT_RUN:161},catalogReport:{url:'/exports/test/index.html'}};
const record={id,revision:1,baseline:{runId:'original-run',identities:{version:identity.build,packageHash:identity.packageHash,runnerHash:identity.runnerHash}}};
async function fixture(fn){const root=await mkdtemp('/private/tmp/athanor-handoff-'),store=new JobStore(root);try{let job=store.submit(request,selection,digest(profile));job=store.update(job.id,{state:'Reporting',outcome:'Failed',runId:'original-run'});await fn(store,job,root);}finally{store.close();await rm(root,{recursive:true,force:true});}}
function service({existing=true,lost=false,foreign=false,exportFailure=false}={}){
 let created=existing;const writes=[];
 const call=async(route,body)=>{
  if(body)writes.push(route);
  if(route.startsWith('/api/investigations?'))return created?[{id,runId:'original-run'}]:[];
  if(route.endsWith('/investigation')){created=true;if(lost)throw Object.assign(Error('lost creation response'),{responseLost:true});return record;}
  if(route.endsWith('/task?task=triage'))return {investigationId:id,revision:1,prompt:'Review original evidence',brief:'Classify for review'};
  if(route.endsWith('/export')){if(exportFailure)throw Error('Evidence checksum mismatch');return {id,revision:1,path:'/retained/investigation',url:'/exports/investigation/index.html'};}
  return foreign?{...record,baseline:{...record.baseline,identities:{...record.baseline.identities,packageHash:'c'.repeat(64)}}}:record;
 };return {call,writes};
}

test('a completed failed job reuses its original investigation and retains a task without editing QA',async()=>fixture(async(store,job)=>{
 const original=JSON.stringify(report),api=service(),handoff=await retainInvestigationHandoff(store,job,report,api.call);
 assert.equal(handoff.state,'Ready');assert.equal(handoff.id,id);assert.equal(handoff.url,'/investigation?id='+id);assert.equal(handoff.task.prompt,'Review original evidence');assert.deepEqual(api.writes,['/api/investigations/'+id+'/export']);assert.equal(store.get(job.id).outcome,'Failed');assert.equal(JSON.stringify(report),original);
}));
test('a lost creation reply recovers the original record with only one creation dispatch',async()=>fixture(async(store,job)=>{
 const api=service({existing:false,lost:true}),handoff=await retainInvestigationHandoff(store,job,report,api.call);
 assert.equal(handoff.state,'Ready');assert.equal(handoff.creationDispatched,true);assert.equal(api.writes.filter(r=>r.endsWith('/investigation')).length,1);
 await retainInvestigationHandoff(store,job,report,api.call);assert.equal(api.writes.filter(r=>r.endsWith('/investigation')).length,1);
}));
test('restart after creation intent never repeats the mutation, even when no record can be found',async()=>fixture(async(store,job,root)=>{
 store.update(job.id,{handoff:{state:'Creating',runId:job.runId,creationDispatched:true}});const reopened=new JobStore(root),api=service({existing:false});
 try{const result=await retainInvestigationHandoff(reopened,job,report,api.call);assert.equal(result.state,'Needs review');assert.match(result.error,/not replayed/);assert.equal(api.writes.length,0);assert.equal(reopened.get(job.id).outcome,'Failed');}finally{reopened.close();}
}));
test('failed handoff can reconcile later without replacing the immutable original report or rerunning the course',async()=>fixture(async(store,job)=>{
 store.update(job.id,{handoff:{state:'Needs review',runId:job.runId,creationDispatched:true,error:'Read unavailable'}});const api=service();
 const result=await retainInvestigationHandoff(store,job,report,api.call,{reconcile:true});assert.equal(result.state,'Ready');assert.equal(api.writes.filter(r=>r.endsWith('/investigation')).length,0);assert.equal(store.get(job.id).runId,job.runId);assert.equal(store.get(job.id).outcome,'Failed');
}));
test('conflicting package, multiple originals or broken evidence produce a review handoff and no new QA outcome',async()=>fixture(async(store,job)=>{
 for(const api of [service({foreign:true}),service({exportFailure:true}),{call:async()=>[{id,runId:job.runId},{id:'22222222-2222-4222-8222-222222222222',runId:job.runId}],writes:[]}]){
  store.update(job.id,{handoff:null});const result=await retainInvestigationHandoff(store,job,report,api.call);assert.equal(result.state,'Needs review');assert.equal(store.get(job.id).outcome,'Failed');assert.equal(api.writes.filter(r=>r.endsWith('/investigation')).length,0);
 }
}));
test('passing checks and jobs without execution do not invent investigations',async()=>fixture(async(store,job)=>{
 const call=async()=>{throw Error('Must not contact investigation APIs');};assert.equal((await retainInvestigationHandoff(store,job,{...report,catalog:{checks:[{id:'A',status:'Pass'}]}},call)).state,'Not needed');assert.equal((await retainInvestigationHandoff(store,{...job,runId:null},{...report,runId:null},call)).state,'Not needed');
}));
test('agent brief separates QA, delivery and not-run assertions and uses retained IDs for recovery',async()=>fixture(async(store,job)=>{
 const brief=jobResultBrief({...job,state:'Complete',delivery:'DELIVERY_UNKNOWN'},report);assert.equal(brief.outcome,'Failed');assert.equal(brief.delivery,'DELIVERY_UNKNOWN');assert.deepEqual(brief.counts,{Pass:1,Fail:1});assert.deepEqual(brief.functionalAssertionCounts,{NOT_RUN:161});assert.equal(brief.checksNeedingReview.length,1);assert.equal(brief.checksNeedingReview[0].evidenceUrl,'/exports/test/index.html#check=B');assert.deepEqual(brief.identities.courses,selection.courseRevisions);assert.equal(brief.identities.selectionHash,digest(selection));assert.match(brief.recovery.action,/do not resend/);
 for(const stage of ['Importing','Preparing','Starting','Running','Reporting','Delivery']){const recovery=jobRecovery({...job,state:'Unknown',failedStage:stage,lastError:'Synthetic error'});assert.equal(recovery.stage,stage);assert.ok(recovery.commands.length);assert.ok(!recovery.commands.some(c=>c.includes('run')||c.includes('start')||c.includes('tick')));assert.match(recovery.prompt,/replay unknown input/);}
 const root=path.join(store.dataDir,'exports','athanor-job-'+job.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'report.json'),'{broken');const damaged=await readJobBrief(store,{...job,report:{path:root}});assert.equal(damaged.outcome,'Failed');assert.ok(damaged.reportReadError);assert.equal(damaged.recovery.stage,'Reporting');
}));
test('triage hints group only explicit identical blockers, preserve originals, and remain unapplied review proposals',()=>{
 const c=(id,observation,status='Blocked')=>({id,title:id,original:{status,observation},classification:'Unresolved',disposition:'Investigate',reason:'',duplicateOf:null,review:null});
 const original={...record,baseline:{...record.baseline,reportUrl:'/exports/test/index.html'},cases:[c('A','Selected build lacks search.query. Choose a build supporting this check.'),c('B','Selected build lacks search.query. Choose a build supporting this check.'),c('C','Not executed after an unmet prerequisite. Source import failed'),c('D','Not executed after an unmet prerequisite. Source import failed'),c('E','Not executed after an unmet prerequisite. Another error'),c('F','Pixels unchanged','Fail'),c('G','Selected build lacks search.query. Choose a build supporting this check.','Unknown')]},before=JSON.stringify(original),hints=investigationTriageHints(original);
 assert.equal(hints.hints.length,3);assert.equal(hints.proposal.updates.find(c=>c.id==='B').duplicateOf,'A');assert.equal(hints.proposal.updates.find(c=>c.id==='D').classification,'Unresolved');assert.equal(hints.proposal.updates.find(c=>c.id==='E').duplicateOf,null);assert.ok(!hints.proposal.updates.some(c=>['F','G'].includes(c.id)));assert.equal(hints.hints[0].evidence[0].runId,'original-run');
 const preview=previewTriage(original,hints.proposal);assert.equal(preview.next.cases[1].classification,'Environment');assert.equal(original.cases[1].classification,'Unresolved');assert.equal(JSON.stringify(original),before);assert.throws(()=>previewTriage({...original,revision:2},hints.proposal),/changed/);
 original.cases[0].classification='App';assert.ok(!investigationTriageHints(original).proposal.updates.some(c=>c.id==='A'));
});
test('early blocked reports expose agent guidance without creating a fictitious run or losing the first report',async()=>fixture(async(store,job)=>{
 const unstarted={...job,runId:null,outcome:'Blocked',failedStage:'Preparing',error:'Schema qualification rejected',workerRunnerHash:profile.runnerHash};
 const retained=await retainJobReport(store,unstarted,async route=>{assert.equal(route,'/api/checks');return {checks:[{id:'A',title:'First'},{id:'B',title:'Second'}]};});
 const brief=JSON.parse(await readFile(retained.brief,'utf8'));assert.equal(brief.identities.runId,null);assert.equal(brief.outcome,'Blocked');assert.equal(brief.recovery.stage,'Preparing');assert.equal(brief.reports.investigation.state,'Not needed');assert.match(await readFile(path.join(retained.path,'index.html'),'utf8'),/Agent brief and investigation/);assert.match(await readFile(path.join(retained.path,'AGENT-PROMPT.txt'),'utf8'),/Do not bypass schema/);
}));
test('reporting failure records its actual stage for safe repair instead of losing the failed QA result',async()=>fixture(async(store,job)=>{
 await new JobController(store,{profile,call:async()=>({sourceMatches:true,sourceHash:profile.runnerHash}),report:async()=>{throw Error('Report inventory changed');}}).tick();const current=store.get(job.id);assert.equal(current.state,'Unknown');assert.equal(current.outcome,'Failed');assert.equal(current.failedStage,'Reporting');assert.equal(jobRecovery(current).stage,'Reporting');assert.equal(current.lastError,'Report inventory changed');
}));
test('a changed report is rejected before handoff effects and a rebound worker cannot create or export an investigation',async()=>fixture(async(store,job)=>{
 const directory=path.join(store.dataDir,'exports','athanor-job-'+job.id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'report.json'),JSON.stringify({...report,catalog:{...report.catalog,state:'Passed'}}));
 const pinned={...job,report:{path:directory,reportHash:digest(report)}};await assert.rejects(()=>readJobReport(store,pinned),/changed/);let writes=0;
 await assert.rejects(()=>retainInvestigationHandoff(store,pinned,{...report,identity:{...identity,build:'Changed'}},async()=>{writes++;}),/changed/);assert.equal(writes,0);
 let reports=0;await new JobController(store,{profile,call:async()=>({sourceMatches:true,sourceHash:'c'.repeat(64)}),report:async()=>{reports++;}}).tick();assert.equal(reports,0);assert.equal(store.get(job.id).outcome,'Failed');assert.equal(store.get(job.id).failedStage,'Reporting');
}));
