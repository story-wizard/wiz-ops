import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {selectUI,uniqueTarget,compareObservation,exportAgentReport,requirePassProof,sessionDefinitions,sessionContext,agentTool} from '../desktop/agent-tools.mjs';
import {physicalKeys} from '../desktop/macos-input.mjs';
import {sha} from '../runner/files.mjs';
import {verifyTrimmedClip} from '../desktop/check-support.mjs';
import {validateToolParams} from '../desktop/agent-proof.mjs';

test('toolkit discovery works without a process or session while application reads still require one',async()=>{
 const file='/missing-athanor-session/session.json';
 for(const params of [{},{tool:'task'},{tool:'physical'}]){const reply=await agentTool(file,'schema',params);assert.equal(reply.format,'athanor-tool-interface/v1');assert.equal(reply.executed,false);assert(params.tool?reply.tool===params.tool:reply.tools.includes('query'));}
 for(const [operation,params] of [['schema',{operation:'project.get_name'}],['observe',{selector:{class:'MainWindow'}}],['physical',{command:'key',target:{id:'fake'},key:'cmd+z'}]])await assert.rejects(()=>agentTool(file,operation,params),e=>e.code==='ENOENT');
 await assert.rejects(()=>agentTool(file,'schema',{tool:'physical',operation:'project.get_name'}),e=>e.code==='invalid_params');
 const cli=new URL('../desktop/session.mjs',import.meta.url).pathname,reply=spawnSync(process.execPath,[cli,'toolkit','task'],{encoding:'utf8'});assert.equal(reply.status,0);assert.equal(JSON.parse(reply.stdout).example.params.recipe,'inspector-edit-undo');
 const invalid=spawnSync(process.execPath,[cli,'toolkit','physical','extra'],{encoding:'utf8'});assert.equal(invalid.status,3);assert.equal(JSON.parse(invalid.stdout).status,'Blocked');
});

test('prepared plan IDs resolve their actual definitions alongside physical candidates',()=>{
 const checks=sessionDefinitions({plan:{cases:['A-CLI-01','D-CLI-01']}});
 assert.match(checks.find(c=>c.id==='D-CLI-01').title,/connection/i);assert.ok(checks.find(c=>c.id==='P-TL-TRIM'));assert.equal(checks.filter(c=>c.id==='D-CLI-01').length,1);
 assert.throws(()=>sessionDefinitions({plan:{cases:['UNKNOWN-ID']}}));
});

test('physical trim accepts supported carrier timing and rejects corrupt range or identity',()=>{
 const before={clip_id:'clip',timeline_range:{start_seconds:0,end_seconds:4},source:{asset_id:'asset',source_range:{start_seconds:1,end_seconds:5}}};
 const after={clip_id:'clip',timeline_range:{start_seconds:0,end_seconds:67/24},source:{asset_id:'asset',source_range:{start_seconds:1,end_seconds:91/24},fps:24,projection_status:'carrier',projection_diagnostics:[],source_availability:'bounded'}};
 assert.equal(verifyTrimmedClip(before,after,24).projection,'carrier');
 for(const mutate of [a=>a.clip_id='other',a=>a.source.asset_id='other',a=>a.timeline_range.start_seconds=1,a=>a.source.projection_status='rejected',a=>a.source.projection_diagnostics=['exact_authority_limit_exceeded'],a=>a.source.source_availability='out_of_bounds',a=>a.source.source_range.end_seconds+=1,a=>{a.source.source_range.end_seconds+=.01;a.timeline_range.end_seconds+=.01;}]){const bad=structuredClone(after);mutate(bad);assert.throws(()=>verifyTrimmedClip(before,bad,24));}
});

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
test('a bounded selector bundle observes related controls together, deduplicates matches and binds its query',()=>{
 const ui={widgets:[{id:'field',class:'MediaSearchField',text:'plate'},{id:'model',class:'QTreeView',rows:1,model:[['plate.mov']]},{id:'status',class:'QLabel',name:'mediaSearchStatus',text:'1 match in 1 clip'},{id:'other',class:'QToolButton'}]};
 const query={selectors:[{class:'MediaSearchField'},{class:'QTreeView'},{name:'mediaSearchStatus'},{id:'field'}],details:true};
 validateToolParams('observe',query);const found=selectUI(ui,query);
 assert.deepEqual(found.matches.map(w=>w.id),['field','model','status']);assert.deepEqual(found.matches[1].model,[['plate.mov']]);assert.equal(found.matchCount,3);assert.equal(found.inspectionIncomplete,false);
 assert.equal(selectUI(ui,{...query,limit:1}).truncated,true);
 for(const selectors of [[],Array(9).fill({id:'field'}),[{}],[{arbitrary:true}],['field']])assert.throws(()=>validateToolParams('observe',{selectors}));
 assert.throws(()=>validateToolParams('observe',{...query,selector:{id:'field'}}));assert.throws(()=>selectUI(ui,{...query,selector:{id:'field'}}));
 assert.throws(()=>validateToolParams('find',query));
});

