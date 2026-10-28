import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {recordRepair,readRepair,listRepairs,exportRepair,repairFamily} from '../runner/repair-record.mjs';
import {investigationTask} from '../investigations.mjs';
import {digest,writeJSON} from '../runner/files.mjs';

const bytesHash=b=>createHash('sha256').update(b).digest('hex');
const git=(repo,...args)=>execFileSync('/usr/bin/git',['-C',repo,...args],{encoding:'utf8'}).trim();
const cli=new URL('../scripts/repair.mjs',import.meta.url).pathname;
const runCLI=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{encoding:'utf8'}));
async function fixture({sourceFile='smoke/desktop/repair-example.mjs'}={}){
 const root=await mkdtemp('/private/tmp/athanor-repair-test-'),repo=path.join(root,'source'),data=path.join(root,'private');await mkdir(repo);git(repo,'init','-q','-b','repair');git(repo,'remote','add','origin','git@github.com:story-wizard/wiz-ops.git');
 await mkdir(path.dirname(path.join(repo,sourceFile)),{recursive:true});await writeFile(path.join(repo,sourceFile),'export const fixed = false;\n');
 const commit=()=>{git(repo,'add','.');git(repo,'-c','user.name=Repair fixture','-c','user.email=fixture@localhost','commit','-qm','Synthetic repair fixture');return git(repo,'rev-parse','HEAD');};
 const base=commit();await writeFile(path.join(repo,sourceFile),'export const fixed = true;\n');const head=commit();
 const patch=execFileSync('/usr/bin/git',['-C',repo,'diff','--binary','--no-ext-diff','--no-textconv','--no-renames',base,head,'--']);const patchFile=path.join(root,'reviewed.diff');await writeFile(patchFile,patch);
 const source={base,head,canonicalMain:base,branch:'repair',reviewedPaths:[sourceFile],patchSha256:bytesHash(patch),reviewedPatch:patchFile,reviewer:'Synthetic reviewer'};
 async function input(n=1,kind='Harness'){
  const report={runId:'synthetic-run-'+n,cases:[{id:'FOCUS',status:'Blocked',observation:'ghp_SYNTHETIC_SECRET raw command: curl private.example; /Users/private/evidence'}]},reportPath=path.join(root,'report-'+n+'.json');await writeJSON(reportPath,report);
  const original=report.cases[0],record={id:'synthetic-investigation-'+n,revision:1,cases:[{id:'FOCUS',title:'Focus',classification:kind,disposition:'Investigate',original:{...original,expected:'The intended editor owns input',operations:[]},attempts:[],reason:'Observed focus mismatch',duplicateOf:null}],baseline:{runId:report.runId,reportPath,reportHash:digest(report),reportUrl:'/private/report',identities:{version:'Synthetic',packageHash:'package'}},repros:[]};
  const task=investigationTask(record,{task:'repair'}),taskFile=path.join(root,'task-'+n+'.json');await writeJSON(taskFile,task);
  return {requestId:'synthetic-occurrence-'+n,revision:n-1,repository:'story-wizard/wiz-ops',contract:{id:'embedded-editor-focus',version:'1'},classification:{kind,reason:'The synthetic adapter reported the graphics host instead of the focused editor.',evidence:['ghp_SYNTHETIC_SECRET /Users/private/proof; curl private.example']},taskFile,caseId:'FOCUS',reportSha256:bytesHash(await readFile(reportPath)),source:kind==='Harness'?source:null,public:{title:'Report the embedded editor focus',problem:'Input arrived in the editor while inspection identified its host.',change:'Resolve the focused editor within the owned visible proxy.',validation:'Synthetic fixture regression passed.',remaining:'Packaged qualification is pending.'},dependencies:[{repository:'story-wizard/wizard',patchSha256:'a'.repeat(64),evidence:'/Users/private/App-proof'}],proofs:[]};
 }
 return {root,repo,data,source,sourceFile,commit,input,close:()=>rm(root,{recursive:true,force:true})};
}

