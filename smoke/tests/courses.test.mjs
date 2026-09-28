import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {baseCourse,initializeCourses,saveCourse,getCourse,resolveSelection,selectedRecipe,validateRecipe,requirementsFor,checkRegistry} from '../runner/catalog.mjs';
import {digest} from '../runner/files.mjs';
import {resultSummary,waitForRun} from '../scripts/smoke.mjs';
import {executeCourse} from '../runner/run.mjs';

const accepted={reviewedBy:'Synthetic framework test',checks:baseCourse.cases.map(c=>({id:c.id,definitionHash:digest(c)}))};
const draft={id:'color-regression',revision:0,title:'Color regression',project:'fresh',groups:[{id:'color',title:'Color',checks:['A-CO-01','A-CO-02']},{id:'persistence',title:'Save and reopen',checks:['A-LP-02','A-CO-01']}]};
test('custom courses use accepted definitions, preserve revisions and resolve shared checks once',()=>{
 const db=new DatabaseSync(':memory:');initializeCourses(db);
 try{
  assert.throws(()=>saveCourse(db,draft,{checks:[]}),/not accepted/);
  assert.throws(()=>saveCourse(db,{...draft,accepted:true},accepted),/acceptance cannot/);
  const first=saveCourse(db,draft,accepted);assert.equal(first.revision,1);
  assert.throws(()=>saveCourse(db,draft,accepted),/changed/);
  const selection=resolveSelection(db,{courseIds:[first.id]},accepted),recipe=selectedRecipe(selection);
  assert.deepEqual(selection.effectiveIds,['A-CLI-01','A-CO-01','A-CO-02','A-LP-02']);
  assert.equal(selection.groups.filter(g=>g.checks.includes('A-CO-01')).length,2);
  assert.equal(selection.addedPrerequisites.length,1);assert.equal(selection.requirements.speechModel,false);assert.equal(selection.requirements.mediaPack,'core');
  const frozen=JSON.stringify(recipe);
  saveCourse(db,{...draft,revision:1,groups:[{id:'smaller',title:'Smaller',checks:['A-CO-02']}]},accepted);
  assert.equal(getCourse(db,first.id).revision,2);assert.deepEqual(getCourse(db,first.id,1),first);assert.equal(JSON.stringify(recipe),frozen);
  validateRecipe(recipe,accepted);
  assert.throws(()=>validateRecipe({...recipe,cases:recipe.cases.slice(1)},accepted),/recipe/);
  assert.throws(()=>validateRecipe(recipe,{checks:[]}),/acceptance/);
  assert.throws(()=>resolveSelection(db,{project:'large',checkIds:['A-CO-01']},accepted),/unavailable/);
  assert.throws(()=>resolveSelection(db,{checkIds:['made-up']},accepted),/Unknown/);
  assert.throws(()=>resolveSelection(db,{},accepted),/nonempty/);
  assert.throws(()=>resolveSelection(db,{categories:['made-up']},accepted),/Unknown/);
  const color=resolveSelection(db,{categories:['color']},accepted);assert.ok(color.requestedIds.includes('A-CO-07'));assert.ok(color.requestedIds.every(id=>checkRegistry(accepted).find(c=>c.id===id).categories.includes('Colour')));
  const full=resolveSelection(db,{courseIds:['packaged-full']},accepted);assert.equal(full.effectiveIds.length,57);assert.equal(full.notSelected.length,0);assert.equal(full.requirements.speechModel,true);
  assert.equal(requirementsFor(['IN-01']).mediaPack,'speech');assert.equal(requirementsFor(['IN-01']).speechModel,false);
 }finally{db.close();}
});
test('selected execution invokes only selected cases and preserves non-passing outcomes',async()=>{
 const db=new DatabaseSync(':memory:');initializeCourses(db);const root=await mkdtemp(path.join(tmpdir(),'smoke-subset-'));
 try{
  const selection=resolveSelection(db,{checkIds:['A-CO-01']},accepted),course=selectedRecipe(selection),events=[];
  const engine={root,child:{exitCode:null,signalCode:null},revisions:new Map(),async call(){return {name:'Wrong successful name'};}};
  const result=await executeCourse({course,engine,fixtures:{files:[]},onResult:async(c,status)=>events.push([c.id,status])});
  assert.deepEqual(result.map(r=>[r.id,r.status]),[['A-CLI-01','Fail'],['A-CO-01','Blocked']]);
  assert.ok(events.every(([id])=>selection.effectiveIds.includes(id)));
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
test('agent waits report terminal results, and a wait timeout never cancels work',async()=>{
 const run=state=>({id:'run',build:'test',execution:{state,recipe:{}},results:[{test_id:'A',snapshot:{title:'A'},status:state==='Passed'?'Pass':state==='Failed'?'Fail':'Running'}]});
 assert.equal(resultSummary(run('Running')).exitCode,4);assert.equal(resultSummary(run('Passed')).exitCode,0);assert.equal(resultSummary(run('Failed')).exitCode,1);
 assert.equal(resultSummary(run('Unknown')).exitCode,2);
 assert.equal(resultSummary({...run('Passed'),results:[]}).exitCode,2);
 let calls=0;const done=await waitForRun(async route=>{assert.equal(route,'/api/runs/run');return run(++calls===1?'Running':'Passed');},'run',{timeout:1,pollMs:1});
 assert.equal(done.complete,true);assert.equal(done.exitCode,0);
 const pending=await waitForRun(async route=>{assert.equal(route,'/api/runs/run');return run('Running');},'run',{timeout:0});
 assert.equal(pending.waitTimedOut,true);assert.equal(pending.exitCode,4);
});

test('mixed courses preserve targets and expose prerequisite closure without accepting unrelated checks',async()=>{
 const {acceptance}=await import('../runner/catalog.mjs');
 const db=new DatabaseSync(':memory:');initializeCourses(db);
 try{
  const selected=resolveSelection(db,{checkIds:['A-CO-01','D-LP-02-RELAUNCH','S-EXPORT-PRORES']},acceptance());
  assert.deepEqual(new Set(selected.effectiveIds),new Set(['A-CLI-01','A-CO-01','D-CLI-01','D-CLI-02','D-LP-02-SAVE','D-LP-02-RELAUNCH','S-EXPORT-PRORES']));
  assert.equal(selected.requirements.foreground,true);assert.equal(selected.requirements.speechModel,false);
  validateRecipe(selectedRecipe(selected));
  assert.throws(()=>resolveSelection(db,{checkIds:['D-TRACK-ADD']},acceptance()),/not accepted/);
  const old=selectedRecipe(selected);assert.equal(old.cases.filter(c=>c.target==='desktop').length,4);
 }finally{db.close();}
});
test('unselected desktop checks never execute their callback or publish a result',async()=>{
 const {checks}=await import('../desktop/check-support.mjs');const {writeFile,readFile}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(tmpdir(),'smoke-selected-desktop-')),file=path.join(root,'session.json');
 try{
  await writeFile(file,JSON.stringify({root,selectedChecks:['selected']}));let called=0;
  const {check,report}=await checks(file,'observations.json');
  await check('not-selected',async()=>{called++;});await check('selected',async()=>{called++;return {actual:'expected'};});
  assert.equal(called,1);assert.deepEqual(report.results.map(r=>r.id),['selected']);
  assert.equal(JSON.parse(await readFile(file,'utf8')).currentCheck,'selected');
  assert.equal((await readFile(path.join(root,'check-events.jsonl'),'utf8')).includes('not-selected'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('every accepted definition resolves and every desktop/service check has an execution binding',async()=>{
 const {acceptance,rawChecks}=await import('../runner/catalog.mjs');const {readFile}=await import('node:fs/promises');
 const map=JSON.parse(await readFile(new URL('../desktop/check-map.json',import.meta.url),'utf8'));
 const bound=new Set([...Object.values(map).flat(),'D-LP-02-RELAUNCH','D-SAVE-DISCARD']);
 const db=new DatabaseSync(':memory:');initializeCourses(db);
 try{
  const accepted=acceptance();assert.equal(accepted.checks.length,137);
  for(const c of accepted.checks){const s=resolveSelection(db,{checkIds:[c.id]},accepted);validateRecipe(selectedRecipe(s),accepted);if(c.target!=='packaged')assert.ok(bound.has(c.id),'Unbound check '+c.id);}
  const all=resolveSelection(db,{checkIds:accepted.checks.map(c=>c.id)},accepted);assert.equal(all.effectiveIds.length,137);assert.equal(all.notSelected.length,6);
  assert.equal(rawChecks.length,143);
 }finally{db.close();}
});
