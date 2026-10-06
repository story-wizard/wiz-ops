import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath,symlink} from 'node:fs/promises';
import {Readable,Writable} from 'node:stream';
import {agentSequence,serveAgentTools,validateSequence,compactToolResult,resultPreview,sequenceSummary} from '../desktop/agent-connection.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {waitForObservation} from '../desktop/check-support.mjs';
import {readyUI} from '../desktop/agent-tools.mjs';
import {checkAgentPlan,runAgentPlan,inspectAgentPlan} from '../desktop/agent-plan.mjs';
import {compileAgentRecipe,checkAgentRecipe,compileAgentWorkflow,checkAgentWorkflow} from '../desktop/agent-recipes.mjs';

async function fixture(run){
 const data=await realpath(await mkdtemp('/private/tmp/athanor-connection-')),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=data+'/session',bundle=root+'/Golden.wiz',native=root+'/native';await mkdir(bundle,{recursive:true});await mkdir(native);
  const file=root+'/session.json';await writeFile(file,JSON.stringify({dataDir:data,root,bundle,native,executable:root+'/Wizard Smoke.app/Contents/MacOS/wizard',plan:{cases:['D-CLI-01']},schema:{operations:{'project.get_name':{properties:{}}}}}));
  await writeFile(native+'/ready.json',JSON.stringify({capabilities:{}}));await run(file);
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
}
test('sequences reject malformed later steps before executing the first step',async()=>fixture(async file=>{
 for(const steps of [[],Array(9).fill({operation:'context'}),[{operation:'context'},{operation:'physical',params:{command:'click',invented:true}}],[{operation:'context'},{operation:'batch'}],[{operation:'context'},{operation:'call',params:{operation:'spellbook.list'}}],[{operation:'context',expect:{path:['absent']}}]]){
  let calls=0;await assert.rejects(()=>agentSequence(file,steps,async()=>{calls++;}));assert.equal(calls,0);
 }
 assert.throws(()=>validateSequence([{operation:'physical',params:{text:'x'.repeat(65536)}}]));
}));
test('sequence steps remain ordered and a false readback prevents the dependent edit',async()=>fixture(async file=>{
 const seen=[],steps=[{operation:'physical',params:{command:'click'}},{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'expected'}},{operation:'physical',params:{command:'key',key:'cmd+z'}}];
 const reply=await agentSequence(file,steps,async(_file,op)=>{seen.push(op);return op==='call'?{name:'wrong'}:{status:'Dispatched'};});
 assert.deepEqual(seen,['physical','call']);assert.equal(reply.status,'Fail');assert.equal(reply.stoppedAt,1);assert.equal(reply.remaining,1);assert.equal(reply.results[1].expectation.matched,false);
 assert.equal(reply.summary.continuation.state,'inspect_failure');assert.equal(reply.summary.steps[1].gateMatched,false);assert.deepEqual(reply.summary.returnedMutationIndexes,[0]);
 const complete=await agentSequence(file,steps,async(_file,op)=>op==='call'?{name:'expected'}:{status:'Dispatched'});assert.equal(complete.status,'Completed');assert.equal(complete.results.length,3);
}));
test('batch-check validates without resolving targets, evaluating gates or changing session state',async()=>fixture(async file=>{
 const stepsFile=file.replace('session.json','steps.json'),before=await readFile(file,'utf8');
 // No Wizard process or usable native driver exists. The first input cannot execute.
 await writeFile(stepsFile,JSON.stringify([{operation:'physical',params:{command:'click',target:{id:'not-a-live-target'}}},{operation:'context'},{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'not-the-current-name'}}]));
 const listing=await readdir(file.replace('/session.json','')),cli=new URL('../desktop/session.mjs',import.meta.url);
 const reply=JSON.parse(execFileSync(process.execPath,[cli.pathname,'batch-check',file,stepsFile],{encoding:'utf8',timeout:10000}));
 assert.equal(reply.status,'Valid');assert.equal(reply.executed,false);assert.equal(reply.validation,'parameters-and-schema');assert.equal(reply.steps,3);assert.deepEqual(reply.gateIndexes,[2]);
 await writeFile(stepsFile,JSON.stringify([{operation:'context'},{operation:'call',params:{operation:'unsupported.operation'}}]));
 assert.throws(()=>execFileSync(process.execPath,[cli.pathname,'batch-check',file,stepsFile],{encoding:'utf8',timeout:10000}),error=>error.status===3&&JSON.parse(error.stdout).status==='Blocked');
 assert.equal(await readFile(file,'utf8'),before);assert.deepEqual(await readdir(file.replace('/session.json','')),listing);
}));
test('Unknown is retained without replay, later operations or automatic resolution',async()=>fixture(async file=>{
 let calls=0;const reply=await agentSequence(file,[{operation:'physical',params:{command:'click'}},{operation:'physical',params:{command:'click'}}],async()=>{calls++;throw Object.assign(Error('Lost input response'),{status:'Unknown',code:'input_focus_lost',diagnostics:{actionId:'original'},evidence:{file:'original.json'}});});
 assert.equal(calls,1);assert.equal(reply.status,'Unknown');assert.equal(reply.failure.diagnostics.actionId,'original');assert.equal(reply.failure.evidence.file,'original.json');assert.equal(reply.results.length,1);
 assert.equal(reply.summary.continuation.state,'reconcile_unknown');assert.equal(reply.summary.uncertainStep,0);assert.equal(reply.summary.continuation.automatic,false);
}));
test('compact receipts retain exact large results and evidence while returning a small checkpoint summary',async()=>fixture(async file=>{
 const steps=[{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'expected'}},{operation:'capture',params:{target:{class:'MainWindow'}}}];
 const image={path:file.replace('session.json','image.png'),sha256:'b'.repeat(64),kind:'image',assertion:'changed'};
 const reply=await agentSequence(file,steps,async(_f,op)=>op==='call'?{name:'expected',large:'x'.repeat(20000)}:image,{compact:true});
 assert.equal(reply.status,'Completed');assert.equal(reply.encoding,'compact');assert.equal(reply.results,undefined);assert.equal(reply.summary.continuation.state,'review_checkpoint');assert.equal(reply.summary.continuation.automatic,false);
 assert.equal(reply.summary.steps[0].gateMatched,true);assert.deepEqual(reply.summary.returnedMutationIndexes,[]);assert.equal(reply.summary.evidence[0].path,image.path);
 const raw=await readFile(reply.receipt.path,'utf8'),retained=JSON.parse(raw);assert.equal(retained.results[0].result.large.length,20000);assert.deepEqual(retained.steps,steps);assert.equal(reply.receipt.sha256,createHash('sha256').update(raw).digest('hex'));
 assert(Buffer.byteLength(JSON.stringify(reply))<Buffer.byteLength(raw)/5);
}));
test('wait timeout and stale binding stop dependent input and preserve earlier returned mutations',async()=>fixture(async file=>{
 for(const failure of ['wait','binding']){
  const steps=[{operation:'physical',params:{command:'click'}},{operation:failure==='wait'?'wait':'physical',params:failure==='wait'?{selector:{name:'dialog'},timeoutMs:1}:{command:'click'}},{operation:'physical',params:{command:'key',key:'cmd+z'}}];
  let calls=0;const reply=await agentSequence(file,steps,async()=>{
   calls++;if(calls===1)return {status:'Dispatched'};
   if(failure==='wait')return waitForObservation(async()=>null,{timeoutMs:1,intervalMs:1});
   throw Object.assign(Error('Binding rejected before dispatch'),{status:'Blocked',code:'input_binding_rejected'});
  });
  assert.equal(calls,2);assert.equal(reply.status,'Blocked');assert.equal(reply.stoppedAt,1);assert.equal(reply.remaining,1);assert.deepEqual(reply.summary.returnedMutationIndexes,[0]);assert.equal(reply.summary.continuation.state,failure==='wait'?'inspect_blocker':'rebind_target');assert.equal(reply.summary.continuation.automatic,false);
 }
}));
test('compact Unknown retains full failure diagnostics and cannot hide uncertainty behind a malformed title',async()=>fixture(async file=>{
 const reply=await agentSequence(file,[{operation:'physical',params:{command:'click',title:{malformed:true}}},{operation:'physical',params:{command:'click'}}],async()=>{throw Object.assign(Error('Lost response'),{status:'Unknown',code:'input_focus_lost',diagnostics:{actionId:'original',large:'x'.repeat(20000)}});},{compact:true});
 assert.equal(reply.status,'Unknown');assert.equal(reply.summary.continuation.state,'reconcile_unknown');assert.equal(reply.summary.uncertainStep,0);assert.equal(reply.failure.diagnostics,undefined);assert.equal(reply.remaining,1);
 const retained=JSON.parse(await readFile(reply.receipt.path,'utf8'));assert.equal(retained.failure.diagnostics.actionId,'original');assert.equal(retained.failure.diagnostics.large.length,20000);
}));
test('receipt storage failure returns full known outcome and never replays the operation',async()=>fixture(async file=>{
 let calls=0;const reply=await agentSequence(file,[{operation:'context'}],async()=>{
  calls++;const root=file.replace('/session.json','');for(const name of await readdir(root))if(name.startsWith('sequence-'))await rm(root+'/'+name,{recursive:true});return {value:'retained-in-response'};
 },{compact:true});
 assert.equal(calls,1);assert.equal(reply.status,'Completed');assert.equal(reply.retentionError.code,'receipt_retention_failed');assert.equal(reply.summary.continuation.state,'retain_receipt');assert.equal(reply.results[0].result.value,'retained-in-response');assert.equal(reply.receipt,undefined);
}));
test('JSON-lines connection handles chunked UTF-8, invalid and oversized lines, and subsequent requests',async()=>fixture(async file=>{
 const requests=[{id:'first',operation:'context'},{id:'é✨',steps:[{operation:'context',expect:{path:['format'],equals:'athanor-agent-session/v1'}}]},{id:'compact',compact:true,steps:[{operation:'context'}]}];
 const wire=Buffer.from(JSON.stringify(requests[0])+'\n{invalid\n'+'x'.repeat(65537)+'\n'+JSON.stringify(requests[1])+'\n'+JSON.stringify(requests[2]));let output='';
 const chunks=[];for(let i=0;i<wire.length;i+=13)chunks.push(wire.subarray(i,i+13));
 await serveAgentTools(file,Readable.from(chunks),new Writable({write(chunk,_encoding,done){output+=chunk;done();}}));
 const replies=output.trim().split('\n').map(JSON.parse);assert.equal(replies.length,5);assert.equal(replies[0].id,'first');assert.equal(replies[1].code,'invalid_json');assert.equal(replies[2].code,'request_too_large');assert.equal(replies[3].id,'é✨');assert.equal(replies[3].status,'Completed');
 assert.equal(replies[4].id,'compact');assert.equal(replies[4].encoding,'compact');assert.equal(JSON.parse(await readFile(replies[4].receipt.path,'utf8')).results[0].result.format,'athanor-agent-session/v1');
 assert.deepEqual(replies[0].result.readOnlyOperations,['project.get_name']);assert.match(replies[0].result.connection.requestIds,/not idempotent/);
 const stepsFile=file.replace('session.json','connection-steps.json');await writeFile(stepsFile,JSON.stringify([{operation:'context'}]));
 const command=[...replies[0].result.connection.sequencePlanning.checkCommand.slice(0,-1),stepsFile];
 const checked=JSON.parse(execFileSync(command[0],command.slice(1),{cwd:file.replace('/session.json',''),env:{...process.env,SMOKE_DATA_DIR:'/missing-workspace'},encoding:'utf8',timeout:10000}));assert.equal(checked.status,'Valid');assert.equal(checked.executed,false);
}));
test('CLI compact batches retain replies without requiring a Wizard process',async()=>fixture(async file=>{
 const stepsFile=file.replace('session.json','steps.json');await writeFile(stepsFile,JSON.stringify([{operation:'context'}]));
 const reply=JSON.parse(execFileSync(process.execPath,[new URL('../desktop/session.mjs',import.meta.url).pathname,'batch',file,stepsFile,'--compact'],{encoding:'utf8',timeout:10000}));
 assert.equal(reply.status,'Completed');assert.equal(reply.encoding,'compact');assert.equal(reply.results,undefined);assert.equal(JSON.parse(await readFile(reply.receipt.path,'utf8')).results.length,1);
}));
test('connection rejects ambiguous requests and unsupported keys before touching the session',async()=>fixture(async file=>{
 let output='';const lines=[{id:'ambiguous',operation:'context',steps:[{operation:'context'}]},{id:'unknown',operation:'context',override:true},{operation:'context'},{id:'invalid-compact',steps:[{operation:'context'}],compact:null},{id:'invalid-tool-compact',operation:'context',compact:'true'}];
 await serveAgentTools(file,Readable.from([lines.map(JSON.stringify).join('\n')+'\n']),new Writable({write(chunk,_encoding,done){output+=chunk;done();}}));
 const replies=output.trim().split('\n').map(JSON.parse);assert.deepEqual(replies.map(r=>r.status),Array(5).fill('Blocked'));
 await assert.rejects(()=>readFile(file.replace('session.json','agent-context.json')),e=>e.code==='ENOENT');
}));
test('Swift process checks retain exact output and reject a missing process without GUI input',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-process-check-');
 try{
  const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),helper=source.slice(source.indexOf('func ps('),source.indexOf('func canonicalExecutable('));
  await writeFile(root+'/probe.swift','import Foundation\nfunc require(_ condition:Bool,_ message:String)throws{if !condition{throw NSError(domain:message,code:1)}}\n'+helper+'\n@main struct Probe {static func main()async throws{let pid=String(getpid());let value=try ps(["-p",pid,"-o","comm="]);precondition(value==CommandLine.arguments[0]);do{_=try ps(["-p","2147483647","-o","comm="]);fatalError("Accepted missing process")}catch{};print("Process checks verified")}}\n');
  execFileSync('/usr/bin/swiftc',['-parse-as-library','-module-cache-path',root+'/module-cache',root+'/probe.swift','-o',root+'/probe'],{timeout:60000});
  assert.match(execFileSync(root+'/probe',{encoding:'utf8',timeout:10000}),/Process checks verified/);
 }finally{await rm(root,{recursive:true,force:true});}
});