test('two occurrences form one repair and one reproducible preview; duplicate ingestion preserves report bytes and review fields',async()=>{
 const f=await fixture({sourceFile:'smoke/investigations.mjs'});try{
  const a=await f.input(),inputFile=path.join(f.root,'input.json');await writeJSON(inputFile,a);const r=runCLI('record','--data-dir',f.data,'--input',inputFile);
  const second=await f.input(2);delete second.source;delete second.public;delete second.dependencies;let current=await recordRepair(f.data,second);
  assert.equal(current.occurrences.length,2);assert.deepEqual(current.source,a.source);assert.deepEqual(current.dependencies,a.dependencies);
  assert.equal((await recordRepair(f.data,a)).revision,2);assert.equal((await listRepairs(f.data)).length,1);
  current=await recordRepair(f.data,{...second,revision:2,requestId:'same-occurrence-again'});assert.equal(current.occurrences.length,2);
  const changedTask=JSON.parse(await readFile(a.taskFile)),changedReport=JSON.parse(await readFile(changedTask.baselineReport.path));changedReport.cases[0].status='Pass';
  const changedPath=path.join(f.root,'altered-report.json'),changedTaskPath=path.join(f.root,'altered-task.json');await writeJSON(changedPath,changedReport);changedTask.baselineReport.path=changedPath;changedTask.baselineReport.hash=digest(changedReport);await writeJSON(changedTaskPath,changedTask);
  await assert.rejects(recordRepair(f.data,{...a,revision:3,requestId:'changed-original',taskFile:changedTaskPath,reportSha256:bytesHash(await readFile(changedPath))}),/Original occurrence already/);
  assert.equal((await readRepair(f.data,r.id)).occurrences[0].status,'Blocked');assert.equal((await readRepair(f.data,r.id)).occurrences.length,2);
  const task=JSON.parse(await readFile(a.taskFile));assert.equal(task.firstRead.repairRecord.mode,'preview-only');assert.equal(task.repairRecord.findCommand.at(-1),task.investigationId);assert.match(task.prompt,/No app launch/);
  const exported=runCLI('export','--data-dir',f.data,'--id',r.id,'--repo',f.repo,'--out',path.join(f.root,'export'));
  assert.equal((await exportRepair(f.data,r.id,{repo:f.repo,out:exported.directory})).reused,true);
  assert.deepEqual((await readdir(exported.directory)).sort(),['PR-PREVIEW.md','manifest.json','repair.patch']);
  for(const file of exported.manifest.files)assert.equal(bytesHash(await readFile(path.join(exported.directory,file.file))),file.sha256);
  assert.equal(bytesHash(await readFile(path.join(exported.directory,'manifest.json'))),exported.manifestSha256);
  const publicBytes=(await Promise.all((await readdir(exported.directory)).map(name=>readFile(path.join(exported.directory,name),'utf8')))).join('');
  for(const secret of ['ghp_SYNTHETIC_SECRET','curl private.example','/Users/private','report-1.json'])assert(!publicBytes.includes(secret));
  assert.equal(bytesHash(await readFile(task.baselineReport.path)),a.reportSha256);
  const clone=path.join(f.root,'reconstruct');git(f.repo,'worktree','add','--quiet','--detach',clone,f.source.base);git(clone,'apply',path.join(exported.directory,'repair.patch'));assert.equal(await readFile(path.join(clone,f.sourceFile),'utf8'),await readFile(path.join(f.repo,f.sourceFile),'utf8'));
 }finally{await f.close();}
});

test('new heads retain historical proof but cannot inherit qualification; required native proof rejects skips',async()=>{
 const f=await fixture();try{
  const a=await f.input();a.proofs=[{kind:'native',head:f.source.head,patchSha256:f.source.patchSha256,status:'Skipped',tests:1,failed:0,skipped:1,evidence:'Synthetic unavailable SDK'}];let r=await recordRepair(f.data,a);assert.equal(r.gates.native,'Skipped');
  await assert.rejects(recordRepair(f.data,{...a,requestId:'bad-pass',revision:1,proofs:[{...a.proofs[0],status:'Pass'}]}),/zero failures or skips/);
  await assert.rejects(recordRepair(f.data,{...a,requestId:'bad-package',revision:1,proofs:[{kind:'packaged',head:f.source.head,patchSha256:f.source.patchSha256,status:'Pass',evidence:'Missing package identity'}]}),/exact package hash/);
  await writeFile(path.join(f.repo,f.sourceFile),'export const fixed = true;\nexport const next = true;\n');const head=f.commit(),patch=execFileSync('/usr/bin/git',['-C',f.repo,'diff','--binary',f.source.base,head]);const reviewedPatch=path.join(f.root,'next.diff');await writeFile(reviewedPatch,patch);
  const next=await f.input(2);next.source={...f.source,head,patchSha256:bytesHash(patch),reviewedPatch};r=await recordRepair(f.data,next);assert.equal(r.proofs.length,1);assert.equal(r.history[0].source.head,f.source.head);assert.equal(r.gates.native,'Pending');
  assert.notEqual(repairFamily(a.repository,{...a.contract,version:'2'}),r.id);
 }finally{await f.close();}
});

