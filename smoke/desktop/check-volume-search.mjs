import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {checks,requireExactTimingFixture} from './check-support.mjs';
import {observedWidget} from './checklist-proof.mjs';
import {verifyEmptySearch,verifyLargePaste,verifyNudgeState,verifyDisplayedClips} from './volume-proof.mjs';
import {physicalInput,clipPoint} from './physical-input.mjs';
import {assert,same,clips,snapshotState,OutcomeError} from '../runner/engine.mjs';
import {writeJSON} from '../runner/files.mjs';
import {mediaSearchAction} from './ui-workflows.mjs';
const file=process.argv[2],{s,n,c,ui,until,check:runCheck,step,openTimeline,finish}=await checks(file,'desktop-volume-report.json');
const inspect=timeline_id=>c('timeline.inspect',{timeline_id,page:{max_items:500}}),physical=(op,p)=>physicalInput(file,op,p),stage=(id,title,phase,fn)=>step({id,title,phase},fn);
const artifacts=new Map();let sequence=0;
async function keep(id,phase,value){const out=path.join(s.root,'evidence',id+'-graph-observations-'+phase+'.txt');await mkdir(path.dirname(out),{recursive:true});await writeJSON(out,value);if(!artifacts.has(id))artifacts.set(id,[]);artifacts.get(id).push(out);return out;}
async function capture(id,phase,target){const image=await n('snapshot-widget',{target}),out=path.join(s.root,'evidence',id+'-'+(++sequence)+'-'+phase+'.png');await mkdir(path.dirname(out),{recursive:true});await copyFile(image.path,out);if(!artifacts.has(id))artifacts.set(id,[]);artifacts.get(id).push(out);return out;}
async function check(id,fn){return runCheck(id,async()=>{try{return {...await fn(),artifacts:artifacts.get(id)||[]};}catch(e){e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...(artifacts.get(id)||[])]};throw e;}});}
async function timeline(name){const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}});return {id:t.timeline_id,track:t.tracks.find(t=>t.kind==='video').track_id};}
async function focusClip(view,clipId){const g=await n('timeline-clip-rect',{target:view.id,clipId});await physical('key',{target:view.id,key:'v'});await physical('click',{target:view.id,clipId,expectedClip:g.rect,...clipPoint(g)});}

await check('D-SEARCH-EMPTY',async()=>{
 const id='D-SEARCH-EMPTY',before=await inspect(s.main.id),query='athanor_missing_'+s.harnessId;
 async function search(query,empty=false){
  const field=observedWidget(await ui(),w=>w.class==='MediaSearchField','Media search field');await n('text',{target:field.id,text:''});
  await physical('click',{target:field.id,x:field.width/2,y:field.height/2});await physical('type',{target:field.id,text:query});await physical('key',{target:field.id,key:'Return'});
  return until(async()=>{const u=await ui(),field=observedWidget(u,w=>w.class==='MediaSearchField','Media search field'),status=observedWidget(u,w=>w.name==='mediaSearchStatus','Search status').text||'',bin=observedWidget(u,w=>w.class==='QTreeView'&&Array.isArray(w.model),'Media results');
   if(/unavailable|error/i.test(status))throw new OutcomeError('Filename search is unavailable: '+status,'Blocked');
   const names=bin.model.map(r=>r[0]).sort(),ready=empty?names.length===0&&/^0 matches?\b|^no (?:matches|results)\b/i.test(status):names.includes('pattern_24.mov');
   return field.text===query&&!/searching|pending|loading/i.test(status)&&ready?{query,status,names,target:bin.id}:null;
  },{description:'Completed '+(empty?'empty':'positive')+' filename search'});
 }
 let uncertain=false;
 try{
  const positive=await stage('positive','Select Name search and find a known clip','prepare',async()=>{await n('action',{target:mediaSearchAction(await ui(),'Name').id});await until(async()=>mediaSearchAction(await ui(),'Name').checked,{description:'Media Name source selected'});return search('pattern_24');});await keep(id,'before',positive);await capture(id,'before',positive.target);
  const empty=await stage('missing','Physically search for a term absent from the project','execute',()=>search(query,true));await keep(id,'empty',empty);await capture(id,'after',empty.target);
  const restored=await stage('restore','Repeat the known query and compare results','verify',()=>search('pattern_24'));await keep(id,'restored',restored);await capture(id,'restored',restored.target);
  const result=verifyEmptySearch(positive,empty,restored,{query,name:'pattern_24.mov'});same(snapshotState(await inspect(s.main.id)),snapshotState(before),'Search preserves timeline');return result;
 }catch(e){uncertain=e.status==='Unknown';if(!uncertain){const observed=await ui();await keep(id,'failure-before-cleanup',observed);const bin=observedWidget(observed,w=>w.class==='QTreeView'&&Array.isArray(w.model),'Failure search results');await capture(id,'failure-before-cleanup',bin.id);}throw e;}
 finally{if(!uncertain)await stage('clear','Clear the test query','cleanup',async()=>n('text',{target:observedWidget(await ui(),w=>w.class==='MediaSearchField','Media search field').id,text:''}));}
});

