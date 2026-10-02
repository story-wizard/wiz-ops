import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {runInNewContext} from 'node:vm';
import {dataDirectory,digest,writeJSON} from '../runner/files.mjs';
import {localReport,exportLocalReport,renderReport} from '../reports.mjs';
import {startPrepared} from '../scripts/run-packaged.mjs';

test('report retains exact outcomes, detects missing or mismatched evidence and exports without rerunning',async()=>{
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'smoke-report-'))),id='11111111-1111-4111-8111-111111111111',root=path.join(data,'runs',id);
 try{
  await mkdir(path.join(root,'media'),{recursive:true});
  const recipe={id:'test-course',revision:1,target:'Test package only',cases:[{id:'CHECK',sourceId:'SOURCE',expected:'Independent state readback is correct',operations:['project.read']}]};
  const fixtureContent={format:'wizard-smoke-fixtures/v1',version:1,files:[]},fixtures={...fixtureContent,sha256:digest(fixtureContent)};
  const content={app:'/fake/Selected.app',version:'test-only',packageHash:'a'.repeat(64),fixtureHash:fixtures.sha256,courseHash:digest(recipe),runnerHash:'b'.repeat(64)},plan={...content,planHash:digest(content)};
  const results=[{test_id:'CHECK',status:'Pass',note:'Observed expected state',snapshot:{title:'<script>bad()</script>',area:'Project'}}];
  const run={id,title:'test',name:'Report <img src=x>',operator:'Test',created_at:'2026-01-01',execution:{state:'Passed',updated_at:'2026-01-02',artifact_root:root,package:plan,plan_hash:plan.planHash,recipe},results};
  await writeJSON(path.join(root,'plan.json'),plan);await writeJSON(path.join(root,'course.json'),recipe);
  await writeJSON(path.join(root,'report.json'),{runId:id,state:'Passed',planHash:plan.planHash,results:[{id:'CHECK',status:'Pass',note:results[0].note}]});
  await writeJSON(path.join(root,'media/manifest.json'),fixtures);
  await writeJSON(path.join(root,'scope.json'),{id:'test-proposal',status:'Proposed',sourceRows:[{id:'SOURCE',checkIds:['CHECK'],disposition:'Partial',remaining:'UI not exercised'}]});
  await writeJSON(path.join(root,'execution-context.json'),{platform:'test',runnerHash:plan.runnerHash});
  await writeFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:'CHECK',operation:'project.read',durationMs:12})+'\n');
  let {report}=await localReport(run,data);assert.equal(report.acceptance.evidenceStatus,'Ready for review');assert.equal(report.acceptance.scopeAcceptance,'Not assessed');assert.equal(report.scope.sourceRows[0].disposition,'Partial');
  assert.equal(report.cases[0].target,'packaged');assert.equal(report.targets[0].hash,plan.packageHash);
  const html=renderReport(report);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>bad()'));assert.ok(html.includes('Observed expected state'));assert.ok(html.includes('project.read'));assert.ok(html.includes('<details><summary>Technical details</summary>'));
  assert.ok(html.includes('How the test works'));assert.ok(html.includes('Recorded actions'));assert.ok(html.includes('Copy edit prompt'));assert.ok(html.includes('Agent edit prompt'));
  assert.equal(report.timing.totalMs,86400000);assert.match(html,/Total time/);assert.match(html,/24:00:00/);
  assert.match(html,/data:image\/jpeg;base64,/);assert.match(html,/data:image\/png;base64,/);assert.ok(!html.includes("url('/athanor-scene.jpg')")&&!html.includes("url('/brand-smoke.png')"),'Report artwork travels with the exported HTML');
  const group=path.join(root,'stages/desktop/groups/move/owned');await mkdir(path.join(group,'evidence'),{recursive:true});
  for(const file of ['native-request.txt','native-receipt.txt','native-shot.png'])await writeFile(path.join(group,'evidence',file),'retained '+file);
  const journal=[{caseId:'CHECK',operation:'physical.screenshot',command:'screenshot',status:'Observed',input:{command:'screenshot'},request:'evidence/native-request.txt',receipt:'evidence/native-receipt.txt',source:path.join(group,'native-input.jsonl')},{caseId:'CHECK',operation:'check.observation',source:path.join(group,'desktop-course-report.json'),evidence:{capture:{artifacts:['evidence/native-shot.png']}}}];
  await writeFile(path.join(root,'operations.jsonl'),journal.map(JSON.stringify).join('\n')+'\n');
  const grouped=(await localReport(run,data)).report;assert.deepEqual(grouped.acceptance.gaps,[]);assert.equal(grouped.artifacts.filter(a=>a.source.includes('/evidence/')).length,3);assert.equal(grouped.cases[0].actions[0].channel,'macOS input');
  await writeFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:'CHECK',operation:'project.read',durationMs:12})+'\n');
  const patchedHTML=renderReport({...report,computerUse:{state:'Partial',createdAt:'2026-09-30',cases:[{id:'UI',title:'Project UI',target:'computer-use-patched',area:'Release UI pilot',status:'Pass',observation:'Visible editor',expected:'Created project',operations:['Mouse and accessibility']}]}});
  assert.match(patchedHTML,/Smoke copy · patched Cocoa plugin/);assert.match(patchedHTML,/data-target="computer-use-patched"/);
  // Execute the exported page's controls against a small DOM, with no runner or network.
  const row=(order,title,status,area,text)=>({dataset:{order:String(order),title,result:status,area,target:area==='Project'?'packaged':'desktop'},textContent:title+' '+text,hidden:false});
  const rows=[row(0,'Zebra','Pass','Project','project.read'),row(1,'Alpha','Fail','Timeline','clip.split'),row(2,'Beta','Unknown','Project','project.read')],body={rows,append(r){rows.splice(rows.indexOf(r),1);rows.push(r);}};
  const fields=Object.fromEntries(['search','result','area','target','sort','visible-count','empty','reset'].map(id=>[id,{value:id==='sort'?'course':'',handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}}]));
  for(const id of ['result','area','target']){
   const f=fields[id];f.multiple=true;f.options=[...new Set(rows.map(r=>r.dataset[id]))].map(value=>({value,selected:false}));
   Object.defineProperty(f,'value',{get(){return this.options.find(o=>o.selected)?.value||'';},set(v){for(const o of this.options)o.selected=o.value===v;}});
   Object.defineProperty(f,'selectedOptions',{get(){return this.options.filter(o=>o.selected);}});
  }
  const location={hash:'#check=CHECK',replace(value){this.hash=value;}};
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{URLSearchParams,location,document:{getElementById(id){return fields[id];},querySelectorAll(){return [];},querySelector(selector){return selector==='#checks tbody'?body:fields[selector.slice(1)];}}});
  assert.match(location.hash,/check=CHECK/);assert.match(location.hash,/filters=/);
  fields.result.options.filter(o=>['Pass','Fail'].includes(o.value)).forEach(o=>o.selected=true);fields.result.handlers.change();
  assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.dataset.title),['Zebra','Alpha']);fields.reset.handlers.click();
  assert.equal(fields['visible-count'].textContent,'3 of 3 checks');
  fields.target.value='desktop';fields.target.handlers.change();assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.dataset.title),['Alpha']);fields.reset.handlers.click();
  fields.sort.value='result';fields.sort.handlers.change();assert.deepEqual(rows.map(r=>r.dataset.title),['Alpha','Beta','Zebra']);
  fields.sort.value='name';fields.sort.handlers.change();assert.deepEqual(rows.map(r=>r.dataset.title),['Alpha','Beta','Zebra']);
  fields.search.value=' PROJECT.READ ';fields.search.handlers.input();assert.equal(fields['visible-count'].textContent,'2 of 3 checks');
  fields.result.value='Unknown';fields.result.handlers.change();assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.dataset.title),['Beta']);
  fields.area.value='Timeline';fields.area.handlers.change();assert.equal(fields.empty.hidden,false);assert.equal(fields['visible-count'].textContent,'0 of 3 checks');
  fields.reset.handlers.click();assert.deepEqual(rows.map(r=>r.dataset.title),['Zebra','Alpha','Beta']);assert.ok(rows.every(r=>!r.hidden));assert.equal(fields.empty.hidden,true);
  assert.match(html,/Selected package engine/);assert.match(html,new RegExp(plan.packageHash));
  const subsetHTML=renderReport({...report,selection:{project:'fresh',requestedIds:['CHECK'],addedPrerequisites:[],notSelected:['OTHER'],groups:[{title:'My <group>',checks:['CHECK']}],courseRevisions:[{id:'custom',revision:2}]}});
  assert.ok(subsetHTML.includes('OTHER'));assert.ok(subsetHTML.includes('My &lt;group&gt;'));
  const first=await exportLocalReport(run,data),second=await exportLocalReport(run,data);assert.equal(first.path,second.path,'Identical report delivery is idempotent');
  assert.equal(JSON.parse(await readFile(path.join(path.dirname(first.path),'report.json'))).cases[0].status,'Pass');
  // A paused course can publish a snapshot; successful automated checks do not supply a human verdict.
  recipe.checkpoint={id:'test-human'};run.execution.state='Waiting for human';
  run.checkpoint={state:'Waiting',definition:{title:'Human playback'},observations:[{operator:'Fixture tester',recordedVia:'agent-transcription',outcome:'Fail',note:'Synthetic <finding>',handsOnSeconds:17}]};
  await writeJSON(path.join(root,'course.json'),recipe);await writeJSON(path.join(root,'checkpoint.json'),run.checkpoint);
  await writeJSON(path.join(root,'report.json'),{runId:id,state:'Waiting for human',planHash:plan.planHash,results:[{id:'CHECK',status:'Pass',note:results[0].note}]});
  report=(await localReport(run,data)).report;
  assert.equal(report.execution.state,'Waiting for human');assert.equal(report.cases[0].status,'Pass');assert.equal(report.checkpoint.observations[0].outcome,'Fail');
  const humanHTML=renderReport(report);assert.match(humanHTML,/Synthetic &lt;finding&gt;/);assert.match(humanHTML,/&quot;handsOnSeconds&quot;: 17/);assert.match(humanHTML,/Fixture tester/);
  await writeJSON(path.join(root,'checkpoint.json'),{...run.checkpoint,observations:[]});
  report=(await localReport(run,data)).report;assert.ok(report.acceptance.gaps.some(s=>s.includes('Checkpoint artifact differs')));
  delete recipe.checkpoint;delete run.checkpoint;run.execution.state='Passed';
  await writeJSON(path.join(root,'course.json'),recipe);await writeJSON(path.join(root,'report.json'),{runId:id,state:'Passed',planHash:plan.planHash,results:[{id:'CHECK',status:'Pass',note:results[0].note}]});
  await writeFile(path.join(root,'operations.jsonl'),'');
  report=(await localReport(run,data)).report;assert.equal(report.acceptance.evidenceStatus,'Gaps found');assert.equal(report.cases[0].status,'Pass','Do not rewrite the original assertion result');assert.ok(report.acceptance.gaps.some(s=>s.includes('no operation receipts')));
  await writeFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:'CHECK',operation:'check.observation',status:'Pass'})+'\n');
  report=(await localReport(run,data)).report;assert.ok(report.acceptance.gaps.some(s=>s.includes('no operation receipts')),'A summary receipt cannot stand in for an executed operation');
  await writeJSON(path.join(root,'report.json'),{runId:'other',state:'Passed',planHash:plan.planHash,results:[]});
  report=(await localReport(run,data)).report;assert.ok(report.acceptance.gaps.some(s=>s.includes('identity/state')));
  run.execution.state='Running';await assert.rejects(()=>localReport(run,data),/Wait for the run/);
  run.execution.state='Unknown';run.results[0].status='Unknown';
  await rm(root,{recursive:true});report=(await localReport(run,data)).report;
  assert.equal(report.cases[0].status,'Unknown');assert.equal(report.acceptance.evidenceStatus,'Gaps found');assert.match(report.scope.basis,/not frozen/);
 }finally{await rm(data,{recursive:true,force:true});}
});

