import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {existsSync,constants} from 'node:fs';
import {mkdir,mkdtemp,cp,rename,rm} from 'node:fs/promises';
import {ROOT,dataDirectory,fingerprint,readJSON,writeJSON,digest,sha} from '../runner/files.mjs';
import {assert} from '../runner/engine.mjs';

const run=(cmd,args,options={})=>execFileSync(cmd,args,{encoding:'utf8',timeout:120000,...options});
export async function setupAttachmentTools(app,configuredDataDir){
 const data=dataDirectory(configuredDataDir),sdk='/opt/homebrew/opt/qtbase';
 const qtVersion=run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',path.join(app,'Contents/Frameworks/QtCore.framework/Versions/A/Resources/Info.plist')]).trim();
 const sourceHash=digest(await Promise.all([...['bridge.cpp','bug-report-prefill.h','build.sh','smoke-style.json'].map(file=>sha(path.join(ROOT,'desktop/native',file))),sha(new URL(import.meta.url))]));
 const parent=path.join(data,'attachment-tools'),key=digest({qtVersion,sourceHash,arch:process.arch}),destination=path.join(parent,key);
 if(existsSync(destination)){
  const tools=await readJSON(path.join(destination,'tools.json'));
  assert(tools.qtVersion===qtVersion&&tools.sourceHash===sourceHash&&tools.architecture===process.arch&&tools.directory===path.join(destination,'tools'),'Cached attachment descriptor differs from the selected build or adapter source.');
  await verifyAttachmentTools(tools);return tools;
 }
 assert(process.platform==='darwin','Selected-build attachment requires macOS.');
 const bundled=path.join(ROOT,'attachment-tools',key);
 if(existsSync(bundled)){
  const tools=await readJSON(path.join(bundled,'tools.json'));
  assert(tools.qtVersion===qtVersion&&tools.sourceHash===sourceHash&&tools.architecture===process.arch&&tools.directory==='tools','Bundled adapter does not match the selected build and source.');
  await verifyAttachmentTools({...tools,directory:path.join(bundled,'tools')});
  await mkdir(parent,{recursive:true});const temp=await mkdtemp(path.join(parent,'.tools-'));
  try{await cp(path.join(bundled,'tools'),path.join(temp,'tools'),{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});await writeJSON(path.join(temp,'tools.json'),{...tools,directory:path.join(destination,'tools')});await rename(temp,destination);}finally{await rm(temp,{recursive:true,force:true});}
  return verifyAttachmentTools({...tools,directory:path.join(destination,'tools')});
 }
 assert(existsSync(path.join(sdk,'bin/qtpaths')),'Desktop attachment needs the matching Qt SDK and pkg-config. Agent setup: docs/desktop-tools-setup.md.');
 assert(run(path.join(sdk,'bin/qtpaths'),['--qt-version']).trim()===qtVersion,'The selected build needs a Qt '+qtVersion+' attachment plugin; the local Qt SDK differs. See docs/desktop-tools-setup.md.');
 await mkdir(parent,{recursive:true});const temp=await mkdtemp(path.join(parent,'.tools-'));
 try{
  run('/bin/sh',[path.join(ROOT,'desktop/native/build.sh')],{env:{...process.env,SMOKE_DATA_DIR:temp}});
  const output=path.join(temp,'tools');await mkdir(path.join(output,'styles'),{recursive:true});
  const bridge=path.join(output,'styles/libwizard_smoke.dylib');await cp(path.join(temp,'native/styles/libwizard_smoke.dylib'),bridge);
  const test=path.join(output,'QtTest.framework');await cp(path.join(sdk,'lib/QtTest.framework'),test,{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
  const testBinary=path.join(test,'Versions/A/QtTest');
  for(const binary of [bridge,testBinary]){
   const dependencies=run('/usr/bin/otool',['-L',binary]).split('\n').slice(1).map(line=>line.trim().split(' (')[0]);
   for(const from of dependencies){const match=from.match(/\/(Qt\w+)\.framework\/Versions\/A\/\1$/);if(!match)continue;
    const name=match[1];if(name==='QtTest'&&binary===testBinary)continue;
    assert(name==='QtTest'||existsSync(path.join(app,'Contents/Frameworks',name+'.framework/Versions/A',name)),'Selected build lacks '+name+'.');
    run('/usr/bin/install_name_tool',['-change',from,name==='QtTest'?'@loader_path/../QtTest.framework/Versions/A/QtTest':'@executable_path/../Frameworks/'+name+'.framework/Versions/A/'+name,binary]);
   }
   run('/usr/bin/codesign',['--force','--sign','-',binary]);
  }
  const tools={kind:'selected-build-attachment',qtVersion,sourceHash,architecture:process.arch,directory:path.join(destination,'tools'),sha256:(await fingerprint(output)).sha256};
  await writeJSON(path.join(temp,'tools.json'),tools);
  try{await rename(temp,destination);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;}
  await verifyAttachmentTools(tools);return tools;
 }finally{await rm(temp,{recursive:true,force:true});}
}
export async function verifyAttachmentTools(tools){
 assert(tools.kind==='selected-build-attachment'&&(await fingerprint(tools.directory)).sha256===tools.sha256,'Attachment tools changed or are missing. Rebuild the tools before preparing.');
 return tools;
}
