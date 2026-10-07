import {requireProof} from './agent-proof.mjs';
import {isDeepStrictEqual} from 'node:util';
import {verifyInspectorEdit} from './checklist-proof.mjs';
import {snapshotState,clips} from '../runner/engine.mjs';

const one=(widgets,predicate,message)=>{const found=widgets.filter(predicate);requireProof(found.length===1,'ambiguous_target',message,['observe']);return found[0];};
export async function readQuestionInputs(question,{ui,graph,timeline}){
 // The two domain reads share call.lock. Only Qt/CLI transports may overlap.
 if(question==='inspector-change')return [await graph(),await timeline()];
 const reads=await Promise.allSettled([ui(),question==='timeline-clip'?timeline():graph()]);
 for(const read of reads)if(read.status==='rejected')throw read.reason;
 return reads.map(r=>r.value);
}
export function inspectorRowBinding(row){
 const key=row.inspectorInteractionKey;
 requireProof(row.inspectorBindingIncomplete===false&&typeof key==='string'&&key.length<=4096,'wrong_inspector_binding','Inspector row identity is unavailable',['observe']);
 // Qualify the two retained app encodings; unknown versions stop before input.
 if(key.includes('\u001f')){const parts=key.split('\u001f');requireProof(parts.length===4&&parts[0]==='render.graph_node'&&parts[1]===row.paramPath,'wrong_inspector_binding','Unsupported Inspector row identity',['observe']);const ids=Object.fromEntries(parts.slice(2).map(p=>{const i=p.indexOf('=');return [p.slice(0,i),p.slice(i+1)];}));requireProof(Object.keys(ids).length===2&&ids.graph_id&&ids.node_id,'wrong_inspector_binding','Ambiguous Inspector row identity',['observe']);return {owner:parts[0],parameter:parts[1],ids};}
 const parse=text=>{const parts=[];let offset=0;while(offset<text.length){const match=/^(0|[1-9][0-9]{0,3}):/.exec(text.slice(offset));requireProof(match&&parts.length<16,'wrong_inspector_binding','Malformed Inspector row identity',['observe']);const size=Number(match[1]);offset+=match[0].length;requireProof(size<=4096&&offset+size<=text.length,'wrong_inspector_binding','Truncated Inspector row identity',['observe']);parts.push(text.slice(offset,offset+size));offset+=size;}return parts;};
 const interaction=parse(key);requireProof(interaction.length===3&&interaction[0]==='interaction-v1'&&interaction[2]===row.paramPath,'wrong_inspector_binding','Unsupported Inspector interaction version',['observe']);
 const instance=parse(interaction[1]);requireProof(instance.length===3&&instance[0]==='instance-v1'&&instance[2]==='render.graph_node','wrong_inspector_binding','Unsupported Inspector instance version',['observe']);
 const target=parse(instance[1]);requireProof(target.length===11&&target[0]==='target-v1'&&target[1]==='graph_node'&&target[2]==='wiz.render','wrong_inspector_binding','Unsupported Inspector target version',['observe']);
 const ids={};for(let i=3;i<target.length;i+=2){requireProof(['timeline_id','clip_id','graph_id','node_id'].includes(target[i])&&!Object.hasOwn(ids,target[i])&&target[i+1].length>0,'wrong_inspector_binding','Ambiguous Inspector target identity',['observe']);ids[target[i]]=target[i+1];}
 return {owner:instance[2],parameter:interaction[2],ids};
}
export function inspectorParameterAnswer(ui,graph,{nodeId,parameter,label}){
 requireProof(!ui.modalWindow&&!ui.popupWindow&&!ui.mouseGrabber,'desktop_not_ready','Dismiss unexpected overlays before Inspector input',['observe']);
 const owner='clip:'+graph.timeline_id+':'+graph.clip_id;
 const view=one(ui.widgets,w=>w.class==='RenderGraphView'&&w.graphId===owner&&w.timelineId===graph.timeline_id,'Open the declared clip graph');
 const selected=view.sceneItems?.filter(n=>n.selected)||[];
 requireProof(!view.sceneItemsTruncated&&selected.length===1&&selected[0].nodeId===nodeId,'wrong_selection','Select exactly the declared graph node',['observe']);
 const node=one(graph.nodes,n=>n.node_id===nodeId,'The declared node must exist exactly once');
 requireProof(Number.isFinite(node.params?.[parameter]),'unsupported_parameter','Use a numeric graph parameter',['schema']);
 const panel=withinWidgets(ui,{class:'InspectorPanel'});
 const field=one(panel.widgets,w=>w.name==='InspectorParamLabel'&&w.text===label,'The Inspector label must be unique');
 const row=withinWidgets(ui,{id:field.parent});
 const binding=inspectorRowBinding(row.widgets.find(w=>w.id===row.scope));
 requireProof(binding.parameter===parameter&&binding.ids.graph_id===owner&&binding.ids.node_id===nodeId&&(binding.ids.timeline_id===undefined||binding.ids.timeline_id===graph.timeline_id)&&(binding.ids.clip_id===undefined||binding.ids.clip_id===graph.clip_id),'wrong_inspector_binding','The Inspector mutation row must identify the declared clip, node and parameter',['observe']);
 const control=one(row.widgets,w=>w.name==='InspectorSliderControl'&&w.window===field.window&&Math.abs(w.y-field.y)<5&&w.enabled,'The Inspector row must have one enabled slider');
 requireProof(Array.isArray(control.handle)&&control.handle.length===2&&control.handle.every(Number.isFinite),'missing_geometry','The slider must expose its current styled thumb',['observe']);
 const canvas=one(ui.widgets,w=>w.class==='TimelineWidget'&&!w.clipIdsTruncated&&w.clipIds?.includes(graph.clip_id),'The declared clip must have one visible canvas');
 return {question:'inspector-parameter',graphId:graph.graph_id,owner,nodeId,parameter,label,value:node.params[parameter],control:{id:control.id,window:control.window,value:control.value,handle:control.handle,focused:ui.focus===control.id},targets:{control:{id:control.id},canvas:{id:canvas.id},capture:{id:canvas.window},inspector:{id:field.window}},graph};
}
export function inspectorOutcome(beforeGraph,afterGraph,beforeTimeline,afterTimeline,{nodeId,parameter,state}){
 const pick=g=>({graph_id:g.graph_id,timeline_id:g.timeline_id,clip_id:g.clip_id,nodes:g.nodes?.map(({incoming,outgoing,...n})=>n),edges:g.edges});
 try{
  requireProof(isDeepStrictEqual(snapshotState(afterTimeline),snapshotState(beforeTimeline)),'unexpected_timeline_change','Inspector edit changed the timeline',['inspect']);
  if(state==='restored')return {matched:isDeepStrictEqual(pick(beforeGraph),pick(afterGraph)),state};
  const result=verifyInspectorEdit(beforeGraph,afterGraph,nodeId,parameter);
  return {matched:result.after>result.before,state,...result};
 }catch(error){if(error.status==='Fail'||error.code==='unexpected_timeline_change')return {matched:false,state,reason:error.message};throw error;}
}
export function timelineClipAnswer(ui,timeline,clipId){
 snapshotState(timeline);
 const item=one(clips(timeline),c=>c.clip_id===clipId,'The declared clip must exist exactly once');
 const canvas=one(ui.widgets,w=>w.class==='TimelineWidget'&&!w.clipIdsTruncated&&w.clipIds?.includes(clipId),'Open one complete canvas displaying the declared clip');
 requireProof(!ui.modalWindow&&!ui.popupWindow&&!ui.mouseGrabber,'desktop_not_ready','Dismiss unexpected overlays before canvas input',['observe']);
 const tabs=ui.widgets.filter(w=>w.name==='panelSubtabSelector'&&w.window===canvas.window&&w.text?.replace(/ \(\d+\)$/,'')===timeline.timeline.name);
 requireProof(tabs.length===1,'wrong_fixture','The declared timeline must be displayed',['observe']);
 return {question:'timeline-clip',clip:item,timeline:timeline.timeline,targets:{canvas:{id:canvas.id},capture:{id:canvas.window}},coordinateSpace:'Clip rectangle and hit points are local to the canvas; physical input refreshes them.'};
}

