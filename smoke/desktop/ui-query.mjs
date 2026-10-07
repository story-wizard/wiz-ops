import {requireProof} from './agent-proof.mjs';
import {isDeepStrictEqual} from 'node:util';

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
 return {question:'media-search',scope:scoped.scope,targets:{field:{id:field.id},status:status?{id:status.id}:null,view:{id:view.id},viewport:{id:view.viewport}},query:field.text,status:status?.text||null,
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
