import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeJSON,readJSON} from '../runner/files.mjs';

test('generation observations remain available after an unknown edit and a lost read never invents an unknown mutation',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'athanor-generation-read-'));
 try{
  const file=path.join(root,'session.json');await writeJSON(file,{root,agentUncertain:true});
  const source=await readFile(new URL('../desktop/adapter.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('export async function desktopCall('),source.indexOf('async function desktopCallOwned('));
  const prefix=`import {agentReadOperations} from ${JSON.stringify(new URL('../desktop/adapter.mjs',import.meta.url).href)};import {withAdapterAction} from ${JSON.stringify(new URL('../desktop/agent-proof.mjs',import.meta.url).href)};export let dispatched=0;let lost=false;export function lose(){lost=true}const desktopCallOwned=async()=>{dispatched++;if(lost)throw Object.assign(Error('Lost observation'),{status:'Unknown'});return 'observed'};`;
  const module=path.join(root,'routing.mjs');await writeFile(module,prefix+body);const routing=await import(pathToFileURL(module));
  for(const op of ['generate.status','generate.inspect'])assert.equal(await routing.desktopCall(file,op,{}),'observed');
  await assert.rejects(()=>routing.desktopCall(file,'generate.graphics',{}),e=>e.code==='mutation_unknown');assert.equal(routing.dispatched,2);
  await writeJSON(file,{root,agentUncertain:false});routing.lose();await assert.rejects(()=>routing.desktopCall(file,'generate.status',{}),e=>e.status==='Unknown');assert.equal((await readJSON(file)).agentUncertain,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
