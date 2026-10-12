import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {ROOT,digest,readJSON} from './files.mjs';
import {releaseBuilds,buildChannel} from '../builds.mjs';
import {resultSummary} from '../scripts/smoke.mjs';
import {createNightlyPlan,consolidateNightly,blockedPreparationReport,nightlyHTML,nightlyCases} from './nightly.mjs';
import {prepareDelivery,inspectDelivery,recordDelivery,verifyReportRoutes} from './delivery.mjs';
import {verifyChangePlan} from './change-course.mjs';
import {verifyWorkerState} from './worker.mjs';
import {retainInvestigationHandoff,jobResultBrief,readJobReport} from './job-handoff.mjs';

const exec=promisify(execFile),busy=s=>s.preparing||s.active||s.ownedSessions?.length||s.activeDesktopJobs?.length;
export async function resolveJobBuild(request,get=async endpoint=>JSON.parse((await exec('gh',['api',endpoint],{timeout:30000,maxBuffer:8*1024*1024})).stdout)){
 if(request.kind==='app')return {input:{path:request.value},label:request.value,resolvedAt:new Date().toISOString()};
 const releases=request.kind==='tag'?[await get('repos/story-wizard/wizard-release/releases/tags/'+encodeURIComponent(request.value))]:await get('repos/story-wizard/wizard-release/releases?per_page=100');
 const published=releases.filter(r=>!r.draft&&r.published_at&&(request.kind==='tag'||buildChannel(r.tag_name)==='Nightly')).sort((a,b)=>b.published_at.localeCompare(a.published_at));
 if(!published.length)throw Error('No published official nightly found in the fresh release response.');
 let builds=releaseBuilds([published[0]]);
 if(!builds.length)throw Error('Newest release has no published macOS ZIP; an older build was not substituted.');
 if(process.arch==='arm64'&&builds.length>1)builds=builds.filter(b=>['Apple Silicon','Universal'].includes(b.architecture));
 if(builds.length!==1)throw Error('Newest release has ambiguous macOS assets; choose an exact tag/package after review.');
 const build=builds[0];return {...build,input:{assetId:build.assetId},resolvedAt:new Date().toISOString()};
}
async function retain(file,value){
 await mkdir(path.dirname(file),{recursive:true});const bytes=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
 try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(await readFile(file,'utf8')!==bytes)throw Error('Retained controller artifact differs; preserve it for review.');}
 return file;
}
function stageContext(store,job,name,stage){
 const child={...job,...stage,id:job.id+'-'+name,request:{...job.request,nightly:undefined},courseStages:undefined,report:null,outcome:stage.state,handoff:stage.handoff||null};
 const scoped={dataDir:store.dataDir,get:()=>({...child,handoff:store.get(job.id).courseStages?.[name]?.handoff||child.handoff}),update:(_id,patch,note)=>{const current=store.get(job.id),courseStages={...current.courseStages,[name]:{...stage,...current.courseStages?.[name],...patch}};store.update(job.id,{courseStages},note);return {...child,...patch};}};
 return {child,scoped};
}
export async function reconcileJobHandoff(store,job,call,context={}){
 const report=await readJobReport(store,job);
 if(!job.request.nightly)return retainInvestigationHandoff(store,job,report,call,{...context,reconcile:true});
 const handoffs={};for(const stage of report.courseStages||[]){
  if(!stage.runId||!stage.report)continue;
  const {child,scoped}=stageContext(store,job,stage.name,job.courseStages[stage.name]),original=await readJobReport(scoped,{...child,report:stage.report});
  handoffs[stage.name]=await retainInvestigationHandoff(scoped,child,original,call,{...context,reconcile:true});
 }
 return {jobId:job.id,handoffs};
}
async function retainCombinedReport(store,job,call,context){
 const root=path.join(store.dataDir,'exports','athanor-job-'+job.id),stages=[];
 for(const name of ['evergreen','changes']){
  const stage=job.courseStages?.[name]||(job.activeCourse===name?{...job,state:job.outcome||'Blocked'}:{state:job.changePlan?.state||'Blocked',reason:job.changePlan?.reason||'Course was not executed.',runId:null});
  if(!stage.runId&&!stage.preparation){stages.push({name,state:stage.state,reason:stage.reason,runId:null,counts:{}});continue;}
  const {child,scoped}=stageContext(store,job,name,stage);
  const exported=await retainJobReport(scoped,child,call,context),record=await readJSON(path.join(exported.path,'report.json'));
  stages.push({name,state:record.catalog.state,runId:stage.runId||null,counts:record.catalog.counts,report:exported,record});
 }
 const evergreen=stages.find(s=>s.name==='evergreen'),primary=stages.find(s=>s.runId===job.runId)||evergreen;
 const report={format:'athanor-job-report/v1',jobId:job.id,runId:job.runId||null,cadence:'nightly',identity:primary?.record?.identity||{build:job.preparation?.version||job.resolved?.tag||'Requested latest nightly',packageHash:job.preparation?.packageHash||null,runnerHash:job.workerRunnerHash},cases:evergreen?.record?.cases||[],caseCounts:evergreen?.record?.caseCounts||{},assertionCounts:evergreen?.record?.assertionCounts||{},
  courseStages:stages.map(({record,...stage})=>stage),changePlan:job.changePlan||{state:'Blocked',reason:'Change planning was not reached.'},catalog:{state:job.outcome||'Blocked',counts:{},checks:stages.flatMap(s=>(s.record?.catalog.checks||[]).map(c=>({...c,course:s.name,detailsUrl:s.record.catalogReport?.url? s.record.catalogReport.url+'#check='+encodeURIComponent(c.id):null})))},executionStarted:stages.some(s=>s.runId),fixVerification:(job.changePlan?.regressions||[]).map(ref=>{const later=stages.find(s=>s.name==='changes'),actual=ref.available&&!job.changePlan?.pendingRegressions?.some(r=>r.id===ref.id)?later?.record?.catalog.checks.find(c=>c.id===ref.caseId):null;return {...ref,newBuild:job.preparation?.version||primary?.record?.identity.build,newRunId:later?.runId||null,newStatus:actual?.status||'Not run',observation:actual?.observation||ref.reason,reviewState:actual?.status==='Pass'?'Ready for human review':'Needs review'};})};
 for(const c of report.catalog.checks)report.catalog.counts[c.status]=(report.catalog.counts[c.status]||0)+1;
 const html=nightlyHTML(report);await retain(path.join(root,'report.json'),report);await retain(path.join(root,'index.html'),html);
 const brief=jobResultBrief({...job,report:{path:root,url:'/exports/athanor-job-'+job.id+'/index.html'}},report,context);
 await retain(path.join(root,'agent-brief.json'),brief);await retain(path.join(root,'AGENT-PROMPT.txt'),brief.recovery.prompt);
 return {path:root,url:'/exports/athanor-job-'+job.id+'/index.html',reportHash:digest(report),htmlHash:digest(html),state:report.catalog.state,courseStages:report.courseStages};
}
export async function retainJobReport(store,job,call,context={}){
 if(job.request.nightly)return retainCombinedReport(store,job,call,context);
 const root=path.join(store.dataDir,'exports','athanor-job-'+job.id),catalog=await call('/api/checks'),suite=await readJSON(path.join(ROOT,'examples/nightly/suite.json'));
 const identity={build:job.preparation?.version||job.resolved?.tag||job.resolved?.label||job.request.build.value||'Requested latest nightly',runnerHash:job.workerRunnerHash,packageHash:job.preparation?.packageHash||null,dataDir:store.dataDir};
 let report;
 if(job.runId){
  const run=await call('/api/runs/'+encodeURIComponent(job.runId));
  if(!resultSummary(run).complete)throw Error('Run is still active; no terminal report yet.');
  report=await consolidateNightly(job.nightlyPlan,run);
  const full=await call('/api/runs/'+encodeURIComponent(job.runId)+'/report',{});
  report.catalogReport={path:full.path,url:full.url};
 }else if(['Failed','Interrupted'].includes(job.preparation?.state))report=blockedPreparationReport(job.preparation,suite,catalog.checks,identity,job.selection);
 else{
  const checks=job.selection.effectiveIds.map(id=>({id,title:catalog.checks.find(c=>c.id===id)?.title||id,status:'Not run',observation:job.error||'No course execution started.'}));
  const cases=nightlyCases(suite).map(c=>({...c,status:'NOT_RUN',assertions:c.expected.map((expected,i)=>({id:c.id+':'+(i+1),expected,status:'NOT_RUN',observation:'No course execution established.'}))}));
  report={format:'athanor-job-report/v1',jobId:job.id,runId:null,cadence:'nightly',identity,executionStarted:false,failedStage:job.failedStage||job.state,error:job.error||null,cases,caseCounts:{NOT_RUN:cases.length},assertionCounts:{NOT_RUN:cases.reduce((n,c)=>n+c.assertions.length,0)},catalog:{state:job.outcome||'Blocked',counts:{'Not run':checks.length},checks},jobRequest:job.request};
 }
 const handoff=await retainInvestigationHandoff(store,job,report,call,context);
 report.jobHandoff={url:'handoff.html',state:handoff.state};
 const brief=jobResultBrief({...job,lastError:null,handoff,report:{path:root,url:'/exports/athanor-job-'+job.id+'/index.html'}},report,context);
 await retain(path.join(root,'report.json'),report);
 await retain(path.join(root,'agent-brief.json'),brief);
 await retain(path.join(root,'AGENT-PROMPT.txt'),handoff.task?.prompt||brief.recovery.prompt);
 if(handoff.task)await retain(path.join(root,'investigation-task.json'),handoff.task);
 if(handoff.task?.firstRead)await retain(path.join(root,'first-read.json'),{...handoff.task.firstRead,evidencePackage:handoff.package});
 if(handoff.task?.triageHints?.proposal)await retain(path.join(root,'triage-proposal.json'),handoff.task.triageHints.proposal);
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const links=handoff.state==='Ready'?`<p><a href="${escape(handoff.url)}">Open investigation</a> · <a href="${escape(handoff.package.url)}">Open evidence package</a></p>`:'';
 await retain(path.join(root,'handoff.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Athanor job handoff</title><style>body{background:#14191f;color:#d6e1eb;font:16px system-ui;max-width:1100px;margin:40px auto;padding:24px}a{color:#9bc6e5}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Athanor job ${escape(job.id)}</h1><p>QA ${escape(report.catalog.state)} · investigation ${escape(handoff.state)}</p><p><a href="index.html">Job report</a> · <a href="agent-brief.json">Agent context</a> · <a href="AGENT-PROMPT.txt">Agent prompt</a>${handoff.task?.firstRead?' · <a href="first-read.json">First read</a>':''}${handoff.task?' · <a href="investigation-task.json">Task context</a>':''}${handoff.task?.triageHints?.proposal?' · <a href="triage-proposal.json">Review triage proposal</a>':''}</p>${links}<pre>${escape(handoff.error||'')}</pre><h2>Checks needing review</h2>${brief.checksNeedingReview.map(c=>`<p>${escape(c.id)} · ${escape(c.status)} · ${escape(c.observation)} ${c.evidenceUrl?`<a href="${escape(c.evidenceUrl)}">Evidence</a>`:''}</p>`).join('')}<h2>Next step</h2><pre>${escape(handoff.task?.brief||brief.recovery.action)}</pre><h2>Agent prompt</h2><pre>${escape(handoff.task?.prompt||brief.recovery.prompt)}</pre></html>`);
 const html=nightlyHTML(report);
 await retain(path.join(root,'index.html'),html);
 return {path:root,url:'/exports/athanor-job-'+job.id+'/index.html',reportHash:digest(report),htmlHash:digest(html),state:report.catalog.state,catalogReport:report.catalogReport||null,handoff:{state:handoff.state,url:'/exports/athanor-job-'+job.id+'/handoff.html'},brief:path.join(root,'agent-brief.json')};
}
export class JobController{
 constructor(store,{profile,call,resolve=resolveJobBuild,report=retainJobReport,route=null,routes=null,send=null,planChanges=null,publish=null,context={},now=()=>Date.now()}){Object.assign(this,{store,profile,call,resolve,report,route,routes,send,planChanges,publish,context,now});}
 change(job,patch,note){return this.store.update(job.id,{lastError:null,lastProgressAt:new Date(this.now()).toISOString(),...patch},note);}
 async worker(){return verifyWorkerState(await this.call('/api/worker'),this.profile);}
 async lookup(route){try{return await this.call(route);}catch(e){if(e.status===404)return null;throw e;}}
 stop(job,error,outcome='Blocked'){
  let courseStages=job.courseStages;if(job.request.nightly){const name=job.activeCourse||'evergreen';courseStages={...courseStages,[name]:{state:outcome,reason:error,runId:job.runId||null,selection:job.selection,preparation:job.preparation,preparationId:job.preparationId,runRequestId:job.runRequestId,nightlyPlan:job.nightlyPlan,planHash:job.planHash}};if(name==='evergreen')courseStages.changes={state:'Blocked',runId:null,reason:'Evergreen did not reach a safe execution boundary.'};if(outcome!=='Unknown'&&Object.values(courseStages).some(s=>s.state==='Failed'))outcome='Failed';}
  return this.change(job,{state:'Reporting',outcome,error,...(courseStages?{courseStages}:{}),failedStage:job.state,workerRunnerHash:job.workerRunnerHash||this.profile.runnerHash},error);}
 async tick(){
  const lease=this.store.claim();if(!lease)return {state:'Busy',reason:'Another verified controller process owns progression.'};
  try{
   this.store.due(this.now());const job=this.store.next();if(!job)return {state:'Idle'};
   if(job.profileHash!==digest(this.profile)||this.store.policyHash&&job.policyHash!==this.store.policyHash)return this.change(job,{state:'Unknown',error:'Job belongs to another pinned worker profile; retain its source and inspect.'},'No work dispatched from another source/profile.');
   try{return await this.advance(job);}catch(e){if(e.responseLost)return this.change(job,{lastError:e.message},'Lost response; next tick reconciles the retained identity.');
    if(e.serviceUnavailable||e.status>=500)return this.change(job,{lastError:e.message},'Service unavailable; no mutation replay.');
    if(['Running','Reporting','Publishing','Delivery'].includes(job.state))return this.change(job,{state:'Unknown',failedStage:job.state,lastError:e.message,reportPending:!job.report},'Controller requires review; original QA state and evidence retained.');
    return this.stop(job,e.message);}
  }finally{this.store.release(lease);}
 }
 async advance(job){
  const expired=Date.parse(job.deadline)<=this.now(),cancel=job.cancelRequested||expired;
  if(cancel&&['Queued','Resolved','Imported','Ready','Planning'].includes(job.state))return this.stop(job,job.cancelRequested?'Cancelled before dispatch.':'Job deadline passed before dispatch.',job.cancelRequested?'Cancelled':'Blocked');
  if(job.state==='Queued'){
   const resolved=await this.resolve(job.request.build);return this.change(job,{state:'Resolved',resolved,workerRunnerHash:this.profile.runnerHash},'Official build identity resolved.');
  }
  if(job.state==='Resolved'){
   const state=await this.worker();if(busy(state))return {id:job.id,state:'Waiting',reason:'Worker busy; no preparation or run dispatched.'};
   job=this.change(job,{state:'Importing'},'Build import intent retained.');
   try{const imported=await this.call('/api/builds/import',job.resolved.input);return this.change(job,{state:'Imported',imported},'Build import completed.');}catch(e){if(e.responseLost)throw e;return this.stop(job,e.message);}
  }
  if(job.state==='Importing')return this.stop(job,'Build import response was interrupted. Inspect the verified cache and create a new job; import was not replayed.','Unknown');
  if(job.state==='Imported'){
   if(busy(await this.worker()))return {id:job.id,state:'Waiting',reason:'Worker busy; preparation intent not dispatched.'};
   job=this.change(job,{state:'Preparing',dispatchStatus:null},'Preparation intent '+job.preparationId+' retained before dispatch.');
   try{const preparation=await this.call('/api/preparations',{app:job.imported.app,selection:job.activeCourse==='changes'?job.changePlan.input:job.request.selection,preparationId:job.preparationId});return this.change(job,{preparation},'Preparation admitted.');}catch(e){return this.change(job,{lastError:e.message,dispatchStatus:e.status||null},'Preparation reply failed; inspect its original ID before deciding the outcome.');}
  }
  if(job.state==='Preparing'){
   const preparation=await this.lookup('/api/preparations/'+job.preparationId);if(!preparation)return this.stop(job,'Retained preparation ID was not found after the failed reply; no setup replay.',job.dispatchStatus&&job.dispatchStatus<500?'Blocked':'Unknown');
   if(preparation.id!==job.preparationId||preparation.app!==job.imported.app||preparation.runnerHash!==this.profile.runnerHash||digest(preparation.selection)!==digest(job.selection))return this.stop(job,'Preparation record belongs to another app, source or selection.','Unknown');
   if(preparation.state==='Preparing')return {id:job.id,state:job.state};
   job=this.change(job,{preparation},'Preparation settled: '+preparation.state);
   if(preparation.state!=='Ready')return this.stop(job,preparation.error||'Preparation did not reach Ready.');
   if(cancel)return this.stop(job,'Preparation settled after cancellation/deadline; course was not started.',job.cancelRequested?'Cancelled':'Blocked');
   const plan=await this.call('/api/plans/'+preparation.planHash);
   if(plan.runnerHash!==this.profile.runnerHash||plan.packageHash!==preparation.packageHash||job.imported.packageHash&&plan.packageHash!==job.imported.packageHash||plan.version!==preparation.version||digest(plan.recipe?.selection)!==digest(job.selection))return this.stop(job,'Prepared source/package/selection differs from the retained job.','Unknown');
   const {checks}=await this.call('/api/checks'),nightlyPlan=createNightlyPlan(await readJSON(path.join(ROOT,'examples/nightly/suite.json')),checks,{build:plan.version,packageHash:plan.packageHash,runnerHash:plan.runnerHash,dataDir:this.store.dataDir,releaseChanges:job.resolved.releaseNotes?[{tag:job.resolved.tag,notes:job.resolved.releaseNotes}]:[]},await readJSON(path.join(ROOT,'examples/nightly/mapping.json')),{executionSelection:job.selection});
   await retain(path.join(this.store.dataDir,'controller-plans',job.id+(job.request.nightly?'-'+(job.activeCourse||'evergreen'):'')+'.json'),nightlyPlan);
   return this.change(job,{state:job.request.nightly&&!job.activeCourse?'Planning':'Ready',activeCourse:job.activeCourse||(job.request.nightly?'evergreen':null),planHash:plan.planHash,nightlyPlan},'Selection and report plan frozen.');
  }
  if(job.state==='Planning'){
   job=this.change(job,{state:'PlanningActive',planningStartedAt:new Date(this.now()).toISOString()},'One bounded change-planning intent retained.');
   let changePlan;try{if(!this.planChanges)throw Error('No reviewed agent planner configured.');changePlan=await this.planChanges(job);if(changePlan.selection)verifyChangePlan(changePlan,job);await retain(path.join(this.store.dataDir,'controller-plans',job.id+'-change-course.json'),changePlan);}
   catch(e){changePlan={state:'Blocked',reason:e.message,selection:null};}
   return this.change(job,{state:'Ready',changePlan,planningCompletedAt:new Date(this.now()).toISOString()},'Change planning '+changePlan.state+'; evergreen remains runnable.');
  }
  if(job.state==='PlanningActive'){
   let changePlan;try{changePlan=await readJSON(path.join(this.store.dataDir,'controller-plans',job.id+'-change-course.json'));}catch(e){if(e.code!=='ENOENT')throw e;changePlan={state:'Unknown',selection:null,reason:'Planner was interrupted; inspect retained task. It was not repeated.'};}
   if(changePlan.selection)verifyChangePlan(changePlan,job);
   if(changePlan.selection&&(changePlan.comparison?.head===undefined||changePlan.comparison.hash!==digest((({hash,...comparison})=>comparison)(changePlan.comparison))))throw Error('Retained change plan differs from its comparison.');
   return this.change(job,{state:'Ready',changePlan},'Evergreen continues; original planning result reconciled.');
  }
  if(job.state==='Ready'){
   if(busy(await this.worker()))return {id:job.id,state:'Waiting',reason:'Worker busy; no Start dispatched.'};
   job=this.change(job,{state:'Starting',dispatchStatus:null,courseStartedAt:new Date(this.now()).toISOString()},'Run request '+job.runRequestId+' retained before Start.');
   try{const admitted=await this.call('/api/runner/start',{planHash:job.planHash,requestId:job.runRequestId,operator:job.request.operator});return this.change(job,{state:'Running',runId:admitted.runId},'Run admitted.');}catch(e){return this.change(job,{lastError:e.message,dispatchStatus:e.status||null},'Start reply failed; inspect its original request ID before deciding the outcome.');}
  }
  if(job.state==='Starting'){
   const run=await this.lookup('/api/requests/'+job.runRequestId);if(!run)return this.stop(job,'Run request not found after the failed reply. Inspect before a new job; Start was not replayed.',job.dispatchStatus&&job.dispatchStatus<500?'Blocked':'Unknown');
   if(run.execution?.plan_hash!==job.planHash||run.operator!==job.request.operator)return this.stop(job,'Retained request belongs to another plan or operator; its run was not adopted.','Unknown');
   return this.change(job,{state:'Running',runId:run.id},'Original run recovered by request ID.');
  }
  if(job.state==='Running'){
   const run=await this.call('/api/runs/'+job.runId),result=resultSummary(run);
   if(result.complete){
      if(!job.request.nightly)return this.change(job,{state:'Reporting',outcome:result.state},'Run settled; QA outcome '+result.state+'.');
      const stage={state:result.state,startedAt:job.courseStartedAt,runId:job.runId,runRequestId:job.runRequestId,preparationId:job.preparationId,preparation:job.preparation,selection:job.selection,nightlyPlan:job.nightlyPlan,planHash:job.planHash,completedAt:new Date(this.now()).toISOString()},courseStages={...job.courseStages,[job.activeCourse]:stage};
      if(job.activeCourse==='evergreen'&&job.changePlan?.selection&&['Passed','Failed'].includes(result.state)&&!cancel){
       if(busy(await this.worker()))return {id:job.id,state:'Waiting',reason:'Evergreen settled; waiting for verified worker cleanup before change preparation.'};
       return this.change(job,{state:'Imported',courseStages,activeCourse:'changes',imported:{...job.imported,packageHash:job.preparation.packageHash},selection:job.changePlan.selection,preparationId:randomUUID(),runRequestId:randomUUID(),runId:null,preparation:null,nightlyPlan:null,planHash:null,stopRequested:false},'Evergreen retained; change course gets new fixture, preparation and request IDs on the same imported package.');
      }
      if(job.activeCourse==='evergreen')courseStages.changes={state:cancel?'Cancelled':job.changePlan?.selection?'Blocked':job.changePlan?.state||'Blocked',reason:cancel?'Cancelled before change execution.':job.changePlan?.selection?'Evergreen did not leave a safe terminal session.':job.changePlan?.reason||'Change planning unavailable.',runId:null};
      const states=Object.values(courseStages).map(s=>s.state),outcome=states.includes('Unknown')?'Unknown':states.includes('Failed')?'Failed':states.includes('Cancelled')?'Cancelled':states.some(s=>['Blocked','Partial'].includes(s))||job.changePlan?.state==='Partial'?'Blocked':'Passed';
      return this.change(job,{state:'Reporting',courseStages,outcome},'Both course stages retained; aggregate QA '+outcome+'.');
     }
   if(cancel&&!job.stopRequested){job=this.change(job,{stopRequested:true},'Owned run cancellation intent retained.');try{await this.call('/api/runner/stop',{runId:job.runId});}catch(e){return this.change(job,{lastError:e.message},'Stop response unavailable; inspect original run, do not replay.');}}
   if(digest(job.lastCounts||{})!==digest(result.counts))return this.change(job,{lastCounts:result.counts},'Course progress updated.');
     return {id:job.id,state:'Running',runId:job.runId,counts:result.counts};
  }
  if(job.state==='Reporting'){
   await this.worker();
   const report=await this.report(this.store,job,this.call,this.context);return this.change(job,{state:this.publish?'Publishing':'Delivery',report},'Local report retained.');
  }
  if(job.state==='Publishing'){
   let publication;try{publication=await this.publish(job);}catch(e){publication={state:'Failed',error:e.message};}
   return this.change(job,{state:'Delivery',publication},'Report publication '+publication.state+'; local evidence retained.');
  }
  if(job.state==='Delivery'){
   if(this.routes){
    const routes=verifyReportRoutes(this.routes);let deliveries={...job.deliveries};
    for(const route of routes){
     const id=route.channelId;let delivery;try{delivery=await inspectDelivery(job.report.path,route);}catch(e){if(e.code!=='ENOENT')throw e;await prepareDelivery(job.report.path,route,{perDestination:true,publication:job.publication||{state:'Pending'}});delivery=await inspectDelivery(job.report.path,route);}
     if(deliveries[id]?.dispatched&&delivery.state==='DELIVERY_PENDING'){await recordDelivery(job.report.path,{intentId:delivery.intent.id,state:'DELIVERY_UNKNOWN',observation:'Controller restarted after destination intent; inspect before resend.'},route);delivery=await inspectDelivery(job.report.path,route);}
     if(this.send&&!deliveries[id]?.dispatched&&delivery.state==='DELIVERY_PENDING'){
      deliveries[id]={route,dispatched:true,state:'DELIVERY_UNKNOWN'};job=this.change(job,{deliveries},'Destination '+id+' dispatch intent retained.');
      try{await this.send(job.report.path,route);}catch(e){delivery=await inspectDelivery(job.report.path,route);if(delivery.state==='DELIVERY_PENDING')await recordDelivery(job.report.path,{intentId:delivery.intent.id,state:'DELIVERY_UNKNOWN',observation:'Sender response unavailable; reconcile this destination before retry.'},route);deliveries[id].error=e.message;}
      delivery=await inspectDelivery(job.report.path,route);
     }
     deliveries[id]={...deliveries[id],route,state:delivery.state,intentId:delivery.intent.id};job=this.change(job,{deliveries},'Destination '+id+' state '+delivery.state+'.');
    }
    const states=Object.values(deliveries).map(d=>d.state),delivery=states.includes('DELIVERY_UNKNOWN')?'DELIVERY_UNKNOWN':states.every(s=>s==='DELIVERY_CONFIRMED')?'DELIVERY_CONFIRMED':'DELIVERY_PENDING';
    return this.change(job,{state:'Complete',deliveries,delivery},'Both report destinations retained independently.');
   }
   if(!this.route)return this.change(job,{state:'Complete',delivery:'LOCAL_ONLY'},'Complete; local report delivery selected.');
   let delivery;try{delivery=await inspectDelivery(job.report.path);}catch(e){if(e.code!=='ENOENT')throw e;await prepareDelivery(job.report.path,this.route);delivery=await inspectDelivery(job.report.path);}
   if(this.send&&!job.deliveryDispatched&&delivery.state==='DELIVERY_PENDING'){
    job=this.change(job,{deliveryDispatched:true},'Delivery dispatch intent retained; uncertain responses are never resent.');
    try{await this.send(job.report.path);}catch(e){delivery=await inspectDelivery(job.report.path);if(delivery.state==='DELIVERY_PENDING')await recordDelivery(job.report.path,{intentId:delivery.intent.id,state:'DELIVERY_UNKNOWN',observation:'Controller dispatch was interrupted; inspect the original intent before sending.'});return this.change(job,{state:'Complete',delivery:'DELIVERY_UNKNOWN',lastError:e.message},'Delivery needs reconciliation; QA report retained.');}
    delivery=await inspectDelivery(job.report.path);
   }
   if(job.deliveryDispatched&&delivery.state==='DELIVERY_PENDING'){await recordDelivery(job.report.path,{intentId:delivery.intent.id,state:'DELIVERY_UNKNOWN',observation:'Controller restarted during dispatch intent; no resend attempted.'});delivery=await inspectDelivery(job.report.path);}
   return this.change(job,{state:'Complete',delivery:delivery.state},'Report and delivery state retained independently.');
  }
  throw Error('Unknown controller stage: '+job.state);
 }
}