test('explicit build launch binds to reviewed plan and never retries an uncertain start',async()=>{
 const app=await realpath(await mkdtemp(path.join(tmpdir(),'smoke-selected-app-')));let posts=0,mode='normal';
 const hash='a'.repeat(64);
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET')return res.end(JSON.stringify({prepared:true,plan:{app,planHash:hash,packageHash:'b'.repeat(64)}}));
  posts++;if(mode==='lost'){req.socket.destroy();return;}
  let body='';req.on('data',d=>body+=d);req.on('end',()=>{assert.deepEqual(JSON.parse(body),{planHash:hash,operator:'Tester'});res.end(JSON.stringify({runId:'test-admitted'}));});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  await assert.rejects(()=>startPrepared({app,planHash:'c'.repeat(64),operator:'Tester',base}),/differs/);assert.equal(posts,0);
  const r=await startPrepared({app,planHash:hash,operator:'Tester',base});assert.equal(r.runId,'test-admitted');assert.match(r.execution,/pending/);
  mode='lost';await assert.rejects(()=>startPrepared({app,planHash:hash,operator:'Tester',base}),/outcome unknown/);assert.equal(posts,2);
  await assert.rejects(()=>startPrepared({app,planHash:hash,operator:'Tester',base:'https://example.com'}),/loopback/);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(app,{recursive:true,force:true});}
});


