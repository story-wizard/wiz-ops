import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,unlink,rename,mkdtemp,rm,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {verifyDesktopOwner} from './adapter.mjs';
import {OutcomeError} from '../runner/engine.mjs';
import {uiRoot,retainedUI} from './computer-use.mjs';
import {dataDirectory,writeJSON,readJSON,sha,fingerprint,inside} from '../runner/files.mjs';

export function validateNativeRequest(request){
 const allowed=['command','pid','started','window','frame','depth','limit','path','identifier','role','title','action','value','x','y','toX','toY','key','button','toWindow','toFrame','mode','durationMs'];
 if(request&&Object.keys(request).some(k=>!allowed.includes(k)))throw Error('Unknown native input request field. Screenshot outputs are assigned inside the run.');
 if(request.mode!==undefined&&!['accessibility','window-server'].includes(request.mode))throw Error('Unsupported native inspection mode.');
 const commands=['inspect','screenshot','action','set-value','click','drag','key'];
 if(!request||!commands.includes(request.command))throw Error('Select a native inspection, screenshot, accessibility action, click, drag or key.');
 if(request.command!=='inspect'&&(!Number.isInteger(request.pid)||request.pid<=1||typeof request.started!=='string'||!request.started.trim()))throw Error('Supply the PID and start time returned by inspect.');
 if(['click','drag','key'].includes(request.command)&&(!Number.isInteger(request.window)||request.window<=0||!request.frame||!['x','y','width','height'].every(k=>Number.isFinite(request.frame[k]))||request.frame.width<=0||request.frame.height<=0))throw Error('Supply the window ID and frame returned by inspect.');
 if(['action','set-value'].includes(request.command)&&(!request.role||typeof request.title!=='string'))throw Error('Supply the observed accessibility role and title.');
 if((request.toWindow===undefined)!==(request.toFrame===undefined))throw Error('Drag destination window and frame must be supplied together.');
 if(request.toWindow!==undefined&&(!Number.isInteger(request.toWindow)||request.toWindow<=0||!request.toFrame||!['x','y','width','height'].every(k=>Number.isFinite(request.toFrame[k]))||request.toFrame.width<=0||request.toFrame.height<=0))throw Error('Supply the observed drag destination window and frame.');
 if(['click','drag'].includes(request.command))for(const [x,y] of request.command==='drag'?[['x','y'],['toX','toY']]:[['x','y']])if(!Number.isFinite(request[x])||!Number.isFinite(request[y])||request[x]<0||request[y]<0||request[x]>=(x==='toX'?request.toFrame?.width??request.frame.width:request.frame.width)||request[y]>=(x==='toX'?request.toFrame?.height??request.frame.height:request.frame.height))throw Error('Pointer coordinates must be inside the observed window in macOS points.');
 if(request.button!==undefined&&!['left','middle','right'].includes(request.button))throw Error('Unsupported pointer button.');
 if(request.durationMs!==undefined&&(request.command!=='drag'||!Number.isInteger(request.durationMs)||request.durationMs<300||request.durationMs>10000))throw Error('Drag duration must be 300–10000 milliseconds.');
 if(request.command==='key'&&(typeof request.key!=='string'||! /^(?:(?:cmd|super|shift|alt|option|ctrl)\+)*(?:escape|return|tab|space|delete|k|n|s|a|z|d|c|v)$/i.test(request.key)))throw Error('Unsupported key chord.');
}

export async function nativeUIInput(dataDir,runId,request){
 validateNativeRequest(request);
 if(process.platform!=='darwin')throw Error('Native Wizard input requires macOS.');
 const root=uiRoot(dataDir,runId),pass=await retainedUI(dataDir,runId);
 if(!pass)throw Error('Prepare the owned computer-use pass first.');
 if((await fingerprint(pass.app,{packageTree:true})).sha256!==pass.packageHash)throw Error('Computer-use package changed since preparation.');
 return nativeInput(dataDir,root,path.join(pass.app,'Contents/MacOS/wizard-bin'),pass.packageHash,request);
}

