import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,open,cp,mkdtemp,unlink,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {realpathSync,appendFileSync} from 'node:fs';
import {PackagedEngine,assert,pause,OutcomeError} from '../runner/engine.mjs';
import {ProjectSession} from '../runner/interactions.mjs';
import {checkPrepared} from '../runner/prepare.mjs';
import {ROOT,dataDirectory,externalPath,readJSON,writeJSON,fingerprint,inside,sha} from '../runner/files.mjs';

export function verifyDesktopPaths(session,configuredDataDir){
  const base=realpathSync(dataDirectory(configuredDataDir));
  assert(session.dataDir===base&&inside(base,session.root),'Desktop session must be in the configured external workspace');
  assert(inside(base,session.root)&&realpathSync(session.root)===session.root&&inside(session.root,realpathSync(session.bundle)),'Desktop session is outside the owned workspace.');
  assert(session.executable===path.join(session.root,'Wizard Smoke.app/Contents/MacOS/wizard'),'Unexpected desktop executable.');
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
  const cli=path.join(directory,'wiz-cli');await cp(source,cli);
  session.desktopCli=cli;session.desktopCliHash=await sha(cli);
  session.schema=JSON.parse(execFileSync(cli,['project','create','--schema','--no-spawn'],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024,env:session.plan.runtime?.libraries?{...process.env,DYLD_LIBRARY_PATH:session.plan.runtime.libraries}:process.env}));
  session.scope='Instrumented local GUI build and paired CLI; selected package supplies fixture preparation, media tools and the search worker; separate from release smoke';
  await writeJSON(path.join(session.root,'session.json'),session);
}

export async function prepareDesktop(sourceApp,qtCocoaPlugin,pairedCli,prepared){
  const {plan,fixtures,schema}=await checkPrepared(prepared?.dataDir,prepared?.plan);
  const binary=await readFile(path.join(sourceApp,'Contents/MacOS/wizard'));
  for(const marker of ['WIZ_HARNESS_RUN_ID','WIZ_AUTOMATION_PROJECT'])assert(binary.includes(Buffer.from(marker)),`The desktop build lacks ${marker}; refusing to use personal settings.`);
  const dataDir=dataDirectory(prepared?.dataDir);assert(dataDir===dataDirectory(),'Configure SMOKE_DATA_DIR to match desktop preparation.');
  const directory=externalPath(prepared?.directory||path.join(dataDir,'desktop-runs'));assert(inside(dataDir,directory),'Desktop destination must be inside the configured workspace.');await mkdir(directory,{recursive:true});const root=await mkdtemp(path.join(directory,'desktop-'));
  const app=path.join(root,'Wizard Smoke.app');await cp(sourceApp,app,{recursive:true});
  const identity=await fingerprint(app,{packageTree:true});await cp(plan.fixtureRoot,path.join(root,'media'),{recursive:true});
  const engine=new PackagedEngine(plan,root,path.basename(root),schema),c=new ProjectSession(engine,path.basename(root),fixtures);
  try{await engine.start();await c.setup();await c.call('project.checkpoint');}finally{await engine.stop();}
  const session={format:'wizard-smoke-desktop/v1',scope:'Instrumented local GUI build with installed packaged CLI; separate from release smoke',dataDir,root,app,sourceApp,executable:path.join(app,'Contents/MacOS/wizard'),guiHash:identity.sha256,cliApp:plan.app,cliPackageHash:plan.packageHash,fixtureHash:plan.fixtureHash,bundle:c.bundle,main:c.main,alternate:c.alternate,clip:c.a,assets:c.assets,harnessId:path.basename(root),generation:0,counter:engine.counter,schema,plan};
  if(qtCocoaPlugin){const source=realpathSync(qtCocoaPlugin);assert(path.basename(source)==='libqcocoa.dylib','Choose the local Cocoa plugin explicitly.');session.qtCocoa={source,sha256:await sha(source)};}
  await pairDesktopCli(session,pairedCli);return session;
}

export async function launchDesktop(session,{foreground=true}={}){
  verifyDesktopPaths(session);
  if(session.pid){let alive=true;try{process.kill(session.pid,0);}catch(e){if(e.code!=='ESRCH')throw e;alive=false;}assert(!alive,'Recorded desktop PID is still alive; stop or inspect it before relaunch.');}
  assert((await fingerprint(session.app,{packageTree:true})).sha256===session.guiHash,'Desktop build changed since preparation.');
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
  if(session.plan.runtime?.libraries)env.DYLD_LIBRARY_PATH=session.plan.runtime.libraries;
  const stdout=await open(path.join(session.root,`gui-${generation}.stdout.log`),'a'),stderr=await open(path.join(session.root,`gui-${generation}.stderr.log`),'a');
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
  let session=await readJSON(file);verifyDesktopPaths(session);
  const lock=path.join(session.root,'call.lock');const held=await open(lock,'wx');
  try{
    session=await readJSON(file);verifyDesktopOwner(session);
    const engine=new PackagedEngine(session.plan,session.root,session.harnessId,session.schema);
    if(session.desktopCli){assert(await sha(session.desktopCli)===session.desktopCliHash,'Paired CLI changed.');engine.macos=path.dirname(session.desktopCli);}
    engine.child={pid:session.pid,exitCode:null,signalCode:null};engine.url=session.url;engine.env=session.env;engine.counter=session.counter;engine.caseId=session.currentCheck||'desktop-agent';
    await engine.call(session.bundle,'project.get_name');
    let result;try{result=await engine.call(session.bundle,operation,params,expectedError);}finally{session.counter=engine.counter;await writeJSON(file,session);}
    return result;
  }finally{await held.close();await unlink(lock);}
}

