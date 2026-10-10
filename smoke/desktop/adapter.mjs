import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,open,cp,mkdtemp,unlink,appendFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {realpathSync,appendFileSync,constants} from 'node:fs';
import {PackagedEngine,assert,pause,OutcomeError} from '../runner/engine.mjs';
import {ProjectSession} from '../runner/interactions.mjs';
import {checkPrepared} from '../runner/prepare.mjs';
import {ROOT,dataDirectory,externalPath,readJSON,writeJSON,fingerprint,inside,sha,digest} from '../runner/files.mjs';
import {readCliSchema} from '../runner/cli-schema.mjs';
import {runtimeEnvironment} from '../runner/runtime.mjs';
import {attachSelectedBuild} from './attach.mjs';
import {recordFixtureVersion} from './fixture-version.mjs';
import {verifyDesktopLease} from './desktop-lease.mjs';
import {currentAction,withAgentAction,withAdapterAction,validateApplicationParams,validateNativeParams,markUnknown,requireProof,jsonLines,terminalResult} from './agent-proof.mjs';

export const agentReadOperations=['project.get_name','timeline.inspect','playback.query_transport','graph.get_clip_graph','media.list_assets','media.resolve_path','media.probe','spellbook.inspect','spellbook.list','generate.inspect','generate.status'];
// Observations and ownership-checked clipboard bookkeeping do not edit the test project.
export const agentReadNative=['capabilities','inspect','workspace-inspect','workspace-pipeline-inspect','model-page','model-value','timeline-clip-rect','timeline-point','screenshot','snapshot-widget','snapshot-presented','snapshot-node-preview','clipboard-save','clipboard-mark','clipboard-restore'];
export async function markAgentMutation(file,session){
  if(!session.agentTracking)return;
  if(currentAction(file)?.purpose==='shutdown')return;
  requireProof(!terminalResult(await jsonLines(path.join(session.root,'agent-results.jsonl')),session.agentAttempt),'attempt_closed','Begin a new attempt before another edit',['begin_new_attempt','report']);
  requireProof(!session.agentUncertain,'unresolved_mutation','An earlier mutation is Unknown. Inspect, verify and explicitly resolve it before another edit.',['verify_resolution','resolve','record_unknown']);
  const action=currentAction(file);session.agentRevision=(session.agentRevision||0)+1;
  session.agentLastMutation={id:action?.id||randomUUID(),operation:action?.operation||'raw mutation',revision:session.agentRevision};
  if((!action||action.raw)&&session.agentProof&&(session.agentProof.baseline||Object.keys(session.agentProof.checkpoints).length))session.agentProof.tainted=true;
  await writeJSON(file,session);
}

export function verifyDesktopPaths(session,configuredDataDir){
  const base=realpathSync(dataDirectory(configuredDataDir));
  assert(session.dataDir===base&&inside(base,session.root),'Desktop session must be in the configured external workspace');
  assert(inside(base,session.root)&&realpathSync(session.root)===session.root&&inside(session.root,realpathSync(session.bundle)),'Desktop session is outside the owned workspace.');
  const name=session.executableName||'wizard';
  assert(['wizard','wizard-bin'].includes(name)&&session.executable===path.join(session.root,'Wizard Smoke.app/Contents/MacOS',name),'Unexpected desktop executable.');
}

export function verifyDesktopOwner(session,configuredDataDir){
  verifyDesktopPaths(session,configuredDataDir);
  assert(Number.isInteger(session.pid)&&session.pid>1,'Missing desktop process identity.');
  const actual=execFileSync('/bin/ps',['-p',String(session.pid),'-o','comm='],{encoding:'utf8',timeout:2000}).trim();
  assert(actual===session.executable,'Desktop PID no longer belongs to the recorded executable.');
  if(session.processStart)assert(execFileSync('/bin/ps',['-p',String(session.pid),'-o','lstart='],{encoding:'utf8',timeout:2000}).trim()===session.processStart,'Desktop PID was reused.');
}

export function retainChild(session,pid){
  const command=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8',timeout:2000}).trim();
  const started=execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:2000}).trim();
  appendFileSync(path.join(session.root,'owned-children.jsonl'),JSON.stringify({pid,command,started,group:true})+'\n');
}

