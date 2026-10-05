import {assert,same} from '../runner/engine.mjs';
import {OutcomeError} from '../runner/engine.mjs';

export function observedWidget(ui,predicate,description){
 const matches=ui.widgets.filter(predicate);
 if(matches.length!==1)throw new OutcomeError(description+' is absent or ambiguous; inspect and update its binding','Blocked');
 const widget=matches[0];
 if(widget.sceneItemsTruncated||widget.sceneTextTruncated||widget.menuTruncated||widget.rows>(widget.model?.length||0))
  throw new OutcomeError(description+' observation is incomplete; narrow the fixture or extend inspection','Blocked');
 return widget;
}

// Sample the image interior, excluding preview borders and transport chrome.
export function previewCenterBrightness(image){
 assert(image.sampleWidth===64&&image.sampleHeight===32&&typeof image.sampleRgb==='string','Invalid preview raster');
 const bytes=Buffer.from(image.sampleRgb,'base64');assert(bytes.length===64*32*3,'Incomplete preview pixels');
 let total=0,count=0;
 for(let y=8;y<24;y++)for(let x=16;x<48;x++)for(let c=0;c<3;c++){total+=bytes[(y*64+x)*3+c];count++;}
 return total/count;
}

// Incidence lists are derived from the independently compared edge list.
const nodeState=node=>{const {incoming,outgoing,...state}=node;return state;};
export function verifyInspectorEdit(before,after,nodeId,param){
 assert(before.graph_id===after.graph_id&&before.timeline_id===after.timeline_id&&before.clip_id===after.clip_id,'Inspector changed graph ownership');
 const old=before.nodes.find(n=>n.node_id===nodeId),changed=after.nodes.find(n=>n.node_id===nodeId);
 assert(old&&changed&&Number.isFinite(old.params[param])&&Number.isFinite(changed.params[param])&&old.params[param]!==changed.params[param],'Inspector did not change the intended numeric parameter');
 const expected=before.nodes.map(n=>n.node_id===nodeId?{...n,params:{...n.params,[param]:changed.params[param]}}:n);
 same(after.nodes.map(nodeState),expected.map(nodeState),'Inspector preserves other nodes and parameters');
 same(after.edges,before.edges,'Inspector preserves wiring');
 return {nodeId,param,before:old.params[param],after:changed.params[param]};
}

export function verifyMaskPaste(before,after,sourceId){
 assert(before.graph_id===after.graph_id&&before.timeline_id===after.timeline_id&&before.clip_id===after.clip_id,'Mask paste changed graph ownership');
 const source=before.nodes.find(n=>n.node_id===sourceId);
 assert(source?.type==='rectangle','Mask fixture requires a rectangle');
 const added=after.nodes.filter(n=>!before.nodes.some(b=>b.node_id===n.node_id));
 assert(added.length===1&&after.nodes.length===before.nodes.length+1,'Paste must create exactly one independent mask');
 const copy=added[0],owner='clip:'+before.timeline_id+':'+before.clip_id;
 assert(copy.type===source.type&&copy.bypassed===source.bypassed&&copy.owners?.includes(owner),'Pasted mask type, bypass or owner is incorrect');
 same(copy.params,source.params,'Pasted mask parameters');
 for(const node of before.nodes)same(nodeState(after.nodes.find(n=>n.node_id===node.node_id)),nodeState(node),'Paste preserves every original node');
 same(after.edges,before.edges,'Unused mask copy preserves existing wiring');
 return {sourceId,copyId:copy.node_id};
}

export function verifySearchFocus(observations,expected,excluded){
 assert(observations.length>=3&&new Set(observations.map(o=>o.timelineId)).size===2,'Search requires two timeline focuses and a return');
 for(const o of observations){
  assert(o.query===expected.query&&!/searching|pending|loading|unavailable/i.test(o.status||''),'Search is unfinished or unavailable');
  assert(o.names.includes(expected.name)&&!o.names.includes(excluded),'Focused search lost its project match or retained a nonmatching control');
  same(o.names,observations[0].names,'Search result set is independent of timeline focus');
 }
 return {focuses:observations.map(o=>o.timelineId),results:observations[0].names};
}
