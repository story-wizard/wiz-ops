import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {writeBugReporterParcels,readBugReporterParcel} from '../bug-reporter.mjs';
import {prefillReporter} from '../desktop/bug-reporter.mjs';
import {digest,writeJSON} from '../runner/files.mjs';
import {bugDraft} from '../investigations.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGlUAAAAASUVORK5CYII=','base64');
async function parcelFixture(root,{screenshot=true,invalidState=false,unpaired=false}={}){
 const runId='22222222-2222-4222-8222-222222222222',id='D-TEST',project='/fixtures/Golden.wiz',directory='reproductions/'+runId;
 const evidence=path.join(root,directory,'evidence');await mkdir(evidence,{recursive:true});
 for(const [file,bytes]of Object.entries({'window.png':png,'state.json':invalidState?'bad json':JSON.stringify({bundle:project}),'stdout.txt':'token=private-test-token\noperation failed','stderr.txt':'render failure'}))await writeFile(path.join(evidence,file),bytes);
 const c={id,title:'Duplicate a clip',classification:'App',disposition:'Reproduce',duplicateOf:null,original:{expected:'Independent copy',definitionHash:'b'.repeat(64),observation:'Original failure'},attempts:[{runId,status:'Fail',diagnostics:'investigation',diagnosticComplete:true,gaps:[],expected:'Independent copy',procedure:['Duplicate the clip','Save and reopen'],definitionHash:'c'.repeat(64),observation:'Reproduced'}],review:null};
 const record={id:'11111111-1111-4111-8111-111111111111',revision:3,cases:[c],baseline:{runId:'00000000-0000-4000-8000-000000000000',identities:{packageHash:'a'.repeat(64),version:'test'}}};
 const capture={phase:'after',pid:123,generation:2,at:'2026-10-02T22:00:00Z',complete:true,error:null,artifacts:[{file:'state.json',role:'Editor and timeline state'},{file:'stdout.txt',role:'Application log'},{file:'stderr.txt',role:'Application error log'},...(screenshot?[{file:'window.png',role:'Window screenshot'}]:[])]};
 const review={caseId:id,runId,directory,role:'Reproduction',report:directory+'/index.html',captures:[{...capture,phase:'before',at:'2026-10-02T21:59:59Z',generation:unpaired?1:capture.generation},capture],steps:[],evidence:[{file:'window.png',kind:'image',caption:'Failure screenshot'}]};
 const [parcel]=await writeBugReporterParcels(record,[review,{...review,runId:'older-attempt',captures:[]}],[{caseId:id,body:'1. Duplicate the clip\n2. Save and reopen\nObserved: names are duplicated',ready:true}],root);
 return {file:path.join(root,parcel.path),parcel,record,project};
}

