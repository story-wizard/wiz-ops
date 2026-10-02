import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {selectUI,uniqueTarget,compareObservation,exportAgentReport,requirePassProof} from '../desktop/agent-tools.mjs';
import {acquireDesktopLease} from '../desktop/desktop-lease.mjs';

test('agent target queries reject ambiguity and expose limits without shipping the entire UI',()=>{
 const ui={widgets:[{id:'1',class:'Button',text:'Add',window:'main',enabled:true},{id:'2',class:'Button',text:'Add',window:'floating',enabled:true},{id:'3',class:'List',rows:100,model:Array(64).fill(['item']),itemRects:[{x:1,y:2}]}]};
 assert.throws(()=>uniqueTarget(ui,{text:'Add'}),e=>e.status==='Blocked'&&e.diagnostics.matchCount===2);
 assert.equal(uniqueTarget(ui,{text:'Add',window:'main'}).id,'1');
 const compact=selectUI(ui,{limit:1});assert.equal(compact.matchCount,3);assert.equal(compact.truncated,true);
 const list=selectUI(ui,{selector:{class:'List'}}).matches[0];assert.equal(list.model,undefined);assert.equal(list.modelTruncated,true);
 assert.equal(selectUI(ui,{selector:{class:'List'},details:true}).matches[0].model.length,64);
 assert.throws(()=>selectUI(ui,{selector:{arbitrary:true}}));assert.throws(()=>selectUI(ui,{limit:1000}));
});
test('verification checks an observed value and fails for absent paths or wrong outcomes',()=>{
 const observed={tracks:[{track_id:'original'},{track_id:'new'}],enabled:false};
 assert.equal(compareObservation(observed,{path:['tracks'],length:2,includes:{track_id:'new'}}).matched,true);
 assert.equal(compareObservation(observed,{path:['tracks'],length:3}).matched,false);
 assert.equal(compareObservation(observed,{path:['absent'],notEquals:0}).matched,false);
 assert.equal(compareObservation(observed,{path:['enabled'],equals:false}).matched,true);
 assert.throws(()=>compareObservation(observed,{path:['__proto__'],equals:{}}));assert.throws(()=>compareObservation(observed,{}));
});
test('Pass requires current verified evidence and physical mode requires actual dispatched input',()=>{
 const s={currentCheck:'P-TEST',agentAttempt:'attempt',agentRevision:3,generation:2,agentRequiredRoute:'physical'},image={caseId:s.currentCheck,attempt:s.agentAttempt,revision:3,generation:2,kind:'image'},proof={...image,kind:'json'},event={caseId:s.currentCheck,attempt:s.agentAttempt,operation:'physical',status:'Completed',result:{status:'Dispatched'}};
 assert.doesNotThrow(()=>requirePassProof(s,[image,proof],[proof],[event]));
 for(const run of [()=>requirePassProof(s,[image,proof],[proof],[]),()=>requirePassProof({...s,agentRevision:4},[image,proof],[proof],[event]),()=>requirePassProof({...s,generation:3},[image,proof],[proof],[event]),()=>requirePassProof({...s,agentAttempt:'other'},[image,proof],[proof],[event]),()=>requirePassProof({...s,agentUncertain:true},[image,proof],[proof],[event]),()=>requirePassProof(s,[image,proof],[],[event])])assert.throws(run);
});
test('a new attempt without a verdict cannot inherit an earlier Pass in the exported report',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-agent-report-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=path.join(data,'desktop-test'),bundle=path.join(root,'projects/Golden.wiz');await mkdir(bundle,{recursive:true});
  const id='D-CLI-01',file=path.join(root,'session.json');await writeFile(file,JSON.stringify({dataDir:data,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),harnessId:'pilot',generation:1,guiHash:'package',plan:{version:'test',cases:[{id,title:'Connect',expected:'Observe the selected app'}]},assets:{}}));
  await writeFile(path.join(root,'agent-tools.jsonl'),[{operation:'begin',caseId:id,attempt:'old'},{operation:'begin',caseId:id,attempt:'new'}].map(JSON.stringify).join('\n')+'\n');
  await writeFile(path.join(root,'agent-results.jsonl'),JSON.stringify({id,attempt:'old',status:'Pass',observation:'Earlier attempt'})+'\n');
  const result=await exportAgentReport(file),report=JSON.parse(await readFile(result.report));assert.deepEqual(report.counts,{Unknown:1});assert.equal(report.cases[0].status,'Unknown');assert.match(await readFile(result.path,'utf8'),/Computer-use agent session/);
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
test('the native foreground lease excludes another workspace and releases after a crashed holder',{skip:process.platform!=='darwin'},async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'athanor-lease-test-'));let first,last;
 try{
  first=await acquireDesktopLease(data);await assert.rejects(()=>acquireDesktopLease(data),e=>e.status==='Blocked');
  process.kill(first.receipt.pid,'SIGKILL');await first.release();first=null;
  last=await acquireDesktopLease(data);assert.equal(last.receipt.status,'Acquired');
 }finally{if(first)await first.release();if(last)await last.release();await rm(data,{recursive:true,force:true});}
});
