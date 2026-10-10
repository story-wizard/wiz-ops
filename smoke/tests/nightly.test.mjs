import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createNightlyPlan,consolidateNightly,nightlyHTML,nightlyCases} from '../runner/nightly.mjs';
import {digest,sha} from '../runner/files.mjs';
const suite={cases:[{id:'CORE-01',area:'Startup',steps:['Open the selected build'],expected:['Correct build','Responsive window']}]};
const catalog=[{id:'A-CLI-01',definitionHash:'d'.repeat(64),accepted:true}];
const identity={build:'test-build',packageHash:'a'.repeat(64),runnerHash:'b'.repeat(64)};
function run(){return {id:'run-1',execution:{state:'Passed',package:{version:identity.build,...identity}},results:[{test_id:'A-CLI-01',snapshot:{title:'Engine connection'},status:'Pass',note:'Connected',evidence:'operations.jsonl'}]};}

test('the maintained suite keeps every case and candidate overlap does not become assertion coverage',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-nightly-');
 try{
  const actual=JSON.parse(await readFile(new URL('../examples/nightly/suite.json',import.meta.url)));
  assert.equal(nightlyCases(actual).length,actual.cases.length);
  const mappings={'CORE-01':{specHash:digest(nightlyCases(suite)[0]),checkIds:['A-CLI-01','ABSENT']}};
  const plan=createNightlyPlan(suite,catalog,{...identity,dataDir:root},mappings),report=await consolidateNightly(plan,run());
  assert.equal(plan.cases[0].candidates[0].accepted,true);assert.equal(plan.cases[0].candidates[1].available,false);
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
