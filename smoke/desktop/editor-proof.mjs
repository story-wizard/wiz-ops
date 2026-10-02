import {isDeepStrictEqual as same} from 'node:util';
import {clips,snapshotState} from '../runner/engine.mjs';
import {requireProof} from './agent-proof.mjs';
const content=g=>({nodes:g.nodes,edges:g.edges});
// Edge incidence is derived from the separately asserted exact edge set.
const nodeState=n=>{const {incoming,outgoing,...state}=n;return state;};
const blur=view=>view?.sceneItems?.filter(n=>n.labels?.some(l=>/radius/i.test(l)))||[];
export function editorCheckpoint(proof,assertion,observed,ui,session){
 const id=proof.definition.id,graph=id.startsWith('P-RG-'),view=ui.widgets.find(w=>w.id===(session.proofTarget||proof.binding?.target));
 requireProof(view,'test_surface_missing','Observe and bind the intended editor surface',['find']);
 if(assertion==='baseline'){
  if(graph){
   requireProof(view.class==='RenderGraphView'&&Array.isArray(observed.nodes)&&Array.isArray(observed.edges),'wrong_fixture','Read the clip graph and bind its Render Graph view',['prepare_fixture']);
   const nodes=blur(view),node=observed.nodes.filter(n=>n.type==='gaussian_blur'),source=observed.nodes.filter(n=>n.type==='transform_2d');
   requireProof(nodes.length===1&&node.length===1&&source.length===1,'wrong_fixture','Use one blur and one transform in the prepared clip graph',['prepare_fixture']);
   const owner='clip:'+observed.timeline_id+':'+observed.clip_id;
   requireProof((view.graphId===owner||view.graphId===observed.graph_id)&&view.timelineId===observed.timeline_id&&nodes[0].nodeId===node[0].node_id&&observed.clip_id===session.proofRead?.clip_id&&observed.timeline_id===session.proofRead?.timeline_id&&node[0].owners?.includes(owner),'wrong_fixture','Bind the displayed graph and node identities to this exact clip',['observe','prepare_fixture']);
   const binding={target:view.id,window:view.window,viewport:view.viewport,uiGraphId:view.graphId,readParams:session.proofRead,nodeId:node[0].node_id,node:nodes[0],points:{}};
   if(id==='P-RG-WIRE'){
    const sources=view.sceneItems.filter(n=>n.labels?.some(l=>/scale/i.test(l))&&n.ports.some(p=>p.side==='output'));
    requireProof(sources.length===1&&sources[0].nodeId===source[0].node_id,'wrong_fixture','Observe the exact transform output',['find']);
    const outputs=sources[0].ports.filter(p=>p.side==='output'),inputs=nodes[0].ports.filter(p=>p.side==='input').sort((a,b)=>a.y-b.y);
    requireProof(outputs.length===1&&inputs.length&& !observed.edges.some(e=>e.to_node===node[0].node_id&&e.to_slot==='input'),'wrong_fixture','Use the disconnected blur input fixture',['prepare_fixture']);
    const outputEdge=observed.edges.find(e=>e.from_node===node[0].node_id);requireProof(outputEdge?.type,'wrong_fixture','Keep the blur output connected in the fixture',['prepare_fixture']);
    binding.edge={from_node:source[0].node_id,from_slot:'output',to_node:node[0].node_id,to_slot:'input',type:outputEdge.type};
    binding.points.wire={x:outputs[0].x,y:outputs[0].y,toX:inputs[0].x,toY:inputs[0].y};
   }else if(id==='P-RG-MOVE'){binding.points.move={x:nodes[0].x+nodes[0].width*.5,y:nodes[0].y+8};binding.points.pan={x:25,y:25,toX:60,toY:50};}
   return {matched:true,binding,observed};
  }
  requireProof(view.class==='TimelineWidget'&&observed.next_cursor==null&&Array.isArray(observed.tracks),'wrong_fixture','Use a complete timeline observation',['prepare_fixture']);snapshotState(observed);
  const items=clips(observed),overwrite=id==='P-TL-BIN-OVERWRITE';
  requireProof(observed.tracks.length===2&&items.length===(overwrite?2:0)&&(!overwrite||items.every(c=>c.source.asset_id===session.assets.plate)&&items[0].timeline_range.start_seconds===0&&items[1].timeline_range.start_seconds===20),'wrong_fixture','Use the declared empty or two-clip overwrite fixture',['prepare_fixture']);
  const bins=ui.widgets.filter(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]==='motion_25.mp4'));
  requireProof(bins.length===1,'wrong_fixture','Observe the unique Golden motion source row',['find']);
  const bin=bins[0],row=bin.model.findIndex(r=>r[0]==='motion_25.mp4'),rect=bin.itemRects.find(r=>r.row===row);
  requireProof(rect&&rect.y>=0&&rect.width>0&&rect.height>0,'wrong_fixture','Show the source row before freezing its drag',['find']);
  return {matched:true,binding:{target:view.id,window:view.window,timelineId:observed.timeline.timeline_id,binViewport:bin.viewport,readParams:session.proofRead,points:{drop:{x:rect.x+Math.min(70,rect.width/2),y:rect.y+rect.height/2,toX:0,toY:view.height-30}}},observed};
 }
 const base=proof.baseline,b=proof.binding;
 requireProof(graph?observed.graph_id===base.graph_id&&observed.clip_id===base.clip_id&&view.graphId===b.uiGraphId&&view.timelineId===base.timeline_id:observed.timeline?.timeline_id===b.timelineId,'wrong_fixture','Observe the frozen project fixture',['observe']);
 if(assertion==='resolve-unchanged'){
  const previous=proof.lastObserved||base,node=view.sceneItems?.find(n=>n.nodeId===b.nodeId),prior=Object.values(proof.checkpoints).findLast(p=>p.observedUI)?.observedUI||b.node;
  return {matched:graph?same(content(observed),content(previous))&&(id!=='P-RG-MOVE'||!!node&&['x','y','sceneX','sceneY'].every(k=>node[k]===prior[k])):same(snapshotState(observed),snapshotState(previous)),observed};
 }
 if(!graph){
  if(assertion==='restored')return {matched:same(snapshotState(observed),snapshotState(base)),observed};
  const original=clips(base),items=clips(observed),motion=items.filter(c=>c.source.asset_id===session.assets.motion),later=original[1];
  const c=motion[0],matched=motion.length===1&&items.length===(id==='P-TL-BIN-OVERWRITE'?2:1)&&c.track_id===base.tracks.find(t=>t.address==='V1').track_id&&c.timeline_range.start_seconds===0&&c.timeline_range.end_seconds===8&&c.source.source_range.start_seconds===0&&c.source.source_range.end_seconds===8&&(!later||same(items.find(c=>c.clip_id===later.clip_id),later))&&same(observed.tracks.map(t=>t.track_id),base.tracks.map(t=>t.track_id));
  return {matched,observed};
 }
 const nodes=blur(view),node=nodes.find(n=>n.sceneX!==b.node.sceneX||n.sceneY!==b.node.sceneY);
 if(id==='P-RG-MOVE'){
  const moved=proof.checkpoints.moved?.observedUI;
  return {matched:same(content(observed),content(base))&&nodes.length===1&&(assertion==='moved'?!!node:!!moved&&nodes[0].sceneX===moved.sceneX&&nodes[0].sceneY===moved.sceneY&&(nodes[0].x!==moved.x||nodes[0].y!==moved.y)),observed,observedUI:nodes[0]};
 }
 if(id==='P-RG-WIRE'){
  const expected=assertion==='restored'?base.edges:[...base.edges,b.edge];
  return {matched:same(observed.nodes.map(nodeState),base.nodes.map(nodeState))&&observed.edges.length===expected.length&&expected.every(e=>observed.edges.some(a=>same(a,e))),observed};
 }
 const original=base.nodes.find(n=>n.node_id===b.nodeId),copy=observed.nodes.find(n=>n.type==='gaussian_blur'&&n.node_id!==b.nodeId),pasted=proof.checkpoints.pasted?.observed;
 if(assertion==='pasted'){
  const out=base.edges.filter(e=>e.from_node===b.nodeId),edge=out[0];
  const copyUI=copy&&nodes.find(n=>n.nodeId===copy.node_id);
  const expected=edge&&copy?[...base.edges.filter(e=>e!==edge),{...edge,to_node:copy.node_id,to_slot:'input'},{...edge,from_node:copy.node_id}]:[];
  const matched=!!copy&&out.length===1&&observed.nodes.length===base.nodes.length+1&&base.nodes.every(n=>same(nodeState(n),nodeState(observed.nodes.find(a=>a.node_id===n.node_id))))&&same(copy.params,original.params)&&same(copy.owners,original.owners)&&copy.bypassed===original.bypassed&&observed.edges.length===expected.length&&expected.every(e=>observed.edges.some(a=>same(a,e)))&&nodes.length===2&&!!copyUI&&(copyUI.sceneX!==b.node.sceneX||copyUI.sceneY!==b.node.sceneY);
  return {matched,observed,bindingUpdate:matched?{copyId:copy.node_id,points:{...b.points,select:{x:copyUI.x+copyUI.width*.5,y:copyUI.y+8}}}:null};
 }
 return {matched:same(content(observed),content(assertion==='paste-restored'?pasted:base)),observed};
}
