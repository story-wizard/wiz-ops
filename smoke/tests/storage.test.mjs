import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {ROOT,dataDirectory,externalPath,sha} from '../runner/files.mjs';
import {verifyDesktopPaths,assertLocalPreviewGraph,assertQuitEvidence,preparedRelinkContinueButton} from '../desktop/adapter.mjs';
import {cleanupInterrupted} from '../runner/store.mjs';
import {retainProcess} from '../runner/engine.mjs';

test('normal Quit requires menu dispatch and the owned generation shutdown event',()=>{
 const ready={pid:42,generation:'current'},receipt={dispatch:'native-menu',shortcut:'Command-Q'},observed={...ready,event:'aboutToQuit'};
 assertQuitEvidence(receipt,observed,ready);
 assert.throws(()=>assertQuitEvidence({dispatch:'SIGTERM'},observed,ready),/menu dispatch/);
 assert.throws(()=>assertQuitEvidence(receipt,{...observed,pid:43},ready),/owned GUI/);
 assert.throws(()=>assertQuitEvidence(receipt,{...observed,generation:'previous'},ready),/owned GUI/);
 assert.throws(()=>assertQuitEvidence(receipt,null,ready),/owned GUI/);
});

test('startup continues offline only for the owned prepared relink fixture',async()=>{
 const workspace=dataDirectory(mkdtempSync(path.join(tmpdir(),'smoke-relink-'))),root=path.join(workspace,'desktop-run');
 const bundle=path.join(root,'projects','Golden.wiz'),media=path.join(root,'media'),relocated=path.join(root,'relocated-media');
 for(const dir of [bundle,media,relocated])mkdirSync(dir,{recursive:true});
 const original=path.join(media,'plate.mov'),moved=path.join(relocated,'plate.mov'),file=path.join(root,'relink-prepared.json');
 writeFileSync(moved,'owned media');
 const session={dataDir:workspace,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard'),pid:43,assets:{plate:'plate'},currentCheck:'D-MEDIA-RELINK'};
 const record={asset:'plate',original,moved,digest:await sha(moved),pid:42};
 const main={class:'MainWindow',id:'main'},dialog={class:'QDialog',id:'missing',parent:'main',title:'Missing Media'};
 const button={class:'QPushButton',id:'offline',window:'missing',enabled:true,text:'Continue Offline'};
 const ui={widgets:[main,dialog,button]},save=r=>writeFileSync(file,JSON.stringify(r));
 try{
  save(record);assert.equal(await preparedRelinkContinueButton(session,ui),'offline');
  await assert.rejects(()=>preparedRelinkContinueButton({...session,currentCheck:'other'},ui),/declared relink/);
  for(const bad of [{...record,asset:'other'},{...record,pid:43},{...record,digest:'changed'},{...record,original:path.join(workspace,'plate.mov')}]){
   save(bad);await assert.rejects(()=>preparedRelinkContinueButton(session,ui));
  }
  save(record);writeFileSync(original,'unexpected restored source');
  await assert.rejects(()=>preparedRelinkContinueButton(session,ui),/must be missing/);rmSync(original);
  for(const widgets of [[main,{...dialog,parent:'foreign'},button],[main,dialog,button,{...button,id:'duplicate'}],[main,dialog,{...button,enabled:false}],[main,dialog,button,{class:'QMessageBox',id:'unrelated'}]]){
   await assert.rejects(()=>preparedRelinkContinueButton(session,{widgets}));
  }
  const foreign=path.join(workspace,'foreign.mov');writeFileSync(foreign,'owned media');
  rmSync(moved);symlinkSync(foreign,moved);
  await assert.rejects(()=>preparedRelinkContinueButton(session,ui),/owned fixture directories/);
 }finally{rmSync(workspace,{recursive:true,force:true});}
});

test('interruption cleanup stops registered engines and ingest groups but rejects changed process identity',{timeout:5000},async()=>{
 const workspace=dataDirectory(mkdtempSync(path.join(tmpdir(),'smoke-processes-'))),id='22222222-2222-4222-8222-222222222222',root=path.join(workspace,'runs',id),children=[];
 mkdirSync(root,{recursive:true});
 try{
  for(const group of [false,true]){
   const child=spawn(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)','--',root],{detached:group,stdio:['ignore','pipe','ignore']});children.push(child);await once(child.stdout,'data');
   retainProcess(root,child.pid,group);
  }
  const file=path.join(root,'owned-processes.jsonl'),original=readFileSync(file,'utf8');
  writeFileSync(file,original.split('\n').filter(Boolean).map(l=>JSON.stringify({...JSON.parse(l),started:'not the current process'})).join('\n')+'\n');
  cleanupInterrupted({run_id:id,artifact_root:root},workspace);
  for(const c of children)assert.doesNotThrow(()=>process.kill(c.pid,0));
  assert.ok(JSON.parse(readFileSync(path.join(root,'interruption-cleanup.json'))).attempts.every(a=>!a.signal));
  writeFileSync(file,original);const exits=children.map(c=>once(c,'exit'));
  cleanupInterrupted({run_id:id,artifact_root:root},workspace);
  await Promise.all(exits);
  assert.equal(JSON.parse(readFileSync(path.join(root,'interruption-cleanup.json'))).attempts.filter(a=>a.signal).length,2);
 }finally{for(const c of children)if(c.exitCode===null&&!c.signalCode)c.kill('SIGKILL');rmSync(workspace,{recursive:true,force:true});}
});

test('runtime storage stays external and desktop ownership/cleanup stay bound to that workspace',()=>{
 const workspace=dataDirectory(mkdtempSync(path.join(tmpdir(),'smoke-storage-')));
 try{
  const configured=process.env.SMOKE_DATA_DIR;
  try{delete process.env.SMOKE_DATA_DIR;assert.ok(!dataDirectory().startsWith(ROOT+path.sep));process.env.SMOKE_DATA_DIR=workspace;assert.equal(dataDirectory(),workspace);}
  finally{if(configured===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=configured;}
  const rejected=spawnSync(process.execPath,[path.join(ROOT,'server.mjs')],{env:{...process.env,SMOKE_DATA_DIR:path.join(ROOT,'data')},encoding:'utf8',timeout:10000});
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/outside the source checkout/);assert.equal(existsSync(path.join(ROOT,'data')),false);
  assert.throws(()=>dataDirectory('relative-data'),/absolute/);
  assert.throws(()=>dataDirectory(path.join(ROOT,'data')),/outside/);
  const repo=path.join(workspace,'other-checkout');mkdirSync(path.join(repo,'.git'),{recursive:true});
  assert.throws(()=>dataDirectory(path.join(repo,'outputs')),/outside Git/);
  const alias=path.join(workspace,'source-alias');symlinkSync(ROOT,alias);
  assert.throws(()=>externalPath(path.join(alias,'results','report.json')),/outside/);
  const root=path.join(workspace,'desktop-runs','desktop-probe'),bundle=path.join(root,'projects','Golden.wiz');mkdirSync(bundle,{recursive:true});
  const session={dataDir:workspace,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard')};
  verifyDesktopPaths(session,workspace);
  assert.throws(()=>verifyDesktopPaths({...session,dataDir:repo},workspace),/configured external/);
  assert.throws(()=>verifyDesktopPaths({...session,bundle:workspace},workspace),/outside/);
  const id='11111111-1111-4111-8111-111111111111',runRoot=path.join(workspace,'runs',id);mkdirSync(runRoot,{recursive:true});
  cleanupInterrupted({run_id:id,artifact_root:runRoot},workspace);
  assert.deepEqual(JSON.parse(readFileSync(path.join(runRoot,'interruption-cleanup.json'))).attempts,[]);
  const other=path.join(workspace,'unrelated');mkdirSync(other);
  assert.match(cleanupInterrupted({run_id:id,artifact_root:other},workspace),/outside/);
  assert.equal(existsSync(path.join(other,'interruption-cleanup.json')),false);
 }finally{rmSync(workspace,{recursive:true,force:true});}
});

// Local rendering must never dispatch a provider graph or read another workspace's image.
test('local preview rejects provider nodes, incomplete graphs and outside media',()=>{
 const root=dataDirectory(mkdtempSync(path.join(tmpdir(),'smoke-local-preview-'))),image=path.join(root,'image.png');writeFileSync(image,'owned');
 try{
  const graph={coverage:{next_offset:null,graph_nodes:2,other_scene_objects_unprojected:0},nodes:[{node_ref:'source',type:'image_source',media:{bound:true,path:image}},{node_ref:'blur',type:'gaussian_blur',bypassed:false}],edges:[{from:{node_ref:'source'},to:{node_ref:'blur'}}]};assertLocalPreviewGraph(graph,root);
  assert.throws(()=>assertLocalPreviewGraph({...graph,nodes:[graph.nodes[0],{...graph.nodes[1],type:'wiz.gen.img2img'}]},root),/provider nodes/);
  assert.throws(()=>assertLocalPreviewGraph({...graph,coverage:{...graph.coverage,next_offset:2}},root),/complete/);
  assert.throws(()=>assertLocalPreviewGraph({...graph,nodes:[{...graph.nodes[0],media:{bound:true,path:'/etc/hosts'}},graph.nodes[1]]},root),/owned image/);
  assert.throws(()=>assertLocalPreviewGraph({...graph,edges:[]},root),/connection/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
