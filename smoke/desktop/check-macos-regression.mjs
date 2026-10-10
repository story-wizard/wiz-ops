import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {uiWorkflows} from './ui-workflows.mjs';
import {visiblePlayhead,widgetPixelDifference} from './check-support.mjs';
import {waitForPreview} from './recorder.mjs';
import {assert,pause,same,snapshotState,command} from '../runner/engine.mjs';
import {nativeOrderProof,focusedTimelineProof,focusedPreviewProof,workspaceItem,tailFollowProof,selectorProof,headerProof,inlineImageProof} from './macos-proof.mjs';

const h=await uiWorkflows(process.argv[2],'desktop-macos-report.json');
const {s,n,c,ui,until,check,stage,physical,observe,capture,unique,activate,finish}=h;
const main=async()=>unique(await ui(),w=>w.class==='MainWindow','Main window');
const readTimeline=()=>c('timeline.inspect',{timeline_id:s.main.id});
async function addPanel(kind){
 const before=await ui(),ids=new Set(before.widgets.filter(w=>w.class===kind+'Panel').map(w=>w.id));
 await n('add-floating-panel',{target:(await main()).id,panel:kind});
 return until(async()=>{const u=await ui(),p=u.widgets.filter(w=>w.class===kind+'Panel'&&!ids.has(w.id));return p.length===1&&u.widgets.find(w=>w.id===p[0].window)?.class==='ads::CFloatingDockContainer'?p[0]:null;},{description:'New floating '+kind+' panel'});
}
async function workspace(){await h.activatePanel('Agent Workspace (Chat)','AgentWorkspacePanel');return h.floatPanel('Agent Workspace (Chat)','AgentWorkspacePanel',{width:600,height:600});}
const workspaceRead=p=>n('workspace-inspect',{target:p.id});
const append=(p,text,eventId)=>n('workspace-append',{target:p.id,text,eventId:'athanor-fixture-'+eventId});

