// Deliberately interrupts only a newly admitted owned worker. Never accepts a PID from the caller.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {ROOT,externalPath} from '../runner/files.mjs';
import {client,resultSummary} from './smoke.mjs';
const arg=k=>process.argv[process.argv.indexOf(k)+1];
if(['--plan','--check','--out','--server'].some(k=>!process.argv.includes(k)||!arg(k)||arg(k).startsWith('--')))throw Error('Usage: node scripts/verify-interruption.mjs --server http://127.0.0.1:PORT --plan FILE --check ID --out FILE');
// Require an explicit service: this probe deliberately kills its newly admitted worker.
const output=externalPath(path.resolve(arg('--out')));
const plan=JSON.parse(await readFile(arg('--plan'),'utf8')),call=client(arg('--server')),id=arg('--check');
assert(plan.recipe.cases.some(c=>c.id===id),'Trigger must belong to the frozen selection');
const admitted=await call('/api/runner/start',{planHash:plan.planHash,operator:'Abrupt-interruption verification',requestId:'interruption-'+crypto.randomUUID()});
let interrupted=false,worker,owned=[];
for(let i=0;i<1800;i++){
 const run=await call('/api/runs/'+admitted.runId);
 if(run.results.some(r=>r.test_id===id&&r.status==='Running')){
  owned=(await readFile(path.join(run.execution.artifact_root,'owned-processes.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).filter(p=>{
   try{return execFileSync('/bin/ps',['-p',String(p.pid),'-o','command='],{encoding:'utf8'}).trim()===p.command&&execFileSync('/bin/ps',['-p',String(p.pid),'-o','lstart='],{encoding:'utf8'}).trim()===p.started;}catch{return false;}
  });
  if(id==='IN-01'&&!owned.some(p=>p.group)){await new Promise(r=>setTimeout(r,100));continue;}
  worker=run.execution.pid;
  const command=execFileSync('/bin/ps',['-p',String(worker),'-o','command='],{encoding:'utf8'}).trim();
  assert(command.includes(path.join(ROOT,'runner/run.mjs'))&&command.includes('--run-id '+admitted.runId),'Worker identity changed; refusing to signal');
  process.kill(worker,'SIGKILL');interrupted=true;break;
 }
 if(resultSummary(run).complete)break;
 await new Promise(r=>setTimeout(r,100));
}
assert(interrupted,'Trigger was not reached; no interruption evidence established');
await new Promise(r=>setTimeout(r,200));
const run=await call('/api/runs/'+admitted.runId),summary=resultSummary(run);
assert.equal(summary.state,'Unknown');assert.equal(summary.results.find(r=>r.id===id).status,'Unknown');assert.equal(summary.results.find(r=>r.id==='A-CLI-01').status,'Pass');
assert(summary.results.slice(summary.results.findIndex(r=>r.id===id)+1).every(r=>r.status==='Blocked'),'Later checks must stay blocked after interruption');
const cleanup=JSON.parse(await readFile(path.join(run.execution.artifact_root,'interruption-cleanup.json'),'utf8'));
for(const p of owned)assert(cleanup.attempts.some(a=>a.pid===p.pid&&a.signal),'Owned process was not verified for cleanup: '+p.pid);
for(const child of cleanup.attempts.filter(a=>a.signal)){
 let alive=true;for(let i=0;i<100;i++){try{process.kill(child.pid,0);}catch(e){if(e.code==='ESRCH'){alive=false;break;}throw e;}await new Promise(r=>setTimeout(r,100));}
 assert.equal(alive,false,'Owned child survived interruption cleanup: '+child.pid);
}
const report=await call('/api/runs/'+admitted.runId+'/report',{});
await writeFile(output,JSON.stringify({summary,cleanup,report,worker,owned},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runId:run.id,state:summary.state,counts:summary.counts,cleanup:cleanup.attempts.filter(a=>a.signal),report}));