const routingPlan=()=>({format:'athanor-agent-plan/v1',start:'inspect',phases:[
 {id:'inspect',steps:[{operation:'call',params:{operation:'project.get_name'}}],next:{step:0,path:['name'],cases:[{equals:'ready',phase:'use'},{equals:'needs-focus',phase:'focus'}]}},
 {id:'focus',steps:[{operation:'physical',params:{command:'click'}}],next:'use'},
 {id:'use',steps:[{operation:'capture'}],next:null}
]});
test('plans choose both authored paths from readback and retain exact results and branch evidence',async()=>fixture(async file=>{
 for(const name of ['ready','needs-focus']){
  const seen=[],reply=await runAgentPlan(file,routingPlan(),async(_f,operation)=>{seen.push(operation);return operation==='call'?{name}:{status:'Returned',detail:'x'.repeat(10000)};},{compact:true});
  assert.equal(reply.status,'Completed');assert.equal(reply.encoding,'compact');assert.equal(reply.summary.continuation.state,'review_checkpoint');assert.equal(reply.summary.continuation.automatic,false);
  assert.deepEqual(seen,name==='ready'?['call','capture']:['call','physical','capture']);
  assert.equal(reply.summary.phases[0].branch.actual,name);assert.equal(reply.summary.phases[0].branch.next,name==='ready'?'use':'focus');
  const bytes=await readFile(reply.receipt.path);assert.equal(reply.receipt.sha256,createHash('sha256').update(bytes).digest('hex'));
  const full=JSON.parse(bytes);assert.deepEqual(full.plan,routingPlan());assert.equal(full.phases.at(-1).result.results[0].result.detail.length,10000);assert.equal(JSON.parse(await readFile(reply.progress,'utf8')).status,'Completed');
 }
}));
test('all paths, budgets, destinations and read-only branch sources validate before any tool dispatch',async()=>fixture(async file=>{
 const invalid=[];let p=routingPlan();p.phases[1].steps=[{operation:'call',params:{operation:'unsupported.operation'}}];invalid.push(p);
 p=routingPlan();p.phases[2].next='inspect';invalid.push(p);
 p=routingPlan();p.phases[1].next='missing';invalid.push(p);
 p=routingPlan();p.phases.push({id:'unused',steps:[{operation:'capture'}],next:null});invalid.push(p);
 p=routingPlan();p.phases[0].steps=[{operation:'physical',params:{command:'key',key:'right'}}];invalid.push(p);
 p=routingPlan();p.phases[0].steps=[{operation:'observe',params:{since:'old'}}];invalid.push(p);
 p=routingPlan();p.phases[0].next.cases[1].equals='ready';invalid.push(p);
 p=routingPlan();p.phases[0].steps.push({operation:'physical',params:{command:'click'}});invalid.push(p);
 p=routingPlan();p.maxDurationMs=120001;invalid.push(p);
 p=routingPlan();p.phases[1].id='inspect';invalid.push(p);
 for(const plan of invalid){let calls=0;await assert.rejects(()=>runAgentPlan(file,plan,async()=>{calls++;}));assert.equal(calls,0);}
}));
test('missing, unexpected, delta and incomplete branch observations never select a fallback input',async()=>fixture(async file=>{
 const values=[{}, {name:'unexpected'}, {name:'ready',encoding:'delta'}, {name:'ready',truncated:true}, {name:'ready',inspectionIncomplete:true}, {name:'ready',rows:[{modelTruncated:true}]},{name:'ready',next_cursor:'more'},{name:'ready',hasMore:true},{name:'ready',model:[],offset:64},{name:'ready',completion:'partial'}];
 for(const value of values){let calls=0;const reply=await runAgentPlan(file,routingPlan(),async()=>{calls++;return value;});assert.equal(calls,1);assert.equal(reply.status,'Blocked');assert.equal(reply.summary.continuation.automatic,false);assert.equal(reply.phases[0].branch,undefined);}
}));
test('plans preserve Unknown and Fail prefixes without executing another phase or taking a recovery branch',async()=>fixture(async file=>{
 for(const status of ['Unknown','Fail']){
  const plan=routingPlan();plan.phases[0].steps.unshift({operation:'physical',params:{command:'click'}});plan.phases[0].next.step=1;
  if(status==='Fail')plan.phases[0].steps[1].expect={path:['name'],equals:'never'};
  let calls=0;const reply=await runAgentPlan(file,plan,async(_f,op)=>{
   calls++;if(op==='physical'){if(status==='Unknown')throw Object.assign(Error('Lost input response'),{status:'Unknown',code:'input_focus_lost'});return {status:'Dispatched'};}return {name:'needs-focus'};
  });
  assert.equal(reply.status,status);assert.equal(calls,status==='Unknown'?1:2);assert.equal(reply.phases.length,1);assert.equal(reply.phases[0].branch,undefined);assert.equal(reply.summary.continuation.state,status==='Unknown'?'reconcile_unknown':'inspect_failure');assert.equal(reply.summary.continuation.automatic,false);
  assert.deepEqual(reply.phases[0].result.summary.returnedMutationIndexes,status==='Unknown'?[]:[0]);
 }
}));
test('plan budget expires between steps without cancelling or replaying a returned edit',async()=>fixture(async file=>{
 const plan={format:'athanor-agent-plan/v1',start:'edit',maxDurationMs:300,phases:[{id:'edit',steps:[{operation:'physical',params:{command:'click'}},{operation:'physical',params:{command:'key',key:'right'}}],next:null}]};
 let calls=0;const reply=await runAgentPlan(file,plan,async()=>{calls++;await new Promise(r=>setTimeout(r,400));return {status:'Dispatched'};});
 assert.equal(calls,1);assert.equal(reply.status,'Blocked');assert.equal(reply.failure.code,'plan_budget_exceeded');assert.deepEqual(reply.phases[0].result.summary.returnedMutationIndexes,[0]);
}));
test('a stale input binding stops the plan at that phase without executing downstream work',async()=>fixture(async file=>{
 const seen=[],reply=await runAgentPlan(file,routingPlan(),async(_file,op)=>{seen.push(op);if(op==='physical')throw Object.assign(Error('Rejected before dispatch'),{status:'Blocked',code:'input_binding_rejected'});return {name:'needs-focus'};});
 assert.deepEqual(seen,['call','physical']);assert.equal(reply.status,'Blocked');assert.equal(reply.summary.continuation.state,'rebind_target');assert.equal(reply.failure.phase,'focus');assert.equal(reply.phases.length,2);assert.equal(reply.phases[1].result.completed,0);
}));
test('plan retention failure stops before the next phase and returns known effects',async()=>fixture(async file=>{
 let calls=0;const plan=routingPlan(),reply=await runAgentPlan(file,plan,async()=>{
  calls++;const root=file.replace('/session.json','');for(const name of await readdir(root))if(name.startsWith('plan-'))await rm(root+'/'+name,{recursive:true});return {name:'needs-focus'};
 },{compact:true});
 assert.equal(calls,1);assert.equal(reply.status,'Blocked');assert.equal(reply.phases[0].result.status,'Completed');assert.equal(reply.phases[0].result.results[0].result.name,'needs-focus');assert.equal(reply.retentionError.code,'receipt_retention_failed');assert.equal(reply.summary.continuation.state,'retain_receipt');
}));
test('plan-check exposes advisory gates and evidence without resolving targets or writing',async()=>fixture(async file=>{
 const plan=routingPlan(),before=await readFile(file,'utf8'),listing=await readdir(file.replace('/session.json',''));const result=await checkAgentPlan(file,plan);
 assert.equal(result.status,'Valid');assert.equal(result.executed,false);assert.deepEqual(result.phases[1].mutationIndexes,[0]);assert(result.phases[1].advice.some(a=>a.code==='precondition_gate'));assert(result.phases[1].advice.some(a=>a.code==='outcome_gate'));assert(result.phases[1].advice.some(a=>a.code==='capture_checkpoint'));
 assert.equal(await readFile(file,'utf8'),before);assert.deepEqual(await readdir(file.replace('/session.json','')),listing);
}));
test('CLI and JSON-lines expose plans and reject ambiguous plan requests before input',async()=>fixture(async file=>{
 const plan={format:'athanor-agent-plan/v1',start:'context',phases:[{id:'context',steps:[{operation:'context'}],next:null}]},planFile=file.replace('session.json','plan.json');await writeFile(planFile,JSON.stringify(plan));
 const cli=new URL('../desktop/session.mjs',import.meta.url).pathname;
 const check=JSON.parse(execFileSync(process.execPath,[cli,'plan-check',file,planFile],{encoding:'utf8',timeout:10000}));assert.equal(check.executed,false);
 const reply=JSON.parse(execFileSync(process.execPath,[cli,'plan',file,planFile,'--compact'],{encoding:'utf8',timeout:10000}));assert.equal(reply.status,'Completed');assert.equal(reply.encoding,'compact');
 let output='';await serveAgentTools(file,Readable.from([JSON.stringify({id:'plan',plan,compact:true})+'\n'+JSON.stringify({id:'ambiguous',plan,steps:[{operation:'context'}]})+'\n']),new Writable({write(chunk,_e,done){output+=chunk;done();}}));
 const replies=output.trim().split('\n').map(JSON.parse);assert.equal(replies[0].status,'Completed');assert.equal(replies[0].id,'plan');assert.equal(replies[1].status,'Blocked');
}));
test('known plan IDs recover retained outcomes and reject duplicate dispatch including after Unknown',async()=>fixture(async file=>{
 const plan={format:'athanor-agent-plan/v1',start:'edit',phases:[{id:'edit',steps:[{operation:'physical',params:{command:'click'}}],next:null}]};
 for(const status of ['Completed','Unknown']){
  const requestId='recover-'+status;let calls=0;
  const reply=await runAgentPlan(file,plan,async()=>{calls++;if(status==='Unknown')throw Object.assign(Error('Lost response'),{status:'Unknown',code:'input_focus_lost'});return {status:'Returned'};},{compact:true,requestId});
  assert.equal(reply.status,status);const inspected=await inspectAgentPlan(file,requestId);assert.equal(inspected.status,status);assert.equal(inspected.executable,false);assert.equal(inspected.currentSessionMatches,true);assert.equal(inspected.requestId,requestId);assert.equal(inspected.receipt.sha256,reply.receipt.sha256);
  await assert.rejects(()=>runAgentPlan(file,plan,async()=>{calls++;},{requestId}),e=>e.code==='plan_request_exists');assert.equal(calls,1);
 }
}));
test('inspection of active progress exposes returned prefix and pending action without replay or writes',async()=>fixture(async file=>{
 const requestId='interrupted-prefix',plan={format:'athanor-agent-plan/v1',start:'edits',phases:[{id:'edits',steps:[{operation:'physical',params:{command:'click'}},{operation:'physical',params:{command:'key',key:'right'}}],next:null}]};let calls=0;
 await runAgentPlan(file,plan,async()=>{
  calls++;const inspected=await inspectAgentPlan(file,requestId),before=await readFile(inspected.progress,'utf8');
  assert.equal(inspected.status,'Unsettled');assert.equal(inspected.retainedStatus,'Running');assert.equal(inspected.summary.activeStep.index,calls-1);assert.equal(inspected.summary.activeStep.status,'Started');assert.equal(inspected.activeResults.length,calls-1);assert.equal(inspected.executable,false);
  await inspectAgentPlan(file,requestId);assert.equal(await readFile(inspected.progress,'utf8'),before);return {status:'Returned'};
 },{requestId});assert.equal(calls,2);
}));
test('plan identity changes block the next input and retained receipt corruption is rejected',async()=>fixture(async file=>{
 const requestId='identity',plan={format:'athanor-agent-plan/v1',start:'edits',phases:[{id:'edits',steps:[{operation:'physical',params:{command:'click'}},{operation:'physical',params:{command:'key',key:'right'}}],next:null}]};let calls=0;
 const reply=await runAgentPlan(file,plan,async()=>{calls++;const s=JSON.parse(await readFile(file,'utf8'));s.generation=2;await writeFile(file,JSON.stringify(s));return {status:'Returned'};},{requestId});
 assert.equal(calls,1);assert.equal(reply.status,'Blocked');assert.equal(reply.failure.code,'plan_identity_changed');assert.equal((await inspectAgentPlan(file,requestId)).currentSessionMatches,false);
 await writeFile(reply.receipt.path,'{}');await assert.rejects(()=>inspectAgentPlan(file,requestId),e=>e.code==='plan_receipt_mismatch');
}));
test('CLI request IDs and read-only JSON-lines inspection recover a plan without an app',async()=>fixture(async file=>{
 const plan={format:'athanor-agent-plan/v1',start:'context',phases:[{id:'context',steps:[{operation:'context'}],next:null}]},planFile=file.replace('session.json','plan.json');await writeFile(planFile,JSON.stringify(plan));const cli=new URL('../desktop/session.mjs',import.meta.url).pathname;
 const run=JSON.parse(execFileSync(process.execPath,[cli,'plan',file,planFile,'--request-id','cli-known','--compact'],{encoding:'utf8',timeout:10000}));assert.equal(run.requestId,'cli-known');
 const inspect=JSON.parse(execFileSync(process.execPath,[cli,'plan-inspect',file,'cli-known'],{encoding:'utf8',timeout:10000}));assert.equal(inspect.status,'Completed');assert.equal(inspect.executable,false);
 let output='';await serveAgentTools(file,Readable.from([JSON.stringify({id:'read',operation:'plan-inspect',params:{requestId:'cli-known'}})+'\n']),new Writable({write(chunk,_e,done){output+=chunk;done();}}));assert.equal(JSON.parse(output).status,'Completed');assert.equal(JSON.parse(output).id,'read');
}));
test('recipe compilation preserves typed values and all-path validation without app input or writes',async()=>fixture(async file=>{
 const recipe={format:'athanor-agent-recipe/v1',id:'name',parameters:{name:{type:'string'}},plan:{format:'athanor-agent-plan/v1',start:'read',phases:[{id:'read',steps:[{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:{$param:'name'}}}],next:null}]}};
 const before=await readFile(file,'utf8'),listing=await readdir(file.replace('/session.json',''));const compiled=await checkAgentRecipe(file,recipe,{name:'literal $(echo unsafe)'});
 assert.equal(compiled.executed,false);assert.equal(compiled.plan.phases[0].steps[0].expect.equals,'literal $(echo unsafe)');assert.equal(compiled.check.status,'Valid');assert.equal(compiled.recipeHash.length,64);assert.equal(await readFile(file,'utf8'),before);assert.deepEqual(await readdir(file.replace('/session.json','')),listing);
 for(const values of [{},{name:3},{name:'valid',override:true}])assert.throws(()=>compileAgentRecipe(recipe,values));
 const broken=structuredClone(recipe);broken.plan.phases[0].steps[0].params.operation='unsupported.operation';await assert.rejects(()=>checkAgentRecipe(file,broken,{name:'valid'}));
 const unknown=structuredClone(recipe);unknown.plan.start={$param:'unknown'};assert.throws(()=>compileAgentRecipe(unknown,{name:'valid'}));
}));
test('shipped recipe examples compile with typed parameters against the selected schema',async()=>fixture(async file=>{
 const schema=JSON.parse(await readFile(new URL('../runner/contracts/desktop-schema.json',import.meta.url),'utf8')),session=JSON.parse(await readFile(file,'utf8'));session.schema=schema;await writeFile(file,JSON.stringify(session));
 const valuesByRecipe={
  'project-identity':{projectName:'fixture'},
  'media-search':{searchId:'9',query:'motion_25',expectedStatus:'1 match in 1 clip',mediaViewId:'8'},
  'media-search-state':{searchId:'9',query:'motion_25',expectedStatus:'1 match in 1 clip',mediaViewId:'8'},
  'enable-checkbox':{checkbox:{id:'box'},dependentField:{id:'field'}},
  'timeline-undo-save':{timelineTarget:{id:'timeline'},timelineId:'timeline-fixture',baselineTracks:[],captureTarget:{id:'main'}},
  'add-video-track':{projectName:'fixture',timelineId:'timeline-fixture',addSelector:{id:'add'},timelineTarget:{id:'timeline'},captureTarget:{id:'main'},baselineTracks:[],expectedTrackCount:3},
  'inspector-edit':{graphScope:{timeline_id:'timeline-fixture',clip_id:'clip-fixture'},controlTarget:{id:'slider'},previewTarget:{id:'preview'},inspectorTarget:{id:'inspector-window'},thumbX:19,thumbY:7,baselineValue:16,baselineNodes:[],parameterPath:['nodes',0,'params','radius'],baselineTracks:[],timelineId:'timeline-fixture'},
  'timeline-undo':{timelineTarget:{id:'timeline'},timelineId:'timeline-fixture',baselineTracks:[],captureTarget:{id:'main'}}
 };
 for(const [name,values] of Object.entries(valuesByRecipe)){const recipe=JSON.parse(await readFile(new URL('../examples/recipes/'+name+'.json',import.meta.url),'utf8')),compiled=await checkAgentRecipe(file,recipe,values);assert.equal(compiled.status,'Valid');assert.equal(compiled.executed,false);}
}));

