import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {JobStore} from '../runner/jobs.mjs';
import {JobController,retainJobReport,reconcileJobHandoff} from '../runner/controller.mjs';
import {checkRegistry,resolveSelection} from '../runner/catalog.mjs';
import {digest} from '../runner/files.mjs';
import {compareNightly,compileChangeCourse,regressionReferences,runPlanner} from '../runner/change-course.mjs';
import {recordFixReference,initializeInvestigations,investigation} from '../investigations.mjs';
import {publishJob,createReportViewer,readPublishedFile} from '../runner/report-viewer.mjs';
import {verifyReportRoutes,smokeChannel,prepareDelivery,inspectDelivery} from '../runner/delivery.mjs';
import {slackSender} from '../runner/slack-delivery.mjs';

const profile={runnerHash:'a'.repeat(64)},packageHash='b'.repeat(64),version='2026.10.12-'+ 'c'.repeat(7),head='c'.repeat(40),base='d'.repeat(40),fix='e'.repeat(40),checks=checkRegistry();
const input={courseIds:['smoke-full','macos-regression'],desktopMode:'grouped'},selection=resolveSelection({},input),request={requestId:'nightly-test',nightly:true,build:{kind:'app',value:'/Selected/Wizard.app'},selection:input,operator:'Test',timeoutMinutes:60};
const idle={sourceMatches:true,sourceHash:profile.runnerHash,ownedSessions:[],activeDesktopJobs:[],preparing:false,active:null};
const dm={workspace:'story-company',type:'im',userId:'U0BDBFNU0G1',user:'U0BDBFNU0G1',channelId:'DTEST123'},routes=[dm,smokeChannel];
const comparison=()=>{const c={repository:'story-wizard/wizard',base,head,commits:[{revision:head,message:'Fix a startup issue'}],files:[],url:'https://github.com/story-wizard/wizard/compare/'+base+'...'+head};return {...c,hash:digest(c)};};
const plannerJob={preparation:{version,packageHash},selection};
const changeInput=comp=>({format:'athanor-change-course/v1',build:version,packageHash,comparisonHash:comp.hash,scenarios:[{id:'startup',reason:'Exercise the changed endpoint connection',changeRefs:[head],checks:[{id:'A-CLI-01',definitionHash:checks[0].definitionHash,expected:checks[0].expected}]}],uncovered:[]});
async function fixture(fn){const root=await mkdtemp('/private/tmp/athanor-nightly-mvp-'),store=new JobStore(root);try{await fn(store,root);}finally{store.close();await rm(root,{recursive:true,force:true});}}
function service(store,{evergreen='Failed',change='Passed',prepareFailure=false}={}){
 const writes=[],preparations=new Map(),runs=new Map();
 const call=async(url,body)=>{
  const job=store.get(request.requestId);if(body)writes.push({url,body,course:job.activeCourse});
  if(url==='/api/worker')return idle;
  if(url==='/api/checks')return {checks};
  if(url==='/api/builds/import')return {app:request.build.value,packageHash};
  if(url==='/api/preparations'){
   const resolved=resolveSelection({},body.selection),p={id:body.preparationId,app:body.app,selection:resolved,runnerHash:profile.runnerHash,state:prepareFailure&&job.activeCourse==='changes'?'Failed':'Ready',error:'Synthetic preparation failure',version,packageHash,planHash:digest(body.preparationId)};preparations.set(p.id,p);return p;
  }
  if(url.startsWith('/api/preparations/'))return preparations.get(url.split('/').at(-1));
  if(url.startsWith('/api/plans/')){const p=[...preparations.values()].find(p=>p.planHash===url.split('/').at(-1));return {...p,recipe:{selection:p.selection}};}
  if(url==='/api/runner/start'){
   const p=[...preparations.values()].find(p=>p.planHash===body.planHash),state=job.activeCourse==='changes'?change:evergreen,id='run-'+job.activeCourse;
   const run={id,operator:request.operator,execution:{state,plan_hash:p.planHash,package:{packageHash,runnerHash:profile.runnerHash,version},recipe:{selection:p.selection}},results:p.selection.effectiveIds.map((id,i)=>({test_id:id,snapshot:{title:id},status:i===0&&state==='Failed'?'Fail':state==='Unknown'?'Unknown':'Pass',note:'Synthetic '+state}))};runs.set(id,run);return {runId:id};
  }
  if(url.startsWith('/api/runs/'))return runs.get(url.split('/').at(-1));
  throw Error('Unexpected route '+url);
 };return {call,writes,runs};
}
async function drive(store,options,n=30){for(let i=0;i<n;i++){await new JobController(store,options).tick();if(store.get(request.requestId).state==='Complete')return store.get(request.requestId);}throw Error('Controller did not finish: '+store.get(request.requestId).state+' '+JSON.stringify(store.get(request.requestId).error||store.get(request.requestId).lastError));}