export async function pairDesktopCli(session,pairedCli){
  const directory=path.join(session.root,'cli');await mkdir(directory,{recursive:true});
  const source=pairedCli||path.join(path.dirname(session.sourceApp),'wiz-cli');
  const schema=readCliSchema(source,{env:{...process.env,...runtimeEnvironment(session.plan.runtime)}});
  assert(digest(schema)===session.plan.schemaHash,'Paired CLI registry differs from the prepared build. Prepare again.');
  assert(await sha(source)===session.plan.runtime.cliHash,'Paired CLI binary differs from the prepared build. Prepare again.');
  const cli=path.join(directory,'wiz-cli');await cp(source,cli);const cliHash=await sha(cli);
  assert(cliHash===session.plan.runtime.cliHash,'Paired CLI binary changed during copying. Prepare again.');
  session.desktopCli=cli;session.desktopCliHash=cliHash;session.schema=schema;
  session.scope=session.plan.runtime?.kind==='selected-build-attachment'?'Selected packaged GUI and its shipped CLI with an external test plugin':'Instrumented local GUI build and paired CLI; separate from release smoke';
  await writeJSON(path.join(session.root,'session.json'),session);
}

export async function prepareDesktop(sourceApp,qtCocoaPlugin,pairedCli,prepared){
  const {plan,fixtures,schema}=await checkPrepared(prepared?.dataDir,prepared?.plan);
  if(plan.runtime?.kind==='selected-build-attachment'){sourceApp=plan.app;pairedCli=plan.runtime.cli;qtCocoaPlugin=null;}
  else throw new OutcomeError('Desktop tests require attachment to the selected build. Prepare a new selected-build plan.','Blocked');
  const dataDir=dataDirectory(prepared?.dataDir);assert(dataDir===dataDirectory(),'Configure SMOKE_DATA_DIR to match desktop preparation.');
  const directory=externalPath(prepared?.directory||path.join(dataDir,'desktop-runs'));assert(inside(dataDir,directory),'Desktop destination must be inside the configured workspace.');await mkdir(directory,{recursive:true});const root=await mkdtemp(path.join(directory,'desktop-'));
  const app=path.join(root,'Wizard Smoke.app');await cp(sourceApp,app,{recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE});
  const identity=await fingerprint(app,{packageTree:true});await cp(plan.fixtureRoot,path.join(root,'media'),{recursive:true});
  const engine=new PackagedEngine(plan,root,path.basename(root),schema),c=new ProjectSession(engine,path.basename(root),fixtures);
  try{await engine.start();await c.setup();await c.call('project.checkpoint');}finally{await engine.stop();}
  const fixtureVersion=await recordFixtureVersion({root,bundle:c.bundle,app,packageHash:identity.sha256});
  const session={format:'wizard-smoke-desktop/v1',scope:'Selected packaged build with external test tools',dataDir,root,app,sourceApp,executable:path.join(app,'Contents/MacOS/wizard'),guiHash:identity.sha256,cliApp:plan.app,cliPackageHash:plan.packageHash,fixtureHash:plan.fixtureHash,bundle:c.bundle,main:c.main,alternate:c.alternate,clip:c.a,assets:c.assets,harnessId:path.basename(root),generation:0,counter:engine.counter,schema,plan};
  session.fixtureVersion=fixtureVersion;
  if(qtCocoaPlugin){const source=realpathSync(qtCocoaPlugin);assert(path.basename(source)==='libqcocoa.dylib','Choose the local Cocoa plugin explicitly.');session.qtCocoa={source,sha256:await sha(source)};}
  await pairDesktopCli(session,pairedCli);return session;
}

