import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {ROOT,digest,readJSON} from './files.mjs';
import {releaseBuilds,buildChannel} from '../builds.mjs';
import {resultSummary} from '../scripts/smoke.mjs';
import {createNightlyPlan,consolidateNightly,blockedPreparationReport,nightlyHTML,nightlyCases} from './nightly.mjs';
import {prepareDelivery,inspectDelivery,recordDelivery} from './delivery.mjs';

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
export async function retainJobReport(store,job,call){
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
 await retain(path.join(root,'report.json'),report);
 const html=nightlyHTML(report);
 await retain(path.join(root,'index.html'),html);
 return {path:root,url:'/exports/athanor-job-'+job.id+'/index.html',state:report.catalog.state,catalogReport:report.catalogReport||null};
}
export class JobController{
 constructor(store,{profile,call,resolve=resolveJobBuild,report=retainJobReport,route=null,send=null,now=()=>Date.now()}){Object.assign(this,{store,profile,call,resolve,report,route,send,now});}
 change(job,patch,note){return this.store.update(job.id,patch,note);}
 async lookup(route){try{return await this.call(route);}catch(e){if(e.status===404)return null;throw e;}}
 stop(job,error,outcome='Blocked'){return this.change(job,{state:'Reporting',outcome,error,failedStage:job.state,workerRunnerHash:job.workerRunnerHash||this.profile.runnerHash},error);}
 async tick(){
  const lease=this.store.claim();if(!lease)return {state:'Busy',reason:'Another verified controller process owns progression.'};
  try{
   this.store.due(this.now());const job=this.store.next();if(!job)return {state:'Idle'};
   if(job.profileHash!==digest(this.profile))return this.change(job,{state:'Unknown',error:'Job belongs to another pinned worker profile; retain its source and inspect.'},'No work dispatched from another source/profile.');
   try{return await this.advance(job);}catch(e){if(e.responseLost)return this.change(job,{lastError:e.message},'Lost response; next tick reconciles the retained identity.');
    if(e.serviceUnavailable||e.status>=500)return this.change(job,{lastError:e.message},'Service unavailable; no mutation replay.');
    if(['Running','Reporting','Delivery'].includes(job.state))return this.change(job,{state:'Unknown',lastError:e.message,reportPending:!job.report},'Controller requires review; original QA state and evidence retained.');
    return this.stop(job,e.message);}
  }finally{this.store.release(lease);}
 }
 async advance(job){
  const expired=Date.parse(job.deadline)<=this.now(),cancel=job.cancelRequested||expired;
  if(cancel&&['Queued','Resolved','Imported','Ready'].includes(job.state))return this.stop(job,job.cancelRequested?'Cancelled before dispatch.':'Job deadline passed before dispatch.',job.cancelRequested?'Cancelled':'Blocked');
  if(job.state==='Queued'){
   const resolved=await this.resolve(job.request.build);return this.change(job,{state:'Resolved',resolved,workerRunnerHash:this.profile.runnerHash},'Official build identity resolved.');
  }
  if(job.state==='Resolved'){
   const state=await this.call('/api/worker');if(busy(state))return {id:job.id,state:'Waiting',reason:'Worker busy; no preparation or run dispatched.'};
   job=this.change(job,{state:'Importing'},'Build import intent retained.');
   try{const imported=await this.call('/api/builds/import',job.resolved.input);return this.change(job,{state:'Imported',imported},'Build import completed.');}catch(e){if(e.responseLost)throw e;return this.stop(job,e.message);}
  }
  if(job.state==='Importing')return this.stop(job,'Build import response was interrupted. Inspect the verified cache and create a new job; import was not replayed.','Unknown');
  if(job.state==='Imported'){
   if(busy(await this.call('/api/worker')))return {id:job.id,state:'Waiting',reason:'Worker busy; preparation intent not dispatched.'};
   job=this.change(job,{state:'Preparing'},'Preparation intent '+job.preparationId+' retained before dispatch.');
   try{const preparation=await this.call('/api/preparations',{app:job.imported.app,selection:job.request.selection,preparationId:job.preparationId});return this.change(job,{preparation},'Preparation admitted.');}catch(e){if(e.responseLost)throw e;return this.stop(job,e.message);}
  }
  if(job.state==='Preparing'){
   const preparation=await this.lookup('/api/preparations/'+job.preparationId);if(!preparation)return this.stop(job,'Retained preparation ID was not found after interruption; no setup replay.','Unknown');
   if(preparation.state==='Preparing')return {id:job.id,state:job.state};
   job=this.change(job,{preparation},'Preparation settled: '+preparation.state);
   if(preparation.state!=='Ready')return this.stop(job,preparation.error||'Preparation did not reach Ready.');
   if(cancel)return this.stop(job,'Preparation settled after cancellation/deadline; course was not started.',job.cancelRequested?'Cancelled':'Blocked');
   const plan=await this.call('/api/plans/'+preparation.planHash);
   if(plan.runnerHash!==this.profile.runnerHash||plan.packageHash!==preparation.packageHash||plan.version!==preparation.version||digest(plan.recipe?.selection)!==digest(job.selection))return this.stop(job,'Prepared source/package/selection differs from the retained job.','Unknown');
   const {checks}=await this.call('/api/checks'),nightlyPlan=createNightlyPlan(await readJSON(path.join(ROOT,'examples/nightly/suite.json')),checks,{build:plan.version,packageHash:plan.packageHash,runnerHash:plan.runnerHash,dataDir:this.store.dataDir,releaseChanges:job.resolved.releaseNotes?[{tag:job.resolved.tag,notes:job.resolved.releaseNotes}]:[]},await readJSON(path.join(ROOT,'examples/nightly/mapping.json')),{executionSelection:job.selection});
   await retain(path.join(this.store.dataDir,'controller-plans',job.id+'.json'),nightlyPlan);
   return this.change(job,{state:'Ready',planHash:plan.planHash,nightlyPlan},'Selection and report plan frozen.');
  }
  if(job.state==='Ready'){
   if(busy(await this.call('/api/worker')))return {id:job.id,state:'Waiting',reason:'Worker busy; no Start dispatched.'};
   job=this.change(job,{state:'Starting'},'Run request '+job.runRequestId+' retained before Start.');
   try{const admitted=await this.call('/api/runner/start',{planHash:job.planHash,requestId:job.runRequestId,operator:job.request.operator});return this.change(job,{state:'Running',runId:admitted.runId},'Run admitted.');}catch(e){if(e.responseLost)throw e;return this.stop(job,e.message);}
  }
  if(job.state==='Starting'){
   const run=await this.lookup('/api/requests/'+job.runRequestId);if(!run)return this.stop(job,'Run request not found after interruption. Inspect before a new job; Start was not replayed.','Unknown');
   return this.change(job,{state:'Running',runId:run.id},'Original run recovered by request ID.');
  }
  if(job.state==='Running'){
   const run=await this.call('/api/runs/'+job.runId),result=resultSummary(run);
   if(result.complete)return this.change(job,{state:'Reporting',outcome:result.state},'Run settled; QA outcome '+result.state+'.');
   if(cancel&&!job.stopRequested){job=this.change(job,{stopRequested:true},'Owned run cancellation intent retained.');try{await this.call('/api/runner/stop',{runId:job.runId});}catch(e){return this.change(job,{lastError:e.message},'Stop response unavailable; inspect original run, do not replay.');}}
   return {id:job.id,state:'Running',runId:job.runId,counts:result.counts};
  }
  if(job.state==='Reporting'){
   const report=await this.report(this.store,job,this.call);return this.change(job,{state:'Delivery',report},'Local report retained.');
  }
  if(job.state==='Delivery'){
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
