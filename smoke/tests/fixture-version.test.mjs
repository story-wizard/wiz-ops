import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {recordFixtureVersion} from '../desktop/fixture-version.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';

test('generated fixture records its actual package creator without changing format or test state',{skip:process.platform!=='darwin'},async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'athanor-fixture-version-'))),bundle=path.join(root,'projects',path.basename(root),'Golden.wiz'),app=path.join(root,'Wizard.app');
 try{
  await mkdir(bundle,{recursive:true});await mkdir(path.join(app,'Contents'),{recursive:true});
  await writeFile(path.join(app,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleVersion</key><string>2026.10.08-example</string></dict></plist>');
  const original={name:`Golden ${path.basename(root)}`,wiz_format_version:'3.1.0',entry_timeline_id:'original-timeline',settings:{retain:true}};
  await writeJSON(path.join(bundle,'project.json'),original);
  const input={root,bundle,app,packageHash:'selected-package'},receipt=await recordFixtureVersion(input),written=await readJSON(path.join(bundle,'project.json'));
  assert.equal(written.wizard_version,'2026.10.08-example');delete written.wizard_version;assert.deepEqual(written,original);
  assert.equal(receipt.added,true);assert.notEqual(receipt.before,receipt.after);assert.deepEqual(await readJSON(path.join(root,'fixture-version.json')),receipt);
  const repeated=await recordFixtureVersion(input);assert.equal(repeated.added,false);assert.equal(repeated.before,repeated.after);
  for(const version of ['earlier-build','',null]){
   await writeJSON(path.join(bundle,'project.json'),{...original,wizard_version:version});const bytes=await readFile(path.join(bundle,'project.json'));
   await assert.rejects(()=>recordFixtureVersion(input),e=>e.status==='Blocked'&&/existing project writer/.test(e.message));assert.deepEqual(await readFile(path.join(bundle,'project.json')),bytes);
  }
  await assert.rejects(()=>recordFixtureVersion({...input,bundle:path.join(root,'user.wiz')}),e=>e.status==='Blocked');
  await writeJSON(path.join(bundle,'project.json'),{...original,name:'User project'});await assert.rejects(()=>recordFixtureVersion(input),e=>e.status==='Blocked'&&/name/.test(e.message));
  await rm(path.join(bundle,'project.json'));const external=path.join(root,'supplied-project.json');await writeJSON(external,original);await symlink(external,path.join(bundle,'project.json'));
  await assert.rejects(()=>recordFixtureVersion(input),e=>e.status==='Blocked');assert.deepEqual(await readJSON(external),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
