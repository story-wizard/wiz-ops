import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {JobStore,nextDaily} from '../runner/jobs.mjs';
import {JobController,resolveJobBuild,retainJobReport} from '../runner/controller.mjs';
import {digest} from '../runner/files.mjs';
import {resolveSelection} from '../runner/catalog.mjs';
import {prepareDelivery,inspectDelivery} from '../runner/delivery.mjs';
import {slackSender} from '../runner/slack-delivery.mjs';
const profile={runnerHash:'a'.repeat(64)},selection=resolveSelection({},{checkIds:['A-CLI-01']}),request={requestId:'manual-1',build:{kind:'app',value:'/Selected/Wizard.app'},selection:{checkIds:['A-CLI-01']},operator:'Test',timeoutMinutes:60};
const idle={sourceMatches:true,sourceHash:profile.runnerHash,ownedSessions:[],activeDesktopJobs:[],preparing:false,active:null},route={workspace:'story-company',userId:'U0BDBFNU0G1',user:'U0BDBFNU0G1',type:'im',channelId:'DTEST123'};
async function fixture(fn){const root=await mkdtemp('/private/tmp/athanor-controller-'),store=new JobStore(root);try{await fn(store,root);}finally{store.close();await rm(root,{recursive:true,force:true});}}
// These tests exercise durable records and observable dispatch counts, not a second implementation of the stage machine.
test('duplicate requests retain one job, reject changed inputs and survive reopening',async()=>fixture(async(store,root)=>{
 const first=store.submit(request,selection,digest(profile));assert.equal(store.submit({...request},selection,digest(profile)).id,first.id);assert.equal(store.list().length,1);
 assert.throws(()=>store.submit({...request,operator:'Other'},selection,digest(profile)),/different inputs/);
 const second=new JobStore(root);try{assert.equal(second.get(first.id).preparationId,first.preparationId);assert.equal(second.get(first.id).runRequestId,first.runRequestId);}finally{second.close();}
 for(const change of [{requestId:'../escape'},{timeoutMinutes:0},{build:{kind:'app',value:'relative.app'}},{build:{kind:'tag',value:'valid',command:'unsafe'}}])assert.throws(()=>store.submit({...request,...change},selection,digest(profile)));
}));
test('daily schedule enqueues at most one missed slot and is inert after pause',async()=>fixture(async store=>{
 const start=Date.parse('2026-10-10T18:00:00Z');store.saveSchedule({timeZone:'America/Los_Angeles',hour:3,minute:0,request,selection,profileHash:digest(profile)},start);
 assert.equal(store.schedule().enabled,false);assert.equal(store.due(start+5*86400000),null);store.enable(true,start);
 assert.equal(store.schedule().nextDue,'2026-10-11T10:00:00.000Z');const missed=start+5*86400000;assert.ok(store.due(missed));assert.equal(store.due(missed),null);assert.equal(store.list().length,1);
 store.enable(false,missed);assert.equal(store.due(missed+86400000),null);
 assert.equal(nextDaily({timeZone:'America/Los_Angeles',hour:3,minute:0},Date.parse('2026-11-01T08:00:00Z')),'2026-11-01T11:00:00.000Z');
}));
test('lease refuses a live owner and accepts only verified absent or replaced identity',async()=>fixture(async(store,root)=>{
 const inspect=pid=>({pid,identity:'same incarnation'}),lease=store.claim(inspect),other=new JobStore(root);
 try{assert.ok(lease);assert.equal(other.claim(inspect),null);assert.throws(()=>other.claim(()=>{throw Error('permission denied');}),/permission/);
  const replaced=other.claim(pid=>({pid,identity:'new incarnation'}));assert.ok(replaced);store.release(lease);assert.equal(other.claim(pid=>({pid,identity:'new incarnation'})),null);other.release(replaced);
 }finally{other.close();}
}));
test('busy worker defers preparation and cancellation never starts it',async()=>fixture(async store=>{
 store.submit(request,selection,digest(profile));store.update(request.requestId,{state:'Imported',imported:{app:request.build.value}});
 let mutations=0;const controller=new JobController(store,{profile,call:async(route,body)=>{if(body)mutations++;return {...idle,active:{run_id:'someone-else'}};}});
 assert.equal((await controller.tick()).state,'Waiting');assert.equal(mutations,0);store.cancel(request.requestId);await controller.tick();assert.equal(store.get(request.requestId).outcome,'Cancelled');assert.equal(mutations,0);
}));
test('a lost preparation response is recovered by its original ID without another POST',async()=>fixture(async store=>{
 const job=store.submit(request,selection,digest(profile));store.update(job.id,{state:'Imported',imported:{app:request.build.value}});const calls=[];
 const controller=new JobController(store,{profile,call:async(route,body)=>{calls.push({route,body});if(route==='/api/worker')return idle;if(body)throw Object.assign(Error('response lost'),{responseLost:true});return {id:job.preparationId,state:'Preparing'};}});
 await controller.tick();assert.equal(store.get(job.id).state,'Preparing');await controller.tick();assert.equal(calls.filter(c=>c.body).length,1);assert.equal(calls.at(-1).route,'/api/preparations/'+job.preparationId);assert.equal(calls.find(c=>c.body).body.preparationId,job.preparationId);
}));
test('lost Start is recovered by request ID, and missing intent is Unknown without replay',async()=>fixture(async store=>{
 const job=store.submit(request,selection,digest(profile));store.update(job.id,{state:'Ready',planHash:'b'.repeat(64)});let posts=0;
 const call=async(route,body)=>{if(route==='/api/worker')return idle;if(body){posts++;throw Object.assign(Error('lost'),{responseLost:true});}return {id:'original-run'};};
 await new JobController(store,{profile,call}).tick();assert.equal(store.get(job.id).state,'Starting');await new JobController(store,{profile,call}).tick();assert.equal(store.get(job.id).runId,'original-run');assert.equal(posts,1);
 store.update(job.id,{state:'Starting',runId:null});await new JobController(store,{profile,call:async()=>{throw Object.assign(Error('not found'),{status:404});}}).tick();assert.equal(store.get(job.id).outcome,'Unknown');assert.equal(posts,1);
}));
test('failed checks finish reporting instead of cancelling or manufacturing a Pass',async()=>fixture(async store=>{
 const job=store.submit(request,selection,digest(profile));store.update(job.id,{state:'Running',runId:'run'});let posts=0;
 const controller=new JobController(store,{profile,call:async(route,body)=>{if(body)posts++;return {id:'run',execution:{state:'Failed',recipe:{}},results:[{test_id:'A-CLI-01',status:'Fail',snapshot:{title:'Connection'}}]};},report:async(s,j)=>{assert.equal(j.outcome,'Failed');return {path:'/retained/report',state:j.outcome};}});
 await controller.tick();await controller.tick();await controller.tick();assert.equal(store.get(job.id).state,'Complete');assert.equal(store.get(job.id).outcome,'Failed');assert.equal(store.get(job.id).delivery,'LOCAL_ONLY');assert.equal(posts,0);
}));
test('cancel/deadline requests one owned stop and leaves its uncertain response for inspection',async()=>fixture(async store=>{
 const job=store.submit(request,selection,digest(profile));store.update(job.id,{state:'Running',runId:'owned'});store.cancel(job.id);let stops=0;
 const controller=new JobController(store,{profile,call:async(route,body)=>{if(body){assert.deepEqual(body,{runId:'owned'});stops++;throw Object.assign(Error('lost stop'),{responseLost:true});}return {id:'owned',execution:{state:'Running',recipe:{}},results:[]};}});
 await controller.tick();await controller.tick();assert.equal(stops,1);assert.equal(store.get(job.id).state,'Running');assert.equal(store.get(job.id).stopRequested,true);
}));
test('build discovery uses fresh official metadata and refuses missing or ambiguous newest packages',async()=>{
 const release=(tag,date,assets)=>({tag_name:tag,name:tag,published_at:date,assets:assets.map((name,i)=>({id:i+1,name,browser_download_url:'https://github.com/story-wizard/wizard-release/releases/download/'+tag+'/'+name,size:12})),body:'Retained changes'});
 const data=[release('nightly-new','2026-10-10T01:00:00Z',['Wizard-macos.zip']),release('nightly-old','2026-10-09T01:00:00Z',['Wizard-macos.zip'])];
 const latest=await resolveJobBuild({kind:'latest-nightly'},async endpoint=>{assert.equal(endpoint,'repos/story-wizard/wizard-release/releases?per_page=100');return data;});assert.equal(latest.tag,'nightly-new');assert.deepEqual(latest.input,{assetId:1});assert.equal(latest.releaseNotes,'Retained changes');
 await assert.rejects(()=>resolveJobBuild({kind:'latest-nightly'},async()=>{throw Error('offline');}),/offline/);
 await assert.rejects(()=>resolveJobBuild({kind:'latest-nightly'},async()=>[release('nightly-new','2026-10-10',['A-macos.zip','B-macos.zip'])]),/ambiguous/);
});
test('early blocker report retains job identity and original not-run checks with no invented package or run',async()=>fixture(async(store,root)=>{
 const job=store.submit(request,selection,digest(profile));const report=await retainJobReport(store,{...job,state:'Reporting',outcome:'Unknown',error:'Start response unknown'},async()=>({checks:[{id:'A-CLI-01',title:'Connection'}]}));
 const record=JSON.parse(await readFile(path.join(report.path,'report.json'),'utf8'));assert.equal(record.runId,null);assert.equal(record.identity.packageHash,null);assert.equal(record.executionStarted,false);assert.deepEqual(record.catalog.counts,{'Not run':1});assert.equal(record.catalog.state,'Unknown');assert.match(await readFile(path.join(report.path,'index.html'),'utf8'),/Job manual-1/);
 await prepareDelivery(report.path,route);assert.equal((await inspectDelivery(report.path)).intent.identity,job.id);
}));
test('Slack sender validates the exact owner before a single dispatch and retains uncertainty after a lost reply',async()=>fixture(async(store,root)=>{
 await writeFile(path.join(root,'report.json'),JSON.stringify({format:'athanor-job-report/v1',jobId:'job',identity:{build:'Synthetic'},catalog:{state:'Blocked',counts:{Blocked:1}}}));await prepareDelivery(root,route);let writes=0;
 const sender=slackSender(route,{token:'xoxb-synthetic',fetcher:async(url)=>{if(url.endsWith('auth.test'))return {ok:true,json:async()=>({ok:true,team_id:'T07BPEAE014',url:'https://story-company.slack.com/',bot_id:'BTEST'})};if(url.endsWith('conversations.info'))return {ok:true,json:async()=>({ok:true,channel:{id:route.channelId,is_im:true,user:route.user}})};writes++;throw Error('lost reply');}});
 await assert.rejects(()=>sender.send(root),/response unavailable/);assert.equal(writes,1);assert.equal((await inspectDelivery(root)).state,'DELIVERY_UNKNOWN');await assert.rejects(()=>sender.send(root),/do not resend/);assert.equal(writes,1);
 const foreign=slackSender(route,{token:'xoxb-synthetic',fetcher:async()=>({ok:true,json:async()=>({ok:true,team_id:'TOTHER'})})});await assert.rejects(()=>foreign.verify(),/not a Story/);assert.equal(writes,1);
}));
test('all stages survive independent controller instances and retain the failed run beside 161 unexecuted assertions',async()=>fixture(async(store,root)=>{
 const {checkRegistry}=await import('../runner/catalog.mjs'),catalog=checkRegistry(),job=store.submit(request,selection,digest(profile)),posts=[];
 const preparation={id:job.preparationId,state:'Ready',version:'synthetic-version',packageHash:'b'.repeat(64),planHash:'c'.repeat(64),runnerHash:profile.runnerHash};
 const run={id:'synthetic-run',execution:{state:'Failed',package:{packageHash:preparation.packageHash,runnerHash:profile.runnerHash,version:preparation.version},recipe:{selection}},results:[{test_id:'A-CLI-01',status:'Fail',snapshot:{title:'Connection'},note:'Synthetic independent failure'}]};
 const call=async(route,body)=>{
  if(body)posts.push({route,body});if(route==='/api/worker')return idle;if(route==='/api/builds/import')return {app:request.build.value};if(route.startsWith('/api/preparations'))return preparation;
  if(route.startsWith('/api/plans/'))return {...preparation,recipe:{selection}};if(route==='/api/checks')return {checks:catalog};if(route==='/api/runner/start')return {runId:run.id};if(route.endsWith('/report'))return {path:'/original/report.html',url:'/exports/original/index.html'};
  if(route.startsWith('/api/runs/'))return run;throw Error('Unexpected route '+route);
 };
 for(let n=0;n<10;n++){await new JobController(store,{profile,call}).tick();if(store.get(job.id).state==='Complete')break;}
 const final=store.get(job.id);assert.equal(final.state,'Complete');assert.equal(final.outcome,'Failed');assert.equal(final.runId,run.id);assert.equal(posts.filter(c=>c.route==='/api/preparations').length,1);assert.equal(posts.filter(c=>c.route==='/api/runner/start').length,1);assert.equal(posts.find(c=>c.route==='/api/runner/start').body.requestId,job.runRequestId);
 const report=JSON.parse(await readFile(path.join(final.report.path,'report.json'),'utf8'));assert.equal(report.catalog.state,'Failed');assert.deepEqual(report.catalog.counts,{Fail:1});assert.deepEqual(report.assertionCounts,{NOT_RUN:161});assert.equal(report.catalogReport.url,'/exports/original/index.html');assert.match(await readFile(path.join(final.report.path,'index.html'),'utf8'),/Open detailed test evidence/);
}));
test('newest nightly without a package never silently falls back to an older build',async()=>{
 const releases=[{tag_name:'nightly-new',published_at:'2026-10-10T00:00:00Z',assets:[]},{tag_name:'nightly-old',published_at:'2026-10-09T00:00:00Z',assets:[{id:1,name:'Wizard-macos.zip'}]}];
 await assert.rejects(()=>resolveJobBuild({kind:'latest-nightly'},async()=>releases),/older build was not substituted/);
});
test('a restarted delivery intent is Unknown, never a second Slack send',async()=>fixture(async(store,root)=>{
 const job=store.submit(request,selection,digest(profile));await writeFile(path.join(root,'report.json'),JSON.stringify({format:'athanor-job-report/v1',jobId:job.id,identity:{build:'Synthetic'},catalog:{state:'Failed',counts:{Fail:1}}}));await prepareDelivery(root,route);store.update(job.id,{state:'Delivery',outcome:'Failed',report:{path:root},deliveryDispatched:true});let sends=0;
 const controller=new JobController(store,{profile,call:async()=>idle,route,send:async()=>{sends++;}});await controller.tick();assert.equal(sends,0);assert.equal(store.get(job.id).delivery,'DELIVERY_UNKNOWN');assert.equal((await inspectDelivery(root)).state,'DELIVERY_UNKNOWN');assert.equal(store.get(job.id).outcome,'Failed');
}));
test('a listener rebound to another source or workspace cannot import, prepare or Start',async()=>fixture(async store=>{
 const job=store.submit(request,selection,digest(profile));let writes=0;
 for(const state of ['Resolved','Imported','Ready']){
  store.update(job.id,{state,resolved:{input:{path:request.build.value}},imported:{app:request.build.value},planHash:'b'.repeat(64)});
  const controller=new JobController(store,{profile,call:async(route,body)=>{if(body)writes++;return {...idle,dataDir:'/different/worker'};}});
  await controller.tick();assert.equal(store.get(job.id).state,'Reporting');assert.match(store.get(job.id).error,/differs from the pinned worker/);
 }
 assert.equal(writes,0);
}));