// Snapshot-local parent edges only. Never cache IDs or geometry across observations.
export function withinWidgets(ui,within){
 const widgets=ui.widgets||[],matches=widgets.filter(w=>Object.entries(within).every(([k,v])=>w[k]===v));
 requireProof(matches.length===1,'ambiguous_scope','The scope must identify exactly one visible widget',['observe']);
 const scope=matches[0],byId=new Map(widgets.map(w=>[w.id,w]));
 return {...ui,scope:scope.id,widgets:widgets.filter(w=>{
  const visited=new Set();
  while(w&&!visited.has(w.id)){if(w.id===scope.id)return true;visited.add(w.id);w=byId.get(w.parent);}return false;
 })};
}
export function mediaSearchAnswer(ui){
 const scoped=withinWidgets(ui,{class:'MediaPanel'}),one=predicate=>{
  const matches=scoped.widgets.filter(predicate);requireProof(matches.length===1,'ambiguous_target','Media search needs one field, status and result view',['observe']);return matches[0];
 };
 const field=one(w=>w.class==='MediaSearchField'),view=one(w=>w.class==='QTreeView'),statuses=scoped.widgets.filter(w=>w.name==='mediaSearchStatus');
 requireProof(statuses.length===1||statuses.length===0&&field.text==='','ambiguous_target','An active search needs one visible status label',['observe']);
 const status=statuses[0];
 const complete=Number.isInteger(view.rows)&&view.rows===(view.model?.length??-1);
 const nameModes=(ui.actions||[]).filter(a=>a.text==='Name'&&a.checkable===true&&a.checked===true&&a.enabled===true);
 return {question:'media-search',scope:scoped.scope,targets:{field:{id:field.id},status:status?{id:status.id}:null,view:{id:view.id},viewport:{id:view.viewport}},query:field.text,status:status?.text||null,
  searchMode:nameModes.length===1?'Name':'unknown',
  pending:/searching|pending|loading/i.test(status?.text||''),error:/error|failed|unavailable/i.test(status?.text||''),
  names:view.model?.map(row=>row[0])||[],selectedRows:view.selectedRows||[],rows:view.rows,inspectionIncomplete:!complete,
  timelineCanvases:(ui.widgets||[]).filter(w=>w.class==='TimelineWidget').map(w=>Object.fromEntries(['id','window','x','y','width','height','clipIds','clipIdsTruncated'].map(k=>[k,w[k]]))),
  timelineTabs:(ui.widgets||[]).filter(w=>w.name==='panelSubtabSelector').map(w=>({text:w.text,window:w.window})),
  ...complete?{model:view.model,itemRects:view.itemRects}: {},
  modalWindow:ui.modalWindow||null,popupWindow:ui.popupWindow||null,mouseGrabber:ui.mouseGrabber||null};
}
export function formatDialogAnswer(ui){
 const modal=ui.widgets?.find(w=>w.id===ui.modalWindow);
 if(!modal)return {question:'format-dialog',state:ui.modalWindow||ui.popupWindow||ui.mouseGrabber?'unexpected':'none'};
 const controls=ui.widgets.filter(w=>w.window===modal.id),labels=controls.filter(w=>w.class==='QLabel').map(w=>w.text),buttons=controls.filter(w=>w.class==='QPushButton');
 const expected=["This timeline is empty. Use the source clip's settings?","You can adopt the clip's frame rate and format, or keep the current timeline settings."];
 const keep=buttons.filter(w=>w.text==='Keep Timeline Settings'&&w.enabled),adopt=buttons.filter(w=>w.text==='Use Clip Settings'&&w.enabled);
 const known=modal.class==='QMessageBox'&&labels.length===expected.length&&expected.every(t=>labels.includes(t))&&buttons.length===2&&keep.length===1&&adopt.length===1&&!ui.popupWindow;
 return {question:'format-dialog',state:known?'format-mismatch':'unexpected',dialogs:[{id:modal.id}],matches:known?[{id:keep[0].id}]:[],labels,buttons:buttons.map(w=>({id:w.id,text:w.text,enabled:w.enabled}))};
}
// Narrow authored oracle: one clip onto V1 of an empty timeline, then exact Undo.
export function mediaInsertionOutcome(before,after,{assetId,durationSeconds,state}){
 requireProof(before.timeline?.duration_seconds===0&&before.tracks?.length===2&&before.tracks[0].address==='V1'&&before.tracks[1].address==='A1'&&before.tracks.every(t=>t.items?.length===0&&!t.locked&&t.enabled)&&before.next_cursor==null,'unsupported_fixture','This procedure requires an empty unlocked V1/A1 timeline',['prepare_fixture']);
 const pick=value=>Object.fromEntries(['timeline','tracks','links','multicam_catalogs'].map(k=>[k,value[k]]));
 if(state==='restored')return {matched:after.next_cursor==null&&isDeepStrictEqual(pick(after),pick(before)),state};
 const clips=after.tracks?.flatMap(t=>(t.items||[]).filter(i=>i.kind==='clip'))||[],clip=clips[0];
 const range={start_seconds:0,end_seconds:durationSeconds},video=after.tracks?.[0],audio=after.tracks?.[1];
 const shape=after.next_cursor==null&&after.timeline?.duration_seconds===durationSeconds&&after.tracks?.length===2&&video.items?.length===1&&audio.items?.length===1&&audio.items[0].kind==='gap'&&isDeepStrictEqual(audio.items[0].timeline_range,range);
 const placement=clips.length===1&&clip?.source?.asset_id===assetId&&clip.track_id===before.tracks[0].track_id&&clip.enabled===true&&clip.speed===1&&clip.link_group===null&&clip.multicam===null&&isDeepStrictEqual(clip.timeline_range,range)&&isDeepStrictEqual(clip.source.source_range,range);
 const normalized=pick(after);
 if(shape){normalized.timeline={...after.timeline,duration_seconds:0};normalized.tracks=after.tracks.map(t=>({...t,items:[],has_placed_items:false}));}
 return {matched:Boolean(shape&&placement&&isDeepStrictEqual(normalized,pick(before))),state,assetId:clip?.source?.asset_id||null,clipId:clip?.clip_id||null,durationSeconds:after.timeline?.duration_seconds};
}
