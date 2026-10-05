import {assert,same} from '../runner/engine.mjs';
export function verifyGradeIsolation(before,after,prefix){
 assert(Array.isArray(before.nodes)&&Array.isArray(after.nodes)&&Array.isArray(before.edges)&&Array.isArray(after.edges),'Incomplete grade graph');
 const ids=new Set(before.nodes.map(n=>n.node_id));assert(before.nodes.every(n=>after.nodes.some(a=>a.node_id===n.node_id&&a.type===n.type)),'A grade gesture removed or replaced a source node');
 let changes=[];
 for(const a of after.nodes){const b=before.nodes.find(n=>n.node_id===a.node_id);
  if(!b){assert(Object.keys(a.params||{}).some(k=>k.startsWith(prefix)),'Unrelated node created');continue;}
  for(const key of new Set([...Object.keys(b.params||{}),...Object.keys(a.params||{})]))if(JSON.stringify(b.params?.[key])!==JSON.stringify(a.params?.[key])){assert(key.startsWith(prefix),'Unrelated parameter changed: '+key);changes.push({nodeId:a.node_id,key,before:b.params?.[key]??null,after:a.params?.[key]??null});}
 }
 if(after.nodes.some(n=>!ids.has(n.node_id)))changes.push({created:after.nodes.filter(n=>!ids.has(n.node_id)).map(n=>n.node_id)});
 assert(changes.length>0,'Grade gesture made no semantic change');
 // Existing edges may be split when the app inserts its grade group. Endpoints
 // must stay bound to real nodes; full Undo is checked against the baseline.
 assert(after.edges.every(e=>after.nodes.some(n=>n.node_id===e.from_node)&&after.nodes.some(n=>n.node_id===e.to_node)),'Grade graph has dangling wiring');
 if(after.nodes.every(n=>ids.has(n.node_id)))same(after.edges,before.edges,'A value-only grade edit preserves wiring');
 return {changes};
}
export function verifySearchIdentity(rows,expectedId){assert(rows.length>0&&rows.some(r=>r.id===expectedId),'Search did not return the newly imported asset');assert(rows.every(r=>typeof r.id==='string'&&r.id),'Search identities are missing');return {assetId:expectedId,matches:rows.length};}
export function verifyMeterSamples(quiet,active,decayed){
 const finite=v=>Number.isFinite(v)&&v>=0&&v<=1;assert([quiet,...active,...decayed].every(finite),'Invalid meter observations');
 assert(active.length>=3&&decayed.length>=3&&active.filter(v=>v>quiet+.01).length>=3,'Meter did not respond repeatedly to known audio');
 assert(decayed.slice(-3).every(v=>v<Math.max(...active)*.3+.005),'Meter did not decay after pause');return {quiet,peak:Math.max(...active),final:decayed.at(-1)};
}
export function verifyRestoredGraph(before,after){same({nodes:after.nodes,edges:after.edges},{nodes:before.nodes,edges:before.edges},'Physical Undo restores the entire clip graph');}
