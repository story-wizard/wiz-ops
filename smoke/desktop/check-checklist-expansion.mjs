import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {checks,gapFixture,widgetPixelDifference} from './check-support.mjs';
import {observedWidget,verifyInspectorEdit,verifyMaskPaste,verifySearchFocus,previewCenterBrightness} from './checklist-proof.mjs';
import {physicalInput,clipPoint} from './physical-input.mjs';
import {assert,same,clips,snapshotState,OutcomeError} from '../runner/engine.mjs';
import {writeJSON} from '../runner/files.mjs';
const file=process.argv[2],{s,n,c,ui,until,check:runCheck,step,action,openTimeline,finish}=await checks(file,'desktop-checklist-expansion-report.json');
const inspect=id=>c('timeline.inspect',{timeline_id:id}),graph=f=>c('graph.get_clip_graph',f.scope),content=g=>({nodes:g.nodes,edges:g.edges});
const stage=(id,title,phase,fn)=>step({id,title,phase},fn);
const physical=(command,params)=>physicalInput(file,command,params);
let captureSequence=0;
const retained=new Map();
function keep(id,file){if(!retained.has(id))retained.set(id,[]);retained.get(id).push(file);}
async function check(id,fn){return runCheck(id,async()=>{try{return await fn();}catch(e){e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...(retained.get(id)||[])]};throw e;}});}
async function capture(id,phase,target,kind='presented'){
 const directory=path.join(s.root,'evidence');await mkdir(directory,{recursive:true});
 const image=kind==='widget'?await n('snapshot-widget',{target}):await physical('screenshot',{target,crop:true});
 const point=phase.replace(/^(before|after|undo)-(.*)$/,'$2-$1');
 const output=path.join(directory,id+'-'+(++captureSequence)+'-'+point+'.png');await copyFile(image.path||image.output,output);keep(id,output);
 return {...image,path:output,artifacts:[output]};
}
async function observe(id,value){const output=path.join(s.root,'evidence',id+'-graph-observations.txt');await mkdir(path.dirname(output),{recursive:true});await writeJSON(output,value);keep(id,output);return output;}
async function fixture(name){const before=await gapFixture(c,s.assets,name),view=await openTimeline(name);return {id:before.timeline.timeline_id,before,view,scope:{timeline_id:before.timeline.timeline_id,clip_id:clips(before)[0].clip_id}};}
async function selectClip(f){
 const geometry=await n('timeline-clip-rect',{target:f.view.id,clipId:f.scope.clip_id});
 await physical('key',{target:f.view.id,key:'v'});
 await physical('click',{target:f.view.id,clipId:f.scope.clip_id,expectedClip:geometry.rect,...clipPoint(geometry)});
 await c('playback.seek',{time:1});
}
async function graphView(f){return observedWidget(await ui(),w=>w.class==='RenderGraphView'&&w.timelineId===f.id&&(w.graphId===f.graphId||w.graphId==='clip:'+f.id+':'+f.scope.clip_id),'Fixture Render Graph');}
async function selectNode(f,nodeId){
 let view=await graphView(f);const buttons=(await ui()).widgets.filter(w=>w.window===view.window&&w.tooltip==='Fit all');
 if(buttons.length===1)await n('click',{target:buttons[0].id});
 view=await graphView(f);const nodes=view.sceneItems.filter(x=>x.nodeId===nodeId);
 if(nodes.length!==1)throw new OutcomeError('Exact graph-node geometry is unavailable; refresh the adapter binding','Blocked');
 const node=nodes[0];await physical('click',{target:view.viewport,x:node.x+node.width/2,y:node.y+Math.min(8,node.height/2)});
 await until(async()=>(await graphView(f)).sceneItems.some(x=>x.nodeId===nodeId&&x.selected),{description:'Exact graph node selection'});
 return graphView(f);
}