const boundPlan=()=>({format:'athanor-agent-plan/v1',start:'find',bindings:{button:{phase:'find',step:0,path:['matches',0,'id'],uniquePath:['matches'],type:'string'}},phases:[
 {id:'find',steps:[{operation:'observe',params:{selector:{name:'Add Video Track'}},expect:{path:['matchCount'],equals:1}}],next:'click'},
 {id:'click',steps:[{operation:'physical',params:{command:'click',target:{id:{$binding:'button'}}}}],next:null}
]});
test('bindings carry unique typed IDs, refresh their exact source and retain provenance before input',async()=>fixture(async file=>{
 const seen=[],requestId='bound-button',reply=await runAgentPlan(file,boundPlan(),async(_f,op,params)=>{seen.push({op,params});return op==='observe'?{matchCount:1,matches:[{id:'observed-button',name:'Add Video Track'}]}:{status:'Dispatched'};},{requestId});
 assert.equal(reply.status,'Completed');assert.deepEqual(seen.map(s=>s.op),['observe','observe','physical']);assert.equal(seen[2].params.target.id,'observed-button');assert.equal(reply.bindings.button.value,'observed-button');assert.equal(reply.bindingReads[0].gate.matched,true);assert.equal((await inspectAgentPlan(file,requestId)).bindingReads.length,1);
}));
test('missing, partial, ambiguous and changed binding readbacks prevent dependent input',async()=>fixture(async file=>{
 for(const fresh of [{matchCount:1,matches:[]},{matchCount:1,matches:[{id:'first'},{id:'other'}]},{matchCount:1,matches:[{id:'first'}],truncated:true},{matchCount:1,matches:[{id:34}]},{matchCount:1,matches:[{id:'changed'}]},{matchCount:0,matches:[{id:'first'}]},{matchCount:1,matches:[{id:'first'}],modalWindow:'new-dialog'}]){
  const seen=[],reply=await runAgentPlan(file,boundPlan(),async(_f,op)=>{seen.push(op);return seen.length===1?{matchCount:1,matches:[{id:'first'}]}:fresh;});assert.equal(reply.status,'Blocked');assert.deepEqual(seen,['observe','observe']);assert.deepEqual(reply.bindingReads[0].result,fresh);assert.equal(reply.phases[0].result.status,'Completed');assert.equal(reply.summary.continuation.automatic,false);
 }
}));
test('invalid binding declarations and unavailable branch paths reject the whole plan before dispatch',async()=>fixture(async file=>{
 const bad=[];for(const key of ['x','text','command','actionId','stepId']){const p=boundPlan();p.phases[1].steps[0].params={[key]:{$binding:'button'}};bad.push(p);}
 for(const edit of [p=>delete p.phases[0].steps[0].expect,p=>p.bindings.button.path=['matches',1,'id'],p=>p.bindings.button.type='object',p=>p.bindings.button.step=9,p=>p.phases[1].steps[0].params.target.id={$binding:'missing'},p=>p.start='click']){const p=boundPlan();edit(p);bad.push(p);}
 const alternate=boundPlan();alternate.start='route';alternate.phases.unshift({id:'route',steps:[{operation:'call',params:{operation:'project.get_name'}}],next:{step:0,path:['name'],cases:[{equals:'find',phase:'find'},{equals:'skip',phase:'click'}]}});bad.push(alternate);
 for(const plan of bad){let calls=0;await assert.rejects(()=>runAgentPlan(file,plan,async()=>{calls++;}));assert.equal(calls,0);}
}));
test('identity change during binding refresh and Unknown at the bound edit never dispatch downstream input',async()=>fixture(async file=>{
 for(const failure of ['identity','Unknown']){const plan=boundPlan();plan.phases[1].steps.push({operation:'physical',params:{command:'key',key:'right'}});let calls=0;
  const reply=await runAgentPlan(file,plan,async(_f,op)=>{calls++;if(op==='physical')throw Object.assign(Error('Lost input response'),{status:'Unknown'});if(failure==='identity'&&calls===2){const s=JSON.parse(await readFile(file,'utf8'));s.generation=(s.generation||0)+1;await writeFile(file,JSON.stringify(s));}return {matchCount:1,matches:[{id:'first'}]};});
  assert.equal(reply.status,failure==='Unknown'?'Unknown':'Blocked');assert.equal(calls,failure==='Unknown'?3:2);assert.equal(reply.summary.continuation.automatic,false);
 }
}));