export function assertLocalPreviewGraph(graph,root){
  assert(graph.coverage?.next_offset===null&&graph.coverage.graph_nodes===2&&graph.coverage.other_scene_objects_unprojected===0&&graph.nodes?.length===2,'Local preview requires a complete two-node graph');
  const source=graph.nodes.find(n=>n.type==='image_source'),blur=graph.nodes.find(n=>n.type==='gaussian_blur');
  assert(source?.media?.bound&&typeof source.media.path==='string'&&inside(root,realpathSync(source.media.path))&&blur&&!blur.bypassed,'Local preview requires an owned image and a blur; provider nodes are forbidden');
  assert(graph.edges?.length===1&&graph.edges[0].from.node_ref===source.node_ref&&graph.edges[0].to.node_ref===blur.node_ref,'Local preview requires the image-to-blur connection');
}
export async function nativeCall(file,op,params={}){
  const session=await readJSON(file);verifyDesktopOwner(session);
  assert(session.inputMode!=='service'||['inspect','screenshot','snapshot-widget'].includes(op),'Background service sessions cannot dispatch UI input. Run the foreground desktop course for UI evidence.');
  if(op==='spellbook-run-local'){
    const graph=await desktopCall(file,'spellbook.inspect',{document_id:params.documentId,view:'overview',limit:100});assertLocalPreviewGraph(graph,session.root);
    const ui=await nativeCall(file,'inspect'),panel=ui.widgets.find(w=>w.id===params.target&&w.class==='DetachedGraphPanel');
    assert(panel&&ui.widgets.some(w=>w.window===panel.window&&((w.class==='QTabBar'&&w.tabs?.[w.index]===graph.name)||(w.name==='panelSubtabSelector'&&w.text===graph.name))),'Local preview must target the inspected active Spell');
  }
  const ready=await readJSON(path.join(session.native,'ready.json'));assert(ready.pid===session.pid&&ready.harness===session.harnessId,'Native bridge identity mismatch.');
  const lock=path.join(session.root,'native-call.lock'),held=await open(lock,'wx'),id=randomUUID();
  const request={...params,id,generation:ready.generation,op};
  try{
    await writeJSON(path.join(session.native,'request.json'),request);
    for(let i=0;i<100;i++){
      let response;try{response=await readJSON(path.join(session.native,`response-${id}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(response){assert(response.id===id&&response.pid===session.pid&&response.generation===ready.generation,'Native response identity mismatch.');await appendFile(path.join(session.root,'native-events.jsonl'),JSON.stringify({at:new Date().toISOString(),caseId:session.currentCheck||'desktop-agent',request,response})+'\n');assert(response.ok,response.error||'Native operation failed');return response.result;}
      await pause(50);
    }
    throw new OutcomeError('Native action outcome is unknown; inspect before continuing and do not replay.','Unknown');
  }finally{await held.close();await unlink(lock);}
}

export function assertQuitEvidence(receipt,observed,ready){
  assert(receipt?.dispatch==='native-menu'&&receipt.shortcut==='Command-Q','Native Quit menu dispatch was not acknowledged.');
  assert(observed?.event==='aboutToQuit'&&observed.pid===ready.pid&&observed.generation===ready.generation,'Quit evidence does not match the owned GUI generation.');
}
export async function stopDesktop(file,{quit=false}={}){
  const session=await readJSON(file);verifyDesktopOwner(session);
  assert(!quit||session.inputMode==='desktop','Native Quit requires a foreground desktop session.');
  // Keep the owned test project's evidence and clear Wizard's unsaved-change dialog.
  if(session.inputMode==='service')await desktopCall(file,'project.checkpoint');
  else{const ui=await nativeCall(file,'inspect'),save=ui.actions.filter(a=>a.text==='Save'&&a.enabled);assert(save.length===1,'Cannot resolve the owned GUI Save action before shutdown.');await nativeCall(file,'action',{target:save[0].id});}
  let saved=false;
  for(let i=0;i<50;i++){const readRef=ref=>execFileSync('/usr/bin/git',['-C',session.bundle,'rev-parse',`refs/heads/${ref}`],{encoding:'utf8'}).trim();if(readRef('main')===readRef('autosave')){saved=true;break;}await pause(100);}
  assert(saved,'GUI save did not settle before shutdown.');let receipt,ready;
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
