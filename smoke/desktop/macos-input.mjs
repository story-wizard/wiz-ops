import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,unlink,rename,mkdtemp,rm,appendFile,copyFile,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {verifyDesktopOwner,markAgentMutation,nativeCall} from './adapter.mjs';
import {OutcomeError} from '../runner/engine.mjs';
import {uiRoot,retainedUI} from './computer-use.mjs';
import {ROOT,dataDirectory,writeJSON,readJSON,sha,fingerprint,inside} from '../runner/files.mjs';
import {verifyDesktopLease} from './desktop-lease.mjs';
import {withAdapterAction,markUnknown} from './agent-proof.mjs';

export const physicalKeys=Object.freeze(['escape','return','tab','space','delete','k','n','s','a','z','d','c','v','b','g','j','l','i','o','left','right','up','down','home','end','pageup','pagedown','forwarddelete','comma','period',...Array.from({length:10},(_,i)=>String(i)),...Array.from({length:12},(_,i)=>'f'+(i+1))]);
export const physicalKeyAliases=Object.freeze({backspace:'delete',enter:'return',esc:'escape',super:'cmd',option:'alt'});
export function normalizePhysicalKey(key){
 const parts=typeof key==='string'?key.toLowerCase().split('+').map(p=>physicalKeyAliases[p]||p):[];
 if(!physicalKeys.includes(parts.at(-1))||!parts.slice(0,-1).every(m=>['cmd','shift','alt','ctrl'].includes(m))||new Set(parts).size!==parts.length)throw Error('Unsupported key chord.');
 return parts.join('+');
}

export function validateNativeRequest(request){
 const allowed=['command','pid','started','window','frame','depth','limit','path','identifier','role','title','action','value','x','y','toX','toY','key','text','deltaX','deltaY','button','toWindow','toFrame','mode','durationMs','captureRect','focusTarget','modifiers','clickCount'];
 if(request&&Object.keys(request).some(k=>!allowed.includes(k)))throw Error('Unknown native input request field. Screenshot outputs are assigned inside the run.');
 if(request.mode!==undefined&&!['accessibility','window-server'].includes(request.mode))throw Error('Unsupported native inspection mode.');
 const commands=['inspect','screenshot','action','set-value','click','drag','key','type','scroll'];
 if(!request||!commands.includes(request.command))throw Error('Select a native inspection, screenshot, accessibility action, click, drag or key.');
 if(request.command!=='inspect'&&(!Number.isInteger(request.pid)||request.pid<=1||typeof request.started!=='string'||!request.started.trim()))throw Error('Supply the PID and start time returned by inspect.');
 if(['click','drag','key','type','scroll','screenshot'].includes(request.command)&&(!Number.isInteger(request.window)||request.window<=0||!request.frame||!['x','y','width','height'].every(k=>Number.isFinite(request.frame[k]))||request.frame.width<=0||request.frame.height<=0))throw Error('Supply the window ID and frame returned by inspect.');
 if(request.captureRect!==undefined){const r=request.captureRect; if(request.command!=='screenshot'||!r||Object.keys(r).some(k=>!['x','y','width','height'].includes(k))||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>request.frame.width||r.y+r.height>request.frame.height)throw Error('Capture region must stay inside the observed native window.');}
 if(['action','set-value'].includes(request.command)&&(!request.role||typeof request.title!=='string'))throw Error('Supply the observed accessibility role and title.');
 if((request.toWindow===undefined)!==(request.toFrame===undefined))throw Error('Drag destination window and frame must be supplied together.');
 if(request.toWindow!==undefined&&(!Number.isInteger(request.toWindow)||request.toWindow<=0||!request.toFrame||!['x','y','width','height'].every(k=>Number.isFinite(request.toFrame[k]))||request.toFrame.width<=0||request.toFrame.height<=0))throw Error('Supply the observed drag destination window and frame.');
 if(['click','drag','scroll'].includes(request.command))for(const [x,y] of request.command==='drag'?[['x','y'],['toX','toY']]:[['x','y']])if(!Number.isFinite(request[x])||!Number.isFinite(request[y])||request[x]<0||request[y]<0||request[x]>=(x==='toX'?request.toFrame?.width??request.frame.width:request.frame.width)||request[y]>=(x==='toX'?request.toFrame?.height??request.frame.height:request.frame.height))throw Error('Pointer coordinates must be inside the observed window in macOS points.');
 if(request.command==='type'&&(typeof request.text!=='string'||request.text.length<1||request.text.length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request.text)))throw Error('Supply 1–4096 text characters without control codes');
 if(request.focusTarget!==undefined&&(!['type','key'].includes(request.command)||typeof request.focusTarget!=='string'||!request.focusTarget))throw Error('An expected focus target is valid only for keyboard input.');
 if(request.command==='scroll'&&(!['deltaX','deltaY'].every(k=>Number.isInteger(request[k]??0)&&Math.abs(request[k]??0)<=2000)||!(request.deltaX||request.deltaY)))throw Error('Supply a nonzero scroll of at most 2000 pixels per axis');
 if(request.button!==undefined&&!['left','middle','right'].includes(request.button))throw Error('Unsupported pointer button.');
 if(request.durationMs!==undefined&&(request.command!=='drag'||!Number.isInteger(request.durationMs)||request.durationMs<300||request.durationMs>10000))throw Error('Drag duration must be 300–10000 milliseconds.');
 if(request.modifiers!==undefined&&(!['click','drag'].includes(request.command)||!Array.isArray(request.modifiers)||request.modifiers.length>4||new Set(request.modifiers).size!==request.modifiers.length||!request.modifiers.every(m=>['cmd','shift','alt','ctrl'].includes(m))))throw Error('Pointer modifiers must be unique cmd/shift/alt/ctrl names.');
 if(request.clickCount!==undefined&&(request.command!=='click'||![1,2].includes(request.clickCount)))throw Error('Click count must be one or two.');
 if(request.command==='drag'&&request.path!==undefined){
  const points=request.path;
  if(request.toWindow!==undefined&&request.toWindow!==request.window||!Array.isArray(points)||points.length<2||points.length>128||!points.every(p=>p&&Object.keys(p).length===2&&['x','y'].every(k=>Number.isFinite(p[k]))&&p.x>=0&&p.y>=0&&p.x<request.frame.width&&p.y<request.frame.height)||points[0].x!==request.x||points[0].y!==request.y||points.at(-1).x!==request.toX||points.at(-1).y!==request.toY)throw Error('Drag path must have 2–128 bounded points in one window and match its endpoints.');
 }
 if(request.command==='key'){
  normalizePhysicalKey(request.key);
 }
}

