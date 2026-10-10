import path from 'node:path';
import {lstat,realpath,rename,readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assert,same,clips,snapshotState,OutcomeError} from '../runner/engine.mjs';
import {inside,sha,writeJSON,readJSON} from '../runner/files.mjs';
import {pixelDifference} from '../runner/pixels.mjs';

export function mediaPlacementState(snapshot){
 snapshotState(snapshot);
 return {timelineId:snapshot.timeline.timeline_id,tracks:snapshot.tracks.map(t=>({id:t.track_id,kind:t.kind,items:t.items.map(i=>({id:i.clip_id,kind:i.kind,range:i.timeline_range,source:i.source?.asset_id}))})),links:snapshot.links};
}
export function verifyTailTiming(snapshot,{head,tail,end=2}){
 assert(snapshot.next_cursor==null&&snapshot.timeline.fps===24,'Tail observation needs a complete 24-fps timeline');
 const items=clips(snapshot);assert(items.length===2,'Split must have exactly two clips');
 for(const [id,start,finish] of [[head,0,1],[tail,1,end]]){
  const c=items.find(c=>c.clip_id===id);assert(c&&c.timeline_range.start_seconds===start&&c.timeline_range.end_seconds===finish,'Split/extension changed an edge or identity');
 }
 return {head,tail,end};
}
export function verifyTailFrames(reference,observed,expectedFrames){
 same(observed.map(f=>f.frame),expectedFrames,'Tail frame inventory');
 const proof=observed.map(f=>{
  const original=reference.find(r=>r.frame===f.frame);assert(original,'Tail frame has no independently captured original');
  assert(f.image.width===original.image.width&&f.image.height===original.image.height,'Tail raster changed');
  const delta=pixelDifference(original.image,f.image);assert(delta<=.01,'Tail restarted, shifted source time or changed pixels at frame '+f.frame);
  return {frame:f.frame,pixelDelta:delta};
 });
 return proof;
}

// Move only this run's regular source, and never overwrite a file created by another actor.
export async function withMissingSource(root,file,observe){
 const owned=await realpath(root),actual=await realpath(file),metadata=await lstat(file),away=file+'.athanor-offline';
 assert(inside(owned,actual)&&actual===path.resolve(file)&&metadata.isFile()&&!metadata.isSymbolicLink(),'Missing-media source is not an owned regular file');
 try{await lstat(away);throw new OutcomeError('Offline destination already exists; preserve it and inspect.','Blocked');}catch(e){if(e.code!=='ENOENT')throw e;}
 const hash=await sha(file);await rename(file,away);
 try{return {source:file,offline:away,sha256:hash,observation:await observe(),restored:true};}
 finally{
  try{
  let occupied=false;try{await lstat(file);occupied=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  const state=await lstat(away);
  if(occupied||!state.isFile()||state.isSymbolicLink()||await realpath(away)!==away||await sha(away)!==hash)throw new OutcomeError('Owned source cannot be safely restored; inspect original/offline files without overwriting.','Unknown');
  await rename(away,file);assert(await sha(file)===hash,'Restored source bytes changed');
  }catch(e){if(e.status==='Unknown')throw e;throw new OutcomeError('Owned source restoration could not be verified; inspect original/offline files: '+e.message,'Unknown');}
 }
}

export async function rawNotesHistory(h,{verify=false}={}){
 const {s,c,until,physical,openTimeline,activate,action,observe,capture}=h,id='D-RAW-NOTES-PERSIST',expectedFile=path.join(s.root,'raw-notes-expected.json');
 if(verify){
  let e;try{e=await readJSON(expectedFile);}catch(error){if(error.code==='ENOENT')throw new OutcomeError('Raw notes did not establish a reopen fixture','Blocked');throw error;}
  assert(e.pid!==s.pid,'Raw notes reopen requires a fresh process');
  assert(/^documents\/athanor-raw-notes-[a-f0-9-]+\.txt$/.test(e.relativePath),'Raw notes path is outside its fixture');
  const file=path.join(s.bundle,e.relativePath),metadata=await lstat(file);assert(metadata.isFile()&&!metadata.isSymbolicLink()&&inside(await realpath(s.bundle),await realpath(file)),'Raw notes were redirected');
  same(await readFile(file,'utf8'),e.text,'Raw note bytes after reopen');same(snapshotState(await c('timeline.inspect',{timeline_id:s.main.id})),e.timeline,'Renamed timeline after reopen');
  await observe(id,'reopened',{pid:s.pid,sha256:await sha(file),timeline:e.timeline});
  const view=await openTimeline(e.timeline.timeline.name);await capture(id,'reopened',view.id,'widget');
  return {freshPid:s.pid,relativePath:e.relativePath,sha256:await sha(file),scope:'Unmanaged disk-backed notes; clip/timeline annotation controls remain separate.'};
 }
 const relativePath='documents/athanor-raw-notes-'+randomUUID()+'.txt',file=path.join(s.bundle,relativePath);
 await mkdir(path.dirname(file),{recursive:true});assert(inside(await realpath(s.bundle),await realpath(path.dirname(file))),'Raw notes directory was redirected');
 const first='Raw notes before the independent edit.\r\n',text='Latest raw user notes — keep café, Ω and CRLF.\r\nSecond line.\r\n';await writeFile(file,first,{flag:'wx'});
 await action('Save');const before=await c('timeline.inspect',{timeline_id:s.main.id}),name=before.timeline.name+' raw-note history';
 const view=await openTimeline(before.timeline.name);await activate(view);
 await c('timeline.update',{id:'raw-notes-independent-edit',timeline_id:s.main.id,changes:{name}});
 const changed=await until(async()=>{const t=await c('timeline.inspect',{timeline_id:s.main.id});return t.timeline.name===name?t:null;});
 await writeFile(file,text);const hash=await sha(file),samples=[];
 for(const [key,expected,phase] of [['cmd+z',before,'undo'],['cmd+shift+z',changed,'redo']]){
  await activate(view);await physical('key',{target:view.id,key});
  const actual=await until(async()=>{const t=await c('timeline.inspect',{timeline_id:s.main.id});return t.timeline.name===expected.timeline.name?t:null;});same(snapshotState(actual),snapshotState(expected),'Independent timeline '+phase);
  same(await readFile(file,'utf8'),text,'Raw notes after '+phase);samples.push({phase,sha256:await sha(file),text:await readFile(file,'utf8'),timeline:snapshotState(actual)});await observe(id,phase,samples.at(-1));await capture(id,phase,view.id,'widget');
 }
 await action('Save');same(await readFile(file,'utf8'),text,'Raw notes after Save');
 const timeline=snapshotState(await c('timeline.inspect',{timeline_id:s.main.id}));await writeJSON(expectedFile,{pid:s.pid,relativePath,text,sha256:hash,timeline});
 return {relativePath,sha256:hash,samples,reopenPending:true,scope:'Externally authored unmanaged documents; Undo/Redo changes an independent timeline rename.'};
}
