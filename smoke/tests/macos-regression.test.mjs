import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {macosRegressionCourse,fullSmokeCourse,resolveSelection,selectedRecipe,validateRecipe,initializeCourses,checkRegistry,getCourse} from '../runner/catalog.mjs';
import {desktopGroups} from '../desktop/run.mjs';
import {agentContext} from '../test-details.mjs';
import {validateNativeParams,validateToolParams} from '../desktop/agent-proof.mjs';
import {validatePhysicalInput} from '../desktop/physical-input.mjs';
import {nativeOrderProof,focusedTimelineProof,focusedPreviewProof,tailFollowProof,selectorProof,headerProof,inlineImageProof,scrollAwayProof,gestureAnchorProof,customModelPopupProof,pipelineSelectionProof} from '../desktop/macos-proof.mjs';

test('macOS candidates have explicit isolated selection, valid context and drivers without entering the default course',()=>{
 const db=new DatabaseSync(':memory:');initializeCourses(db);
 try{const course=macosRegressionCourse(),map=JSON.parse(readFileSync(new URL('../desktop/check-map.json',import.meta.url)));assert.equal(course.qualificationChecks.length,12);assert.deepEqual(map['check-macos-regression.mjs'],course.qualificationChecks);for(const mode of ['grouped','isolated']){const groups=desktopGroups(course.qualificationChecks,map,mode);assert.equal(groups.length,12);assert(groups.every(g=>g.ids.length===1&&g.recoverUnstarted===false));}
  validateRecipe(selectedRecipe(resolveSelection(db,{courseIds:['smoke-full',course.id]})));
  assert.equal(getCourse(db,'macos-regression',1).qualificationChecks.length,8);assert.throws(()=>getCourse(db,'macos-regression',3),/revision/);
  const selected=resolveSelection(db,{courseIds:[course.id]});assert.equal(selected.desktopMode,'isolated');assert.equal(selected.effectiveIds.length,14);validateRecipe(selectedRecipe(selected));
  for(const id of course.qualificationChecks){assert(!fullSmokeCourse().qualificationChecks.includes(id));const check=checkRegistry().find(c=>c.id===id);assert.equal(check.accepted,false);assert.throws(()=>resolveSelection(db,{checkIds:[id]}),/not accepted/);const context=agentContext(check);assert.deepEqual(context.selection.courseIds,[course.id]);const subset=resolveSelection(db,context.selection);validateRecipe(selectedRecipe(subset));assert.equal(subset.requestedIds.length,1);}
  assert.throws(()=>validateRecipe(selectedRecipe({...selected,qualificationIds:[]})),/qualification/);
 }finally{db.close();}
});
test('workspace seams accept only typed local fixtures and order preservation is click-only',()=>{
 for(const [op,params] of [['workspace-inspect',{target:'panel'}],['workspace-append',{target:'panel',text:'Local response',eventId:'athanor-fixture-local'}],['workspace-append',{target:'panel',text:'![x](assets/context/images/athanor-square.png)',eventId:'athanor-fixture-image'}],['workspace-header',{target:'panel',phase:'begin'}],['workspace-header',{target:'panel',phase:'hide-cancel'}],['workspace-image-width',{target:'panel',width:120}],['workspace-hover',{target:'panel',name:'AgentWorkspaceModelSelector'}],['add-floating-panel',{target:'main',panel:'Timeline'}]])assert.doesNotThrow(()=>validateNativeParams(op,params));
 for(const [op,params] of [['workspace-append',{target:'panel',text:'https://private.invalid',eventId:'athanor-fixture-local'}],['workspace-append',{target:'panel',text:'![x](file:/private/secret.png)',eventId:'athanor-fixture-local'}],['workspace-append',{target:'panel',text:'![x](assets/context/images/../../secret.png)',eventId:'athanor-fixture-local'}],['workspace-append',{target:'panel',text:'<img src=remote>',eventId:'athanor-fixture-local'}],['workspace-append',{target:'panel',text:'Local',eventId:'real-turn'}],['workspace-header',{target:'panel',phase:'execute'}],['workspace-image-width',{target:'panel',width:NaN}],['workspace-hover',{target:'panel',name:'Anything'}],['workspace-inspect',{target:'panel',script:'eval()'}],['add-floating-panel',{target:'main',panel:'Preferences'}]])assert.throws(()=>validateNativeParams(op,params));
 for(const command of ['key','type','drag']){assert.throws(()=>validatePhysicalInput(command,{target:'w',preserveWindowOrder:true}));assert.throws(()=>validateToolParams('physical',{command,target:'w',preserveWindowOrder:true}));}assert.throws(()=>validatePhysicalInput('click',{target:'w',preserveWindowOrder:'yes'}));
});
test('native order proof rejects owner occlusion, lost siblings, elevated windows and parent attachment',()=>{
 const before={widgets:[{id:'owner',visible:true,nativeWindow:1,nativeOrder:2,keyWindow:false},{id:'first',visible:true,nativeWindow:2,nativeOrder:0,nativeLevel:0,nativeHasParent:false},{id:'second',visible:true,nativeWindow:3,nativeOrder:1,nativeLevel:0,nativeHasParent:false}]},after=structuredClone(before);after.widgets[0].keyWindow=true;
 assert.doesNotThrow(()=>nativeOrderProof(before,after,'owner',['first','second']));
 for(const mutate of [u=>u.widgets[0].keyWindow=false,u=>u.widgets[1].nativeOrder=3,u=>{u.widgets[1].nativeOrder=1;u.widgets[2].nativeOrder=0;},u=>u.widgets[1].nativeLevel=3,u=>u.widgets[1].nativeHasParent=true,u=>u.widgets.pop(),u=>u.widgets[1].nativeOrder=null]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>nativeOrderProof(before,bad,'owner',['first','second']));}
});
test('focused shortcuts reject changes to the original panel or the wrong key window',()=>{
 const before={widgets:[{id:'original',toolMode:0,playClickedCount:4},{id:'focused',window:'floating',toolMode:0,playClickedCount:2},{id:'floating',keyWindow:true}]},after=structuredClone(before);after.widgets[1].toolMode=1;after.widgets[1].playClickedCount=3;after.focus='focused';
 assert.doesNotThrow(()=>focusedTimelineProof(before,after,'original','focused'));assert.doesNotThrow(()=>focusedPreviewProof(before,after,'original','focused'));
 for(const mutate of [u=>u.widgets[0].toolMode=1,u=>u.widgets[1].toolMode=0,u=>u.focus='original',u=>u.widgets[2].keyWindow=false]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>focusedTimelineProof(before,bad,'original','focused'));}
 for(const mutate of [u=>u.widgets[0].playClickedCount++,u=>u.widgets[1].playClickedCount++,u=>u.widgets[1].playClickedCount=null,u=>u.widgets[2].keyWindow=false]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>focusedPreviewProof(before,bad,'original','focused'));}
});
const observation=items=>({complete:true,items});
test('tail proof detects bounce, duplicate append and abandoned follow intent',()=>{
 const list={name:'AgentWorkspaceMessageList',originY:0,contentHeight:1000,bottomMargin:40,height:400,contentY:640,count:18,atYEnd:true,followTail:true},before=observation([list]),after=observation([{...list,contentHeight:1050,contentY:690,count:19}]);assert.doesNotThrow(()=>tailFollowProof(before,[after,after,after]));
 for(const changes of [{contentY:0},{count:20},{followTail:false},{contentY:600}])assert.throws(()=>tailFollowProof(before,[after,observation([{...after.items[0],...changes}]),after]));
});
test('selector proof reads accessibility and hover state instead of inferring them from visible labels',()=>{
 const item={name:'AgentWorkspaceModelSelector',visible:true,enabled:true,hovered:true,accessibleDescription:'Select the model',tooltipVisible:false},read=observation([item]);assert.doesNotThrow(()=>selectorProof(read,item.name));for(const changed of [{accessibleDescription:''},{tooltipVisible:true},{hovered:false}])assert.throws(()=>selectorProof(observation([{...item,...changed}]),item.name));
});
test('narrow header proof rejects overlap, a hidden active control and absent wide events',()=>{
 const narrow=observation([{name:'AgentWorkspaceTitleSlot',width:62},{name:'AgentWorkspaceTitleText',width:40},{name:'AgentWorkspaceEventMenu',visible:false},{name:'AgentWorkspaceModelSelector',x:70,width:60,displayText:'Luna'},{name:'AgentWorkspaceEffortSelector',x:130,width:50,displayText:'Low'},{name:'AgentWorkspaceCancelButton',x:180,localX:180,width:50,parentWidth:280,visible:true}]),wide=observation([{name:'AgentWorkspaceEventMenu',visible:true}]);assert.doesNotThrow(()=>headerProof(narrow,wide));const shifted=structuredClone(narrow);for(const item of shifted.items)if(item.x!==undefined)item.x+=24;assert.doesNotThrow(()=>headerProof(shifted,wide),'Panel translation must not change parent-local bounds');
 for(const [index,change] of [[0,{width:0}],[4,{x:100}],[5,{visible:false}],[5,{localX:260}]]){const bad=structuredClone(narrow);Object.assign(bad.items[index],change);assert.throws(()=>headerProof(bad,wide));}assert.throws(()=>headerProof(narrow,narrow));
});
test('inline image proof rejects cumulative shrink, opaque corners and missing local resources',()=>{
 const reads=[200,120,200].map(size=>observation([{name:'AgentWorkspaceMessageBody',images:[{name:'oz-rounded-image:/fixture',width:size,height:size,resourceAvailable:true,cornerAlpha:0}]}]));assert.doesNotThrow(()=>inlineImageProof(reads));for(const change of [{width:120,height:120},{cornerAlpha:255},{resourceAvailable:false},{name:'unrounded'}]){const bad=structuredClone(reads);Object.assign(bad[2].items[0].images[0],change);assert.throws(()=>inlineImageProof(bad));}
});

