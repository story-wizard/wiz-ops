import test from 'node:test';
import assert from 'node:assert/strict';
import {windowPoint,clipPoint} from '../desktop/physical-input.mjs';
import {validateNativeRequest} from '../desktop/macos-input.mjs';
test('physical coordinates include native title chrome and reject stale windows or escaped endpoints',()=>{
 const window={id:'window',window:'window',width:1000,height:700},widget={window:'window',x:20,y:40,width:100,height:60},native={frame:{x:120,y:200,width:1000,height:723}};
 assert.deepEqual(windowPoint(widget,window,native,10,15),{x:30,y:78});
 for(const operation of [()=>windowPoint({...widget,window:'other'},window,native,10,15),()=>windowPoint(widget,window,{frame:{width:1200,height:723}},10,15),()=>windowPoint(widget,window,native,100,15)])assert.throws(operation);
 const cross={command:'drag',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:200},x:50,y:50,toWindow:11,toFrame:{x:10,y:10,width:1000,height:700},toX:800,toY:600};assert.doesNotThrow(()=>validateNativeRequest(cross));assert.throws(()=>validateNativeRequest({...cross,toX:1000}));assert.throws(()=>validateNativeRequest({...cross,toFrame:undefined}));
});

test('physical text and scroll requests stay bounded and reject malformed coordinates',()=>{
 const base={pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:200}};
 assert.doesNotThrow(()=>validateNativeRequest({...base,command:'type',text:'Athanor — ✨'}));
 for(const text of ['', 'x'.repeat(4097), '\u0000', false])assert.throws(()=>validateNativeRequest({...base,command:'type',text}));
 const scroll={...base,command:'scroll',x:50,y:50,deltaY:200};assert.doesNotThrow(()=>validateNativeRequest(scroll));
 for(const bad of [{deltaY:0},{deltaY:2001},{deltaY:1.5},{deltaY:Infinity},{x:200}])assert.throws(()=>validateNativeRequest({...scroll,...bad}));
});

test('clip targets use current visible rectangles and refuse an offscreen trim edge',()=>{
 const geometry={rect:{x:100,y:20,width:160,height:60},visibleRect:{x:140,y:20,width:120,height:60}};
 assert.deepEqual(clipPoint(geometry,'right-edge'),{x:259,y:49.5});assert.deepEqual(clipPoint(geometry),{x:199.5,y:49.5});
 assert.throws(()=>clipPoint(geometry,'left-edge'));
 assert.throws(()=>clipPoint({...geometry,visibleRect:{x:0,y:0,width:0,height:0}}));
 assert.throws(()=>clipPoint(geometry,'unknown'));
});
