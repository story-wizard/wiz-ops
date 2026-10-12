import path from 'node:path';
import {mkdir,writeFile,lstat,readdir,rmdir} from 'node:fs/promises';
import {digest,externalPath,readJSON} from './files.mjs';

export const ownerDelivery={workspace:'story-company',userId:'U0BDBFNU0G1',channel:'Slack one-to-one DM',email:false,jira:false};
export function verifyOwnerRoute(route){
 if(route?.workspace!==ownerDelivery.workspace||route.userId!==ownerDelivery.userId||route.type!=='im'||route.user!==ownerDelivery.userId||!/^D[A-Z0-9]+$/.test(route.channelId||''))throw Error('Verify Charles’s exact one-to-one Slack DM in Story Company. No alternate destination is allowed.');
 return {workspace:ownerDelivery.workspace,userId:ownerDelivery.userId,type:'im',user:ownerDelivery.userId,channelId:route.channelId};
}
export const smokeChannel={workspace:'story-company',type:'channel',channelId:'C0C5F7K6DNV',name:'wiz-smoketest-reports'};
export function verifyReportRoute(route){
 if(route?.type==='im')return verifyOwnerRoute(route);
 if(!route||Object.keys(route).some(k=>!Object.hasOwn(smokeChannel,k))||Object.entries(smokeChannel).some(([k,v])=>route[k]!==v))throw Error('Only Charles’s verified DM and #wiz-smoketest-reports are permitted.');
 return {...smokeChannel};
}
export function verifyReportRoutes(routes){
 if(!Array.isArray(routes)||routes.length!==2)throw Error('Nightly reporting needs the owner DM and smoke channel.');
 const checked=routes.map(verifyReportRoute);if(checked.filter(r=>r.type==='im').length!==1||checked.filter(r=>r.type==='channel').length!==1)throw Error('Use one DM and one smoke channel.');return checked;
}
const deliveryRoot=(directory,route)=>path.join(directory,'delivery',...(route?[verifyReportRoute(route).channelId]:[]));
export async function prepareDelivery(directory,route,{perDestination=false,publication=null}={}){
 directory=externalPath(path.resolve(directory));const reportFile=path.join(directory,'report.json');
 if(!(await lstat(reportFile)).isFile())throw Error('Delivery requires a retained regular report file.');
 const report=await readJSON(reportFile);
 if(!['athanor-nightly-report/v1','athanor-preparation-report/v1','athanor-job-report/v1'].includes(report.format)||!report.identity?.build||!report.catalog)throw Error('Use a retained Athanor nightly, preparation or job report.');
 const destination=verifyReportRoute(route),identity=report.jobId||report.runId||report.preparation?.id;
 if(!identity||!['Passed','Failed','Blocked','Cancelled','Unknown'].includes(report.catalog.state))throw Error('Delivery requires a terminal run or blocked preparation.');
 const content={format:'athanor-delivery-intent/v2',reportHash:digest(report),identity,destination,publication,policy:ownerDelivery};
 const intent={...content,id:digest(content),createdAt:new Date().toISOString(),message:`Athanor · ${report.identity.build}\n${report.jobId?'Job':report.runId?'Run':'Preparation'}: ${identity}\nOutcome: ${report.catalog.state}\nCatalog: ${JSON.stringify(report.catalog.counts)}\nFunctional assertions: ${JSON.stringify(report.assertionCounts||{})}\n${report.preparation?.error?'Preparation: '+report.preparation.error+'\n':''}${report.error?'Controller: '+report.error+'\n':''}Report retained on the testing Mac: ${directory}\nEvidence is local; no files uploaded.`,state:'DELIVERY_PENDING'};
 if(publication?.state==='Published'){const url=new URL(publication.url);if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))||publication.reportHash!==digest(report))throw Error('Publication does not match the retained report.');intent.message=intent.message.replace(/Report retained on the testing Mac:[\s\S]*$/,'Report: '+url.href);}
 else if(publication)intent.message=intent.message.replace(/Report retained on the testing Mac:[\s\S]*$/,'Shared report unavailable: '+(publication.error||publication.state)+'. Local evidence retained; inspect the worker.');
 if(report.courseStages)intent.message+='\nCourses: '+report.courseStages.map(s=>s.name+': '+s.state+' '+JSON.stringify(s.counts)).join('; ');
 if(destination.type==='channel')intent.message=intent.message.replace(/Report retained on the testing Mac:[\s\S]*$/,'Local report retained; shared publication is pending.');
 intent.messageHash=digest(intent.message);intent.id=digest({...content,messageHash:intent.messageHash});
 const output=deliveryRoot(directory,perDestination?destination:null);await mkdir(output,{recursive:true,mode:0o700});
 await writeFile(path.join(output,'intent.json'),JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o600});
 return {intent,path:path.join(output,'intent.json'),networkDispatched:false};
}
export async function inspectDelivery(directory,route=null){
 directory=externalPath(path.resolve(directory));const root=deliveryRoot(directory,route),intent=await readJSON(path.join(root,'intent.json'));
 if(intent.format==='athanor-delivery-intent/v2'){const {id,createdAt,state,message,...content}=intent;if(id!==digest(content)||intent.messageHash!==digest(message))throw Error('Delivery intent changed; inspect before any send.');}else if(intent.format!=='athanor-delivery-intent/v1')throw Error('Unsupported delivery intent.');
 if(route&&digest(intent.destination)!==digest(verifyReportRoute(route)))throw Error('Delivery belongs to another destination.');
 const names=(await readdir(root)).filter(n=>/^receipt-\d{6}\.json$/.test(n)).sort(),history=await Promise.all(names.map(n=>readJSON(path.join(root,n))));
 return {intent,state:history.at(-1)?.receipt.state||intent.state,history};
}
export async function recordDelivery(directory,receipt,route=null){
 directory=externalPath(path.resolve(directory));const root=deliveryRoot(directory,route),{intent}=await inspectDelivery(directory,route);
 if(digest(await readJSON(path.join(directory,'report.json')))!==intent.reportHash)throw Error('Report changed after delivery intent.');
 if(receipt?.intentId!==intent.id||!['DELIVERY_CONFIRMED','DELIVERY_PENDING','DELIVERY_UNKNOWN'].includes(receipt.state)||typeof receipt.observation!=='string'||!receipt.observation.trim())throw Error('Record the exact retained intent and a delivery observation.');
 if(receipt.state==='DELIVERY_CONFIRMED'){
  const confirmedRoute=verifyReportRoute(receipt.route);
  if(digest(confirmedRoute)!==digest(intent.destination)||!/^\d+\.\d+$/.test(receipt.messageId||''))throw Error('Message identity or destination differs from the retained intent.');
  const url=new URL(receipt.messageUrl);
  if(url.origin!=='https://story-company.slack.com'||url.pathname!==`/archives/${confirmedRoute.channelId}/p${receipt.messageId.replace('.','')}`||url.search||url.hash)throw Error('Retain the exact Slack message URL and timestamp.');
 }
 const lock=path.join(root,'recording');await mkdir(lock);try{
  const {history}=await inspectDelivery(directory,route),previous=history.at(-1);
  if(previous&&digest(previous.receipt)===digest(receipt))return previous;
  if(previous?.receipt.state==='DELIVERY_CONFIRMED')throw Error('Delivery already has a confirmed receipt. Inspect it; do not resend or replace it.');
  const result={format:'athanor-delivery-receipt/v1',intentId:intent.id,reportHash:intent.reportHash,recordedAt:new Date().toISOString(),receipt};
  await writeFile(path.join(root,'receipt-'+String(history.length).padStart(6,'0')+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
 }finally{await rmdir(lock);}
}