export async function nativeUIInput(dataDir,runId,request){
 validateNativeRequest(request);
 if(request.command==='type')throw new OutcomeError('Physical text entry requires an instrumented agent session to verify the editable field','Blocked');
 if(process.platform!=='darwin')throw Error('Native Wizard input requires macOS.');
 const root=uiRoot(dataDir,runId),pass=await retainedUI(dataDir,runId);
 if(!pass)throw Error('Prepare the owned computer-use pass first.');
 if((await fingerprint(pass.app,{packageTree:true})).sha256!==pass.packageHash)throw Error('Computer-use package changed since preparation.');
 return nativeInput(dataDir,root,path.join(pass.app,'Contents/MacOS/wizard-bin'),pass.packageHash,request);
}

async function nativeInput(dataDir,root,executable,packageHash,request,context={}){
 const started=performance.now(),startedAt=new Date().toISOString();
 await mkdir(path.join(root,'evidence'),{recursive:true});
 const held=await open(path.join(root,request.command==='screenshot'?'native-capture.lock':'native-input.lock'),'wx'),id=randomUUID(),requestFile=path.join(root,'evidence',`native-${id}-request.txt`),receiptFile=path.join(root,'evidence',`native-${id}-receipt.txt`);
 let receipt;
 try{
  const {driver,manifest,sourceHash}=await nativeInputDriver(dataDir);
  const input={...request};if(request.command==='key')input.key=normalizePhysicalKey(request.key);if(request.command==='screenshot')input.output=path.join(root,'evidence',`native-${id}.png`);
  await writeJSON(requestFile,input);
  const args=['--executable',executable,'--request',requestFile];
  try{const {stdout}=await promisify(execFile)(driver,args,{encoding:'utf8',timeout:15000+(request.durationMs||0),maxBuffer:8*1024*1024});receipt=JSON.parse(stdout);}
  catch(e){try{receipt=JSON.parse(String(e.stdout));}catch{receipt={status:'Unknown',error:'Native driver response lost; inspect before continuing. No input was replayed.'};}}
  await writeJSON(receiptFile,{...receipt,sourceHash,driverHash:manifest.driverHash,packageHash});
  await appendFile(path.join(root,'native-input.jsonl'),JSON.stringify({at:new Date().toISOString(),startedAt,durationMs:performance.now()-started,...context,command:request.command,input:request,request:path.relative(root,requestFile),receipt:path.relative(root,receiptFile),status:receipt.status})+'\n');
  if(receipt.output&&!inside(path.join(root,'evidence'),receipt.output))throw Error('Native screenshot output escaped the run.');
  return {...receipt,artifacts:[path.relative(root,requestFile),path.relative(root,receiptFile),...(receipt.output?[path.relative(root,receipt.output)]:[])]};
 }finally{await held.close();await unlink(path.join(root,request.command==='screenshot'?'native-capture.lock':'native-input.lock'));}
}

