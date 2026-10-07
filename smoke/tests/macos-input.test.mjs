import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeRequest,physicalKeys,normalizePhysicalKey} from '../desktop/macos-input.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('native input blocks stale authority, escaped coordinates and unsupported requests before activation',()=>{
 const click={command:'click',pid:123,started:'observed start',window:10,frame:{x:100,y:100,width:500,height:400},x:20,y:30};
 assert.doesNotThrow(()=>validateNativeRequest(click));
 assert.doesNotThrow(()=>validateNativeRequest({command:'inspect'}));
 assert.doesNotThrow(()=>validateNativeRequest({...click,command:'drag',toX:300,toY:200}));
 for(const change of [{pid:undefined},{started:''},{window:0},{frame:null},{x:NaN},{x:500},{y:-1},{output:'/tmp/escape.png'},{command:'global-click'},{mode:'invalid'},{button:'bad'},{command:'drag',toX:501,toY:2},{command:'key',key:'cmd+q'}])assert.throws(()=>validateNativeRequest({...click,...change}));
 assert.doesNotThrow(()=>validateNativeRequest({...click,command:'drag',button:'middle',toX:50,toY:80}));
 assert.doesNotThrow(()=>validateNativeRequest({...click,command:'key',key:'cmd+shift+n'}));
 assert.doesNotThrow(()=>validateNativeRequest({...click,command:'drag',toX:50,toY:80,durationMs:10000}));
 for(const durationMs of [299,10001,NaN,3.5])assert.throws(()=>validateNativeRequest({...click,command:'drag',toX:50,toY:80,durationMs}));
 assert.throws(()=>validateNativeRequest({...click,durationMs:300}));
 assert.throws(()=>validateNativeRequest({command:'action',pid:123,started:'observed start',path:[0,2]}),/role and title/);
});

test('screenshot admission confines a crop to its observed owned window',()=>{
 const shot={command:'screenshot',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:100},captureRect:{x:10,y:10,width:190,height:90}};
 assert.doesNotThrow(()=>validateNativeRequest(shot));
 for(const change of [{window:0},{frame:null},{command:'inspect'},{captureRect:{x:-1,y:0,width:2,height:2}},{captureRect:{x:0,y:0,width:201,height:10}},{captureRect:{x:0,y:0,width:10,height:NaN}},{captureRect:{...shot.captureRect,extra:true}}])assert.throws(()=>validateNativeRequest({...shot,...change}));
});

test('editing chords share the advertised keys and reject malformed or unsupported input',()=>{
 const request={command:'key',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:100}};
 for(const key of physicalKeys)assert.doesNotThrow(()=>validateNativeRequest({...request,key:'cmd+shift+'+key}));
 for(const key of ['j','l','i','o','cmd+shift+g','shift+right','cmd+1','f12','period'])assert.doesNotThrow(()=>validateNativeRequest({...request,key}));
 for(const key of ['','cmd++left','left+shift','meta+j','cmd+q','f13','arrowright','cmd+'])assert.throws(()=>validateNativeRequest({...request,key}));
 assert.throws(()=>validateNativeRequest({...request,key:'right',window:0}));assert.throws(()=>validateNativeRequest({...request,key:'right',started:''}));
});

test('common agent key names become actual driver keys while unsupported chords stay rejected',()=>{
 for(const [given,expected] of [['backspace','delete'],['ENTER','return'],['esc','escape'],['super+shift+backspace','cmd+shift+delete'],['option+left','alt+left']])assert.equal(normalizePhysicalKey(given),expected);
 for(const given of ['cmd+cmd+z','super+cmd+z','cmd++z','backspace+shift','cmd+q',{},null,'command+z'])assert.throws(()=>normalizePhysicalKey(given));
 const request={command:'key',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:100},key:'backspace'};assert.doesNotThrow(()=>validateNativeRequest(request));assert.equal(request.key,'backspace','Admission does not mutate the caller request');
});

