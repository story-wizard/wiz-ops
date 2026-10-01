import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=(await readFile(new URL('../public/run-setup.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const courses=[{id:'automated-full',title:'All automated checks',checkCount:137,targets:{packaged:57,desktop:73,service:7},requirements:{targets:['packaged','desktop','service']}},{id:'packaged-full',title:'Build engine checks',checkCount:57,targets:{packaged:57,desktop:0,service:0},requirements:{targets:['packaged']}}];
function launcher({helper=false,lost=false,prepareError}={}){
 const events={},calls=[],opened=[],rendered=[],storage=new Map(),runtime={app:'/Test.app',cli:'/paired-cli',qtPlugin:'/libqcocoa.dylib',bridge:'/bridge'};
 const context={document:{addEventListener(name,fn){events[name]=fn;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID:()=> 'stable-start-id'}};
 runInNewContext(source,context);
 context.configureRunSetup({render(){rendered.push(context.runSetupView(null));},toast(){},onStarted:async id=>opened.push(id),api:async(route,method,body)=>{
  calls.push({route,method,body});
  if(route==='/run-setup')return {builds:[{app:'/Selected.app',label:'Selected build',available:true}],courses,defaultRuntimeId:helper?'helper':'',runtimes:helper?[{id:'missing',available:false,runtime:{app:'/Gone.app'}},{id:'helper',available:true,runtime}]:[]};
  if(route==='/plans'){if(prepareError)throw Error(prepareError);return {app:body.app,planHash:'frozen-plan'};}
  if(route==='/runner/start'){if(lost)throw Error('Response lost');return {runId:'actual-run'};}
  if(route==='/requests/stable-start-id')return {id:'actual-run'};
  throw Error('Unexpected route '+route);
 }});
 return {context,events,calls,opened,rendered};
}
const submit=events=>events.submit({target:{id:'suite-setup-form'},preventDefault(){}});
test('default course exposes all 137 checks and blocks start until its test tools are installed',async()=>{
 const {context,events,calls}=launcher();await context.refreshRunSetup();
 const html=context.runSetupView(null);
 assert.match(html,/All automated checks · 137 checks/);assert.match(html,/Desktop test tools aren’t installed on this Mac/);
 assert.match(html,/type="submit" disabled>Start 137 checks/);assert.ok(!html.includes('launch-options" open'));
 await submit(events);assert.deepEqual(calls.map(c=>c.route),['/run-setup']);
 await events.change({target:{id:'suite-course',value:'packaged-full'}});
 assert.match(context.runSetupView(null),/>Start 57 checks/);assert.ok(!context.runSetupView(null).includes('Desktop test tools aren’t installed'));
 await submit(events);assert.equal(calls.find(c=>c.route==='/plans').body.runtime,undefined);
});
test('one start action prepares the selected build and named course before admitting its exact plan',async()=>{
 const {context,events,calls,opened,rendered}=launcher({helper:true});await context.refreshRunSetup();
 assert.ok(!context.runSetupView(null).includes('Desktop helper'));
 assert.match(context.runSetupView(null),/type="submit" >Start 137 checks/);
 events.input({target:{id:'suite-name',value:'Friday release',dataset:{}}});await submit(events);
 assert.deepEqual(calls.map(c=>c.route),['/run-setup','/plans','/runner/start']);
 const plan=calls[1].body,start=calls[2].body;
 assert.equal(plan.app,'/Selected.app');assert.equal(plan.selection.courseIds[0],'automated-full');assert.equal(plan.selection.title,'Friday release');assert.equal(plan.runtime.app,'/Test.app');
 assert.equal(start.planHash,'frozen-plan');assert.equal(start.requestId,'stable-start-id');assert.deepEqual(opened,['actual-run']);
 assert.ok(rendered.some(html=>html.includes('Starting tests…')),'The pending start should show progress');
 assert.ok(rendered.every(html=>!html.includes('The response was lost.')),'A healthy start must never flash a lost-response warning');
});
test('a lost start response locks the form and recovers the same request without another start',async()=>{
 const {context,events,calls,opened}=launcher({helper:true,lost:true});await context.refreshRunSetup();await submit(events);
 assert.match(context.runSetupView(null),/Start outcome needs checking/);await submit(events);
 assert.equal(calls.filter(c=>c.route==='/runner/start').length,1);
 await events.click({target:{closest:()=>({dataset:{setup:'recover'}})}});
 assert.equal(calls.at(-1).route,'/requests/stable-start-id');assert.deepEqual(opened,['actual-run']);
 assert.equal(calls.filter(c=>c.route==='/runner/start').length,1);
});
test('missing prerequisites explain the next action and never admit a run',async()=>{
 const {context,events,calls}=launcher({helper:true,prepareError:'ENOENT: missing /model/Encoder.mlmodelc'});await context.refreshRunSetup();await submit(events);
 assert.match(context.runSetupView(null),/offline speech model required by this course is missing/);
 assert.match(context.runSetupView(null),/Technical details/);assert.equal(calls.some(c=>c.route==='/runner/start'),false);
});

test('results expose Stop only for the active run and bind it to that run identity',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const view=app.slice(app.indexOf('function runsView()'),app.indexOf('function render()'));
 const run={id:'owned-run',name:'Friday release',build:'Test build',created_at:'2026-09-30',execution:{state:'Running',message:''},results:[]};
 const context={runs:[run],state:{selectedRun:run.id},catalog:{runner:{active:{run_id:run.id}}},statuses:[],esc:String,runCounts:()=>({}),tag:String,progress:()=>'',checkpointView:()=>'',options:()=>''};
 runInNewContext(view,context);
 assert.match(context.runsView(),/data-action="stop-run" data-stop-id="owned-run"/);
 context.catalog.runner.active={run_id:'different-run'};
 assert.ok(!context.runsView().includes('data-action="stop-run"'));
});
