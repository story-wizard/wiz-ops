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

// New media search publishes separate authored lanes beside the ordinary bin.
// A named lane must stay unique; legacy builds still require one complete tree.
export function searchResultView(ui,source='Name'){
 const name=source==='Name'?'mediaNameSearchResults':'mediaSemanticSearchResults';
 const named=ui.widgets.some(w=>w.name===name),split=ui.widgets.some(w=>w.name==='mediaSearchSectionsSplitter');
 const byId=new Map(ui.widgets.map(w=>[w.id,w]));
 const ancestors=widget=>{const chain=[],seen=new Set();for(let w=widget;w&&!seen.has(w.id);w=byId.get(w.parent)){chain.push(w);seen.add(w.id);}return chain;};
 let section;
 if(split&&!named){
  const heading=observedWidget(ui,w=>w.name===(source==='Name'?'mediaNameSearchHeading':'mediaSemanticSearchHeading'),'Media '+source+' result heading');
  const chain=ancestors(heading),index=chain.findIndex(w=>w.name==='mediaSearchSectionsSplitter');
  if(index>0)section=chain[index-1].id;
 }
 return observedWidget(ui,w=>w.class==='QTreeView'&&Array.isArray(w.model)&&(named?w.name===name:split?!!section&&ancestors(w).some(p=>p.id===section):true),'Media '+source+' search results');
}

export function searchObservation(ui,source='Name'){
 const globalStatus=observedWidget(ui,w=>w.name==='mediaSearchStatus','Search status').text||'';
 if(source==='Name'&&ui.widgets.some(w=>w.name==='mediaSearchSectionsSplitter')){
  const heading=observedWidget(ui,w=>w.name==='mediaNameSearchHeading','Filename result heading'),match=(heading.text||'').match(/(?:·|:)\s*(\d+)\s*$/);
  if(!match)throw new OutcomeError('Filename result count is unfinished or unavailable','Blocked');
  const count=Number(match[1]),hasView=ui.widgets.some(w=>w.name==='mediaNameSearchResults');
  // A completed zero lane hides its tree. Retain the actual heading as the
  // screenshot target; never invent a model read for an absent view.
  const view=count===0&&!hasView?heading:searchResultView(ui,source),names=Array.isArray(view.model)?view.model.map(r=>r[0]):[];
  if(names.length!==count)throw new OutcomeError('Filename result count and observed model disagree','Blocked');
  return {view,names,status:heading.text,globalStatus,completion:{source:'Name',count,headingId:heading.id}};
 }
 const view=searchResultView(ui,source);return {view,names:view.model.map(r=>r[0]),status:globalStatus,globalStatus};
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
// A reviewed linked control can own several fields; every other value stays exact.
export function verifyInspectorEdit(before,after,nodeId,param){
 assert(before.graph_id===after.graph_id&&before.timeline_id===after.timeline_id&&before.clip_id===after.clip_id,'Inspector changed graph ownership');
 const old=before.nodes.find(n=>n.node_id===nodeId),changed=after.nodes.find(n=>n.node_id===nodeId),fields=Array.isArray(param)?param:[param];
 assert(fields.length>0&&new Set(fields).size===fields.length&&old&&changed&&fields.every(p=>Number.isFinite(old.params[p])&&Number.isFinite(changed.params[p])&&old.params[p]!==changed.params[p]),'Inspector did not change the intended numeric parameter');
 const edited=Object.fromEntries(fields.map(p=>[p,changed.params[p]]));
 const expected=before.nodes.map(n=>n.node_id===nodeId?{...n,params:{...n.params,...edited}}:n);
 same(after.nodes.map(nodeState),expected.map(nodeState),'Inspector preserves other nodes and parameters');
 same(after.edges,before.edges,'Inspector preserves wiring');
 return {nodeId,param,before:Array.isArray(param)?Object.fromEntries(fields.map(p=>[p,old.params[p]])):old.params[param],after:Array.isArray(param)?edited:changed.params[param]};
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
