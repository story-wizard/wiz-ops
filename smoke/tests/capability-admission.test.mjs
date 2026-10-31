import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {admitChecks} from '../runner/capabilities.mjs';
import {operationSupport,assertMappedPackagedSchema} from '../runner/schema-compatibility.mjs';
import {resolveSelection,selectedRecipe} from '../runner/catalog.mjs';
import {startPreparation} from '../runner/preparations.mjs';
import {checkPrepared} from '../runner/prepare.mjs';
import {executeCourse} from '../runner/run.mjs';
import {PackagedEngine} from '../runner/engine.mjs';
import {digest,writeJSON,sha} from '../runner/files.mjs';import {ingestPython} from '../runner/ingest.mjs';
const captured=JSON.parse(await readFile(new URL('../runner/contracts/installed-schema.json',import.meta.url))),qualified=JSON.parse(await readFile(new URL('../runner/contracts/packaged-schema-qualifications.json',import.meta.url)));
const selection=()=>resolveSelection({}, {courseIds:['packaged-full'],subsetIds:['A-CLI-01','IN-03']}),course=()=>selectedRecipe(selection());

test('capability admission keeps the frozen selection and runs a supported check beside an unsupported check',async()=>{
 const schema=structuredClone(captured);delete schema.operations['media.probe'];const recipe=course(),before=digest(recipe),admission=admitChecks(recipe,schema,captured,qualified);assert.equal(digest(recipe),before);assert.equal(admission.checks.find(c=>c.id==='IN-03').state,'N/A');assert.equal(admission.checks[0].state,'Ready');assert.equal(admission.compatibility.mode,'review-required');assert.throws(()=>assertMappedPackagedSchema(schema,captured,qualified),/different command schema/);
 const root=await mkdtemp('/private/tmp/athanor-admission-execute-');try{let calls=0;const results=await executeCourse({course:recipe,engine:{root,plan:{},revisions:new Map(),async call(bundle){calls++;this.revisions.set(bundle,'observed-revision');return {name:'Golden A-CLI-01'};}},fixtures:{},admission,onResult:async()=>{}});assert.equal(results[0].status,'Pass');assert.equal(results[1].status,'N/A');assert.equal(calls,2);}finally{await rm(root,{recursive:true,force:true});}
});

test('unused changes do not prevent known contracts, while changed requests, results and references remain guarded',()=>{
 for(const mutate of [s=>s.operations['audio.batch'].description='Changed unused meaning',s=>s.results['media.probe']={type:'string'},s=>s.operations['media.probe'].required.push('new_required')]){
  const schema=structuredClone(captured);mutate(schema);const admission=admitChecks(course(),schema,captured,qualified);assert.equal(admission.checks[0].state,'Ready');assert.ok(admission.unqualifiedOperations.length);if(schema.results['media.probe']?.type==='string'||schema.operations['media.probe'].required.includes('new_required'))assert.equal(admission.checks[1].state,'Blocked');
 }
 const changed=structuredClone(captured);changed.operations['project.create'].required.push('unreviewed');assert.ok(admitChecks(course(),changed,captured,qualified).checks.every(c=>c.state==='Blocked'));
 const global=structuredClone(captured);global.serialization='unreviewed';assert.equal(operationSupport(global,captured,qualified).qualifiedOperations.length,0);
 const referenced={operations:{read:{type:'object',properties:{target:{$ref:'#/operations/other'}}},other:{type:'object'}}},future=structuredClone(referenced);future.operations.other.description='Changed';assert.ok(!operationSupport(future,referenced,null).qualifiedOperations.includes('read'));
 assert.throws(()=>admitChecks(course(),changed,captured,{...qualified,baselineHash:'wrong'}),/baseline does not match/);
});

test('unsupported semantic desktop capabilities are visible before launch and block only their prerequisites',()=>{
 const recipe=selectedRecipe(resolveSelection({}, {courseIds:['smoke-full'],subsetIds:['D-SB-CREATE','D-PB-01']})),schema=structuredClone(captured);delete schema.operations['spellbook.list'];const admission=admitChecks(recipe,schema,captured,qualified);assert.equal(admission.checks.find(c=>c.id==='D-SB-CREATE').state,'N/A');assert.equal(admission.checks.find(c=>c.id==='D-PB-01').state,'Ready');assert.equal(admission.checks.find(c=>c.id==='D-CLI-01').state,'Ready');
});

test('a dynamically requested unqualified operation is rejected before a CLI process or mutation',async()=>{
 const plan={app:'/Never-launched.app',admission:{qualifiedOperations:['project.get_name']}},engine=new PackagedEngine(plan,'/private/tmp','test',captured);await assert.rejects(()=>engine.call('/private/tmp/Test.wiz','media.probe'),e=>e.code==='operation_contract_unqualified'&&e.diagnostics.dispatch==='not_started');
});

test('actual preparation admits the supported remainder, pins the full registry and rechecks admission',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-admission-prepare-');try{
  const app=path.join(root,'Synthetic.app'),macos=path.join(app,'Contents/MacOS'),python=ingestPython(app),fixtures=path.join(root,'fixtures');await mkdir(macos,{recursive:true});await mkdir(path.dirname(python),{recursive:true});await mkdir(fixtures);
  const schema=structuredClone(captured);delete schema.operations['media.probe'];await writeFile(path.join(macos,'wiz-cli'),`#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(schema))});`,{mode:0o700});await writeFile(python,`#!${process.execPath}\nconsole.log('Synthetic ingest-profile boundary');`,{mode:0o700});
  await writeFile(path.join(app,'Contents/Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>2026.10.15-ccccccc</string></dict></plist>');
  const files=[];for(const [i,id]of ['plate','motion','audio','still','mxf','mask'].entries()){const file=id+'.fixture';await writeFile(path.join(fixtures,file),'Fixture '+i);files.push({id,file,sha256:await sha(path.join(fixtures,file))});}const content={format:'wizard-smoke-fixtures/v1',version:1,files};await writeJSON(path.join(fixtures,'manifest.json'),{...content,sha256:digest(content)});
  const started=await startPreparation({app,dataDir:root,selection:selection(),fixtureRoot:fixtures});await started.completion;assert.equal(started.job.state,'Ready');const plan=JSON.parse(await readFile(path.join(root,'plans',started.job.planHash+'.json')));assert.equal(started.job.buildSupport.schemaHash,digest(schema));assert.equal(started.job.buildSupport.checks.find(c=>c.id==='IN-03').state,'N/A');assert.equal(plan.schemaHash,digest(schema));assert.deepEqual(plan.recipe.selection,selection());assert.equal(plan.admission.checks.find(c=>c.id==='IN-03').state,'N/A');assert.equal(plan.runtime,null);await checkPrepared(root,plan);const packet=JSON.parse(await readFile(path.join(root,'schema-reviews',digest(schema)+'.json')));assert.deepEqual(packet.schema,schema);assert.deepEqual(packet.checks,plan.admission.checks);assert.deepEqual(packet.unqualifiedOperations,plan.admission.unqualifiedOperations);
  const tampered=structuredClone(plan);tampered.admission.checks[1].state='Ready';delete tampered.planHash;tampered.planHash=digest(tampered);await assert.rejects(()=>checkPrepared(root,tampered),/admission changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

