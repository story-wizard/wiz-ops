import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {uiWorkflows} from './ui-workflows.mjs';
import {verifyDisplayedClips,verifyEmptySearch} from './volume-proof.mjs';
import {verifyTrimmedClip} from './check-support.mjs';
import {clips,snapshotState,assert,OutcomeError} from '../runner/engine.mjs';

function freeze(value){for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);}
export const controlProtocol=freeze({id:'matched-controls-v3',taskBudgetMs:180000,width:1280,height:900,
 rounds:[['bare','athanor'],['athanor','bare']],tasks:{track:['changed','restored'],trim:['changed','restored','redone'],search:['positive','missing','restore','cleanup']},
 search:{positive:'pattern_24',missing:'athanor_missing_benchmark',name:'pattern_24.mov'},trim:{sourceStart:1,sourceEnd:5,timelineStart:1,saveBeforeUndo:true},
 baseline:{id:'athanor-control-comparison-2026-10-03',packageSha256:'f9a3e00dd27e516de70954d3b449ea75b2e125e1405711149311a752a6cc9637',
  files:{'PROTOCOL.md':'df291499564acbae5eef73c5c2004276178b215e0f7e6004c6b7b3e1eeb27c74','identity.json':'4741a6e7708fe8e969f70b691b7c8fc9580be2929f44a711738325e839e53ada', 'results.json':'1761d50e8c248e0fc3dd6d8187536e6e893664c6a9196b0c9fa9e3f7d6a24d66', 'SHA256.json':'402b5e505e877f7f04292cf68ded9befa564f3cd28271d901849a52a087ef32e'}}});

// Common setup is outside actor timing and is never evidence that an edit passed.
export async function prepareControlFixture(file,{task,lane,round}){
 assert(Object.hasOwn(controlProtocol.tasks,task)&&['bare','athanor'].includes(lane)&&[1,2].includes(round),'Choose a comparison task, lane and round');
 const h=await uiWorkflows(file,'control-comparison-diagnostics.json'),{s,n,c,ui}=h;
 const main=h.unique(await ui(),w=>w.class==='MainWindow','Main window');await n('resize-window',{target:main.id,width:controlProtocol.width,height:controlProtocol.height});await h.clearSearch();
 const name=`Control ${round} ${lane} ${task} ${randomUUID()}`,timeline=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),track=timeline.tracks.find(t=>t.kind==='video').track_id;
 if(task!=='track')await c('timeline.place_cuts',{id:'control-'+timeline.timeline_id,timeline_id:timeline.timeline_id,cuts:[{id:'plate',source:{asset_id:s.assets.plate},source_range:{start_seconds:1,end_seconds:5},streams:'video_only',destination:{at:{seconds:1,track}}}]});
 const opened=await h.openTimeline(name);await n('key',{target:opened.id,key:'V'});await c('playback.seek',{time:0});
 const zoom=h.unique(await ui(),w=>w.tooltip?.startsWith('Timeline Zoom'),'Timeline zoom');await n('key',{target:zoom.id,key:'Home'});await n('click',{target:zoom.id,x:Math.round(zoom.width*.35),y:zoom.height/2});
 const mode=(await ui()).actions.filter(a=>a.enabled&&/^Name(?:\t\d+)?$/.test(a.text));assert(mode.length===1,'Name search mode is ambiguous');await n('action',{target:mode[0].id});
 // Save materializes default audio metadata as a history commit on this package.
 // Settle it during common setup, before freezing either lane's baseline.
 const saved=await h.physical('key',{target:main.id,key:'cmd+s'});
 const baseline=await c('timeline.inspect',{timeline_id:timeline.timeline_id}),view=h.unique(await ui(),w=>w.id===opened.id,'Prepared timeline');verifyDisplayedClips(view,baseline);
 let geometry=null;
 if(task==='trim'){
  geometry=await n('timeline-clip-rect',{target:view.id,clipId:clips(baseline)[0].clip_id});const r=geometry.rect,v=geometry.visibleRect;
  if(!(r.width>140&&r.x>=v.x&&r.x+r.width<=v.x+v.width))throw new OutcomeError('Comparison fixture must expose the whole trim edge at the normalized zoom','Blocked');
 }
 // Give keyboard commands a known starting focus, independent of prior lane.
 const v=view.visibleRect||{x:0,y:0,width:view.width,height:view.height};await h.physical('click',{target:view.id,x:v.x+v.width-20,y:v.y+v.height-15});
 const prepared=await ui();assert(prepared.focus===view.id,'Fixture focus is not on the prepared timeline');
 return {format:'athanor-control-fixture/v1',protocol:controlProtocol.id,task,lane,round,preparedAt:new Date().toISOString(),
  identity:{packageHash:s.guiHash,pid:s.pid,started:s.processStart,generation:s.generation},timelineId:timeline.timeline_id,name,baseline,view,geometry,
  setup:{window:{width:prepared.widgets.find(w=>w.id===main.id).width,height:prepared.widgets.find(w=>w.id===main.id).height},zoom:(await ui()).widgets.find(w=>w.id===zoom.id)?.value,searchMode:'Name',focus:prepared.focus,saveBeforeBaseline:saved}};
}

