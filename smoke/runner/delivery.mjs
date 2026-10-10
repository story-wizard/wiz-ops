import path from 'node:path';
import {mkdir,writeFile,lstat,readdir,rmdir} from 'node:fs/promises';
import {digest,externalPath,readJSON} from './files.mjs';

export const ownerDelivery={workspace:'story-company',userId:'U0BDBFNU0G1',channel:'Slack one-to-one DM',email:false,jira:false};
export function verifyOwnerRoute(route){
 if(route?.workspace!==ownerDelivery.workspace||route.userId!==ownerDelivery.userId||route.type!=='im'||route.user!==ownerDelivery.userId||!/^D[A-Z0-9]+$/.test(route.channelId||''))throw Error('Verify Charles’s exact one-to-one Slack DM in Story Company. No alternate destination is allowed.');
 return {workspace:ownerDelivery.workspace,userId:ownerDelivery.userId,type:'im',user:ownerDelivery.userId,channelId:route.channelId};
}
export async function prepareDelivery(directory,route){
 directory=externalPath(path.resolve(directory));const reportFile=path.join(directory,'report.json');
 if(!(await lstat(reportFile)).isFile())throw Error('Delivery requires a retained regular report file.');
 const report=await readJSON(reportFile);
 if(!['athanor-nightly-report/v1','athanor-preparation-report/v1'].includes(report.format)||!report.identity?.build||!report.catalog)throw Error('Use a retained Athanor nightly or preparation report.');
 const destination=verifyOwnerRoute(route),identity=report.runId||report.preparation?.id;
 if(!identity||!['Passed','Failed','Blocked','Cancelled','Unknown'].includes(report.catalog.state))throw Error('Delivery requires a terminal run or blocked preparation.');
 const content={format:'athanor-delivery-intent/v1',reportHash:digest(report),identity,destination,policy:ownerDelivery};
 const intent={...content,id:digest(content),createdAt:new Date().toISOString(),message:`Athanor · ${report.identity.build}\n${report.runId?'Run':'Preparation'}: ${identity}\nOutcome: ${report.catalog.state}\nCatalog: ${JSON.stringify(report.catalog.counts)}\nFunctional assertions: ${JSON.stringify(report.assertionCounts||{})}\n${report.preparation?.error?'Preparation: '+report.preparation.error+'\n':''}Report retained on the testing Mac: ${directory}\nEvidence is local; no files uploaded.`,state:'DELIVERY_PENDING'};
 const output=path.join(directory,'delivery');await mkdir(output,{recursive:true,mode:0o700});
 await writeFile(path.join(output,'intent.json'),JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o600});
 return {intent,path:path.join(output,'intent.json'),networkDispatched:false};
}
export async function inspectDelivery(directory){
 directory=externalPath(path.resolve(directory));const root=path.join(directory,'delivery'),intent=await readJSON(path.join(root,'intent.json'));
 const names=(await readdir(root)).filter(n=>/^receipt-\d{6}\.json$/.test(n)).sort(),history=await Promise.all(names.map(n=>readJSON(path.join(root,n))));
 return {intent,state:history.at(-1)?.receipt.state||intent.state,history};
}
export async function recordDelivery(directory,receipt){
 directory=externalPath(path.resolve(directory));const root=path.join(directory,'delivery'),intent=await readJSON(path.join(root,'intent.json'));
 if(digest(await readJSON(path.join(directory,'report.json')))!==intent.reportHash)throw Error('Report changed after delivery intent.');
 if(receipt?.intentId!==intent.id||!['DELIVERY_CONFIRMED','DELIVERY_PENDING','DELIVERY_UNKNOWN'].includes(receipt.state)||typeof receipt.observation!=='string'||!receipt.observation.trim())throw Error('Record the exact retained intent and a delivery observation.');
 if(receipt.state==='DELIVERY_CONFIRMED'){
  const route=verifyOwnerRoute(receipt.route);
  if(digest(route)!==digest(intent.destination)||!/^\d+\.\d+$/.test(receipt.messageId||''))throw Error('Message identity or destination differs from the retained intent.');
  const url=new URL(receipt.messageUrl);
  if(url.origin!=='https://story-company.slack.com'||url.pathname!==`/archives/${route.channelId}/p${receipt.messageId.replace('.','')}`||url.search||url.hash)throw Error('Retain the exact Slack message URL and timestamp.');
 }
 const lock=path.join(root,'recording');await mkdir(lock);try{
  const {history}=await inspectDelivery(directory),previous=history.at(-1);
  if(previous&&digest(previous.receipt)===digest(receipt))return previous;
  if(previous?.receipt.state==='DELIVERY_CONFIRMED')throw Error('Delivery already has a confirmed receipt. Inspect it; do not resend or replace it.');
  const result={format:'athanor-delivery-receipt/v1',intentId:intent.id,reportHash:intent.reportHash,recordedAt:new Date().toISOString(),receipt};
  await writeFile(path.join(root,'receipt-'+String(history.length).padStart(6,'0')+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
 }finally{await rmdir(lock);}
}
