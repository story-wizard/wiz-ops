import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeRequest} from '../desktop/macos-input.mjs';
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