test('plan inspection rejects completion, receipt and progress links outside its own directory',async()=>fixture(async file=>{
 for(const name of ['completed.json','receipt.json','progress.json']){const requestId='escape-'+name,plan={format:'athanor-agent-plan/v1',start:'read',phases:[{id:'read',steps:[{operation:'context'}],next:null}]},reply=await runAgentPlan(file,plan,async()=>({fixture:true}),{requestId});
  const directory=reply.receipt.path.replace('/receipt.json',''),outside=file.replace('session.json','outside-'+name),original=await readFile(directory+'/'+name);await writeFile(outside,original);await rm(directory+'/'+name);await symlink(outside,directory+'/'+name);if(name==='progress.json')await rm(directory+'/completed.json');
  await assert.rejects(()=>inspectAgentPlan(file,requestId),e=>e.code==='invalid_plan'&&/storage escaped/.test(e.message));
 }
}));
test('CLI rejects a missing plan ID before creating intent or dispatching context',async()=>fixture(async file=>{
 const planFile=file.replace('session.json','bad-cli-plan.json');await writeFile(planFile,JSON.stringify({format:'athanor-agent-plan/v1',start:'read',phases:[{id:'read',steps:[{operation:'context'}],next:null}]}));const before=await readdir(file.replace('/session.json',''));
 assert.throws(()=>execFileSync(process.execPath,[new URL('../desktop/session.mjs',import.meta.url).pathname,'plan',file,planFile,'--request-id','--compact'],{encoding:'utf8'}),e=>e.status===3&&JSON.parse(e.stdout).status==='Blocked');assert.deepEqual(await readdir(file.replace('/session.json','')),before);
}));
test('typed model offsets resolve read-only requests and reject out-of-range offsets before use',async()=>fixture(async file=>{
 const plan={format:'athanor-agent-plan/v1',start:'find',bindings:{row:{phase:'find',step:0,path:['matches',0,'index'],uniquePath:['matches'],type:'integer'}},phases:[{id:'find',steps:[{operation:'observe',params:{selector:{id:'media'}},expect:{path:['matchCount'],equals:1}}],next:'read'},{id:'read',steps:[{operation:'model_value',params:{target:{id:'media'},offset:{$binding:'row'},column:0,role:274}}],next:null}]};
 const seen=[],reply=await runAgentPlan(file,plan,async(_f,op,p)=>{seen.push({op,p});return op==='observe'?{matchCount:1,matches:[{index:2}]}:{available:true,value:'asset'};});assert.equal(reply.status,'Completed');assert.equal(seen.at(-1).p.offset,2);
 let calls=0;const rejected=await runAgentPlan(file,plan,async()=>{calls++;return {matchCount:1,matches:[{index:2147483648}]};});assert.equal(rejected.status,'Blocked');assert.equal(calls,1);
}));

