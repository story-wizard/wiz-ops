import {isDeepStrictEqual} from 'node:util';
import {assert,clips,snapshotState,OutcomeError} from '../runner/engine.mjs';
import {verifyEmptySearch,verifyLargePaste,verifyNudgeState,verifyDisplayedClips} from './volume-proof.mjs';
const unchanged=(a,b)=>assert(isDeepStrictEqual(snapshotState(a),snapshotState(b)),'The frozen timeline changed');
const unique=(ui,fn)=>{const rows=ui.widgets.filter(fn);if(rows.length!==1)throw new OutcomeError('The test surface is absent or ambiguous','Blocked');return rows[0];};
export function volumeCheckpoint(proof,assertion,observed,ui,session){
 const id=proof.definition.id,baseline=assertion==='baseline',destination=id==='D-CLIPBOARD-LARGE'&&!baseline&&assertion!=='copied'&&assertion!=='resolve-unchanged';
 const view=unique(ui,w=>w.id===(session.proofTarget||(destination?proof.binding?.destinationTarget:proof.binding?.target)));
 assert(view.class==='TimelineWidget','Bind the visible timeline');
 const timeline=observed.timeline,items=clips(timeline);snapshotState(timeline);
 if(baseline){
  const binding={target:view.id,window:view.window,timelineId:timeline.timeline.timeline_id,readParams:session.proofRead,points:{}};
  if(id==='D-HISTORY-50'){
   assert(items.length===1&&items[0].source.asset_id===session.assets.plate&&items[0].timeline_range.start_seconds===1&&items[0].timeline_range.end_seconds===3&&timeline.timeline.name==='Long history seed 50','Prepare the declared history fixture');binding.clipId=items[0].clip_id;
  }else if(id==='D-SEARCH-EMPTY'){
   const field=unique(ui,w=>w.class==='MediaSearchField'),bin=unique(ui,w=>w.class==='QTreeView'&&Array.isArray(w.model));
   assert(ui.actions?.filter(a=>/^Name(?:\t\d+)?$/.test(a.text)&&a.checked).length===1,'Select Name search before baseline');
   binding.search=field.id;binding.captureTarget=bin.id;binding.missing='athanor_missing_'+session.harnessId;
  }else{
   assert(items.length===100&&items.every(c=>c.source.asset_id===session.assets.plate),'Prepare one hundred plate clips');
   assert(observed.empty&&clips(observed.empty).length===0&&observed.empty.timeline.timeline_id!==binding.timelineId,'Prepare an independent empty destination');
   verifyDisplayedClips(view,timeline);binding.destinationId=observed.empty.timeline.timeline_id;
   const name=observed.empty.timeline.name,bin=unique(ui,w=>w.class==='QTreeView'&&w.model?.filter(r=>r[0]===name).length===1),row=bin.model.findIndex(r=>r[0]===name),rect=bin.itemRects.find(r=>r.row===row);
   assert(rect&&rect.y>=0&&rect.height>0,'Reveal the destination row before baseline');
   binding.binViewport=bin.viewport;binding.media=bin.id;binding.points['destination-click']={x:rect.x+Math.min(70,rect.width/2),y:rect.y+rect.height/2};binding.points['destination-open']={...binding.points['destination-click']};
  }
  return {matched:true,binding,observed};
 }
 const base=proof.baseline;
 if(assertion==='resolve-unchanged')return {matched:isDeepStrictEqual(observed,proof.lastObserved||base),observed};
 if(id==='D-HISTORY-50'){
  const point=proof.contract.checkpoints.find(p=>p.id===assertion);verifyNudgeState(base.timeline,timeline,proof.binding.clipId,point.frame);verifyDisplayedClips(view,timeline);
 }else if(id==='D-SEARCH-EMPTY'){
  unchanged(base.timeline,timeline);const field=unique(ui,w=>w.id===proof.binding.search),bin=unique(ui,w=>w.id===proof.binding.captureTarget),status=unique(ui,w=>w.name==='mediaSearchStatus').text||'';
  const result={query:field.text,status,names:bin.model.map(r=>r[0]).sort()};
  assert(!bin.modelTruncated&&bin.rows===bin.model.length&&!/searching|pending|loading|unavailable|error/i.test(status),'Search is incomplete or unavailable');
  if(assertion==='positive')assert(result.query==='pattern_24'&&result.names.includes('pattern_24.mov'),'Known filename did not match');
  else{const positive=proof.checkpoints.positive.observedUI;verifyEmptySearch(positive,assertion==='missing'?result:proof.checkpoints.missing.observedUI,assertion==='missing'?positive:result,{query:proof.binding.missing,name:'pattern_24.mov'});}
  return {matched:true,observed,observedUI:result,captureTarget:bin.id};
 }else{
  unchanged(base.timeline,observed.source);
  if(assertion==='destination'){
   unchanged(base.empty,timeline);assert(view.window===proof.binding.window,'Destination belongs to another window');
   const name=base.empty.timeline.name;assert(ui.widgets.some(w=>w.name==='panelSubtabSelector'&&w.window===view.window&&(w.text===name||w.text?.startsWith(name+' ('))),'The prepared destination tab is not open');
   verifyDisplayedClips(view,base.empty);return {matched:true,observed,captureTarget:view.id,bindingUpdate:{destinationTarget:view.id}};
  }
  if(assertion==='copied'){unchanged(base.timeline,timeline);assert(observed.clipboard?.formats?.includes('application/x-wizard-timeline-clips'),'Copy has no timeline payload');}
  else if(assertion==='undone')unchanged(base.empty,timeline);
  else{verifyLargePaste(base.timeline,base.empty,timeline);if(assertion==='redone')unchanged(proof.checkpoints.pasted.observed.timeline,timeline);}
  verifyDisplayedClips(view,timeline);
 }
 return {matched:true,observed,captureTarget:view.id};
}
