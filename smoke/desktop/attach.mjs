import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {constants,existsSync} from 'node:fs';
import {mkdir,mkdtemp,cp,open,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dataDirectory,fingerprint,readJSON,writeJSON,sha,inside} from '../runner/files.mjs';
import {assert,pause} from '../runner/engine.mjs';
import {nativeCall,verifyDesktopOwner,verifyNativeCapabilities} from './adapter.mjs';
import {setupAttachmentTools,verifyAttachmentTools} from './attachment-tools.mjs';

const run=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',timeout:120000,...options});

export async function attachSelectedBuild({app,dataDir=dataDirectory(),preparedSession}={}){
 dataDir=dataDirectory(dataDir);app=await realpath(app);
 assert(process.platform==='darwin','Selected-build attachment requires macOS.');
 const tools=preparedSession?.plan.runtime?.tools||await setupAttachmentTools(app,dataDir);await verifyAttachmentTools(tools);const version=tools.qtVersion;
 const executableName=existsSync(path.join(app,'Contents/MacOS/wizard-bin'))?'wizard-bin':'wizard';
 const source=await fingerprint(app,{packageTree:true});
 await mkdir(path.join(dataDir,'attachments'),{recursive:true});
 const root=preparedSession?.root||await mkdtemp(path.join(dataDir,'attachments','attach-')),copy=path.join(root,'Wizard Smoke.app');
 assert(inside(dataDir,root),'Attachment root must stay in the owned workspace.');
 if(!existsSync(copy))await cp(app,copy,{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
 assert((await fingerprint(copy,{packageTree:true})).sha256===source.sha256,'Attachment copy differs from the selected build.');
 const generation=(preparedSession?.generation||0)+1,native=path.join(root,'native-'+generation),settings=path.join(root,'settings'),home=path.join(root,'home'),plugins=path.join(root,'plugins');
 for(const dir of [native,settings,home,path.join(root,'projects'),path.join(plugins,'styles')])await mkdir(dir,{recursive:true});
 await cp(tools.directory,plugins,{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
 const bridge=path.join(plugins,'styles/libwizard_smoke.dylib');
 const session={...preparedSession,format:'wizard-smoke-attachment/v1',dataDir,root,bundle:preparedSession?.bundle||path.join(root,'projects'),app:copy,sourceApp:app,executableName,executable:path.join(copy,'Contents/MacOS',executableName),guiHash:source.sha256,sourcePackageHash:source.sha256,native,harnessId:path.basename(root),generation,inputMode:'desktop',state:'Preparing',scope:'Selected packaged build with an external Qt test plugin; original app and bundled Qt unchanged',toolHash:await sha(bridge),qtVersion:version};
 const file=path.join(root,'session.json');await writeJSON(file,session);
 const stdout=await open(path.join(root,'stdout.log'),'a'),stderr=await open(path.join(root,'stderr.log'),'a');
 const env={PATH:path.join(copy,'Contents/MacOS')+':/usr/bin:/bin',HOME:home,LANG:'en_US.UTF-8',WIZARD_SETTINGS:settings,XDG_CONFIG_HOME:settings,QT_PLUGIN_PATH:plugins,WIZ_SMOKE_CONTROL_DIR:native,WIZ_SMOKE_SETTINGS_DIR:settings,WIZ_HARNESS_RUN_ID:session.harnessId,WIZSERVER_RUNTIME_DIR:path.join(root,'gui-runtime-'+generation),WIZSERVER_SANDBOX_ROOT:root,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
 // Use the shipped launcher so its packaged configuration bootstrap runs.
 const child=spawn(path.join(copy,'Contents/MacOS/wizard'),['-style','Basic'],{cwd:root,env,stdio:['ignore',stdout.fd,stderr.fd]});await stdout.close();await stderr.close();
 const closed=new Promise(resolve=>child.once('close',resolve));let spawnError;child.once('error',e=>spawnError=e);
 try{
  let ready;const deadline=Date.now()+30000;
  while(Date.now()<deadline){if(spawnError)throw spawnError;assert(child.exitCode===null&&!child.signalCode,'Selected build exited before attachment.');try{ready=await readJSON(path.join(native,'ready.json'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await pause(100);}
  assert(ready?.pid===child.pid&&ready.harness===session.harnessId,'Attachment did not bind to the launched process.');
  assert(ready.settingsFormat===1&&inside(settings,ready.settingsFile),'Selected build did not establish isolated INI settings.');
  session.capabilities=verifyNativeCapabilities(ready,['inspect','click','action','text','key','activate','screenshot']);
  session.pid=child.pid;session.processStart=run('/bin/ps',['-p',String(child.pid),'-o','lstart=']).trim();session.state='Attached';session.settingsFile=ready.settingsFile;session.env=env;
  await writeJSON(file,session);verifyDesktopOwner(session,dataDir);
  const ui=await nativeCall(file,'inspect');assert(ui.widgets.length>0,'Attached process has no observed UI.');await writeJSON(path.join(root,'inspection.json'),ui);
  assert((await fingerprint(copy,{packageTree:true})).sha256===source.sha256,'The selected app changed during attachment.');
  const loaded=run('/usr/sbin/lsof',['-p',String(child.pid),'-Fn'],{maxBuffer:8*1024*1024}).split('\n').filter(line=>line.startsWith('n/')).map(line=>line.slice(1));
  for(const name of ['QtCore','QtGui','QtWidgets'])assert(loaded.some(p=>p===path.join(copy,'Contents/Frameworks',name+'.framework/Versions/A',name))&&!loaded.some(p=>p.includes('/'+name+'.framework/')&&!p.startsWith(copy+'/')),'Attachment loaded '+name+' outside the selected build.');
  await writeJSON(path.join(root,'attachment-evidence.json'),{selectedApp:app,copy,packageHash:source.sha256,executable:session.executable,pid:session.pid,settingsFile:ready.settingsFile,qtVersion:version,toolHash:session.toolHash,capabilities:session.capabilities,loaded,widgetCount:ui.widgets.length});
  return {session,file,child,closed};
 }catch(e){child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(force);session.state='Blocked';session.error=e.message;await writeJSON(file,session);throw e;}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const index=process.argv.indexOf('--app');if(index<0)throw Error('Use attach.mjs --app /absolute/path/Wizard.app');
 const attached=await attachSelectedBuild({app:process.argv[index+1]});
 console.log(JSON.stringify({session:attached.file,pid:attached.session.pid,packageHash:attached.session.sourcePackageHash,attached:true}));
 const stop=()=>attached.child.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);const limit=setTimeout(stop,120000);await attached.closed;clearTimeout(limit);
}
