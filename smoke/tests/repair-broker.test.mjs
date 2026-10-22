import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,copyFile,writeFile,readFile,chmod,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {fixture,hash,json} from './support/repair-publisher-fixture.mjs';
import {brokerFiles} from '../runner/repair-broker.mjs';

async function brokerFixture(){
 const f=await fixture(),installRoot=path.join(f.root,'broker'),stateRoot=path.join(f.root,'state'),requestId='reviewed',request=path.join(installRoot,'requests',requestId),source=fileURLToPath(new URL('../../',import.meta.url));
 await mkdir(request,{recursive:true,mode:0o700});await mkdir(stateRoot,{mode:0o700});await chmod(installRoot,0o700);const actor={id:42,login:'FixtureDev'};
 for(const name of brokerFiles){const dest=path.join(installRoot,name);await mkdir(path.dirname(dest),{recursive:true,mode:0o700});if(name==='runtime/gh')continue;await copyFile(name==='runtime/node'?process.execPath:path.join(source,name),dest,constants.COPYFILE_FICLONE);await chmod(dest,name==='runtime/node'?0o700:0o600);}
 await writeFile(path.join(installRoot,'runtime/gh'),`#!/bin/sh\n[ "$#" = 6 ] && [ "$1" = auth ] && [ "$2" = token ] && [ "$3" = --hostname ] && [ "$4" = github.com ] && [ "$5" = --user ] && [ "$6" = FixtureDev ] || exit 41\n[ -z "$GH_TOKEN$GITHUB_TOKEN$SSH_AUTH_SOCK$NODE_OPTIONS" ] || exit 42\nprintf called >> '${stateRoot}/credential-called'\nprintf '%s' '${f.grant.token}'\n`,{mode:0o700});
 const child='smoke/tests/broker-child.mjs';await mkdir(path.dirname(path.join(installRoot,child)),{recursive:true,mode:0o700});await writeFile(path.join(installRoot,child),`import {readFileSync} from 'node:fs';import {parseArgs} from 'node:util';import assert from 'node:assert/strict';import {inspectPublication,publishRepair} from '../runner/repair-publisher.mjs';import {offlineRepairTransport} from '../runner/repair-publisher-transport.mjs';const {values:v}=parseArgs({allowPositionals:true,options:{artifacts:{type:'string'},approval:{type:'string'},journal:{type:'string'},bundle:{type:'string'},'broker-grant-fd':{type:'string'}}});const grant=JSON.parse(readFileSync(Number(v['broker-grant-fd']),'utf8'));assert(!process.argv.some(a=>a.includes(grant.token)));assert(!Object.values(process.env).some(a=>a.includes(grant.token)));const options={artifactDirectory:v.artifacts,approvalFile:v.approval,journalDirectory:v.journal,sourceBundle:v.bundle},plan=await inspectPublication(options),t=await offlineRepairTransport({grant,plan,...grant.qualification});const transport={...t,createDraft:async p=>{const pr=await t.createDraft(p);if(grant.qualification.failAfterCreate)process.exit(23);return pr;}};const {token,qualification,...permission}=grant;console.log(JSON.stringify(await publishRepair({...options,grant:permission,transport})));`,{mode:0o600});
 for(const name of ['export/manifest.json','export/repair.patch','export/PR-PREVIEW.md']){await mkdir(path.dirname(path.join(request,name)),{recursive:true,mode:0o700});await copyFile(path.join(f.artifacts,path.basename(name)),path.join(request,name));await chmod(path.join(request,name),0o600);}
 await copyFile(f.bundle,path.join(request,'source.bundle'));await chmod(path.join(request,'source.bundle'),0o600);const approval={...f.approval,actor};
 for(const proof of approval.proofs){const receipt={format:'athanor-reviewed-proof/v1',status:'Pass',kind:proof.kind,head:proof.head,patchSHA256:proof.patchSHA256,tests:proof.tests,failed:0,skipped:0},file=path.join(request,'proof-'+proof.kind+'.json');await json(file,receipt);await chmod(file,0o600);proof.receiptSHA256=hash(await readFile(file));}
 await json(path.join(request,'approval.json'),approval);await chmod(path.join(request,'approval.json'),0o600);
 const policy={format:'athanor-local-user-broker/v1',localUID:process.geteuid(),repository:'story-wizard/wiz-ops',repositoryId:1273595664,actor,installRoot,stateRoot,credentialHome:stateRoot,inventory:await Promise.all([...brokerFiles,child].map(async file=>({file,sha256:hash(await readFile(path.join(installRoot,file)))})))};
 const policyFile=path.join(installRoot,'broker-policy.json');await json(policyFile,policy);await chmod(policyFile,0o600);
 async function seal(){const files=['approval.json','source.bundle','export/manifest.json','export/repair.patch','export/PR-PREVIEW.md',...approval.proofs.map(p=>'proof-'+p.kind+'.json')];await json(path.join(request,'review.json'),{format:'athanor-local-user-request/v1',requestId,actor,policySHA256:hash(await readFile(policyFile)),files:await Promise.all(files.map(async file=>({file,sha256:hash(await readFile(path.join(request,file)))})))});await chmod(path.join(request,'review.json'),0o600);}
 await seal();const launch=path.join(f.root,'launch.mjs');await writeFile(launch,`import {readFile} from 'node:fs/promises';import {runRepairBroker} from ${JSON.stringify(new URL('file://'+path.join(installRoot,'smoke/runner/repair-broker.mjs')).href)};const r=JSON.parse(await readFile(process.argv[2]));console.log(JSON.stringify(await runRepairBroker(r)));`);
 const argumentsFile=path.join(f.root,'invocation.json'),invocation={policyFile,requestId,qualification:{apiOrigin:f.apiOrigin,publisher:{apiOrigin:f.apiOrigin,gitRemote:f.remote}}};await json(argumentsFile,invocation);
 async function run(){await json(argumentsFile,invocation);return new Promise((resolve,reject)=>{const child=spawn(path.join(installRoot,'runtime/node'),[launch,argumentsFile],{env:{PATH:'/usr/bin:/bin',HOME:stateRoot,GH_TOKEN:'AMBIENT_FAKE_SECRET',GITHUB_TOKEN:'AMBIENT_FAKE_SECRET',SSH_AUTH_SOCK:'UNTRUSTED_AGENT'},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,err);assert(!out.includes(f.grant.token));assert(!err.includes(f.grant.token));resolve(JSON.parse(out));}catch(e){reject(e);}});});}
 return {...f,installRoot,stateRoot,request,actor,approval,policyFile,seal,run,invocation};
}

