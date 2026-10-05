import {assert,same,near,clips,snapshotState,OutcomeError} from '../runner/engine.mjs';

export function verifyEmptySearch(positive,empty,restored,{query,name}){
 assert(positive.query!==query&&positive.names.includes(name),'Missing search lacks a working positive control');
 assert(empty.query===query&&empty.names.length===0&&/^0 matches?\b|^no (?:matches|results)\b/i.test(empty.status||''),'Missing term must produce an explicit completed empty result');
 for(const result of [positive,empty,restored])assert(!/searching|pending|loading|unavailable|error/i.test(result.status||''),'Search is unfinished or unavailable');
 assert(restored.query===positive.query,'Restored query differs');same(restored.names,positive.names,'Positive result restored after empty query');
 return {query,emptyResults:0,positiveResults:positive.names,restored:true};
}

export function verifyLargePaste(source,empty,pasted,count=100){
 snapshotState(source);snapshotState(empty);snapshotState(pasted);
 for(const t of pasted.tracks)if(typeof t.has_placed_items==='boolean')assert(t.has_placed_items===t.items.some(i=>i.kind==='clip'),'Track placement flag disagrees with pasted contents');
 const original=clips(source),copies=clips(pasted);assert(original.length===count&&copies.length===count&&clips(empty).length===0,'Large clipboard count differs from its established baseline');
 same(pasted.timeline.timeline_id,empty.timeline.timeline_id,'Paste destination identity');same(pasted.timeline.frame_rate,source.timeline.frame_rate,'Same-clock large paste');same(pasted.timeline.frame_rate,empty.timeline.frame_rate,'Paste preserves destination clock');
 same(pasted.tracks.map(({items,has_placed_items,...track})=>track),empty.tracks.map(({items,has_placed_items,...track})=>track),'Paste preserves destination tracks');
 const destination=empty.tracks.filter(t=>/^V\d+$/.test(t.address||''));assert(destination.length===1,'Large clipboard fixture needs one video track');
 assert(new Set(copies.map(c=>c.clip_id)).size===count&&copies.every(c=>!original.some(b=>b.clip_id===c.clip_id)&&c.track_id===destination[0].track_id),'Paste reused identities or targeted the wrong track');
 for(let i=0;i<count;i++){same(copies[i].source,original[i].source,'Copied source '+i);same(copies[i].timeline_range,original[i].timeline_range,'Copied placement '+i);for(const key of ['enabled','speed','link_group','multicam','display_name','source_display_name'])same(copies[i][key],original[i][key],'Copied '+key+' '+i);}
 same(pasted.links,empty.links,'Unlinked clipboard preserves links');
 return {count,uniqueCopies:true,sourceIdentityAndTiming:true};
}

export function verifyNudgeState(before,after,clipId,frames){
 snapshotState(before);snapshotState(after);same(after.timeline.timeline_id,before.timeline.timeline_id,'History timeline identity');same(after.timeline.frame_rate,{numerator:24,denominator:1},'History fixture clock');
 const expected=clips(before).find(c=>c.clip_id===clipId),observed=clips(after).find(c=>c.clip_id===clipId);assert(expected&&observed&&clips(after).length===clips(before).length,'History lost or duplicated clips');
 near(observed.timeline_range.start_seconds,expected.timeline_range.start_seconds+frames/24,'History clip start');near(observed.timeline_range.end_seconds,expected.timeline_range.end_seconds+frames/24,'History clip end');
 same(observed.source,expected.source,'Nudge preserves source');same(observed.enabled,expected.enabled,'Nudge preserves enabled state');same(after.links,before.links,'Nudge preserves links');
 same(after.tracks.map(({items,has_placed_items,...track})=>track),before.tracks.map(({items,has_placed_items,...track})=>track),'History preserves tracks');
 for(const c of clips(before).filter(c=>c.clip_id!==clipId))same(clips(after).find(a=>a.clip_id===c.clip_id),c,'History preserves other clips');
 same(after.timeline.name,before.timeline.name,'Undo stays above seeded history');
 return {frames,clipId};
}

export function verifyDisplayedClips(view,snapshot){
 snapshotState(snapshot);
 if(!Array.isArray(view?.clipIds)||view.clipIdsTruncated)throw new OutcomeError('Displayed clip identities are unavailable or incomplete; qualify the adapter binding first','Blocked');
 same([...view.clipIds].sort(),clips(snapshot).map(c=>c.clip_id).sort(),'Displayed clip identities agree with application readback');
 return {viewId:view.id,clipCount:view.clipIds.length};
}
