import path from 'node:path';
import {readJSON,digest} from './files.mjs';

const smoke=(...args)=>['node','scripts/smoke.mjs',...args,'--server','URL'];
export function jobRecovery(job){
 const stage=job.failedStage||job.state,commands=[['node','scripts/controller.mjs','status','--config','CONFIG','--id',job.id]];
 const actions={Queued:'Inspect official release discovery and the pinned worker profile.',Resolved:'Inspect the pinned worker identity before importing.',Importing:'Inspect the verified build cache and original import event. Do not replay the interrupted import.',Imported:'Inspect worker readiness before preparing.',Preparing:'Inspect the retained preparation and its repair prompt. Do not repeat setup with a new ID.',Ready:'Inspect the frozen plan, package and worker identity.',Starting:'Inspect the original run request before deciding whether a new attempt is needed.',Running:'Inspect the original run and its owned cleanup. Unknown editor input must not be replayed.',Reporting:'Inspect the retained run, report inventory and reporting error. Preserve existing report bytes.',Delivery:'Inspect the original delivery intent and receipt. Reconcile against message history; do not resend.'};
 if(['Importing','Resolved'].includes(stage))commands.push(smoke('builds'));
 if(job.preparationId&&['Preparing','Imported','Ready'].includes(stage))commands.push(smoke('preparation','--id',job.preparationId));
 if(job.runRequestId&&['Starting','Running','Reporting'].includes(stage))commands.push(smoke('status','--request-id',job.runRequestId));
 if(job.runId)commands.push(smoke('status','--run',job.runId));
 if(job.runId&&job.handoff?.state==='Needs review')commands.push(smoke('investigations','--run',job.runId));
 const deliveryReview=job.delivery==='DELIVERY_UNKNOWN'||job.delivery==='DELIVERY_PENDING';
 if(deliveryReview)commands.push(['node','--input-type=module','-e','import {inspectDelivery} from "./runner/delivery.mjs"; console.log(JSON.stringify(await inspectDelivery(process.argv[1]),null,2))','REPORT_DIRECTORY']);
 return {stage,reason:job.lastError||job.error||job.handoff?.error||null,action:deliveryReview?actions.Delivery:actions[stage]||'Inspect the retained identities and evidence before changing this attempt.',commands,
  prompt:`Inspect Athanor job ${job.id} using the retained IDs and commands in this context. ${deliveryReview?actions.Delivery:actions[stage]||'Review the completed report and investigation.'} Preserve the requested build, frozen course, original outcomes and all earlier evidence. Repair only a source-backed harness or environment defect; return the patch and checks needing a new attempt. Do not bypass schema qualification, replay unknown input or Start, send messages, upload evidence or submit a bug. Execution and publication require separate authorization.`};
}

export function jobResultBrief(job,report=null){
 const checks=report?.catalog?.checks||[],needsReview=checks.filter(c=>['Fail','Blocked','Unknown','Not run'].includes(c.status));
 return {format:'athanor-job-brief/v1',jobId:job.id,jobState:job.state,outcome:job.outcome||report?.catalog?.state||null,delivery:job.delivery||null,
  identities:{requestHash:job.requestHash,requestedBuild:job.request.build,build:report?.identity||job.preparation&&{build:job.preparation.version,packageHash:job.preparation.packageHash,runnerHash:job.workerRunnerHash}||job.resolved||job.request.build,
   selectionHash:digest(job.selection),courses:job.selection.courseRevisions||[],checkIds:job.selection.effectiveIds,planHash:job.planHash||null,preparationId:job.preparationId,runRequestId:job.runRequestId,runId:job.runId||null},
  counts:report?.catalog?.counts||null,functionalAssertionCounts:report?.assertionCounts||null,
  checksNeedingReview:needsReview.map(c=>({id:c.id,title:c.title,status:c.status,observation:c.observation,evidenceUrl:report?.catalogReport?.url?report.catalogReport.url+'#check='+encodeURIComponent(c.id):null})),
  reports:{local:job.report||null,detailed:report?.catalogReport||null,investigation:job.handoff?{state:job.handoff.state,id:job.handoff.id||null,revision:job.handoff.revision||null,url:job.handoff.url||null,package:job.handoff.package||null,error:job.handoff.error||null}:null},recovery:jobRecovery(job)};
}