test('the agent toolkit forwards native-order click intent and exposes the owned order readback',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-order-forward-');
 try{
  const file=root+'/session.json';await writeFile(file,JSON.stringify({root}));
  const stub=pathToFileURL(root+'/platform.mjs').href;
  await writeFile(root+'/platform.mjs',`export const seen=[];export const agentReadOperations=[],agentReadNative=[];export function verifyDesktopPaths(){}export function verifyDesktopOwner(){}export function verifyDesktopLease(){}export async function captureDesktopFailure(){return {};}export async function desktopCall(){throw Error('No domain calls needed');}export function clipPoint(){}export async function physicalInput(file,command,params){seen.push({command,params});return {status:'Dispatched'};}export async function nativeCall(){return {widgets:[{id:'owner',window:'owner',class:'MainWindow',width:100,height:100,visible:true,nativeWindow:10,nativeOrder:1,nativeLevel:0,nativeHasParent:false}]};}`);
  const module=new URL('../desktop/agent-tools.mjs',import.meta.url),source=(await readFile(module,'utf8')).replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(['./adapter.mjs','./physical-input.mjs','./desktop-lease.mjs'].includes(relative)?stub:new URL(relative,module).href)+"'");await writeFile(root+'/tool.mjs',source);
  const {agentTool}=await import(pathToFileURL(root+'/tool.mjs').href);await agentTool(file,'physical',{command:'click',target:{id:'owner'},preserveWindowOrder:true});
  const {seen}=await import(stub);assert.equal(seen.length,1);assert.equal(seen[0].params.preserveWindowOrder,true);assert.equal(seen[0].params.expected.nativeWindow,10);
  const observed=await agentTool(file,'observe',{selector:{id:'owner'}});assert.equal(observed.matches[0].nativeOrder,1);assert.equal(observed.matches[0].nativeHasParent,false);assert.equal(observed.matches[0].visible,true);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('source coverage keeps pinned method inventories and candidate definition identities separate from acceptance',()=>{
 const inventory=JSON.parse(readFileSync(new URL('../scope/macos-source-assertions.json',import.meta.url))),registry=checkRegistry();assert.equal(inventory.sourceHeadsDifferFromQualificationPackage,true);
 assert.equal(inventory.sources.length,4);assert.equal(inventory.rows.filter(r=>r.source==='agent-workspace').length,5);assert(inventory.rows.some(r=>r.symbol==='agentConfiguration_workspaceSharesSelectionAndEffortWithPipeline'&&r.status==='Candidate partial'&&r.checks[0].id==='D-AGENT-PIPELINE-CONFIG'));
 for(const source of inventory.sources){assert(/^[a-f0-9]{40}$/.test(source.revision));assert(/^[a-f0-9]{64}$/.test(source.sha256));}
 for(const row of inventory.rows){assert(inventory.sources.some(s=>s.id===row.source));assert(Number.isInteger(row.line)&&row.line>0);assert.notEqual(row.status,'Full');}
 for(const ref of [...inventory.rows.flatMap(r=>r.checks||[]),...inventory.sources.flatMap(s=>s.relatedChecks||[])])assert.equal(ref.definitionHash,registry.find(c=>c.id===ref.id)?.definitionHash,'Changed candidate needs a reviewed coverage update');
});

test('detached transcript observation catches auto-follow, bounce and missing appended rows',()=>{
 const list={name:'AgentWorkspaceMessageList',count:20,contentY:520,followTail:false,atYEnd:false,userScrollActive:false},before=observation([list]),after=observation([{...list,count:21}]),resumed=observation([{...list,count:21,contentY:640,followTail:true,atYEnd:true}]);
 assert.doesNotThrow(()=>scrollAwayProof(before,[after,after,after],resumed));
 for(const change of [{contentY:640},{followTail:true},{count:22},{userScrollActive:true}])assert.throws(()=>scrollAwayProof(before,[after,observation([{...after.items[0],...change}]),after],resumed));
 assert.throws(()=>scrollAwayProof(before,[after,after,after],after));
});
test('gesture observation catches replacing or moving the old row even when the list reports the tail',()=>{
 const list={name:'AgentWorkspaceMessageList',count:20,followTail:true,atYEnd:true,userScrollActive:true,anchor:{index:19,identity:'retained-row',offset:200}},before=observation([list]),after=observation([{...list,count:21}]),resumed=observation([{...list,count:21,userScrollActive:false}]);
 assert.doesNotThrow(()=>gestureAnchorProof(before,[after,after,after],resumed));
 for(const change of [{identity:'new-row'},{offset:210},{index:20}]){const bad=structuredClone(after);Object.assign(bad.items[0].anchor,change);assert.throws(()=>gestureAnchorProof(before,[after,bad,after],resumed));}
 assert.throws(()=>gestureAnchorProof(before,[after,after,after],after));
});
test('custom-model popup needs the actual untruncated option inside observed bounds',()=>{
 const read={...observation([{name:'AgentWorkspaceModelSelector',visible:true,enabled:true,open:true,parentWidth:252,localX:80,popup:{visible:true,x:-80,width:252,options:[{text:'openai/custom-configured-model',visible:true,truncated:false,width:220}]}}]),controller:{modelOptions:['openai/custom-configured-model'],currentModelIndex:0}};
 assert.doesNotThrow(()=>customModelPopupProof(read));
 for(const mutate of [r=>r.items[0].popup.options[0].truncated=true,r=>r.items[0].popup.width=280,r=>r.items[0].popup.x=0,r=>r.items[0].popup.options=[],r=>r.items[0].popup.options[0].text='wrong',r=>r.items[0].open=false]){const bad=structuredClone(read);mutate(bad);assert.throws(()=>customModelPopupProof(bad));}
});
test('transcript gesture and anchor parameters reject unbounded or mixed fixture requests',()=>{
 for(const p of [{target:'panel',phase:'begin'},{target:'panel',phase:'offset',distance:-120},{target:'panel',phase:'end'},{target:'panel',phase:'resume'}])assert.doesNotThrow(()=>validateNativeParams('workspace-scroll',p));
 for(const p of [{target:'panel',phase:'offset',distance:0},{target:'panel',phase:'offset',distance:Infinity},{target:'panel',phase:'offset',distance:241},{target:'panel',phase:'begin',distance:1},{target:'panel',phase:'bogus'}])assert.throws(()=>validateNativeParams('workspace-scroll',p));
 assert.doesNotThrow(()=>validateNativeParams('workspace-inspect',{target:'panel',anchorIndex:19}));for(const anchorIndex of [-1,256,NaN,1.5])assert.throws(()=>validateNativeParams('workspace-inspect',{target:'panel',anchorIndex}));
 assert.doesNotThrow(()=>validateNativeParams('workspace-model-fixture',{target:'panel',phase:'begin'}));assert.throws(()=>validateNativeParams('workspace-model-fixture',{target:'panel',phase:'begin',model:'user-supplied'}));
});
test('selected model and effort are verified in the independent pipeline, not only the picker',()=>{
 const read={complete:true,controller:{currentModelIndex:5,currentEffortIndex:4}},pipeline={available:true,version:1,identity:'owned-pipeline',model:'openai/gpt-6-luna',effort:5,spawnSuppressed:true,agentActive:false,running:false},expected={model:'openai/gpt-6-luna',modelIndex:5,effort:5,effortIndex:4};
 assert.doesNotThrow(()=>pipelineSelectionProof(read,pipeline,expected));
 for(const changes of [{model:'openai/gpt-6.1-sol'},{effort:1},{spawnSuppressed:false},{agentActive:true},{running:true},{identity:''},{available:false}])assert.throws(()=>pipelineSelectionProof(read,{...pipeline,...changes},expected));
 assert.throws(()=>pipelineSelectionProof({...read,controller:{...read.controller,currentEffortIndex:0}},pipeline,expected));
 assert.doesNotThrow(()=>validateNativeParams('workspace-pipeline-inspect',{target:'panel'}));assert.doesNotThrow(()=>validateNativeParams('workspace-request-selection',{target:'panel',kind:'model',index:5}));for(const index of [-1,32,NaN,1.1])assert.throws(()=>validateNativeParams('workspace-request-selection',{target:'panel',kind:'model',index}));
});
