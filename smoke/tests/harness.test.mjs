import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {checkHarnessBundle,installHarness} from '../runner/harness.mjs';
import {installedRuntime,runtimeIdentity,runtimeEnvironment} from '../runner/runtime.mjs';
import {ROOT,fingerprint,digest,writeJSON,readJSON,inside} from '../runner/files.mjs';

async function fixtureBundle(directory,version){
 await mkdir(path.join(directory,'workspace'),{recursive:true});await mkdir(path.join(directory,'tools'));
 await writeFile(path.join(directory,'workspace','server.mjs'),version);
 await mkdir(path.join(directory,'tools/Desktop.app/Contents/MacOS'),{recursive:true});await mkdir(path.join(directory,'tools/libraries'));
 await writeFile(path.join(directory,'tools/Desktop.app/Contents/MacOS/wizard'),version);
 await writeFile(path.join(directory,'tools/wiz-cli'),version);await writeFile(path.join(directory,'tools/libqcocoa.dylib'),version);
 await writeFile(path.join(directory,'tools','adapter'),version);
 const inventory=(await fingerprint(directory)).entries,content={format:'wizard-smoke-harness/v1',platform:process.platform,architecture:process.arch,node:'>=24',runtime:{app:'tools/Desktop.app',cli:'tools/wiz-cli',qtPlugin:'tools/libqcocoa.dylib',bridge:'tools/adapter',libraries:'tools/libraries'},sourceHash:(await fingerprint(path.join(directory,'workspace'))).sha256,inventory,inventoryHash:digest(inventory)};
 const manifest={...content,id:digest(content)};await writeJSON(path.join(directory,'harness.json'),manifest);return manifest;
}
test('bundled runtime installation survives relocation, retains older versions, and refuses an update during a test',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'smoke harness # ')));
 try{
  const a=path.join(root,'bundle one'),b=path.join(root,'bundle two'),data=path.join(root,'station');
  const first=await fixtureBundle(a,'first'),second=await fixtureBundle(b,'second');
  const installed=await installHarness(a,data);
  assert.equal(installed.id,first.id);assert.ok(inside(data,installed.runtime.bridge));
  assert.equal(await readFile(installed.runtime.bridge,'utf8'),'first');
  const updated=await installHarness(b,data);assert.equal(updated.id,second.id);
  assert.equal(await readFile(installed.runtime.bridge,'utf8'),'first','An update must preserve the old runtime');
  assert.equal((await installedRuntime(data)).bridge,updated.runtime.bridge);
  assert.equal((await installHarness(b,data)).id,updated.id,'Reinstalling the same version is safe');
  const db=new DatabaseSync(path.join(data,'smoke.sqlite'));db.exec("CREATE TABLE executions(state TEXT); INSERT INTO executions VALUES('Running');");db.close();
  await assert.rejects(()=>installHarness(a,data),/test run is active/);
  assert.equal((await readJSON(path.join(data,'desktop-runtime.json'))).harness.id,second.id);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('bundle verification rejects changed bytes, extra files and runtime paths outside the bundle',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'smoke bundle checks ')));
 try{
  const base=path.join(root,'bundle');await fixtureBundle(base,'original');
  assert.equal((await checkHarnessBundle(base)).manifest.format,'wizard-smoke-harness/v1');
  await writeFile(path.join(base,'tools/adapter'),'changed');await assert.rejects(()=>checkHarnessBundle(base),/files changed/);
  await writeFile(path.join(base,'tools/adapter'),'original');await writeFile(path.join(base,'unexpected'),'extra');await assert.rejects(()=>checkHarnessBundle(base),/files changed/);await rm(path.join(base,'unexpected'));
  const {id,...content}=await readJSON(path.join(base,'harness.json'));content.runtime.bridge='../outside';await writeJSON(path.join(base,'harness.json'),{...content,id:digest(content)});
  await assert.rejects(()=>checkHarnessBundle(base),/runtime path escapes/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('agents resolve installed tools without a runtime argument and validate the paired CLI without spawning an app',async()=>{
 const data=await realpath(await mkdtemp(path.join(tmpdir(),'smoke default tools ')));
 try{
  const runtime={app:'Desktop.app',cli:'wiz-cli',qtPlugin:'libqcocoa.dylib',bridge:'bridge.dylib',libraries:'libraries'};
  await mkdir(path.join(data,'Desktop.app/Contents/MacOS'),{recursive:true});await mkdir(path.join(data,'libraries'));
  await writeFile(path.join(data,'Desktop.app/Contents/MacOS/wizard'),'WIZ_HARNESS_RUN_ID WIZ_AUTOMATION_PROJECT',{mode:0o700});
  await writeFile(path.join(data,runtime.cli),`#!${process.execPath}\nconst fs=require('node:fs');if(!process.argv.includes('--no-spawn'))process.exit(1);fs.writeFileSync(${JSON.stringify(path.join(data,'schema-only-receipt'))},'no-spawn');console.log(fs.readFileSync(${JSON.stringify(path.join(ROOT,'runner/contracts/desktop-schema.json'))},'utf8'));`,{mode:0o700});
  for(const k of ['qtPlugin','bridge'])await writeFile(path.join(data,runtime[k]),'synthetic metadata fixture');
  await writeJSON(path.join(data,'desktop-runtime.json'),{runtime});
  const actual=await runtimeIdentity(undefined,data);assert.equal(actual.app,path.join(data,'Desktop.app'));
  assert.equal(await readFile(path.join(data,'schema-only-receipt'),'utf8'),'no-spawn');
  assert.deepEqual(runtimeEnvironment(actual),{DYLD_LIBRARY_PATH:path.join(data,'libraries'),DYLD_FRAMEWORK_PATH:path.join(data,'libraries')});
 }finally{await rm(data,{recursive:true,force:true});}
});
