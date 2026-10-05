import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

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