test('embedded report details open directly, switch checks in one drawer and close back to Results',async()=>{
 const source=await readFile(new URL('../reports.mjs',import.meta.url),'utf8'),controls=source.slice(source.indexOf('const detailControls=`')+'const detailControls=`'.length,source.indexOf('`;\nexport const reportScriptHash'));
 const listeners={},messages=[],panels=[{dataset:{panel:'0'}},{dataset:{panel:'1'}}],buttons=Object.fromEntries(['detail-close','detail-prev','detail-next','detail-position'].map(id=>[id,{addEventListener(event,fn){listeners[id+':'+event]=fn;}}]));
 let modal=0,shown=0;const dialog={open:false,querySelectorAll:()=>panels,show(){shown++;this.open=true;},showModal(){modal++;this.open=true;},addEventListener(event,fn){listeners['dialog:'+event]=fn;},close(){this.open=false;listeners['dialog:close']();}};
 const rows=[{dataset:{checkId:'A',order:'0'},hidden:false},{dataset:{checkId:'B',order:'1'},hidden:false}],location={search:'?detail=1',hash:'#check=A'},window={parent:{postMessage:message=>messages.push(message)},addEventListener(event,fn){listeners['window:'+event]=fn;}};
 const document={body:{classList:{add:name=>assert.equal(name,'detail-only')}},querySelector(selector){return selector==='#test-detail'?dialog:buttons[selector.slice(1)];},addEventListener(event,fn){listeners['document:'+event]=fn;}};
 runInNewContext(controls,{document,window,location,rows,body:{addEventListener(){}},URLSearchParams});
 assert.equal(shown,1);assert.equal(modal,0);assert.equal(panels[0].hidden,false);assert.equal(panels[1].hidden,true);
 location.hash='#check=B';listeners['window:hashchange']();assert.equal(shown,1);assert.equal(panels[0].hidden,true);assert.equal(panels[1].hidden,false);
 listeners['detail-close:click']();assert.equal(messages[0].type,'athanor-close-details');assert.equal(dialog.open,false);
});
