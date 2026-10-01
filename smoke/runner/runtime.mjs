import path from 'node:path';
import {readFile,realpath,access,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {constants,existsSync} from 'node:fs';
import {dataDirectory,fingerprint,sha,digest,readJSON,writeJSON} from './files.mjs';

export async function installedRuntime(configuredDataDir){
 const directory=dataDirectory(configuredDataDir),input=await readJSON(path.join(directory,'desktop-runtime.json')),configured=input.runtime||input;
 return Object.fromEntries(['app','cli','qtPlugin','libraries','bridge'].filter(k=>configured[k]).map(k=>{if(typeof configured[k]!=='string')throw Error('Invalid installed test-tools configuration.');return [k,path.resolve(directory,configured[k])];}));
}
export const runtimeEnvironment=runtime=>runtime?.libraries?{DYLD_LIBRARY_PATH:runtime.libraries,DYLD_FRAMEWORK_PATH:runtime.libraries,...(existsSync(path.join(runtime.libraries,'qml'))?{QML_IMPORT_PATH:path.join(runtime.libraries,'qml')}:{})}:{};
export async function runtimeIdentity(input,configuredDataDir){
 if(!input)try{input=await installedRuntime(configuredDataDir);}catch(e){if(e.code==='ENOENT')throw Error('Desktop test tools are not installed. Install a harness bundle, or supply an explicit runtime.');throw e;}
 if(!input||Object.keys(input).some(k=>!['app','cli','qtPlugin','libraries','bridge'].includes(k)))throw Error('Desktop runtime requires app, cli and qtPlugin paths, with optional libraries and bridge.');
 if(input.bridge!==undefined&&(typeof input.bridge!=='string'||!path.isAbsolute(input.bridge)))throw Error('Choose an absolute native bridge path.');
 const paths={};
 for(const key of ['app','cli','qtPlugin']){
  if(typeof input[key]!=='string'||!path.isAbsolute(input[key]))throw Error('Choose an absolute desktop '+key+' path.');
  paths[key]=await realpath(input[key]);
 }
 if(input.libraries){if(typeof input.libraries!=='string'||!path.isAbsolute(input.libraries))throw Error('Choose an absolute retained library path.');paths.libraries=await realpath(input.libraries);paths.librariesHash=(await fingerprint(paths.libraries)).sha256;}
 const binary=path.join(paths.app,'Contents/MacOS/wizard');await access(binary,constants.X_OK);await access(paths.cli,constants.X_OK);
 const bytes=await readFile(binary);
 for(const marker of ['WIZ_HARNESS_RUN_ID','WIZ_AUTOMATION_PROJECT'])if(!bytes.includes(Buffer.from(marker)))throw Error('Selected desktop app lacks '+marker+'; isolated desktop execution is unavailable.');
 if(path.basename(paths.qtPlugin)!=='libqcocoa.dylib')throw Error('Choose the smoke Cocoa plugin explicitly.');
 const schema=JSON.parse(execFileSync(paths.cli,['project','create','--schema','--no-spawn'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024,env:{...process.env,...runtimeEnvironment(paths)}}));
 if(digest(schema)!=='d073ecf91a99dc3969955af45185d6ebc76885676e4d06627a1d30f570ad1f46')throw Error('Paired desktop CLI schema differs from the mapped smoke contract. Qualify its operations before execution.');
 if(!schema.operations?.['project.get_name']||!schema.operations?.['timeline.inspect'])throw Error('Paired CLI does not expose the required desktop operations.');
 const bridge=await realpath(input.bridge||path.join(dataDirectory(configuredDataDir),'native/styles/libwizard_smoke.dylib'));await access(bridge);
 return {...paths,bridge,appHash:(await fingerprint(paths.app,{packageTree:true})).sha256,cliHash:await sha(paths.cli),qtHash:await sha(paths.qtPlugin),bridgeHash:await sha(bridge),schemaHash:digest(schema),scope:'Instrumented desktop/service app; packaged preparation identity is recorded separately'};
}
export async function verifyRuntime(runtime,configuredDataDir){
 const actual=await runtimeIdentity({app:runtime.app,cli:runtime.cli,qtPlugin:runtime.qtPlugin,bridge:runtime.bridge,...(runtime.libraries?{libraries:runtime.libraries}:{})},configuredDataDir);
 if(digest(actual)!==digest(runtime))throw Error('Desktop runtime changed since preparation. Prepare again.');
 return actual;
}
export async function saveRuntime(dataDir,input){
 dataDir=dataDirectory(dataDir);
 const runtime=await runtimeIdentity(input,dataDir),id=digest(runtime),directory=path.join(dataDir,'runtimes');
 await mkdir(directory,{recursive:true});await writeJSON(path.join(directory,id+'.json'),{id,runtime});return {id,runtime};
}
export async function runtimeList(dataDir){
 const directory=path.join(dataDir,'runtimes');let names;try{names=await readdir(directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 return Promise.all(names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>readJSON(path.join(directory,n))));
}
