import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readdir} from 'node:fs/promises';
import {withMissingSource,verifyTailTiming,verifyTailFrames,rawNotesHistory,mediaPlacementState} from '../desktop/functional-cohort-proof.mjs';
import {desktopGroups} from '../desktop/run.mjs';
import {liveStageObservation} from '../runner/stages.mjs';
import {checkRegistry,resolveSelection,selectedRecipe,validateRecipe} from '../runner/catalog.mjs';

const snapshot=(items=[{kind:'clip',clip_id:'head',timeline_range:{start_seconds:0,end_seconds:1}},{kind:'clip',clip_id:'tail',timeline_range:{start_seconds:1,end_seconds:2}}])=>({timeline:{timeline_id:'timeline-1',name:'Main',fps:24},tracks:[{track_id:'track-v1',kind:'video',items}],next_cursor:null,links:[]});

test('animated tail oracle rejects restarting pixels, wrong edges, duplicate IDs and incomplete observations',()=>{
 const ref=[24,30,42,47].map(frame=>({frame,image:{width:2,height:1,pixels:Buffer.from([frame,200,10,0,0,0])}}));
 assert.equal(verifyTailFrames(ref,ref,[24,30,42,47]).length,4);verifyTailTiming(snapshot(),{head:'head',tail:'tail'});
 const broken=structuredClone(ref);broken[0].image.pixels=Buffer.from([0,200,10,0,0,0]);assert.throws(()=>verifyTailFrames(ref,broken,[24,30,42,47]),/restarted/);
 assert.throws(()=>verifyTailFrames(ref,[ref[1],ref[0],ref[2],ref[3]],[24,30,42,47]),/inventory/);assert.throws(()=>verifyTailFrames(ref,ref.slice(0,3),[24,30,42,47]));
 for(const mutate of [s=>s.tracks[0].items[1].timeline_range.start_seconds=0,s=>s.tracks[0].items[1].timeline_range.end_seconds=2.5,s=>s.tracks[0].items[1].clip_id='head',s=>s.next_cursor='more',s=>s.timeline.fps=25]){const s=snapshot();mutate(s);assert.throws(()=>verifyTailTiming(s,{head:'head',tail:'tail'}));}
 const changed=snapshot();changed.tracks[0].items[0].source={asset_id:'different'};assert.notDeepEqual(mediaPlacementState(changed),mediaPlacementState(snapshot()));
});

test('source-loss procedure restores bytes after a failed observation and refuses redirected or occupied paths',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-source-loss-');
 try{
  const file=root+'/owned.mov';await writeFile(file,'controlled source');
  await assert.rejects(()=>withMissingSource(root,file,async()=>{assert.equal(await readFile(file).catch(e=>e.code),'ENOENT');throw Error('failed UI assertion');}),/failed UI assertion/);assert.equal(await readFile(file,'utf8'),'controlled source');
  await writeFile(file+'.athanor-offline','retained prior source');let called=false;await assert.rejects(()=>withMissingSource(root,file,async()=>{called=true;}),/already exists/);assert.equal(called,false);await rm(file+'.athanor-offline');
  const link=root+'/linked.mov';await symlink(file,link);await assert.rejects(()=>withMissingSource(root,link,async()=>{}),/owned regular/);
  await assert.rejects(()=>withMissingSource(root,file,async()=>{await writeFile(file,'another actor');}),e=>e.status==='Unknown');assert.equal(await readFile(file,'utf8'),'another actor');assert.equal(await readFile(file+'.athanor-offline','utf8'),'controlled source');
  const vanished=root+'/vanished.mov';await writeFile(vanished,'owned source');await assert.rejects(()=>withMissingSource(root,vanished,async()=>{await rm(vanished+'.athanor-offline');}),e=>e.status==='Unknown');
 }finally{await rm(root,{recursive:true,force:true});}
});

