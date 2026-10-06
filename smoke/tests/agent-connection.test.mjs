import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {Readable,Writable} from 'node:stream';
import {agentSequence,serveAgentTools,validateSequence} from '../desktop/agent-connection.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {waitForObservation} from '../desktop/check-support.mjs';

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