test('fresh controller instances run evergreen then changes on one package with different retained IDs',async()=>fixture(async store=>{
 store.submit(request,selection,digest(profile));const stub=service(store),comp=comparison(),changePlan=compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,db:{}});let plans=0;
 const final=await drive(store,{profile,call:stub.call,planChanges:async()=>{plans++;return changePlan;},report:async(_s,j)=>{assert.equal(j.courseStages.evergreen.state,'Failed');assert.equal(j.courseStages.changes.state,'Passed');return {path:'/retained/report',state:j.outcome};}});
 assert.equal(plans,1);assert.equal(final.state,'Complete');assert.equal(final.outcome,'Failed');assert.deepEqual(stub.writes.filter(w=>w.url==='/api/runner/start').map(w=>w.course),['evergreen','changes']);assert.equal(stub.writes.filter(w=>w.url==='/api/builds/import').length,1);
 const a=final.courseStages.evergreen,b=final.courseStages.changes;assert.notEqual(a.runRequestId,b.runRequestId);assert.notEqual(a.preparationId,b.preparationId);assert.equal(a.preparation.packageHash,b.preparation.packageHash);assert.equal(a.selection.effectiveIds.length,192);assert.equal(b.selection.effectiveIds.length,1);
}));
test('planner failure and crash still execute evergreen, with visible Blocked or Unknown change stages',async()=>fixture(async store=>{
 for(const crash of [false,true]){
  store.db.exec('DELETE FROM jobs');const job=store.submit(request,selection,digest(profile)),stub=service(store,{evergreen:'Passed'});let plans=0;
  if(crash)store.update(job.id,{state:'PlanningActive',activeCourse:'evergreen',changePlan:null});
  if(crash){await new JobController(store,{profile,call:stub.call,planChanges:async()=>{plans++;}}).tick();assert.equal(store.get(job.id).changePlan.state,'Unknown');assert.equal(plans,0);continue;}
  const final=await drive(store,{profile,call:stub.call,planChanges:async()=>{plans++;throw Error('Planner not configured');},report:async()=>({path:'/retained/report'})});
  assert.equal(plans,1);assert.equal(final.courseStages.evergreen.state,'Passed');assert.equal(final.courseStages.changes.state,'Blocked');assert.equal(final.outcome,'Blocked');assert.equal(stub.writes.filter(w=>w.url==='/api/runner/start').length,1);
 }
}));
test('unknown evergreen execution cannot dispatch change preparation or actions',async()=>fixture(async store=>{
 store.submit(request,selection,digest(profile));const stub=service(store,{evergreen:'Unknown'}),comp=comparison(),plan=compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,db:{}});
 const final=await drive(store,{profile,call:stub.call,planChanges:async()=>plan,report:async()=>({path:'/retained/report'})});assert.equal(final.outcome,'Unknown');assert.equal(final.courseStages.changes.state,'Blocked');assert.equal(stub.writes.filter(w=>w.url==='/api/runner/start').length,1);
}));
test('change preparation failure preserves the completed evergreen result and exact package',async()=>fixture(async store=>{
 store.submit(request,selection,digest(profile));const stub=service(store,{evergreen:'Passed',prepareFailure:true}),comp=comparison(),plan=compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,db:{}});
 const final=await drive(store,{profile,call:stub.call,planChanges:async()=>plan,report:async(_s,j)=>{assert.equal(j.courseStages.evergreen.state,'Passed');assert.equal(j.preparation.state,'Failed');return {path:'/retained/report'};}});
 assert.equal(final.outcome,'Blocked');assert.equal(stub.writes.filter(w=>w.url==='/api/runner/start').length,1);
}));
test('source comparison rejects missing, divergent, truncated or mismatched shipped revisions',async()=>{
 const job={preparation:{version,packageHash}},previous={id:'previous',preparation:{version:'2026.10.11-'+base.slice(0,7),packageHash}},get=async url=>url.includes('/commits/')?{sha:head}:{base_commit:{sha:base},status:'ahead',total_commits:1,commits:[{sha:head,commit:{message:'Fix'}}],files:[]};
 const actual=await compareNightly(job,previous,{get});assert.equal(actual.head,head);assert.equal(actual.base,base);
 await assert.rejects(()=>compareNightly(job,null,{get}),/base revision/);
 for(const bad of [{status:'diverged'},{total_commits:251},{commits:[]},{commits:[{sha:fix}]}])await assert.rejects(()=>compareNightly(job,previous,{get:async url=>url.includes('/commits/')?{sha:head}:{...await get(url),...bad}}),/incomplete/);
 await assert.rejects(()=>compareNightly(job,previous,{get:async()=>({sha:base})}),/shipped/);
 const identical=async url=>url.includes('/commits/')?{sha:head}:{base_commit:{sha:head},status:'identical',total_commits:0,commits:[],files:[]};
 assert.equal((await compareNightly(job,{preparation:{version,packageHash}},{get:identical})).commits.length,0);
 await assert.rejects(()=>compareNightly(job,{preparation:{version,packageHash:fix}},{get:identical}),/package bytes/);
});
test('compiler rejects missing changes, mutated expectations, stale definitions and unknown actions',()=>{
 const comp=comparison(),args={job:plannerJob,comparison:comp,catalog:checks,db:{}};assert.equal(compileChangeCourse(changeInput(comp),args).selection.effectiveIds.length,1);
 for(const edit of [p=>p.scenarios=[],p=>p.packageHash=fix,p=>p.scenarios[0].checks[0].expected='Any successful dispatch',p=>p.scenarios[0].checks[0].definitionHash=fix,p=>p.scenarios[0].checks[0].operation='unknown',p=>p.scenarios[0].changeRefs=[base]]){
  const p=changeInput(comp);edit(p);assert.throws(()=>compileChangeCourse(p,args));
 }
 const empty={...comp,commits:[]};delete empty.hash;empty.hash=digest(empty);const p={...changeInput(empty),scenarios:[]};assert.equal(compileChangeCourse(p,{...args,comparison:empty}).state,'Empty');
 const blocked={...changeInput(comp),scenarios:[],uncovered:[{revision:head,reason:'New behavior needs a new qualified test'}]};assert.equal(compileChangeCourse(blocked,args).state,'Blocked');
});
test('a fix two days later reuses the original failure only after verified revision inclusion; drift needs review',()=>{
 const c=checks[0],record={id:'investigation',baseline:{runId:'first-run',identities:{version:'old',packageHash},selection:{project:'fresh'},reportUrl:'/original',reportHash:base},cases:[{id:c.id,classification:'App',original:{status:'Fail',expected:c.expected,definitionHash:c.definitionHash,observation:'Original mismatch'},fix:{repository:'story-wizard/wizard',revision:fix,url:'https://github.com/story-wizard/wizard/pull/1'}}]};
 assert.equal(regressionReferences([record],checks,comparison()).length,0);
 const comp={...comparison(),verifiedFixRevisions:[fix]};delete comp.hash;comp.hash=digest(comp);const refs=regressionReferences([record],checks,comp);assert.equal(refs.length,1);assert.equal(refs[0].original.runId,'first-run');
 assert.equal(compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,regressions:refs,db:{}}).state,'Ready');
 const drift=regressionReferences([record],checks.map(d=>({...d,definitionHash:base})),comp);assert.equal(drift[0].available,false);assert.match(drift[0].reason,/Definition changed/);
});
test('fix links use optimistic revisions and preserve original outcomes and review',()=>{
 const db=new DatabaseSync(':memory:');initializeInvestigations(db);const record={id:'record',revision:1,history:[],cases:[{id:'check',classification:'App',original:{status:'Fail',observation:'Failure'},attempts:[],review:{decision:'Needs work'}}]};db.prepare('INSERT INTO investigations VALUES (?,?,?)').run(record.id,1,JSON.stringify(record));
 try{const input={revision:1,actor:'Lead',caseId:'check',fix:{repository:'story-wizard/wizard',revision:fix,url:'https://github.com/story-wizard/wizard/pull/1'}};const next=recordFixReference(db,record.id,input);assert.equal(next.revision,2);assert.equal(next.cases[0].original.status,'Fail');assert.equal(next.cases[0].review.decision,'Needs work');assert.throws(()=>recordFixReference(db,record.id,input),/changed/);assert.equal(investigation(db,record.id).cases[0].fix.revision,fix);}finally{db.close();}
});
test('planner uses stdin JSON without a shell and bounds malformed output and execution',async()=>{
 const config={command:[process.execPath,'-e','let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.stringify({value:JSON.parse(s).value})))'],timeoutSeconds:2};assert.deepEqual(await runPlanner(config,{value:'$(touch unsafe); quoted data'}),{value:'$(touch unsafe); quoted data'});
 await assert.rejects(()=>runPlanner({...config,command:[process.execPath,'-e','console.log("bad")']},{}),/invalid JSON/);
 await assert.rejects(()=>runPlanner({...config,timeoutSeconds:1,command:[process.execPath,'-e','setInterval(()=>{},100)']},{}),/deadline/);
});

