// Deliberately interrupts only a newly admitted owned worker. Never accepts a PID from the caller.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {ROOT} from '../runner/files.mjs';
import {client,resultSummary} from './smoke.mjs';
const arg=k=>process.argv[process.argv.indexOf(k)+1];
if(!process.argv.includes('--plan')||!process.argv.includes('--check')||!process.argv.includes('--out'))throw Error('Usage: node scripts/verify-interruption.mjs --plan FILE --check ID --out FILE');
const plan=JSON.parse(await readFile(arg('--plan'),'utf8')),call=client(),id=arg('--check');
assert(plan.recipe.cases.some(c=>c.id===id),'Trigger must belong to the frozen selection');
const admitted=await call('/api/runner/start',{planHash:plan.planHash,operator:'Abrupt-interruption verification',requestId:'interruption-'+crypto.randomUUID()});
let interrupted=false,worker;
for(let i=0;i<1800;i++){
 const run=await call('/api/runs/'+admitted.runId);
 if(run.results.some(r=>r.test_id===id&&r.status==='Running')){
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
const cleanup=JSON.parse(await readFile(path.join(run.execution.artifact_root,'interruption-cleanup.json'),'utf8'));
for(const child of cleanup.attempts.filter(a=>a.signal)){
 let alive=true;for(let i=0;i<100;i++){try{process.kill(child.pid,0);}catch(e){if(e.code==='ESRCH'){alive=false;break;}throw e;}await new Promise(r=>setTimeout(r,100));}
 assert.equal(alive,false,'Owned child survived interruption cleanup: '+child.pid);
}
const report=await call('/api/runs/'+admitted.runId+'/report',{});
await writeFile(arg('--out'),JSON.stringify({summary,cleanup,report,worker},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runId:run.id,state:summary.state,counts:summary.counts,cleanup:cleanup.attempts.filter(a=>a.signal),report}));