export function scoreControlTask({task,baseline,checkpoints,finished}){
 assert(Object.hasOwn(controlProtocol.tasks,task),'Unknown control task');
 const expected=controlProtocol.tasks[task],complete=finished===true&&isDeepStrictEqual(checkpoints.map(c=>c.phase),expected);
 if(!complete)return {task,status:'Blocked',complete:false,checkpoints:[],reason:'The task needs every declared checkpoint in order and an explicit finish.'};
 const points=Object.fromEntries(checkpoints.map(p=>[p.phase,p.observation])),results=[];
 for(const {phase,observation:obs} of checkpoints){let status='Pass',reason=null;
  try{
   snapshotState(baseline);snapshotState(obs.timeline);assert(obs.timeline.timeline.timeline_id===baseline.timeline.timeline_id,'Observed the wrong timeline');
   if(task==='track'){
    assert(isDeepStrictEqual(obs.timeline.timeline,baseline.timeline),'Track edit changed timeline metadata');
    if(phase==='changed'){
     const added=obs.timeline.tracks.filter(t=>!baseline.tracks.some(b=>b.track_id===t.track_id));
     assert(added.length===1&&obs.timeline.tracks.length===baseline.tracks.length+1&&added[0].address==='V2'&&added[0].items.every(i=>i.kind!=='clip'),'Expected exactly one new empty V2');
     assert(baseline.tracks.every(b=>isDeepStrictEqual(b,obs.timeline.tracks.find(t=>t.track_id===b.track_id)))&&isDeepStrictEqual(obs.timeline.links,baseline.links),'Original tracks or links changed');
    }else assert(isDeepStrictEqual(snapshotState(obs.timeline),snapshotState(baseline)),'Track Undo did not restore the baseline');
   }else if(task==='trim'){
    if(phase==='restored')assert(isDeepStrictEqual(snapshotState(obs.timeline),snapshotState(baseline)),'Trim Undo did not restore the baseline');
    else{
     const {duration_seconds:beforeDuration,...beforeTimeline}=baseline.timeline,{duration_seconds:afterDuration,...afterTimeline}=obs.timeline.timeline;assert(isDeepStrictEqual(beforeTimeline,afterTimeline),'Trim changed timeline metadata or clock');
     if(phase==='redone'&&!isDeepStrictEqual(snapshotState(points.restored.timeline),snapshotState(baseline)))throw new OutcomeError('Redo is inconclusive because Undo did not restore the baseline','Blocked');
     assert(clips(baseline).length===1&&clips(obs.timeline).length===1,'Trim fixture needs exactly one clip');verifyTrimmedClip(clips(baseline)[0],clips(obs.timeline)[0],24);
     assert(isDeepStrictEqual(baseline.tracks.map(t=>({...t,items:undefined,has_placed_items:undefined})),obs.timeline.tracks.map(t=>({...t,items:undefined,has_placed_items:undefined})))&&isDeepStrictEqual(baseline.links,obs.timeline.links),'Trim changed tracks or links');
     if(phase==='redone')assert(isDeepStrictEqual(snapshotState(obs.timeline),snapshotState(points.changed.timeline)),'Redo did not restore the trimmed state');
    }
   }else{
    assert(isDeepStrictEqual(snapshotState(obs.timeline),snapshotState(baseline)),'Search changed timeline content');
    assert(obs.search.complete===true,'Search result observation is incomplete');
    if(phase==='positive')assert(obs.search.query===controlProtocol.search.positive&&obs.search.names.includes(controlProtocol.search.name)&&!/searching|pending|loading|unavailable|error/i.test(obs.search.status||''),'Known filename positive control failed');
    else if(phase==='cleanup')assert(obs.search.query==='','Search query was not cleared');
    else verifyEmptySearch(points.positive.search,points.missing.search,phase==='restore'?obs.search:points.positive.search,{query:controlProtocol.search.missing,name:controlProtocol.search.name});
   }
  }catch(e){status=e.status==='Blocked'?'Blocked':'Fail';reason=e.message;}
  results.push({phase,status,reason});
 }
 return {task,complete,status:results.some(r=>r.status==='Fail')?'Fail':results.some(r=>r.status==='Blocked')?'Blocked':'Pass',checkpoints:results};
}