async function publicationFixture(root){
 const privateRoot=path.join(root,'private'),reportRoot=path.join(privateRoot,'exports','athanor-job-test');await mkdir(reportRoot,{recursive:true});const report={format:'athanor-job-report/v1',jobId:'test',runId:null,identity:{build:'Synthetic build'},cases:[],catalog:{state:'Failed',counts:{Fail:1},checks:[]}};
 await writeFile(path.join(reportRoot,'report.json'),JSON.stringify(report));await writeFile(path.join(reportRoot,'index.html'),'<h1>Report</h1><a href="/exports/athanor-job-test/report.json">Details</a>');await mkdir(path.join(reportRoot,'delivery'));await writeFile(path.join(reportRoot,'delivery','private.json'),'PRIVATE DESTINATION');
 return {privateRoot,job:{id:'test',report:{path:reportRoot,url:'/exports/athanor-job-test/index.html',reportHash:digest(report)}},config:{directory:path.join(root,'published'),baseUrl:'http://127.0.0.1:1/'}};
}
test('immutable publication excludes private delivery, serves report links, blocks mutations, escapes and changed bytes',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root),published=await publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),relative=new URL(published.url).pathname.slice(1);assert.match((await readPublishedFile(f.config.directory,relative)).toString(),/Report/);
 const server=createReportViewer(f.config.directory);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url+'/'+relative)).status,200);assert.equal((await fetch(url+'/exports/athanor-job-test/report.json',{headers:{Referer:url+'/'+relative}})).status,200);
  assert.equal((await fetch(url+'/api/runner/start',{method:'POST'})).status,405);assert.equal((await fetch(url+'/api/checks')).status,404);assert.equal((await fetch(url+'/'+relative.replace('index.html','delivery/private.json'))).status,404);const foreign=await new Promise(resolve=>http.get(url+'/'+relative,{headers:{Host:'foreign.example'}},res=>{res.resume();resolve(res.statusCode);}));assert.equal(foreign,403);
  await assert.rejects(()=>readPublishedFile(f.config.directory,relative.replace('index.html','../report.json')));await writeFile(path.join(published.path,'exports','athanor-job-test','index.html'),'Changed');assert.equal((await fetch(url+'/'+relative)).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
test('publication rejects undeclared files and symlink evidence without changing the local report',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root),before=await readFile(path.join(f.job.report.path,'report.json'));await writeFile(path.join(f.job.report.path,'secret.json'),'private');await assert.rejects(()=>publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),/Undeclared/);assert.deepEqual(await readFile(path.join(f.job.report.path,'report.json')),before);await rm(path.join(f.job.report.path,'secret.json'));await symlink('/etc/hosts',path.join(f.job.report.path,'secret.txt'));await assert.rejects(()=>publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),/linked/);
}));
function fakeSlack({loseChannel=false}={}){const posted=[];return {posted,fetcher:async(url,options)=>{const body=JSON.parse(options.body);let value={ok:true};if(url.endsWith('auth.test'))Object.assign(value,{team_id:'T07BPEAE014',url:'https://story-company.slack.com/',bot_id:'BTEST'});
 else if(url.endsWith('conversations.info'))value.channel=body.channel===dm.channelId?{id:dm.channelId,is_im:true,user:dm.userId}:{id:smokeChannel.channelId,is_channel:true,is_member:true,is_private:false,name:smokeChannel.name};
 else if(url.endsWith('chat.postMessage')){posted.push(body);if(loseChannel&&body.channel===smokeChannel.channelId)throw Error('Response lost');Object.assign(value,{channel:body.channel,ts:'123.456'});}
 else if(url.endsWith('chat.getPermalink'))value.permalink='https://story-company.slack.com/archives/'+body.conversation_id+'/p'+body.message_ts.replace('.','');else throw Error('Unexpected Slack request');return {ok:true,json:async()=>value};}};}
