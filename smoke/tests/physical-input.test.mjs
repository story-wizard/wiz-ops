import test from 'node:test';
import assert from 'node:assert/strict';
import {windowPoint,clipPoint} from '../desktop/physical-input.mjs';
import {validateNativeRequest,keyboardWindowProof} from '../desktop/macos-input.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('physical coordinates include native title chrome and reject stale windows or escaped endpoints',()=>{
 const window={id:'window',window:'window',width:1000,height:700},widget={window:'window',x:20,y:40,width:100,height:60},native={frame:{x:120,y:200,width:1000,height:723}};
 assert.deepEqual(windowPoint(widget,window,native,10,15),{x:30,y:78});
 for(const operation of [()=>windowPoint({...widget,window:'other'},window,native,10,15),()=>windowPoint(widget,window,{frame:{width:1200,height:723}},10,15),()=>windowPoint(widget,window,native,100,15)])assert.throws(operation);
 const cross={command:'drag',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:200},x:50,y:50,toWindow:11,toFrame:{x:10,y:10,width:1000,height:700},toX:800,toY:600};assert.doesNotThrow(()=>validateNativeRequest(cross));assert.throws(()=>validateNativeRequest({...cross,toX:1000}));assert.throws(()=>validateNativeRequest({...cross,toFrame:undefined}));
});

test('keyboard targets the actual key window even with a floating panel above it',()=>{
 const ui={focus:'field',widgets:[{id:'main',nativeWindow:10,keyWindow:true},{id:'curves',nativeWindow:11,keyWindow:false},{id:'field',window:'main',editableText:true}]};
 assert.deepEqual(keyboardWindowProof(ui,{command:'type',window:10}),{verifiedKeyWindow:10});
 assert.throws(()=>keyboardWindowProof(ui,{command:'key',window:11}));
 assert.throws(()=>keyboardWindowProof({...ui,focus:'curves'},{command:'type',window:10}));
 assert.throws(()=>keyboardWindowProof({...ui,widgets:ui.widgets.map(w=>({...w,keyWindow:false}))},{command:'key',window:10}));
 assert.throws(()=>validateNativeRequest({command:'inspect',verifiedKeyWindow:10}));
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

test('an unfocused text target is Blocked before activation or input',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-text-focus-');
 try{
  const stub=pathToFileURL(root+'/platform.mjs').href;
  await writeFile(root+'/platform.mjs',`export async function nativeCall(file,op){if(op!=='inspect')throw Error('Activation must not happen');return {focus:'other',widgets:[{id:'field',window:'main',editableText:true},{id:'main',window:'main'}]};}export async function nativeDesktopInput(){throw Error('Input must not happen');}`);
  const source=(await readFile(new URL('../desktop/physical-input.mjs',import.meta.url),'utf8')).replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(['./adapter.mjs','./macos-input.mjs'].includes(relative)?stub:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");
  await writeFile(root+'/probe.mjs',source);const {physicalInput}=await import(pathToFileURL(root+'/probe.mjs').href);
  await assert.rejects(()=>physicalInput('owned-session','type',{target:'field',text:'hello'}),e=>e.status==='Blocked');
 }finally{await rm(root,{recursive:true,force:true});}
});