test('Inspector recipe distinguishes an accidental focus edit from the tested keyboard edit',async()=>fixture(async file=>{
 const session=JSON.parse(await readFile(file,'utf8'));session.schema=JSON.parse(await readFile(new URL('../runner/contracts/desktop-schema.json',import.meta.url),'utf8'));await writeFile(file,JSON.stringify(session));
 const recipe=JSON.parse(await readFile(new URL('../examples/recipes/inspector-edit.json',import.meta.url),'utf8')),nodes=[{node_id:'blur',type:'gaussian_blur',params:{radius:16}}],values={graphScope:{timeline_id:'timeline',clip_id:'clip'},controlTarget:{id:'slider'},previewTarget:{id:'preview'},inspectorTarget:{id:'inspector'},thumbX:4,thumbY:5,baselineValue:16,baselineNodes:nodes,parameterPath:['nodes',0,'params','radius'],baselineTracks:[],timelineId:'timeline'};
 for(const accidentalFocusEdit of [true,false]){let radius=16;const keys=[];const reply=await runAgentPlan(file,compileAgentRecipe(recipe,values).plan,async(_f,op,p)=>{
  if(op==='call')return p.operation==='graph.get_clip_graph'?{nodes:[{...nodes[0],params:{radius}}]}:{tracks:[]};
  if(op==='physical'){if(p.command==='click'&&accidentalFocusEdit)radius=32;if(p.command==='key'){keys.push(p.key);radius++;}return {status:'Dispatched'};}return {kind:'image'};
 });
 assert.equal(reply.status,accidentalFocusEdit?'Fail':'Completed');assert.deepEqual(keys,accidentalFocusEdit?[]:['right']);if(accidentalFocusEdit)assert.equal(reply.phases[0].result.stoppedAt,2);
 }
}));