test('native key codes agree with advertised controls without posting keyboard events',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-key-contract-');
 try{
  const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),start=source.indexOf('let keyCodes:'),end=source.indexOf('func scrollEvent(',start);assert.ok(start>=0&&end>start);
  await writeFile(root+'/keys.swift','import Foundation\nimport CoreGraphics\nimport Carbon\n'+source.slice(start,end)+'\nlet data=try JSONSerialization.data(withJSONObject:keyCodes)\nprint(String(decoding:data,as:UTF8.self))\n');
  execFileSync('/usr/bin/swiftc',['-module-cache-path',root+'/module-cache',root+'/keys.swift','-o',root+'/keys'],{timeout:60000});
  const codes=JSON.parse(execFileSync(root+'/keys',{encoding:'utf8',timeout:5000}));assert.deepEqual(new Set(Object.keys(codes)),new Set(physicalKeys));
  for(const [key,code] of Object.entries({j:38,l:37,i:34,o:31,left:123,right:124,up:126,down:125,'0':29,'1':18,f1:122,f12:111,period:47,comma:43}))assert.equal(codes[key],code,key);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('native identity treats path aliases equally and rejects idle or pre-request capture frames',{skip:process.platform!=='darwin'},async()=>{
 const root=await mkdtemp('/private/tmp/athanor-frame-contract-');
 try{
  await mkdir(root+'/Wizard.app/Contents/MacOS',{recursive:true});await writeFile(root+'/Wizard.app/Contents/MacOS/wizard-bin','verified fixture');
  const source=await readFile(new URL('../desktop/macos-input.swift',import.meta.url),'utf8'),canonical=source.slice(source.indexOf('func canonicalExecutable('),source.indexOf('func attribute(')),fresh=source.slice(source.indexOf('func freshFrame('),source.indexOf('final class CaptureFrame'));
  await writeFile(root+'/probe.swift','import Foundation\nimport ScreenCaptureKit\n'+canonical+fresh+`\nprecondition(canonicalExecutable("${root}/Wizard.app/Contents/MacOS/wizard-bin")==canonicalExecutable("${root.replace('/private/tmp','/tmp')}/Wizard.app/Contents/MacOS/wizard-bin"))\nprecondition(freshFrame(SCFrameStatus.complete.rawValue,101,after:100))\nfor status in [SCFrameStatus.idle,SCFrameStatus.blank,SCFrameStatus.suspended] { precondition(!freshFrame(status.rawValue,101,after:100)) }\nfor tick:UInt64 in [99,100] { precondition(!freshFrame(SCFrameStatus.complete.rawValue,tick,after:100)) }\nprint("Native identity and frame admission verified")\n`);
  execFileSync('/usr/bin/swiftc',['-module-cache-path',root+'/module-cache',root+'/probe.swift','-o',root+'/probe'],{timeout:60000});
  assert.match(execFileSync(root+'/probe',{encoding:'utf8',timeout:5000}),/Native identity and frame admission verified/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('native paths and held modifiers are bounded before any event is dispatched',()=>{
 const base={command:'drag',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:100},x:10,y:10,toX:80,toY:20,path:[{x:10,y:10},{x:40,y:50},{x:80,y:20}],modifiers:['shift'],durationMs:1000};
 assert.doesNotThrow(()=>validateNativeRequest(base));
 for(const change of [{modifiers:['shift','shift']},{modifiers:['unknown']},{modifiers:'shift'},{command:'key',key:'j'},{path:[]},{path:[{x:10,y:10},{x:201,y:20},{x:80,y:20}]},{path:[{x:11,y:10},{x:80,y:20}]},{path:[{x:10,y:10},{x:80,y:21}]},{toWindow:11,toFrame:base.frame},{path:[{x:10,y:10,t:0},{x:80,y:20}]}])assert.throws(()=>validateNativeRequest({...base,...change}));
 assert.doesNotThrow(()=>validateNativeRequest({...base,command:'click',path:undefined,modifiers:[],durationMs:undefined,clickCount:2}));
 assert.throws(()=>validateNativeRequest({...base,clickCount:2}));
});

test('Window Server sampling runs during a held drag while a second mutation remains excluded',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-capture-lock-');
 try{
  const source=await readFile(new URL('../desktop/macos-input.mjs',import.meta.url),'utf8'),start=source.indexOf('async function nativeInput('),end=source.indexOf('\nexport async function nativeDesktopInput(',start);
  assert.ok(start>=0&&end>start);
  const file=root+'/lock-probe.mjs';
  await writeFile(file,`import path from 'node:path';import {mkdir,open,unlink,appendFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {promisify} from 'node:util';import {writeJSON,inside} from '${new URL('../runner/files.mjs',import.meta.url).href}';
   export let release,entered;export const dispatched=new Promise(r=>entered=r);
   const nativeInputDriver=async()=>({driver:'platform-boundary',manifest:{driverHash:'fixture'},sourceHash:'fixture'});
   function execFile(driver,args,options,callback){const input=args.at(-1);import('node:fs/promises').then(async fs=>{const request=JSON.parse(await fs.readFile(input));const finish=()=>callback(null,JSON.stringify({status:request.command==='drag'?'Dispatched':'Observed'}),'');if(request.command==='drag'){release=finish;entered();}else finish();});}
   execFile[promisify.custom]=(...args)=>new Promise((resolve,reject)=>execFile(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));
  `+source.slice(start,end)+`\nexport {nativeInput};`);
  const {pathToFileURL}=await import('node:url'),probe=await import(pathToFileURL(file).href),request={command:'drag',mode:'window-server',durationMs:1000};
  const held=probe.nativeInput(root,root,'fixture','package',request);await probe.dispatched;
  try{
   assert.equal((await probe.nativeInput(root,root,'fixture','package',{command:'inspect',mode:'window-server'})).status,'Observed');
   assert.equal((await probe.nativeInput(root,root,'fixture','package',{command:'screenshot',mode:'window-server'})).status,'Observed');
   await assert.rejects(()=>probe.nativeInput(root,root,'fixture','package',{command:'click',mode:'window-server'}),e=>e.code==='EEXIST');
   await readFile(root+'/native-input.lock','utf8');
  }finally{probe.release();await held;}
  await assert.rejects(()=>readFile(root+'/native-input.lock'),e=>e.code==='ENOENT');
  const rows=(await readFile(root+'/native-input.jsonl','utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(new Set(rows.map(r=>r.command)),new Set(['inspect','screenshot','drag']));
 }finally{await rm(root,{recursive:true,force:true});}
});
