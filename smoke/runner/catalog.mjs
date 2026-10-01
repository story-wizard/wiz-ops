import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT,digest} from './files.mjs';

export const baseCourse=JSON.parse(readFileSync(path.join(ROOT,'runner/course.json'),'utf8'));
export const desktopCourse=JSON.parse(readFileSync(path.join(ROOT,'desktop/course.json'),'utf8'));
export const serviceCourse=JSON.parse(readFileSync(path.join(ROOT,'desktop/service-course.json'),'utf8'));
export const humanCheckpoint=JSON.parse(readFileSync(path.join(ROOT,'runner/checkpoint.json'),'utf8'));
function checkpointID(id){if(id!==undefined&&id!==humanCheckpoint.id)throw Error('Unknown human checkpoint');return id;}
export const rawChecks=[...baseCourse.cases,...desktopCourse.cases,...serviceCourse.cases];
export const targetFor=id=>baseCourse.cases.some(c=>c.id===id)?'packaged':desktopCourse.cases.some(c=>c.id===id)?'desktop':'service';
// These checks share authored setup and persistence state. Expose the closure before launch.
const families=[
 ['D-CLI-02','D-LP-02-SAVE','D-LP-02-RELAUNCH'],
 ['D-COMPOUND-CREATE','D-COMPOUND-EDIT','D-MGFX-CLIPBOARD','D-EXPORT-COMPOUND','D-COMPOUND-DISSOLVE','D-EXPORT-STILL'],
 ['D-SB-CREATE','D-SB-QUICK-SEARCH','D-SB-GRAPH','D-SB-PARAMS','D-SB-BYPASS','D-SB-UNDO','D-SB-INSTANCE','D-SB-PERSIST','D-SB-LOGGING'],
 ['D-LINKED-SELECTION','D-TRACK-LOCK-UI','D-TRACK-TARGETING','D-RIPPLE-GAP','D-BIN-RENAME','D-BIN-DUPLICATE','D-BIN-DELETE','D-BIN-MGFX'],
 ['S-MGFX-DUPLICATE','S-MGFX-CLIP-COPY','S-MGFX-PERSIST']
];
const speechChecks=new Set(['IN-06','SS-01','SS-05']);
const sourceAreas=new Map(JSON.parse(readFileSync(path.join(ROOT,'catalog/checkpoints/logan-2026-09-25-2.json'),'utf8')).rows.map(r=>[r.id,r.area]));
export function acceptance(){
 try{return JSON.parse(readFileSync(path.join(ROOT,'scope/accepted-checks.json'),'utf8'));}
 catch(e){if(e.code==='ENOENT')return {checks:[],status:'Not reviewed'};throw e;}
}
export function checkRegistry(review=acceptance()){
 return rawChecks.map(c=>({...c,definitionHash:digest(c),categories:[...new Set([c.stage,sourceAreas.get(c.sourceId)])].filter(Boolean),target:targetFor(c.id),projectVariants:['fresh'],accepted:review.checks?.some(a=>a.id===c.id&&a.definitionHash===digest(c))===true}));
}
export function requirementsFor(ids,checkpoint){
 const speechModel=ids.some(id=>speechChecks.has(id)),targets=[...new Set(ids.map(targetFor))];if(checkpoint&&!targets.includes('desktop'))targets.push('desktop');
 return {mediaPack:speechModel||ids.includes('IN-01')?'speech':'core',speechModel,project:'fresh',execution:'serial',executionOrder:['packaged','service','desktop'].filter(t=>targets.includes(t)),orderingNote:'Packaged checks retain requested order. Service and desktop checks use their authored setup/reopen sequence; groups organize reporting.',targets,foreground:targets.includes('desktop')};
}
export function initializeCourses(db){
 db.exec('CREATE TABLE IF NOT EXISTS user_courses(id TEXT NOT NULL,revision INTEGER NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(id,revision)); CREATE TABLE IF NOT EXISTS execution_requests(request_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),plan_hash TEXT NOT NULL,operator TEXT NOT NULL);');
}
export const builtinCourse=()=>({id:'packaged-full',revision:baseCourse.revision,title:'Packaged engine — full course',project:'fresh',kind:'maintained',groups:[{id:'packaged',title:'Packaged engine',checks:baseCourse.cases.map(c=>c.id)}]});
export const allAutomatedCourse=()=>({id:'automated-full',revision:1,title:'All automated checks',project:'fresh',kind:'maintained',groups:['packaged','service','desktop'].map(target=>({id:target,title:({packaged:'Build engine',service:'Background services',desktop:'Desktop editor'})[target],checks:checkRegistry().filter(c=>c.accepted&&c.target===target).map(c=>c.id)})).filter(g=>g.checks.length)});
export function courseList(db){return [allAutomatedCourse(),builtinCourse(),...db.prepare('SELECT definition FROM user_courses c WHERE revision=(SELECT MAX(revision) FROM user_courses WHERE id=c.id) ORDER BY id').all().map(r=>JSON.parse(r.definition))];}
export function getCourse(db,id,revision){
 if(['packaged-full','automated-full'].includes(id)){const c=id==='packaged-full'?builtinCourse():allAutomatedCourse();if(revision!==undefined&&revision!==c.revision)throw Error('Maintained course revision is unavailable.');return c;}
 const r=revision===undefined?db.prepare('SELECT definition FROM user_courses WHERE id=? ORDER BY revision DESC LIMIT 1').get(id):db.prepare('SELECT definition FROM user_courses WHERE id=? AND revision=?').get(id,revision);
 if(!r)throw Error('Course not found: '+id);return JSON.parse(r.definition);
}
function text(value,label,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid '+label);return value.trim();}
function groups(input,registry,maxID=80){
 if(!Array.isArray(input)||!input.length||input.length>100)throw Error('Use 1–100 nonempty groups.');
 const seen=new Set();
 return input.map(g=>{
  if(!g||typeof g!=='object'||Object.keys(g).some(k=>!['id','title','checks'].includes(k)))throw Error('Groups contain id, title and check references only.');
  const id=text(g.id,'group ID',maxID);if(seen.has(id))throw Error('Duplicate group ID: '+id);seen.add(id);
  if(!Array.isArray(g.checks)||!g.checks.length||g.checks.length>500)throw Error('A group must name its checks.');
  for(const id of g.checks){const c=registry.find(c=>c.id===id);if(!c)throw Error('Unknown check: '+id);if(!c.accepted)throw Error('Check is not accepted for custom courses: '+id);}
  return {id,title:text(g.title,'group title'),checks:[...new Set(g.checks)]};
 });
}
export function saveCourse(db,input,review=acceptance()){
 if(!input||Object.keys(input).some(k=>!['id','revision','title','project','groups','checkpoint'].includes(k)))throw Error('Courses contain references and groups only; test definitions and acceptance cannot be changed here.');
 const id=text(input.id,'course ID',80);if(!/^[a-z][a-z0-9-]*$/.test(id)||['packaged-full','automated-full','smoke-full'].includes(id))throw Error('Invalid or reserved course ID.');
 if(input.project!=='fresh')throw Error('Project variant unavailable: '+input.project);
 if(!Number.isInteger(input.revision)||input.revision<0)throw Error('Supply revision 0 to create, or the current revision to edit.');
 const definition={id,revision:input.revision+1,title:text(input.title,'course title'),project:'fresh',kind:'user',groups:groups(input.groups,checkRegistry(review)),...(checkpointID(input.checkpoint)?{checkpoint:input.checkpoint}:{})};
 db.exec('BEGIN IMMEDIATE');try{
  const latest=db.prepare('SELECT MAX(revision) AS revision FROM user_courses WHERE id=?').get(id).revision||0;
  if(latest!==input.revision)throw Error('Course changed; load its current revision before saving.');
  db.prepare('INSERT INTO user_courses VALUES (?,?,?)').run(id,definition.revision,JSON.stringify(definition));db.exec('COMMIT');return definition;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function resolveSelection(db,input,review=acceptance()){
 if(!input||Object.keys(input).some(k=>!['courseIds','checkIds','categories','groups','project','title','target','checkpoint'].includes(k)))throw Error('Unknown selection field.');
 if(input.target!==undefined&&!['packaged','desktop','service','all'].includes(input.target))throw Error('Unknown target');
 const project=input.project===undefined?'fresh':input.project;if(project!=='fresh')throw Error('Project variant unavailable: '+project);
 const registry=checkRegistry(review),selectedGroups=[],origins=[];let checkpoint=checkpointID(input.checkpoint);
 for(const field of ['courseIds','checkIds','categories'])if(input[field]!==undefined&&(!Array.isArray(input[field])||input[field].length>500||input[field].some(v=>typeof v!=='string')))throw Error('Invalid '+field);
 for(const id of input.courseIds||[]){
  const c=getCourse(db,id);if(c.project!==project)throw Error('Course project variant differs from the requested variant.');origins.push({id:c.id,revision:c.revision});if(c.checkpoint){checkpointID(c.checkpoint);checkpoint=c.checkpoint;}
  selectedGroups.push(...c.groups.map(g=>({...g,id:c.id+'/'+g.id})));
 }
 if(input.checkIds?.length)selectedGroups.push({id:'selected',title:'Selected checks',checks:input.checkIds});
 for(const category of input.categories||[]){
  const normalized=category.toLowerCase()==='color'?'colour':category.toLowerCase();
  const matches=registry.filter(c=>(input.target==='all'||c.target===(input.target||'packaged'))&&c.categories.some(s=>s.toLowerCase()===normalized));
  if(!matches.length)throw Error('Unknown or empty category: '+category);
  selectedGroups.push({id:'category/'+normalized,title:matches[0].categories.find(s=>s.toLowerCase()===normalized),checks:matches.map(c=>c.id)});
 }
 if(input.groups)selectedGroups.push(...input.groups);
 const resolvedGroups=groups(selectedGroups,registry,200),requestedIds=[...new Set(resolvedGroups.flatMap(g=>g.checks))];
 const chosen=new Set(requestedIds),reasons=new Map();
 const add=(id,reason)=>{if(!chosen.has(id)){chosen.add(id);reasons.set(id,reason);}};
 add('A-CLI-01','Verify the owned packaged endpoint and project binding before selected checks.');
 if(requestedIds.some(id=>targetFor(id)==='desktop'))add('D-CLI-01','Verify the owned desktop endpoint and visible project before desktop checks.');
 for(const family of families)if(family.some(id=>chosen.has(id)))for(const id of family)add(id,'Shared fixture and persistence sequence: '+family.join(', '));
 for(const id of chosen)if(!registry.some(c=>c.id===id&&c.accepted))throw Error('Required check acceptance is missing: '+id);
 const effectiveIds=['A-CLI-01',...requestedIds.filter(id=>targetFor(id)==='packaged'&&id!=='A-CLI-01'),...['service','desktop'].flatMap(target=>rawChecks.filter(c=>chosen.has(c.id)&&targetFor(c.id)===target).map(c=>c.id))];
 const addedPrerequisites=effectiveIds.filter(id=>!requestedIds.includes(id)).map(id=>({id,reason:reasons.get(id)}));
 const targets=[...new Set(effectiveIds.map(targetFor))];
 return {format:'wizard-smoke-selection/v2',title:input.title?text(input.title,'selection title'):origins.length===1&&!input.checkIds?.length&&!input.categories?.length&&!input.groups?getCourse(db,origins[0].id).title:'Custom checks',project,courseRevisions:origins,groups:resolvedGroups,requestedIds,effectiveIds,addedPrerequisites,notSelected:registry.filter(c=>targets.includes(c.target)&&!effectiveIds.includes(c.id)).map(c=>c.id),requirements:requirementsFor(effectiveIds,checkpoint),...(checkpoint?{checkpoint:structuredClone(humanCheckpoint)}:{}),registryHash:digest(rawChecks),acceptanceBasis:{reviewedBy:review.reviewedBy||null,reviewedAt:review.reviewedAt||null},fullSmokeAcceptance:'Not assessed'};
}
export function selectedRecipe(selection){
 if(selection.checkpoint&&digest(selection.checkpoint)!==digest(humanCheckpoint))throw Error('Human checkpoint definition changed; prepare again.');
 if(selection.registryHash!==digest(rawChecks))throw Error('Check definitions changed; resolve the selection again.');
 return {...baseCourse,id:'selected-checks',revision:1,sourceCourses:[baseCourse,serviceCourse,desktopCourse].filter(c=>c.cases.some(x=>selection.effectiveIds.includes(x.id))).map(c=>({id:c.id,revision:c.revision,target:c.target})),title:selection.title,target:selection.requirements.executionOrder.map(t=>({packaged:'Packaged engine',service:'Background services',desktop:'Desktop editor'}[t])).join(' + '),scope:'Selected automated checks: '+selection.effectiveIds.join(', ')+'. Results apply only to these checks on '+selection.project+'; other full-course behavior is not exercised.',selection,...(selection.checkpoint?{checkpoint:selection.checkpoint}:{}),cases:selection.effectiveIds.map(id=>{
  const c=rawChecks.find(c=>c.id===id);if(!c)throw Error('Unknown selected check: '+id);return targetFor(id)==='packaged'?c:{...c,scope:(targetFor(id)==='desktop'?desktopCourse:serviceCourse).target,operations:[],target:targetFor(id)};
 })};
}
export function validateRecipe(recipe,review=acceptance()){
 if(!recipe.selection)return;
 const s=recipe.selection,ids=recipe.cases.map(c=>c.id);
 if(s.project!=='fresh'||!ids.length||ids[0]!=='A-CLI-01'||new Set(ids).size!==ids.length||digest(ids)!==digest(s.effectiveIds)||digest(recipe)!==digest(selectedRecipe(s))||digest(s.requirements)!==digest(requirementsFor(ids,s.checkpoint)))throw Error('Selected recipe or prerequisites changed.');
 const registry=checkRegistry(review);for(const id of ids)if(!registry.some(c=>c.id===id&&c.accepted))throw Error('Selected check acceptance is missing or stale: '+id);
}