export async function missingMediaContinuation(session,ui,fixtureFile){
  const blocked=message=>{throw new OutcomeError(message,'Blocked');};
  if(!session.selectedChecks?.includes('D-MEDIA-RELINK')||fixtureFile!==path.join(session.root,'relink-prepared.json'))blocked('Offline continuation requires the selected relink check and its owned fixture.');
  const root=realpathSync(session.root);
  if(root!==session.root||realpathSync(fixtureFile)!==fixtureFile)blocked('Relink fixture paths must remain in the owned workspace without redirected parents.');
  const e=await readJSON(fixtureFile);
  if(typeof e.original!=='string'||typeof e.moved!=='string'||realpathSync(path.dirname(e.original))!==path.dirname(e.original))blocked('Relink media paths are invalid or redirected.');
  if(e.asset!==session.assets.plate||e.pid===session.pid||!inside(path.join(root,'media'),e.original)||!inside(path.join(root,'relocated-media'),e.moved)||realpathSync(e.moved)!==e.moved||await sha(e.moved)!==e.digest)blocked('Relink media identity, ownership or bytes changed before reopening.');
  const index=await readJSON(path.join(session.bundle,'assets/index.json')),project=await readJSON(path.join(session.bundle,'project.json')),missing=[];
  for(const a of index.assets){const source=a.local_path||path.join(project.media_roots.find(r=>r.id===a.media_root_id)?.path||'',a.asset_url);try{await access(source);}catch(error){if(error.code!=='ENOENT')throw error;missing.push({asset:a.asset_id,path:source});}}
  if(missing.length!==1||missing[0].asset!==e.asset||missing[0].path!==e.original)blocked('Missing media does not match the single deliberately moved relink asset.');
  const dialogs=ui.widgets.filter(w=>w.title==='Missing Media'&&w.window===w.id);
  const buttons=ui.widgets.filter(w=>dialogs.length===1&&w.window===dialogs[0].id&&w.class==='QPushButton'&&w.text==='Continue Offline'&&w.enabled);
  if(buttons.length!==1)blocked('The known relink fixture has no unique Continue Offline action.');
  return {target:buttons[0].id,asset:e.asset,original:e.original,moved:e.moved,sha256:e.digest};
}
export async function openAttachedProject(file,bundle,{missingMediaFixture}={}){
  const session=await readJSON(file);assert(inside(session.root,bundle),'Startup must open the owned fixture project.');
  const visible=ui=>ui.widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(bundle)+' — Wizard'))&&ui.widgets.some(w=>w.name==='panelSubtabSelector');
  const observed=await nativeCall(file,'inspect');if(visible(observed)&&!observed.widgets.some(w=>w.title==='Missing Media'))return;
  if(!observed.widgets.some(w=>w.title==='Missing Media')){
  const startup=observed.widgets.filter(w=>w.name==='startupOpenButton'&&w.enabled);
  if(startup.length===1)await nativeCall(file,'click',{target:startup[0].id});
  else{const actions=observed.actions.filter(a=>a.text==='Open...'&&a.enabled);assert(actions.length===1,'No unique Open Project action.');await nativeCall(file,'action',{target:actions[0].id});}
  let field;
  for(let i=0;i<50;i++){const ui=await nativeCall(file,'inspect');field=ui.widgets.find(w=>w.name==='fileNameEdit'&&w.class==='QLineEdit'&&w.enabled);if(field)break;await pause(100);}
  assert(field,'Selected build did not expose the project file selector.');
  await nativeCall(file,'text',{target:field.id,text:bundle});await nativeCall(file,'key',{target:field.id,key:'Return'});
  }
  let last,continuedOffline=false;
  for(let i=0;i<100;i++){last=await nativeCall(file,'inspect');
    const missing=last.widgets.find(w=>w.title==='Missing Media');
    if(missing){
      if(continuedOffline){await pause(100);continue;}
      if(!missingMediaFixture)throw new OutcomeError('Project reopening is blocked by Missing Media. Preserve the fixture and inspect its source paths; do not continue offline.','Blocked');
      const proof=await missingMediaContinuation(session,last,missingMediaFixture);await writeJSON(path.join(session.root,'missing-media-continuation.json'),proof);
      await nativeCall(file,'click',{target:proof.target});missingMediaFixture=null;continuedOffline=true;
    }else if(visible(last))return;
    await pause(100);
  }
  const dialogs=last?.widgets.filter(w=>w.window===w.id).map(w=>({class:w.class,title:w.title}));
  throw new OutcomeError('The selected build did not open '+bundle+' within ten seconds. Last windows: '+JSON.stringify(dialogs),'Blocked');
}