test('incomplete scenes and models remain visible even when a scoped query finds nothing',()=>{
 const full=Array(128).fill({labels:['node']}),text=Array(256).fill({text:'label'});
 const ui={widgets:[{id:'graph',sceneItems:full,sceneText:text,sceneItemsTruncated:false,sceneTextTruncated:false}]};
 assert.equal(selectUI(ui).inspectionIncomplete,false,'Exactly full but complete scene must not imply omission');
 ui.widgets[0].sceneItemsTruncated=true;
 const missing=selectUI(ui,{selector:{id:'missing'}});assert.equal(missing.matchCount,0);assert.equal(missing.inspectionIncomplete,true);
 assert.equal(selectUI(ui).matches[0].sceneItemsTruncated,true);
 delete ui.widgets[0].sceneItemsTruncated;assert.equal(selectUI(ui).inspectionIncomplete,true,'Legacy adapter at its cap is conservative');
 ui.widgets=[{id:'menu',menuTruncated:true}];assert.equal(selectUI(ui).matches[0].menuTruncated,true);
});

test('session context names actual Pass contracts, physical keys and launcher deadline',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-context-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=path.join(data,'session'),bundle=path.join(root,'Golden.wiz'),native=path.join(root,'native');await mkdir(bundle,{recursive:true});await mkdir(native);
  const file=path.join(root,'session.json'),deadline='2026-10-02T23:30:00.000Z';
  await writeFile(file,JSON.stringify({dataDir:data,root,bundle,native,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),agentDeadlineAt:deadline,plan:{cases:['D-CLI-01']},schema:{operations:{'timeline.inspect':{}}}}));
  await writeFile(path.join(native,'ready.json'),JSON.stringify({capabilities:{limits:{modelRows:64}}}));
  const context=await sessionContext(file);assert.equal(context.workspace,data);assert.equal(context.lifetime.deadlineAt,deadline);assert.equal(context.lifetime.timeoutMs,1800000);assert.deepEqual(context.physical.keys,physicalKeys);
  assert.deepEqual(context.verdicts.toolkitPassIds,context.checks.filter(c=>c.proof).map(c=>c.id));assert.ok(context.verdicts.toolkitPassIds.includes('P-TRACK-ADD'));assert.ok(!context.verdicts.toolkitPassIds.includes('P-CURVE-LIVE'));
  assert.deepEqual(context.applicationOperations,['timeline.inspect']);assert.match(context.verdicts.scripted,/authored assertions/);
  assert.equal(JSON.parse(await readFile(path.join(root,'agent-context.json'))).lifetime.deadlineAt,deadline);
  const s=JSON.parse(await readFile(file));delete s.agentDeadlineAt;await writeFile(file,JSON.stringify(s));assert.equal((await sessionContext(file)).lifetime.deadlineAt,null,'Do not invent a deadline for a course-owned session');
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
test('uncontracted image, arbitrary verification and unrelated physical dispatch cannot qualify Pass',()=>{
 const s={currentCheck:'P-TEST',agentAttempt:'attempt',agentRevision:3,generation:2,agentRequiredRoute:'physical'},image={caseId:s.currentCheck,attempt:s.agentAttempt,revision:3,generation:2,kind:'image'},proof={...image,kind:'json'},event={caseId:s.currentCheck,attempt:s.agentAttempt,operation:'physical',status:'Completed',result:{status:'Dispatched'}};
 assert.throws(()=>requirePassProof(s,[image,proof],[proof],[event]),e=>e.code==='proof_contract_missing'&&e.status==='Blocked');
});
test('a new attempt without a verdict cannot inherit an earlier Pass in the exported report',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-agent-report-'))),previous=process.env.SMOKE_DATA_DIR;process.env.SMOKE_DATA_DIR=data;
 try{
  const root=path.join(data,'desktop-test'),bundle=path.join(root,'projects/Golden.wiz');await mkdir(bundle,{recursive:true});
  const id='D-CLI-01',file=path.join(root,'session.json');await writeFile(file,JSON.stringify({dataDir:data,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),harnessId:'pilot',generation:1,guiHash:'package',plan:{version:'test',cases:[{id,title:'Connect',expected:'Observe the selected app'}]},assets:{}}));
  await writeFile(path.join(root,'agent-action.lock'),'held');await assert.rejects(()=>agentTool(file,'context'),e=>e.status==='Blocked');await rm(path.join(root,'agent-action.lock'));
  await mkdir(path.join(root,'evidence'));const evidence=[];
  for(const name of ['before','after']){const p=path.join(root,'evidence',name+'.json');await writeFile(p,JSON.stringify({name}));evidence.push({caseId:id,attempt:'old',file:name+'.json',path:p,kind:'json',sha256:await sha(p)});}
  await writeFile(path.join(root,'agent-evidence.jsonl'),evidence.map(JSON.stringify).join('\n')+'\n');
  const events=[{operation:'begin',caseId:id,attempt:'old',at:'2026-10-01T10:00:00Z'},{operation:'physical',caseId:id,attempt:'old',at:'2026-10-01T10:01:00Z'},{operation:'physical',caseId:id,attempt:'old',at:'2026-10-01T10:03:00Z'}];
  await writeFile(path.join(root,'agent-tools.jsonl'),events.map(JSON.stringify).join('\n')+'\n');
  await writeFile(path.join(root,'agent-results.jsonl'),JSON.stringify({id,attempt:'old',status:'Pass',observation:'Earlier attempt',recordedAt:'2026-10-01T10:02:00Z',evidence:[evidence[0]]})+'\n');
  const frozen=JSON.parse(await readFile((await exportAgentReport(file)).report));assert.deepEqual(frozen.cases[0].evidence.map(e=>e.file),['before.json']);assert.equal(frozen.cases[0].actions.length,1);assert.equal(frozen.artifacts.length,1);
  await writeFile(path.join(root,'agent-tools.jsonl'),[...events,{operation:'begin',caseId:id,attempt:'new',at:'2026-10-01T10:04:00Z'}].map(JSON.stringify).join('\n')+'\n');
  const result=await exportAgentReport(file),report=JSON.parse(await readFile(result.report));assert.deepEqual(report.counts,{Unknown:1});assert.equal(report.cases[0].status,'Unknown');assert.match(await readFile(result.path,'utf8'),/Computer-use agent session/);
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
test('the native foreground lease excludes another workspace and releases after a crashed holder',{skip:process.platform!=='darwin'},async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'athanor-lease-test-'));let first,last;
 try{
  const swift=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),start=swift.indexOf('if args.count == 2 && args[1] == "--desktop-lease"'),end=swift.indexOf('try require(args.count == 5',start);
  assert.ok(start>=0&&end>start);
  // Exercise the real kernel-lock block on a private file, without taking the user's desktop lease.
  const block=swift.slice(start,end).replace('"/private/tmp/athanor-desktop-\\(getuid()).lock"',JSON.stringify(path.join(data,'probe.lock'))),driver=path.join(data,'lease-probe');
  assert.ok(!block.includes('/private/tmp/athanor-desktop-'),'Test probe must use its private lock');
  await writeFile(driver+'.swift',`import Foundation
func require(_ value:Bool,_ message:String)throws{if !value{throw NSError(domain:message,code:1)}}
func emit(_ value:[String:Any]){print(String(data:try! JSONSerialization.data(withJSONObject:value),encoding:.utf8)!)}
func ps(_ args:[String])throws->String{let p=Process(),pipe=Pipe();p.executableURL=URL(fileURLWithPath:"/bin/ps");p.arguments=args;p.standardOutput=pipe;try p.run();let data=pipe.fileHandleForReading.readDataToEndOfFile();p.waitUntilExit();return String(data:data,encoding:.utf8)!.trimmingCharacters(in:.whitespacesAndNewlines)}
func main()throws{let args=CommandLine.arguments;${block}}
do{try main()}catch{emit(["status":"Blocked","error":(error as NSError).domain])}
`);
  const compiled=spawnSync('/usr/bin/swiftc',['-module-cache-path',path.join(data,'module-cache'),driver+'.swift','-o',driver],{encoding:'utf8',timeout:60000});assert.equal(compiled.status,0,compiled.stderr);
  const {pathToFileURL}=await import('node:url'),module=path.join(data,'lease.mjs'),source=(await readFile(new URL('../desktop/desktop-lease.mjs',import.meta.url),'utf8')).replace("import {nativeInputDriver} from './macos-input.mjs';","const nativeInputDriver=async()=>({driver:"+JSON.stringify(driver)+"});").replace("from '../runner/engine.mjs'","from '"+new URL('../runner/engine.mjs',import.meta.url).href+"'");
  await writeFile(module,source);const {acquireDesktopLease}=await import(pathToFileURL(module).href);
  first=await acquireDesktopLease(data);await assert.rejects(()=>acquireDesktopLease(data),e=>e.status==='Blocked');
  process.kill(first.receipt.pid,'SIGKILL');await first.release();first=null;
  last=await acquireDesktopLease(data);assert.equal(last.receipt.status,'Acquired');
 }finally{if(first)await first.release();if(last)await last.release();await rm(data,{recursive:true,force:true});}
});