test('reporter parcel uses the linked attempt, retains bounded attachments and preserves the human submission gate',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-reporter-'));
 try{
  const {file,parcel}=await parcelFixture(root);assert.equal(parcel.readyForPrefill,true);assert.equal(parcel.readyForSubmission,false);
  const value=await readBugReporterParcel(file);assert.equal(value.source.runId,'22222222-2222-4222-8222-222222222222');assert.equal(value.source.project,'/fixtures/Golden.wiz');assert.equal(value.delivery,'not_submitted');assert.match(value.reportId,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  const report=JSON.parse(await readFile(path.join(path.dirname(file),'report.json')));assert.equal(report.schema_version,1);assert.equal(report.report_id,value.reportId);assert.equal(report.submitted_at,undefined);assert.equal(report.reproduction_steps,value.fields.reproduction_steps);
  const logs=await readFile(path.join(path.dirname(file),'logs.txt'),'utf8');assert.match(logs,/token=\[REDACTED\]/);assert.ok(!logs.includes('private-test-token'));
  await writeFile(path.join(path.dirname(file),'screenshot.png'),'changed');await assert.rejects(()=>readBugReporterParcel(file),/attachment changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('incomplete reporter evidence remains a local parcel needing work',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-reporter-missing-'));
 try{const {file,parcel}=await parcelFixture(root,{screenshot:false,invalidState:true});assert.equal(parcel.readyForPrefill,false);assert.equal(parcel.readyForSubmission,false);assert.ok(parcel.issues.some(s=>s.includes('screenshot')));assert.ok(parcel.issues.some(s=>s.includes('not valid JSON')));await assert.rejects(()=>readBugReporterParcel(file),/Complete the focused/);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('duplicate or resolved cases cannot become submission-ready drafts',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-reporter-gate-'));
 try{const {record}=await parcelFixture(root),c=record.cases[0];c.duplicateOf='PRIMARY';assert.equal(bugDraft(record,c).ready,false);c.duplicateOf=null;c.disposition='Resolved';assert.equal(bugDraft(record,c).ready,false);}
 finally{await rm(root,{recursive:true,force:true});}
});

async function fakeSession(root,project){const dir=path.join(root,'session');await mkdir(dir);const file=path.join(dir,'session.json');await writeJSON(file,{root:dir,bundle:project,pid:123,generation:2,state:'Running',inputMode:'desktop',plan:{packageHash:'a'.repeat(64)}});return file;}
function reporterUI(project){return {actions:[],widgets:[{id:'main',window:'main',class:'MainWindow',title:path.basename(project)+' — Wizard'},{id:'report',window:'report',name:'BugReportDialog'},...['BugReportSummary','BugReportSteps','BugReportExpected'].map((name,i)=>({id:'field-'+i,window:'report',name,enabled:true,editableText:true}))]};}
test('prefill verifies fields, retains a receipt and never dispatches Submit or replaces another project',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-prefill-'));
 try{
  const {file,project}=await parcelFixture(root),session=await fakeSession(root,project),calls=[];
  const call=async(file,op,params)=>{calls.push({op,params});if(op==='capabilities')return {operations:['bug-report-prefill']};if(op==='inspect')return reporterUI(project);if(op==='bug-report-prefill')return {state:'Prefilled',submitted:false,...params};throw Error('Unexpected operation');};
  const result=await prefillReporter(session,file,call);assert.equal(result.delivery,'not_submitted');assert.match(result.fields.reproduction_steps,/Steps\n1\. Duplicate the clip\n2\. Save and reopen\n\nObserved\nReproduced/);assert.equal(JSON.parse(await readFile(result.receiptPath)).source.project,project);assert.ok(calls.every(c=>['capabilities','inspect','bug-report-prefill'].includes(c.op)));assert.equal(calls.filter(c=>c.op==='bug-report-prefill').length,1);
  const s=JSON.parse(await readFile(session));await writeJSON(session,{...s,bundle:'/fixtures/Other.wiz'});calls.length=0;await assert.rejects(()=>prefillReporter(session,file,call),/exact build and reproduction project/);assert.equal(calls.length,0);
  await writeJSON(session,{...s,plan:{packageHash:'d'.repeat(64)}});await assert.rejects(()=>prefillReporter(session,file,call),/exact build/);assert.equal(calls.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('missing capability blocks before opening the app form and an uncertain prefill is never replayed',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-prefill-unknown-'));
 try{
  const {file,project}=await parcelFixture(root),session=await fakeSession(root,project);let writes=0;
  await assert.rejects(()=>prefillReporter(session,file,async(f,op)=>{assert.equal(op,'capabilities');return {operations:[]};}),/updated Athanor attachment/);
  const call=async(f,op)=>{if(op==='capabilities')return {operations:['bug-report-prefill']};if(op==='inspect')return reporterUI(project);writes++;throw Object.assign(Error('Response lost'),{status:'Unknown'});};
  await assert.rejects(()=>prefillReporter(session,file,call),e=>e.status==='Unknown');assert.equal(writes,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('altered fields or unsupported attachment names are rejected before GUI dispatch',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-prefill-tamper-'));
 try{const {file}=await parcelFixture(root),value=JSON.parse(await readFile(file));value.fields.summary='Changed';await writeJSON(file,value);await assert.rejects(()=>readBugReporterParcel(file),/handoff changed/);
  const {contentHash,...content}=value;content.attachments.push({file:'../private.json',bytes:0,sha256:'e'.repeat(64)});await writeJSON(file,{...content,contentHash:digest(content)});await assert.rejects(()=>readBugReporterParcel(file),/Unsupported reporter attachment/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('reporter parcels cannot choose a screenshot from an unpaired process generation',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-reporter-unpaired-'));
 try{const {parcel,file}=await parcelFixture(root,{unpaired:true});assert.equal(parcel.readyForPrefill,false);assert.ok(parcel.issues.some(s=>s.includes('same process and launch generation')));await assert.rejects(()=>readBugReporterParcel(file),/Complete the focused/);}finally{await rm(root,{recursive:true,force:true});}
});
