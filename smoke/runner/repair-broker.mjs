import path from 'node:path';
import {lstat,readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {repairPath,repairBytesHash as hash} from './repair-record.mjs';
import {inspectPublication,validatePublicationSource,validateRepairActor,repairRepository} from './repair-publisher.mjs';

export const brokerFiles=['smoke/runner/files.mjs','smoke/runner/repair-record.mjs','smoke/runner/repair-publisher.mjs','smoke/runner/repair-publisher-transport.mjs','smoke/runner/repair-broker.mjs','smoke/scripts/repair-publisher.mjs','smoke/scripts/repair-broker.mjs','runtime/node','runtime/gh'];
const requireValue=(v,code)=>{if(!v){const e=Error('Local broker stopped.');e.brokerCode=code;throw e;}};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameActor=(a,b)=>a?.id===b?.id&&a?.login===b?.login;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const safeID=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
async function bounded(file,max=4*1024*1024){const s=await lstat(await repairPath(file));requireValue(s.isFile()&&s.size<=max,'input_bounds');return readFile(file);}
function noACL(file){if(process.platform==='darwin'){const acl=execFileSync('/bin/ls',['-lde',file],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});requireValue(!/^\s*\d+:.*\ballow\b/m.test(acl),'acl_grant');}}
async function protectedPath(file,{ancestors=true,privateMode=false}={}){
 file=await repairPath(file);const s=await lstat(file);requireValue(s.uid===process.geteuid()&&!(s.mode&0o022)&&(!privateMode||!(s.mode&0o077)),'local_permissions');
 noACL(file);if(ancestors)for(let d=path.dirname(file);;d=path.dirname(d)){const p=await lstat(d);requireValue([0,process.geteuid()].includes(p.uid)&&!(p.mode&0o022),'ancestor_permissions');noACL(d);if(d===path.dirname(d))break;}
 return file;
}
async function identityRead(origin,route,token){
 try{const r=await fetch(new URL(route,origin),{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}});
  if(!r.ok){const e=Error();e.brokerCode='identity_http';e.httpStatus=r.status;throw e;}
  const chunks=[];let size=0;for await(const b of r.body){size+=b.length;requireValue(size<=1024*1024,'identity_bounds');chunks.push(b);}return JSON.parse(Buffer.concat(chunks));
 }catch(e){if(e.brokerCode)throw e;const error=Error();error.brokerCode='identity_unavailable';throw error;}
}
async function childPublisher({node,script,options,grant,cwd}){
 return new Promise((resolve,reject)=>{
  const child=spawn(node,[script,'publish','--artifacts',options.artifactDirectory,'--approval',options.approvalFile,'--journal',options.journalDirectory,'--bundle',options.sourceBundle,'--broker-grant-fd','3'],{cwd,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',HOME:cwd},stdio:['ignore','pipe','pipe','pipe']});
  let stdout='',size=0,ended=false;const timer=setTimeout(()=>{child.kill('SIGKILL');},120000);timer.unref();
  const finish=(error,result)=>{if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(result);};
  child.on('error',()=>{const e=Error();e.brokerCode='publisher_start';finish(e);});
  child.stdout.on('data',b=>{size+=b.length;if(size>65536)child.kill('SIGKILL');else stdout+=b;});child.stderr.on('data',()=>{});
  child.stdio[3].on('error',()=>{});child.stdio[3].end(JSON.stringify(grant));
  child.on('close',code=>{try{requireValue(code===0&&size<=65536,'publisher_unknown');requireValue(!stdout.includes(grant.token),'publisher_output');const result=JSON.parse(stdout);requireValue(['Confirmed','Unknown','Held','Conflict'].includes(result.state),'publisher_output');finish(null,result);}catch(e){finish(e);}});
 });
}
// Qualification overrides are loopback-only and are never accepted by the live CLI.
export async function runRepairBroker({policyFile,requestId,qualification,now=Date.now}){
 let token,work,identityVerified=false,publisherDispatched=false;
 try{
  requireValue(safeID(requestId),'request_id');requireValue(process.execArgv.length===0,'runtime_flags');
  requireValue(!Object.keys(process.env).some(k=>k==='NODE_OPTIONS'||k==='NODE_PATH'||k.startsWith('DYLD_')||k.startsWith('LD_')),'runtime_environment');
  let origin='https://api.github.com/';const offline=Boolean(qualification);
  if(offline){const u=new URL(qualification.apiOrigin);requireValue(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash,'qualification_origin');origin=u.href;}
  const policy=JSON.parse(await bounded(policyFile));requireValue(policy.format==='athanor-local-user-broker/v1'&&policy.localUID===process.geteuid()&&policy.repository===repairRepository&&Number.isSafeInteger(policy.repositoryId)&&policy.repositoryId>0,'local_policy');validateRepairActor(policy.actor);
  requireValue(Object.keys(policy).every(k=>['format','localUID','repository','repositoryId','actor','installRoot','stateRoot','credentialHome','inventory'].includes(k)),'policy_fields');
  const root=await repairPath(policy.installRoot),state=await repairPath(policy.stateRoot);requireValue(root!==state&&!state.startsWith(root+'/')&&!root.startsWith(state+'/'),'root_overlap');
  const protection={ancestors:!offline};await protectedPath(root,{...protection,privateMode:true});requireValue(path.resolve(policyFile)===path.join(root,'broker-policy.json'),'policy_location');await protectedPath(policyFile,protection);await protectedPath(state,{...protection,privateMode:true});await protectedPath(policy.credentialHome,protection);
  const required=[...brokerFiles,...(offline?['smoke/tests/broker-child.mjs']:[])].sort();requireValue(Array.isArray(policy.inventory)&&same(policy.inventory.map(x=>x.file).sort(),required),'installed_inventory');
  for(const item of policy.inventory){requireValue(hex(item.sha256),'installed_inventory');const file=path.join(root,item.file);await protectedPath(file,protection);requireValue(hash(await bounded(file,150*1024*1024))===item.sha256,'installed_bytes');}
  requireValue(path.resolve(process.execPath)===path.join(root,'runtime/node'),'runtime_identity');
  const request=path.join(root,'requests',requestId);await protectedPath(request,protection);await protectedPath(path.join(request,'review.json'),protection);const review=JSON.parse(await bounded(path.join(request,'review.json')));
  requireValue(review.format==='athanor-local-user-request/v1'&&review.requestId===requestId&&review.policySHA256===hash(await bounded(policyFile))&&sameActor(review.actor,policy.actor)&&Object.keys(review).every(k=>['format','requestId','actor','policySHA256','files'].includes(k)),'review_identity');
  const options={artifactDirectory:path.join(request,'export'),approvalFile:path.join(request,'approval.json'),sourceBundle:path.join(request,'source.bundle'),journalDirectory:path.join(state,'journal')};await protectedPath(options.artifactDirectory,protection);const plan=await inspectPublication(options);requireValue(sameActor(plan.approval.actor,policy.actor),'approval_actor');
  const names=['approval.json','source.bundle','export/manifest.json','export/repair.patch','export/PR-PREVIEW.md',...plan.approval.proofs.map(p=>'proof-'+p.kind+'.json')].sort();
  requireValue(Array.isArray(review.files)&&same(review.files.map(f=>f.file).sort(),names),'review_inventory');requireValue(same((await readdir(request)).sort(),['approval.json','export','review.json','source.bundle',...plan.approval.proofs.map(p=>'proof-'+p.kind+'.json')].sort()),'request_inventory');
  for(const item of review.files){requireValue(hex(item.sha256),'review_inventory');const file=path.join(request,item.file);await protectedPath(file,protection);requireValue(hash(await bounded(file,50*1024*1024))===item.sha256,'request_bytes');}
  for(const proof of plan.approval.proofs){const raw=await bounded(path.join(request,'proof-'+proof.kind+'.json')),receipt=JSON.parse(raw);requireValue(hash(raw)===proof.receiptSHA256&&receipt.status==='Pass'&&['kind','head','patchSHA256','failed','skipped',...(proof.tests===undefined?[]:['tests'])].every(k=>receipt[k]===proof[k]),'proof_receipt');}
  requireValue(Date.parse(plan.approval.expiresAt)>now(),'approval_expired');work=await mkdtemp(path.join(state,'validation-'));await validatePublicationSource(plan,options.sourceBundle,work);await rm(work,{recursive:true,force:true});work=null;
  // Explicitly select the approved developer. Ambient tokens and SSH agents are omitted.
  try{token=execFileSync(path.join(root,'runtime/gh'),['auth','token','--hostname','github.com','--user',policy.actor.login],{encoding:'utf8',timeout:15000,maxBuffer:8192,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:policy.credentialHome,LC_ALL:'C'}}).trim();}catch{requireValue(false,'credential_unavailable');}
  requireValue(typeof token==='string'&&token.length>0&&token.length<=4096&&!/[\r\n]/.test(token),'credential_unavailable');
  const user=await identityRead(origin,'/user',token);requireValue(user.id===policy.actor.id&&user.login===policy.actor.login&&user.type==='User','credential_actor');
  const repo=await identityRead(origin,'/repos/'+repairRepository,token);requireValue(repo.id===policy.repositoryId&&repo.full_name===repairRepository&&repo.permissions?.push===true,'repository_capability');identityVerified=true;
  const grant={kind:'github-user',repository:repairRepository,actor:policy.actor,repositoryWrite:true,approvalSHA256:plan.approvalSHA256,expiresAt:new Date(Math.min(now()+1800000,Date.parse(plan.approval.expiresAt))).toISOString(),journalDirectory:options.journalDirectory,token,...(offline?{qualification:qualification.publisher}:{})};
  publisherDispatched=true;const publication=await childPublisher({node:path.join(root,'runtime/node'),script:path.join(root,offline?'smoke/tests/broker-child.mjs':'smoke/scripts/repair-publisher.mjs'),options,grant,cwd:state});
  return {state:publication.state,publication,actor:policy.actor,identityVerified,boundary:offline?'SyntheticOnly':'DeveloperLocalManual',tokenScope:'Not asserted; Ops transport restricts writes'};
 }catch(error){return {state:publisherDispatched?'Unknown':'Held',reason:error.brokerCode||'broker_validation',...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{}),identityVerified,publicationOutcome:'Inspect authoritative publisher journal before any further write'};}
 finally{if(work)await rm(work,{recursive:true,force:true});token=null;}
}