const guardRecipe=()=>({format:'athanor-agent-recipe/v1',id:'project-guard',parameters:{name:{type:'string'}},continueAfter:['read'],plan:{format:'athanor-agent-plan/v1',start:'read',phases:[{id:'read',steps:[{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:{$param:'name'}}}],next:null}]}});
const workflowPart=(id,recipe=guardRecipe())=>({id,recipe,values:{name:'expected'}});
test('workflow composition preserves recipes, gates, bindings and captures while default exits remain review stops',async()=>fixture(async file=>{
 const bound={format:'athanor-agent-recipe/v1',id:'bound',parameters:{},plan:boundPlan()},undo={format:'athanor-agent-recipe/v1',id:'undo',parameters:{},plan:{format:'athanor-agent-plan/v1',start:'read',phases:[{id:'read',steps:[{operation:'physical',params:{command:'key',key:'cmd+z'}},{operation:'capture',params:{target:{class:'MainWindow'}}}],next:null}]}};
 const workflow={format:'athanor-agent-workflow/v1',parts:[workflowPart('guard'),{id:'edit',recipe:bound,values:{}},{id:'undo',recipe:undo,values:{}}]},before=structuredClone(workflow),compiled=await checkAgentWorkflow(file,workflow);
 assert.deepEqual(workflow,before);assert.equal(compiled.planRequests,2);assert.equal(compiled.savedRequests,1);assert.equal(compiled.segments[0].reviewAfter.reason,'recipe_review');assert.deepEqual(compiled.segments[0].reviewAfter.exits,['click']);
 const seen=[],full=await runAgentPlan(file,compiled.segments[0].plan,async(_f,op,p)=>{seen.push({op,p});return op==='call'?{name:'expected'}:op==='observe'?{matchCount:1,matches:[{id:'fresh-button'}]}:{status:'Dispatched'};});
 assert.equal(full.status,'Completed');assert.equal(seen.filter(s=>s.op==='physical').length,1);assert.equal(seen.at(-1).p.target.id,'fresh-button');assert.equal(full.bindingReads.length,1);assert.equal(full.bindingReads[0].gate.matched,true);assert.equal(seen.some(s=>s.p.key==='cmd+z'),false);
 assert.equal(compiled.segments[1].plan.phases[0].steps[1].operation,'capture');
 const incomplete=[];const blocked=await runAgentPlan(file,compiled.segments[0].plan,async(_f,op)=>{incomplete.push(op);return {name:'expected',partial:true};});assert.equal(blocked.status,'Blocked');assert.equal(blocked.failure.code,'incomplete_branch_observation');assert.deepEqual(incomplete,['call']);
 // A false prerequisite or uncertain mutation must still prevent all downstream work.
 for(const failure of ['Fail','Unknown']){const actions=[];const reply=await runAgentPlan(file,compiled.segments[0].plan,async(_f,op)=>{actions.push(op);if(failure==='Unknown')throw Object.assign(Error('lost response'),{status:'Unknown'});return {name:'wrong'};});assert.equal(reply.status,failure);assert.deepEqual(actions,['call']);}
}));
test('workflow namespaces colliding bindings and exact branch destinations without changing literal IDs or branch values',async()=>fixture(async file=>{
 const schema=JSON.parse(await readFile(file,'utf8')).schema,r=guardRecipe();r.plan=routingPlan();r.parameters={};r.continueAfter=['use'];
 // Make both terminal paths safe continuations after their declared readback gate.
 for(const phase of r.plan.phases.filter(p=>p.next===null))phase.steps=[{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'ready'}}];
 const compiled=compileAgentWorkflow({format:'athanor-agent-workflow/v1',parts:[{id:'one',recipe:r,values:{}},workflowPart('two')]},schema);
 assert.equal(compiled.planRequests,1);const actions=[];const reply=await runAgentPlan(file,compiled.segments[0].plan,async()=>{actions.push('read');return {name:'ready'};});assert.equal(reply.status,'Fail');assert.equal(actions.length,3);assert.equal(reply.failure.code,'sequence_expectation_failed');
 const b={format:'athanor-agent-recipe/v1',id:'bound',parameters:{},continueAfter:['click'],plan:boundPlan()};b.plan.phases[1].steps.push({operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'expected'}});
 const repeated=compileAgentWorkflow({format:'athanor-agent-workflow/v1',parts:[{id:'one',recipe:b,values:{}},{id:'two',recipe:b,values:{}}]},schema);let reads=0;const clicks=[];
 const result=await runAgentPlan(file,repeated.segments[0].plan,async(_f,op,p)=>op==='observe'?{matchCount:1,matches:[{id:++reads<=2?'first':'second'}]}:op==='physical'?(clicks.push(p.target.id),{status:'Dispatched'}):{name:'expected'});
 assert.equal(result.status,'Completed');assert.deepEqual(clicks,['first','second']);assert.equal(result.bindingReads.length,2);
}));
test('workflow checker validates later parts before input, rejects unsafe continuations and splits at plan limits',async()=>fixture(async file=>{
 const schema=JSON.parse(await readFile(file,'utf8')).schema,broken=guardRecipe();broken.plan.phases[0].steps[0].params.operation='unsupported';
 assert.throws(()=>compileAgentWorkflow({format:'athanor-agent-workflow/v1',parts:[workflowPart('good'),workflowPart('bad',broken)]},schema));
 for(const change of [r=>r.continueAfter=['missing'],r=>r.continueAfter=['read','read'],r=>delete r.plan.phases[0].steps[0].expect,r=>r.plan.phases[0].steps[0]={operation:'physical',params:{command:'click'}},r=>r.plan.phases[0].steps[0].params.since='old']){const r=guardRecipe();change(r);assert.throws(()=>compileAgentWorkflow({format:'athanor-agent-workflow/v1',parts:[workflowPart('bad',r)]},schema));}
 const large=guardRecipe();large.plan.phases[0].steps=Array(8).fill(large.plan.phases[0].steps[0]);
 const split=compileAgentWorkflow({format:'athanor-agent-workflow/v1',parts:Array.from({length:5},(_,i)=>workflowPart('part'+i,large))},schema);
 assert.equal(split.planRequests,2);assert.equal(split.segments[0].reviewAfter.reason,'plan_limits');assert.equal(split.segments[0].plan.phases.flatMap(p=>p.steps).length,32);assert.equal(split.segments[0].reviewAfter.automatic,false);
 const budget=guardRecipe();budget.plan.maxDurationMs=123;assert.equal(compileAgentWorkflow({format:'athanor-agent-workflow/v1',parts:[workflowPart('short',budget),workflowPart('long')]},schema).segments[0].plan.maxDurationMs,123);
}));
test('workflow CLI and JSON-lines compile without resolving targets, writing state or dispatching an app',async()=>fixture(async file=>{
 const workflow={format:'athanor-agent-workflow/v1',parts:[workflowPart('one'),workflowPart('two')]},input=file.replace('session.json','workflow.json');await writeFile(input,JSON.stringify(workflow));const listing=await readdir(file.replace('/session.json','')),before=await readFile(file,'utf8');
 const result=JSON.parse(execFileSync(process.execPath,[new URL('../desktop/session.mjs',import.meta.url).pathname,'workflow-check',file,input],{encoding:'utf8'}));assert.equal(result.executed,false);assert.equal(result.planRequests,1);
 let output='';await serveAgentTools(file,Readable.from([JSON.stringify({id:'compile',operation:'workflow-check',params:{workflow}})+'\n']),new Writable({write(chunk,_e,done){output+=chunk;done();}}));assert.equal(JSON.parse(output).workflowHash,result.workflowHash);assert.equal(await readFile(file,'utf8'),before);assert.deepEqual(await readdir(file.replace('/session.json','')),listing);
}));

