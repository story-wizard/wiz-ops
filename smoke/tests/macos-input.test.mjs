import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeRequest} from '../desktop/macos-input.mjs';

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