async function nativeInput(dataDir,root,executable,packageHash,request,context={}){
 await mkdir(path.join(root,'evidence'),{recursive:true});
 const held=await open(path.join(root,'native-input.lock'),'wx'),id=randomUUID(),requestFile=path.join(root,'evidence',`native-${id}-request.txt`),receiptFile=path.join(root,'evidence',`native-${id}-receipt.txt`);
 let receipt,driver;
 try{
  const source=new URL('./macos-input.swift',import.meta.url),sourceHash=await sha(source),cache=path.join(dataDirectory(dataDir),'native',`macos-input-${process.arch}-${sourceHash}`);
  await mkdir(cache,{recursive:true});driver=path.join(cache,'macos-input');const manifestFile=path.join(cache,'manifest.json');
  let manifest;try{manifest=await readJSON(manifestFile);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!manifest){
   const staging=await mkdtemp(path.join(cache,'compile-'));
   try{
    execFileSync('/usr/bin/swiftc',['-parse-as-library','-module-cache-path',path.join(dataDirectory(dataDir),'native','swift-module-cache'),'-o',path.join(staging,'macos-input'),fileURLToPath(source)],{timeout:60000,maxBuffer:1024*1024});
    const driverHash=await sha(path.join(staging,'macos-input'));await rename(path.join(staging,'macos-input'),driver);
    manifest={sourceHash,driverHash};await writeJSON(manifestFile,manifest);
   }finally{await rm(staging,{recursive:true,force:true});}
  }
  if(manifest.sourceHash!==sourceHash||await sha(driver)!==manifest.driverHash)throw Error('Native input driver changed since compilation.');
  const input={...request};if(request.command==='screenshot')input.output=path.join(root,'evidence',`native-${id}.png`);
  await writeJSON(requestFile,input);
  const args=['--executable',executable,'--request',requestFile];
  try{const {stdout}=await promisify(execFile)(driver,args,{encoding:'utf8',timeout:15000+(request.durationMs||0),maxBuffer:8*1024*1024});receipt=JSON.parse(stdout);}
  catch(e){try{receipt=JSON.parse(String(e.stdout));}catch{receipt={status:'Unknown',error:'Native driver response lost; inspect before continuing. No input was replayed.'};}}
  await writeJSON(receiptFile,{...receipt,sourceHash,driverHash:manifest.driverHash,packageHash});
  await appendFile(path.join(root,'native-input.jsonl'),JSON.stringify({at:new Date().toISOString(),...context,command:request.command,input:request,request:path.relative(root,requestFile),receipt:path.relative(root,receiptFile),status:receipt.status})+'\n');
  if(receipt.output&&!inside(path.join(root,'evidence'),receipt.output))throw Error('Native screenshot output escaped the run.');
  return {...receipt,artifacts:[path.relative(root,requestFile),path.relative(root,receiptFile),...(receipt.output?[path.relative(root,receipt.output)]:[])]};
 }finally{await held.close();await unlink(path.join(root,'native-input.lock'));}
}

export async function nativeDesktopInput(file,request){
 const session=await readJSON(file);verifyDesktopOwner(session);
 if(session.inputMode!=='desktop')throw new OutcomeError('Physical input requires a foreground desktop session','Blocked');
 validateNativeRequest(request);
 const receipt=await nativeInput(session.dataDir,session.root,session.executable,session.guiHash,request,{caseId:session.currentCheck||'desktop-agent',stepId:session.currentStep||null});
 if(receipt.status==='Unknown'||receipt.status==='Blocked')throw new OutcomeError(receipt.error,receipt.status);
 if(receipt.pid!==session.pid||receipt.started!==session.processStart)throw new OutcomeError('Native input receipt differs from the owned desktop process','Unknown');
 verifyDesktopOwner(session);return receipt;
}
