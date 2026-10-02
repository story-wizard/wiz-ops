import test from 'node:test';
import assert from 'node:assert/strict';
import {windowPoint,clipPoint,postInputFocus} from '../desktop/physical-input.mjs';
import {validateNativeRequest,keyboardWindowProof} from '../desktop/macos-input.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('physical coordinates include native title chrome and reject stale windows or escaped endpoints',()=>{
 const window={id:'window',window:'window',width:1000,height:700},widget={window:'window',x:20,y:40,width:100,height:60},native={frame:{x:120,y:200,width:1000,height:723}};
 assert.deepEqual(windowPoint(widget,window,native,10,15),{x:30,y:78});
 for(const operation of [()=>windowPoint({...widget,window:'other'},window,native,10,15),()=>windowPoint(widget,window,{frame:{width:1200,height:723}},10,15),()=>windowPoint(widget,window,native,100,15)])assert.throws(operation);
 const cross={command:'drag',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:200},x:50,y:50,toWindow:11,toFrame:{x:10,y:10,width:1000,height:700},toX:800,toY:600};assert.doesNotThrow(()=>validateNativeRequest(cross));assert.throws(()=>validateNativeRequest({...cross,toX:1000}));assert.throws(()=>validateNativeRequest({...cross,toFrame:undefined}));
});

test('keyboard targets the actual key window even with a floating panel above it',()=>{
 const ui={focus:'field',widgets:[{id:'main',nativeWindow:10,keyWindow:true},{id:'curves',nativeWindow:11,keyWindow:false},{id:'field',window:'main',editableText:true}]};
 assert.deepEqual(keyboardWindowProof(ui,{command:'type',window:10,focusTarget:'field'}),{verifiedKeyWindow:10});
 const other={...ui,focus:'other-field',widgets:[...ui.widgets,{id:'other-field',window:'main',editableText:true}]};
 assert.throws(()=>keyboardWindowProof(other,{command:'type',window:10,focusTarget:'field'}),e=>e.status==='Blocked');
 assert.throws(()=>keyboardWindowProof(ui,{command:'key',window:11}));
 assert.throws(()=>keyboardWindowProof({...ui,focus:'curves'},{command:'type',window:10}));
 assert.throws(()=>keyboardWindowProof({...ui,widgets:ui.widgets.map(w=>({...w,keyWindow:false}))},{command:'key',window:10}));
 assert.throws(()=>validateNativeRequest({command:'inspect',verifiedKeyWindow:10}));
});

test('a dispatched editable click or type remains Unknown when its target loses focus',()=>{
 const target={id:'field',editableText:true},receipt={window:10},ui={focus:'field',widgets:[{id:'main',keyWindow:true,nativeWindow:10},{id:'field',window:'main',editableText:true}]};
 for(const command of ['click','type']){
  assert.doesNotThrow(()=>postInputFocus(ui,target,receipt,command));
  for(const changed of [{...ui,focus:'other'},{...ui,widgets:ui.widgets.map(w=>({...w,keyWindow:false}))},{...ui,widgets:ui.widgets.map(w=>({...w,nativeWindow:11}))},{...ui,widgets:ui.widgets.filter(w=>w.id!=='field')}])assert.throws(()=>postInputFocus(changed,target,receipt,command),e=>e.status==='Unknown'&&e.code==='input_focus_lost');
 }
 assert.doesNotThrow(()=>postInputFocus({...ui,focus:'other'},{id:'button'},receipt,'click'),'A non-editable action can open another owned dialog');
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
  await writeFile(root+'/session.json',JSON.stringify({root,agentTracking:false}));
  const stub=pathToFileURL(root+'/platform.mjs').href;
  await writeFile(root+'/platform.mjs',`export async function nativeCall(file,op){if(op!=='inspect')throw Error('Activation must not happen');return {focus:'other',widgets:[{id:'field',window:'main',editableText:true},{id:'main',window:'main'}]};}export async function nativeDesktopInput(){throw Error('Input must not happen');}`);
  const source=(await readFile(new URL('../desktop/physical-input.mjs',import.meta.url),'utf8')).replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(['./adapter.mjs','./macos-input.mjs'].includes(relative)?stub:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");
  await writeFile(root+'/probe.mjs',source);const {physicalInput}=await import(pathToFileURL(root+'/probe.mjs').href);
  await assert.rejects(()=>physicalInput(root+'/session.json','type',{target:'field',text:'hello'}),e=>e.status==='Blocked');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a changed text target is blocked before dispatch, while a lost post-input observation retains uncertainty',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-focus-boundary-');
 try{for(const mode of ['before','after']){
  const owned=root+'/'+mode;await mkdir(owned);const file=owned+'/session.json';
  await writeFile(file,JSON.stringify({root:owned,agentTracking:true}));
  const stub=pathToFileURL(owned+'/platform.mjs').href;
  await writeFile(owned+'/platform.mjs',`import {keyboardWindowProof} from '${new URL('../desktop/macos-input.mjs',import.meta.url).href}';
export const effects=[];let focus='field',dispatched=false;
const widgets=[{id:'main',window:'main',keyWindow:true,nativeWindow:10,title:'Wizard',width:1000,height:700},{id:'field',window:'main',editableText:true,x:10,y:10,width:100,height:30},{id:'other',window:'main',editableText:true}];
export async function nativeCall(file,op){if(op==='activate'){if('${mode}'==='before')focus='other';return {};}if(dispatched)throw Object.assign(Error('Lost post-input bridge'),{status:'Blocked',origin:'harness',nextActions:['inspect','correct_parameters']});return {focus,widgets};}
export async function nativeDesktopInput(file,p){if(p.command==='inspect')return {pid:123,started:'observed',windows:[{window:10,title:'Wizard',frame:{x:0,y:0,width:1000,height:723}}]};keyboardWindowProof({focus,widgets},p);effects.push({text:p.text,target:focus});dispatched=true;return {status:'Dispatched',window:10};}`);
  const source=(await readFile(new URL('../desktop/physical-input.mjs',import.meta.url),'utf8')).replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(['./adapter.mjs','./macos-input.mjs'].includes(relative)?stub:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");
  await writeFile(owned+'/probe.mjs',source);const {physicalInput}=await import(pathToFileURL(owned+'/probe.mjs').href);
  await assert.rejects(()=>physicalInput(file,'type',{target:'field',text:'intended'}),e=>mode==='before'?e.status==='Blocked':e.status==='Unknown'&&e.diagnostics.receipt.status==='Dispatched'&&JSON.stringify(e.nextActions)===JSON.stringify(['observe','verify_resolution','resolve']));
  const {effects}=await import(stub),session=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(effects,mode==='before'?[]:[{text:'intended',target:'field'}]);assert.equal(!!session.agentUncertain,mode==='after');
 }}finally{await rm(root,{recursive:true,force:true});}
});