test('two destinations retain independent confirmed/unknown states, do not leak local paths or resend after restart',async()=>fixture(async(store,root)=>{
 const f=await publicationFixture(root),job=store.submit(request,selection,digest(profile));store.update(job.id,{state:'Delivery',outcome:'Failed',report:f.job.report,publication:{state:'Failed',error:'Host unavailable'}});const slack=fakeSlack({loseChannel:true}),senders=new Map(routes.map(r=>[r.channelId,slackSender(r,{token:'xoxb-test',fetcher:slack.fetcher})]));
 const options={profile,call:async()=>idle,routes,send:(directory,r)=>senders.get(r.channelId).send(directory,{perDestination:true})};await new JobController(store,options).tick();const final=store.get(job.id);assert.equal(final.delivery,'DELIVERY_UNKNOWN');assert.equal(final.deliveries[dm.channelId].state,'DELIVERY_CONFIRMED');assert.equal(final.deliveries[smokeChannel.channelId].state,'DELIVERY_UNKNOWN');assert.equal(slack.posted.length,2);assert.ok(slack.posted.every(p=>p.text.includes('Shared report unavailable')&&!p.text.includes(root)));
 store.update(job.id,{state:'Delivery'});await new JobController(store,options).tick();assert.equal(slack.posted.length,2);
 const routeFile=path.join(root,'route.json');await writeFile(routeFile,JSON.stringify(dm));const {main}=await import('../scripts/report-delivery.mjs');assert.equal((await main(['inspect','--report',f.job.report.path,'--route',routeFile])).state,'DELIVERY_CONFIRMED');
}));
test('ready Slack links require a matching publication hash and exact permitted routes',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root),published=await publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}});await prepareDelivery(f.job.report.path,smokeChannel,{perDestination:true,publication:published});assert.match((await inspectDelivery(f.job.report.path,smokeChannel)).intent.message,/Report: http/);
 assert.throws(()=>verifyReportRoutes([dm,{...smokeChannel,channelId:'COTHER'}]),/permitted/);assert.throws(()=>verifyReportRoutes([dm,dm]),/one DM/);
 await assert.rejects(()=>prepareDelivery(f.job.report.path,dm,{perDestination:true,publication:{...published,reportHash:base}}),/does not match/);
}));

