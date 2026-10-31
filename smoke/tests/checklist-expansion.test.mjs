import test from 'node:test';
import assert from 'node:assert/strict';
import {observedWidget,verifyInspectorEdit,verifyMaskPaste,verifySearchFocus,previewCenterBrightness} from '../desktop/checklist-proof.mjs';
import {checkRegistry,fullSmokeCourse,resolveSelection,selectedRecipe,validateRecipe,initializeCourses} from '../runner/catalog.mjs';
import {agentContext,stepHistory} from '../test-details.mjs';
import {desktopGroups} from '../desktop/run.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const ids=['D-SEARCH-FOCUS','D-INSPECTOR-BLUR-PHYSICAL','D-MASK-CLIPBOARD-PHYSICAL','D-SCOPES-VECTOR'];
const graph=()=>({graph_id:'graph',timeline_id:'timeline',clip_id:'clip',nodes:[{node_id:'mask',type:'rectangle',params:{size:.75},bypassed:false,owners:['clip:timeline:clip']},{node_id:'blur',type:'gaussian_blur',params:{radius:16},bypassed:false,owners:['clip:timeline:clip']}],edges:[{from_node:'mask',from_slot:'coverage',to_node:'blur',to_slot:'matte',type:'pixel'}]});
test('known-frame baseline excludes chrome but rejects a blank colour plate and incomplete pixels',()=>{
 const bytes=Buffer.alloc(64*32*3,255);
 for(let y=8;y<24;y++)for(let x=16;x<48;x++)bytes.fill(0,(y*64+x)*3,(y*64+x)*3+3);
 const image={sampleWidth:64,sampleHeight:32,sampleRgb:bytes.toString('base64')};
 assert.equal(previewCenterBrightness(image),0);
 const plate={...image,sampleRgb:Buffer.alloc(bytes.length,80).toString('base64')};assert.equal(previewCenterBrightness(plate),80);
 assert.ok(previewCenterBrightness(image)<2&&!(previewCenterBrightness(image)>20));
 assert.throws(()=>previewCenterBrightness({...image,sampleRgb:bytes.subarray(0,100).toString('base64')}));
});
test('an interrupted repeated measurement stays Unknown after an earlier successful sample',()=>{
 const spec={steps:[{id:'sample',title:'Sample each tap'}]},events=[{stepId:'sample',status:'Running',at:'first'},{stepId:'sample',status:'Completed',at:'done'},{stepId:'sample',status:'Running',at:'second'}];
 const result=stepHistory(spec,events)[0];assert.equal(result.status,'Unknown');assert.equal(result.finishedAt,null);
 assert.equal(stepHistory(spec,[...events,{stepId:'sample',status:'Fail',at:'failed'}])[0].status,'Fail');
});
test('control resolution blocks incomplete, absent or ambiguous observations',()=>{
 const field={id:'field',class:'MediaSearchField'},match=w=>w.class===field.class;
 assert.equal(observedWidget({widgets:[field]},match,'Search'),field);
 for(const widgets of [[],[field,{...field,id:'other'}],[{...field,rows:65,model:Array(64)}],[{...field,rows:1}],[{...field,sceneItemsTruncated:true}],[{...field,menuTruncated:true}]])
  assert.throws(()=>observedWidget({widgets},match,'Search'),e=>e.status==='Blocked');
});
test('Inspector oracle rejects no-op, wrong parameter, foreign graph and collateral edits',()=>{
 const before=graph(),after=graph();after.nodes[1].params.radius=17;
 assert.equal(verifyInspectorEdit(before,after,'blur','radius').after,17);
 for(const mutate of [g=>g.nodes[1].params.radius=16,g=>g.nodes[0].params.size=.5,g=>g.edges=[],g=>g.clip_id='foreign',g=>g.nodes[1].owners=['foreign'],g=>g.nodes.push({...g.nodes[0],node_id:'extra'})]){
  const wrong=structuredClone(after);mutate(wrong);assert.throws(()=>verifyInspectorEdit(before,wrong,'blur','radius'));
 }
 const linked=graph();linked.nodes[1].params={horizontal_radius:16,vertical_radius:16,uniform_radius:true,border:'clamp'};const edited=structuredClone(linked);edited.nodes[1].params.horizontal_radius=17;edited.nodes[1].params.vertical_radius=17;const fields=['horizontal_radius','vertical_radius'];
 assert.deepEqual(verifyInspectorEdit(linked,edited,'blur',fields).after,{horizontal_radius:17,vertical_radius:17});
 for(const mutate of [g=>g.nodes[1].params.vertical_radius=16,g=>g.nodes[1].params.border='mirror',g=>g.nodes[1].params.uniform_radius=false,g=>g.nodes[0].params.size=.5,g=>g.edges=[]]){const wrong=structuredClone(edited);mutate(wrong);assert.throws(()=>verifyInspectorEdit(linked,wrong,'blur',fields));}
});
test('mask clipboard oracle rejects shared identity, changed originals, wrong owners and rewired masks',()=>{
 const before=graph(),after=graph();after.nodes.push({...structuredClone(before.nodes[0]),node_id:'copy'});
 assert.equal(verifyMaskPaste(before,after,'mask').copyId,'copy');
 for(const mutate of [g=>g.nodes.pop(),g=>g.nodes[2].node_id='mask',g=>g.nodes[2].params.size=.25,g=>g.nodes[2].owners=['other'],g=>g.nodes[0].params.size=.25,g=>g.edges[0].from_node='copy',g=>g.nodes[2].type='gaussian_blur',g=>g.graph_id='foreign']){
  const wrong=structuredClone(after);mutate(wrong);assert.throws(()=>verifyMaskPaste(before,wrong,'mask'));
 }
});
test('search focus oracle rejects focused-only, inert or unfinished results',()=>{
 const observations=['a','b','a'].map(timelineId=>({timelineId,query:'pattern',status:'1 result',names:['pattern.mov']})),expected={query:'pattern',name:'pattern.mov'};
 assert.deepEqual(verifySearchFocus(observations,expected,'motion.mp4').focuses,['a','b','a']);
 for(const mutate of [o=>o[1].names=[],o=>o[1].names.push('motion.mp4'),o=>o[1].status='Searching…',o=>o[1].query='',o=>o.forEach(x=>x.timelineId='a')]){
  const wrong=structuredClone(observations);mutate(wrong);assert.throws(()=>verifySearchFocus(wrong,expected,'motion.mp4'));
 }
});
test('new candidates resolve individually, run in isolated groups and carry usable agent selections',()=>{
 const db=new DatabaseSync(':memory:');initializeCourses(db);
 const map=JSON.parse(readFileSync(new URL('../desktop/check-map.json',import.meta.url)));
 try{for(const id of ids){
  const check=checkRegistry().find(c=>c.id===id);assert.equal(check.accepted,false);assert.ok(fullSmokeCourse().qualificationChecks.includes(id));
  assert.throws(()=>resolveSelection(db,{checkIds:[id]}),/not accepted/);
  const context=agentContext(check,{servicePort:53131}),selection=resolveSelection(db,context.selection);
  assert.deepEqual(new Set(selection.effectiveIds),new Set(['A-CLI-01','D-CLI-01',id]));validateRecipe(selectedRecipe(selection));
  assert.match(context.commands.plan,/--file \/tmp\/smoke-selection.json/);assert.match(context.commands.run,/scripts\/smoke.mjs run/);assert.match(context.selectionInstructions,/Save/);
  assert.deepEqual(desktopGroups([id],map).map(g=>g.ids),[[id]]);
 }
 assert.equal(desktopGroups(ids,map).length,1);assert.equal(desktopGroups(ids,map,'isolated').length,ids.length);
 }finally{db.close();}
});

