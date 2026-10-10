import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readCliSchema} from '../runner/cli-schema.mjs';
import {digest,sha} from '../runner/files.mjs';
import {assertMappedPackagedSchema} from '../runner/schema-compatibility.mjs';
import {pairDesktopCli} from '../desktop/adapter.mjs';

test('old and scoped CLIs expose the same full registry without spawning; malformed and partial registries stay rejected',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-schema-discovery-'));
 try{
  const baseline=JSON.parse(await readFile(new URL('../runner/contracts/installed-schema.json',import.meta.url))),cli=path.join(root,'wiz-cli'),receipt=path.join(root,'calls');
  const fixture=async(body)=>{await writeFile(receipt,'');await writeFile(cli,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);if(!args.includes('--no-spawn'))process.exit(3);fs.appendFileSync(${JSON.stringify(receipt)},JSON.stringify(args)+'\\n');${body}`,{mode:0o700});};
  for(const behavior of [
   `console.log(JSON.stringify(${JSON.stringify(baseline)}));`,
   `if(!args.includes('create')){console.error('Missing subcommand');process.exit(2)}console.log(JSON.stringify(${JSON.stringify(baseline)}));`,
  ]){await fixture(behavior);assert.equal(digest(readCliSchema(cli)),digest(baseline));}
  // The new operation-specific command is intentionally a fragment; root discovery avoids it.
  await fixture(`console.log(JSON.stringify(args.includes('create')?{operations:{'project.create':{}}}:${JSON.stringify(baseline)}));`);
  assert.equal(digest(readCliSchema(cli)),digest(baseline));assert.equal((await readFile(receipt,'utf8')).trim().split('\n').length,1);
  for(const body of [`console.log('{broken');`,`console.log(JSON.stringify({operations:{'project.create':{}}}));`,`console.error('permission denied');process.exit(2);`]){await fixture(body);assert.throws(()=>readCliSchema(cli));}
  for(const value of ['{broken','null','true','0','[]']){await fixture(`console.log(${JSON.stringify(value)});`);assert.throws(()=>readCliSchema(cli));assert.equal((await readFile(receipt,'utf8')).trim().split('\n').length,1,'Malformed registry must not trigger another discovery attempt');}
  const changed=structuredClone(baseline);changed.operations['project.create'].required.push('unreviewed');await fixture(`console.log(JSON.stringify(${JSON.stringify(changed)}));`);
  assert.throws(()=>assertMappedPackagedSchema(readCliSchema(cli),baseline,null),/different command schema/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('GUI pairing rejects changed registry or binary before replacing a retained pair and receipt',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-cli-pair-'));
 try{
  const schema=JSON.parse(await readFile(new URL('../runner/contracts/installed-schema.json',import.meta.url))),source=path.join(root,'source-cli'),file=path.join(root,'session.json');
  const executable=value=>`#!${process.execPath}\nconsole.log(JSON.stringify(${JSON.stringify(value)}));`;
  await writeFile(source,executable(schema),{mode:0o700});const session={root,plan:{schemaHash:digest(schema),runtime:{kind:'selected-build-attachment',cliHash:await sha(source)}}};
  await pairDesktopCli(session,source);const receipt=await readFile(file,'utf8'),pairedHash=await sha(session.desktopCli);
  const changed=structuredClone(schema);delete changed.operations['media.probe'];await writeFile(source,executable(changed));
  await assert.rejects(()=>pairDesktopCli(session,source),/registry differs/);assert.equal(await readFile(file,'utf8'),receipt);assert.equal(await sha(session.desktopCli),pairedHash);
  await writeFile(source,executable(schema)+'\n// changed binary');await assert.rejects(()=>pairDesktopCli(session,source),/binary differs/);assert.equal(await readFile(file,'utf8'),receipt);assert.equal(await sha(session.desktopCli),pairedHash);
 }finally{await rm(root,{recursive:true,force:true});}
});
