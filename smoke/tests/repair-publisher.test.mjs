import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile,rm,symlink,readdir} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {fixture,hash,git,json,journalBytes} from './support/repair-publisher-fixture.mjs';
import {inspectPublication,inspectPublisherJournal,publishRepair,publicationBody} from '../runner/repair-publisher.mjs';
import {githubRepairTransport,offlineRepairTransport} from '../runner/repair-publisher-transport.mjs';
import {recordRepair,exportRepair} from '../runner/repair-record.mjs';

async function reviewAgain(f){
 const manifest=JSON.parse(await readFile(path.join(f.artifacts,'manifest.json'))),raw=await readFile(path.join(f.artifacts,'manifest.json'));f.approval.manifestSHA256=hash(raw);f.approval.bodySHA256=hash(publicationBody(await readFile(path.join(f.artifacts,'PR-PREVIEW.md'),'utf8'),f.record.id,hash(raw)));await json(f.approvalFile,f.approval);f.grant.approvalSHA256=hash(await readFile(f.approvalFile));return manifest;
}

test('real local Git and HTTP publish only the reviewed bytes once; current PR state is reconciled on reuse',async()=>{
 const f=await fixture();try{
  const report=await readFile(f.input.campaignReport),t=await f.transport();let pushes=0;
  const transport={...t,push:async args=>{assert.equal((await inspectPublisherJournal(f.journal,f.record.id)).state,'PushIntent');pushes++;await t.push(args);},createDraft:async payload=>{assert.equal((await inspectPublisherJournal(f.journal,f.record.id)).state,'CreateIntent');return t.createDraft(payload);}};
  const first=await f.publish({transport});assert.equal(first.state,'Confirmed');assert.equal(first.reused,false);assert.equal(f.ref(f.approval.head.branch),f.head);assert.equal(f.state.posts,1);assert.equal(pushes,1);
  const reads=f.state.reads;assert.equal((await f.publish({transport})).state,'Confirmed');assert(f.state.reads>reads);assert.equal(f.state.posts,1);assert.equal(pushes,1);
  const patch=await readFile(path.join(f.artifacts,'repair.patch'));assert.equal(hash(patch),f.approval.proofs[0].patchSHA256);assert.equal(f.state.prs[0].body,(await inspectPublication(f.options)).body);assert.equal(f.state.prs[0].draft,true);
  assert.deepEqual(await readFile(f.input.campaignReport),report);const publicText=f.state.prs[0].body+patch.toString();for(const secret of [f.grant.token,'PRIVATE_REPORT_CANARY','ghp_FAKE_AMBIENT_CANARY',f.root])assert(!publicText.includes(secret));assert(!(await journalBytes(f)).includes(f.grant.token));
  f.state.prs[0].title='Human-edited repair title';f.state.prs[0].body+='\nCodesmith footer';assert.equal((await f.publish()).state,'Confirmed');f.state.prs[0].body='Rewritten human description';assert.equal((await f.publish()).state,'Confirmed');assert.equal(f.state.posts,1);assert.equal(pushes,1);
  f.state.prs[0].draft=false;assert.equal((await f.publish()).state,'Conflict');assert.equal(f.state.posts,1);
 }finally{await f.close();}
 const other=await fixture();try{assert.equal((await other.publish()).state,'Confirmed');other.state.prs[0].head.repo.full_name='story-wizard/other';assert.equal((await other.publish()).state,'Conflict');assert.equal(other.state.posts,1);}finally{await other.close();}
});

test('lost push and create responses reconcile actual remote effects without duplicate writes or repair-record reset',async()=>{
 const f=await fixture();try{
  const t=await f.transport();let pushes=0;const transport={...t,push:async args=>{pushes++;await t.push(args);throw Error('SYNTHETIC_LOST_PUSH');}};
  assert.equal((await f.publish({transport})).state,'Unknown');assert.equal(f.ref(f.approval.head.branch),f.head);assert.equal(f.state.posts,0);
  f.state.dropCreate=true;assert.equal((await f.publish({transport})).state,'Unknown');assert.equal(pushes,1);assert.equal(f.state.posts,1);
  // A fresh import/export still says NotPublished; it cannot erase publisher-owned intent.
  const r=await recordRepair(path.join(f.root,'other-private'),f.input);const exported=await exportRepair(path.join(f.root,'other-private'),r.id,{repo:f.repo,out:path.join(f.root,'other-export')});assert.equal(exported.manifest.publication.state,'NotPublished');
  f.state.hidePR=true;assert.equal((await f.publish({artifactDirectory:exported.directory})).state,'Unknown');assert.equal(f.state.posts,1);
  await assert.rejects(f.publish({journalDirectory:path.join(f.root,'replacement-journal')}),/broker-owned/);assert.equal(f.state.posts,1);
  f.state.hidePR=false;assert.equal((await f.publish()).state,'Confirmed');assert.equal(f.state.posts,1);
  f.state.hidePR=true;assert.equal((await f.publish()).state,'Unknown');assert.equal(f.state.posts,1);
 }finally{await f.close();}
});

