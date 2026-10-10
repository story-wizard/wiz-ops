import path from 'node:path';
import {realpath,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inside} from '../runner/files.mjs';
import {requireProof} from './agent-proof.mjs';
const exec=promisify(execFile),hash=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
// Read-only, bounded history for the owned .wiz. It never chooses or dispatches Undo.
export async function projectHistory(session,baselineRevision,observedRevision){
 requireProof(typeof baselineRevision==='string'&&typeof observedRevision==='string'&&hash.test(baselineRevision)&&hash.test(observedRevision),'invalid_history','Supply exact observed revision hashes',['observe']);
 const root=await realpath(session.root),bundle=await realpath(session.bundle),gitDir=await realpath(path.join(bundle,'.git'));
 requireProof(inside(root,bundle)&&bundle.endsWith('.wiz')&&inside(bundle,gitDir),'history_scope_mismatch','History must belong to the owned project',['context']);
 for(const file of ['commondir','objects/info/alternates']){let found;try{found=await lstat(path.join(gitDir,file));}catch(e){if(e.code!=='ENOENT')throw e;}requireProof(!found,'history_scope_mismatch','Linked/shared Git history is not supported by this readback',['inspect']);}
 const env={PATH:'/usr/bin:/bin',LANG:'C',GIT_DIR:gitDir,GIT_WORK_TREE:bundle,GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
 const git=async args=>(await exec('/usr/bin/git',args,{env,encoding:'utf8',timeout:2000,maxBuffer:65536})).stdout.trim();
 const rows=(await git(['log','--first-parent','-n','9','--format=%H%x1f%T%x1f%P%x1f%s','HEAD'])).split('\n').map(row=>{
  const [revision,tree,parents,subject,...extra]=row.split('\x1f');requireProof(!extra.length&&hash.test(revision)&&hash.test(tree),'invalid_history','Malformed bounded history readback',['inspect']);
  let operation=null;try{const value=JSON.parse(subject).op;if(typeof value==='string'&&/^[a-z_.]{1,64}$/.test(value))operation=value;}catch{}
  return {revision,tree,parents:parents?parents.split(' '):[],operation};
 });
 const head=rows[0]?.revision;
 requireProof(head===observedRevision&&await git(['rev-parse','HEAD'])===head,'history_unsettled','Project history changed during the read; inspect again without input',['observe']);
 const index=rows.findIndex(r=>r.revision===baselineRevision),complete=index>=0;
 if(complete)requireProof(rows.slice(0,index).every((r,i)=>r.parents.length===1&&r.parents[0]===rows[i+1].revision),'unsupported_history','A merge or discontinuity requires review',['inspect']);
 return {question:'timeline-history',head,baselineRevision,complete,stepsRemaining:complete?index:null,commits:rows.slice(0,complete?index:8).map((r,i)=>({revision:r.revision,parent:r.parents.length===1?r.parents[0]:null,operation:r.operation,empty:rows[i+1]?r.tree===rows[i+1].tree:null})),limit:8,
  guidance:'Each history step is separate, including an empty Save. Review known commits, guard current focus, and verify the new history/domain state after each Undo. This readback performs no input or reservation.'};
}