await check('D-SEARCH-FOCUS',async()=>{
 const id='D-SEARCH-FOCUS',fixtures=await stage('setup','Create two timelines with distinct sources','prepare',async()=>{
  const a=await fixture('Search focus A'),b=await c('timeline.create',{name:'Search focus B',video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}});
  await c('timeline.place_cuts',{id:'search-focus-b',timeline_id:b.timeline_id,cuts:[{id:'motion',source:{asset_id:s.assets.motion},source_range:{start_seconds:0,end_seconds:2},streams:'video_only',destination:{at:{seconds:0,track:b.tracks.find(t=>t.kind==='video').track_id}}}]});
  // A contains both sources; B has no plate, so the match must survive focus outside A.
  return [a,{id:b.timeline_id,before:await inspect(b.timeline_id)}];
 }),observations=[],screenshots=[],query='pattern_24';let uncertain=false;
 try{
  for(const f of [fixtures[0],fixtures[1],fixtures[0]])await stage('search','Focus a timeline and search the project','execute',async()=>{
   await n('text',{target:observedWidget(await ui(),w=>w.class==='MediaSearchField','Media search field').id,text:''});
   await openTimeline(f.before.timeline.name);
   const field=observedWidget(await ui(),w=>w.class==='MediaSearchField','Media search field');
   await physical('click',{target:field.id,x:field.width/2,y:field.height/2});await physical('type',{target:field.id,text:query});await physical('key',{target:field.id,key:'Return'});
   const result=await until(async()=>{const u=await ui(),field=observedWidget(u,w=>w.class==='MediaSearchField','Media search field'),status=u.widgets.find(w=>w.name==='mediaSearchStatus')?.text||'';
    if(/unavailable/i.test(status))throw new OutcomeError('Selected build search worker is unavailable','Blocked');
    const bin=observedWidget(u,w=>w.class==='QTreeView'&&Array.isArray(w.model),'Media search results');
    return field.text===query&&!/searching|pending|loading/i.test(status)&&bin.model.some(r=>r[0]==='pattern_24.mov')?{query:field.text,status,names:bin.model.map(r=>r[0]).sort(),bin}:null;
   },{description:'Project-wide search match in focused timeline'});
   observations.push({...result,timelineId:f.id});await observe(id,observations);
   screenshots.push(await capture(id,'after-'+observations.length,result.bin.id,'widget'));
  });
  return await stage('verify','Compare results and unchanged timelines','verify',async()=>{
   const result=verifySearchFocus(observations,{query,name:'pattern_24.mov'},'motion_25.mp4');
   for(const f of fixtures)same(snapshotState(await inspect(f.id)),snapshotState(f.before),'Search preserves each timeline');
   return {...result,screenshots,observations:path.join(s.root,'evidence',id+'-graph-observations.txt')};
  });
 }catch(e){uncertain=e.status==='Unknown';throw e;}
 finally{if(!uncertain)await stage('cleanup','Clear search and restore the owned timeline','cleanup',async()=>{await n('text',{target:observedWidget(await ui(),w=>w.class==='MediaSearchField','Media search field').id,text:''});await openTimeline((await inspect(s.main.id)).timeline.name);});}
});