test('a killed process releases the family lock but its durable create intent cannot be replayed',async()=>{
 const f=await fixture();try{
  const childFile=path.join(f.root,'publisher-child.mjs'),requestFile=path.join(f.root,'child-request.json');
  await json(requestFile,{options:f.options,grant:f.grant,apiOrigin:f.apiOrigin,remote:f.remote});
  const engine=new URL('../runner/repair-publisher.mjs',import.meta.url).href,adapter=new URL('../runner/repair-publisher-transport.mjs',import.meta.url).href;
  await writeFile(childFile,`import {readFile} from 'node:fs/promises';import {inspectPublication,publishRepair} from ${JSON.stringify(engine)};import {offlineRepairTransport} from ${JSON.stringify(adapter)};const r=JSON.parse(await readFile(process.argv[2]));const plan=await inspectPublication(r.options),transport=await offlineRepairTransport({grant:r.grant,plan,apiOrigin:r.apiOrigin,gitRemote:r.remote});await publishRepair({...r.options,grant:r.grant,transport});`);
  let reached;const atCreate=new Promise(resolve=>{reached=resolve;});let release;f.state.atCreate=()=>{reached();return new Promise(resolve=>{release=resolve;});};
  const child=spawn(process.execPath,[childFile,requestFile],{stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',b=>{err+=b;});const died=once(child,'exit');
  try{
   await Promise.race([atCreate,died.then(()=>{throw Error('Child exited before create: '+err);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Child did not reach API')),10000);timer.unref();})]);
   assert.equal((await inspectPublisherJournal(f.journal,f.record.id)).state,'CreateIntent');child.kill('SIGKILL');await died;release();f.state.atCreate=null;
   f.state.hidePR=true;assert.equal((await f.publish()).state,'Unknown');assert.equal(f.state.posts,1);
   f.state.hidePR=false;assert.equal((await f.publish()).state,'Confirmed');assert.equal(f.state.posts,1);
  }finally{child.kill('SIGKILL');release?.();}
 }finally{await f.close();}
});

test('one publisher owns a family; incomplete reads and changed remote identities cause no writes',async()=>{
 const f=await fixture();try{
  const t=await f.transport();let entered,release;const ready=new Promise(r=>{entered=r;}),blocked=new Promise(r=>{release=r;});
  const first=f.publish({transport:{...t,listPRs:async()=>{entered();await blocked;return t.listPRs();}}});await ready;
  await assert.rejects(f.publish(),/Another publisher/);release();assert.equal((await first).state,'Confirmed');assert.equal(f.state.posts,1);
  f.state.denyReads=true;const unavailable=await f.publish();assert.equal(unavailable.state,'Unknown');assert.equal(unavailable.diagnostic.httpStatus,503);assert.equal(f.state.posts,1);f.state.denyReads=false;
  f.state.prs[0].state='closed';assert.equal((await f.publish()).state,'Conflict');assert.equal(f.state.posts,1);
 }finally{await f.close();}
 const g=await fixture();try{
  g.state.incomplete=true;assert.equal((await g.publish()).state,'Held');assert.equal(g.ref(g.approval.head.branch),null);assert.equal(g.state.posts,0);g.state.incomplete=false;
  git(g.remote,'update-ref','refs/heads/'+g.approval.head.branch,g.base);assert.equal((await g.publish()).state,'Conflict');assert.equal(g.state.posts,0);
 }finally{await g.close();}
 const h=await fixture();try{
  const t=await h.transport(),transport={...t,push:async args=>{git(h.remote,'update-ref','refs/heads/'+h.approval.head.branch,h.base);return t.push(args);}};
  const raced=await h.publish({transport});assert.equal(raced.state,'Unknown');assert.equal(raced.diagnostic.stage,'push');assert.equal(raced.diagnostic.code,'git_exit');assert(raced.diagnostic.exitCode>0);assert.equal(h.ref(h.approval.head.branch),h.base);assert.equal(h.state.posts,0);
 }finally{await h.close();}
});

test('approval, proof, scope and source-history rejection happen before public writes; no repair hooks execute',async()=>{
 for(const options of [{history:true},{symlink:true}]){
  const f=await fixture(options);try{await assert.rejects(f.publish(),/one reviewed linear|symlink/);assert.equal(f.state.posts,0);assert.equal(f.ref(f.approval.head.branch),null);}finally{await f.close();}
 }
 const f=await fixture({native:true});try{
  f.approval.proofs.find(p=>p.kind==='native').skipped=1;await json(f.approvalFile,f.approval);f.grant.approvalSHA256=hash(await readFile(f.approvalFile));await assert.rejects(f.publish(),/native proof cannot skip/);
  f.approval.proofs.find(p=>p.kind==='native').skipped=0;await json(f.approvalFile,f.approval);f.grant.approvalSHA256=hash(await readFile(f.approvalFile));
  await assert.rejects(f.publish({grant:{...f.grant,expiresAt:new Date(0).toISOString()}}),/expired/);
  await assert.rejects(f.publish({grant:{...f.grant,repositories:['story-wizard/other']}}),/repository-scoped/);
  const patchFile=path.join(f.artifacts,'repair.patch'),original=await readFile(patchFile);await writeFile(patchFile,'unreviewed');await assert.rejects(f.publish(),/bytes changed/);await writeFile(patchFile,original);
  await writeFile(path.join(f.artifacts,'private.json'),'private');await assert.rejects(f.publish(),/three reviewed/);await rm(path.join(f.artifacts,'private.json'));
  await symlink(f.artifacts,path.join(f.root,'linked-export'));await assert.rejects(f.publish({artifactDirectory:path.join(f.root,'linked-export')}),/Symlink/);
  const manifest=JSON.parse(await readFile(path.join(f.artifacts,'manifest.json'))),oldPaths=[...f.approval.paths];manifest.source.reviewedPaths=['smoke/examples/workers/private.json'];f.approval.paths=manifest.source.reviewedPaths;await json(path.join(f.artifacts,'manifest.json'),manifest);await reviewAgain(f);await assert.rejects(f.publish(),/policy excludes/);manifest.source.reviewedPaths=oldPaths;f.approval.paths=oldPaths;await json(path.join(f.artifacts,'manifest.json'),manifest);await reviewAgain(f);
  const sentinel=path.join(f.root,'HOOK_RAN');await writeFile(path.join(f.repo,'.git/hooks/pre-push'),`#!/bin/sh\ntouch '${sentinel}'\n`,{mode:0o755});git(f.repo,'config','credential.helper',`!touch '${sentinel}'`);git(f.repo,'config','core.sshCommand',`touch '${sentinel}'`);
  assert.equal((await f.publish()).state,'Confirmed');assert.equal(f.state.posts,1);assert.equal((await readdir(f.root)).includes('HOOK_RAN'),false);
 }finally{await f.close();}
});

test('CLI has no ambient-auth fallback; restricted transport rejects unapproved payloads and endpoints',async()=>{
 const f=await fixture();try{
  const cli=new URL('../scripts/repair-publisher.mjs',import.meta.url).pathname,args=['--artifacts',f.artifacts,'--approval',f.approvalFile];
  const inspected=JSON.parse(execFileSync(process.execPath,[cli,'inspect',...args],{encoding:'utf8'}));assert.equal(inspected.writeDispatched,false);
  try{execFileSync(process.execPath,[cli,'publish',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GH_TOKEN:'ghp_FAKE_AMBIENT_CANARY'}});assert.fail('Missing grant accepted');}catch(e){assert.equal(e.status,1);assert(!e.stderr.toString().includes('ghp_FAKE_AMBIENT_CANARY'));}
  const plan=await inspectPublication(f.options);assert.throws(()=>githubRepairTransport({plan,grant:{...f.grant,repository:'story-wizard/other'}}),/matching private/);
  await assert.rejects(offlineRepairTransport({plan,grant:f.grant,gitRemote:f.remote,apiOrigin:'http://example.com/'}),/loopback/);
  const transport=await f.transport();await assert.rejects(transport.createDraft({title:'Unreviewed'}),/Unapproved PR payload/);await assert.rejects(transport.push({source:f.repo,head:f.head,branch:'other'}),/Unapproved branch/);assert.equal(f.state.posts,0);
  f.state.createStatus=403;const denied=await f.publish();assert.equal(denied.state,'Unknown');assert.deepEqual(denied.diagnostic,{stage:'create_pr',code:'http_status',httpStatus:403});const retained=await journalBytes(f);assert(retained.includes('403'));assert(!retained.includes(f.grant.token));assert(!JSON.stringify(denied).includes(f.grant.token));assert.equal((await f.publish()).state,'Unknown');assert.equal(f.state.posts,0);
 }finally{await f.close();}
});