test('task entry auto-binds the existing recipe without input and rejects incomplete or ambiguous fixtures',async()=>{
 const {prepareAgentTask,briefContext}=await import('../desktop/agent-task.mjs');const root=await realpath(await mkdtemp('/private/tmp/athanor-task-')),file=root+'/session.json';
 try{
  await mkdir(root+'/Golden.wiz');
  await writeFile(file,JSON.stringify({dataDir:'/private/tmp',root,bundle:root+'/Golden.wiz',executable:root+'/Wizard Smoke.app/Contents/MacOS/wizard',main:{id:'timeline'},schema:{operations:{'project.get_name':{properties:{}},'timeline.inspect':{properties:{timeline_id:{type:'string'}}}}}}));
  const tracks=[{track_id:'v1',address:'V1',items:[]},{track_id:'a1',address:'A1',items:[]}],ui={matches:[{id:'timeline-view',class:'TimelineWidget'},{id:'main',class:'MainWindow'},{id:'add',name:'panelChromeAction',text:'+ Video',enabled:true},{id:'tab',name:'panelSubtabSelector',text:'Main'}]};const seen=[];
  const execute=async(_f,op,p)=>{seen.push(op);if(op==='observe')return ui;return p.operation==='project.get_name'?{name:'Golden'}:{timeline:{timeline_id:'timeline',name:'Main'},tracks,next_cursor:null};};
  const task=await prepareAgentTask(file,{recipe:'add-video-track'},execute);assert.deepEqual(seen,['call','call','observe']);assert.equal(task.executed,false);assert.equal(task.run.at(-1),'--compact');const inspection=spawnSync(task.inspect[0],task.inspect.slice(1),{cwd:root,env:{...process.env,SMOKE_DATA_DIR:root+'/wrong'},encoding:'utf8'});assert.equal(inspection.status,3);assert.match(JSON.parse(inspection.stdout).error,/ENOENT/,'Returned command inspects the owned workspace from another directory despite a different ambient workspace');const catalog=await prepareAgentTask(file,{},execute);assert.deepEqual(Object.keys(catalog.recipes.find(r=>r.id==='add-video-track').parameters),['timelineId']);const plan=JSON.parse(await readFile(task.plan.path));assert.deepEqual(plan.phases[0].steps[1].expect.equals,tracks);assert.equal(plan.phases[1].steps[0].operation,'physical');assert.equal(plan.phases[1].next,null);
  ui.matches.push({...ui.matches[0],id:'audio'});assert.equal((await prepareAgentTask(file,{recipe:'add-video-track'},execute)).status,'Valid','Video/audio canvases do not make a window shortcut ambiguous');ui.matches.pop();
  ui.matches.push({...ui.matches[1],id:'other'});await assert.rejects(()=>prepareAgentTask(file,{recipe:'add-video-track'},execute),e=>e.code==='ambiguous_target');
  ui.matches.pop();ui.matches.at(-1).text='Wrong timeline';await assert.rejects(()=>prepareAgentTask(file,{recipe:'add-video-track'},execute),e=>e.code==='wrong_fixture');
  await assert.rejects(()=>prepareAgentTask(file,{recipe:'add-video-track',values:{baselineTracks:[]}},execute),e=>e.code==='unknown_parameter');
  await assert.rejects(()=>prepareAgentTask(file,{recipe:'../escape'},execute),e=>e.code==='unknown_recipe');
  const full={session:file,workspace:'/private/tmp',checks:[{id:'D-CLI-01',title:'Connect',steps:Array(100).fill('large')}],guidance:['x'.repeat(100000)],project:{main:'timeline'}};const brief=briefContext(full);assert(brief.recipes.includes('add-video-track'));assert(!JSON.stringify(brief).includes('large'));assert(Buffer.byteLength(JSON.stringify(brief))<5000);
 }finally{await rm(root,{recursive:true,force:true});}
});
