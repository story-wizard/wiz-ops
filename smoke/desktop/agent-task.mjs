import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {checkAgentRecipe} from './agent-recipes.mjs';
import {requireProof,fields} from './agent-proof.mjs';

export const taskRecipes=['project-identity','add-video-track','media-search','inspector-edit','timeline-undo','spell-input-edit'];
export async function taskCatalog(){
 return Promise.all(taskRecipes.map(async id=>{const recipe=await readJSON(new URL('../examples/recipes/'+id+'.json',import.meta.url));return {id,parameters:recipe.parameters,source:'examples/recipes/'+id+'.json'};}));
}
export function briefContext(context){
 return {format:'athanor-agent-brief/v1',session:context.session,build:context.build,process:context.process,lifetime:context.lifetime,project:context.project,
  fullContext:path.join(path.dirname(context.session),'agent-context.json'),recipes:taskRecipes,
  start:['node','desktop/session.mjs','tool',context.session,'task','{}'],
  tools:['node','desktop/session.mjs','tool',context.session,'OP','JSON','--compact'],
  checks:context.checks.filter(c=>c.id=== 'D-CLI-01'||c.proof).map(c=>({id:c.id,title:c.title})),
  guidance:['Choose an existing recipe with task before authoring steps. task compiles and retains a plan; it dispatches no app input.',
   'Read a required value or full frozen check from fullContext or its retained receipt; compact output does not remove evidence.',
   'Review the plan, execute once with the returned request ID, inspect outcome and captures, then choose the next phase.',
   'Use current observed targets and physical input for the UI behavior under test. Begin/verify/capture/record are required for a frozen toolkit Pass.',
   'New dialogs, geometry and Unknown stop for review. Never replay a lost or uncertain mutation. Stop the owned session when finished.']};
}
// ponytail: auto-bind Add Track only; other recipes take explicit observed values.
export async function prepareAgentTask(file,{recipe:id,values={}}={},execute){
 const catalog=await taskCatalog();
 if(id===undefined)return {format:'athanor-agent-task/v1',executed:false,recipes:catalog};
 requireProof(taskRecipes.includes(id),'unknown_recipe','Choose an ID from the task catalog',['task']);
 const s=await readJSON(file),recipe=await readJSON(new URL('../examples/recipes/'+id+'.json',import.meta.url));let defaults={};
 if(id==='add-video-track'){
  fields(values,['timelineId'],'auto-bound values');
  const timelineId=values.timelineId??s.main?.id;
  requireProof(typeof timelineId==='string'&&timelineId.length>0,'missing_timeline','Supply values.timelineId from the fixture context',['context']);
  const name=await execute(file,'call',{operation:'project.get_name'}),before=await execute(file,'call',{operation:'timeline.inspect',params:{timeline_id:timelineId}}),ui=await execute(file,'observe',{selectors:[{class:'TimelineWidget'},{class:'MainWindow'},{name:'panelChromeAction',text:'+ Video',enabled:true},{name:'panelSubtabSelector'}]});
  requireProof(before.timeline?.timeline_id===timelineId&&Array.isArray(before.tracks)&&before.next_cursor==null&&!ui.truncated&&!ui.inspectionIncomplete,'incomplete_observation','Use a complete current timeline and UI observation',['observe']);
  requireProof(typeof before.timeline.name==='string'&&ui.matches.some(w=>w.name==='panelSubtabSelector'&&w.text?.replace(/ \(\d+\)$/,'')===before.timeline.name),'wrong_fixture','Open the requested timeline and supply its values.timelineId',['observe']);
  const one=selector=>{const found=ui.matches.filter(selector);requireProof(found.length===1,'ambiguous_target','The recipe needs one visible timeline, main window and Add Video button',['observe']);return {id:found[0].id};};
  defaults={projectName:name.name,timelineId,timelineTarget:one(w=>w.class==='TimelineWidget'),captureTarget:one(w=>w.class==='MainWindow'),baselineTracks:before.tracks,expectedTrackCount:before.tracks.length+1,addSelector:{name:'panelChromeAction',text:'+ Video',enabled:true}};
 }
 const bound={...defaults,...values},compiled=await checkAgentRecipe(file,recipe,bound),directory=await mkdtemp(path.join(s.root,'task-')),planFile=path.join(directory,'plan.json'),valuesFile=path.join(directory,'values.json');
 await writeJSON(planFile,compiled.plan);await writeJSON(valuesFile,bound);
 const requestId=path.basename(directory)+'-'+id;
 return {format:'athanor-agent-task/v1',status:'Valid',executed:false,recipeId:id,recipeHash:compiled.recipeHash,valuesHash:compiled.valuesHash,plan:{path:planFile,sha256:await sha(planFile)},values:{path:valuesFile,sha256:await sha(valuesFile)},requestId,
  phases:compiled.plan.phases.map(p=>({id:p.id,steps:p.steps.map(s=>({operation:s.operation,title:s.params?.title||s.params?.operation||s.params?.command||s.operation,gate:s.expect!==undefined})),reviewAfter:p.next===null})),
  run:['node','desktop/session.mjs','plan',file,planFile,'--request-id',requestId,'--compact'],inspect:['node','desktop/session.mjs','plan-inspect',file,requestId],
  review:'Inspect the compiled plan before dispatch. Review independent domain state and captures before the next phase; recipe completion does not qualify toolkit Pass.'};
}