test('combined retained reports keep original/new outcomes and separate detail links without promoting the legacy ledger',async()=>fixture(async(store,root)=>{
 store.submit(request,selection,digest(profile));const stub=service(store),comp=comparison(),changePlan=compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,db:{}});
 const call=async(url,body)=>{
  if(url.endsWith('/report'))return {path:'/retained/details',url:'/exports/smoke-report-'+(url.includes('evergreen')?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222')+'-abcdefabcdef/index.html'};
  if(url.startsWith('/api/investigations'))return [];
  return stub.call(url,body);
 };
 const final=await drive(store,{profile,call,planChanges:async()=>changePlan});
 const report=JSON.parse(await readFile(path.join(final.report.path,'report.json')));assert.equal(report.courseStages.length,2);assert.equal(report.courseStages[0].state,'Failed');assert.equal(report.courseStages[1].state,'Passed');assert.equal(report.catalog.state,'Failed');assert.deepEqual(report.assertionCounts,{NOT_RUN:161});
 const first=report.catalog.checks.find(c=>c.id==='A-CLI-01'&&c.course==='evergreen'),later=report.catalog.checks.find(c=>c.id==='A-CLI-01'&&c.course==='changes');assert.equal(first.status,'Fail');assert.equal(later.status,'Pass');assert.notEqual(first.detailsUrl,later.detailsUrl);assert.match(await readFile(path.join(final.report.path,'index.html'),'utf8'),/Change and fix verification/);
 assert.equal((await store.get(final.id)).courseStages.evergreen.handoff.state,'Needs review');
 const before=stub.writes.filter(w=>w.url.endsWith('/investigation')).length,result=await reconcileJobHandoff(store,store.get(final.id),call);assert.equal(result.handoffs.evergreen.state,'Needs review');assert.equal(result.handoffs.changes.state,'Not needed');assert.equal(stub.writes.filter(w=>w.url.endsWith('/investigation')).length,before);
}));
test('planner policy changes cannot take over queued jobs or scheduled slots',async()=>fixture(async(store,root)=>{
 const pinned=new JobStore(root,{policyHash:digest(base)});try{const job=pinned.submit(request,selection,digest(profile));const changed=new JobStore(root,{policyHash:digest(fix)});try{let writes=0;await new JobController(changed,{profile,call:async()=>{writes++;}}).tick();assert.equal(changed.get(job.id).state,'Unknown');assert.equal(writes,0);assert.throws(()=>changed.submit(request,selection,digest(profile)),/different inputs/);}finally{changed.close();}}finally{pinned.close();}
}));
test('lost change Start reconciles the second stage ID without repeating either course',async()=>fixture(async store=>{
 store.submit(request,selection,digest(profile));const stub=service(store,{evergreen:'Passed'}),comp=comparison(),changePlan=compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,db:{}});let lost=false;
 const call=async(url,body)=>{if(url==='/api/runner/start'&&store.get(request.requestId).activeCourse==='changes'&&!lost){lost=true;await stub.call(url,body);throw Object.assign(Error('Lost second Start'),{responseLost:true});}if(url.startsWith('/api/requests/'))return stub.runs.get('run-changes');return stub.call(url,body);};
 const final=await drive(store,{profile,call,planChanges:async()=>changePlan,report:async()=>({path:'/retained/report'})});assert.equal(final.courseStages.changes.runId,'run-changes');assert.equal(stub.writes.filter(w=>w.url==='/api/runner/start').length,2);
}));
test('publisher carries declared screenshot/video bytes and rejects corrupt source evidence before announcing Ready',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root),name='smoke-report-11111111-1111-4111-8111-111111111111-abcdefabcdef',directory=path.join(f.privateRoot,'exports',name);await mkdir(path.join(directory,'evidence'),{recursive:true});const bytes=Buffer.from('synthetic media bytes'),proof={file:'capture.mp4',bytes:bytes.length,sha256:digest(bytes.toString())};
 await writeFile(path.join(directory,'evidence',proof.file),bytes);await writeFile(path.join(directory,'report.json'),JSON.stringify({artifacts:[proof]}));await writeFile(path.join(directory,'index.html'),'<video controls src="evidence/capture.mp4"></video>');
 const report=JSON.parse(await readFile(path.join(f.job.report.path,'report.json')));report.catalogReport={url:'/exports/'+name+'/index.html'};await writeFile(path.join(f.job.report.path,'report.json'),JSON.stringify(report));f.job.report.reportHash=digest(report);
 const published=await publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),relative=new URL(published.url).pathname.split('/')[1]+'/exports/'+name+'/evidence/capture.mp4';assert.deepEqual(await readPublishedFile(f.config.directory,relative),bytes);
 await writeFile(path.join(directory,'evidence',proof.file),'corrupted');await assert.rejects(()=>publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),/Evidence changed/);
}));
test('Codex adapter forwards only planning context, ignores user config, and enforces read-only structured output',async()=>fixture(async(_store,root)=>{
 const {main}=await import('../scripts/nightly-agent.mjs'),fake=path.join(root,'fake-codex'),answer={format:'athanor-change-course/v1',scenarios:[]};
 await writeFile(fake,'#!'+process.execPath+'\nimport {writeFileSync} from "node:fs";let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const args=process.argv.slice(2),out=args[args.indexOf("--output-last-message")+1];writeFileSync(out,'+JSON.stringify(JSON.stringify(answer))+');writeFileSync(out+".args",JSON.stringify(args));});\n',{mode:0o700});
 const input={format:'athanor-nightly-planner-task/v1',jobId:'synthetic',directory:path.join(root,'agent'),comparison:comparison()};assert.deepEqual(await main(['--codex',fake],input),answer);const args=JSON.parse(await readFile(path.join(input.directory,'answer.json.args')));assert.ok(args.includes('--ignore-user-config'));assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.ok(args.includes('--output-schema'));assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
 await assert.rejects(()=>main(['--codex',fake],input),/EEXIST/);
}));

