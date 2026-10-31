import {OutcomeError} from '../runner/engine.mjs';

const requireGeometry=(ok,message)=>{if(!ok)throw new OutcomeError(message,'Blocked');};
function scene(view,graph){
 const owner='clip:'+graph.timeline_id+':'+graph.clip_id;
 requireGeometry(view.class==='RenderGraphView'&&view.graphId===owner&&!view.sceneItemsTruncated&&Array.isArray(view.sceneItems),'Render Graph observation is incomplete or belongs to another clip');
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
// A collapsed authored group exposes a boundary port for its hidden nodes.
// Resolve that projection from the retained edge and group membership, never labels.
export function graphOutputGeometry(view,graph,edge){
 const owner=scene(view,graph);requireGeometry(graph.nodes.some(n=>n.node_id===edge.from_node&&n.owners?.includes(owner))&&graph.edges.some(e=>['from_node','from_slot','to_node','to_slot','type'].every(k=>e[k]===edge[k])),'Source port is not bound to the retained graph edge');
 const groups=(graph.presentation?.groups||[]).filter(g=>g.collapsed&&!g.hidden&&g.members.includes('node:'+edge.from_node));
 requireGeometry(groups.length<=1,'Source node has ambiguous collapsed group membership');
 let node;
 if(groups.length){
  const group=groups[0],members=new Set(group.members),external=graph.edges.filter(e=>members.has('node:'+e.from_node)&&!members.has('node:'+e.to_node));
  requireGeometry(new Set(external.map(e=>JSON.stringify([e.from_node,e.from_slot]))).size===1&&external[0].from_node===edge.from_node&&external[0].from_slot===edge.from_slot,'Collapsed source group does not have one proven output boundary');node=item(view,group.id);
 }else node=item(view,edge.from_node);
 const ports=node.ports?.filter(p=>p.side==='output')||[];requireGeometry(ports.length===1&&Number.isFinite(ports[0].x)&&Number.isFinite(ports[0].y),'Source output port geometry is absent or ambiguous');return ports[0];
}
