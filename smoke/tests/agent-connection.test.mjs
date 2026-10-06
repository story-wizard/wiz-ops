import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {Readable,Writable} from 'node:stream';
import {agentSequence,serveAgentTools,validateSequence} from '../desktop/agent-connection.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {waitForObservation} from '../desktop/check-support.mjs';
import {checkAgentPlan,runAgentPlan} from '../desktop/agent-plan.mjs';

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
 assert.equal(replies[0].result.connection.sequencePlanning.checkCommand[2],'batch-check');
}));
test('CLI compact batches retain replies without requiring a Wizard process',async()=>fixture(async file=>{
 const stepsFile=file.replace('session.json','steps.json');await writeFile(stepsFile,JSON.stringify([{operation:'context'}]));
 const reply=JSON.parse(execFileSync(process.execPath,[new URL('../desktop/session.mjs',import.meta.url).pathname,'batch',file,stepsFile,'--compact'],{encoding:'utf8',timeout:10000}));
 assert.equal(reply.status,'Completed');assert.equal(reply.encoding,'compact');assert.equal(reply.results,undefined);assert.equal(JSON.parse(await readFile(reply.receipt.path,'utf8')).results.length,1);
}));
test('connection rejects ambiguous requests and unsupported keys before touching the session',async()=>fixture(async file=>{
 let output='';const lines=[{id:'ambiguous',operation:'context',steps:[{operation:'context'}]},{id:'unknown',operation:'context',override:true},{operation:'context'},{id:'invalid-compact',steps:[{operation:'context'}],compact:null},{id:'not-sequence',operation:'context',compact:true}];
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
 const plan={format:'athanor-agent-plan/v1',start:'edit',maxDurationMs:30,phases:[{id:'edit',steps:[{operation:'physical',params:{command:'click'}},{operation:'physical',params:{command:'key',key:'right'}}],next:null}]};
 let calls=0;const reply=await runAgentPlan(file,plan,async()=>{calls++;await new Promise(r=>setTimeout(r,60));return {status:'Dispatched'};});
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
