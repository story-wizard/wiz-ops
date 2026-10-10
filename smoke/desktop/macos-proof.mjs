import {assert} from '../runner/engine.mjs';

export function workspaceItem(observation,name){
 assert(observation.complete===true&&Array.isArray(observation.items),'Workspace observation is incomplete');
 const found=observation.items.filter(w=>w.name===name);assert(found.length===1,'Workspace item absent or ambiguous: '+name);return found[0];
}
export function nativeOrderProof(before,after,ownerId,panelIds){
 const rows=(u,ids)=>ids.map(id=>{const w=u.widgets.find(w=>w.id===id);assert(w?.visible&&Number.isInteger(w.nativeWindow)&&Number.isInteger(w.nativeOrder)&&w.nativeOrder>=0,'Owned native window order unavailable');return w;});
 const old=rows(before,panelIds),[owner,...panels]=rows(after,[ownerId,...panelIds]);
 assert(owner.keyWindow===true,'Physical owner click did not acquire the native key window');
 assert(new Set([owner,...panels].map(w=>w.nativeWindow)).size===panels.length+1,'Native window identities overlap');
 for(const panel of panels){assert(panel.nativeOrder<owner.nativeOrder,'Floating panel dropped behind its owner');assert(panel.nativeLevel===0&&panel.nativeHasParent===false,'Floating panel is no longer an independent normal window');}
 assert(Math.sign(old[0].nativeOrder-old[1].nativeOrder)===Math.sign(panels[0].nativeOrder-panels[1].nativeOrder),'Owner click changed sibling window order');
 return {owner:owner.nativeWindow,keyWindow:true,panels:panels.map(w=>({window:w.nativeWindow,order:w.nativeOrder,level:w.nativeLevel,parent:w.nativeHasParent}))};
}
export function focusedTimelineProof(before,after,originalId,focusedId){
 const get=(u,id)=>u.widgets.find(w=>w.id===id);
 const original=get(before,originalId),focused=get(before,focusedId),newOriginal=get(after,originalId),newFocused=get(after,focusedId);
 assert(original?.toolMode===0&&focused?.toolMode===0,'Both authored timelines must begin in Select');
 assert(newFocused?.toolMode===1&&newOriginal?.toolMode===0,'Cut shortcut was not confined to the focused floating timeline');
 assert(after.focus===focusedId&&get(after,newFocused.window)?.keyWindow===true,'Focused timeline is not in the native key window');
 return {focused:focusedId,mode:'Cut',original:originalId,originalMode:'Select'};
}
export function focusedPreviewProof(before,after,originalId,focusedId){
 const get=(u,id)=>u.widgets.find(w=>w.id===id),a=get(before,originalId),b=get(before,focusedId),x=get(after,originalId),y=get(after,focusedId);
 assert([a,b,x,y].every(w=>Number.isInteger(w?.playClickedCount)),'Independent Preview signal counters unavailable');
 assert(y.playClickedCount===b.playClickedCount+1&&x.playClickedCount===a.playClickedCount,'Space dispatched to the wrong Preview or more than once');
 assert(get(after,y.window)?.keyWindow===true,'Floating Preview did not own the native key window');
 return {focusedSignalDelta:1,originalSignalDelta:0,focused:focusedId,original:originalId};
}
export function tailFollowProof(before,samples){
 const a=workspaceItem(before,'AgentWorkspaceMessageList'),tail=w=>Math.max(w.originY,w.originY+w.contentHeight+w.bottomMargin-w.height);
 assert(a.contentHeight>a.height&&a.followTail===true&&a.atYEnd===true&&Math.abs(a.contentY-tail(a))<=.5,'Transcript fixture must begin at its scrollable tail');
 assert(a.bottomMargin===Math.max(12,Math.round(a.height*.1)),'Tail spacing differs from the source assertion');
 assert(samples.length>=3,'Tail-follow needs append and settled samples');
 for(const read of samples){const w=workspaceItem(read,'AgentWorkspaceMessageList');assert(w.count===a.count+1,'Append did not add exactly one transcript row');assert(w.contentY>=a.contentY-.5&&Math.abs(w.contentY-tail(w))<=.5&&w.followTail===true,'Appended transcript bounced away from the tail');}
 return {beforeCount:a.count,afterCount:a.count+1,samples:samples.length,tolerance:.5};
}
export function selectorProof(observation,name){
 const w=workspaceItem(observation,name);assert(w.visible&&w.enabled&&w.hovered===true,'Selector was not hovered');assert(typeof w.accessibleDescription==='string'&&w.accessibleDescription.trim().length>0,'Selector accessible description missing');assert(w.tooltipVisible===false,'Selector displayed a hover tooltip');return {name,description:w.accessibleDescription,hovered:true,tooltipVisible:false};
}
export function headerProof(narrow,wide){
 const item=(o,n)=>workspaceItem(o,'AgentWorkspace'+n),title=item(narrow,'TitleSlot'),text=item(narrow,'TitleText'),model=item(narrow,'ModelSelector'),effort=item(narrow,'EffortSelector'),cancel=item(narrow,'CancelButton');
 assert(title.width>=62&&text.width>0,'Minimum-width header lost its title');assert(!item(narrow,'EventMenu').visible&&cancel.visible,'Narrow header did not prioritize the active Cancel control');assert(model.displayText==='Luna'&&effort.displayText==='Low','Authored header controls did not load');
 assert(effort.x>=model.x+model.width-.5&&cancel.x>=effort.x+effort.width-.5,'Header controls overlap');assert(cancel.localX+cancel.width<=cancel.parentWidth+.5,'Active Cancel control exceeds its header');assert(item(wide,'EventMenu').visible,'Wide header did not restore its events menu');return {titleWidth:title.width,narrowEvents:false,cancel:true,wideEvents:true};
}
export function inlineImageProof(reads){
 assert(reads.length===3,'Inline image needs cap, shrink and widen observations');
 for(const [i,read] of reads.entries()){const bodies=read.items?.filter(w=>w.name==='AgentWorkspaceMessageBody'&&w.images?.length)||[];assert(read.complete===true&&bodies.length===1&&bodies[0].images.length===1,'One complete inline image observation required');const image=bodies[0].images[0],size=i===1?120:200;assert(image.name.startsWith('oz-rounded-image:/')&&image.resourceAvailable===true&&image.cornerAlpha===0,'Rounded project-relative image resource unavailable');assert(Math.round(image.width)===size&&Math.round(image.height)===size,'Inline image cap, shrink or widen restoration is wrong');}
 return {sizes:[200,120,200],roundedCornerAlpha:0,localResource:true};
}
