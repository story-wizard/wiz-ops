import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,readFile,readdir,mkdir,writeFile,rm} from 'node:fs/promises';
import {digest,externalPath,writeJSON} from './files.mjs';

const repository='story-wizard/wiz-ops', format='athanor-local-repair-record/v1';
const hex=(s,n)=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(s);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const fields=(v,keys)=>requireValue(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k)),'Unknown or invalid repair field.');
const text=(v,max=12000)=>{requireValue(typeof v==='string'&&v.trim().length>0&&v.length<=max,'Provide bounded repair text.');return v;};
const git=(root,...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export {byteHash as repairBytesHash,noLinks as repairPath,scopePath as repairSourcePath};

export function repairFamily(repository,contract){
 requireValue(/^story-wizard\/[a-z0-9-]+$/.test(repository),'Use a Story repository identity.');
 fields(contract,['id','version']);requireValue(/^[a-z0-9][a-z0-9-]{2,100}$/.test(contract.id)&&/^[1-9][0-9]*$/.test(contract.version),'Use a stable behavior contract ID and version.');
 return digest([repository,contract.id,contract.version]);
}
export function repairTaskLink(investigationId){
 return {mode:'preview-only',recordsDirectory:'repair-records',guide:'docs/build-repair.md#retain-and-export-a-repair',
  findCommand:['node','scripts/repair.mjs','list','--data-dir','EXTERNAL_WORKSPACE','--investigation',investigationId],
  nextCommand:['node','scripts/repair.mjs','record','--data-dir','EXTERNAL_WORKSPACE','--input','REVIEWED_REPAIR_INPUT.json'],
  instructions:'Use this existing repair task, an evidence-backed classification and a versioned behavior contract. Preserve the original report. Local record/export grants no execution or publication authority.'};
}
// Reject links in every existing component, including links that currently resolve inside scope.
async function noLinks(file){
 requireValue(path.isAbsolute(file),'Use an absolute local path.');
 const resolved=path.resolve(file);let current=path.parse(resolved).root;
 for(const part of resolved.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);let stat;try{stat=await lstat(current);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  requireValue(!stat.isSymbolicLink(),'Symlink paths are not allowed in repair records or exports.');
 }
 return resolved;
}
async function jsonFile(file){
 file=await noLinks(file);const bytes=await readFile(file);requireValue(bytes.length<=4*1024*1024,'Repair input exceeds bounds.');
 return {value:JSON.parse(bytes),sha256:byteHash(bytes),path:file};
}
export const readRepairInput=async file=>(await jsonFile(file)).value;
async function directory(dataDir){const dir=externalPath(await noLinks(dataDir));await mkdir(path.join(dir,'repair-records'),{recursive:true,mode:0o700});return path.join(dir,'repair-records');}
function scopePath(file){
 requireValue(typeof file==='string'&&/^smoke\/(?:[A-Za-z0-9_-]+\.mjs|AGENTS\.md|README\.md|package\.json|(?:desktop|runner|scripts|tests|docs|examples|public)\/[A-Za-z0-9_./-]+\.(?:mjs|js|cpp|h|md|txt|json|css|html|sh))$/.test(file)&&!/^smoke\/(?:credentials?|secrets?|access-policy|publisher-policy|private-config)(?:[.-]|$)/i.test(file)&&file.split('/').every(p=>p&&!p.startsWith('.')),'Path is outside the allowed harness source scope.');
 return file;
}
function sourceIdentity(s){
 fields(s,['base','head','canonicalMain','branch','reviewedPaths','patchSha256','reviewedPatch','reviewer']);
 requireValue(hex(s.base,40)&&hex(s.head,40)&&hex(s.canonicalMain,40)&&hex(s.patchSha256,64),'Provide exact base/head/main and reviewed patch identities.');
 requireValue(typeof s.branch==='string'&&/^[A-Za-z0-9][A-Za-z0-9/_-]{0,150}$/.test(s.branch),'Invalid repair branch.');
 requireValue(Array.isArray(s.reviewedPaths)&&s.reviewedPaths.length>0&&s.reviewedPaths.length<=100&&new Set(s.reviewedPaths).size===s.reviewedPaths.length,'List each reviewed source path exactly once.');
 s.reviewedPaths.forEach(scopePath);text(s.reviewer,200);text(s.reviewedPatch);return s;
}
function publicCopy(p){
 fields(p,['title','problem','change','validation','remaining']);const out={};
 for(const key of ['title','problem','change','validation','remaining']){
  const value=text(p[key],key==='title'?180:2000);
  requireValue(!/[\u0000-\u001f\u007f`<>]|https?:\/\/|file:|\/Users\/|\/private\/|\/tmp\/|\/home\/|[A-Za-z]:\\|Bearer\s|gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|(?:secret|token|password)\s*[:=]|\$\(|(?:^|\s)(?:curl|bash|sudo|ssh)\s/i.test(value),'Public summary contains a private path, credential, command or markup.');
  out[key]=value;
 }
 return out;
}
function dependencies(items=[]){
 requireValue(Array.isArray(items)&&items.length<=12,'Invalid repair dependencies.');
 return items.map(d=>{fields(d,['repository','head','patchSha256','pr','evidence']);requireValue(/^story-wizard\/[a-z0-9-]+$/.test(d.repository),'Invalid dependency repository.');
  if(d.head!==undefined)requireValue(hex(d.head,40),'Invalid dependency head.');if(d.patchSha256!==undefined)requireValue(hex(d.patchSha256,64),'Invalid dependency patch.');
  if(d.pr!==undefined)requireValue(Number.isSafeInteger(d.pr)&&d.pr>0,'Invalid dependency PR.');return d;});
}
export function repairGates(record){
 return Object.fromEntries(['framework','scope','native','packaged','ci'].map(kind=>{
  const proof=record.proofs.filter(p=>p.kind===kind&&p.head===record.source?.head&&p.patchSha256===record.source?.patchSha256).at(-1);
  return [kind,proof?.status||'Pending'];
 }));
}
function proofs(items,source){
 requireValue(Array.isArray(items)&&items.length<=30,'Invalid proof list.');
 return items.map(p=>{fields(p,['kind','head','patchSha256','status','tests','failed','skipped','evidence','packageHash']);
  requireValue(['framework','scope','native','packaged','ci'].includes(p.kind)&&['Pass','Fail','Skipped','Pending'].includes(p.status),'Invalid proof kind or status.');
  requireValue(p.head===source?.head&&p.patchSha256===source?.patchSha256,'Proof must name the current exact head and patch.');text(p.evidence);
  if(p.status==='Pass')requireValue((p.failed||0)===0,'Failed checks cannot provide passing proof.');
  for(const k of ['tests','failed','skipped'])if(p[k]!==undefined)requireValue(Number.isSafeInteger(p[k])&&p[k]>=0,'Invalid proof count.');
  if(p.kind==='native'&&p.status==='Pass')requireValue(p.tests>0&&p.failed===0&&p.skipped===0,'Required native qualification must execute with zero failures or skips.');
  if(p.kind==='packaged'&&p.status==='Pass')requireValue(hex(p.packageHash,64),'Passing packaged proof requires the exact package hash.');
  return p;
 });
}
export async function readRepair(dataDir,id){
 requireValue(hex(id,64),'Invalid repair ID.');const file=path.join(await directory(dataDir),id+'.json');const {value}=await jsonFile(file);
 requireValue(value.format===format&&value.id===id&&repairFamily(value.repository,value.contract)===id,'Repair record identity differs.');return value;
}
export async function listRepairs(dataDir,investigationId){
 const dir=await directory(dataDir),records=[];
 for(const file of (await readdir(dir)).sort())if(/^[a-f0-9]{64}\.json$/.test(file)){
  const r=await readRepair(dataDir,file.slice(0,-5));if(!investigationId||r.occurrences.some(o=>o.investigationId===investigationId))records.push({id:r.id,repository:r.repository,contract:r.contract,classification:r.classification.kind,occurrences:r.occurrences.length,head:r.source?.head||null,gates:repairGates(r),publication:r.publication.state,record:path.join(dir,file)});
 }
 return records;
}

export async function recordRepair(dataDir,input){
 fields(input,['requestId','revision','repository','contract','classification','taskFile','campaignReport','syntheticControl','caseId','reportSha256','source','public','dependencies','proofs','publication','prReceipt','legacyRecord']);
 text(input.requestId,150);const id=repairFamily(input.repository,input.contract),dir=await directory(dataDir),lock=path.join(dir,'.lock');
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Error('Another repair update holds the workspace lock; inspect before retrying.');throw e;}
 try{
  let previous=null;try{previous=await readRepair(dataDir,id);}catch(e){if(e.code!=='ENOENT')throw e;}
  const requestHash=digest(input),prior=previous?.ingestions.find(x=>x.requestId===input.requestId);
  if(prior){requireValue(prior.sha256===requestHash,'Repair request ID has conflicting content.');return previous;}
  requireValue(input.revision===(previous?.revision||0),'Repair changed; reload the current revision.');
  requireValue(Boolean(input.taskFile)!==Boolean(input.campaignReport),'Choose an existing investigation task or an explicit campaign report.');
  const task=input.taskFile?await jsonFile(input.taskFile):null,t=task?.value,c=t?.cases?.find(c=>c.id===input.caseId);
  if(task)requireValue(t.format==='athanor-investigation-task/v1'&&t.task==='repair'&&c&&typeof t.investigationId==='string'&&Number.isSafeInteger(t.revision),'Use an existing case-bound investigation repair task.');
  fields(input.classification,['kind','reason','evidence']);const classification=input.classification;
  requireValue(['Harness','Environment','App','Unresolved'].includes(classification.kind)&&(!task||classification.kind===c.classification),'Classification must agree with the reviewed investigation task.');text(classification.reason);
  requireValue(Array.isArray(classification.evidence)&&classification.evidence.length>0&&classification.evidence.every(e=>typeof e==='string'&&e.length>0),'Classification requires evidence references.');
  const report=await jsonFile(task?t.baselineReport.path:input.campaignReport),original=(task?report.value.cases:report.value.checks)?.find(x=>x.id===input.caseId),runId=task?report.value.runId:report.value.jobId;
  requireValue(hex(input.reportSha256,64)&&report.sha256===input.reportSha256&&original&&typeof runId==='string'&&(!task||runId===t.baselineReport.runId),'Original report identity changed or case is absent.');
  requireValue(['Pass','Fail','Blocked','Unknown','Not run'].includes(original.status),'Invalid original verdict.');
  if(t?.baselineReport.hash)requireValue(digest(report.value)===t.baselineReport.hash,'Original report contract hash differs.');
  if(input.syntheticControl!==undefined)requireValue(input.syntheticControl===true,'Synthetic control flag must be explicit true.');
  const occurrence={id:digest([task?'investigation':'campaign',runId,input.caseId]),origin:task?'investigation':'campaign',syntheticControl:input.syntheticControl===true,...(task?{investigationId:t.investigationId,taskRevision:t.revision,taskPath:task.path,taskSha256:task.sha256}:{}),runId,checkId:input.caseId,status:original.status,reportPath:report.path,reportSha256:report.sha256};
  const sameOriginal=previous?.occurrences.find(o=>o.id===occurrence.id);
  requireValue(!sameOriginal||sameOriginal.reportSha256===occurrence.reportSha256,'Original occurrence already has different retained report bytes; reconcile the projection instead of adding a run.');
  const source=input.source===undefined?previous?.source||null:input.source?sourceIdentity(input.source):null;
  const publicSummary=input.public===undefined?previous?.public||null:input.public?publicCopy(input.public):null;
  if(source)requireValue(input.repository===repository&&classification.kind==='Harness','Only evidence-backed Ops harness repairs can carry an exportable source patch.');
  const r=previous?structuredClone(previous):{format,id,repository:input.repository,contract:input.contract,revision:0,occurrences:[],proofs:[],history:[],ingestions:[],publication:{state:'NotPublished'},publicationHistory:[]};
  const subject=s=>s?{base:s.base,head:s.head,patchSha256:s.patchSha256,branch:s.branch}:null;
  const subjectChanged=digest(subject(r.source))!==digest(subject(source));
  if(previous)r.history.push({revision:r.revision,classification:r.classification,source:r.source,public:r.public,dependencies:r.dependencies});
  r.classification=classification;r.source=source;r.public=publicSummary;r.dependencies=dependencies(input.dependencies===undefined?previous?.dependencies||[]:input.dependencies);
  if(!r.occurrences.some(o=>o.id===occurrence.id))r.occurrences.push(occurrence);
  for(const p of proofs(input.proofs||[],source))if(!r.proofs.some(x=>digest(x)===digest(p)))r.proofs.push(p);
  if(input.legacyRecord){
   const legacy=await jsonFile(input.legacyRecord);requireValue(legacy.value.format===format&&legacy.value.repository===input.repository&&legacy.value.head===source?.head,'Legacy repair receipt belongs to another source.');r.legacyRecord={path:legacy.path,sha256:legacy.sha256};
   if(legacy.value.publication?.intentDispatched||legacy.value.publication?.url||/unknown|conflict/i.test(legacy.value.publication?.state||'')){
    r.publicationHistory.push(r.publication);r.publication={state:/conflict/i.test(legacy.value.publication.state)?'Conflict':'Unknown',reason:'Legacy publication requires read-only reconciliation.',legacy:legacy.path};
   }
  }
  if(subjectChanged&&r.publication.state==='VerifiedIdentity'){r.publicationHistory.push(r.publication);r.publication={state:'Conflict',reason:'Repair head changed after the PR observation.'};}
  if(input.publication){fields(input.publication,['state','reason']);requireValue(['Unknown','Conflict'].includes(input.publication.state),'Publication can only be marked Unknown or Conflict; this command never publishes.');r.publicationHistory.push(r.publication);r.publication=input.publication;}
  if(input.prReceipt){
   const receipt=await jsonFile(input.prReceipt),v=receipt.value;const matches=source&&v.head?.repo?.full_name===repository&&v.base?.repo?.full_name===repository&&v.head?.sha===source.head&&v.head?.ref===source.branch&&Number.isSafeInteger(v.number)&&v.number>0&&v.html_url===`https://github.com/${repository}/pull/${v.number}`;
   r.publicationHistory.push(r.publication);r.publication=matches?{state:'VerifiedIdentity',url:v.html_url,head:source.head,branch:source.branch,receipt:receipt.path,receiptSha256:receipt.sha256}:{state:'Conflict',reason:'Observed PR does not match repository, branch and head.',receipt:receipt.path,receiptSha256:receipt.sha256};
  }
  r.revision++;r.ingestions.push({requestId:input.requestId,sha256:requestHash});r.gates=repairGates(r);
  await writeJSON(path.join(dir,id+'.json'),r);return r;
 }finally{await rm(lock,{recursive:true});}
}

export async function exportRepair(dataDir,id,{repo,out,mode='preview'}={}){
 requireValue(mode==='preview','This slice supports preview only.');const r=await readRepair(dataDir,id);
 requireValue(r.repository===repository&&r.classification.kind==='Harness'&&r.source&&r.public,'Only a reviewed harness repair can export an Ops PR preview.');
 const s=sourceIdentity(r.source),summary=publicCopy(r.public);repo=await noLinks(repo);
 dependencies(r.dependencies);
 for(const p of r.proofs){requireValue(hex(p.head,40)&&hex(p.patchSha256,64),'Invalid retained proof subject.');proofs([p],{head:p.head,patchSha256:p.patchSha256});}
 requireValue(['NotPublished','Unknown','Conflict','VerifiedIdentity'].includes(r.publication.state),'Invalid retained publication state.');
 if(r.publication.state==='VerifiedIdentity'){
  const observed=await jsonFile(r.publication.receipt),v=observed.value;
  requireValue(observed.sha256===r.publication.receiptSha256&&v.head?.repo?.full_name===repository&&v.base?.repo?.full_name===repository&&v.head?.ref===s.branch&&v.head?.sha===s.head&&Number.isSafeInteger(v.number)&&v.number>0&&v.html_url===`https://github.com/${repository}/pull/${v.number}`&&v.html_url===r.publication.url,'Retained PR observation changed; reconcile before exporting.');
 }
 requireValue(git(repo,'rev-parse','HEAD').trim()===s.head&&git(repo,'status','--porcelain')==='','Use the clean reviewed source head.');
 requireValue(['git@github.com:story-wizard/wiz-ops.git','https://github.com/story-wizard/wiz-ops.git'].includes(git(repo,'remote','get-url','origin').trim()),'Source remote is not the approved Ops repository.');
 const paths=git(repo,'diff','--no-renames','--name-only','-z',s.base,s.head,'--').split('\0').filter(Boolean);paths.forEach(scopePath);
 requireValue(JSON.stringify([...paths].sort())===JSON.stringify([...s.reviewedPaths].sort()),'Patch changes unapproved files or differs from the reviewed scope.');
 for(const file of paths){await noLinks(path.join(repo,file));for(const ref of [s.base,s.head])requireValue(!git(repo,'ls-tree',ref,'--',file).startsWith('120000'),'Source symlinks are not exportable.');}
 const patch=git(repo,'diff','--binary','--no-ext-diff','--no-textconv','--no-renames',s.base,s.head,'--');
 const reviewed=await readFile(await noLinks(s.reviewedPatch));requireValue(byteHash(patch)===s.patchSha256&&byteHash(reviewed)===s.patchSha256&&reviewed.equals(Buffer.from(patch)),'Patch differs from its exact reviewed bytes.');
 const gates=repairGates(r);
 const preview=`# ${summary.title}\n\n${summary.problem}\n\n${summary.change}\n\nValidation: ${summary.validation}\n\nRecorded checks for this head: ${Object.entries(gates).map(([kind,status])=>kind+' '+status).join('; ')}.\n\nRemaining: ${summary.remaining}\n\nPublication: ${r.publication.state}. This is a local PR preview.\n`;
 const content={'repair.patch':patch,'PR-PREVIEW.md':preview};
 const manifest={format:'athanor-repair-preview/v1',mode:'preview',repairId:r.id,repository,contract:r.contract,source:{base:s.base,head:s.head,tree:git(repo,'rev-parse',s.head+'^{tree}').trim(),canonicalMain:s.canonicalMain,branch:s.branch,basedOnDependency:s.base!==s.canonicalMain,reviewedPaths:paths},dependencies:r.dependencies.map(d=>({repository:d.repository,...(d.head?{head:d.head}:{}),...(d.patchSha256?{patchSha256:d.patchSha256}:{}),...(d.pr?{pr:d.pr}:{})})),gates:repairGates(r),publication:{state:r.publication.state,...(r.publication.state==='VerifiedIdentity'?{url:r.publication.url}:{}),writeAuthorized:false},files:Object.entries(content).map(([file,bytes])=>({file,bytes:Buffer.byteLength(bytes),sha256:byteHash(bytes)}))};
 content['manifest.json']=JSON.stringify(manifest,null,2)+'\n';out=externalPath(await noLinks(out));await mkdir(path.dirname(out),{recursive:true,mode:0o700});
 let existing=false;try{await mkdir(out,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;existing=true;}
 if(existing){requireValue(JSON.stringify((await readdir(out)).sort())===JSON.stringify(Object.keys(content).sort()),'Export destination has unexpected files.');for(const [name,bytes] of Object.entries(content))requireValue((await readFile(await noLinks(path.join(out,name)))).equals(Buffer.from(bytes)),'Export destination differs; use a new directory.');}
 else for(const [name,bytes] of Object.entries(content))await writeFile(path.join(out,name),bytes,{flag:'wx',mode:0o600});
 return {directory:out,manifest,manifestSha256:byteHash(content['manifest.json']),reused:existing};
}
