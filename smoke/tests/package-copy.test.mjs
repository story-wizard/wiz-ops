import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,symlink,readlink,access,rm} from 'node:fs/promises';
import {copySelectedPackage,fingerprint} from '../runner/files.mjs';

test('owned package copies omit unsealed runtime additions and preserve signed content and symlinks',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-package-copy-'));
 try{
  const source=path.join(root,'Source.app'),copy=path.join(root,'Copy.app');
  const files={'Contents/MacOS/wizard-bin':'executable','Contents/_CodeSignature/CodeResources':'seal','Contents/MacOS/logs/agent.log':'runtime log','Contents/Resources/__pycache__/module.pyc':'cache','Contents/Resources/.DS_Store':'finder','Contents/Resources/logs/fixture.txt':'signed fixture'};
  for(const [file,text] of Object.entries(files)){const p=path.join(source,file);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,text);}
  await symlink('wizard-bin',path.join(source,'Contents/MacOS/wizard-link'));
  await copySelectedPackage(source,copy);
  await assert.rejects(access(path.join(copy,'Contents/MacOS/logs')),{code:'ENOENT'});
  for(const file of Object.keys(files).filter(file=>file!=='Contents/MacOS/logs/agent.log'))assert.equal(await readFile(path.join(copy,file),'utf8'),files[file]);
  assert.equal(await readlink(path.join(copy,'Contents/MacOS/wizard-link')),'wizard-bin');
  assert.equal((await fingerprint(copy,{packageTree:true})).sha256,(await fingerprint(source,{packageTree:true})).sha256);
  assert.equal(await readFile(path.join(source,'Contents/MacOS/logs/agent.log'),'utf8'),'runtime log');
 }finally{await rm(root,{recursive:true,force:true});}
});