export async function readJobReport(store,job){
 const report=await readJSON(path.join(store.dataDir,'exports','athanor-job-'+job.id,'report.json'));
 if(job.report?.reportHash&&digest(report)!==job.report.reportHash||job.runId&&report.runId!==job.runId||!Array.isArray(report.catalog?.checks))throw Error('Retained job report changed or belongs to another run. Preserve it for inspection.');
 return report;
}

export async function readJobBrief(store,job){
 let report=null,error=null;if(job.report)try{report=await readJobReport(store,job);}catch(e){error=e.message;}
 const brief=jobResultBrief(job,report);if(error){brief.reportReadError=error;brief.recovery=jobRecovery({...job,failedStage:'Reporting',lastError:error});}return brief;
}

// Creation is one recorded intent. After a lost reply only list/read reconciliation is allowed.
export async function retainInvestigationHandoff(store,job,report,call,{reconcile=false}={}){
 if(job.report?.reportHash&&digest(report)!==job.report.reportHash||job.runId&&report.runId!==job.runId)throw Error('Retained job report changed or belongs to another run.');
 if(!job.runId||!report.catalog.checks.some(c=>['Fail','Blocked','Unknown','Not run'].includes(c.status)))return {state:'Not needed'};
 const current=store.get(job.id),previous=current.handoff;
 if(previous&&['Ready','Needs review'].includes(previous.state)&&!reconcile)return previous;
 const save=value=>{store.update(job.id,{handoff:value},'Investigation handoff: '+value.state);return value;};
 let record,id=previous?.id||null;
 try{
  const listed=await call('/api/investigations?run='+encodeURIComponent(job.runId)),originals=listed.filter(r=>r.runId===job.runId);
  if(id){if(!originals.some(r=>r.id===id))throw Error('Retained investigation is absent from the original run. Inspect before creating another.');}
  else{
   if(originals.length>1)throw Error('Several investigations belong to this run. Choose one after review.');
   if(originals.length===1)id=originals[0].id;
   else{
    if(previous?.creationDispatched)throw Error('Investigation creation outcome is unknown and no record was found. Inspect the original intent; creation was not replayed.');
    save({state:'Creating',creationDispatched:true,runId:job.runId});
    try{record=await call('/api/runs/'+encodeURIComponent(job.runId)+'/investigation',{actor:job.request.operator,title:'Athanor job '+job.id+' — investigation'});id=record.id;}
    catch(e){const recovered=(await call('/api/investigations?run='+encodeURIComponent(job.runId))).filter(r=>r.runId===job.runId);if(recovered.length!==1)throw e;id=recovered[0].id;}
   }
  }
  if(typeof id!=='string'||!id.match(/^[a-f0-9-]{36}$/))throw Error('Investigation response has no valid retained identity.');
  save({state:'Exporting',id,runId:job.runId,creationDispatched:store.get(job.id).handoff?.creationDispatched||false});
  record=await call('/api/investigations/'+id);
  if(record.id!==id||record.baseline?.runId!==job.runId||record.baseline?.identities?.packageHash!==report.identity.packageHash||record.baseline?.identities?.runnerHash!==report.identity.runnerHash||record.baseline?.identities?.version!==report.identity.build)throw Error('Investigation belongs to another run, package or harness source.');
  const packet=await call('/api/investigations/'+id+'/task?task=triage');
  if(packet.investigationId!==id||packet.revision!==record.revision)throw Error('Investigation changed while preparing the task; reload it for review.');
  const exported=await call('/api/investigations/'+id+'/export',{});
  if(exported.id!==id||exported.revision!==record.revision)throw Error('Investigation export differs from the reviewed task revision.');
  return save({state:'Ready',id,revision:record.revision,runId:job.runId,url:'/investigation?id='+encodeURIComponent(id),package:{path:exported.path,url:exported.url},task:packet,creationDispatched:store.get(job.id).handoff.creationDispatched});
 }catch(e){return save({state:'Needs review',id,runId:job.runId,creationDispatched:store.get(job.id).handoff?.creationDispatched||false,error:e.message});}
}