await check('D-INSPECTOR-BLUR-PHYSICAL',async()=>{
 const id='D-INSPECTOR-BLUR-PHYSICAL',f=await stage('setup','Prepare and select a blur in the clip graph','prepare',async()=>{
  const f=await fixture('Physical blur Inspector'),g=await graph(f),edge=g.edges.find(e=>e.from_node===g.nodes.find(n=>n.type==='transform_2d').node_id&&e.to_node===g.nodes.find(n=>n.type==='composite').node_id);
  assert(edge,'Fixture transform-to-composite edge missing');await c('graph.insert_on_edge',{...f.scope,type:'gaussian_blur',from_node:edge.from_node,from_slot:edge.from_slot,to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output',params:{radius:16},expect_structural_revision:g.structural_revision,expect_content_revision:g.content_revision});
  const before=await graph(f);f.graphId=before.graph_id;f.nodeId=before.nodes.find(n=>n.type==='gaussian_blur').node_id;f.graphBefore=before;
  await selectClip(f);if(!(await ui()).widgets.some(w=>w.class==='RenderGraphView'))await action('Render Graph');await selectNode(f,f.nodeId);
  if(!(await ui()).widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Radius'))await action('Inspector');return f;
 });
 const preview=observedWidget(await ui(),w=>w.class==='MetalPreviewWidget','Displayed preview'),before=await capture(id,'before',preview.id),screenshots=[before];
 assert(Buffer.from(before.sampleRgb,'base64').reduce((a,b)=>a+b,0)/(64*32*3)>5,'Inspector baseline preview is blank');
 const control=await until(async()=>{const u=await ui(),labels=u.widgets.filter(w=>w.name==='InspectorParamLabel'&&w.text==='Radius');if(!labels.length)return null;
  const label=observedWidget(u,w=>w.name==='InspectorParamLabel'&&w.text==='Radius','Inspector Radius label');
  return observedWidget(u,w=>w.name==='InspectorSliderControl'&&w.window===label.window&&Math.abs(w.y-label.y)<5&&w.enabled,'Inspector Radius slider');
 },{description:'Selected blur Inspector control'});
 await stage('edit','Focus the current Radius thumb and increase it with the physical keyboard','execute',async()=>{
  if(!control.handle)throw new OutcomeError('Inspector slider exposes no current-thumb geometry; extend the adapter binding before physical input','Blocked');
  await physical('click',{target:control.id,x:control.handle[0],y:control.handle[1]});
  same(content(await graph(f)),content(f.graphBefore),'Focusing the slider preserves its value');
  await physical('key',{target:control.id,key:'right'});
 });
 const after=await until(async()=>{const a=await graph(f);return a.nodes.find(n=>n.node_id===f.nodeId)?.params.radius!==16?a:null;},{description:'Blur Radius changed by Inspector input'});
 const observations=await observe(id,{before:f.graphBefore,after});
 const result=await stage('verify','Check only Radius changed and preview pixels respond','verify',async()=>{
  const result=verifyInspectorEdit(f.graphBefore,after,f.nodeId,'radius');
  const changed=await until(async()=>{const image=await capture(id,'after',preview.id);return widgetPixelDifference(before,image)>.01?image:null;},{description:'Displayed blur responds to Inspector'});
  screenshots.push(changed);return {...result,pixelDifference:widgetPixelDifference(before,changed),observations,screenshots};
 });
 await stage('restore','Undo the edit and verify the original graph and image','cleanup',async()=>{
  await physical('key',{target:control.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(f.graphBefore)),{description:'Inspector Undo restores graph'});
  const restored=await until(async()=>{const image=await capture(id,'undo',preview.id);return widgetPixelDifference(before,image)<1.5?image:null;},{description:'Inspector Undo restores displayed pixels'});screenshots.push(restored);
  same(snapshotState(await inspect(f.id)),snapshotState(f.before),'Inspector preserves timeline');
 });return result;
});

await check('D-MASK-CLIPBOARD-PHYSICAL',async()=>{
 const id='D-MASK-CLIPBOARD-PHYSICAL',f=await stage('setup','Build a connected half-frame matte','prepare',async()=>{
  const f=await fixture('Physical mask clipboard'),g=await graph(f),composite=g.nodes.find(n=>n.type==='composite'),edge=g.edges.find(e=>e.to_node===composite.node_id);
  await c('graph.add_pass',{...f.scope,type:'rectangle',params:{size:.75,scale_x:.5,pan:.25}});await c('graph.add_pass',{...f.scope,type:'apply_matte'});
  const prepared=await graph(f),mask=prepared.nodes.find(n=>n.type==='rectangle'),matte=prepared.nodes.find(n=>n.type==='apply_matte');
  await c('graph.edit_batch',{...f.scope,ops:[{op:'disconnect_edge',...edge},{op:'connect_edge',from_node:edge.from_node,from_slot:edge.from_slot,to_node:matte.node_id,to_slot:'image',type:'pixel'},{op:'connect_edge',from_node:mask.node_id,from_slot:'coverage',to_node:matte.node_id,to_slot:'matte',type:'pixel'},{op:'connect_edge',from_node:matte.node_id,from_slot:'output',to_node:edge.to_node,to_slot:edge.to_slot,type:'pixel'}]});
  f.graphBefore=await graph(f);f.graphId=f.graphBefore.graph_id;f.nodeId=mask.node_id;await selectClip(f);if(!(await ui()).widgets.some(w=>w.class==='RenderGraphView'))await action('Render Graph');await selectNode(f,f.nodeId);return f;
 });
 const view=await graphView(f),preview=observedWidget(await ui(),w=>w.class==='MetalPreviewWidget','Displayed preview'),baseline=await capture(id,'before',preview.id),screenshots=[baseline];
 assert(Buffer.from(baseline.sampleRgb,'base64').reduce((a,b)=>a+b,0)/(64*32*3)>5,'Connected matte baseline preview is blank');
 await n('clipboard-save');let marked=false;
 try{
  // Render Graph uses an app-owned node clipboard, independent of system MIME
  // types. Verify the independent pasted node below, not the OS clipboard format.
  await stage('paste','Physically copy and paste the selected mask','execute',async()=>{await physical('key',{target:view.id,key:'cmd+c'});await n('clipboard-mark');marked=true;await physical('key',{target:view.id,key:'cmd+v'});});
  const after=await until(async()=>{const g=await graph(f);return g.nodes.length>f.graphBefore.nodes.length?g:null;},{description:'Independent pasted mask'}),observations=await observe(id,{before:f.graphBefore,after});
  const result=await stage('verify','Verify independent mask identity, parameters and preserved wiring','verify',async()=>{
   const result=verifyMaskPaste(f.graphBefore,after,f.nodeId),image=await capture(id,'after',preview.id);screenshots.push(image);assert(widgetPixelDifference(baseline,image)<1.5,'Unused mask paste changed the displayed image');return {...result,observations,screenshots};
  });
  await stage('restore','Delete the copy and undo both deletion and paste','cleanup',async()=>{
   await selectNode(f,result.copyId);await physical('key',{target:view.id,key:'delete'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(f.graphBefore)),{description:'Delete removes only pasted mask'});
   await physical('key',{target:view.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(after)),{description:'Undo restores pasted mask'});
   await physical('key',{target:view.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(f.graphBefore)),{description:'Undo paste restores original matte'});
   const restored=await capture(id,'undo',preview.id);screenshots.push(restored);assert(widgetPixelDifference(baseline,restored)<1.5,'Undo did not restore the original displayed matte');
   same(snapshotState(await inspect(f.id)),snapshotState(f.before),'Mask clipboard preserves timeline');
  });return result;
 }finally{await stage('clipboard','Restore the tester clipboard','cleanup',async()=>{const restored=await n('clipboard-restore');if(marked)assert(restored.restored,'Tester clipboard changed externally and could not be restored');});}
});

await check('D-SCOPES-VECTOR',async()=>{
 const id='D-SCOPES-VECTOR',f=await stage('setup','Open scopes on a colour plate and a black gap','prepare',async()=>{const f=await fixture('Vectorscope tap smoke');await c('render.bind_timeline',{timeline_id:f.id});await action('Scopes');return f;}),observations=[];let type,tap,uncertain=false;
 try{
  const u=await ui();type=observedWidget(u,w=>w.name==='scopesTypeCombo','Scope type');tap=observedWidget(u,w=>w.name==='scopesTapCombo','Scope tap');
  const index=type.items.findIndex(mode=>/vectorscope/i.test(mode));if(index<0)throw new OutcomeError('Selected build exposes no vectorscope mode','Blocked');
  await n('select',{target:type.id,index});
  for(let j=0;j<tap.items.length;j++)await stage('sample','Compare vectorscope response at '+tap.items[j],'verify',async()=>{
   await n('select',{target:tap.id,index:j});const plot=observedWidget(await ui(),w=>w.window===type.window&&/VectorscopeView/.test(w.class),'Vectorscope plot');
   const preview=observedWidget(await ui(),w=>w.class==='MetalPreviewWidget','Scope source preview');
   const sourceFrames=[];
   async function seekFrame(time,black){
    await c('playback.seek',{time});
    try{return await until(async()=>{
     const transport=await c('playback.query_transport'),image=await capture(id,'source-'+time+'-'+j,preview.id);
     const brightness=previewCenterBrightness(image);
     const sample={time,transport,brightness,path:image.path};sourceFrames.push(sample);await observe(id,{sourceFrames,observations});
     return Math.abs(transport.time-time)<1/24+.001&&!transport.playing&&(black?brightness<2:brightness>20)?sample:null;
    },{description:'Known '+(black?'black gap':'colour plate')+' reaches the displayed preview',timeoutMs:5000});}
    catch(e){if(e.status==='Unknown')throw e;const failure=new OutcomeError('Vectorscope source fixture was not established: '+e.message,'Blocked');failure.diagnostics={...e.diagnostics,time,black,sourceFrames};throw failure;}
   }
   const black=await seekFrame(5,true),gap=await capture(id,'before-'+j,plot.id,'widget');
   const plate=await seekFrame(1,false),image=await until(async()=>{const image=await capture(id,'after-'+j,plot.id,'widget');return widgetPixelDifference(gap,image)>.5?image:null;},{description:'Vectorscope response at '+tap.items[j]});
   observations.push({tap:tap.items[j],pixelDifference:widgetPixelDifference(gap,image),black,plate,gap:gap.path,image:image.path});await observe(id,{sourceFrames,observations});
  });same(snapshotState(await inspect(f.id)),snapshotState(f.before),'Vectorscope preserves timeline');return {observations,scope:'Vectorscope response to colour versus black at available taps'};
 }catch(e){uncertain=e.status==='Unknown';throw e;}
 finally{if(!uncertain)await stage('cleanup','Restore scope controls and close the scope window','cleanup',async()=>{if(type&&tap){await n('select',{target:type.id,index:type.index});await n('select',{target:tap.id,index:tap.index});await n('close-window',{target:type.window});}await c('playback.seek',{time:0});});}
});
finish();