test('scope, path escapes, symlinks, altered patch bytes and unsafe public copy are rejected before export',async()=>{
 const f=await fixture();try{
  const a=await f.input();for(const file of ['smoke/desktop/../secret.mjs','src/app.cpp','.env','smoke/config.json','smoke/credentials.json','smoke/credentials.mjs','smoke/private-config.mjs','smoke/.hidden.mjs','smoke/../outside.mjs'])await assert.rejects(recordRepair(f.data,{...a,source:{...a.source,reviewedPaths:[file]}}),/allowed harness source scope/);
  for(const title of ['token=ghp_SYNTHETIC_SECRET','sk-SYNTHETIC_SECRET','See /Users/private/log','Run curl private.example'])await assert.rejects(recordRepair(f.data,{...a,public:{...a.public,title}}),/Public summary/);
  a.public.title='Keep disk-space checks task-local';const r=await recordRepair(f.data,a);assert.equal(r.public.title,a.public.title);await symlink(f.root,path.join(f.root,'link'));await assert.rejects(exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,'link/export')}),/Symlink/);
  await writeFile(f.source.reviewedPatch,'changed');await assert.rejects(exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,'bad')}),/exact reviewed bytes/);
  await assert.rejects(exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,'bad'),mode:'publish'}),/preview only/);
 }finally{await f.close();}
});

test('retained dependency and proof fields are revalidated at export rather than copied into the public manifest',async()=>{
 const f=await fixture();try{
  const r=await recordRepair(f.data,await f.input()),file=path.join(f.data,'repair-records',r.id+'.json');
  await writeJSON(file,{...r,dependencies:[{...r.dependencies[0],privateCommand:'curl private.example'}]});await assert.rejects(exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,'bad-dependency')}),/Unknown/);
  await writeJSON(file,{...r,proofs:[{kind:'native',head:r.source.head,patchSha256:r.source.patchSha256,status:'ghp_SYNTHETIC_SECRET',evidence:'private'}]});await assert.rejects(exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,'bad-proof')}),/Invalid proof/);
 }finally{await f.close();}
});

test('Unknown publication survives exports; conflicting PR identity requires reconciliation and exact read-only identity grants no write',async()=>{
 const f=await fixture();try{
  const a=await f.input(),legacy=path.join(f.root,'legacy.json');await writeJSON(legacy,{format:'athanor-local-repair-record/v1',repository:a.repository,head:a.source.head,publication:{state:'Unknown',intentDispatched:true}});a.legacyRecord=legacy;let r=await recordRepair(f.data,a);
  for(const name of ['preview1','preview2']){const e=await exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,name)});assert.equal(e.manifest.publication.state,'Unknown');assert.equal(e.manifest.publication.url,undefined);assert.equal(e.manifest.publication.writeAuthorized,false);}
  const receipt=path.join(f.root,'pr.json'),metadata={number:123,html_url:'https://github.com/story-wizard/wiz-ops/pull/123',head:{repo:{full_name:a.repository},ref:a.source.branch,sha:'f'.repeat(40)},base:{repo:{full_name:a.repository}}};await writeJSON(receipt,metadata);
  r=await recordRepair(f.data,{...a,requestId:'conflicting-pr',revision:1,legacyRecord:undefined,prReceipt:receipt});assert.equal(r.publication.state,'Conflict');
  metadata.head.sha=a.source.head;await writeJSON(receipt,metadata);r=await recordRepair(f.data,{...a,requestId:'matching-observation',revision:2,legacyRecord:undefined,prReceipt:receipt});assert.equal(r.publication.state,'VerifiedIdentity');
  const e=await exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,'observed')});assert.equal(e.manifest.publication.url,metadata.html_url);assert.equal(e.manifest.publication.writeAuthorized,false);assert(r.publicationHistory.some(p=>p.state==='Unknown'));
  const relocated=path.join(f.root,'relocated-reviewed.diff');await writeFile(relocated,await readFile(a.source.reviewedPatch));
  r=await recordRepair(f.data,{...a,requestId:'review-annotation',revision:3,legacyRecord:undefined,source:{...a.source,reviewedPatch:relocated,reviewer:'Another synthetic reviewer'}});assert.equal(r.publication.state,'VerifiedIdentity');
 }finally{await f.close();}
});

test('App, environment and unresolved assessments stay classified and cannot become Ops exports',async()=>{
 const f=await fixture();try{
  for(const kind of ['App','Environment','Unresolved']){
   const a=await f.input(1,kind);a.contract={id:'assessment-'+kind.toLowerCase(),version:'1'};const r=await recordRepair(f.data,a);assert.equal(r.classification.kind,kind);assert.equal(r.occurrences[0].status,'Blocked');await assert.rejects(exportRepair(f.data,r.id,{repo:f.repo,out:path.join(f.root,kind)}),/Only a reviewed harness/);
  }
 }finally{await f.close();}
});
