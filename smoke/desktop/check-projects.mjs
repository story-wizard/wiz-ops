import path from 'node:path';
import {existsSync} from 'node:fs';
import {readdir,mkdir,copyFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {nativeCall,desktopCall,stopDesktop,launchDesktop,terminateOwnedDesktop} from './adapter.mjs';
import {attachSelectedBuild} from './attach.mjs';
import {recordStep,waitForObservation,failedCheckEvidence} from './check-support.mjs';
import {observedWidget} from './checklist-proof.mjs';
import {verifyNewProject,verifyProjectCopy,verifyProjectlessPreferences,verifyProjectHub} from './project-proof.mjs';
import {readJSON,writeJSON,sha,inside} from '../runner/files.mjs';
import {failureStatus,assert,same,snapshotState} from '../runner/engine.mjs';

// Each workflow has a fresh owned group. Only rebind after the UI observes the
// target bundle; changing the session descriptor cannot manufacture that result.
export async function projectWorkflow(file,holder,id){
 const original=await readJSON(file),result={id,status:'Pass'},artifacts=[],directory=path.join(original.root,'evidence');await mkdir(directory,{recursive:true});
 const n=(op,p)=>nativeCall(file,op,p),c=(op,p)=>desktopCall(file,op,p),ui=()=>n('inspect'),until=waitForObservation;
 const step=(name,title,phase,fn)=>recordStep(file,{id:name,title,phase},fn);
 // The selected GUI endpoint has one serialized call channel.
 const timelines=async()=>{const result={};for(const timeline_id of [original.main.id,original.alternate.id])result[timeline_id]=await c('timeline.inspect',{timeline_id});return result;};
 const baseline=await timelines();let sequence=0;
 async function observe(phase,value){const output=path.join(directory,id+'-graph-observations-'+phase+'.txt');await writeJSON(output,value);artifacts.push(output);return output;}
 async function capture(phase){const main=observedWidget(await ui(),w=>w.class==='MainWindow','Owned project window'),image=await n('snapshot-widget',{target:main.id}),output=path.join(directory,id+'-'+(++sequence)+'-'+phase+'.png');await copyFile(image.path,output);artifacts.push(output);return output;}
 async function action(text){const a=(await ui()).actions.filter(a=>a.text===text&&a.enabled);assert(a.length===1,'Expected one enabled action: '+text);await n('action',{target:a[0].id});}
 async function save(){await action('Save');const session=await readJSON(file),ref=name=>execFileSync('/usr/bin/git',['-C',session.bundle,'rev-parse','refs/heads/'+name],{encoding:'utf8'}).trim();await until(async()=>ref('main')===ref('autosave'),{description:'GUI Save checkpoint settles'});}
 async function bind(bundle,main){
  await until(async()=>(await ui()).widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(bundle)+' — Wizard')),{description:'Application switches to '+path.basename(bundle)});
  assert(inside(await realpath(original.root),await realpath(bundle)),'Project escaped its owned fixture');
  const session=await readJSON(file);Object.assign(session,{bundle,main});await writeJSON(file,session);
 }
 async function restart(bundle,main){
  await stopDesktop(file,{quit:true});await holder.live.closed;const stopped=await readJSON(file);
  assert(stopped.lastQuit?.observed?.pid===stopped.pid,'Normal Quit did not retain the owned process acknowledgment');await observe('quit-'+stopped.generation,stopped.lastQuit);
  Object.assign(stopped,{bundle,main});await writeJSON(file,stopped);holder.live=await launchDesktop(stopped);
 }
 try{
  await step('baseline','Save and retain the starting project','prepare',async()=>{await save();await observe('before',baseline);await capture('before');});
  const hashes=async()=>Object.fromEntries(await Promise.all(Object.keys(baseline).map(async tid=>[tid,await sha(path.join(original.bundle,'timelines',tid,'timeline.otio'))]))),originalHashes=await hashes();
  if(id==='D-PREFERENCES-PROJECTLESS'){
   await step('projectless','Start the selected build at its project hub','prepare',async()=>{
    await stopDesktop(file);await holder.live.closed;
    holder.live=await attachSelectedBuild({app:original.sourceApp,dataDir:original.dataDir,preparedSession:await readJSON(file)});
    const u=await ui();verifyProjectHub(u);await observe('hub',u);
   });
   await step('preferences','Open and inspect Application Preferences','execute',async()=>{
    await n('click',{target:observedWidget(await ui(),w=>w.name==='startupPreferencesButton'&&w.enabled,'Hub Preferences button').id});
    const u=await until(async()=>{const u=await ui();return u.widgets.some(w=>w.class==='PreferencesDialog')?u:null;},{description:'Projectless Preferences'}),dialog=observedWidget(u,w=>w.class==='PreferencesDialog','Preferences dialog');
    const observed=verifyProjectlessPreferences(u,dialog.id);await observe('preferences',{pages:observed.pages,inspection:u});
    for(const title of ['System','Interface','Audio']){await n('item-click',{target:observed.nav.id,text:title});await until(async()=>(await ui()).widgets.some(w=>w.window===dialog.id&&w.name==='settingsPageTitle'&&w.text===title),{description:'Application Preferences page '+title});}
    const image=await n('snapshot-widget',{target:dialog.id}),output=path.join(directory,id+'-preferences.png');await copyFile(image.path,output);artifacts.push(output);
    await n('click',{target:observedWidget(await ui(),w=>w.window===dialog.id&&w.text==='Cancel','Preferences Cancel').id});await until(async()=>!(await ui()).widgets.some(w=>w.class==='PreferencesDialog'),{description:'Preferences Cancel returns to hub'});
    assert((await ui()).widgets.some(w=>w.name==='startupOpenButton'),'Preferences did not return to the projectless hub');result.evidence={pages:observed.pages,cancelReturnedToHub:true};
   });
   await step('reopen','Reopen the original project and compare its content','verify',async()=>{
    same(await hashes(),originalHashes,'Projectless Preferences preserves stored timelines');
    await terminateOwnedDesktop(file,holder.live);await holder.live.closed;holder.live=await launchDesktop(await readJSON(file));verifyProjectCopy(baseline,await timelines());await capture('reopened');
   });
  }else{
   const bundle=path.join(original.root,id==='D-PROJECT-NEW'?'new-project.wiz':'saved-copy.wiz');assert(!existsSync(bundle),'Project workflow needs a fresh destination');
   let main=original.main,expectedName;
   if(id==='D-PROJECT-NEW')await step('create','Create a named empty project through New Project','execute',async()=>{
    expectedName='Athanor new project';await action('Project...');
    const u=await until(async()=>{const u=await ui();return u.widgets.some(w=>w.class==='ProjectCreationDialog')?u:null;},{description:'New Project dialog'}),dialog=observedWidget(u,w=>w.class==='ProjectCreationDialog','New Project');
    for(const [name,text] of [['projectNameEdit',expectedName],['projectPathEdit',bundle]])await n('text',{target:observedWidget(u,w=>w.window===dialog.id&&w.name===name,name).id,text});
    await n('click',{target:observedWidget(u,w=>w.window===dialog.id&&w.text==='Create','Create project').id});
    await until(async()=>(await ui()).widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith('new-project.wiz — Wizard')),{description:'Newly created project becomes active'});
    const ids=(await readdir(path.join(bundle,'timelines'))).filter(t=>t.startsWith('tl_'));assert(ids.length===1,'New project should have one default timeline');main={id:ids[0]};await bind(bundle,main);
    const snapshot=await c('timeline.inspect',{timeline_id:main.id});result.evidence=verifyNewProject(await c('project.get_name'),expectedName,snapshot,Object.keys(baseline));await observe('created',snapshot);
   });
   else if(id==='D-PROJECT-SAVE-AS')await step('copy','Save As to an independent project bundle','execute',async()=>{
    expectedName=(await c('project.get_name')).name;await action('Save As...');
    const u=await until(async()=>{const u=await ui();return u.widgets.some(w=>w.class==='QFileDialog'&&w.title==='Save Project As')?u:null;},{description:'Save Project As dialog'}),dialog=observedWidget(u,w=>w.class==='QFileDialog'&&w.title==='Save Project As','Save Project As');
    const field=observedWidget(u,w=>w.window===dialog.id&&w.name==='fileNameEdit','Save As filename');await n('text',{target:field.id,text:bundle});await n('key',{target:field.id,key:'Return'});await bind(bundle,main);
    const copied=await timelines();verifyProjectCopy(baseline,copied);same((await c('project.get_name')).name,expectedName,'Copied project name');await observe('copied',copied);await capture('copied');
    const name='Independent saved-copy timeline';await c('timeline.update',{id:'copy-rename',timeline_id:main.id,changes:{name}});
    await until(async()=>(await ui()).widgets.some(w=>w.name==='panelSubtabSelector'&&w.text.startsWith(name)),{description:'Copied project edit appears in UI'});
    result.evidence={independentBundle:bundle,preservedTimelineIds:Object.keys(baseline),editedName:name};
   });
   else throw Error('Unknown project workflow: '+id);
   await step('reopen','Save, reopen and inspect the new bundle','verify',async()=>{
    await save();const current=await c('timeline.inspect',{timeline_id:main.id}),pid=(await readJSON(file)).pid;await capture('saved');await restart(bundle,main);
    assert((await readJSON(file)).pid!==pid,'Reopen reused the process');same(snapshotState(await c('timeline.inspect',{timeline_id:main.id})),snapshotState(current),'Fresh-process project content');same((await c('project.get_name')).name,expectedName,'Reopened project name');await observe('reopened',await c('timeline.inspect',{timeline_id:main.id}));await capture('reopened');
    same(await hashes(),originalHashes,'New bundle edits preserve original timeline files');
    await restart(original.bundle,original.main);verifyProjectCopy(baseline,await timelines());result.evidence={...result.evidence,freshProcessReopen:true,normalQuit:true,originalUnchanged:true};
   });
  }
  result.evidence={...result.evidence,artifacts};
 }catch(e){e.evidence={...e.evidence,artifacts};result.status=failureStatus(e);result.error=e.message;result.diagnostics=e.diagnostics||null;result.evidence=await failedCheckEvidence(file,e,id);}
 await writeJSON(path.join(original.root,'desktop-project-report.json'),{results:[result]});return result;
}
