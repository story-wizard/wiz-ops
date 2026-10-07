import {requireProof} from './agent-proof.mjs';
import {isDeepStrictEqual} from 'node:util';
import {verifyInspectorEdit} from './checklist-proof.mjs';
import {snapshotState,clips} from '../runner/engine.mjs';
import {verifyTrimmedClip,requireValidSourceTiming} from './check-support.mjs';

const one=(widgets,predicate,message)=>{const found=widgets.filter(predicate);requireProof(found.length===1,'ambiguous_target',message,['observe']);return found[0];};
export async function readQuestionInputs(question,{ui,graph,timeline}){
 // The two domain reads share call.lock. Only Qt/CLI transports may overlap.
 if(question==='inspector-change')return [await graph(),await timeline()];
 const reads=await Promise.allSettled([ui(),question.startsWith('timeline-')?timeline():graph()]);
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
 const pick=g=>({graph_id:g.graph_id,timeline_id:g.timeline_id,clip_id:g.clip_id,nodes:g.nodes?.map(({incoming,outgoing,...n})=>n),edges:g.edges,inputs:g.inputs,outputs:g.outputs});
 const value=g=>{const nodes=g.nodes?.filter(n=>n.node_id===nodeId)||[];return nodes.length===1&&Number.isFinite(nodes[0].params?.[parameter])?nodes[0].params[parameter]:null;};
 const values={nodeId,param:parameter,before:value(beforeGraph),after:value(afterGraph)};
 try{
  requireProof(isDeepStrictEqual(snapshotState(afterTimeline),snapshotState(beforeTimeline)),'unexpected_timeline_change','Inspector edit changed the timeline',['inspect']);
  if(values.before===null||values.after===null)return {matched:false,state,...values,reason:'The declared numeric parameter is absent, ambiguous or nonnumeric'};
  if(state==='restored')return {matched:isDeepStrictEqual(pick(beforeGraph),pick(afterGraph)),state,...values};
  if(!isDeepStrictEqual(beforeGraph.inputs,afterGraph.inputs)||!isDeepStrictEqual(beforeGraph.outputs,afterGraph.outputs))return {matched:false,state,...values,reason:'Inspector edit changed graph inputs or outputs'};
  const result=verifyInspectorEdit(beforeGraph,afterGraph,nodeId,parameter);
  return {matched:result.after>result.before,state,...result};
 }catch(error){if(error.status==='Fail'||error.code==='unexpected_timeline_change')return {matched:false,state,...values,reason:error.message};throw error;}
}
export function timelineClipAnswer(ui,timeline,clipId){
 snapshotState(timeline);
 const item=one(clips(timeline),c=>c.clip_id===clipId,'The declared clip must exist exactly once');
 const canvas=one(ui.widgets,w=>w.class==='TimelineWidget'&&!w.clipIdsTruncated&&w.clipIds?.includes(clipId),'Open one complete canvas displaying the declared clip');
 requireProof(!ui.modalWindow&&!ui.popupWindow&&!ui.mouseGrabber,'desktop_not_ready','Dismiss unexpected overlays before canvas input',['observe']);
 const tabs=ui.widgets.filter(w=>w.name==='panelSubtabSelector'&&w.window===canvas.window&&w.text?.replace(/ \(\d+\)$/,'')===timeline.timeline.name);
 requireProof(tabs.length===1,'wrong_fixture','The declared timeline must be displayed',['observe']);
 return {question:'timeline-clip',clip:item,timeline:timeline.timeline,targets:{canvas:{id:canvas.id},capture:{id:canvas.window}},focus:{canvasFocused:ui.focus===canvas.id,keyWindow:ui.widgets.find(w=>w.id===canvas.window)?.keyWindow===true,focusedControl:ui.focus||null},coordinateSpace:'Clip rectangle and hit points are local to the canvas; physical input refreshes them.'};
}

// Ordinary same-clock right trim: retain the timeline extent and fill the vacated interval.
// Narrow fixture policy; ripple/cross-rate/multiclip procedures need their own contract.
export function rightTrimOutcome(before,after,{clipId,endSeconds,state}){
 snapshotState(before);snapshotState(after);
 const original=clips(before),item=original[0];
 requireProof(original.length===1&&item?.clip_id===clipId&&item.source?.timing==='timed'&&item.speed===1&&item.source.fps===before.timeline.fps&&Number.isFinite(endSeconds)&&endSeconds>item.timeline_range.start_seconds&&endSeconds<item.timeline_range.end_seconds&&['changed','restored'].includes(state),'unsupported_fixture','Use a declared same-clock single-clip right trim',['prepare_fixture']);
 requireValidSourceTiming(item.source);
 const pick=s=>({...snapshotState(s),multicam_catalogs:s.multicam_catalogs});
 if(state==='restored'){
  try{const actual=clips(after);requireProof(actual.length===1,'unexpected_clip_change','Restoration must retain one clip',['inspect']);requireValidSourceTiming(actual[0].source);const expected=structuredClone(before);clips(expected)[0].source.projection_status=actual[0].source.projection_status;return {matched:isDeepStrictEqual(pick(expected),pick(after)),state};}
  catch(error){return {matched:false,state,reason:error.message};}
 }
 try{
  const observed=clips(after);requireProof(observed.length===1,'unexpected_clip_change','The trim must retain exactly one clip',['inspect']);
  const actual=observed[0];verifyTrimmedClip(item,actual,before.timeline.fps);
  const expected=structuredClone(before),target=clips(expected)[0];
  target.timeline_range.end_seconds=endSeconds;
  target.source.source_range.end_seconds=item.source.source_range.end_seconds-(item.timeline_range.end_seconds-endSeconds);
  // Both valid projections describe the asserted physical interval; integrity is checked above.
  target.source.projection_status=actual.source.projection_status;
  const track=expected.tracks.find(t=>t.track_id===item.track_id),index=track.items.findIndex(i=>i.clip_id===clipId),next=track.items[index+1];
  if(next){requireProof(next.kind==='gap'&&next.timeline_range.start_seconds===item.timeline_range.end_seconds,'unsupported_fixture','Only a trailing gap may follow this fixture clip',['prepare_fixture']);next.timeline_range.start_seconds=endSeconds;}
  else track.items.push({kind:'gap',timeline_range:{start_seconds:endSeconds,end_seconds:item.timeline_range.end_seconds}});
  const matched=isDeepStrictEqual(pick(expected),pick(after));
  return {matched,state,...matched?{}:{reason:'Clip, gap or unrelated timeline state differs from the declared ordinary trim'},expected:{timelineEnd:endSeconds,sourceEnd:target.source.source_range.end_seconds,durationSeconds:before.timeline.duration_seconds},sourceRange:actual.source.source_range,timelineRange:actual.timeline_range,projection:actual.source.projection_status,durationSeconds:after.timeline.duration_seconds};
 }catch(error){return {matched:false,state,reason:error.message};}
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
