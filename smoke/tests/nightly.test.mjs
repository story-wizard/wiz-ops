import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createNightlyPlan,consolidateNightly,nightlyHTML,nightlyCases,releaseTestProposals} from '../runner/nightly.mjs';
import {digest,sha} from '../runner/files.mjs';
import {checkRegistry,resolveSelection} from '../runner/catalog.mjs';
const suite={cases:[{id:'CORE-01',area:'Startup',steps:['Open the selected build'],expected:['Correct build','Responsive window']}]};
const catalog=[{id:'A-CLI-01',definitionHash:'d'.repeat(64),accepted:true}];
const identity={build:'test-build',packageHash:'a'.repeat(64),runnerHash:'b'.repeat(64)};
function run(){return {id:'run-1',execution:{state:'Passed',package:{version:identity.build,...identity}},results:[{test_id:'A-CLI-01',snapshot:{title:'Engine connection'},status:'Pass',note:'Connected',evidence:'operations.jsonl'}]};}

test('assertion routes pin related definitions, flag drift and never promote catalog results',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-assertion-routes-');
 try{
  const mappings={'CORE-01':{specHash:digest(nightlyCases(suite)[0]),checkIds:['A-CLI-01'],assertions:[
   {id:'CORE-01:1',checks:[{id:'A-CLI-01',definitionHash:catalog[0].definitionHash}],remaining:['Exercise Updater installation.']},
   {id:'CORE-01:2',checks:[],remaining:['Observe responsive startup.']}
  ]}};
  const plan=createNightlyPlan(suite,catalog,{...identity,dataDir:root},mappings);
  assert.equal(plan.cases[0].assertions[0].support.coverage,'related');assert.equal(plan.cases[0].assertions[1].support.coverage,'gap');
  const report=await consolidateNightly(plan,run());assert.equal(report.cases[0].assertions[0].status,'NOT_RUN');
  const html=nightlyHTML(report);assert.match(html,/Exercise Updater installation\./);assert.match(html,/No related check<\/p><p>Observe responsive startup\./);assert.equal((html.match(/<details>/g)||[]).length,(html.match(/<\/details>/g)||[]).length);
  const changed=createNightlyPlan(suite,[{...catalog[0],definitionHash:'e'.repeat(64)}],{...identity,dataDir:root},mappings);
  assert.equal(changed.cases[0].mappingNeedsReview,true);assert.equal(changed.cases[0].assertions[0].support.coverage,'review-required');assert.equal(changed.cases[0].candidates[0].available,false);
  const route=mappings['CORE-01'].assertions[0];
  for(const assertions of [[route],[route,route],[{...route,remaining:[]},mappings['CORE-01'].assertions[1]],[{...route,checks:[{id:'A-CLI-01',definitionHash:'wrong'}]},mappings['CORE-01'].assertions[1]],[{...route,status:'PASS'},mappings['CORE-01'].assertions[1]]])assert.throws(()=>createNightlyPlan(suite,catalog,{...identity,dataDir:root},{'CORE-01':{...mappings['CORE-01'],assertions}}),/assertion mapping/i);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('maintained assertion reconciliation and grouped selection retain all gaps without executing them',async()=>{
 const actual=JSON.parse(await readFile(new URL('../examples/nightly/suite.json',import.meta.url))),mappings=JSON.parse(await readFile(new URL('../examples/nightly/mapping.json',import.meta.url))),checks=checkRegistry(),selection=resolveSelection({},{courseIds:['smoke-full']});
 const plan=createNightlyPlan(actual,checks,{...identity,dataDir:'/private/tmp/athanor-plan-only'},mappings,{executionSelection:selection}),weekly=createNightlyPlan(actual,checks,{...identity,dataDir:'/private/tmp/athanor-plan-only'},mappings,{cadence:'weekly',executionSelection:selection});
 assert.deepEqual(plan.cases.map(c=>c.id),actual.cases.map(c=>c.id));assert.equal(plan.cases.some(c=>c.mappingNeedsReview),false);
 assert.ok(plan.cases.every(c=>c.assertions.every(a=>a.support.remaining.length&&a.status==='NOT_RUN')));
 assert.deepEqual(plan.execution.selection.effectiveIds,weekly.execution.selection.effectiveIds);assert.equal(plan.execution.selection.desktopMode,'grouped');assert.equal(plan.execution.selection.effectiveIds.includes('S-PF-IDLE'),false);assert.equal(plan.execution.state,'PLANNING_ONLY');
 assert.equal(plan.cases.find(c=>c.id==='RAW-01').assertions[0].support.coverage,'gap');assert.equal(plan.cases.find(c=>c.id==='SEARCH-01').candidates.length,0);assert.ok(plan.cases.find(c=>c.id==='MISSING-MEDIA-01').candidates.some(c=>c.id==='A-IN-08-R'));
 assert.throws(()=>createNightlyPlan(actual,checks,{...identity,dataDir:'/private/tmp/athanor-plan-only'},mappings,{executionSelection:{...selection,effectiveIds:['UNBOUND']}}),/selection/);
});

test('nightly CLI freezes the actual selection and rejects a different service definition before writing',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-nightly-command-');
 try{
  const source=await readFile(new URL('../scripts/nightly.mjs',import.meta.url),'utf8'),checks=checkRegistry();
  for(const drift of [false,true]){
   const remote=checks.map(c=>drift&&c.id==='A-CLI-01'?{...c,definitionHash:'f'.repeat(64)}:c),out=root+'/'+(drift?'drift':'current')+'.json';
   const module=root+'/'+(drift?'drift':'current')+'.mjs',rewritten=source.replace("import {client} from './smoke.mjs';",`const client=()=>async url=>{if(url==='/api/checks')return ${JSON.stringify({checks:remote,candidates:[]})};if(url==='/api/worker')return ${JSON.stringify({sourceMatches:true,sourceHash:identity.runnerHash,dataDir:root})};throw Error('Unexpected request: '+url);};`).replace(/from '(\.\.?\/[^']+)'/g,(_m,p)=>"from '"+new URL(p,new URL('../scripts/nightly.mjs',import.meta.url)).href+"'");
   await writeFile(module,rewritten);const {main}=await import(pathToFileURL(module).href),args=['plan','--build',identity.build,'--package-hash',identity.packageHash,'--out',out,'--server','http://127.0.0.1:1'];
   if(drift){await assert.rejects(()=>main(args),/differ from the service/);assert.equal(await lstat(out).catch(()=>null),null);}
   else{const result=await main(args),plan=JSON.parse(await readFile(out));assert.equal(result.executionStarted,false);assert.equal(result.selectedCheckCount,plan.execution.selection.effectiveIds.length);assert.deepEqual(result.assertionSupport,{related:68,gap:93});assert.equal(plan.execution.definitions.find(c=>c.id==='A-CLI-01').definitionHash,checks.find(c=>c.id==='A-CLI-01').definitionHash);}
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the maintained suite keeps every case and candidate overlap does not become assertion coverage',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-nightly-');
 try{
  const actual=JSON.parse(await readFile(new URL('../examples/nightly/suite.json',import.meta.url)));
  assert.equal(nightlyCases(actual).length,actual.cases.length);
  const mappings={'CORE-01':{specHash:digest(nightlyCases(suite)[0]),checkIds:['A-CLI-01','ABSENT']}};
  const plan=createNightlyPlan(suite,catalog,{...identity,dataDir:root},mappings),report=await consolidateNightly(plan,run());
  assert.equal(plan.cases[0].candidates[0].accepted,true);assert.equal(plan.cases[0].candidates[1].available,false);
  assert.equal(plan.cases[0].assertions[0].support.coverage,'review-required');assert.equal(plan.cases[0].mappingNeedsReview,true);
  assert.deepEqual(report.caseCounts,{NOT_RUN:1});assert.deepEqual(report.assertionCounts,{NOT_RUN:2});assert.deepEqual(report.catalog.counts,{Pass:1});
  const changed=createNightlyPlan({cases:[{...suite.cases[0],expected:['Changed expectation']}]},catalog,{...identity,dataDir:root},mappings);
  assert.equal(changed.cases[0].mappingNeedsReview,true);assert.deepEqual(changed.cases[0].candidates,[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('consolidation requires exact run identity, retained evidence and all assertions for a case Pass',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-nightly-proof-');
 try{
  const evidence=root+'/capture.txt';await writeFile(evidence,'retained observation');
  const plan=createNightlyPlan(suite,catalog,{...identity,dataDir:root}),entry={id:'CORE-01:1',status:'PASS',observation:'Observed selected build',evidence:[{path:evidence,sha256:await sha(evidence)}]},observations={planHash:plan.planHash,runId:'run-1',assertions:[entry]};
  assert.equal((await consolidateNightly(plan,run(),observations)).cases[0].status,'PARTIAL');
  const full=await consolidateNightly(plan,run(),{...observations,assertions:[entry,{...entry,id:'CORE-01:2'}]});assert.equal(full.cases[0].status,'PASS');assert.equal(full.cases[0].assertions[0].origin,'Agent observation');
  for(const bad of [{...observations,runId:'other'},{...observations,planHash:'wrong'},{assertions:[entry]},{...observations,assertions:[entry,entry]},{...observations,assertions:[{...entry,id:'unknown'}]},{...observations,assertions:[{...entry,evidence:[]}]}])await assert.rejects(()=>consolidateNightly(plan,run(),bad));
  for(const value of [{...run(),execution:{...run().execution,state:'Running'}},{...run(),execution:{...run().execution,package:{...run().execution.package,packageHash:'c'.repeat(64)}}}])await assert.rejects(()=>consolidateNightly(plan,value,observations));
  await assert.rejects(()=>consolidateNightly({...plan,cases:[]},run(),observations),/plan changed/);
  await writeFile(evidence,'changed observation');await assert.rejects(()=>consolidateNightly(plan,run(),observations),/evidence/);
  const html=nightlyHTML({...full,identity:{...full.identity,build:'<script>alert(1)</script>'}});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/Filter status/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('invalid, empty and duplicate functional specifications fail before planning',()=>{
 for(const cases of [[],[...suite.cases,...suite.cases],[{...suite.cases[0],expected:[]}],[{...suite.cases[0],steps:['']}],[{...suite.cases[0],id:'../../escape'}]])assert.throws(()=>nightlyCases({cases}));
});

test('unified planning keeps every catalog check and legacy assertion; release proposals never become accepted tests',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-unified-plan-');
 try{
  const input={format:'athanor-release-test-proposals/v1',build:identity.build,packageHash:identity.packageHash,proposals:[{id:'change-1',source:{url:'https://example.test/release',kind:'developer-changelog',summary:'Synthetic marker change',retention:'summary',contentHash:digest('Synthetic marker change')},reason:'Exercise the changed marker behavior',prerequisites:['Local graphic runtime'],checkIds:['A-CLI-01','MISSING'],case:{id:'CHANGE-01',steps:['Render the changed fixture'],expected:['Marker appears at its expected frame position']}}]};
  const checks=[...catalog,{id:'CANDIDATE',definitionHash:'c'.repeat(64),accepted:false,executable:false}],plan=createNightlyPlan(suite,checks,{...identity,dataDir:root},{},{cadence:'weekly',proposals:input});
  assert.equal(plan.cadence,'weekly');assert.deepEqual(plan.catalogInventory.map(c=>[c.id,c.status]),[['A-CLI-01','NOT_RUN'],['CANDIDATE','NOT_RUN']]);assert.equal(plan.catalogInventory[1].executable,false);assert.equal(plan.cases.length,1);assert.equal(plan.cases[0].assertions.length,2);
  assert.equal(plan.releaseTestProposals[0].status,'Proposed');assert.equal(plan.releaseTestProposals[0].candidates[1].available,false);assert.equal(checks[1].accepted,false);
  const report=await consolidateNightly(plan,run());assert.deepEqual(report.catalogInventoryCounts,{Pass:1,NOT_RUN:1});assert.deepEqual(report.assertionCounts,{NOT_RUN:2});assert.equal(report.releaseTestProposals[0].status,'Proposed');
  for(const bad of [{...input,build:'other'},{...input,packageHash:'f'.repeat(64)},{...input,proposals:[...input.proposals,...input.proposals]},{...input,proposals:[{...input.proposals[0],status:'Accepted'}]},{...input,proposals:[{...input.proposals[0],source:{...input.proposals[0].source,url:'file:///private/secret'}}]}])assert.throws(()=>releaseTestProposals(bad,checks,identity));
  assert.throws(()=>createNightlyPlan(suite,checks,{...identity,dataDir:root},{},{proposals:{...input,proposals:[{...input.proposals[0],case:suite.cases[0]}]}}),/replace/);
  assert.throws(()=>createNightlyPlan(suite,checks,{...identity,dataDir:root},{},{cadence:'hourly'}));assert.throws(()=>createNightlyPlan(suite,[...checks,checks[0]],{...identity,dataDir:root}),/Duplicate catalog/);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('completed nightly exports retain bytes, never a mutable source symlink',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-nightly-export-');
 try{
  const evidence=root+'/capture.txt',output=root+'/report';await writeFile(evidence,'retained bytes');
  const plan=createNightlyPlan(suite,catalog,{...identity,dataDir:root}),observations={planHash:plan.planHash,runId:'run-1',assertions:[{id:'CORE-01:1',status:'PASS',observation:'Observed build',evidence:[{path:evidence,sha256:await sha(evidence)}]}]};
  for(const [name,value] of [['plan',plan],['observations',observations]])await writeFile(root+'/'+name+'.json',JSON.stringify(value));
  const io=root+'/io.mjs';await writeFile(io,`export * from 'node:fs/promises';import {mkdir as create,rename,symlink} from 'node:fs/promises';
export async function mkdir(p,options){const r=await create(p,options);if(p===${JSON.stringify(output)}){await rename(${JSON.stringify(evidence)},${JSON.stringify(root+'/retained.txt')});await symlink(${JSON.stringify(root+'/retained.txt')},${JSON.stringify(evidence)});}return r;}`);
  // Move the source at the export boundary after validation; either reject or retain a regular checked copy.
  const source=process.env.ATHANOR_REVIEW_BASELINE?execFileSync('/usr/bin/git',['show',process.env.ATHANOR_REVIEW_BASELINE+':smoke/scripts/nightly.mjs'],{encoding:'utf8'}):await readFile(new URL('../scripts/nightly.mjs',import.meta.url),'utf8');
  const module=root+'/command.mjs',rewritten=source.replace("from 'node:fs/promises'","from '"+pathToFileURL(io).href+"'").replace("import {client} from './smoke.mjs';","const client=()=>async()=> ("+JSON.stringify(run())+");").replace(/from '(\.\.?\/[^']+)'/g,(_m,p)=>"from '"+new URL(p,new URL('../scripts/nightly.mjs',import.meta.url)).href+"'");
  await writeFile(module,rewritten);const {main}=await import(pathToFileURL(module).href);
  try{await main(['report','--plan',root+'/plan.json','--run','run-1','--observations',root+'/observations.json','--out',output,'--server','http://127.0.0.1:1']);}
  catch(error){assert.match(error.message,/evidence|symlink/i);assert.equal((await lstat(evidence)).isSymbolicLink(),true);assert.equal(await lstat(output+'/index.html').catch(()=>null),null);return;}
  const report=JSON.parse(await readFile(output+'/report.json')),copy=output+'/'+report.cases[0].assertions[0].evidence[0].relativePath;
  assert.equal((await lstat(copy)).isFile(),true,'A completed report must contain file bytes, not a source link');
  await writeFile(root+'/retained.txt','later source edit');assert.equal(await readFile(copy,'utf8'),'retained bytes');
 }finally{await rm(root,{recursive:true,force:true});}
});