test('manual user broker pins actor and descriptor-only secret; lost results never duplicate PRs',async()=>{
 const f=await brokerFixture();try{
  f.approval.actor={login:f.actor.login,id:f.actor.id};await json(path.join(f.request,'approval.json'),f.approval);await f.seal();const reviewFile=path.join(f.request,'review.json'),review=JSON.parse(await readFile(reviewFile));review.actor={login:f.actor.login,id:f.actor.id};await json(reviewFile,review);
  f.state.dropCreate=true;const first=await f.run();assert.equal(first.state,'Unknown',JSON.stringify(first));assert.equal(first.identityVerified,true);assert.equal(f.state.posts,1);
  f.state.hidePR=true;assert.equal((await f.run()).state,'Unknown');assert.equal(f.state.posts,1);f.state.hidePR=false;
  const done=await f.run();assert.equal(done.state,'Confirmed');assert.deepEqual(done.publication.receipt.actor,f.actor);assert.equal(f.state.posts,1);
  f.state.prs[0].user={id:77,login:f.actor.login};assert.equal((await f.run()).state,'Conflict');assert.equal(f.state.posts,1);
  const journal=path.join(f.stateRoot,'journal',f.record.id);for(const name of (await readdir(journal)).filter(n=>n.endsWith('.json')))assert(!(await readFile(path.join(journal,name),'utf8')).includes(f.grant.token));
 }finally{await f.close();}
});

test('changed approved bytes, proof/actor and local permissions stop before credential access',async()=>{
 const f=await brokerFixture();try{
  const bundle=path.join(f.request,'source.bundle'),old=await readFile(bundle);await writeFile(bundle,'changed');assert.equal((await f.run()).reason,'request_bytes');await writeFile(bundle,old);
  await chmod(path.join(f.request,'review.json'),0o666);assert.equal((await f.run()).reason,'local_permissions');await chmod(path.join(f.request,'review.json'),0o600);
  const proof=path.join(f.request,'proof-framework.json'),raw=await readFile(proof);await writeFile(proof,'changed');await f.seal();assert.equal((await f.run()).state,'Held');await writeFile(proof,raw);await f.seal();
  const approvalFile=path.join(f.request,'approval.json'),original=await readFile(approvalFile);await json(approvalFile,{...f.approval,actor:{id:77,login:'OtherDev'}});await f.seal();assert.equal((await f.run()).reason,'approval_actor');await writeFile(approvalFile,original);await f.seal();
  assert(!(await readdir(f.stateRoot)).includes('credential-called'));assert.equal(f.state.posts,0);assert.equal(f.ref(f.approval.head.branch),null);
 }finally{await f.close();}
});

test('wrong credential identity, missing Ops capability and wrong returned author cannot confirm publication',async()=>{
 const f=await brokerFixture();try{
  f.state.actor={id:77,login:f.actor.login,type:'User'};assert.equal((await f.run()).reason,'credential_actor');assert.equal(f.state.posts,0);
  f.state.actor={...f.actor,type:'User'};f.state.pushPermission=false;assert.equal((await f.run()).reason,'repository_capability');assert.equal(f.state.posts,0);
  f.state.pushPermission=true;f.state.prActor={id:77,login:'OtherDev'};assert.equal((await f.run()).state,'Conflict');assert.equal(f.state.posts,1);
 }finally{await f.close();}
});

test('publisher process failure after a PR side effect stays Unknown and a restart reuses the exact PR',async()=>{
 const f=await brokerFixture();try{
  f.invocation.qualification.publisher.failAfterCreate=true;const failed=await f.run();assert.equal(failed.state,'Unknown',JSON.stringify(failed));assert.equal(failed.reason,'publisher_unknown');assert.equal(f.state.posts,1);
  f.state.hidePR=true;assert.equal((await f.run()).state,'Unknown');assert.equal(f.state.posts,1);f.state.hidePR=false;assert.equal((await f.run()).state,'Confirmed');assert.equal(f.state.posts,1);
 }finally{await f.close();}
});