await check('D-CLIPBOARD-LARGE',async()=>{
 const id='D-CLIPBOARD-LARGE',f=await stage('setup','Prepare 100 varied clips and an empty destination','prepare',async()=>{
  const src=await timeline('Large clipboard source'),dst=await timeline('Large clipboard destination');let frame=0;
  const cuts=Array.from({length:100},(_,i)=>{const length=1+i%3,start=i%72;const cut={id:'cut-'+i,source:{asset_id:s.assets.plate},source_range:{start_seconds:start/24,end_seconds:(start+length)/24},streams:'video_only',destination:{at:{seconds:frame/24,track:src.track}}};frame+=length;return cut;});
  await c('timeline.place_cuts',{id:'large-cuts',timeline_id:src.id,cuts});const before=await inspect(src.id),empty=await inspect(dst.id);requireExactTimingFixture(before);assert(clips(before).length===100,'Large clipboard source is incomplete');await keep(id,'before',{before,empty});return {src,dst,before,empty};
 });
 const source=await openTimeline(f.before.timeline.name,f.before.tracks.find(t=>t.address==='V1')?.track_id);await focusClip(source,clips(f.before)[0].clip_id);await keep(id,'displayed-before',verifyDisplayedClips(observedWidget(await ui(),w=>w.id===source.id,'Source timeline'),f.before));await n('clipboard-save');let marked=false;
 try{
  await stage('copy','Physically select and copy all 100 clips','execute',async()=>{await physical('key',{target:source.id,key:'cmd+a'});await physical('key',{target:source.id,key:'cmd+c'});assert((await n('clipboard-mark')).formats.includes('application/x-wizard-timeline-clips'),'Timeline clipboard payload missing');marked=true;});
  const target=await openTimeline(f.empty.timeline.name,f.empty.tracks.find(t=>t.address==='V1')?.track_id);await physical('click',{target:target.id,x:target.width/2,y:target.height-30});await c('playback.seek',{time:0});
  await stage('paste','Physically paste into the empty timeline','execute',()=>physical('key',{target:target.id,key:'cmd+v'}));
  const after=await until(async()=>{const a=await inspect(f.dst.id);return clips(a).length===100?a:null;},{description:'All 100 pasted clips'});await keep(id,'pasted',after);await keep(id,'displayed-after',verifyDisplayedClips(observedWidget(await ui(),w=>w.id===target.id,'Destination timeline'),after));await capture(id,'after',target.id);
  const result=await stage('verify','Check independent IDs, sources, ordering and exact timing','verify',async()=>{const result=verifyLargePaste(f.before,f.empty,after);same(snapshotState(await inspect(f.src.id)),snapshotState(f.before),'Copy preserves source timeline');return result;});
  await stage('history','Undo and Redo the complete paste as one action','verify',async()=>{
   await physical('key',{target:target.id,key:'cmd+z'});await until(async()=>JSON.stringify(snapshotState(await inspect(f.dst.id)))===JSON.stringify(snapshotState(f.empty)),{description:'One Undo removes all copied clips'});await capture(id,'undo',target.id);
   await physical('key',{target:target.id,key:'cmd+shift+z'});await until(async()=>JSON.stringify(snapshotState(await inspect(f.dst.id)))===JSON.stringify(snapshotState(after)),{description:'One Redo restores identical pasted clips'});
   same(snapshotState(await inspect(f.src.id)),snapshotState(f.before),'Redo preserves source');await keep(id,'redone',await inspect(f.dst.id));
  });return {...result,oneUndoAndRedo:true};
 }finally{await stage('clipboard','Restore the tester clipboard','cleanup',async()=>{const restored=await n('clipboard-restore');if(marked)assert(restored.restored,'Clipboard restoration failed');});}
});