await check('D-MAC-RESUME',async()=>{
 const id='D-MAC-RESUME',view=await h.openTimeline((await readTimeline()).timeline.name);await c('render.bind_timeline',{timeline_id:s.main.id,playhead_frame:0});await c('playback.pause');await c('playback.seek',{time:0});
 await stage('start','Start playback with the timeline Space shortcut','execute',()=>physical('key',{target:view.id,key:'Space'}));
 const first=await until(async()=>{const t=await c('playback.query_transport');return t.playing&&t.frame>0?t:null;});await physical('key',{target:view.id,key:'Space'});const paused=await until(async()=>{const t=await c('playback.query_transport');return !t.playing?t:null;});await pause(250);const held=await c('playback.query_transport');assert(held.frame===paused.frame,'Pause did not hold');
 await stage('seek','Seek the paused clip to two seconds','execute',()=>c('playback.seek',{time:2}));const sought=await until(async()=>{const t=await c('playback.query_transport');return !t.playing&&t.frame===48&&Math.abs(visiblePlayhead(await ui()).seconds-2)<.001?t:null;});
 await stage('resume','Resume playback from the seek with Space','execute',()=>physical('key',{target:view.id,key:'Space'}));const resumed=await until(async()=>{const t=await c('playback.query_transport');return t.playing&&t.frame>48?t:null;});await physical('key',{target:view.id,key:'Space'});const stopped=await until(async()=>{const t=await c('playback.query_transport');return !t.playing?t:null;});
 const preview=unique(await ui(),w=>w.class==='MetalPreviewWidget','Presented Preview'),presented=await waitForPreview(process.argv[2],{target:preview.id,frame:stopped.frame,playbackGeneration:stopped.playback_generation},image=>{widgetPixelDifference(image,image);return Buffer.from(image.sampleRgb,'base64').some(value=>value>20);});
 await observe(id,'transport',{first,paused,held,sought,resumed,stopped,presented});h.retained.set(id,[...h.retained.get(id),...presented.artifacts]);return {firstFrame:first.frame,pausedFrame:paused.frame,soughtFrame:48,resumedFrame:resumed.frame,artifacts:presented.artifacts,scope:'Physical start/pause/resume, exact stopped seek, visible timecode and fresh presented GPU pixels. Internal audio-clock, decoder retirement and lifetime source assertions remain separate.'};
});
await check('D-MAC-WINDOW-ORDER',async()=>{
 const id='D-MAC-WINDOW-ORDER',baseline=snapshotState(await readTimeline()),owner=await main();
 const panels=await stage('setup','Open two independent floating panels','prepare',async()=>[await addPanel('Timeline'),await addPanel('Preview')]);
 await n('resize-window',{target:panels[0].window,width:500,height:400});await n('resize-window',{target:panels[1].window,width:500,height:400});
 await n('activate',{target:panels[0].window});const before=await ui();await observe(id,'before',before);
 // The exposed top-left owner area is resolved from the observed window; native input rejects occlusion.
 await stage('owner-click','Physically click the owner without first raising it','execute',()=>physical('click',{target:owner.id,x:16,y:16,preserveWindowOrder:true}));
 const after=await until(async()=>{const u=await ui();return u.widgets.find(w=>w.id===owner.id)?.keyWindow?u:null;},{description:'Owner becomes the native key window'});await observe(id,'after',after);
 const proof=nativeOrderProof(before,after,owner.id,panels.map(p=>p.window));same(snapshotState(await readTimeline()),baseline,'Native ordering preserves timeline content');await capture(id,'owner-key',owner.id);return {...proof,scope:'Real packaged floating Timeline and Preview; owner click, sibling order, normal window levels and independent native parents. Other lifecycle source cases remain separate.'};
});
await check('D-MAC-FLOAT-TIMELINE',async()=>{
 const id='D-MAC-FLOAT-TIMELINE',baseline=snapshotState(await readTimeline()),original=await h.openTimeline((await readTimeline()).timeline.name),panel=await addPanel('Timeline');
 const canvases=(await ui()).widgets.filter(w=>w.class==='TimelineWidget'&&w.window===panel.window).sort((a,b)=>a.y-b.y);assert(canvases.length===2&&canvases[0].y+canvases[0].height<=canvases[1].y,'New floating video/audio canvases must be distinct vertical surfaces');const focused=canvases[0];await activate(original);await physical('key',{target:original.id,key:'v'});await activate(focused);await physical('click',{target:focused.id,x:Math.min(30,focused.width/2),y:Math.min(30,focused.height/2)});await physical('key',{target:focused.id,key:'v',requireFocus:true});
 const before=await ui();await observe(id,'before',before);await stage('cut-shortcut','Send C to the physically focused floating timeline','execute',()=>physical('key',{target:focused.id,key:'c',requireFocus:true}));
 const after=await until(async()=>{const u=await ui();return u.widgets.find(w=>w.id===focused.id)?.toolMode===1?u:null;});await observe(id,'after',after);const proof=focusedTimelineProof(before,after,original.id,focused.id);same(snapshotState(await readTimeline()),baseline,'Tool selection must not change clips');await capture(id,'focused-cut',panel.window);return proof;
});
await check('D-MAC-FLOAT-PREVIEW',async()=>{
 const id='D-MAC-FLOAT-PREVIEW',original=unique(await ui(),w=>w.class==='PreviewPanel','Original preview'),panel=await addPanel('Preview');await c('playback.pause');await activate(panel);const renderer=unique(await ui(),w=>w.class==='MetalPreviewWidget'&&w.window===panel.window,'Floating Preview renderer');await physical('click',{target:renderer.id});
 const before=await ui();await observe(id,'before',before);await stage('space-shortcut','Send Space in the floating Preview','execute',()=>physical('key',{target:panel.id,key:'Space'}));
 const after=await ui();await observe(id,'after',after);const proof=focusedPreviewProof(before,after,original.id,panel.id);await capture(id,'focused-preview',panel.window);await c('playback.pause');return {...proof,scope:'Native key window and real physical Space; independent Preview signal counters. Playback image fidelity has separate checks.'};
});
await check('D-AGENT-TAIL',async()=>{
 const id='D-AGENT-TAIL',panel=await workspace();
 await stage('transcript','Append eighteen deterministic local responses','prepare',async()=>{for(let i=0;i<18;i++)await append(panel,'Existing transcript row '+i+' with enough text to establish a stable scrolling viewport.','tail-'+i);});
 const before=await until(async()=>{const r=await workspaceRead(panel),w=workspaceItem(r,'AgentWorkspaceMessageList');return w.atYEnd&&w.followTail&&w.contentHeight>w.height?r:null;},{description:'Scrollable transcript follows its tail'});await observe(id,'before',before);
 await stage('append','Append one local response at the tail','execute',()=>append(panel,'A newly appended response with stable plain-text height.','tail-new'));
 const samples=[];for(let i=0;i<4;i++){samples.push(await workspaceRead(panel));await pause(50);}await observe(id,'samples',samples);const proof=tailFollowProof(before,samples);await capture(id,'tail',panel.window);return {...proof,scope:'Packaged history append and sampled tail positioning. Gesture-anchor preservation and scroll-away behavior remain source-only assertions.'};
});
await check('D-AGENT-SELECTORS',async()=>{
 const id='D-AGENT-SELECTORS',panel=await workspace(),results=[];
 for(const name of ['AgentWorkspaceModelSelector','AgentWorkspaceEffortSelector']){
  await stage(name,'Hover '+(name.includes('Model')?'model':'effort')+' selector through Qt input','execute',()=>n('workspace-hover',{target:panel.id,name}));
  await until(async()=>workspaceItem(await workspaceRead(panel),name).hovered,{description:'Selector hover observed'});await pause(500);const r=await workspaceRead(panel);await observe(id,name,r);results.push(selectorProof(r,name));
 }
 await capture(id,'selectors',panel.window);return {selectors:results,inputMode:'Qt-injected hover, matching the source regression; no AX inspection or provider execution'};
});
await check('D-AGENT-HEADER',async()=>{
 const id='D-AGENT-HEADER',panel=await workspace(),original=(await workspaceRead(panel)).controller;let uncertain=false;
 await stage('active-fixture','Set local model/effort options and a fake active event','prepare',()=>n('workspace-header',{target:panel.id,phase:'begin'}));
 try{
  await n('resize-window',{target:panel.window,width:280,height:800});await pause(300);const narrow=await workspaceRead(panel);await observe(id,'narrow',narrow);await capture(id,'narrow',panel.window);
  await stage('idle-controls','Hide Cancel before checking the wide events control','execute',()=>n('workspace-header',{target:panel.id,phase:'hide-cancel'}));
  await n('resize-window',{target:panel.window,width:600,height:800});await pause(300);const wide=await workspaceRead(panel);await observe(id,'wide',wide);const proof=headerProof(narrow,wide);await capture(id,'wide',panel.window);return {...proof,fixture:'Synthetic running event; no real agent execution',scope:'Title and active-control geometry at 280 points, events menu at 600. Custom-model popup sizing remains separate.'};
 }catch(e){uncertain=e.status==='Unknown';throw e;}finally{if(!uncertain)await stage('restore','Restore the original controller options and Cancel state','cleanup',async()=>{await n('workspace-header',{target:panel.id,phase:'end'});const restored=(await workspaceRead(panel)).controller;for(const key of ['modelOptions','currentModelIndex','effortOptions','currentEffortIndex','cancelVisible'])same(restored[key],original[key],'Header fixture restores '+key);});}
});
await check('D-AGENT-IMAGE',async()=>{
 const id='D-AGENT-IMAGE',panel=await workspace(),directory=path.join(s.bundle,'assets/context/images'),source=path.join(s.root,'media','still.png');await mkdir(directory,{recursive:true});
 const image=path.join(directory,'athanor-square.png'),receipt=await command('ffmpeg',['-v','error','-y','-i',source,'-vf','scale=400:400',image],{timeout:10000});assert(receipt.code===0,'Square local image fixture could not be generated');
 await stage('inline-image','Append a local project-relative Markdown image','prepare',()=>append(panel,'![Athanor local image](assets/context/images/athanor-square.png)','inline-image'));
 await until(async()=>{const r=await workspaceRead(panel);return r.items.some(w=>w.images?.length)?r:null;},{description:'Packaged document contains an inline image'});
 const reads=[];for(const width of [400,120,400]){await stage('width-'+reads.length,'Apply packaged image sizing at '+width+' points','execute',()=>n('workspace-image-width',{target:panel.id,width}));await pause(100);reads.push(await workspaceRead(panel));}
 await observe(id,'sizes',reads);const proof=inlineImageProof(reads);await capture(id,'restored-image',panel.window);return {...proof,scope:'Real QTextDocument image formats/resources and packaged sizing method; controlled local square fixture, no download or provider call.'};
});
finish();
