import path from 'node:path';
import {cp,mkdir,mkdtemp,rename,rm,realpath,access,writeFile} from 'node:fs/promises';
import {constants,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {ROOT,dataDirectory,externalPath,fingerprint,digest,readJSON,writeJSON,inside} from './files.mjs';
import {runtimeIdentity} from './runtime.mjs';
import {setupAttachmentTools,verifyAttachmentTools} from '../desktop/attachment-tools.mjs';
import {nativeInputDriver} from '../desktop/macos-input.mjs';
import {retainLibraries} from './libraries.mjs';
import {snapshotSource} from '../kits.mjs';
import {activeStates} from './store.mjs';
import {ownedDesktopSessions,desktopState} from '../desktop/hub.mjs';

const copyOptions={recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE};
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export async function checkHarnessBundle(directory){
 const base=await realpath(directory),manifest=await readJSON(path.join(base,'harness.json')),{id,...content}=manifest;
 if(!['wizard-smoke-harness/v1','wizard-smoke-harness/v2'].includes(manifest.format)||digest(content)!==id||digest(manifest.inventory)!==manifest.inventoryHash)throw Error('Harness manifest is invalid.');
 if(manifest.platform!==process.platform||manifest.architecture!==process.arch)throw Error('Harness platform or architecture differs.');
 if(Number(process.versions.node.split('.')[0])<24)throw Error('The bundled harness requires Node.js 24 or newer.');
 const actual=(await fingerprint(base)).entries.filter(e=>e[0]!=='harness.json');
 if(digest(actual)!==manifest.inventoryHash)throw Error('Harness files changed or are missing.');
 for(const [file,size] of actual)if(size==='symlink'&&!inside(base,await realpath(path.join(base,file))))throw Error('Harness link escapes the bundle: '+file);
 if((await fingerprint(path.join(base,'workspace'))).sha256!==manifest.sourceHash)throw Error('Harness source differs from its manifest.');
 if(manifest.format==='wizard-smoke-harness/v2'){
  const relative=manifest.attachmentTools;
  if(typeof relative!=='string'||path.isAbsolute(relative)||!inside(path.join(base,'workspace/attachment-tools'),path.resolve(base,relative)))throw Error('Harness attachment path escapes the bundle.');
  const descriptor=await readJSON(path.join(base,relative,'tools.json'));
  if(descriptor.directory!=='tools'||descriptor.architecture!==process.arch)throw Error('Harness attachment descriptor is invalid.');
  await verifyAttachmentTools({...descriptor,directory:path.join(base,relative,'tools')});await access(path.join(base,'workspace/server.mjs'));
  return {base,manifest};
 }
 if(!manifest.runtime||['app','cli','qtPlugin','bridge','libraries'].some(k=>typeof manifest.runtime[k]!=='string'))throw Error('Harness runtime configuration is incomplete.');
 await access(path.join(base,'workspace/server.mjs'));
 for(const file of Object.values(manifest.runtime)){
  if(typeof file!=='string'||path.isAbsolute(file)||!inside(base,path.resolve(base,file))||!inside(base,await realpath(path.resolve(base,file))))throw Error('Harness runtime path escapes the bundle.');
 }
 await access(path.join(base,manifest.runtime.app,'Contents/MacOS/wizard'));
 return {base,manifest};
}
export async function bundleHarness({runtime,app,dataDir,destination}){
 const output=externalPath(path.resolve(destination));
 try{await access(output);throw Error('Bundle destination already exists; use a new version directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const identity=app?await setupAttachmentTools(await realpath(app),dataDir):await runtimeIdentity(runtime);
 await mkdir(path.dirname(output),{recursive:true});const temp=await mkdtemp(path.join(path.dirname(output),'.harness-'));
 try{
  await snapshotSource(path.join(temp,'workspace'));
  for(const name of ['README.md','AGENTS.md','docs','examples','tests'])await cp(path.join(ROOT,name),path.join(temp,'workspace',name),copyOptions);
  await writeFile(path.join(temp,'Install Athanor.command'),`#!/bin/zsh\nset -eu\ncd -- "\${0:A:h}/workspace"\nif ! command -v node >/dev/null; then\n print 'Install Node.js 24 or newer, then open this launcher again.'\n read '?Press Return to close.'\n exit 1\nfi\nnode scripts/harness.mjs install --bundle ..\nexec node scripts/harness.mjs start --port 0\n`,{mode:0o755});
  let sourceCommit=null,sourceDirty=null;
  try{const git=args=>execFileSync('/usr/bin/git',['-C',ROOT,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();sourceCommit=git(['rev-parse','HEAD']);sourceDirty=Boolean(git(['status','--porcelain','--','.']));}catch{}
  if(app){
   const key=path.basename(path.dirname(identity.directory)),attachmentTools='workspace/attachment-tools/'+key;
   await cp(identity.directory,path.join(temp,attachmentTools,'tools'),copyOptions);await writeJSON(path.join(temp,attachmentTools,'tools.json'),{...identity,directory:'tools'});
   const native=await nativeInputDriver(dataDir),nativeInput='workspace/native-input/'+path.basename(path.dirname(native.driver));
   await mkdir(path.join(temp,nativeInput),{recursive:true});await cp(native.driver,path.join(temp,nativeInput,'macos-input'));await writeJSON(path.join(temp,nativeInput,'manifest.json'),native.manifest);
   const sourceHash=(await fingerprint(path.join(temp,'workspace'))).sha256,inventory=(await fingerprint(temp)).entries;
   const content={format:'wizard-smoke-harness/v2',createdAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,node:'>=24',sourceCommit,sourceDirty,sourceHash,attachmentTools,nativeInput,qtVersion:identity.qtVersion,inventory,inventoryHash:digest(inventory)};
   await writeJSON(path.join(temp,'harness.json'),{...content,id:digest(content)});await checkHarnessBundle(temp);await rename(temp,output);
   return {path:output,id:digest(content),sourceHash,files:inventory.length,qtVersion:identity.qtVersion,wizardLaunched:false};
  }
  const paths={app:'tools/Desktop.app',cli:'tools/wiz-cli',qtPlugin:'tools/libqcocoa.dylib',bridge:'tools/libwizard_smoke.dylib',libraries:'tools/libraries'};
  await mkdir(path.join(temp,'tools'));
  for(const k of ['app','cli','qtPlugin','bridge'])await cp(identity[k],path.join(temp,paths[k]),{...copyOptions,filter:src=>!['.DS_Store','__pycache__'].includes(path.basename(src))&&!src.endsWith('.pyc')&&(k!=='app'||path.relative(identity.app,src)!=='Contents/MacOS/logs')});
  const libraries=await retainLibraries(identity,path.join(temp,paths.libraries),{includeExternal:true});
  if(libraries.external.length)throw Error('A harness bundle must retain all non-system desktop libraries.');
  if((await fingerprint(path.join(temp,paths.app),{packageTree:true})).sha256!==identity.appHash)throw Error('Desktop app changed while bundling.');
  const copied=await runtimeIdentity(Object.fromEntries(Object.entries(paths).map(([k,v])=>[k,path.join(temp,v)])));
  for(const key of ['appHash','cliHash','qtHash','bridgeHash','schemaHash'])if(copied[key]!==identity[key])throw Error('Runtime changed while bundling: '+key);
  const sourceHash=(await fingerprint(path.join(temp,'workspace'))).sha256,inventory=(await fingerprint(temp)).entries;
  const hashes=Object.fromEntries(['appHash','cliHash','qtHash','bridgeHash','schemaHash','librariesHash'].map(k=>[k,copied[k]]));
  const content={format:'wizard-smoke-harness/v1',createdAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,node:'>=24',sourceCommit,sourceDirty,sourceHash,runtime:paths,runtimeIdentity:hashes,inventory,inventoryHash:digest(inventory)};
  await writeJSON(path.join(temp,'harness.json'),{...content,id:digest(content)});
  await checkHarnessBundle(temp);await rename(temp,output);
  return {path:output,id:digest(content),sourceHash,files:inventory.length,wizardLaunched:false};
 }finally{await rm(temp,{recursive:true,force:true});}
}
function assertStationIdle(data){
 const database=path.join(data,'smoke.sqlite');
 if(existsSync(database)){
  const db=new DatabaseSync(database,{readOnly:true});
  try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='executions'").get()&&db.prepare('SELECT state FROM executions').all().some(r=>activeStates.includes(r.state)))throw Error('A test run is active. Install the update after it finishes.');}finally{db.close();}
 }
 if(ownedDesktopSessions(data).length||desktopState(data).jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)))throw Error('A desktop test session is active. Install the update after it finishes.');
}
export async function installHarness(directory,configuredDataDir){
 const {base,manifest}=await checkHarnessBundle(directory),data=dataDirectory(configuredDataDir);
 await mkdir(data,{recursive:true});assertStationIdle(data);
 const parent=path.join(data,'harness'),destination=path.join(parent,manifest.id);await mkdir(parent,{recursive:true});
 if(existsSync(destination))await checkHarnessBundle(destination);
 else{
  const temp=await mkdtemp(path.join(parent,'.install-'));
  try{await cp(base,temp,copyOptions);const installed=await checkHarnessBundle(temp);if(installed.manifest.id!==manifest.id)throw Error('Bundle changed during installation.');assertStationIdle(data);await rename(temp,destination);}finally{await rm(temp,{recursive:true,force:true});}
 }
 assertStationIdle(data);
 const runtime=manifest.runtime?Object.fromEntries(Object.entries(manifest.runtime).map(([k,v])=>[k,path.join(destination,v)])):null,workspace=path.join(destination,'workspace');
 await writeJSON(path.join(data,'desktop-runtime.json'),{runtime,harness:{id:manifest.id,sourceHash:manifest.sourceHash,workspace}});
 const launcher=path.join(data,'Open Athanor.command'),temporary=launcher+'.'+process.pid+'.tmp';
 await writeFile(temporary,`#!/bin/zsh\nset -eu\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(workspace,'scripts/harness.mjs'))} start --data-dir ${shellQuote(data)} --port 0 "$@"\n`,{mode:0o755});await rename(temporary,launcher);
 return {id:manifest.id,dataDir:data,workspace,runtime,launcher,wizardLaunched:false};
}