export async function nativeDesktopInput(file,request){
 return withAdapterAction(file,!['inspect','screenshot'].includes(request.command),request.command,request,()=>nativeDesktopInputOwned(file,request));
}
async function nativeDesktopInputOwned(file,request){
 const session=await readJSON(file);verifyDesktopOwner(session);
 if(session.inputMode!=='desktop')throw new OutcomeError('Physical input requires a foreground desktop session','Blocked');
 verifyDesktopLease(session);
 validateNativeRequest(request);
 if(['key','type'].includes(request.command)){
  await nativeInputDriver(session.dataDir);
  const ui=await nativeCall(file,'inspect');
  request={...request,...keyboardWindowProof(ui,request),focusObservedAt:Date.now()};
 }
 if(!['inspect','screenshot'].includes(request.command))await markAgentMutation(file,session);
 const receipt=await nativeInput(session.dataDir,session.root,session.executable,session.guiHash,request,{caseId:session.currentCheck||'desktop-agent',stepId:session.currentStep||null});
 if(receipt.status==='Unknown'||receipt.status==='Blocked'){const e=new OutcomeError(receipt.error,receipt.status);e.code=receipt.code||'native_input_failed';e.diagnostics={...receipt.diagnostics,receipt};e.nextActions=receipt.status==='Unknown'?['observe','verify_resolution','resolve']:['inspect_occluder','clear_target','begin_new_attempt'];if(e.status==='Unknown'&&!['inspect','screenshot'].includes(request.command))await markUnknown(file,e);throw e;}
 if(receipt.pid!==session.pid||receipt.started!==session.processStart){const e=new OutcomeError('Native input receipt differs from the owned desktop process','Unknown');if(!['inspect','screenshot'].includes(request.command))await markUnknown(file,e);throw e;}
 verifyDesktopOwner(session);return receipt;
}

export function keyboardWindowProof(ui,request){
 const key=ui.widgets.find(w=>w.keyWindow===true);
 if(key?.nativeWindow!==request.window)throw new OutcomeError('Keyboard input requires the actual key window; physically click the intended control first','Blocked');
 if(request.command==='type'||request.focusTarget!==undefined){
  const field=ui.widgets.find(w=>w.id===ui.focus);
  if(ui.focus!==request.focusTarget){const error=new OutcomeError('The requested control lost keyboard focus; observe and focus it again','Blocked');Object.assign(error,{code:'input_focus_changed',origin:'harness',nextActions:['observe','focus_target'],diagnostics:{dispatch:'not_started',expectedTarget:request.focusTarget,observedFocus:ui.focus??null,keyWindow:key.nativeWindow}});throw error;}
  if(!field||request.command==='type'&&!field.editableText||field.window!==key.id)throw new OutcomeError('Keyboard input requires its focused control in the verified key window','Blocked');
 }
 return {verifiedKeyWindow:key.nativeWindow};
}

export async function nativeInputDriver(dataDir){
  const sourceBytes=await readFile(new URL('./macos-input.swift',import.meta.url)),sourceHash=createHash('sha256').update(sourceBytes).digest('hex'),cache=path.join(dataDirectory(dataDir),'native',`macos-input-${process.arch}-${sourceHash}`);
  await mkdir(cache,{recursive:true});const driver=path.join(cache,'macos-input');const manifestFile=path.join(cache,'manifest.json');
  let manifest;try{manifest=await readJSON(manifestFile);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!manifest){
   const bundled=path.join(ROOT,'native-input',path.basename(cache));let candidate;
   try{candidate=await readJSON(path.join(bundled,'manifest.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(candidate){
    if(candidate.sourceHash!==sourceHash||await sha(path.join(bundled,'macos-input'))!==candidate.driverHash)throw Error('Bundled native input driver differs from its source or manifest');
    await copyFile(path.join(bundled,'macos-input'),driver);manifest=candidate;await writeJSON(manifestFile,manifest);
   }
  }
  if(!manifest){
   const staging=await mkdtemp(path.join(cache,'compile-'));
   try{
    const frozenSource=path.join(staging,'macos-input.swift');await writeFile(frozenSource,sourceBytes);
    execFileSync('/usr/bin/swiftc',['-parse-as-library','-module-cache-path',path.join(dataDirectory(dataDir),'native','swift-module-cache'),'-o',path.join(staging,'macos-input'),frozenSource],{timeout:60000,maxBuffer:1024*1024});
    const driverHash=await sha(path.join(staging,'macos-input'));await rename(path.join(staging,'macos-input'),driver);
    manifest={sourceHash,driverHash};await writeJSON(manifestFile,manifest);
   }finally{await rm(staging,{recursive:true,force:true});}
  }
  if(manifest.sourceHash!==sourceHash||await sha(driver)!==manifest.driverHash)throw Error('Native input driver changed since compilation.');
  return {driver,manifest,sourceHash};
}