async function notesFixture(root,{rewriteOnUndo=false,skipHistory=false}={}){
 const bundle=root+'/fixture.wiz';await mkdir(bundle);let state=snapshot([]),original,changed;const s={root,bundle,pid:101,main:{id:'timeline-1'}};
 return {s,c:async(op,p)=>{if(op==='timeline.inspect')return structuredClone(state);if(op==='timeline.update'){original=structuredClone(state);state.timeline.name=p.changes.name;changed=structuredClone(state);return {};}throw Error('Unexpected '+op);},until:async fn=>{const result=await fn();assert.ok(result,'Expected app state never arrived');return result;},action:async()=>{},openTimeline:async()=>({id:'view-1'}),activate:async()=>{},physical:async(op,p)=>{assert.equal(op,'key');assert.equal(p.target,'view-1');if(!skipHistory)state=structuredClone(p.key==='cmd+z'?original:changed);if(rewriteOnUndo&&p.key==='cmd+z'){const file=(await readdir(bundle+'/documents'))[0];await writeFile(bundle+'/documents/'+file,'old committed notes');}},observe:async()=>{},capture:async()=>{}};
}

test('raw-note procedure detects byte rewriting and inert Undo, and requires new-process persistence',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-raw-notes-');
 try{
  for(const [name,options] of [['valid',{}],['rewrite',{rewriteOnUndo:true}],['inert',{skipHistory:true}]]){
   const dir=root+'/'+name;await mkdir(dir);const h=await notesFixture(dir,options);
   if(name!=='valid'){await assert.rejects(()=>rawNotesHistory(h),name==='rewrite'?/Raw notes after undo/:/never arrived/);continue;}
   const result=await rawNotesHistory(h);assert.equal(result.reopenPending,true);const e=JSON.parse(await readFile(dir+'/raw-notes-expected.json'));assert.ok(e.text.includes('Ω')&&e.text.endsWith('\r\n'));
   await assert.rejects(()=>rawNotesHistory(h,{verify:true}),/fresh process/);h.s.pid=102;assert.equal((await rawNotesHistory(h,{verify:true})).freshPid,102);
   await writeFile(h.s.bundle+'/'+e.relativePath,'lost on reopen');await assert.rejects(()=>rawNotesHistory(h,{verify:true}),/after reopen/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('new cohort keeps isolated file/history sessions, explicit qualification and pending reopen verdicts',async()=>{
 const map=JSON.parse(await readFile(new URL('../desktop/check-map.json',import.meta.url))),ids=['D-MISSING-MEDIA-LIVE','D-RAW-NOTES-PERSIST','S-MGFX-TAIL-TIMING'];
 for(const id of ids){const selection=resolveSelection({},{courseIds:['smoke-full'],subsetIds:[id]});assert.ok(selection.qualificationIds.includes(id));validateRecipe(selectedRecipe(selection));assert.equal(checkRegistry().find(c=>c.id===id).accepted,false);assert.throws(()=>resolveSelection({},{checkIds:[id]}),/not accepted/);}
 assert.equal(desktopGroups(ids.slice(0,2),map).length,2);for(const g of desktopGroups(ids.slice(0,2),map))assert.equal(g.recoverUnstarted,false);
 for(const id of ['D-RAW-NOTES-PERSIST','S-MGFX-TAIL-TIMING']){assert.equal(liveStageObservation({id,status:'Pass'}),null);assert.equal(liveStageObservation({id,status:'Pass',final:true}).status,'Pass');}
});

test('merged reopen evidence retains both attempts and a failure cannot be cleared by a later Pass',async()=>{
 const {mergeReopenResult}=await import('../desktop/check-support.mjs');
 const initial={id:'case',status:'Pass',evidence:{artifacts:['before.png'],reopenPending:true}},verified={id:'case',status:'Pass',evidence:{pid:202,artifacts:['after.png']}};
 const result=mergeReopenResult(initial,verified);assert.deepEqual(result.evidence.artifacts,['before.png','after.png']);assert.equal(result.evidence.reopen.pid,202);assert.equal(result.evidence.reopenPending,false);assert.equal(initial.evidence.reopenPending,true);
 assert.equal(mergeReopenResult(initial,{...verified,status:'Blocked'}).status,'Blocked');
 assert.equal(mergeReopenResult({...initial,status:'Fail',error:'first failure'},verified).status,'Fail');assert.equal(mergeReopenResult({...initial,status:'Unknown'},verified).status,'Unknown');assert.throws(()=>mergeReopenResult(initial,{...verified,id:'different'}));
});