test('single-tool compact replies preserve exact bytes and fall back to known result on storage failure',async()=>fixture(async file=>{
 const result={status:'Observed',rows:Array(100).fill({name:'retained',payload:'x'.repeat(100)}),truncated:true};
 const compact=await compactToolResult(file,'model',result);assert.equal(compact.encoding,'compact');assert.equal(compact.summary.truncated,true);const bytes=await readFile(compact.receipt.path);assert.deepEqual(JSON.parse(bytes).result,result);assert.equal(compact.receipt.sha256,createHash('sha256').update(bytes).digest('hex'));assert(Buffer.byteLength(JSON.stringify(compact))<1000);
 const full=await compactToolResult('/missing/session.json','physical',result);assert.equal(full.encoding,'full');assert.deepEqual(full.result,result);assert.equal(full.retentionError.code,'receipt_retention_failed');
}));
test('compact observations keep useful whole values and never disguise omitted or partial results',async()=>fixture(async file=>{
 const matches=[{id:'field',window:'dialog',text:'expected',enabled:true}],result={matches,inspectionIncomplete:true,large:'x'.repeat(20000)};
 const reply=await compactToolResult(file,'observe',result);
 assert.deepEqual(reply.summary.matches,matches);assert.equal(reply.summary.inspectionIncomplete,true);assert.equal(reply.completeResult,false);assert.equal(reply.omitted[0].field,'large');
 assert.deepEqual(JSON.parse(await readFile(reply.receipt.path)).result,result);
 const many={matches:Array(200).fill(matches[0]),matchCount:200,truncated:false};const preview=resultPreview(many);
 assert.equal(preview.summary.matches,undefined);assert.equal(preview.summary.matchCount,200);assert.equal(preview.omitted[0].items,200);assert.equal(preview.completeResult,false);
 assert(Buffer.byteLength(JSON.stringify(resultPreview('x'.repeat(30000))))<300);
}));
test('phase replies explain gates, return decision values and reference the original capture without recapturing',async()=>fixture(async file=>{
 const steps=[{operation:'physical',params:{command:'click'}},{operation:'wait',params:{selector:{id:'field'},condition:'enabled'}},{operation:'call',params:{operation:'project.get_name'},expect:{path:['name'],equals:'Golden'}},{operation:'capture',params:{target:{id:'window'}}}];
 let captures=0;const artifact={path:'/retained/checkpoint.png',sha256:'a'.repeat(64),kind:'image',revision:4,generation:2,identity:{pid:123},recordedAt:'2026-10-06T00:00:00Z'};
 const reply=await agentSequence(file,steps,async(_f,op)=>op==='call'?{name:'Golden'}:op==='wait'?{id:'field',enabled:true}:op==='capture'?(captures++,artifact):{status:'Dispatched'},{compact:true});
 assert.equal(captures,1);assert.equal(reply.summary.steps[1].observation.result.enabled,true);assert.deepEqual(reply.summary.steps[2].expectation.result,{matched:true,actual:'Golden',expected:{equals:'Golden'},path:['name']});
 assert.equal(reply.summary.steps[2].observation.result.name,'Golden');assert.equal(reply.summary.evidence[0].path,artifact.path);assert.equal(reply.summary.evidence[0].revision,4);assert.deepEqual(reply.summary.evidence[0].identity,{pid:123});
 const measured=sequenceSummary(steps,{...reply,results:steps.map((s,index)=>({index,operation:s.operation,result:{},durationMs:(index+1)*10}))});
 assert.deepEqual(measured.timing.operationMs,{physicalInput:10,wait:20,applicationRead:30,capture:40});assert.equal(measured.timing.totalOperationMs,100);
}));
test('enable-checkbox recipe skips an already enabled checkbox and stops after a failed readiness wait',async()=>fixture(async file=>{
 const recipe=JSON.parse(await readFile(new URL('../examples/recipes/enable-checkbox.json',import.meta.url)));const compiled=compileAgentRecipe(recipe,{checkbox:{id:'box'},dependentField:{id:'field'}});
 for(const initial of [true,false]){
  let checked=initial,clicks=0;
  const reply=await runAgentPlan(file,compiled.plan,async(_f,op,params)=>{
   if(op==='observe')return {matchCount:params.selectors?2:1,matches:params.selectors?[{id:'box',checked},{id:'field',enabled:checked}]:[{id:'box',checked}],truncated:false};
   if(op==='physical'){clicks++;checked=true;return {status:'Dispatched'};}
   return readyUI({widgets:[{id:'box',checked},{id:'field',enabled:checked}]},params);
  },{compact:true,requestId:'checkbox-'+initial});
  assert.equal(reply.status,'Completed');assert.equal(clicks,initial?0:1);assert.equal(reply.summary.phases.at(-1).summary.steps.at(-1).observation.result.matches[1].enabled,true);
 }
 let inputs=0;const stopped=await runAgentPlan(file,compiled.plan,async(_f,op)=>{
  if(op==='observe')return {matchCount:1,matches:[{id:'box',checked:false}]};
  if(op==='physical'){inputs++;return {status:'Dispatched'};}
  throw Object.assign(Error('Field did not become ready'),{status:'Blocked',code:'wait_timeout'});
 },{requestId:'checkbox-not-ready'});
 assert.equal(stopped.status,'Blocked');assert.equal(inputs,1);assert.equal(stopped.continuation.automatic,false);
}));

