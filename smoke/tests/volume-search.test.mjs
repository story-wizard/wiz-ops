import {desktopScriptTimeout,requireScriptReceipt} from '../desktop/check-support.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {verifyEmptySearch,verifyLargePaste,verifyNudgeState,verifyDisplayedClips} from '../desktop/volume-proof.mjs';
import {checkRegistry,fullSmokeCourse,resolveSelection,initializeCourses,selectedRecipe,validateRecipe} from '../runner/catalog.mjs';
import {desktopGroups} from '../desktop/run.mjs';
import {agentContext} from '../test-details.mjs';
const snapshot=(id='src',count=0)=>({timeline:{timeline_id:id,name:'History',frame_rate:{numerator:24,denominator:1}},tracks:[{track_id:id+'v',address:'V1',enabled:true,locked:false,has_placed_items:count>0,items:Array.from({length:count},(_,i)=>({kind:'clip',clip_id:id+i,track_id:id+'v',enabled:true,timeline_range:{start_seconds:1+i/24,end_seconds:1+(i+1)/24},source:{asset_id:'plate',source_range:{start_seconds:i/24,end_seconds:(i+1)/24}}}))}],links:[]});
test('empty search requires positive, explicit complete zero-match, and restored controls',()=>{
 const positive={query:'pattern',status:'1 match',names:['pattern.mov']},empty={query:'absent',status:'0 matches in 0 clips',names:[]},restored=structuredClone(positive),expected={query:'absent',name:'pattern.mov'};
 assert.equal(verifyEmptySearch(positive,empty,restored,expected).emptyResults,0);
 for(const change of [a=>a[0].names=[],a=>a[1].names=['wrong.mov'],a=>a[1].status='Searching…',a=>a[1].status='Unavailable',a=>a[1].status='',a=>a[1].query='wrong',a=>a[2].names=[]]){const args=[positive,empty,restored].map(x=>structuredClone(x));change(args);assert.throws(()=>verifyEmptySearch(...args,expected));}
});
test('large paste rejects missing clips, reused IDs, reordered timing, altered sources and foreign destinations',()=>{
 const source=snapshot('src',100),empty=snapshot('dst'),pasted=snapshot('dst',100);assert.equal(verifyLargePaste(source,empty,pasted).count,100);
 for(const change of [s=>s.tracks[0].items.pop(),s=>s.tracks[0].items[1].clip_id='src1',s=>s.tracks[0].items[1].clip_id=s.tracks[0].items[0].clip_id,s=>s.tracks[0].items.reverse(),s=>s.tracks[0].items[0].source.asset_id='other',s=>s.tracks[0].items[0].track_id='wrong',s=>s.timeline.timeline_id='foreign',s=>s.next_cursor='more',s=>s.tracks.push({track_id:'extra',kind:'video',items:[]}),s=>s.links.push({id:'extra'}),s=>s.tracks[0].has_placed_items=false]){const bad=structuredClone(pasted);change(bad);assert.throws(()=>verifyLargePaste(source,empty,bad));}
});
test('history assertions detect skipped or double nudges, changed sources and undo crossing seeded history',()=>{
 const before=snapshot('src',1),after=structuredClone(before);after.tracks[0].items[0].timeline_range={start_seconds:1+50/24,end_seconds:1+51/24};verifyNudgeState(before,after,'src0',50);
 for(const change of [s=>s.tracks[0].items[0].timeline_range.start_seconds+=1/24,s=>s.tracks[0].items[0].source.asset_id='other',s=>s.tracks[0].items=[],s=>s.timeline.name='Earlier seed',s=>s.timeline.frame_rate.denominator=1001,s=>s.tracks[0].items[0].enabled=false]){const bad=structuredClone(after);change(bad);assert.throws(()=>verifyNudgeState(before,bad,'src0',50));}
});
test('each new candidate composes with only connections and gets an isolated fixture',()=>{
 const db=new DatabaseSync(':memory:');initializeCourses(db);const map=JSON.parse(readFileSync(new URL('../desktop/check-map.json',import.meta.url)));
 try{for(const id of ['D-SEARCH-EMPTY','D-CLIPBOARD-LARGE','D-HISTORY-50']){const check=checkRegistry().find(c=>c.id===id);assert.equal(check.accepted,false);assert.ok(fullSmokeCourse().qualificationChecks.includes(id));assert.throws(()=>resolveSelection(db,{checkIds:[id]}),/not accepted/);
 const selection=resolveSelection(db,agentContext(check).selection);assert.deepEqual(new Set(selection.effectiveIds),new Set(['A-CLI-01','D-CLI-01',id]));validateRecipe(selectedRecipe(selection));assert.deepEqual(desktopGroups([id],map).map(g=>g.ids),[[id]]);}
 }finally{db.close();}
});

test('displayed identity proof rejects stale, missing or capped clip lists',()=>{
 const timeline=snapshot('src',100),view={id:'view',clipIds:timeline.tracks[0].items.map(c=>c.clip_id),clipIdsTruncated:false};assert.equal(verifyDisplayedClips(view,timeline).clipCount,100);
 for(const bad of [{...view,clipIdsTruncated:true},{id:'view'},{...view,clipIds:view.clipIds.slice(0,64)},{...view,clipIds:[...view.clipIds.slice(0,99),'foreign']}])assert.throws(()=>verifyDisplayedClips(bad,timeline));
});

test('long physical sequences get an explicit bounded budget without lengthening ordinary drivers',()=>{
 assert.equal(desktopScriptTimeout([{scriptTimeoutMs:240000},{scriptTimeoutMs:240000}]),480000);assert.equal(desktopScriptTimeout([]),120000);assert.equal(desktopScriptTimeout([{id:'ordinary'}]),120000);assert.equal(desktopScriptTimeout([{scriptTimeoutMs:480000}]),480000);
 for(const ms of [0,-1,NaN,1000.5,600001,'480000'])assert.throws(()=>desktopScriptTimeout([{scriptTimeoutMs:ms}]));
});
test('interrupted scripts retain Unknown with diagnostics before a missing report can mask the timeout',()=>{
 for(const flag of ['timedOut','overflow','aborted'])assert.throws(()=>requireScriptReceipt({code:null,[flag]:true},'history'),e=>e.status==='Unknown'&&e.diagnostics[flag]===true);
 assert.doesNotThrow(()=>requireScriptReceipt({code:1},'completed assertions'));
});
