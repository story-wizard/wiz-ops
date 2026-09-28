import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT,dataDirectory,externalPath} from '../runner/files.mjs';
import {verifyDesktopPaths} from '../desktop/adapter.mjs';
import {cleanupInterrupted} from '../runner/store.mjs';

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