test('search result binding selects its authored lane while preserving legacy uniqueness and model completeness',async()=>{
 const {searchResultView}=await import('../desktop/checklist-proof.mjs');
 const tree=(id,name,model=[])=>({id,name,class:'QTreeView',model,rows:model.length});
 const bin=tree('bin','',[['motion_25.mp4']]),name=tree('name','mediaNameSearchResults',[['pattern_24.mov']]),semantic=tree('semantic','mediaSemanticSearchResults',[['comet_report.mov']]),splitter={name:'mediaSearchSectionsSplitter'};
 assert.equal(searchResultView({widgets:[bin]},'Name').id,'bin');
 const ui={widgets:[bin,name,semantic,splitter]};assert.equal(searchResultView(ui,'Name').id,'name');assert.equal(searchResultView(ui,'Transcript').id,'semantic');
 const section={id:'semantic-section',parent:'split'},header={id:'semantic-header',name:'mediaSemanticSearchHeading',parent:section.id},unnamed={...semantic,name:'',parent:section.id};const observed={widgets:[bin,name,{id:'split',...splitter},section,header,unnamed]};assert.equal(searchResultView(observed,'Transcript').id,'semantic');assert.throws(()=>searchResultView({widgets:[...observed.widgets,{...unnamed,id:'duplicate'}]},'Transcript'),e=>e.status==='Blocked');
 for(const widgets of [[bin,tree('other','')],[bin,name,{...name,id:'duplicate'},splitter],[bin,splitter],[bin,{...name,rows:2},splitter]])assert.throws(()=>searchResultView({widgets},'Name'),e=>e.status==='Blocked');
});

test('filename empty state uses its published count without inventing a tree or semantic completeness',async()=>{
 const {searchObservation}=await import('../desktop/checklist-proof.mjs');
 const splitter={id:'split',name:'mediaSearchSectionsSplitter'},heading={id:'heading',name:'mediaNameSearchHeading',text:'Name matches · 0'},status={name:'mediaSearchStatus',text:'Search results may be incomplete'},bin={id:'bin',class:'QTreeView',model:[['wrong.mov']],rows:1};
 const ui={widgets:[splitter,heading,status,bin]},empty=searchObservation(ui);
 assert.equal(empty.view.id,'heading');assert.equal(empty.view.model,undefined);assert.deepEqual(empty.names,[]);assert.equal(empty.globalStatus,status.text);assert.equal(empty.completion.count,0);
 const view={id:'name',name:'mediaNameSearchResults',class:'QTreeView',model:[['pattern.mov']],rows:1},positive={widgets:[splitter,{...heading,text:'Name matches · 1'},status,bin,view]};
 assert.deepEqual(searchObservation(positive).names,['pattern.mov']);
 for(const widgets of [[splitter,status,bin],[splitter,{...heading,text:'Name matches · 0+'},status,bin],[splitter,{...heading,text:'Name matches · 1'},status,bin],[...ui.widgets,view]])assert.throws(()=>searchObservation({widgets}),e=>e.status==='Blocked');
});