test('checkbox readiness cannot combine a checked box from one moment with an enabled field from another',async()=>fixture(async file=>{
 const recipe=JSON.parse(await readFile(new URL('../examples/recipes/enable-checkbox.json',import.meta.url)));
 const {plan}=compileAgentRecipe(recipe,{checkbox:{id:'box'},dependentField:{id:'field'}});let reads=0;
 const result=await runAgentPlan(file,plan,async(_f,operation,params)=>{
  if(operation==='observe')return {matchCount:1,matches:[{id:'box',checked:true}],truncated:false};
  assert.equal(operation,'wait');
  return waitForObservation(async()=>readyUI({widgets:[{id:'box',checked:++reads%2===1},{id:'field',enabled:reads%2===0}]},params),{timeoutMs:30,intervalMs:1});
 },{requestId:'non-simultaneous-controls'});
 assert.equal(result.status,'Blocked');assert.equal(result.continuation.automatic,false);assert.ok(reads>1);
}));

test('compact failures retain bounded recovery context without authorizing replay',async()=>fixture(async file=>{
 for(const status of ['Blocked','Unknown']){
  const diagnostics={dispatch:status==='Blocked'?'not_started':'uncertain',expected:{id:'target',x:10},observed:{id:'target',x:20}},evidence={failureScreenshot:'/owned/failure.png'};let calls=0;
  const reply=await agentSequence(file,[{operation:'physical',params:{command:'click'}},{operation:'physical',params:{command:'click'}}],async()=>{calls++;throw Object.assign(Error('Target changed'),{status,code:status==='Blocked'?'input_binding_rejected':'mutation_unknown',diagnostics,evidence,nextActions:status==='Blocked'?['observe']:['verify_resolution']});},{compact:true});
  assert.equal(calls,1);assert.equal(reply.summary.continuation.automatic,false);assert.deepEqual(reply.summary.continuation.context.result,{diagnostics,evidence});assert.equal(reply.summary.continuation.state,status==='Blocked'?'rebind_target':'reconcile_unknown');
 }
 const diagnostics={large:'x'.repeat(12000)};const reply=await agentSequence(file,[{operation:'observe'}],async()=>{throw Object.assign(Error('Large failure'),{status:'Blocked',diagnostics});},{compact:true});
 assert.equal(reply.summary.continuation.context.completeResult,false);assert.equal(reply.summary.continuation.context.omitted[0].field,'diagnostics');assert.deepEqual(JSON.parse(await readFile(reply.receipt.path)).failure.diagnostics,diagnostics);
}));

test('physical search requires its query and completion in one observation before capturing',async()=>fixture(async file=>{
 const recipe=JSON.parse(await readFile(new URL('../examples/recipes/media-search.json',import.meta.url))),{plan}=compileAgentRecipe(recipe,{searchId:'search',mediaViewId:'view',query:'motion',expectedStatus:'1 match'});
 for(const staleQuery of [false,true]){let captures=0;
  const reply=await runAgentPlan(file,plan,async(_f,op,params)=>{
   if(op==='observe')return {matchCount:1,matches:[{id:'search',text:'motion'}],truncated:false};
   if(op==='wait')return waitForObservation(async()=>readyUI({widgets:[{id:'search',text:staleQuery?'other':'motion'},{id:'view',rows:1,model:[['motion.mp4']]},{id:'status',name:'mediaSearchStatus',text:'1 match'}]},params),{timeoutMs:15,intervalMs:1});
   if(op==='capture'){captures++;return {path:'/owned/result.png',sha256:'a'.repeat(64)};}throw Error('Unexpected mutation');
  },{requestId:'search-state-'+staleQuery});
  assert.equal(reply.status,staleQuery?'Blocked':'Completed');assert.equal(captures,staleQuery?0:1);
 }
}));

test('timeline Undo recipes require a focused timeline and carry that guard to keyboard dispatch',async()=>fixture(async file=>{
 const session=JSON.parse(await readFile(file));session.schema=JSON.parse(await readFile(new URL('../runner/contracts/desktop-schema.json',import.meta.url)));await writeFile(file,JSON.stringify(session));
 for(const id of ['timeline-undo','timeline-undo-save'])for(const target of [{class:'MainWindow',focused:false},{class:'MediaSearchField',focused:true},{class:'TimelineWidget',focused:true}]){
  const recipe=JSON.parse(await readFile(new URL('../examples/recipes/'+id+'.json',import.meta.url))),{plan}=compileAgentRecipe(recipe,{timelineTarget:{id:'target'},timelineId:'timeline',baselineTracks:[],captureTarget:{id:'main'}});let keys=[];
  const reply=await runAgentPlan(file,plan,async(_f,op,p)=>{if(op==='wait'){if(!target.focused)throw Object.assign(Error('Wrong focus'),{status:'Blocked'});return target;}if(op==='physical'){keys.push(p);return {status:'Dispatched'};}if(op==='call')return {tracks:[]};return {path:'/owned/result.png',sha256:'a'.repeat(64)};},{requestId:id+'-'+target.class});
  if(target.class==='TimelineWidget'){assert.equal(reply.status,'Completed');assert.equal(keys[0].key,'cmd+z');assert.equal(keys[0].requireFocus,true);}else{assert.notEqual(reply.status,'Completed');assert.equal(keys.length,0);}
 }
}));
