import {OutcomeError} from '../runner/engine.mjs';

const requireGeometry=(ok,message)=>{if(!ok)throw new OutcomeError(message,'Blocked');};
function scene(view,graph){
 const owner='clip:'+graph.timeline_id+':'+graph.clip_id;
 requireGeometry(view.class==='RenderGraphView'&&(view.graphId===owner||typeof graph.graph_id==='string'&&graph.graph_id.length>0&&view.graphId===graph.graph_id)&&view.timelineId===graph.timeline_id&&!view.sceneItemsTruncated&&Array.isArray(view.sceneItems),'Render Graph observation is incomplete or belongs to another clip');
 return owner;
}
function item(view,id){
 const found=view.sceneItems.filter(n=>n.nodeId===id);
 requireGeometry(found.length===1,'Exact graph node geometry is absent or ambiguous: '+id);
 const node=found[0];requireGeometry(['x','y','width','height'].every(k=>Number.isFinite(node[k]))&&node.width>0&&node.height>0,'Graph node geometry is unusable');return node;
}
export function graphNodeGeometry(view,graph,nodeId){
 const owner=scene(view,graph),nodes=graph.nodes.filter(n=>n.node_id===nodeId);
 requireGeometry(nodes.length===1&&nodes[0].owners?.includes(owner),'Node does not belong to the observed clip graph');return item(view,nodeId);
}
export function graphGroupGeometry(view,graph,groupId){
 scene(view,graph);const groups=(graph.presentation?.groups||[]).filter(g=>g.id===groupId&&!g.hidden);
 requireGeometry(groups.length===1,'Displayed graph group identity is absent or ambiguous');return item(view,groupId);
}
function outputPort(node){const ports=node.ports?.filter(p=>p.side==='output')||[];requireGeometry(ports.length===1&&Number.isFinite(ports[0].x)&&Number.isFinite(ports[0].y),'Source output port geometry is absent or ambiguous');return ports[0];}
export function graphNodeOutputGeometry(view,graph,nodeId){return outputPort(graphNodeGeometry(view,graph,nodeId));}
