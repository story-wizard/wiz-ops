import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {ROOT,readJSON,writeJSON,sha} from '../runner/files.mjs';
import {checkAgentRecipe} from './agent-recipes.mjs';
import {requireProof,fields,toolInterface} from './agent-proof.mjs';
import {mediaInsertionOutcome} from './ui-query.mjs';

export const taskRecipes=['project-identity','add-video-track','media-search','media-search-state','media-insert-undo','inspector-edit','inspector-edit-undo','timeline-undo','timeline-undo-save','enable-checkbox','spell-input-edit'];
const mediaInputs={timelineId:{type:'string'},query:{type:'string'},expectedName:{type:'string'},expectedStatus:{type:'string'},assetId:{type:'string'},durationSeconds:{type:'number'}};
export async function taskCatalog(){
 return Promise.all(taskRecipes.map(async id=>{const recipe=await readJSON(new URL('../examples/recipes/'+id+'.json',import.meta.url));return {id,parameters:id==='inspector-edit-undo'?{graphScope:{type:'object'},nodeId:{type:'string'},parameter:{type:'string'},label:{type:'string'}}:id==='media-insert-undo'?mediaInputs:id==='add-video-track'?{timelineId:{type:'string',required:false}}:recipe.parameters,autoBound:['add-video-track','media-insert-undo','inspector-edit-undo'].includes(id),...(id==='add-video-track'?{defaultTimeline:'Fixture main; supply timelineId for another displayed timeline'}:{}),source:'examples/recipes/'+id+'.json'};}));
}
export function briefContext(context){
 const command=[...(context.workspace?['env','SMOKE_DATA_DIR='+context.workspace]:[]),'node',path.join(ROOT,'desktop/session.mjs')];
 return {format:'athanor-agent-brief/v1',session:context.session,workspace:context.workspace,build:context.build,process:context.process,lifetime:context.lifetime,project:context.project,
  fullContext:path.join(path.dirname(context.session),'agent-context.json'),recipes:taskRecipes,
  start:[...command,'tool',context.session,'task','{}'],
  tools:[...command,'tool',context.session,'OP','JSON','--compact'],
  connection:{command:[...command,'tools',context.session],protocol:'JSON lines; one reply per request',tool:{id:'unique-tool-id',operation:'observe',params:{selector:{class:'MainWindow'}},compact:true},plan:{id:'known-plan-id',operation:'plan-run',params:{plan:{path:'REVIEWED_PLAN_PATH',sha256:'REVIEWED_SHA256'}},compact:true},inspect:{id:'new-inspection-id',operation:'plan-inspect',params:{requestId:'known-plan-id'}},maxRequestBytes:65536},
  shapes:{task:toolInterface('task').example.params,schema:{tool:'physical'},query:{question:'media-search'},observe:{selectors:[{class:'QTreeView'}],within:{class:'MediaPanel'},limit:8},model:{target:'OBSERVED_VIEW_ID',offset:0,limit:16},call:{operation:'timeline.inspect',params:{timeline_id:'OBSERVED_TIMELINE_ID'}},physical:{command:'click',target:{id:'OBSERVED_WIDGET_ID'}},focusedKey:{command:'key',target:{id:'OBSERVED_FOCUSED_CONTROL_ID'},key:'cmd+z',requireFocus:true},wait:{selector:{id:'OBSERVED_CHECKBOX_ID'},condition:'checked',expected:true}},
  checks:context.checks.filter(c=>c.id=== 'D-CLI-01'||c.proof).map(c=>({id:c.id,title:c.title})),
  guidance:['Functional scripts: '+path.join(ROOT,'docs/functional-testing-agent.md')+'. Declare fixtures/assertions; preserve script dependencies and required gestures.',
   'Choose an existing recipe with task before authoring steps. task compiles and retains a plan; it dispatches no app input.',
   'Media drop/Undo: docs/media-procedure.md. Inspector/timeline: docs/agent-workflows.md.',
   'Choose the route from the test: CLI for exact application state/setup, Qt for controls and models, screenshots for visual questions, physical input for tested gestures. Preserve a frozen check’s required route.',
   'Run preflight in the input context. Repair denied process inspection there; never change OS permissions. Preparation grants no input authority.',
   'Bundle selectors with observe; details:true includes model geometry. Input is widget-local; itemRects are viewport-local.',
   'schema {} includes a read-only plan scaffold; schema {tool:NAME} shows step/gate shapes. Gates use array paths. Use operation for app schemas.',
   'Keep canvas focus. Save adds history even when empty: query timeline-history before Undo; verify each history step and domain outcome.',
   'Batch known steps; stop at new geometry, dialogs or decisions. The persistent connection accepts task.runRequest after review. Never replay lost input.',
   'Read compact outcomes and completeness first; omitted values stay in the receipt. gateMatched proves only the declared comparison.',
   'Review summary.review outcomes and images together when available. Reuse each checkpoint artifact; old images never replace fresh input guards.',
   'Read a required value or full frozen check from fullContext or its retained receipt; compact output does not remove evidence.',
   'Review task.reviewPlan or plan-check.review. Read hashed baselines in the full plan if unfamiliar. Execute once with its request ID, then review outcomes and captures.',
   'Scope is an observed ID string. Model itemRects belong to the returned viewport, not the enclosing view. Reveal clipped controls and refresh geometry before binding.',
   'Capture separate dialogs by their own window target. Verify checked/enabled after checkbox clicks before dependent input. Review one capture per required result; retain extra evidence without duplicate review.',
   'Recipes are exploratory. Frozen checks require every declared action, assertion and capture; use a course for canonical testing.',
   'Unexpected dialogs, unavailable geometry and Unknown stop for review. Only an authored exact dialog branch may continue. Never replay a lost or uncertain mutation. Stop the owned session when finished.']};
}
// ponytail: auto-bind authored procedures only; unfamiliar routes stay agent-authored.
export async function prepareAgentTask(file,{recipe:id,values={}}={},execute){
 const started=performance.now();
 const catalog=await taskCatalog();
 if(id===undefined)return {format:'athanor-agent-task/v1',executed:false,recipes:catalog};
 requireProof(taskRecipes.includes(id),'unknown_recipe','Choose an ID from the task catalog',['task']);
 const s=await readJSON(file),recipe=await readJSON(new URL('../examples/recipes/'+id+'.json',import.meta.url));let defaults={};
 requireProof(typeof s.dataDir==='string'&&path.isAbsolute(s.dataDir),'missing_workspace','Use a prepared session with its external workspace',['context']);
 requireProof(!s.agentTracking,'recipe_scope_mismatch','Task recipes are exploratory; use the active frozen check contract or start a separate exploration session',['context']);
 if(id==='add-video-track'){
  fields(values,['timelineId'],'auto-bound values');
  const timelineId=values.timelineId??s.main?.id;
  requireProof(typeof timelineId==='string'&&timelineId.length>0,'missing_timeline','Supply values.timelineId from the fixture context',['context']);
  const name=await execute(file,'call',{operation:'project.get_name'});
  const reads=await Promise.allSettled([execute(file,'call',{operation:'timeline.inspect',params:{timeline_id:timelineId}}),execute(file,'observe',{selectors:[{class:'MainWindow'},{name:'panelChromeAction',text:'+ Video',enabled:true},{name:'panelSubtabSelector'}]})]);
  for(const read of reads)if(read.status==='rejected')throw read.reason;
  const [before,ui]=reads.map(r=>r.value);
  requireProof(before.timeline?.timeline_id===timelineId&&Array.isArray(before.tracks)&&before.next_cursor==null&&!ui.truncated&&!ui.inspectionIncomplete,'incomplete_observation','Use a complete current timeline and UI observation',['observe']);
  requireProof(typeof before.timeline.name==='string'&&ui.matches.some(w=>w.name==='panelSubtabSelector'&&w.text?.replace(/ \(\d+\)$/,'')===before.timeline.name),'wrong_fixture','Open the requested timeline and supply its values.timelineId',['observe']);
  const one=selector=>{const found=ui.matches.filter(selector);requireProof(found.length===1,'ambiguous_target','The recipe needs one main window and Add Video button',['observe']);return {id:found[0].id};};
  one(w=>w.name==='panelChromeAction'&&w.text==='+ Video'&&w.enabled);
  // Save is window-scoped. A later Undo recipe needs its own focused timeline canvas.
  defaults={projectName:name.name,timelineId,timelineTarget:one(w=>w.class==='MainWindow'),captureTarget:one(w=>w.class==='MainWindow'),baselineTracks:before.tracks,expectedTrackCount:before.tracks.length+1,addSelector:{name:'panelChromeAction',text:'+ Video',enabled:true}};
 }else if(id==='inspector-edit-undo'){
  fields(values,['graphScope','nodeId','parameter','label'],'Inspector values');
  const answer=await execute(file,'query',{question:'inspector-parameter',...values});
  const baselineTimeline=await execute(file,'call',{operation:'timeline.inspect',params:{timeline_id:values.graphScope.timeline_id}});
  defaults={timelineId:values.graphScope.timeline_id,clipId:values.graphScope.clip_id,baselineGraph:answer.graph,baselineTimeline,controlTarget:answer.targets.control,timelineTarget:answer.targets.canvas,captureTarget:answer.targets.capture,inspectorTarget:answer.targets.inspector};
 }else if(id==='media-insert-undo'){
  fields(values,Object.keys(mediaInputs),'media procedure values');
  requireProof(Object.entries(mediaInputs).every(([k,d])=>typeof values[k]===d.type)&&['timelineId','query','expectedName','expectedStatus','assetId'].every(k=>values[k].length>0&&values[k].length<=1024)&&Number.isFinite(values.durationSeconds)&&values.durationSeconds>0&&values.durationSeconds<=8640000,'invalid_fixture','Declare bounded timeline/query/name/status/asset values and a positive duration before input',['context']);
  const reads=await Promise.allSettled([execute(file,'preflight',{question:'media-search'}),execute(file,'call',{operation:'timeline.inspect',params:{timeline_id:values.timelineId}})]);
  for(const read of reads)if(read.status==='rejected')throw read.reason;
  const [flight,before]=reads.map(r=>r.value),answer=flight.answer,canvases=answer.timelineCanvases.slice().sort((a,b)=>a.y-b.y);
  requireProof(flight.ready&&flight.keyWindow?.class==='MainWindow'&&!answer.modalWindow&&!answer.popupWindow&&!answer.mouseGrabber,'desktop_not_ready','Use the owned main window without overlays',['preflight']);
  requireProof(answer.searchMode==='Name','wrong_search_mode','Select Name search during fixture setup before preparing this procedure',['observe']);
  requireProof(before.timeline?.timeline_id===values.timelineId&&answer.timelineTabs.filter(t=>t.text?.replace(/ \(\d+\)$/,'')===before.timeline.name&&t.window===flight.keyWindow.id).length===1,'wrong_fixture','Open the declared timeline before preparing the procedure',['observe']);
  // Standard split timeline layout: video canvas above audio. Reject other layouts.
  requireProof(canvases.length===2&&canvases.every(w=>w.window===flight.keyWindow.id&&!w.clipIdsTruncated&&w.clipIds?.length===0)&&canvases[0].x===canvases[1].x&&canvases[0].y+canvases[0].height<=canvases[1].y,'unsupported_layout','Use one empty split timeline with its video canvas above audio',['observe']);
  requireProof(mediaInsertionOutcome(before,before,{...values,state:'restored'}).matched,'wrong_fixture','Use the complete empty V1/A1 fixture',['context']);
  const geometry=await execute(file,'geometry',{target:{id:canvases[0].id},trackIndex:0,timeSeconds:0});
  defaults={searchId:answer.targets.field.id,mediaViewId:answer.targets.view.id,panelId:answer.scope,timelineTarget:{id:geometry.target},captureTarget:{id:flight.keyWindow.id},baseline:before};
 }
 const bound={...defaults,...values},compiled=await checkAgentRecipe(file,recipe,bound),directory=await mkdtemp(path.join(s.root,'task-')),planFile=path.join(directory,'plan.json'),valuesFile=path.join(directory,'values.json');
 await writeJSON(planFile,compiled.plan);await writeJSON(valuesFile,bound);
 const requestId=path.basename(directory)+'-'+id,planReference={path:planFile,sha256:await sha(planFile)};
 return {format:'athanor-agent-task/v1',status:'Valid',executed:false,recipeId:id,recipeHash:compiled.recipeHash,valuesHash:compiled.valuesHash,plan:planReference,values:{path:valuesFile,sha256:await sha(valuesFile)},requestId,timing:{preparationMs:performance.now()-started,scope:'Discovery, independent baseline, geometry, compilation and retention; no app input'},
  runRequest:{id:requestId,operation:'plan-run',params:{plan:planReference},compact:true},
  reviewPlan:compiled.check.review,
  ...id==='inspector-edit-undo'?{fixture:{graphScope:values.graphScope,nodeId:values.nodeId,parameter:values.parameter,baselineValue:defaults.baselineGraph.nodes.find(n=>n.node_id===values.nodeId).params[values.parameter]}}:{},
  phases:compiled.plan.phases.map(p=>({id:p.id,steps:p.steps.map(s=>({operation:s.operation,title:s.params?.title||s.params?.operation||s.params?.command||s.operation,gate:s.expect!==undefined})),reviewAfter:p.next===null})),
  run:['env','SMOKE_DATA_DIR='+s.dataDir,'node',path.join(ROOT,'desktop/session.mjs'),'plan',file,planFile,'--request-id',requestId,'--compact'],inspect:['env','SMOKE_DATA_DIR='+s.dataDir,'node',path.join(ROOT,'desktop/session.mjs'),'plan-inspect',file,requestId],
  review:'Review reviewPlan and unfamiliar hashed baselines before dispatch. Execute once with the returned request ID. Review independent domain results and captures at authored review exits; recipe completion does not qualify toolkit Pass.'};
}