export async function launchDesktop(session,{foreground=true,missingMediaFixture}={}){
  assert(!missingMediaFixture||foreground,'Intentional missing-media reopening requires the foreground relink course.');
  verifyDesktopPaths(session);
  if(session.pid){let alive=true;try{process.kill(session.pid,0);}catch(e){if(e.code!=='ESRCH')throw e;alive=false;}assert(!alive,'Recorded desktop PID is still alive; stop or inspect it before relaunch.');}
  assert((await fingerprint(session.app,{packageTree:true})).sha256===session.guiHash,'Desktop build changed since preparation.');
  if(session.plan.runtime?.kind==='selected-build-attachment'){
    const live=await attachSelectedBuild({app:session.plan.app,dataDir:session.dataDir,preparedSession:session});
    Object.assign(session,live.session);const file=path.join(session.root,'session.json');await writeJSON(file,session);
    try{
      const deadline=Date.now()+30000;let endpoint;
      while(Date.now()<deadline){try{endpoint=await readJSON(path.join(session.env.WIZSERVER_RUNTIME_DIR,'gui.json'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await pause(100);}
      assert(endpoint?.pid===session.pid&&endpoint.kind==='gui','Selected GUI endpoint did not match the owned process.');session.endpoint=endpoint;session.url='http://127.0.0.1:'+endpoint.port;await writeJSON(file,session);
      await openAttachedProject(file,session.bundle,{missingMediaFixture});
      const opened=await desktopCall(file,'project.get_name');assert(typeof opened.name==='string'&&opened.name.length>0,'Opened project has no observed name');
      const timeline=await desktopCall(file,'timeline.inspect',{timeline_id:session.main.id});assert(timeline.timeline?.timeline_id===session.main.id,'Opened project did not restore the prepared timeline identity');
      if(foreground){const ui=await nativeCall(file,'inspect'),main=ui.widgets.filter(w=>w.class==='MainWindow');assert(main.length===1,'Selected build has no unique main window.');await nativeCall(file,'activate',{target:main[0].id});}
      session.inputMode=foreground?'desktop':'service';session.state='Running';await writeJSON(file,session);return live;
    }catch(e){e.evidence=await captureDesktopFailure(file,e,'startup');live.child.kill('SIGTERM');const force=setTimeout(()=>live.child.kill('SIGKILL'),3000);await live.closed;clearTimeout(force);throw e;}
  }
  const generation=++session.generation,runtime=path.join(session.root,`gui-runtime-${generation}`),settings=path.join(session.root,'desktop-settings'),temp=path.join(session.root,'tmp');
  const native=path.join(session.root,`native-${generation}`),plugins=path.join(session.root,`plugins-${generation}`);
  for(const dir of [runtime,settings,temp,native])await mkdir(dir,{recursive:true,mode:0o700});
  const bridge=session.plan.runtime?.bridge||path.join(dataDirectory(),'native/styles/libwizard_smoke.dylib');
  await mkdir(path.join(plugins,'styles'),{recursive:true});await cp(bridge,path.join(plugins,'styles/libwizard_smoke.dylib'));
  session.bridgeHash=await sha(path.join(plugins,'styles/libwizard_smoke.dylib'));session.native=native;
  if(session.qtCocoa){assert(await sha(session.qtCocoa.source)===session.qtCocoa.sha256,'Selected smoke Qt plugin changed.');await mkdir(path.join(plugins,'platforms'),{recursive:true});session.qtCocoa.loadedPath=path.join(plugins,'platforms/libqcocoa.dylib');await cp(session.qtCocoa.source,session.qtCocoa.loadedPath);assert(await sha(session.qtCocoa.loadedPath)===session.qtCocoa.sha256,'Copied smoke Qt plugin differs.');}
  const env={PATH:`${path.join(session.cliApp,'Contents/MacOS')}:/usr/bin:/bin`,HOME:process.env.HOME,LANG:'en_US.UTF-8',TMPDIR:temp,QT_PLUGIN_PATH:plugins,QT_QUICK_CONTROLS_STYLE:"Basic",WIZ_SMOKE_CONTROL_DIR:native,WIZSERVER_RUNTIME_DIR:runtime,WIZSERVER_SANDBOX_ROOT:session.root,WIZARD_SETTINGS:settings,XDG_CONFIG_HOME:settings,WIZ_HARNESS_RUN_ID:session.harnessId,WIZ_AUTOMATION_PROJECT:session.bundle,WIZ_AUTOMATION_TIMELINE:session.main.id,WIZ_MGFX_SEMANTIC_TRACE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
  // The instrumented app has no bundled Python. Use the worker in the fingerprinted preparation package.
  env.WIZ_SEARCH_WORKER=path.join(session.cliApp,'Contents/Resources/python',process.arch==='arm64'?'arm64':'x86_64','bin/wiz-search-worker');
  Object.assign(env,runtimeEnvironment(session.plan.runtime));
  const stdout=await open(path.join(session.root,`gui-${generation}.stdout.log`),'a'),stderr=await open(path.join(session.root,`gui-${generation}.stderr.log`),'a');
  if(session.selectedChecks?.includes('D-AGENT-PIPELINE-CONFIG'))env.WIZARD_AUTOMATION_AGENT_FIXTURE='1';
  const child=spawn(session.executable,['-style','Basic'],{env,cwd:session.root,stdio:['ignore',stdout.fd,stderr.fd]});await stdout.close();await stderr.close();
  let spawnError;child.on('error',e=>{spawnError=e;});const closed=new Promise(resolve=>child.once('close',resolve));
  try{
    const deadline=Date.now()+30000;let endpoint;
    while(Date.now()<deadline){
      if(spawnError)throw spawnError;assert(child.exitCode===null&&!child.signalCode,'Desktop exited before publishing its endpoint.');
      try{endpoint=await readJSON(path.join(runtime,'gui.json'));}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
      if(endpoint)break;await pause(100);
    }
    assert(endpoint?.pid===child.pid&&endpoint.kind==='gui'&&endpoint.protocol===1&&Number.isInteger(endpoint.port)&&endpoint.port>0&&endpoint.port<65536,'Desktop endpoint did not match the owned process.');
    Object.assign(session,{inputMode:foreground?'desktop':'service',processStart:execFileSync('/bin/ps',['-p',String(child.pid),'-o','lstart='],{encoding:'utf8'}).trim(),pid:child.pid,url:`http://127.0.0.1:${endpoint.port}`,endpoint,env,state:'Running',startedAt:new Date().toISOString()});
    const sessionFile=path.join(session.root,'session.json');await writeJSON(sessionFile,session);
    let ready=false;
    while(Date.now()<deadline){
      assert(child.exitCode===null&&!child.signalCode,'Desktop exited before its editor was ready.');
      let bridge;try{bridge=await readJSON(path.join(native,'ready.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(bridge){if(session.qtCocoa)assert(bridge.cocoaImage===session.qtCocoa.loadedPath,'Unexpected Cocoa plugin loaded.');assert(bridge.pid===child.pid&&bridge.harness===session.harnessId,'Startup bridge identity mismatch.');const ui=await nativeCall(sessionFile,'inspect');if(ui.widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(session.bundle)+' — Wizard'))&&ui.widgets.some(w=>w.name==='panelSubtabSelector')){ready=true;break;}}
      await pause(100);
    }
    assert(ready,'Desktop editor did not become ready within thirty seconds.');
    if(session.plan.runtime?.libraries){
      const libraries=await readJSON(path.join(session.plan.runtime.libraries,'manifest.json'));
      const files=execFileSync('/usr/sbin/lsof',['-p',String(session.pid),'-Fn'],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024}).split('\n').filter(l=>l.startsWith('n/')).map(l=>l.slice(1));
      await writeJSON(path.join(session.root,`loaded-files-${generation}.json`),{pid:session.pid,libraryRoot:session.plan.runtime.libraries,files});
      const unexpected=files.filter(p=>(p.endsWith('.dylib')||p.includes('.framework/'))&&!['/System/','/usr/lib/','/opt/homebrew/',session.root+path.sep,session.plan.runtime.libraries+path.sep].some(root=>p.startsWith(root)));
      assert(!unexpected.length,'Desktop loaded libraries outside its retained kit and declared system dependencies: '+unexpected.join(', '));
      assert(!libraries.vendored.some(v=>files.includes(v.source)&&!v.source.startsWith(session.plan.runtime.libraries+path.sep)),'Desktop loaded a library from its original build directory instead of the retained kit.');
    }
    // Activate this already-running, uniquely located smoke copy through Launch Services.
    if(foreground){
      verifyDesktopOwner(session);execFileSync('/usr/bin/open',['-a',session.app],{timeout:5000});
      let active=false;for(let i=0;i<50;i++){const ui=await nativeCall(sessionFile,'inspect');if(ui.widgets.some(w=>w.class==='MainWindow'&&w.active)){active=true;break;}await pause(100);}
      if(!active)throw new OutcomeError('Smoke window could not become active; keyboard checks cannot run.','Blocked');
    }
    console.log(JSON.stringify({session:path.join(session.root,'session.json'),pid:session.pid,url:session.url,bundle:session.bundle,scope:session.scope,inputMode:session.inputMode}));
    return {child,closed};
  }catch(e){child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(force);session.state='Stopped';session.startupError=e.message;await writeJSON(path.join(session.root,'session.json'),session);throw e;}
}

export async function desktopCall(file,operation,params={},expectedError){
 return withAdapterAction(file,!agentReadOperations.includes(operation),operation,params,()=>desktopCallOwned(file,operation,params,expectedError));
}
async function desktopCallOwned(file,operation,params={},expectedError){
  let session=await readJSON(file);verifyDesktopPaths(session);
  validateApplicationParams(session.schema,operation,params);
  const lock=path.join(session.root,'call.lock');const held=await open(lock,'wx');
  try{
    session=await readJSON(file);verifyDesktopOwner(session);
    if(session.plan.runtime?.kind==='selected-build-attachment'&&!session.schema.operations[operation])throw new OutcomeError('The selected build does not expose '+operation+'. This check needs a supported UI path.','Blocked');
    if(!agentReadOperations.includes(operation))await markAgentMutation(file,session);
    const engine=new PackagedEngine(session.plan,session.root,session.harnessId,session.schema);
    if(session.desktopCli){assert(await sha(session.desktopCli)===session.desktopCliHash,'Paired CLI changed.');engine.macos=path.dirname(session.desktopCli);}
    engine.child={pid:session.pid,exitCode:null,signalCode:null};engine.url=session.url;engine.env=session.env;engine.counter=session.counter;engine.caseId=session.currentCheck||'desktop-agent';engine.stepId=session.currentStep||null;
    await engine.call(session.bundle,'project.get_name');
    let result;try{result=await engine.call(session.bundle,operation,params,expectedError);}catch(e){if(session.agentTracking&&e.status==='Unknown'&&!agentReadOperations.includes(operation))await markUnknown(file,e);throw e;}finally{const latest=await readJSON(file);latest.counter=engine.counter;latest.observedRevision=engine.revisions.get(session.bundle)||null;await writeJSON(file,latest);}
    return result;
  }finally{await held.close();await unlink(lock);}
}

export function assertLocalPreviewGraph(graph,root){
  assert(graph.coverage?.next_offset===null&&graph.coverage.graph_nodes===2&&graph.coverage.other_scene_objects_unprojected===0&&graph.nodes?.length===2,'Local preview requires a complete two-node graph');
  const source=graph.nodes.find(n=>n.type==='image_source'),blur=graph.nodes.find(n=>n.type==='gaussian_blur');
  assert(source?.media?.bound&&typeof source.media.path==='string'&&inside(root,realpathSync(source.media.path))&&blur&&!blur.bypassed,'Local preview requires an owned image and a blur; provider nodes are forbidden');
  assert(graph.edges?.length===1&&graph.edges[0].from.node_ref===source.node_ref&&graph.edges[0].to.node_ref===blur.node_ref,'Local preview requires the image-to-blur connection');
}
export function verifyNativeCapabilities(ready,required=['inspect']){
  const c=ready?.capabilities;
  if(c?.protocol!==1||!Number.isInteger(c.version)||!Array.isArray(c.operations)||required.some(op=>!c.operations.includes(op)))
    throw new OutcomeError('Unsupported native adapter capabilities; required: '+required.join(', ')+'. Rebuild and prepare the matching adapter.','Blocked');
  return c;
}
export async function captureDesktopFailure(file,error,label='check'){
  let session;try{session=await readJSON(file);}catch(e){return {captureError:e.message};}
  const prefix=String(label).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)+'-g'+(session.generation||0)+'-'+randomUUID().slice(0,8);
  const evidence={failureState:path.join(session.root,prefix+'-failure-state.json')},diagnostic={error:error.message,status:error.status||'Fail',code:error.code||null,nextActions:error.nextActions||[],wait:error.diagnostics?.expected?error.diagnostics:null,diagnostics:error.diagnostics||null,captureErrors:[]};
  try{
    diagnostic.ui=await nativeCall(file,'inspect');
    const windows=diagnostic.ui.widgets.filter(w=>w.window===w.id),window=windows.find(w=>w.active)||windows.find(w=>w.class==='MainWindow');
    if(window){const image=await nativeCall(file,'screenshot',{target:window.id});assert(inside(session.root,image.path),'Failure capture escaped its owned session');evidence.failureScreenshot=path.join(session.root,prefix+'-failure.png');await cp(image.path,evidence.failureScreenshot);diagnostic.image={source:'Qt widget raster',width:image.width,height:image.height};}
  }catch(e){diagnostic.captureErrors.push(e.message);}
  try{await writeJSON(evidence.failureState,diagnostic);}catch(e){return {captureError:e.message};}return evidence;
}
export async function terminateOwnedDesktop(file,live){
  if(live.child.exitCode!==null||live.child.signalCode)return;
  const session=await readJSON(file);assert(live.child.pid===session.pid,'Cleanup child differs from the recorded owner');verifyDesktopOwner(session);
  live.child.kill('SIGTERM');const force=setTimeout(()=>live.child.kill('SIGKILL'),3000);
  try{await Promise.race([live.closed,pause(6000).then(()=>{throw new OutcomeError('Owned process termination could not be confirmed.','Unknown');})]);}
  finally{clearTimeout(force);}
  session.state='Stopped';session.forcedCleanup=true;await writeJSON(file,session);
}
export async function nativeCall(file,op,params={}){
 validateNativeParams(op,params);
 return withAdapterAction(file,!agentReadNative.includes(op),op,params,()=>nativeCallOwned(file,op,params));
}
// Readback may overlap a physical gesture's preflight. Serialize requests to
// the bridge mailbox; never remove an existing lock or replay a dispatch.
export async function acquireNativeLock(lock,{timeoutMs=6000}={}){
 const deadline=performance.now()+timeoutMs;
 for(;;){try{return await open(lock,'wx');}catch(e){if(e.code!=='EEXIST')throw e;if(performance.now()>=deadline)throw new OutcomeError('Native bridge is busy; no request was dispatched','Blocked');await pause(15);}}
}
async function nativeCallOwned(file,op,params={}){
  const started=performance.now(),startedAt=new Date().toISOString();
  const session=await readJSON(file);verifyDesktopOwner(session);
  assert(session.inputMode!=='service'||['capabilities','inspect','screenshot','snapshot-widget'].includes(op),'Background service sessions cannot dispatch UI input. Run the foreground desktop course for UI evidence.');
  if(session.plan?.runtime?.kind==='selected-build-attachment'&&!agentReadNative.includes(op))verifyDesktopLease(session);
  if(!agentReadNative.includes(op))await markAgentMutation(file,session);
  if(op==='spellbook-run-local'){
    const graph=await desktopCall(file,'spellbook.inspect',{document_id:params.documentId,view:'overview',limit:100});assertLocalPreviewGraph(graph,session.root);
    const ui=await nativeCall(file,'inspect'),panel=ui.widgets.find(w=>w.id===params.target&&w.class==='DetachedGraphPanel');
    assert(panel&&ui.widgets.some(w=>w.window===panel.window&&((w.class==='QTabBar'&&w.tabs?.[w.index]===graph.name)||(w.name==='panelSubtabSelector'&&w.text===graph.name))),'Local preview must target the inspected active Spell');
  }
  const ready=await readJSON(path.join(session.native,'ready.json'));assert(ready.pid===session.pid&&ready.harness===session.harnessId,'Native bridge identity mismatch.');
  const capabilities=verifyNativeCapabilities(ready);
  if(!capabilities.operations.includes(op))throw new OutcomeError('Unsupported native operation: '+op,'Blocked');
    if(op==='timeline-clip-rect'&&!capabilities.timelineGeometry)throw new OutcomeError('This package does not export clip geometry; inspect the visible timeline before choosing another input route','Blocked');
    if(op==='timeline-point'&&!capabilities.timelinePoint)throw new OutcomeError('This package does not export track/time geometry; use a fresh visual target or qualify a supported build','Blocked');
  const lock=path.join(session.root,'native-call.lock'),held=await acquireNativeLock(lock),id=randomUUID();
  const request={...params,id,generation:ready.generation,op};
  try{
    verifyDesktopOwner(session);
    await writeJSON(path.join(session.native,'request.json'),request);
    for(let i=0;i<100;i++){
      let response;try{response=parseNativeResponse(await readFile(path.join(session.native,`response-${id}.json`),'utf8'),{id,pid:session.pid,generation:ready.generation});}catch(e){if(e.code!=='ENOENT')throw e.status==='Unknown'?e:new OutcomeError('Cannot read the dispatched native response; outcome unknown. Inspect before continuing.','Unknown');}
      if(response){await appendFile(path.join(session.root,'native-events.jsonl'),JSON.stringify({at:new Date().toISOString(),startedAt,durationMs:performance.now()-started,caseId:session.currentCheck||'desktop-agent',stepId:session.currentStep||null,request,response})+'\n');assert(response.ok,response.error||'Native operation failed');return response.result;}
      await pause(50);
    }
    await appendFile(path.join(session.root,'native-events.jsonl'),JSON.stringify({at:new Date().toISOString(),startedAt,durationMs:performance.now()-started,caseId:session.currentCheck||'desktop-agent',stepId:session.currentStep||null,request,status:'Unknown',error:'No native response within five seconds.'})+'\n');
    throw new OutcomeError('Native action outcome is unknown; inspect before continuing and do not replay.','Unknown');
  }catch(e){if(session.agentTracking&&e.status==='Unknown'&&!agentReadNative.includes(op))await markUnknown(file,e);throw e;}finally{await held.close();await unlink(lock);}
}

export function parseNativeResponse(text,identity){
 let response;try{response=JSON.parse(text);}catch{throw new OutcomeError('Native response is unreadable; outcome unknown. Inspect before continuing.','Unknown');}
 if(!response||response.id!==identity.id||response.pid!==identity.pid||response.generation!==identity.generation||typeof response.ok!=='boolean')throw new OutcomeError('Native response identity or protocol differs; outcome unknown. Inspect before continuing.','Unknown');
 return response;
}

export function assertQuitEvidence(receipt,observed,ready){
  assert(receipt?.dispatch==='native-menu'&&receipt.shortcut==='Command-Q','Native Quit menu dispatch was not acknowledged.');
  assert(observed?.event==='aboutToQuit'&&observed.pid===ready.pid&&observed.generation===ready.generation,'Quit evidence does not match the owned GUI generation.');
}
export async function stopDesktop(file,{quit=false}={}){
 return withAgentAction(file,()=>stopDesktopOwned(file,{quit}),{purpose:'shutdown',operation:'stop'});
}
async function stopDesktopOwned(file,{quit=false}={}){
  const session=await readJSON(file);verifyDesktopOwner(session);
  const closed=session.agentTracking&&terminalResult(await jsonLines(path.join(session.root,'agent-results.jsonl')),session.agentAttempt);
  // A closed attempt cannot be edited to tidy up. Preserve its autosaved fixture.
  if(session.agentUncertain||closed&&!quit){
    process.kill(session.pid,'SIGTERM');
    for(let i=0;i<100;i++){try{process.kill(session.pid,0);}catch(e){if(e.code==='ESRCH'){session.state='Stopped';await writeJSON(file,session);return;}throw e;}await pause(100);}
    throw new OutcomeError('Uncertain owned session did not stop; inspect it before starting another.','Unknown');
  }
  assert(!quit||session.inputMode==='desktop','Native Quit requires a foreground desktop session.');
  // Keep the owned test project's evidence and clear Wizard's unsaved-change dialog.
  if(!closed){
  if(session.inputMode==='service')await desktopCall(file,'project.checkpoint');
  else{const ui=await nativeCall(file,'inspect'),save=ui.actions.filter(a=>a.text==='Save'&&a.enabled);assert(save.length===1,'Cannot resolve the owned GUI Save action before shutdown.');await nativeCall(file,'action',{target:save[0].id});}
  let saved=false;
  for(let i=0;i<50;i++){const readRef=ref=>execFileSync('/usr/bin/git',['-C',session.bundle,'rev-parse',`refs/heads/${ref}`],{encoding:'utf8'}).trim();if(readRef('main')===readRef('autosave')){saved=true;break;}await pause(100);}
  assert(saved,'GUI save did not settle before shutdown.');
  }
  let receipt,ready;
  if(quit){
    const ui=await nativeCall(file,'inspect'),main=ui.widgets.filter(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(session.bundle)+' — Wizard'));
    assert(main.length===1,'Quit must target the prepared project.');ready=await readJSON(path.join(session.native,'ready.json'));
    receipt=await nativeCall(file,'quit',{target:main[0].id});
  }else process.kill(session.pid,'SIGTERM');
  for(let i=0;i<100;i++){try{process.kill(session.pid,0);}catch(e){if(e.code==='ESRCH'){
    if(quit){const observed=await readJSON(path.join(session.native,'quit-observed.json'));assertQuitEvidence(receipt,observed,ready);session.lastQuit={receipt,observed,at:new Date().toISOString()};}
    session.state='Stopped';await writeJSON(file,session);return;
  }throw e;}await pause(100);}
  throw new OutcomeError('Owned GUI did not stop within ten seconds; inspect it before proceeding.','Unknown');
}
