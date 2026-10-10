import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

test('a rejected second attachment preserves the live receipt and plugin; setup failure releases its lease',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-attach-ownership-'));
 try{
  const app=path.join(root,'source.app'),owned=path.join(root,'owned'),tools=path.join(root,'tools');
  await mkdir(app);await mkdir(path.join(owned,'Wizard Smoke.app'),{recursive:true});await mkdir(path.join(owned,'plugins/styles'),{recursive:true});await mkdir(path.join(tools,'styles'),{recursive:true});
  const file=path.join(owned,'session.json'),plugin=path.join(owned,'plugins/styles/libwizard_smoke.dylib');
  const original='{"pid":123,"generation":1,"native":"native-1","desktopLease":{"pid":456}}\n';await writeFile(file,original);await writeFile(plugin,'live plugin');await writeFile(path.join(tools,'styles/libwizard_smoke.dylib'),'replacement');
  const source=process.env.ATHANOR_REVIEW_BASELINE?execFileSync('/usr/bin/git',['show',process.env.ATHANOR_REVIEW_BASELINE+':smoke/desktop/attach.mjs'],{encoding:'utf8'}):await readFile(new URL('../desktop/attach.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('export async function attachSelectedBuild'),source.indexOf('\nif(process.argv[1]'));
  const prefix=`import path from 'node:path';import {constants,existsSync} from 'node:fs';import {mkdir,mkdtemp,cp,open,realpath} from 'node:fs/promises';import {writeJSON,sha,inside} from ${JSON.stringify(new URL('../runner/files.mjs',import.meta.url).href)};const process={platform:'darwin'};const dataDirectory=x=>x;const assert=(v,m)=>{if(!v)throw Error(m)};const fingerprint=async()=>({sha256:'package'});const verifyAttachmentTools=async()=>{};let blocked=true;export let releases=0;export function allow(){blocked=false}const acquireDesktopLease=async()=>{if(blocked)throw Error('Desktop occupied');return {receipt:{pid:456},release:async()=>releases++}};`;
  const module=path.join(root,'attachment.mjs');await writeFile(module,prefix+body);const attach=await import(pathToFileURL(module));
  const session={root:owned,generation:1,plan:{runtime:{tools:{directory:tools,qtVersion:'fixture'}}}};
  await assert.rejects(()=>attach.attachSelectedBuild({app,dataDir:root,preparedSession:session}),/Desktop occupied/);
  assert.equal(await readFile(file,'utf8'),original,'The first session must remain inspectable and stoppable');assert.equal(await readFile(plugin,'utf8'),'live plugin');assert.ok(!(await readdir(owned)).includes('native-2'));
  attach.allow();await writeFile(path.join(owned,'native-2'),'blocks setup');
  await assert.rejects(()=>attach.attachSelectedBuild({app,dataDir:root,preparedSession:session}),/EEXIST/);assert.equal(attach.releases,1);assert.equal(await readFile(file,'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
