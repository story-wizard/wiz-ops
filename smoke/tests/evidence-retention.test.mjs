import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {digest,writeJSON,dataDirectory} from '../runner/files.mjs';
import {localReport,exportLocalReport,renderReport} from '../reports.mjs';
import {imageRetention,pruneReportedImages} from '../runner/evidence-retention.mjs';
import {evidenceSpec,evidenceItems} from '../test-details.mjs';

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9n0AAAAASUVORK5CYII=','base64');
async function fixture({policy=imageRetention,diagnostics,qualificationIds=[]}={}){
 const data=dataDirectory(await mkdtemp(path.join(tmpdir(),'athanor-retention-'))),id='11111111-1111-4111-8111-111111111111',root=path.join(data,'runs',id),shots=path.join(root,'stages/desktop/owned/evidence');
 await mkdir(shots,{recursive:true});await mkdir(path.join(root,'media'),{recursive:true});
 const image={id:'app-state',kind:'image',when:'after',required:true,caption:'Collected to verify the editor.'};
 const recipe={id:'retention-fixture',revision:1,target:'Test',selection:{diagnostics,qualificationIds},cases:['PASS','FAIL','BLOCKED','UNKNOWN'].map(id=>({id,expected:'Independent assertion',operations:['inspect'],evidence:[{id:'proof',kind:'image',when:'after',required:true,caption:'Visual proof to keep.',retainOnPass:true,fileSuffix:'proof-after.png'},image]}))};
 const content={app:'/fixture/Wizard.app',version:'fixture',packageHash:'a'.repeat(64),fixtureHash:'c'.repeat(64),courseHash:digest(recipe),runnerHash:'b'.repeat(64),...(policy?{imageRetention:policy}:{})},plan={...content,planHash:digest(content)};
 const statuses=['Pass','Fail','Blocked','Unknown'],results=recipe.cases.map((c,i)=>({test_id:c.id,status:statuses[i],note:'Recorded '+statuses[i],snapshot:{title:c.id,area:'Test'}}));
 const run={id,name:'Retention fixture',operator:'Framework',created_at:'2026-10-10',execution:{state:'Unknown',updated_at:'2026-10-10',artifact_root:root,package:plan,plan_hash:plan.planHash,recipe},results};
 await writeJSON(path.join(root,'plan.json'),plan);await writeJSON(path.join(root,'course.json'),recipe);await writeJSON(path.join(root,'report.json'),{runId:id,state:'Unknown',planHash:plan.planHash,results:results.map(r=>({id:r.test_id,status:r.status,note:r.note}))});
 const fixtures={format:'fixture',files:[]};fixtures.sha256=digest(fixtures);plan.fixtureHash=fixtures.sha256;
 // Recompute the frozen plan after assigning the real fixture manifest hash.
 const {planHash:ignored,...frozen}=plan;plan.planHash=digest(frozen);run.execution.plan_hash=plan.planHash;
 await writeJSON(path.join(root,'plan.json'),plan);await writeJSON(path.join(root,'report.json'),{runId:id,state:'Unknown',planHash:plan.planHash,results:results.map(r=>({id:r.test_id,status:r.status,note:r.note}))});
 await writeJSON(path.join(root,'media/manifest.json'),fixtures);await writeJSON(path.join(root,'scope.json'),{id:'fixture',sourceRows:[]});await writeJSON(path.join(root,'execution-context.json'),{runnerHash:plan.runnerHash});
 const paths={};const save=async(name,dir=shots)=>{await mkdir(dir,{recursive:true});const p=path.join(dir,name);await writeFile(p,Buffer.concat([pixel,Buffer.from(name)]));paths[name]=p;return p;};
 for(const n of ['pass-before.png','pass-after.png','proof-after.png','shared-after.png','fail-after.png','blocked-after.png','unknown-after.png'])await save(n);
 await save('render.png',path.join(root,'projects/PASS'));await save('fixture.png',path.join(shots,'media'));await writeJSON(path.join(shots,'state.json'),{observed:true});
 const ops=results.map(r=>({caseId:r.test_id,operation:'inspect',evidence:{artifacts:r.test_id==='PASS'?[paths['pass-before.png'],paths['pass-after.png'],paths['proof-after.png'],paths['shared-after.png'],paths['fixture.png'],path.join(shots,'state.json')]:r.test_id==='FAIL'?[paths['fail-after.png'],paths['proof-after.png'],paths['shared-after.png']]:[paths[r.test_id.toLowerCase()+'-after.png'],paths['proof-after.png']]}}));
 await writeFile(path.join(root,'operations.jsonl'),ops.map(JSON.stringify).join('\n')+'\n');
 return {data,root,run,paths,ops,cleanup:()=>rm(data,{recursive:true,force:true})};
}

