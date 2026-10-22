#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readSync,closeSync} from 'node:fs';
import {inspectPublication,publishRepair,inspectPublisherJournal,publisherDiagnostic} from '../runner/repair-publisher.mjs';
import {githubRepairTransport} from '../runner/repair-publisher-transport.mjs';

try{
 const {values:v,positionals}=parseArgs({allowPositionals:true,options:{artifacts:{type:'string'},approval:{type:'string'},journal:{type:'string'},bundle:{type:'string'},id:{type:'string'},'broker-grant-fd':{type:'string'}}});
 if(positionals.length!==1)throw Error('Use inspect, journal or publish. No ambient credentials are used.');
 const options={artifactDirectory:v.artifacts,approvalFile:v.approval,journalDirectory:v.journal,sourceBundle:v.bundle};let result;
 if(positionals[0]==='inspect'){const p=await inspectPublication(options);result={state:'ReviewedArtifact',approvalSHA256:p.approvalSHA256,manifestSHA256:p.manifestHash,repairId:p.approval.repairId,source:p.manifest.source,writeDispatched:false};}
 else if(positionals[0]==='journal')result=await inspectPublisherJournal(v.journal,v.id);
 else if(positionals[0]==='publish'){
  const fd=Number(v['broker-grant-fd']);if(!Number.isInteger(fd)||fd<3)throw Error('Publish requires an external trusted broker grant descriptor.');
  let grant;try{const raw=Buffer.alloc(8193);let size=0,count;while(size<raw.length&&(count=readSync(fd,raw,size,raw.length-size,null)))size+=count;if(size>8192)throw Error();grant=JSON.parse(raw.subarray(0,size).toString('utf8'));}catch{throw Error('Private broker grant is unavailable.');}finally{closeSync(fd);}
  const plan=await inspectPublication(options),transport=githubRepairTransport({grant,plan});
  const {token,...permission}=grant;result=await publishRepair({...options,grant:permission,transport});
 }else throw Error('Unknown publisher command.');
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({state:'Held',reason:error.safeReason||'Publisher stopped. Inspect the approved inputs and external journal.',diagnostic:publisherDiagnostic(error)}));process.exitCode=1;}
