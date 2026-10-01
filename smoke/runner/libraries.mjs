import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {realpath,mkdir,cp} from 'node:fs/promises';
import {externalPath,sha,writeJSON} from './files.mjs';

// Retain byte-identical non-system libraries; do not rewrite or resign the tested app.
export async function retainLibraries(runtime,directory,{includeExternal=false}={}){
 directory=externalPath(directory);
 const roots=[path.join(runtime.app,'Contents/MacOS/wizard'),path.join(runtime.app,'Contents/MacOS/wizard-export-worker'),runtime.cli,runtime.qtPlugin,runtime.bridge];
 const seen=new Set(),found=new Map();
 async function visit(input,executable,inherited=[]){
  const file=await realpath(input);if(seen.has(file))return;seen.add(file);
  const text=execFileSync('/usr/bin/otool',['-l',file],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
  const expand=v=>v.replaceAll('@loader_path',path.dirname(file)).replaceAll('@executable_path',path.dirname(executable));
  const rpaths=[...text.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g)].map(m=>expand(m[1])).concat(inherited);
  const ownID=text.match(/cmd LC_ID_DYLIB\s+cmdsize \d+\s+name (.*?) \(offset/)?.[1];
  const names=execFileSync('/usr/bin/otool',['-L',file],{encoding:'utf8',timeout:15000}).split('\n').slice(1).map(l=>l.trim().split(' (')[0]).filter(Boolean);
  for(const name of names){
   if(name===ownID)continue;
   if(name.startsWith('/System/')||name.startsWith('/usr/lib/'))continue;
   const override=runtime.libraries&&path.join(runtime.libraries,path.basename(name));
   const candidates=override&&existsSync(override)?[override]:name.startsWith('@rpath/')?rpaths.map(p=>path.join(p,name.slice(7))):[expand(name)];
   const match=candidates.find(p=>existsSync(p));if(!match)throw Error('Unresolved runtime library '+name+' required by '+file);
   const resolved=await realpath(match);let item=found.get(resolved);
   if(!item){item={source:resolved,sha256:await sha(resolved),aliases:[],external:!includeExternal&&resolved.startsWith('/opt/homebrew/')};found.set(resolved,item);}
   if(includeExternal){const frameworkName=name.match(/([^/]+\.framework)/)?.[1],retained=frameworkName&&runtime.libraries&&path.join(runtime.libraries,frameworkName);item.framework=retained&&existsSync(retained)?retained:resolved.includes('.framework/')?resolved.slice(0,resolved.indexOf('.framework/')+10):item.framework;}
   for(const alias of [path.basename(name),path.basename(resolved)])if(!item.aliases.includes(alias))item.aliases.push(alias);
   await visit(resolved,executable,rpaths);
  }
 }
 for(const file of roots)await visit(file,file);
 await mkdir(directory,{recursive:true});
 const files=new Map();
 for(const item of found.values())if(!item.external){
  if(item.framework)await cp(item.framework,path.join(directory,path.basename(item.framework)),{recursive:true,verbatimSymlinks:true});
  for(const alias of item.aliases){
   if(files.has(alias)&&files.get(alias)!==item.sha256)throw Error('Runtime library name collision: '+alias);
   files.set(alias,item.sha256);const output=path.join(directory,alias);await cp(item.source,output);
   if(await sha(output)!==item.sha256)throw Error('Runtime library changed while copying: '+alias);
  }
 }
 const manifest={format:'wizard-smoke-libraries/v1',vendored:[...found.values()].filter(x=>!x.external),external:[...found.values()].filter(x=>x.external).map(x=>({path:x.source,sha256:x.sha256}))};
 await writeJSON(path.join(directory,'manifest.json'),manifest);return manifest;
}
