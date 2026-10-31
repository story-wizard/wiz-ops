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

// Spell cards are QGraphicsRectItems without an exported identity getter.
// Bind the live registry's authored node position to exactly one scene card;
// labels, item order and port counts do not identify a node.
export function spellNodeGeometry(view,overview,raw,nodeRef){
 requireGeometry(view.class==='DetachedGraphView'&&!view.sceneItemsTruncated&&Array.isArray(view.sceneItems)&&overview.document_id===raw.document_id&&overview.document_fingerprint===raw.document_fingerprint&&raw.state_source==='live_registry','Spell observations are incomplete or from different document revisions');
 const nodes=overview.nodes?.filter(n=>n.node_ref===nodeRef)||[];requireGeometry(nodes.length===1,'Spell node identity is absent or ambiguous');
 const node=nodes[0],key=nodeRef.startsWith('source:')?'sentinel:'+nodeRef.slice(7):Number.isSafeInteger(node.node_id)?'node:'+node.node_id:null;
 const point=raw.scene?.graph_layout?.positions?.[key];requireGeometry(Array.isArray(point)&&point.length===2&&point.every(Number.isFinite),'Authored Spell node position is unavailable');
 const matches=view.sceneItems.filter(n=>Math.abs(n.sceneX-point[0])<.01&&Math.abs(n.sceneY-point[1])<.01);
 requireGeometry(matches.length===1&&matches[0].width>0&&matches[0].height>0,'Authored Spell position is absent or overlaps another card');return matches[0];
}

// Mapped from the card's own scene coordinates, so zoom does not turn a
// header click into a parameter-body click. Native input still checks clipping.
export function graphNodeHeaderPoint(node){
 const p=node.headerPoint;
 requireGeometry(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=node.x&&p.x<node.x+node.width&&p.y>=node.y&&p.y<node.y+node.height,'Owned graph card header geometry is unavailable');
 return {x:p.x,y:p.y};
}
