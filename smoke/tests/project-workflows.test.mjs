import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {verifyNewProject,verifyProjectCopy,verifyProjectlessPreferences,verifyProjectHub} from '../desktop/project-proof.mjs';
import {checkRegistry,fullSmokeCourse,resolveSelection,initializeCourses,selectedRecipe,validateRecipe} from '../runner/catalog.mjs';
import {desktopGroups} from '../desktop/run.mjs';
import {agentContext,evidenceItems,testSpecification,evidenceCoverage} from '../test-details.mjs';

const snapshot=(id='new')=>({timeline:{timeline_id:id,name:'Main',duration_seconds:0},tracks:[{track_id:'v1',items:[]}],links:[]});
test('empty restored panels do not hide the hub, while an open project or retained clips rejects it',()=>{
 const ui=()=>({widgets:[{id:'main',class:'MainWindow',title:'Wizard'},{id:'open',name:'startupOpenButton',enabled:true},{class:'TimelineWidget',clipIds:[],clipIdsTruncated:false}]});
 assert.equal(verifyProjectHub(ui()).window,'main');
 for(const change of [u=>u.widgets[0].title='Golden.wiz — Wizard',u=>u.widgets[1].enabled=false,u=>u.widgets[2].clipIds.push('old'),u=>u.widgets[2].clipIdsTruncated=true,u=>u.widgets.push({...u.widgets[0]})]){const bad=ui();change(bad);assert.throws(()=>verifyProjectHub(bad));}
});
test('project comparison reads respect the single owned endpoint channel',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-project-channel-'));
 try{
  const source=readFileSync(new URL('../desktop/check-projects.mjs',import.meta.url),'utf8'),start=source.indexOf('const timelines='),end=source.indexOf('const baseline=',start);assert.ok(start>=0&&end>start);
  const module=path.join(root,'readback.mjs');await writeFile(module,`const original={main:{id:'a'},alternate:{id:'b'}};let active=false;
async function c(operation,{timeline_id}){if(active)throw Error('call.lock already held');active=true;await new Promise(r=>setTimeout(r,5));active=false;return {id:timeline_id};}
${source.slice(start,end)}
export {timelines};`);
  const {timelines}=await import(pathToFileURL(module));assert.deepEqual(await timelines(),{a:{id:'a'},b:{id:'b'}});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('New Project rejects a wrong name, inherited timeline, populated or incomplete content',()=>{
 const good=snapshot();assert.equal(verifyNewProject({name:'New'},'New',good,['old']).empty,true);
 assert.throws(()=>verifyNewProject({name:'Other'},'New',good,['old']));
 assert.throws(()=>verifyNewProject({name:'New'},'New',snapshot('old'),['old']));
 for(const change of [s=>s.tracks[0].items.push({clip_id:'old'}),s=>s.timeline.duration_seconds=4,s=>s.next_cursor='more']){const bad=snapshot();change(bad);assert.throws(()=>verifyNewProject({name:'New'},'New',bad,['old']));}
});
test('Save As rejects changed identities, missing content and edits leaking into original',()=>{
 const before={a:snapshot('a'),b:snapshot('b')};verifyProjectCopy(before,structuredClone(before));
 for(const change of [s=>delete s.b,s=>s.c=snapshot('c'),s=>s.a.timeline.name='Changed',s=>s.b.tracks[0].items.push({clip_id:'extra'}),s=>s.a.next_cursor='more']){const bad=structuredClone(before);change(bad);assert.throws(()=>verifyProjectCopy(before,bad));}
});
test('projectless Preferences rejects missing application pages and exposed project settings',()=>{
 const ui=()=>({widgets:[{id:'nav',window:'dlg',name:'settingsNavigation',rows:3,model:[['System'],['Interface'],['Audio']]},{window:'dlg',text:'Application'}]});
 assert.deepEqual(verifyProjectlessPreferences(ui(),'dlg').pages,['System','Interface','Audio']);
 for(const change of [u=>u.widgets[0].rows=65,u=>u.widgets[0].model.pop(),u=>u.widgets.push({window:'dlg',text:'Current Project'}),u=>u.widgets.push({window:'dlg',name:'projectPathEdit'}),u=>u.widgets[0].model.push(['General'])]){const bad=ui();change(bad);assert.throws(()=>verifyProjectlessPreferences(bad,'dlg'));}
});
test('each project candidate composes alone with connection prerequisites and a fresh group',()=>{
 const ids=['D-PROJECT-NEW','D-PROJECT-SAVE-AS','D-PREFERENCES-PROJECTLESS'],db=new DatabaseSync(':memory:'),map=JSON.parse(readFileSync(new URL('../desktop/check-map.json',import.meta.url)));initializeCourses(db);
 try{for(const id of ids){const definition=checkRegistry().find(c=>c.id===id);assert.equal(definition.accepted,false);assert.ok(fullSmokeCourse().qualificationChecks.includes(id));
  const context=agentContext(definition),selection=resolveSelection(db,context.selection);assert.deepEqual(new Set(selection.effectiveIds),new Set(['A-CLI-01','D-CLI-01',id]));validateRecipe(selectedRecipe(selection));
  assert.deepEqual(desktopGroups([id],map).map(g=>g.ids),[[id]]);assert.throws(()=>resolveSelection(db,{checkIds:[id]}),/not accepted/);
 }}finally{db.close();}
});
test('starting project observations cannot satisfy required post-action evidence',()=>{
 const check=checkRegistry().find(c=>c.id==='D-PROJECT-NEW'),spec=testSpecification(check);
 const baseline=evidenceItems(['/owned/D-PROJECT-NEW-graph-observations-before.txt'],spec);
 assert.equal(baseline[0].when,'before');assert.equal(evidenceCoverage(spec,baseline,[],'Fail').find(e=>e.id==='graph-state').status,'Missing');
 const after=evidenceItems(['/owned/D-PROJECT-NEW-graph-observations-reopened.txt'],spec);assert.equal(evidenceCoverage(spec,after,[],'Pass').find(e=>e.id==='graph-state').status,'Collected');
});
