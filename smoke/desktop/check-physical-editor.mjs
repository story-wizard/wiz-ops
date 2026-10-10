import {testSpecification,evidenceCaption} from '../test-details.mjs';
import path from 'node:path';
import {copyFile} from 'node:fs/promises';
import {checks,livePreviewEvidence,widgetPixelDifference,requireOrdinaryTimingFixture,verifyTrimmedClip} from './check-support.mjs';
import {agentTool} from './agent-tools.mjs';
import {physicalInput,clipPoint} from './physical-input.mjs';
import {requireProof} from './agent-proof.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,same,near,clips,snapshotState,pause,OutcomeError} from '../runner/engine.mjs';
const file=process.argv[2],{s,n,c,ui,until,check:runCheck,step,action,openTimeline,mediaItem,finish,report}=await checks(file,'desktop-physical-report.json');
report.course=await readJSON(new URL('./physical-editor-course.json',import.meta.url));report.acceptance='Candidate qualification';report.specifications=report.course.cases.map(testSpecification);
const physical=async(command,params)=>{const current=await readJSON(file);return ['P-GRADE-LIVE','P-CURVE-LIVE'].includes(current.currentCheck)?physicalInput(file,command,params):agentTool(file,'physical',{command,...params});},inspect=id=>c('timeline.inspect',{timeline_id:id}),graph=f=>c('graph.get_clip_graph',f.scope);
const staged=(id,stepId,fn)=>step(report.course.cases.find(c=>c.id===id).steps.find(s=>s.id===stepId),fn);
const content=g=>({nodes:g.nodes,edges:g.edges});
async function screen(label){const u=await ui(),window=u.widgets.find(w=>w.id===w.window&&w.active&&['QMessageBox','ads::CFloatingDockContainer'].includes(w.class))||u.widgets.find(w=>w.class==='MainWindow'),r={...await physical('screenshot',{target:window.id}),title:label+' · owned Wizard window'};await writeJSON(path.join(s.root,label+'-screen.json'),r);return retainImage(r,label);}
const check=(id,fn)=>runCheck(id,async()=>{if(['P-GRADE-LIVE','P-CURVE-LIVE'].includes(id))return fn();const begun=await agentTool(file,'begin',{id});try{requireProof(begun.check.proof,'proof_contract_missing','This candidate needs a qualified proof contract',['review_definition']);if((await ui()).widgets.some(w=>w.class==='QMessageBox')){const e=new OutcomeError('An unresolved app dialog blocks a fresh fixture','Blocked');e.fatal=true;throw e;}const result=await fn();
  for(const relative of result.observations||[])await agentTool(file,'evidence',{file:path.join(s.root,relative),title:'Measured application state during this check'});
  for(const image of [result.screenshots||[]].flat())if(image.relative)await agentTool(file,'evidence',{file:path.join(s.root,image.relative),kind:'image',title:evidenceCaption(image.relative)});
  await agentTool(file,'record',{status:'Pass',note:result.summary});
 return result;
 }catch(e){if(e.status!=='Unknown'){const observed=await ui();await writeJSON(path.join(s.root,id+'-observed-ui.json'),observed);if(observed.widgets.some(w=>w.class==='QMessageBox')){e.status='Blocked';e.fatal=true;e.message='App dialog prevented the check: '+e.message;}try{await screen(id+'-failure');}catch{}}await agentTool(file,'record',{status:e.status||'Fail',note:e.message});throw e;}});