test('new reports prune only pass-only intermediate PNGs after publication and remain readable/idempotent',async()=>{
 const f=await fixture();try{
  const first=await localReport(f.run,f.data);assert.deepEqual(first.report.acceptance.gaps,[]);assert.equal(first.report.imageRetention.discarded.length,2);await access(f.paths['pass-after.png']);
  const [exported,simultaneous]=await Promise.all([exportLocalReport(f.run,f.data),exportLocalReport(f.run,f.data)]);assert.equal(simultaneous.path,exported.path);const report=JSON.parse(await readFile(path.join(path.dirname(exported.path),'report.json')));
  assert.deepEqual(report.counts,{Pass:1,Fail:1,Blocked:1,Unknown:1});
  for(const n of ['pass-before.png','pass-after.png'])await assert.rejects(()=>access(f.paths[n]),{code:'ENOENT'});
  for(const n of ['proof-after.png','shared-after.png','fail-after.png','blocked-after.png','unknown-after.png','render.png','fixture.png'])await access(f.paths[n]);
  await access(path.join(f.root,'operations.jsonl'));await access(path.join(f.root,'stages/desktop/owned/evidence/state.json'));
  assert.equal(report.cases[0].imageRetention.discarded.length,2);assert.equal(report.cases[0].evidenceRequirements.find(e=>e.id==='app-state').status,'Collected');
  assert.match(renderReport(report),/2 intermediate images cleared after Pass/);
  const manifest=JSON.parse(await readFile(path.join(f.root,'image-retention.json')));assert.equal(manifest.discarded.length,2);assert.ok(manifest.discarded.every(a=>a.sha256.length===64&&a.bytes>0));
  for(const a of manifest.discarded)assert.ok(!report.artifacts.some(x=>x.file===a.file),'Pruned images cannot appear as downloadable artifacts');
  const [again,concurrent]=await Promise.all([exportLocalReport(f.run,f.data),exportLocalReport(f.run,f.data)]);assert.equal(concurrent.path,exported.path);assert.equal(again.path,exported.path);assert.deepEqual((await localReport(f.run,f.data)).report.acceptance.gaps,[]);
  f.run.results[0].status='Fail';await assert.rejects(()=>localReport(f.run,f.data),/retention record differs/);
 }finally{await f.cleanup();}
});

test('historical runs, diagnostic repros and qualification checks retain their PNGs',async()=>{
 for(const opts of [{policy:null},{diagnostics:'investigation'},{qualificationIds:['PASS']}]){
  const f=await fixture(opts);try{const result=await exportLocalReport(f.run,f.data);await access(f.paths['pass-after.png']);await assert.rejects(()=>access(path.join(f.root,'image-retention.json')),{code:'ENOENT'});const r=JSON.parse(await readFile(path.join(path.dirname(result.path),'report.json')));assert.equal(r.imageRetention?.discarded.length||0,0);}finally{await f.cleanup();}
 }
});

test('missing captures retain evidence gaps; unsafe or changed files are never deleted',async()=>{
 const f=await fixture();try{
  await rm(f.paths['proof-after.png']);let result=await localReport(f.run,f.data);assert.ok(result.report.acceptance.gaps.some(g=>g.includes('ENOENT')));assert.equal(result.report.imageRetention.discarded.length,0);await exportLocalReport(f.run,f.data);await access(f.paths['pass-after.png']);
  await writeFile(f.paths['proof-after.png'],pixel);result=await localReport(f.run,f.data);assert.deepEqual(result.report.acceptance.gaps,[]);
  await writeFile(f.paths['pass-before.png'],'Changed after observation');await assert.rejects(()=>pruneReportedImages(f.run,f.root,result.report),/changed/);assert.equal(await readFile(f.paths['pass-before.png'],'utf8'),'Changed after observation');
  await rm(path.join(f.root,'image-retention.json'));
  const outside=path.join(f.data,'outside.png');await writeFile(outside,pixel);await rm(f.paths['pass-before.png']);await symlink(outside,f.paths['pass-before.png']);await assert.rejects(()=>pruneReportedImages(f.run,f.root,result.report),/unowned/);assert.deepEqual(await readFile(outside),pixel);
 }finally{await f.cleanup();}
});

test('pruning metadata cannot hide unrelated missing evidence or authorize an escaping source',async()=>{
 const f=await fixture();try{
  await exportLocalReport(f.run,f.data);const file=path.join(f.root,'image-retention.json'),record=JSON.parse(await readFile(file));record.discarded[0].source='../outside/evidence/secret.png';const {sha256,...content}=record;record.sha256=digest(content);await writeJSON(file,record);
  await assert.rejects(()=>localReport(f.run,f.data),/escapes the run/);
 }finally{await f.cleanup();}
});

test('agents can declare exact visual proof to retain without weakening capture requirements',()=>{
 const check={id:'X',evidence:[{id:'proof',kind:'image',when:'after',required:true,caption:'Visible result',retainOnPass:true,fileSuffix:'proof-after.png'}]};
 const spec={evidence:evidenceSpec({...check,evidence:[{id:'generic',kind:'image',when:'after',required:true,caption:'Intermediate observation'},...check.evidence]})},items=evidenceItems(['intermediate-after.png','proof-after.png'],spec);assert.equal(items[0].specId,'generic');assert.equal(items[1].retainOnPass,true);assert.equal(spec.evidence[1].required,true);
 assert.throws(()=>evidenceSpec({...check,evidence:[{...check.evidence[0],retainOnPass:'yes'}]}),/retention/);assert.throws(()=>evidenceSpec({...check,evidence:[{...check.evidence[0],fileSuffix:'../secret.png'}]}),/retention/);
});


test('one failed collector does not retain every passing check; later report gaps never resurrect pruned links',async()=>{
 const f=await fixture();try{
  await rm(f.paths['fail-after.png']);const first=await localReport(f.run,f.data);assert.equal(first.report.imageRetention.discarded.length,2);assert.ok(first.report.acceptance.gaps.some(g=>g.startsWith('FAIL:')));
  await exportLocalReport(f.run,f.data);await assert.rejects(()=>access(f.paths['pass-after.png']),{code:'ENOENT'});
  await writeFile(path.join(f.root,'operations.jsonl'),'invalid journal');const later=await localReport(f.run,f.data);assert.ok(later.report.acceptance.gaps.length);assert.equal(later.report.imageRetention.discarded.length,2);
  assert.ok(later.report.imageRetention.discarded.every(a=>!later.report.artifacts.some(x=>x.file===a.file)));assert.ok(later.report.cases.every(c=>c.evidence.every(e=>!later.report.imageRetention.discarded.some(a=>a.file===e.file))));
 }finally{await f.cleanup();}
});
