import path from 'node:path';
import {readFile,readdir,mkdir,open,rm,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {externalPath,inside} from './files.mjs';
import {repairBytesHash as hash,repairPath,repairSourcePath,repairFamily} from './repair-record.mjs';

export const repairRepository='story-wizard/wiz-ops';
const ok=(condition,message)=>{if(!condition){const error=Error(message);error.safeReason=message;error.diagnostic={stage:'validation',code:'review_rejected'};throw error;}};
export function publisherDiagnostic(error){
 const d=error?.diagnostic;
 if(!d||!['validation','read_ref','list_prs','push','create_pr'].includes(d.stage)||!['review_rejected','http_status','response_invalid','unavailable','git_exit'].includes(d.code))return {stage:'validation',code:'unavailable'};
 return {stage:d.stage,code:d.code,...(Number.isInteger(d.httpStatus)&&d.httpStatus>=100&&d.httpStatus<=599?{httpStatus:d.httpStatus}:{}),...(Number.isInteger(d.exitCode)&&d.exitCode>=0&&d.exitCode<=255?{exitCode:d.exitCode}:{})};
}
const fields=(v,keys)=>ok(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k)),'Invalid publisher field.');
const sha=(v,n=64)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const branch=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9/_-]{0,150}$/.test(v)&&!v.endsWith('/')&&!v.includes('//');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const gitEnv={PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false',SSH_ASKPASS:'/usr/bin/false',LC_ALL:'C'};
export function publisherGit(root,args,{env={},input}={}){
 return execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','credential.helper=','-c','core.attributesFile=/dev/null','-c','protocol.allow=never','-c','protocol.file.allow=always','-c','http.followRedirects=false',...(root?['-C',root]:[]),...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,env:{...gitEnv,...env},input,stdio:['pipe','pipe','pipe']});
}
function allowedPath(file){
 repairSourcePath(file);
 ok(!/^smoke\/examples\/(?:workers|nightly)(?:\/|\.)/.test(file)&&!/(?:^|\/)(?:credentials?|secrets?|access-policy|publisher-policy)(?:[/.]|$)/i.test(file),'Publisher policy excludes configuration or credential paths.');
 return file;
}
async function bytes(file,maximum=4*1024*1024){
 file=await repairPath(file);const info=await lstat(file);ok(info.isFile()&&info.size<=maximum,'Publisher input must be a bounded regular file.');return readFile(file);
}
export async function readPublicationApproval(file){const raw=await bytes(file);return {value:JSON.parse(raw),sha256:hash(raw)};}
export function publicationBody(preview,repairId,manifestHash){return preview+`\n<!-- athanor-repair:${repairId};manifest:${manifestHash} -->\n`;}

export async function inspectPublication({artifactDirectory,approvalFile}){
 artifactDirectory=await repairPath(artifactDirectory);approvalFile=await repairPath(approvalFile);
 ok(!inside(artifactDirectory,approvalFile),'Approval must be outside the repair export.');
 const names=(await readdir(artifactDirectory)).sort();ok(equal(names,['PR-PREVIEW.md','manifest.json','repair.patch']),'Only the three reviewed export files are accepted.');
 const manifestBytes=await bytes(path.join(artifactDirectory,'manifest.json')),manifest=JSON.parse(manifestBytes),manifestHash=hash(manifestBytes),approval=await readPublicationApproval(approvalFile),a=approval.value;
 fields(a,['format','id','repository','repairId','manifestSHA256','base','head','paths','title','bodySHA256','commitSHA256','proofs','expiresAt','action','actor']);
 ok(a.format==='athanor-repair-publication-approval/v1'&&a.action==='create-draft-pr'&&typeof a.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(a.id),'Use an explicit draft-publication approval.');
 if(a.actor!==undefined)validateRepairActor(a.actor);
 fields(a.base,['branch','sha']);fields(a.head,['branch','sha','tree']);
 ok(a.repository===repairRepository&&sha(a.repairId)&&a.manifestSHA256===manifestHash&&sha(a.commitSHA256)&&sha(a.bodySHA256),'Approval does not identify the exact Ops artifact.');
 ok(branch(a.base.branch)&&branch(a.head.branch)&&a.head.branch.startsWith('athanor/')&&a.head.branch!==a.base.branch&&sha(a.base.sha,40)&&sha(a.head.sha,40)&&sha(a.head.tree,40)&&Number.isFinite(Date.parse(a.expiresAt)),'Invalid approved source or expiry.');
 fields(manifest,['format','mode','repairId','repository','contract','source','dependencies','gates','publication','files']);
 ok(manifest.format==='athanor-repair-preview/v1'&&manifest.mode==='preview'&&manifest.repository===repairRepository&&manifest.repairId===a.repairId&&repairFamily(manifest.repository,manifest.contract)===a.repairId,'Manifest family or repository differs.');
 fields(manifest.source,['base','head','tree','canonicalMain','branch','basedOnDependency','reviewedPaths']);
 const s=manifest.source;ok(s.base===a.base.sha&&s.head===a.head.sha&&s.tree===a.head.tree&&s.branch===a.head.branch&&sha(s.canonicalMain,40)&&s.basedOnDependency===(s.base!==s.canonicalMain),'Approval source differs from the reviewed manifest.');
 ok(Array.isArray(a.paths)&&a.paths.length>0&&a.paths.length<=100&&new Set(a.paths).size===a.paths.length&&Array.isArray(s.reviewedPaths)&&equal([...a.paths].sort(),[...s.reviewedPaths].sort()),'Approval must name every reviewed source path.');a.paths.forEach(allowedPath);
 ok(Array.isArray(manifest.files)&&manifest.files.length===2,'Invalid artifact inventory.');const content={};
 for(const item of manifest.files){fields(item,['file','bytes','sha256']);ok(['repair.patch','PR-PREVIEW.md'].includes(item.file)&&!content[item.file]&&sha(item.sha256),'Invalid artifact member.');const raw=await bytes(path.join(artifactDirectory,item.file));ok(raw.length===item.bytes&&hash(raw)===item.sha256,'Artifact bytes changed after review.');content[item.file]=raw;}
 ok(content['repair.patch']&&content['PR-PREVIEW.md'],'Incomplete export.');
 const preview=content['PR-PREVIEW.md'].toString('utf8'),body=publicationBody(preview,a.repairId,manifestHash);
 ok(typeof a.title==='string'&&a.title.length>0&&a.title.length<=180&&!/[\r\n\0]/.test(a.title)&&preview.startsWith('# '+a.title+'\n')&&hash(body)===a.bodySHA256,'Approved PR title/body bytes differ.');
 fields(manifest.gates,['framework','scope','native','packaged','ci']);ok(Object.values(manifest.gates).every(v=>['Pass','Fail','Skipped','Pending'].includes(v)),'Invalid proof gates.');
 ok(Array.isArray(a.proofs)&&a.proofs.length<=5&&new Set(a.proofs.map(p=>p.kind)).size===a.proofs.length,'Invalid approved proof.');
 const required=new Set(['framework','scope']);if(a.paths.some(p=>/^smoke\/desktop\//.test(p)))required.add('native');
 for(const proof of a.proofs){fields(proof,['kind','head','patchSHA256','receiptSHA256','tests','failed','skipped']);ok(['framework','scope','native'].includes(proof.kind)&&proof.head===s.head&&proof.patchSHA256===hash(content['repair.patch'])&&sha(proof.receiptSHA256)&&proof.failed===0&&Number.isSafeInteger(proof.skipped)&&proof.skipped>=0,'Proof is not bound to the reviewed subject.');ok(manifest.gates[proof.kind]==='Pass','Required proof is not passing.');if(proof.kind!=='scope')ok(Number.isSafeInteger(proof.tests)&&proof.tests>0,'Required check must execute.');if(proof.kind==='native')ok(proof.skipped===0,'Required native proof cannot skip.');required.delete(proof.kind);}
 ok(required.size===0,'Required executed local/framework/scope/native proof is missing.');
 fields(manifest.publication,['state','url','writeAuthorized']);ok(['NotPublished','Unknown','Conflict','VerifiedIdentity'].includes(manifest.publication.state)&&manifest.publication.writeAuthorized===false,'Repair export cannot grant publication authority.');
 ok(Array.isArray(manifest.dependencies)&&manifest.dependencies.length<=12,'Invalid public dependencies.');for(const d of manifest.dependencies){fields(d,['repository','head','patchSha256','pr']);ok(/^story-wizard\/[a-z0-9-]+$/.test(d.repository)&&(!d.head||sha(d.head,40))&&(!d.patchSha256||sha(d.patchSha256))&&(!d.pr||Number.isSafeInteger(d.pr)&&d.pr>0),'Invalid dependency identity.');}
 return {approval:a,approvalSHA256:approval.sha256,manifest,manifestHash,body,patch:content['repair.patch'],artifactDirectory};
}
export function validateRepairActor(actor){fields(actor,['id','login']);ok(Number.isSafeInteger(actor.id)&&actor.id>0&&typeof actor.login==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(actor.login),'Use the reviewed immutable GitHub actor identity.');return actor;}
function lease(grant,plan,now){
 const a=plan.approval;
 const app=grant?.kind==='github-app-installation'&&equal(grant.repositories,[repairRepository])&&Array.isArray(grant.permissions)&&grant.permissions.includes('contents:write')&&grant.permissions.includes('pull_requests:write');
 const user=grant?.kind==='github-user'&&a.actor&&grant.actor?.id===a.actor.id&&grant.actor?.login===a.actor.login&&grant.repositoryWrite===true;
 ok(grant&&grant.repository===repairRepository&&grant.approvalSHA256===plan.approvalSHA256&&(a.actor?user:app),'A separate repository-scoped or actor-bound broker grant is required.');
 ok(Date.parse(a.expiresAt)>now()&&Date.parse(grant.expiresAt)>now()&&Date.parse(grant.expiresAt)<=now()+3600000,'Publication approval or short-lived grant expired.');
}
async function durable(file,value){
 const fd=await open(file,'wx',0o600);try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}
 const parent=await open(path.dirname(file),'r');try{await parent.sync();}finally{await parent.close();}
}
export async function inspectPublisherJournal(journalDirectory,repairId){
 ok(sha(repairId),'Invalid publisher family.');const directory=path.join(externalPath(await repairPath(journalDirectory)),repairId);let names;try{names=(await readdir(directory)).filter(x=>/^event-\d{6}\.json$/.test(x)).sort();}catch(e){if(e.code==='ENOENT')return {state:'NotStarted',history:[]};throw e;}
 let prior=null;const history=[];for(let i=0;i<names.length;i++){ok(names[i]===`event-${String(i).padStart(6,'0')}.json`,'Publisher history has a gap.');const raw=await bytes(path.join(directory,names[i])),event=JSON.parse(raw);ok(event.repairId===repairId&&event.sequence===i&&event.previousSHA256===prior,'Publisher history changed.');history.push(event);prior=hash(raw);}
 return {directory,state:history.at(-1)?.state||'NotStarted',history,lastSHA256:prior};
}
export {stageSource as validatePublicationSource};
async function stageSource(plan,bundle,directory){
 const file=await repairPath(bundle);ok((await lstat(file)).isFile()&&(await lstat(file)).size<=50*1024*1024,'Use a bounded source bundle.');
 const root=path.join(directory,'source.git');await mkdir(root);publisherGit(null,['init','--bare','--template=',root]);
 publisherGit(root,['fetch','--no-tags','--no-write-fetch-head','--no-recurse-submodules','--',file,plan.approval.head.sha]);
 const a=plan.approval,parents=publisherGit(root,['show','-s','--format=%P',a.head.sha]).trim();ok(parents===a.base.sha,'Only one reviewed linear publication commit directly on the approved base is allowed.');
 ok(publisherGit(root,['rev-parse',a.head.sha+'^{tree}']).trim()===a.head.tree,'Reviewed tree differs.');
 const commit=publisherGit(root,['cat-file','commit',a.head.sha]);ok(hash(commit)===a.commitSHA256,'Commit metadata bytes were not approved.');
 const paths=publisherGit(root,['diff','--no-renames','--name-only','-z',a.base.sha,a.head.sha,'--']).split('\0').filter(Boolean);paths.forEach(allowedPath);ok(equal(paths.sort(),[...a.paths].sort()),'Git objects contain unapproved paths.');
 for(const p of paths)for(const ref of [a.base.sha,a.head.sha])ok(!publisherGit(root,['ls-tree',ref,'--',p]).startsWith('120000'),'Source symlinks cannot be published.');
 const patch=publisherGit(root,['diff','--binary','--no-ext-diff','--no-textconv','--no-renames',a.base.sha,a.head.sha,'--']);ok(Buffer.from(patch).equals(plan.patch),'Git source differs from the approved public patch.');return root;
}
function prReceipt(pr,a){
 return {number:pr.number,html_url:pr.html_url,state:pr.state,draft:pr.draft,...(a.actor?{actor:{id:pr.user?.id,login:pr.user?.login}}:{}),head:{ref:pr.head?.ref,sha:pr.head?.sha,repo:{full_name:pr.head?.repo?.full_name}},base:{ref:pr.base?.ref,sha:pr.base?.sha,repo:{full_name:pr.base?.repo?.full_name}}};
}
function exactPR(pr,plan){
 const a=plan.approval;return Number.isSafeInteger(pr.number)&&pr.number>0&&pr.html_url===`https://github.com/${repairRepository}/pull/${pr.number}`&&pr.head?.repo?.full_name===repairRepository&&pr.base?.repo?.full_name===repairRepository&&pr.head?.ref===a.head.branch&&pr.head?.sha===a.head.sha&&pr.base?.ref===a.base.branch&&pr.state==='open'&&pr.draft===true&&(!a.actor||pr.user?.id===a.actor.id&&pr.user?.login===a.actor.login);
}
export async function publishRepair({artifactDirectory,approvalFile,journalDirectory,sourceBundle,grant,transport,now=Date.now}){
 const plan=await inspectPublication({artifactDirectory,approvalFile}),a=plan.approval;lease(grant,plan,now);
 const journal=externalPath(await repairPath(journalDirectory));ok(!inside(plan.artifactDirectory,journal)&&!inside(journal,plan.artifactDirectory)&&journal!==plan.artifactDirectory,'Publisher journal must be separate from repair artifacts.');
 ok(grant.journalDirectory===journal,'Use the broker-owned authoritative journal root.');
 await mkdir(journal,{recursive:true,mode:0o700});const directory=path.join(journal,a.repairId);await mkdir(directory,{recursive:true,mode:0o700});
 // SQLite releases the writer lock on process death; retained intents survive separately.
 const lock=new DatabaseSync(await repairPath(path.join(directory,'lock.sqlite')));
 try{lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');}catch{lock.close();throw Error('Another publisher owns this family. Inspect retained intent.');}
 try{
  let state=await inspectPublisherJournal(journal,a.repairId);
  const append=async(next,receipt,diagnostic)=>{const event={format:'athanor-repair-publication-event/v1',sequence:state.history.length,repairId:a.repairId,approvalSHA256:plan.approvalSHA256,manifestSHA256:plan.manifestHash,previousSHA256:state.lastSHA256||null,state:next,...(receipt?{receipt}:{}),...(diagnostic?{diagnostic}:{})};await durable(path.join(directory,`event-${String(event.sequence).padStart(6,'0')}.json`),event);state=await inspectPublisherJournal(journal,a.repairId);return state;};
  if(state.history.some(e=>e.approvalSHA256!==plan.approvalSHA256||e.manifestSHA256!==plan.manifestHash))return {state:'Conflict',reason:'Family already has a different publication subject; updates are outside this slice.'};
  if(state.state==='Conflict')return {state:'Conflict',reason:'Retained conflict requires review.'};
  let base,head,prs;try{[base,head,prs]=await Promise.all([transport.readRef(a.base.branch),transport.readRef(a.head.branch),transport.listPRs()]);}catch(error){return {state:state.history.length?'Unknown':'Held',reason:'Remote identity lookup is incomplete; no write dispatched.',diagnostic:publisherDiagnostic(error)};}
  const marker=`<!-- athanor-repair:${a.repairId};`,candidates=prs.filter(p=>p.head?.ref===a.head.branch||typeof p.body==='string'&&p.body.includes(marker));
  if(candidates.length){if(candidates.length===1&&head===a.head.sha&&exactPR(candidates[0],plan)){await append('Confirmed',prReceipt(candidates[0],a));return {state:'Confirmed',receipt:state.history.at(-1).receipt,reused:true};}await append('Conflict');return {state:'Conflict',reason:'Existing PR identity or state differs.'};}
  if(base!==a.base.sha||head&&head!==a.head.sha){await append('Conflict');return {state:'Conflict',reason:'Approved base or branch identity changed.'};}
  if(state.history.some(e=>['CreateIntent','CreateUnknown','Confirmed'].includes(e.state))||['Unknown','Conflict','VerifiedIdentity'].includes(plan.manifest.publication.state)){if(!state.history.length)await append('CreateUnknown');return {state:'Unknown',reason:'Absent PR readback does not authorize another create.'};}
  if(['PushIntent','PushUnknown'].includes(state.state)&&head!==a.head.sha)return {state:'Unknown',reason:'Uncertain push has no confirmed exact ref; do not push again.'};
  const staging=path.join(directory,'staging');await rm(staging,{recursive:true,force:true});await mkdir(staging);let source;
  try{source=await stageSource(plan,sourceBundle,staging);
   if(!head){lease(grant,plan,now);await append('PushIntent');try{await transport.push({source,head:a.head.sha,branch:a.head.branch});}catch(error){const diagnostic=publisherDiagnostic(error);await append('PushUnknown',null,diagnostic);return {state:'Unknown',reason:'Push response was lost or rejected; reconcile before any further write.',diagnostic};}
    try{head=await transport.readRef(a.head.branch);}catch{head=null;}if(head!==a.head.sha){await append('PushUnknown');return {state:'Unknown',reason:'Pushed ref was not verified.'};}
   }
   await append('BranchVerified');lease(grant,plan,now);
   try{if(await transport.readRef(a.base.branch)!==a.base.sha||await transport.readRef(a.head.branch)!==a.head.sha){await append('Conflict');return {state:'Conflict',reason:'Remote changed before PR creation.'};}}catch(error){return {state:'Held',reason:'Remote verification incomplete.',diagnostic:publisherDiagnostic(error)};}
   lease(grant,plan,now);await append('CreateIntent');let pr;try{pr=await transport.createDraft({title:a.title,body:plan.body,head:a.head.branch,base:a.base.branch,draft:true,maintainer_can_modify:false});}catch(error){const diagnostic=publisherDiagnostic(error);await append('CreateUnknown',null,diagnostic);return {state:'Unknown',reason:'PR outcome unknown; inspect, never create again.',diagnostic};}
   if(!exactPR(pr,plan)){await append('Conflict');return {state:'Conflict',reason:'Created PR did not match the exact approved identity.'};}
   await append('Confirmed',prReceipt(pr,a));return {state:'Confirmed',receipt:state.history.at(-1).receipt,reused:false};
  }finally{await rm(staging,{recursive:true,force:true});}
 }finally{lock.close();}
}