test('publication readiness checks the exact viewer response; unreachable hosting leaves immutable local reports',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root);await mkdir(f.config.directory,{recursive:true});const server=createReportViewer(f.config.directory);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));f.config.baseUrl='http://127.0.0.1:'+server.address().port+'/';
 try{const published=await publishJob(f.privateRoot,f.job,f.config);assert.equal(published.state,'Published');assert.equal((await fetch(published.url,{method:'HEAD'})).headers.get('x-athanor-publication'),published.id);}finally{await new Promise(resolve=>server.close(resolve));}
 f.config.baseUrl='http://127.0.0.1:1/';await assert.rejects(()=>publishJob(f.privateRoot,f.job,f.config));assert.equal(JSON.parse(await readFile(path.join(f.job.report.path,'report.json'))).catalog.state,'Failed');
}));
test('obvious credentials cannot enter a shared export and source proof remains unchanged',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root);await writeFile(path.join(f.job.report.path,'index.html'),'<p>xoxb-'+ 'secret'.repeat(8)+'</p>');await assert.rejects(()=>publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),/credential/);assert.match(await readFile(path.join(f.job.report.path,'index.html'),'utf8'),/xoxb/);
}));

test('edited delivery text is rejected before Slack dispatch',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root);await prepareDelivery(f.job.report.path,dm,{perDestination:true,publication:{state:'Failed',error:'No host'}});const file=path.join(f.job.report.path,'delivery',dm.channelId,'intent.json'),intent=JSON.parse(await readFile(file));intent.message='Different report';await writeFile(file,JSON.stringify(intent));const slack=fakeSlack(),sender=slackSender(dm,{token:'xoxb-test',fetcher:slack.fetcher});await assert.rejects(()=>sender.send(f.job.report.path,{perDestination:true}),/intent changed/);assert.equal(slack.posted.length,0);
}));
test('video range requests preserve verified bytes and reject impossible ranges',async()=>fixture(async(_store,root)=>{
 const f=await publicationFixture(root),published=await publishJob(f.privateRoot,f.job,f.config,{probe:async()=>{}}),relative=new URL(published.url).pathname;const server=createReportViewer(f.config.directory);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{const response=await fetch(url+relative,{headers:{Range:'bytes=0-3'}});assert.equal(response.status,206);assert.equal(await response.text(),'<h1>');assert.match(response.headers.get('content-range'),/^bytes 0-3\//);assert.equal((await fetch(url+relative,{headers:{Range:'bytes=999999-'}})).status,416);}finally{await new Promise(resolve=>server.close(resolve));}
}));

test('a changed controller policy cannot enable or admit an old daily schedule',async()=>fixture(async(store,root)=>{
 const start=Date.parse('2026-10-10T18:00:00Z');store.saveSchedule({timeZone:'America/Los_Angeles',hour:3,minute:0,request,selection,profileHash:digest(profile)},start);store.enable(true,start);
 const changed=new JobStore(root,{policyHash:digest('new policy')});try{assert.throws(()=>changed.enable(true,start),/Schedule policy changed/);assert.throws(()=>changed.due(start+86400000),/another controller policy/);assert.equal(changed.list().length,0);}finally{changed.close();}
}));
test('retained planning bytes cannot silently change selection on recovery',async()=>fixture(async store=>{
 const {verifyChangePlan}=await import('../runner/change-course.mjs'),comp=comparison(),plan=compileChangeCourse(changeInput(comp),{job:plannerJob,comparison:comp,catalog:checks,db:{}});assert.equal(verifyChangePlan(plan,plannerJob).state,'Ready');plan.input.subsetIds.push('IN-01');assert.throws(()=>verifyChangePlan(plan,plannerJob),/plan bytes/);
}));

test('planning children do not inherit the worker Slack or GitHub credentials',async()=>{
 const previous=process.env.ATHANOR_SLACK_BOT_TOKEN;process.env.ATHANOR_SLACK_BOT_TOKEN='xoxb-test-not-for-planner';try{const config={command:[process.execPath,'-e','console.log(JSON.stringify({inherited:!!process.env.ATHANOR_SLACK_BOT_TOKEN,path:!!process.env.PATH}))'],timeoutSeconds:2};assert.deepEqual(await runPlanner(config,{}),{inherited:false,path:true});}finally{if(previous===undefined)delete process.env.ATHANOR_SLACK_BOT_TOKEN;else process.env.ATHANOR_SLACK_BOT_TOKEN=previous;}
});

test('the first-read brief summarizes change execution and links large planning data',async()=>{
 const {jobResultBrief}=await import('../runner/job-handoff.mjs'),plan={state:'Ready',scenarios:[{id:'scenario'}],uncovered:[],comparison:{...comparison(),files:[{patch:'large patch '.repeat(10000)}]},courseStages=[{name:'evergreen',state:'Passed',runId:'old',counts:{Pass:192}},{name:'changes',state:'Passed',runId:'new',counts:{Pass:1}}],job={id:'nightly',state:'Complete',request,selection,report:{url:'/exports/athanor-job-nightly/index.html'}};
 const brief=jobResultBrief(job,{identity:{build:version,releaseChanges:[{tag:version,notes:'notes'}]},catalog:{state:'Passed',counts:{Pass:193},checks:[]},changePlan:plan,courseStages});assert.equal(brief.releasePlanning.executed,true);assert.equal(brief.releasePlanning.state,'Ready');assert.equal(brief.changePlan.comparison.files,undefined);assert.equal(brief.changePlan.scenarioCount,1);assert.match(brief.changePlan.detailsUrl,/report.json$/);assert.ok(JSON.stringify(brief).length<6000);
});