async function fixture(name,placed=true,later=false){
 const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),id=t.timeline_id,track=t.tracks.find(x=>x.kind==='video').track_id;
 if(placed)await c('timeline.place_cuts',{id:name,timeline_id:id,cuts:(later?[0,20]:[0]).map((at,i)=>({id:'clip'+i,source:{asset_id:s.assets.plate},source_range:{start_seconds:1,end_seconds:5},streams:'video_only',destination:{at:{seconds:at,track}}}))});
 const before=await inspect(id),v=await openTimeline(name,track);return {id,track,before,v,scope:{timeline_id:id,clip_id:clips(before)[0]?.clip_id}};
}
async function undoTimeline(f){await physical('key',{actionId:'undo',target:f.v.id,key:'cmd+z'});await until(async()=>JSON.stringify(snapshotState(await inspect(f.id)))===JSON.stringify(snapshotState(f.before)));}
async function select(f){await n('key',{target:f.v.id,key:'V'});const current=await readJSON(file);if(['P-GRADE-LIVE','P-CURVE-LIVE'].includes(current.currentCheck)){const geometry=await n('timeline-clip-rect',{target:f.v.id,clipId:f.scope.clip_id});await physicalInput(file,'click',{target:f.v.id,clipId:f.scope.clip_id,expectedClip:geometry.rect,...clipPoint(geometry)});}else await physical('click',{target:f.v.id,clipId:f.scope.clip_id,part:'body'});await c('playback.seek',{time:1});}
async function binDrop(f){
 const asset=(await c('media.list_assets')).assets.find(a=>a.asset_id===s.assets.motion);assert(asset,'Motion source missing');
 const name=asset.display_name||path.basename(asset.local_path),view=await mediaItem(name);if(!(await readJSON(file)).agentProof?.baseline)await n('item-click',{target:view.id,text:name});
 const observed=(await ui()).widgets.find(w=>w.id===view.id),row=observed.model.findIndex(r=>r[0]===name),r=observed.itemRects.find(r=>r.row===row);assert(r&&r.y>=0&&r.height>0,'Bin row is not visible');
 const receipt=await physical('drag',{actionId:'drop',target:view.viewport,x:r.x+Math.min(70,r.width/2),y:r.y+r.height/2,toTarget:f.v.id,toX:0,toY:f.v.height-30});
 const outcome=await until(async()=>{const a=await ui(),dialog=a.widgets.find(w=>w.class==='QMessageBox');return dialog?{a,dialog}:(clips(await inspect(f.id)).some(x=>x.source.asset_id===s.assets.motion)?{}:null);});
 if(outcome.dialog){
  const texts=outcome.a.widgets.filter(w=>w.window===outcome.dialog.id&&w.text).map(w=>w.text),rejection=texts.find(t=>t.startsWith('Could not place dropped media:'));
  if(rejection){const observed=await physical('screenshot',{target:outcome.dialog.id}),current=await readJSON(file);await writeJSON(path.join(s.root,'evidence',current.currentCheck+'-rejection.txt'),{texts,receipt,observed});const buttons=outcome.a.widgets.filter(w=>w.window===outcome.dialog.id&&w.text==='OK');assert(buttons.length===1,'Drop rejection dismissal ambiguous');await physical('click',{target:buttons[0].id,x:buttons[0].width/2,y:buttons[0].height/2});await until(async()=>!(await ui()).widgets.some(w=>w.id===outcome.dialog.id));throw Error(rejection);}
  assert(texts.includes("This timeline is empty. Use the source clip's settings?"),'Unexpected drop dialog');const buttons=outcome.a.widgets.filter(w=>w.window===outcome.dialog.id&&w.text==='Keep Timeline Settings');assert(buttons.length===1,'Keep Timeline Settings control ambiguous');receipt.settingsChoice=await physical('click',{actionId:'keep',target:buttons[0].id,x:buttons[0].width/2,y:buttons[0].height/2});await until(async()=>!(await ui()).widgets.some(w=>w.id===outcome.dialog.id));
 }
 return receipt;
}
async function blurFixture(name){const f=await fixture(name);const g=await graph(f),edge=g.edges.find(e=>e.from_node===g.nodes.find(n=>n.type==='transform_2d').node_id&&e.to_node===g.nodes.find(n=>n.type==='composite').node_id);assert(edge,'Fixture image edge absent');await c('graph.insert_on_edge',{...f.scope,type:'gaussian_blur',from_node:edge.from_node,from_slot:edge.from_slot,to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output',params:{radius:12},expect_structural_revision:g.structural_revision,expect_content_revision:g.content_revision});await select(f);if(!(await ui()).widgets.some(w=>w.class==='RenderGraphView'))await action('Render Graph');await fitGraph();return f;}
async function graphView(){return until(async()=>(await ui()).widgets.find(w=>w.class==='RenderGraphView'));}
async function fitGraph(){const v=await graphView(),button=(await ui()).widgets.find(w=>w.window===v.window&&w.tooltip==='Fit all');assert(button,'Render Graph Fit all absent');await n('click',{target:button.id});await pause(200);}
async function blurItem(){const v=await graphView(),nodes=v.sceneItems.filter(n=>n.labels?.some(l=>/radius/i.test(l)));assert(nodes.length===1,'Blur geometry absent or ambiguous');return {v,node:nodes[0]};}
async function selectBlur(){const {v,node}=await blurItem();await physical('click',{target:v.viewport,x:node.x+node.width*.5,y:node.y+8});await until(async()=>(await blurItem()).node.selected);return v;}
async function undoGraph(f,before){await physical('key',{target:(await graphView()).id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(before)));}

await check('P-TL-BIN-DROP',async()=>{
 const id='P-TL-BIN-DROP',f=await staged(id,'setup',async()=>{const f=await fixture('Physical bin drop',false),view=await mediaItem('motion_25.mp4');await n('item-click',{target:view.id,text:'motion_25.mp4'});await proofPoint(f,'baseline');return f;}),receipt=await staged(id,'drop',()=>binDrop(f));
 const video=await staged(id,'verify',async()=>{const after=await until(async()=>{const a=await inspect(f.id);return clips(a).some(x=>x.source.asset_id===s.assets.motion)?a:null;}),video=clips(after).filter(x=>x.track_id===f.track);assert(video.length===1&&video[0].source.asset_id===s.assets.motion,'Drop created incorrect video clips');near(video[0].timeline_range.start_seconds,0,'Drop start');near(video[0].timeline_range.end_seconds,8,'Dropped full motion duration');return video;});
 await proofPoint(f,'changed');const screenshots=await staged(id,'restore',async()=>{const screenshots=await screen(id);await undoTimeline(f);await proofPoint(f,'restored');return screenshots;});return {summary:'Native bin drag placed the correct eight-second source on V1; one Undo restored the empty timeline.',receipt,clip:video[0],screenshots,agentVerification:{read:{operation:'timeline.inspect',params:{timeline_id:f.id}},expect:{path:['tracks',0,'items'],length:0}},agentCaptureTarget:f.v.id};
});
await check('P-TL-BIN-OVERWRITE',async()=>{
 const id='P-TL-BIN-OVERWRITE',f=await staged(id,'setup',async()=>{const f=await fixture('Physical bin overwrite',true,true),view=await mediaItem('motion_25.mp4');await n('item-click',{target:view.id,text:'motion_25.mp4'});await proofPoint(f,'baseline');return f;}),receipt=await staged(id,'drop',()=>binDrop(f));
 const replacement=await staged(id,'verify',async()=>{const after=await until(async()=>{const a=await inspect(f.id);return clips(a).some(x=>x.source.asset_id===s.assets.motion)?a:null;}),original=clips(f.before),changed=clips(after).filter(x=>x.track_id===f.track);assert(changed.length===2,'Overwrite did not replace covered material');same(changed.find(x=>x.clip_id===original[1].clip_id),original[1],'Later clip preserved');const replacement=changed.find(x=>x.source.asset_id===s.assets.motion);near(replacement.timeline_range.start_seconds,0,'Overwrite start');near(replacement.timeline_range.end_seconds,8,'Overwrite duration');return replacement;});
 await proofPoint(f,'changed');const screenshots=await staged(id,'restore',async()=>{const screenshots=await screen(id);await undoTimeline(f);await proofPoint(f,'restored');return screenshots;});return {summary:'Native bin drop replaced the covered clip, preserved the later clip and restored the original timeline with one Undo.',receipt,replacement,screenshots,agentVerification:{read:{operation:'timeline.inspect',params:{timeline_id:f.id}},expect:{path:['tracks'],equals:f.before.tracks}},agentCaptureTarget:f.v.id};
});
async function proofPoint(f,assertion){const target=f.proofView?.id||f.v.id,verified=await agentTool(file,'verify',{assertion,...(assertion==='baseline'?{target}:{}),read:{operation:f.proofGraph?'graph.get_clip_graph':'timeline.inspect',params:f.proofGraph?f.scope:{timeline_id:f.id}},title:'Verify '+assertion});if(assertion==='baseline')return verified;return agentTool(file,'capture',{assertion,target,title:'Displayed '+assertion+' state'});}
await check('P-TL-TRIM',async()=>{
 const id='P-TL-TRIM',f=await staged(id,'setup',()=>fixture('Physical right trim')),before=clips(f.before)[0];await screen(id+'-before');
 requireOrdinaryTimingFixture(f.before,before.clip_id);
 await proofPoint(f,'baseline');
 const geometry=await agentTool(file,'geometry',{target:f.v.id,clipId:before.clip_id,part:'right-edge'});
 await staged(id,'trim',()=>physical('drag',{actionId:'trim',target:f.v.id,clipId:before.clip_id,part:'right-edge',toX:geometry.rect.x+geometry.rect.width*.75-1,toY:geometry.point.y}));
 const after=await staged(id,'verify',async()=>{const a=await until(async()=>{const a=await inspect(f.id);return clips(a)[0]?.timeline_range.end_seconds<4?a:null;});verifyTrimmedClip(before,clips(a)[0],24);return a;});
 const capture=await proofPoint(f,'changed');await staged(id,'restore',async()=>{await physical('key',{actionId:'undo',target:f.v.id,key:'cmd+z'});await until(async()=>JSON.stringify(snapshotState(await inspect(f.id)))===JSON.stringify(snapshotState(f.before)));await proofPoint(f,'restored');});
 return {summary:'Physical right-edge drag shortened the intended clip and source range; one Undo restored its original timing.',before:f.before,after,capture,agentVerification:{read:{operation:'timeline.inspect',params:{timeline_id:f.id}},expect:{path:['tracks',0,'items',0,'timeline_range'],equals:before.timeline_range}},agentCaptureTarget:f.v.id};
});
await check('P-TRACK-ADD',async()=>{
 const id='P-TRACK-ADD',f=await staged(id,'setup',()=>fixture('Physical add video track',false));
 const button=await agentTool(file,'find',{selector:{name:'panelChromeAction',text:'+ Video',enabled:true}});await screen(id+'-before');
 await proofPoint(f,'baseline');await staged(id,'add',()=>physical('click',{actionId:'add',target:button.id}));await physical('key',{actionId:'save',stepId:'verify',target:f.v.id,key:'cmd+s'});
 const after=await staged(id,'verify',async()=>{const a=await until(async()=>{const a=await inspect(f.id);return a.tracks.length===f.before.tracks.length+1?a:null;}),added=a.tracks.filter(t=>!f.before.tracks.some(b=>b.track_id===t.track_id));assert(added.length===1&&added[0].address==='V2'&&added[0].items.every(i=>i.kind!=='clip'),'Track addition has wrong identity, type or contents');return a;});
 const capture=await proofPoint(f,'changed');await staged(id,'restore',async()=>{await physical('key',{actionId:'undo',target:f.v.id,key:'cmd+z'});await physical('key',{actionId:'restore-save',target:f.v.id,key:'cmd+s'});await until(async()=>JSON.stringify(snapshotState(await inspect(f.id)))===JSON.stringify(snapshotState(f.before)));await proofPoint(f,'restored');});
 return {summary:'Physical + Video click and Save added one empty video track; Undo and Save restored the original tracks.',before:f.before,after,capture,agentVerification:{read:{operation:'timeline.inspect',params:{timeline_id:f.id}},expect:{path:['tracks'],length:f.before.tracks.length}},agentCaptureTarget:f.v.id};
});
await check('P-RG-MOVE',async()=>{
 const id='P-RG-MOVE',{f,before,v,node,from,baseline}=await staged(id,'setup',async()=>{const f=await blurFixture('Physical Render Graph move'),before=await graph(f),{v,node}=await blurItem();Object.assign(f,{proofGraph:true,proofView:v});await proofPoint(f,'baseline');return {f,before,v,node,from:{x:node.sceneX,y:node.sceneY},baseline:await screen(id+'-before')};});
 const receipt=await staged(id,'move',()=>physical('drag',{actionId:'move',target:v.viewport,x:node.x+node.width*.5,y:node.y+8,toX:node.x+node.width*.5+25,toY:node.y+28}));
 const moved=await staged(id,'verify-move',async()=>{const moved=await until(async()=>{const a=(await blurItem()).node;return a.sceneX!==from.x||a.sceneY!==from.y?a:null;});same(content(await graph(f)),content(before),'Node movement preserves graph contents');return moved;});
 await proofPoint(f,'moved');const pan=await staged(id,'pan',()=>physical('drag',{actionId:'pan',stepId:'verify-pan',target:v.viewport,button:'middle',x:25,y:25,toX:60,toY:50}));
 const {panned,capture}=await staged(id,'verify-pan',async()=>{const panned=await until(async()=>{const a=(await blurItem()).node;return a.x!==moved.x||a.y!==moved.y?a:null;}),after=await graph(f);await writeJSON(path.join(s.root,'evidence',id+'-graph-observations.txt'),{before,after,from,moved,panned});assert(panned.sceneX===moved.sceneX&&panned.sceneY===moved.sceneY,'Panning moved the node in scene space');same(content(after),content(before),'Panning preserves graph contents');return {panned,capture:await screen(id+'-after')};});
 await proofPoint(f,'panned');return {summary:'Native node drag changed its scene position; native middle-button pan changed only the view.',receipt,pan,from,moved,panned,observations:['evidence/'+id+'-graph-observations.txt'],screenshots:[baseline,capture],agentVerification:{read:{operation:'graph.get_clip_graph',params:f.scope},expect:{path:['nodes'],equals:before.nodes}},agentCaptureTarget:v.id};
});
await check('P-RG-WIRE',async()=>{
 const id='P-RG-WIRE',{f,edge,before,v,outputs,inputs,baseline}=await staged(id,'setup',async()=>{
  const f=await blurFixture('Physical Render Graph wire'),connected=await graph(f),blur=connected.nodes.find(n=>n.type==='gaussian_blur'),edge=connected.edges.find(e=>e.to_node===blur.node_id&&e.to_slot==='input');assert(edge,'Blur input edge absent');
  await c('graph.disconnect_edge',{...f.scope,...edge,type:edge.type,expect_structural_revision:connected.structural_revision,expect_content_revision:connected.content_revision});await fitGraph();const before=await graph(f),{v,node}=await blurItem(),sources=v.sceneItems.filter(n=>n.labels?.some(l=>/scale/i.test(l))&&n.ports.some(p=>p.side==='output'));assert(sources.length===1,'Transform output geometry absent or ambiguous');
  const outputs=sources[0].ports.filter(p=>p.side==='output'),inputs=node.ports.filter(p=>p.side==='input').sort((a,b)=>a.y-b.y);assert(outputs.length===1&&inputs.length>=1,'Port geometry absent');Object.assign(f,{proofGraph:true,proofView:v});await proofPoint(f,'baseline');return {f,edge,before,v,outputs,inputs,baseline:await screen(id+'-before')};
 });
 const receipt=await staged(id,'wire',()=>physical('drag',{actionId:'wire',target:v.viewport,x:outputs[0].x,y:outputs[0].y,toX:inputs[0].x,toY:inputs[0].y}));
 const {restored,capture}=await staged(id,'verify',async()=>{await until(async()=>(await graph(f)).edges.some(e=>e.from_node===edge.from_node&&e.from_slot===edge.from_slot&&e.to_node===edge.to_node&&e.to_slot===edge.to_slot));const restored=await graph(f);await writeJSON(path.join(s.root,'evidence',id+'-graph-observations.txt'),{before,after:restored,edge});return {restored,capture:await screen(id+'-after')};});
 await proofPoint(f,'changed');await staged(id,'history',async()=>{await physical('key',{actionId:'undo',target:v.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(before)));await proofPoint(f,'restored');await physical('key',{actionId:'redo',target:v.id,key:'cmd+shift+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(restored)));await proofPoint(f,'redone');});
 return {summary:'Native port drag connected the intended transform and blur ports; Undo and Redo verified the edge.',receipt,edge,observations:['evidence/'+id+'-graph-observations.txt'],screenshots:[baseline,capture],agentVerification:{read:{operation:'graph.get_clip_graph',params:f.scope},expect:{path:['edges'],includes:edge}},agentCaptureTarget:v.id};
});
await check('P-RG-CLIPBOARD',async()=>{
 const id='P-RG-CLIPBOARD',{f,before,source,sourceGeometry,v,baseline}=await staged(id,'setup',async()=>{const f=await blurFixture('Physical Render Graph clipboard'),before=await graph(f),source=before.nodes.find(n=>n.type==='gaussian_blur'),sourceGeometry=(await blurItem()).node,baseline=await screen(id+'-before'),v=await selectBlur();await n('clipboard-save');Object.assign(f,{proofGraph:true,proofView:v});await proofPoint(f,'baseline');return {f,before,source,sourceGeometry,v,baseline};});let marked=false;
 try{
  await staged(id,'paste',async()=>{await physical('key',{actionId:'copy',target:v.id,key:'cmd+c'});await n('clipboard-mark');marked=true;await physical('key',{actionId:'paste',target:(await graphView()).id,key:'cmd+v'});});
  const {pasted,copy,capture}=await staged(id,'verify',async()=>{let pasted,observed;try{pasted=await until(async()=>{observed=await graph(f);return observed.nodes.filter(n=>n.type==='gaussian_blur').length===2?observed:null;});}finally{if(observed)await writeJSON(path.join(s.root,'evidence',id+'-graph-observations.txt'),{before,after:observed,source:source.node_id,copy:observed.nodes.find(n=>n.type==='gaussian_blur'&&n.node_id!==source.node_id)?.node_id});}const copy=pasted.nodes.find(n=>n.type==='gaussian_blur'&&n.node_id!==source.node_id);assert(copy,'Paste did not mint a new node');same(copy.params,source.params,'Copy parameters');const original=pasted.nodes.find(n=>n.node_id===source.node_id);assert(original?.type===source.type&&original.bypassed===source.bypassed,'Source identity/type/bypass changed');same(original.params,source.params,'Source parameters preserved');return {pasted,copy,capture:await screen(id+'-after')};});
  await proofPoint(f,'pasted');await staged(id,'delete',async()=>{const view=await graphView(),copies=view.sceneItems.filter(n=>n.nodeId===copy.node_id);assert(copies.length===1,'Pasted-node geometry absent or ambiguous');const node=copies[0];await physical('click',{actionId:'select',target:view.viewport,x:node.x+node.width*.5,y:node.y+8});await until(async()=>(await graphView()).sceneItems.some(n=>n.selected&&n.sceneX===node.sceneX&&n.sceneY===node.sceneY));await physical('key',{actionId:'delete',target:(await graphView()).id,key:'delete'});await until(async()=>(await graph(f)).nodes.every(n=>n.node_id!==copy.node_id));});
  await proofPoint(f,'deleted');const restored=await staged(id,'restore',async()=>{await physical('key',{actionId:'undo-delete',target:v.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(pasted)));await proofPoint(f,'paste-restored');await physical('key',{actionId:'undo-paste',target:v.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(before)));await proofPoint(f,'restored');return screen(id+'-undo');});
  return {summary:'Native Copy/Paste created an independent blur; Delete and two Undo steps restored the original graph.',source:source.node_id,copy:copy.node_id,observations:['evidence/'+id+'-graph-observations.txt'],screenshots:[baseline,capture,restored],agentVerification:{read:{operation:'graph.get_clip_graph',params:f.scope},expect:{path:['nodes'],equals:before.nodes}},agentCaptureTarget:v.id};
 }finally{await staged(id,'clipboard',async()=>{const restored=await n('clipboard-restore');if(marked)assert(restored.restored,'Clipboard restoration failed');});}
});

async function retainImage(result,label){const relative='evidence/'+label+'.png';await copyFile(result.path||result.output,path.join(s.root,relative));return {...result,relative,artifacts:[...(result.artifacts||[]).filter(file=>!file.endsWith('.png')),relative]};}
async function liveDrag(id,setup){
 const {f,control,points,before,preview,baseline}=await staged(id,'setup',async()=>{
  const prepared=await setup(),before=await graph(prepared.f),preview=(await ui()).widgets.find(w=>w.class==='MetalPreviewWidget');assert(preview,'Metal preview absent');await physical('screenshot',{target:prepared.control.id});
  return {...prepared,before,preview,baseline:await retainImage(await physical('screenshot',{target:preview.id,crop:true}),id+'-before')};
 });
 const samples=[];let receipt,inputError,after,displayed,restored;
 const observations=()=>writeJSON(path.join(s.root,'evidence',id+'-live-observations.txt'),{before,after,receipt,inputError:inputError?.message,baseline,samples,displayed,restored});
 await staged(id,'gesture',async()=>{
  let done=false;const gesture=physical('drag',{target:control.id,...points,durationMs:10000}).then(r=>{receipt=r;},e=>{inputError=e;}).finally(()=>{done=true;});
  try{await pause(1000);while(!done){const startedAt=Date.now(),image=await retainImage(await physical('screenshot',{target:preview.id,crop:true}),id+'-sample-'+samples.length);samples.push({startedAt,finishedAt:Date.now(),image});await pause(300);}}
  finally{await gesture;await observations();}
  if(inputError)throw inputError;
 });
 const measured=await staged(id,'verify',async()=>{
  after=await graph(f);displayed=await retainImage(await physical('screenshot',{target:preview.id,crop:true}),id+'-after');await observations();
  assert(JSON.stringify(content(after))!==JSON.stringify(content(before)),'Gesture did not change the target clip graph parameters');return livePreviewEvidence(baseline,samples,receipt);
 });
 const capture=await staged(id,'restore',async()=>{
  await physical('key',{target:control.id,key:'cmd+z'});await until(async()=>JSON.stringify(content(await graph(f)))===JSON.stringify(content(before)));await pause(300);
  restored=await retainImage(await physical('screenshot',{target:preview.id,crop:true}),id+'-undo');await observations();assert(widgetPixelDifference(restored,baseline)<1.5,'Undo did not restore displayed pixels');return screen(id);
 });
 return {summary:`Ten-second native drag produced ${measured.samplesDuringHold} held-gesture preview samples with evolving pixels; one Undo restored the graph and displayed frame.`,receipt,...measured,heldMs:receipt.pointerUpAt-receipt.pointerDownAt,fixture:'Local short media, warmed displayed frame',observations:['evidence/'+id+'-live-observations.txt'],screenshots:[baseline,...samples.map(x=>x.image),displayed,restored,capture],agentVerification:{read:{operation:'graph.get_clip_graph',params:f.scope},expect:{path:['nodes'],equals:before.nodes}},agentCaptureTarget:preview.id};
}
await check('P-GRADE-LIVE',()=>liveDrag('P-GRADE-LIVE',async()=>{
 const f=await fixture('Physical primary live'),g=await graph(f),edge=g.edges.find(e=>e.from_node===g.nodes.find(n=>n.type==='transform_2d').node_id&&e.to_node===g.nodes.find(n=>n.type==='composite').node_id);assert(edge,'Primary fixture edge missing');await c('graph.insert_on_edge',{...f.scope,type:'wiz.color.grading_primary',from_node:edge.from_node,from_slot:edge.from_slot,to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output',params:{'grade.primary.saturation':1},expect_structural_revision:g.structural_revision,expect_content_revision:g.content_revision});await select(f);if(!(await ui()).widgets.some(w=>w.class==='PrimaryGradePanel'))await action('Primary Grade');
 const controls=await until(async()=>{const wheels=(await ui()).widgets.filter(w=>w.class==='ColorWheelWidget'&&w.enabled).sort((a,b)=>a.x-b.x);return wheels.length>=3?wheels:null;}),wheel=controls[1];
 return {f,control:wheel,points:{x:wheel.width*.5,y:wheel.height*.5,toX:wheel.width*.9,toY:wheel.height*.3}};
}));
await check('P-CURVE-LIVE',()=>liveDrag('P-CURVE-LIVE',async()=>{
 const f=await fixture('Physical curve live');await select(f);if(!(await ui()).widgets.some(w=>w.class.endsWith('CurvesPanel')))await action('Curves');
 if(!(await ui()).widgets.some(w=>w.tooltip==='Master')){const chips=(await ui()).widgets.filter(w=>w.class.endsWith('CurveGroupChip')&&w.tooltip==='Expand this group');assert(chips.length,'Curve groups unavailable');await n('click',{target:chips[0].id});}
 const master=await until(async()=>(await ui()).widgets.find(w=>w.tooltip==='Master'));await n('click',{target:master.id});
 const editor=await until(async()=>{const u=await ui(),parents=new Map(u.widgets.map(w=>[w.id,w]));return u.widgets.find(w=>{if(!w.class.endsWith('CurveEditorWidget'))return false;for(let p=w;p;p=parents.get(p.parent))if(p.class.endsWith('RgbCurvePanel'))return true;return false;});});
 return {f,control:editor,points:{x:editor.width*.5,y:editor.height*.5,toX:editor.width*.5,toY:editor.height*.25}};
}));
finish();
