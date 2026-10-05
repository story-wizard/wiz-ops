import path from 'node:path';
import {mkdir,cp,copyFile,realpath,readFile,writeFile,open,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {readJSON,writeJSON,fingerprint,digest,sha,inside,dataDirectory,copySelectedPackage} from '../runner/files.mjs';

export const uiCourse=await readJSON(new URL('./computer-use-course.json',import.meta.url));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function uiRoot(dataDir,runId){
 if(!uuid.test(runId))throw Error('Choose a retained run UUID.');
 return path.join(dataDirectory(dataDir),'runs',runId,'computer-use');
}
export function selectedUICourse(checks){
 if(checks===undefined)return uiCourse;
 if(!Array.isArray(checks)||!checks.length||new Set(checks).size!==checks.length||checks.some(id=>!uiCourse.cases.some(c=>c.id===id)))throw Error('Choose unique check IDs from the computer-use course.');
 if(checks.some(id=>['C-LP-02-SAVE-AS','C-LP-02-REOPEN'].includes(id)&&(!checks.includes('C-LP-02-NEW')||checks.indexOf('C-LP-02-NEW')>checks.indexOf(id))))throw Error('Save As and reopen selections require New Project first.');
 return {...uiCourse,cases:checks.map(id=>uiCourse.cases.find(c=>c.id===id))};
}
export function verifyUICopy(source,actual,modified=false){
 if(!modified){if(actual.sha256!==source.sha256)throw Error('Owned copy differs from the selected package.');return;}
 const entries=new Map(source.entries.map(e=>[e[0],JSON.stringify(e)]));
 const changed=actual.entries.filter(e=>entries.get(e[0])!==JSON.stringify(e)).map(e=>e[0]);
 if(actual.entries.length!==source.entries.length||changed.length!==1||changed[0]!=='Contents/PlugIns/platforms/libqcocoa.dylib')throw Error('Smoke override must change only the Cocoa plugin.');
}
export async function prepareUI(dataDir,runId,{checks,cocoaPlugin,cocoaSha256}={}){
 const course=selectedUICourse(checks);
 if(!!cocoaPlugin!==!!cocoaSha256||cocoaSha256&&!/^[a-f0-9]{64}$/.test(cocoaSha256))throw Error('Supply both the Cocoa plugin path and its SHA-256.');
 if(cocoaPlugin&&await sha(cocoaPlugin)!==cocoaSha256)throw Error('Cocoa plugin differs from the reviewed SHA-256.');
 const root=uiRoot(dataDir,runId),parent=path.dirname(root),plan=await readJSON(path.join(parent,'plan.json'));
 const {planHash,...content}=plan;if(digest(content)!==planHash)throw Error('Parent plan digest differs.');
 const source=await fingerprint(plan.app,{packageTree:true});if(source.sha256!==plan.packageHash)throw Error('Selected package changed; prepare and run the intended build first.');
 await mkdir(root); // One companion per run; existing observations are never replaced.
 try{
  const app=path.join(root,'Wizard Release UI.app');await copySelectedPackage(plan.app,app);
  verifyUICopy(source,await fingerprint(app,{packageTree:true}));
  let runtimeOverride=null;
  if(cocoaPlugin){
   if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('The qualified Cocoa override requires arm64 macOS.');
   const version=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',path.join(app,'Contents/Frameworks/QtCore.framework/Versions/A/Resources/Info.plist')],{encoding:'utf8'}).trim();
   if(version!=='6.11.2')throw Error('This override is qualified only for bundled Qt 6.11.2.');
   const plugin=path.join(app,'Contents/PlugIns/platforms/libqcocoa.dylib');await copyFile(cocoaPlugin,plugin);
   if(await sha(plugin)!==cocoaSha256)throw Error('Cocoa plugin changed during attachment.');
   const links=execFileSync('/usr/bin/otool',['-L',plugin],{encoding:'utf8'});
   for(const framework of ['QtGui','QtCore']){
    const from='/opt/homebrew/opt/qtbase/lib/'+framework+'.framework/Versions/A/'+framework;
    if(!links.includes(from+' (compatibility version 6.0.0, current version 6.11.2)'))throw Error('Cocoa plugin dependencies differ from the qualified build.');
    execFileSync('/usr/bin/install_name_tool',['-change',from,'@executable_path/../Frameworks/'+framework+'.framework/Versions/A/'+framework,plugin]);
   }
   execFileSync('/usr/bin/codesign',['--force','--sign','-',plugin]);execFileSync('/usr/bin/codesign',['--verify',plugin]);
   runtimeOverride={kind:'smoke-only-cocoa-plugin',qtVersion:version,sourcePluginSha256:cocoaSha256,loadedPluginSha256:await sha(plugin),changedFile:'Contents/PlugIns/platforms/libqcocoa.dylib'};
  }
  const actual=await fingerprint(app,{packageTree:true});verifyUICopy(source,actual,!!runtimeOverride);
  await mkdir(path.join(root,'projects'));await mkdir(path.join(root,'evidence'));
  const runtime={sourcePackageHash:plan.packageHash,packageHash:actual.sha256,runtimeOverride};
  const pass={format:'wizard-smoke-computer-use/v1',runId,revision:1,createdAt:new Date().toISOString(),app,...runtime,runtimeHash:digest(runtime),version:plan.version,driver:'computer-use',course,courseHash:digest(course),state:'Not run',results:course.cases.map(c=>({id:c.id,status:'Not run',note:'',artifacts:[]}))};
  await writeJSON(path.join(root,'pass.json'),pass);return {root,...pass};
 }catch(e){await writeFile(path.join(root,'preparation-error.txt'),e.message);throw e;}
}
export async function retainedUI(dataDir,runId){
 const root=uiRoot(dataDir,runId);let pass;
 try{pass=await readJSON(path.join(root,'pass.json'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(await realpath(root)!==root)throw Error('Computer-use root resolves outside its run.');
 if(pass.app!==path.join(root,'Wizard Release UI.app'))throw Error('Computer-use app is outside its owned run.');
 if(pass.runId!==runId||pass.format!=='wizard-smoke-computer-use/v1'||digest(pass.course)!==pass.courseHash)throw Error('Computer-use identity or frozen course differs.');
 const plan=await readJSON(path.join(path.dirname(root),'plan.json'));
 if((pass.sourcePackageHash||pass.packageHash)!==plan.packageHash)throw Error('Computer-use source package differs from its parent run.');
 if(pass.runtimeHash&&digest({sourcePackageHash:pass.sourcePackageHash,packageHash:pass.packageHash,runtimeOverride:pass.runtimeOverride})!==pass.runtimeHash)throw Error('Computer-use runtime identity differs.');
 if(pass.packageHash!==plan.packageHash&&!pass.runtimeOverride)throw Error('Modified UI runtime has no retained override.');
 if(pass.runtimeOverride){
  if(!pass.runtimeHash||pass.runtimeOverride.kind!=='smoke-only-cocoa-plugin'||pass.runtimeOverride.changedFile!=='Contents/PlugIns/platforms/libqcocoa.dylib')throw Error('Unrecognized computer-use runtime override.');
  if(await sha(path.join(pass.app,pass.runtimeOverride.changedFile))!==pass.runtimeOverride.loadedPluginSha256)throw Error('Computer-use Cocoa plugin changed.');
 }
 const ids=pass.course.cases.map(c=>c.id);
 if(ids.length!==pass.results.length||new Set(ids).size!==ids.length||pass.results.some((r,i)=>r.id!==ids[i]||!['Not run','Pass','Fail','Blocked','Unknown'].includes(r.status)))throw Error('Computer-use results differ from the frozen course.');
 for(const r of pass.results)for(const a of r.artifacts){
  const file=await realpath(path.join(root,a.file));if(!inside(path.join(root,'evidence'),file)||await sha(file)!==a.sha256)throw Error('Computer-use artifact changed: '+a.file);
 }
 return pass;
}
async function projectEvidence(root,relative){
 if(typeof relative!=='string'||!relative.endsWith('.wiz'))throw Error('Supply a saved project bundle.');
 const bundle=await realpath(path.join(root,relative));if(!inside(path.join(root,'projects'),bundle))throw Error('Project must stay in the owned projects directory.');
 const project=await readJSON(path.join(bundle,'project.json')),index=await readJSON(path.join(bundle,'timelines/index.json'));
 const timelines=Array.isArray(index)?index:index.timelines;if(!Array.isArray(timelines)||!timelines.length)throw Error('Saved project has no timeline.');
 const content=[];for(const t of timelines){const id=t.id||t.timeline_id;if(typeof id!=='string'||!/^(tl|cmp)_[a-z0-9-]+$/.test(id))throw Error('Invalid saved timeline identity.');const file=await realpath(path.join(bundle,'timelines',id,'timeline.otio'));if(!inside(bundle,file))throw Error('Timeline resolves outside its project.');content.push(await sha(file));}
 return {bundle:relative,name:project.name,timelines:content};
}
export async function recordUI(dataDir,runId,input){
 const root=uiRoot(dataDir,runId),lock=path.join(root,'record.lock'),held=await open(lock,'wx');
 try{
 const pass=await retainedUI(dataDir,runId);if(!pass)throw Error('Prepare the computer-use pass first.');
 if((await fingerprint(pass.app,{packageTree:true})).sha256!==pass.packageHash)throw Error('Computer-use package changed after preparation.');
 if(!input||Object.keys(input).some(k=>!['id','revision','status','note','artifacts','project','original'].includes(k)))throw Error('Unknown computer-use observation field.');
 if(input.revision!==pass.revision)throw Error('Observation revision changed; inspect the retained pass before recording.');
 const result=pass.results.find(r=>r.id===input.id);if(!result||result.status!=='Not run')throw Error('Check is missing or already recorded; use a new run to repeat it.');
 if(!['Pass','Fail','Blocked','Unknown'].includes(input.status)||typeof input.note!=='string'||!input.note.trim()||input.note.length>6000)throw Error('Supply a terminal outcome and a concrete observation.');
 if(pass.results.some(r=>r.status==='Unknown')&&input.status!=='Blocked')throw Error('An uncertain UI action stops this pass; record remaining checks as Blocked and use a new run to retry.');
 if(!Array.isArray(input.artifacts)||input.artifacts.length>20)throw Error('Supply up to 20 relative evidence paths.');
 const artifacts=[];
 for(const relative of input.artifacts){
  if(typeof relative!=='string'||!/^evidence\/[a-zA-Z0-9_-]+\.(png|jpg|txt)$/.test(relative))throw Error('Use evidence/NAME.png, evidence/NAME.jpg or evidence/NAME.txt.');
  const file=await realpath(path.join(root,relative));if(!inside(path.join(root,'evidence'),file))throw Error('Evidence must stay in the owned evidence directory.');
  const bytes=await readFile(file);if(relative.endsWith('.png')&&(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)))throw Error('Use a PNG screenshot with nonempty dimensions.');
  if(relative.endsWith('.jpg')&&(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217))throw Error('Use a JPEG screenshot.');
  artifacts.push({file:relative,sha256:await sha(file),bytes:bytes.length});
 }
 if(['Pass','Fail'].includes(input.status)&&!artifacts.some(a=>/\.(png|jpg)$/.test(a.file)))throw Error('Executed UI outcomes require a retained screenshot.');
 let saved=null;
 if(input.status==='Pass'&&['C-LP-02-NEW','C-LP-02-SAVE-AS','C-LP-02-REOPEN'].includes(input.id)){
  saved=await projectEvidence(root,input.project);
  if(input.id==='C-LP-02-NEW'&&saved.name!=='Release UI First')throw Error('Saved project has the wrong requested name.');
  if(input.id==='C-LP-02-REOPEN'){
   const baseline=pass.results.find(r=>r.id==='C-LP-02-NEW');
   if(baseline?.status!=='Pass'||baseline.saved.bundle!==saved.bundle||digest(baseline.saved.timelines)!==digest(saved.timelines))throw Error('Reopen must preserve the saved New Project timeline bytes.');
  }
  if(input.id==='C-LP-02-SAVE-AS'){
   const original=await projectEvidence(root,input.original),baseline=pass.results.find(r=>r.id==='C-LP-02-NEW');
   if(baseline?.status!=='Pass'||baseline.saved.bundle!==original.bundle||digest(baseline.saved.timelines)!==digest(original.timelines)||original.bundle===saved.bundle||digest(original.timelines)!==digest(saved.timelines))throw Error('Save As must preserve the original timeline bytes in a separate project.');saved.original=original;
  }
 }
 Object.assign(result,{status:input.status,note:input.note.trim(),artifacts,saved,recordedAt:new Date().toISOString(),oracle:'Agent-reviewed UI observations'+(saved?' and independent saved-bundle inspection':'')});
 pass.revision++;pass.state=pass.results.some(r=>r.status==='Not run')?'Partial':pass.results.some(r=>r.status==='Unknown')?'Unknown':pass.results.some(r=>r.status==='Fail')?'Failed':pass.results.some(r=>r.status==='Blocked')?'Blocked':'Passed';
 pass.updatedAt=new Date().toISOString();await writeJSON(path.join(root,'pass.json'),pass);return pass;
 }finally{await held.close();await unlink(lock);}
}
