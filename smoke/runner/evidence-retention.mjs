import path from 'node:path';
import {readFile,writeFile,realpath,lstat,unlink,mkdtemp,link,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {digest,inside} from './files.mjs';

export const imageRetention='failure-focused-v1';
const binding=run=>digest({planHash:run.execution.plan_hash,state:run.execution.state,results:run.results.map(r=>[r.test_id,r.status,r.note])});
const sources=a=>[a.source,...a.sources||[]];
// Only captured images are disposable; fixtures, source and rendered project outputs stay intact.
const disposable=a=>a.file.endsWith('.png')&&sources(a).every(s=>s.split('/').includes('evidence')&&!s.split('/').some(p=>['media','relocated-media','source','projects'].includes(p)));

export async function readImageRetention(run,root){
 if(run.execution.package.imageRetention!==imageRetention)return null;
 let record;try{const file=await realpath(path.join(root,'image-retention.json'));if(!inside(root,file))throw Error('Image retention record escapes the run.');record=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const {sha256,...content}=record;
 if(digest(content)!==sha256||record.format!=='athanor-image-retention/v1'||record.runId!==run.id||record.binding!==binding(run)||!Array.isArray(record.discarded))throw Error('Image retention record differs from the frozen run.');
 const names=new Set();
 for(const a of record.discarded){
  if(!/^[a-f0-9]{64}$/.test(a.sha256||'')||!Number.isSafeInteger(a.bytes)||a.bytes<0||!disposable(a)||path.basename(a.file)!==a.file||!a.file.startsWith('computer-use-'+a.sha256.slice(0,12)+'-')||names.has(a.file))throw Error('Invalid image retention artifact.');
  names.add(a.file);
  for(const s of sources(a)){
   if(path.isAbsolute(s)||s.split('/').some(p=>!p||p==='.'||p==='..')||!inside(root,path.resolve(root,s)))throw Error('Image retention source escapes the run.');
   if(a.file!=='computer-use-'+a.sha256.slice(0,12)+'-'+path.basename(s))throw Error('Image retention source differs from its capture name.');
  }
 }
 return record;
}

export function applyImageRetention(run,report,buffers,previous){
 if(run.execution.package.imageRetention!==imageRetention)return;
 const full=report.selection?.diagnostics==='investigation'||report.acceptance.gaps.some(g=>!report.cases.some(c=>g.startsWith(c.id+': ')))||!['Passed','Failed','Blocked','Unknown'].includes(run.execution.state);
 const qualification=new Set(report.selection?.qualificationIds||[]),protect=new Set();
 for(const c of [...report.cases,...report.computerUse?.cases||[]])for(const e of c.evidence||[]){
  if(full||c.status!=='Pass'||report.acceptance.gaps.some(g=>g.startsWith(c.id+': '))||qualification.has(c.id)||e.retainOnPass)protect.add(e.file);
 }
 // Standalone computer-use pilots have their own checksummed artifact contract.
 for(const c of report.computerUse?.cases||[])for(const f of c.evidenceFiles||[])protect.add(f);
 const referenced=new Set(report.cases.flatMap(c=>(c.evidence||[]).map(e=>e.file)));
 const discarded=previous?.discarded||report.artifacts.filter(a=>!full&&disposable(a)&&referenced.has(a.file)&&!protect.has(a.file));
 const removed=new Set(discarded.map(a=>a.file));
 for(const c of report.cases){
  const omitted=(c.evidence||[]).filter(e=>removed.has(e.file));
  if(!omitted.length)continue;
  c.imageRetention={discarded:omitted.map(e=>({file:e.file,caption:e.caption,when:e.when,specId:e.specId})),reason:'Passing-check intermediate images; logs and measurements retained.'};
  c.evidence=c.evidence.filter(e=>!removed.has(e.file));
  for(const requirement of c.evidenceRequirements||[])if(omitted.some(e=>e.specId===requirement.id)&&!c.evidence.some(e=>e.specId===requirement.id))requirement.retention='Not retained after Pass';
 }
 for(const file of removed)delete buffers[file];
 report.artifacts=report.artifacts.filter(a=>!removed.has(a.file));
 report.imageRetention={policy:imageRetention,mode:full&&!previous?'Full':'Failure focused',discarded,discardedBytes:discarded.reduce((n,a)=>n+a.bytes,0)};
}

export async function pruneReportedImages(run,root,report){
 if(!report.imageRetention?.discarded.length)return;
 if(run.execution.package.imageRetention!==imageRetention)throw Error('This frozen run has no approved image retention policy.');
 const content={format:'athanor-image-retention/v1',runId:run.id,binding:binding(run),discarded:report.imageRetention.discarded},record={...content,sha256:digest(content)};
 const existing=await readImageRetention(run,root);
 if(existing&&existing.sha256!==record.sha256)throw Error('Image retention decision changed; inspect the original record.');
 if(!existing){
  const temporary=await mkdtemp(path.join(root,'.retention-'));
  try{
   const file=path.join(temporary,'record.json');await writeFile(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
   try{await link(file,path.join(root,'image-retention.json'));}catch(e){if(e.code!=='EEXIST')throw e;const concurrent=await readImageRetention(run,root);if(concurrent.sha256!==record.sha256)throw Error('Conflicting image retention decision.');}
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
 for(const a of record.discarded)for(const s of sources(a)){
  const file=path.join(root,s);
  try{
   const info=await lstat(file),resolved=await realpath(file);
   if(!info.isFile()||resolved!==path.resolve(file)||!inside(root,resolved))throw Error('Refusing to prune an unowned image.');
   const bytes=await readFile(file);
   if(bytes.length!==a.bytes||createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw Error('Captured image changed; it was preserved for inspection.');
   await unlink(file);
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
