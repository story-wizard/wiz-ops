import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,realpath,rm,readdir,symlink} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {terminateOwnedDesktop} from '../desktop/adapter.mjs';

test('a cancelled service stage closes its owned process even when checkpoint cleanup is locked',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-service-cleanup-'))),root=path.join(data,'desktop-Test'),app=path.join(root,'Wizard Smoke.app'),executable=path.join(app,'Contents/MacOS/wizard-bin'),bundle=path.join(root,'Golden.wiz'),file=path.join(root,'session.json');
 const previous=process.env.SMOKE_DATA_DIR;let child,closed;
 try{
  process.env.SMOKE_DATA_DIR=data;
  await mkdir(path.dirname(executable),{recursive:true});await mkdir(bundle);await cp('/bin/sleep',executable);await writeFile(path.join(app,'Contents/MacOS/wizard-export-worker'),'fixture');
  child=spawn(executable,['30']);closed=new Promise(resolve=>child.once('close',resolve));await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  const session={dataDir:data,root,bundle,app,executable,executableName:'wizard-bin',pid:child.pid,processStart:execFileSync('/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).trim(),state:'Running',inputMode:'service'};
  await writeJSON(file,session);await writeFile(path.join(root,'call.lock'),'retained interrupted call');
  const fixture=path.join(data,'fixture.mjs');
  await writeFile(fixture,`export const live=globalThis.__athanorCleanupLive;export const session=${JSON.stringify(session)};export async function prepareDesktop(){return session;}export async function launchDesktop(){return live;}export async function stopDesktop(){throw Object.assign(Error('Checkpoint call is locked'),{code:'EEXIST'});}export function retainChild(){throw Error('No test driver should start');}export async function nativeCall(){throw Error('Background service cannot dispatch UI input');}export {terminateOwnedDesktop} from ${JSON.stringify(new URL('../desktop/adapter.mjs',import.meta.url).href)};`);
  globalThis.__athanorCleanupLive={child,closed};
  const source=process.env.ATHANOR_REVIEW_BASELINE?execFileSync('/usr/bin/git',['show',process.env.ATHANOR_REVIEW_BASELINE+':smoke/desktop/service-run.mjs'],{encoding:'utf8'}):await readFile(new URL('../desktop/service-run.mjs',import.meta.url),'utf8');
  const module=path.join(data,'service.mjs');await writeFile(module,source.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(relative==='./adapter.mjs'?pathToFileURL(fixture).href:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'"));
  const desktop=fileURLToPath(new URL('../desktop/',import.meta.url));for(const name of await readdir(desktop))await symlink(path.join(desktop,name),path.join(data,name));
  const {executeService}=await import(pathToFileURL(module));const controller=new AbortController();controller.abort();
  const {report}=await executeService({runtime:{app},ids:['S-MGFX-TAIL-TIMING']},{signal:controller.signal});
  assert.ok(child.exitCode!==null||child.signalCode,'Cancellation must not leave the owned app alive');
  assert.equal((await readJSON(file)).state,'Stopped');assert.equal((await readJSON(file)).forcedCleanup,true);
  assert.equal(report.cleanupRecovery?.terminated,true);assert.equal(report.cleanupError,undefined);assert.notEqual(report.status,'Pass');
  assert.match(report.error,/interrupted|aborted/i);assert.equal(await readFile(path.join(root,'call.lock'),'utf8'),'retained interrupted call');
 }finally{
  child?.kill('SIGTERM');await closed;delete globalThis.__athanorCleanupLive;
  if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;
  await rm(data,{recursive:true,force:true});
 }
});

test('forced cleanup rejects a changed owner without signaling the process',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-cleanup-owner-'))),root=path.join(data,'desktop-Test'),bundle=path.join(root,'Golden.wiz'),file=path.join(root,'session.json'),previous=process.env.SMOKE_DATA_DIR;let signals=0;
 try{
  process.env.SMOKE_DATA_DIR=data;await mkdir(bundle,{recursive:true});await writeJSON(file,{dataDir:data,root,bundle,executable:path.join(root,'Wizard Smoke.app/Contents/MacOS/wizard-bin'),executableName:'wizard-bin',pid:process.pid,state:'Running'});
  await assert.rejects(()=>terminateOwnedDesktop(file,{child:{pid:process.pid,exitCode:null,signalCode:null,kill:()=>signals++},closed:Promise.resolve()}),/PID no longer belongs/);
  assert.equal(signals,0);assert.equal((await readJSON(file)).state,'Running');
 }finally{if(previous===undefined)delete process.env.SMOKE_DATA_DIR;else process.env.SMOKE_DATA_DIR=previous;await rm(data,{recursive:true,force:true});}
});