await check('D-HISTORY-50',async()=>{
 const id='D-HISTORY-50',f=await stage('setup','Seed history and prepare a single exact-timing clip','prepare',async()=>{
  const f=await timeline('Long history initial');await c('timeline.place_cuts',{id:'history-source',timeline_id:f.id,cuts:[{id:'source',source:{asset_id:s.assets.plate},source_range:{start_seconds:1,end_seconds:3},streams:'video_only',destination:{at:{seconds:1,track:f.track}}}]});
  for(let i=1;i<=50;i++)await c('timeline.update',{id:'seed-'+i,timeline_id:f.id,changes:{name:'Long history seed '+i}});
  f.before=await inspect(f.id);requireExactTimingFixture(f.before);f.clipId=clips(f.before)[0].clip_id;f.view=await openTimeline(f.before.timeline.name,f.before.tracks.find(t=>t.address==='V1')?.track_id);await focusClip(f.view,f.clipId);await keep(id,'before',f.before);await capture(id,'before',f.view.id);return f;
 }),samples=[];
 async function sequence(phase,key,frames){
  for(const frame of frames){const startedAt=Date.now();await physical('key',{target:f.view.id,key});const observed=await until(async()=>{const a=await inspect(f.id),clip=clips(a).find(c=>c.clip_id===f.clipId);return clip&&Math.abs(clip.timeline_range.start_seconds-(1+frame/24))<1e-6?a:null;},{description:phase+' frame '+frame});
   const sample={phase,frame,startedAt,finishedAt:Date.now(),durationMs:Date.now()-startedAt};samples.push(sample);await keep(id,'timings',samples);verifyNudgeState(f.before,observed,f.clipId,frame);
  }
 }
 await stage('edit','Make 50 individual one-frame physical nudges','execute',()=>sequence('edit','period',Array.from({length:50},(_,i)=>i+1)));const edited=await inspect(f.id);await keep(id,'edited',edited);await capture(id,'after',f.view.id);
 await stage('undo','Undo each edit and verify all 50 intermediate states','verify',()=>sequence('undo','cmd+z',Array.from({length:50},(_,i)=>49-i)));
 same(snapshotState(await inspect(f.id)),snapshotState(f.before),'All Undo steps restore exact baseline');await capture(id,'undo',f.view.id);
 await stage('redo','Redo each edit and verify all 50 intermediate states','verify',()=>sequence('redo','cmd+shift+z',Array.from({length:50},(_,i)=>i+1)));
 same(snapshotState(await inspect(f.id)),snapshotState(edited),'All Redo steps restore exact edited state');await keep(id,'redone',await inspect(f.id));
 const timings=Object.fromEntries(['edit','undo','redo'].map(phase=>{const values=samples.filter(x=>x.phase===phase).map(x=>x.durationMs).sort((a,b)=>a-b);return [phase,{count:values.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.ceil(values.length*.95)-1],maxMs:values.at(-1)}];}));
 return {seededCommands:50,edits:50,undos:50,redos:50,timings,latencyBasis:'Native dispatch through independently verified state; no performance acceptance threshold'};
});
finish();
