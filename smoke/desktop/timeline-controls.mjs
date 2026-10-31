import {OutcomeError} from '../runner/engine.mjs';
import {clipPoint} from './physical-input.mjs';

export function timelineToggle(ui,view,kind){
 const name={linked:'timelineLinkedSelectionAction',snap:'timelineSnapAction'}[kind];
 const rows=(ui.actions||[]).filter(a=>a.name===name&&a.owner===view.timelinePanel&&a.checkable&&a.enabled);
 if(rows.length!==1)throw new OutcomeError('Observe one enabled '+kind+' action in the owned Timeline panel.','Blocked');
 return rows[0];
}
export function timelineToolActive(ui,view,label){
 const tool={Cut:'cut',Slip:'slip',Anchor:'anchor',Tether:'anchor',Select:'select'}[label];
 if(!tool)return false;
 const buttons=(ui.widgets||[]).filter(w=>w.window===view.window&&w.checked===true&&w.enabled&&
  (w.name?.startsWith('toolbarTool_')?new RegExp('^toolbarTool_(?:wiz\\.)?timeline_'+tool+'$').test(w.name):w.name==='panelChromeAction'&&w.text===label));
 return buttons.length===1;
}
export async function timelineClipPoint(native,view,clipId,part='body'){
 if(view.class!=='TimelineWidget'||view.clipIdsTruncated||!view.clipIds?.includes(clipId))throw new OutcomeError('The clip is absent from the observed Timeline canvas.','Blocked');
 return clipPoint(await native('timeline-clip-rect',{target:view.id,clipId}),part);
}
export async function selectTimelineClip(native,view,clipId,{emptyTimelineTime}={}){
 await native('key',{target:view.id,key:'V'});
 if(emptyTimelineTime!==undefined){
  if(!Number.isFinite(emptyTimelineTime)||emptyTimelineTime<0)throw new OutcomeError('Use a fixture-proven empty timeline time to clear selection.','Blocked');
  const {point}=await native('timeline-point',{target:view.id,trackIndex:0,timeSeconds:emptyTimelineTime});await native('click',{target:view.id,x:point.x,y:point.y});
 }
 await native('click',{target:view.id,...await timelineClipPoint(native,view,clipId)});
}

export function trackHeaderPoint(geometry,control){
 const {width,rowTop,rowHeight,kind}=geometry;
 if(!['lock','target'].includes(control)||!['video','audio'].includes(kind)||![width,rowTop,rowHeight].every(Number.isFinite)||rowHeight<=0)throw new OutcomeError('Observe a complete owned track header.','Blocked');
 // Reviewed native header layouts. Row placement and height come from the
 // packaged painter; unknown layouts need discovery before pointer input.
 if(width===145){
  const named=rowHeight>=46;
  return control==='target'?{x:width-16,y:rowTop+(named?16:rowHeight/2)}:
   {x:named?21:width-27-(kind==='video'?3:4)*18+9,y:rowTop+(named?Math.min(34,rowHeight-20)+9:rowHeight/2)};
 }
 if(width===120&&rowHeight===60)return {x:control==='lock'?55:22,y:rowTop+15};
 throw new OutcomeError('The native track-header layout needs a reviewed binding.','Blocked');
}
