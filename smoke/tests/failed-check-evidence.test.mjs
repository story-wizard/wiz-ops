import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

test('the trim driver keeps the existing timing oracle and retains the wrong values after restoring the fixture',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-trim-driver-'));
 try{
  const baseline={timeline:{timeline_id:'t',fps:24},tracks:[{track_id:'v',items:[{kind:'clip',clip_id:'first',speed:1,timeline_range:{start_seconds:0,end_seconds:4},source:{asset_id:'a',timing:'timed',fps:24,source_range:{start_seconds:1,end_seconds:5},projection_status:'exact',projection_diagnostics:[],source_availability:'bounded'}},{kind:'clip',clip_id:'neighbor',timeline_range:{start_seconds:6,end_seconds:8},source:{asset_id:'b'}}]}]};
  const stub=root+'/adapter.mjs';await writeFile(stub,`import {readFile} from 'node:fs/promises';let changed=false;
export async function nativeCall(file,op,p){if(op==='drag')changed=true;if(op==='key'&&p.key==='Ctrl+Z')changed=false;return {widgets:[{class:'MainWindow',id:'main',active:true},{class:'TimelineWidget',id:'view',y:0}]};}
export async function desktopCall(file,op){const s=JSON.parse(await readFile(file));if(op!=='timeline.inspect')return {};const a=structuredClone(s.baseline);if(changed){a.tracks[0].items[0].timeline_range.end_seconds=3;if(!s.bad)a.tracks[0].items[0].source.source_range.end_seconds=4;}return a;}`);
  const original=await readFile(new URL('../desktop/check-paths.mjs',import.meta.url),'utf8'),source=original.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(relative==='./adapter.mjs'?pathToFileURL(stub).href:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");const driver=root+'/driver.mjs';await writeFile(driver,source);
  for(const bad of [false,true]){
   const directory=root+'/'+bad;await (await import('node:fs/promises')).mkdir(directory);const file=directory+'/session.json';await writeFile(file,JSON.stringify({root:directory,selectedChecks:['D-EDIT-TRIM'],main:{id:'t'},clip:'first',baseline,bad}));
   const run=spawnSync(process.execPath,[driver,file],{encoding:'utf8',timeout:10000});assert.equal(run.status,bad?1:0,run.stderr);const result=JSON.parse(run.stdout).results[0],proof=JSON.parse(await readFile(result.evidence.artifacts[0]));
   assert.equal(proof.status,bad?'Fail':'Pass');assert.equal(proof.actual.timelineRange.end_seconds,3);assert.equal(proof.actual.sourceRange.end_seconds,bad?5:4);assert.equal(proof.expected.durationToleranceSeconds,1e-8);
   const events=(await readFile(directory+'/steps.jsonl','utf8')).trim().split('\n').map(JSON.parse);assert.ok(events.some(e=>e.stepId==='restore'&&e.status==='Completed'));assert.deepEqual(JSON.parse(await readFile(directory+'/trim-undo.json')),baseline);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the vectorscope driver retains unchanged pixels as Fail but keeps an uncertain capture Unknown',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-scope-driver-')),realSupport=new URL('../desktop/check-support.mjs',import.meta.url).href;
 try{
  const env=root+'/env.mjs';await writeFile(env,`export const state={time:0};export function raster(value){return {sampleWidth:64,sampleHeight:32,sampleRgb:Buffer.alloc(64*32*3,value).toString('base64')};}`);
  const support=root+'/support.mjs';await writeFile(support,`import {readFile,writeFile} from 'node:fs/promises';import {recordStep,recordAssertion,widgetPixelDifference} from '${realSupport}';import {state,raster} from './env.mjs';export {widgetPixelDifference};export async function gapFixture(c,s,name){return {timeline:{timeline_id:'t',name},tracks:[{track_id:'v',address:'V1',items:[{kind:'clip',clip_id:'clip'}]}]};}
export async function checks(file){const s=JSON.parse(await readFile(file)),results=[];const ui=async()=>({widgets:[{id:'type',window:'scope',name:'scopesTypeCombo',items:['Vectorscope'],index:0},{id:'tap',window:'scope',name:'scopesTapCombo',items:['Display'],index:0},{id:'plot',window:'scope',class:'VectorscopeView'},{id:'preview',class:'MetalPreviewWidget'}]});
const c=async(op,p)=>{if(op==='playback.seek')state.time=p.time;if(op==='playback.query_transport')return {time:state.time,playing:false};if(op==='timeline.inspect')return gapFixture(c,s.assets,'Vectorscope tap smoke');return {};};
const n=async(op)=>{if(op==='snapshot-widget'){if(s.mode==='unknown'&&state.time===1)throw Object.assign(Error('Capture outcome unknown'),{status:'Unknown'});return {...raster(s.mode==='pass'&&state.time===1?100:0),path:s.root+'/capture.png'};}return {};};
return {s,n,c,ui,until:async(fn,options)=>{const value=await fn();if(!value)throw Object.assign(Error('Observation timeout'),{status:'Fail',diagnostics:{expected:options.description}});return value;},check:async(id,fn)=>{if(id!=='D-SCOPES-VECTOR')return;try{results.push({id,status:'Pass',evidence:await fn()});}catch(e){results.push({id,status:e.status||'Fail',error:e.message,evidence:e.evidence});}},step:(d,fn)=>recordStep(file,d,fn),assertion:(d,p,ok)=>recordAssertion(file,d,p,ok),action:async()=>{},openTimeline:async()=>({id:'view'}),finish:()=>{console.log(JSON.stringify({results}));if(results.some(r=>r.status!=='Pass'))process.exitCode=1;}};}`);
  const physical=root+'/physical.mjs';await writeFile(physical,`import {readFile} from 'node:fs/promises';import {state,raster} from './env.mjs';export async function physicalInput(file){const s=JSON.parse(await readFile(file));return {...raster(state.time===1?100:0),path:s.root+'/capture.png'};}export function clipPoint(){return {};}`);
  const original=await readFile(new URL('../desktop/check-checklist-expansion.mjs',import.meta.url),'utf8'),source=original.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(relative==='./check-support.mjs'?pathToFileURL(support).href:relative==='./physical-input.mjs'?pathToFileURL(physical).href:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");const driver=root+'/driver.mjs';await writeFile(driver,source);
  for(const mode of ['pass','fail','unknown']){
   const directory=root+'/'+mode;await (await import('node:fs/promises')).mkdir(directory);await writeFile(directory+'/capture.png','component capture fixture');const file=directory+'/session.json';await writeFile(file,JSON.stringify({root:directory,currentCheck:'D-SCOPES-VECTOR',mode,assets:{},main:{id:'t'}}));
   const run=spawnSync(process.execPath,[driver,file],{encoding:'utf8',timeout:10000});assert.equal(run.status,mode==='pass'?0:1,run.stderr);const result=JSON.parse(run.stdout).results[0];assert.equal(result.status,mode==='pass'?'Pass':mode==='fail'?'Fail':'Unknown');
   if(mode==='fail'){const proof=JSON.parse(await readFile(result.evidence.artifacts.find(f=>f.endsWith('scope-response.json'))));assert.equal(proof.actual.pixelDifference,0);assert.equal(proof.expected.greaterThan,.5);assert.equal(proof.actual.blackBrightness,0);assert.equal(proof.actual.plateBrightness,100);}
   const events=(await readFile(directory+'/steps.jsonl','utf8')).trim().split('\n').map(JSON.parse);assert.equal(events.some(e=>e.stepId==='cleanup'),mode!=='unknown');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the actual bin driver retains shared generation evidence and stops before copy editing',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-bin-driver-')),bundle=path.join(root,'Golden.wiz'),file=path.join(root,'session.json');
 try{
  const {mkdir}=await import('node:fs/promises');
  for(const [id,name] of [['tl_original','Original'],['tl_copy','Original copy']]){const directory=path.join(bundle,'timelines',id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'timeline.otio'),JSON.stringify({name,tracks:{children:[{children:[{metadata:{wiz:{clip_id:id+'-clip',generator:{generation_id:'gen-shared'}}}}]}]}}));}
  await writeFile(file,JSON.stringify({root,bundle,pid:123,generation:1,currentCheck:'D-BIN-MGFX',selectedChecks:['D-BIN-MGFX']}));
  const fixture=path.join(root,'fixture.mjs');await writeFile(fixture,`export async function createLocalGraphic(){return {timeline:'tl_original',generation:{generation_id:'gen-shared'},placement:{kind:'direct_generation',nestedTimelineId:'tl_original'}};}`);
  const support=path.join(root,'support.mjs'),realSupport=new URL('../desktop/check-support.mjs',import.meta.url).href;
  await writeFile(support,`import {readFile,writeFile} from 'node:fs/promises';
import {recordStep,recordAssertion} from '${realSupport}';
export function gapFixture(){throw Error('This selected check must not create a neighboring fixture');}
export async function checks(file){
 const s=JSON.parse(await readFile(file)),results=[],calls=[];
 const c=async(op,p)=>{calls.push(op);if(op==='timeline.inspect')return {timeline:{name:'Original'}};if(op==='generate.inspect')return {parameters:[]};if(op==='render.export_still')await writeFile(p.output,Buffer.concat([Buffer.from('P6\\n2 1\\n255\\n'),Buffer.from([255,0,0,255,0,0])]));return {};};
 return {s,c,check:async(id,fn)=>{if(id!=='D-BIN-MGFX')return;try{results.push({id,status:'Pass',evidence:await fn()});}catch(e){results.push({id,status:e.status||'Fail',error:e.message,evidence:e.evidence});}},
 step:(d,fn)=>recordStep(file,d,fn),assertion:(d,p,ok)=>recordAssertion(file,d,p,ok),mediaMenu:async(name,label)=>{calls.push('bin-menu:'+label);},mediaItem:async()=>{},finish:()=>{console.log(JSON.stringify({results,calls}));if(results.some(r=>r.status!=='Pass'))process.exitCode=1;}};
}`);
  const original=await readFile(new URL('../desktop/check-selection-bin.mjs',import.meta.url),'utf8'),source=original.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(relative==='./check-support.mjs'?pathToFileURL(support).href:relative==='./generated-fixture.mjs'?pathToFileURL(fixture).href:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");
  const driver=path.join(root,'driver.mjs');await writeFile(driver,source);
  const run=spawnSync(process.execPath,[driver,file],{encoding:'utf8',timeout:10000});assert.equal(run.status,1,run.stderr);
  assert.ok(run.stdout.trim(),run.stderr);const result=JSON.parse(run.stdout);assert.equal(result.results[0].status,'Fail');assert.ok(result.calls.includes('bin-menu:Duplicate'));assert.ok(!result.calls.includes('generate.set_params'));
  const proof=JSON.parse(await readFile(result.results[0].evidence.artifacts[0]));assert.equal(proof.actual.originalGeneration,'gen-shared');assert.equal(proof.actual.copyGeneration,'gen-shared');assert.deepEqual(proof.sources.map(s=>s.timelineId),['tl_original','tl_copy']);assert.ok(proof.sources.every(s=>/^[a-f0-9]{64}$/.test(s.sha256)));
  const events=(await readFile(path.join(root,'steps.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).stepId,'generation-identity');assert.equal(events.at(-1).status,'Fail');assert.ok(!events.some(e=>e.stepId==='edit-copy'));assert.equal(result.calls.filter(x=>x==='project.checkpoint').length,2,'The driver still saves after recording the failed check');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a failing desktop assertion retains its measured evidence alongside the failure capture',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-failed-evidence-'));
 try{
  const file=path.join(root,'session.json'),observations=path.join(root,'scope-graph-observations.txt');
  await writeFile(file,JSON.stringify({root,selectedChecks:['D-SCOPES-VECTOR'],schema:{operations:{}},pid:123,generation:1}));
  await writeFile(observations,JSON.stringify({black:0,plate:125,scopeDelta:0}));
  const stub=path.join(root,'adapter.mjs');await writeFile(stub,`export async function nativeCall(){}; export async function desktopCall(){}; export async function captureDesktopFailure(){return {failureState:'current-state.json',artifacts:['failure.png']};}`);
  const original=await readFile(new URL('../desktop/check-support.mjs',import.meta.url),'utf8');
  const source=original.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(relative==='./adapter.mjs'?pathToFileURL(stub).href:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");
  const probe=path.join(root,'support.mjs');await writeFile(probe,source);const {checks}=await import(pathToFileURL(probe).href);
  const {check,report}=await checks(file,'report.json');
  await check('D-SCOPES-VECTOR',async()=>{throw Object.assign(Error('No measured scope response'),{status:'Fail',evidence:{artifacts:[observations],measurement:'measured'}});});
  const result=JSON.parse(await readFile(path.join(root,'report.json'))).results[0];
  assert.equal(result.status,'Fail');assert.equal(result.error,'No measured scope response');assert.equal(result.evidence.measurement,'measured');
  assert.deepEqual(result.evidence.artifacts,[observations,'failure.png']);assert.equal(result.evidence.failureState,'current-state.json');assert.equal(report.results.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
