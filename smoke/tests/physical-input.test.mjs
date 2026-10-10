import test from 'node:test';
import assert from 'node:assert/strict';
import {windowPoint,clipPoint,defaultClickPoint,postInputFocus,spellTextBaseline,verifySpellTextCommit,requireTargetGeometry} from '../desktop/physical-input.mjs';
import {validateNativeRequest,keyboardWindowProof} from '../desktop/macos-input.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('a moved target reports its current geometry and pre-dispatch rejection',()=>{
 const before={id:'button',window:'main',x:10,y:20,width:30,height:40},after={...before,x:50,visibleRect:{x:0,y:0,width:30,height:40}};
 assert.doesNotThrow(()=>requireTargetGeometry({...before},before));
 assert.throws(()=>requireTargetGeometry(after,before),e=>e.status==='Blocked'&&e.code==='input_binding_rejected'&&e.diagnostics.dispatch==='not_started'&&e.diagnostics.observed.x===50&&e.diagnostics.expected.x===10&&e.nextActions[0]==='observe');
});
test('physical coordinates include native title chrome and reject stale windows or escaped endpoints',()=>{
 const window={id:'window',window:'window',width:1000,height:700},widget={window:'window',x:20,y:40,width:100,height:60},native={frame:{x:120,y:200,width:1000,height:723}};
 assert.deepEqual(windowPoint(widget,window,native,10,15),{x:30,y:78});
 for(const operation of [()=>windowPoint({...widget,window:'other'},window,native,10,15),()=>windowPoint(widget,window,{frame:{width:1200,height:723}},10,15),()=>windowPoint(widget,window,native,100,15)])assert.throws(operation);
 const cross={command:'drag',pid:123,started:'observed',window:10,frame:{x:0,y:0,width:200,height:200},x:50,y:50,toWindow:11,toFrame:{x:10,y:10,width:1000,height:700},toX:800,toY:600};assert.doesNotThrow(()=>validateNativeRequest(cross));assert.throws(()=>validateNativeRequest({...cross,toX:1000}));assert.throws(()=>validateNativeRequest({...cross,toFrame:undefined}));
});
test('default clicks use visible styled hit regions without moving explicit or ordinary targets',()=>{
 const box={width:900,height:24,clickRect:{x:0,y:0,width:140,height:24},visibleRect:{x:0,y:0,width:900,height:24}};
 assert.deepEqual(defaultClickPoint(box),{x:69.5,y:11.5});assert(defaultClickPoint(box).x<140,'Widget center misses the checkbox hit region');
 assert.deepEqual(defaultClickPoint({...box,clickRect:undefined}),{x:450,y:12});
 assert.deepEqual(defaultClickPoint({...box,visibleRect:{x:100,y:0,width:800,height:24}}),{x:119.5,y:11.5});
 assert.throws(()=>defaultClickPoint({...box,visibleRect:{x:150,y:0,width:750,height:24}}),e=>e.status==='Blocked');
 for(const clickRect of [{x:-1,y:0,width:140,height:24},{x:0,y:0,width:1000,height:24},{x:0,y:0,width:NaN,height:24}])assert.throws(()=>defaultClickPoint({...box,clickRect}));
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

test('a rebuilt Spell text field requires exact saved change, preserved state and owned window',()=>{
 const before={document_id:'picnic',kind:'instance',name:'Picnic',state_source:'live_registry',definition:{fingerprint:'pinned'},graph:{parameter_inputs:[{id:'setting',label:'Setting',node:9,param:'prompt'}],nodes:[{id:9,pass:{params:{prompt:{type:'string',value:'Sunny picnic'},seed:{type:'int',value:42}}}}]},scene:{source_sentinels:[{sha256:'product'}]},outputs:[]};
 const target={id:'old',name:'InspectorMultilineTextControl',class:'QPlainTextEdit',editableText:true,accessibleName:'Setting (default)',window:'inspector'},replacement={...target,id:'new',accessibleName:'Setting (override)'},ui={focus:'',widgets:[{id:'inspector',keyWindow:true,nativeWindow:10},replacement]},receipt={status:'Dispatched',window:10,postInput:{frontmost:true,frontWindow:10}};
 const baseline=spellTextBaseline(before,target,{documentId:'picnic',inputId:'setting'},'Cafe'),after=structuredClone(before);after.graph.nodes[0].pass.params.prompt.value='Cafe';
 assert.equal(verifySpellTextCommit(baseline,after,ui,target,receipt).rebuilt,true);
 for(const mutate of [x=>x.graph.nodes[0].pass.params.seed.value=99,x=>x.scene.source_sentinels[0].sha256='different',x=>x.definition.fingerprint='different',x=>x.outputs.push({newResult:true}),x=>x.document_id='other',x=>x.graph.nodes[0].pass.params.prompt.value='Wrong']){const bad=structuredClone(after);mutate(bad);assert.throws(()=>verifySpellTextCommit(baseline,bad,ui,target,receipt));}
 for(const bad of [{...ui,focus:'unrelated'},{...ui,modalWindow:'dialog'},{...ui,widgets:[...ui.widgets,target]},{...ui,widgets:[...ui.widgets,{...replacement,id:'duplicate'}]},{...ui,widgets:ui.widgets.map(w=>({...w,keyWindow:false}))}])assert.throws(()=>verifySpellTextCommit(baseline,after,bad,target,receipt));
 assert.throws(()=>verifySpellTextCommit(baseline,after,ui,target,{...receipt,postInput:{frontmost:false,frontWindow:10}}));
 assert.throws(()=>spellTextBaseline(before,{...target,accessibleName:'Other input'},{documentId:'picnic',inputId:'setting'},'Cafe'));
 assert.throws(()=>spellTextBaseline(before,target,{documentId:'picnic',inputId:'setting'},'Sunny picnic'));
});

test('typing a declared Spell input survives a rebuild once and never replays a divergent change',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-spell-commit-');
 try{for(const divergent of [false,true]){
  const owned=root+'/'+divergent;await mkdir(owned);const file=owned+'/session.json';await writeFile(file,JSON.stringify({root:owned,agentTracking:true}));const stub=pathToFileURL(owned+'/platform.mjs').href;
  await writeFile(owned+'/platform.mjs',`export const effects=[];let dispatched=false;
const field={id:'field',window:'main',name:'InspectorMultilineTextControl',class:'QPlainTextEdit',accessibleName:'Setting (default)',editableText:true,x:10,y:10,width:100,height:30};
const owner={id:'main',window:'main',keyWindow:true,nativeWindow:10,title:'Wizard',width:1000,height:700};
export async function nativeCall(f,op){return {focus:dispatched?'':'field',widgets:[owner,dispatched?{...field,id:'new',accessibleName:'Setting (override)'}:field]};}
export async function desktopCall(){return {document_id:'picnic',kind:'instance',name:'Picnic',state_source:'live_registry',definition:{fingerprint:'pinned'},graph:{parameter_inputs:[{id:'setting',label:'Setting',node:9,param:'prompt'}],nodes:[{id:9,pass:{params:{prompt:{type:'string',value:dispatched?'Cafe':'Sunny picnic'},seed:{type:'int',value:dispatched&&${divergent}?99:42}}}}]},scene:{source_sentinels:[{sha256:'product'}]},outputs:[]};}
export async function nativeDesktopInput(f,p){if(p.command==='inspect')return {pid:123,started:'observed',windows:[{window:10,title:'Wizard',frame:{x:0,y:0,width:1000,height:723}}]};effects.push(p.text);dispatched=true;return {status:'Dispatched',window:10,postInput:{frontmost:true,frontWindow:10}};}`);
  const source=(await readFile(new URL('../desktop/physical-input.mjs',import.meta.url),'utf8')).replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(['./adapter.mjs','./macos-input.mjs'].includes(relative)?stub:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");await writeFile(owned+'/probe.mjs',source);const {physicalInput}=await import(pathToFileURL(owned+'/probe.mjs').href);
  const type=()=>physicalInput(file,'type',{target:'field',text:'Cafe',commit:{documentId:'picnic',inputId:'setting'}});
  if(divergent){await assert.rejects(type,e=>e.status==='Unknown'&&e.code==='input_commit_unverified');await assert.rejects(type,e=>e.code==='mutation_unknown');}
  else{const receipt=await type();assert.equal(receipt.status,'Dispatched');assert.equal(receipt.commit.rebuilt,true);}
  assert.deepEqual((await import(stub)).effects,['Cafe']);
 }}finally{await rm(root,{recursive:true,force:true});}
});

test('an already active key window avoids activation while missing or inactive ownership still activates',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-activation-');
 try{for(const [i,flags] of [{active:true,keyWindow:true},{active:false,keyWindow:true},{active:true,keyWindow:false},{}].entries()){
  const owned=root+'/'+i;await mkdir(owned);const file=owned+'/session.json';await writeFile(file,JSON.stringify({root:owned}));const stub=pathToFileURL(owned+'/stub.mjs').href;
  await writeFile(owned+'/stub.mjs',`export const actions=[];export async function nativeCall(file,op){actions.push(op);return {widgets:[{id:'main',window:'main',title:'Wizard',width:100,height:100,...${JSON.stringify(flags)}},{id:'button',window:'main',width:20,height:20,x:0,y:0}]};}export async function nativeDesktopInput(file,p){return p.command==='inspect'?{pid:123,started:'observed',windows:[{window:10,title:'Wizard',frame:{width:100,height:123}}]}:{status:'Dispatched',window:10};}`);
  const source=(await readFile(new URL('../desktop/physical-input.mjs',import.meta.url),'utf8')).replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>"from '"+(['./adapter.mjs','./macos-input.mjs'].includes(relative)?stub:new URL(relative,new URL('../desktop/',import.meta.url)).href)+"'");await writeFile(owned+'/probe.mjs',source);
  const {physicalInput}=await import(pathToFileURL(owned+'/probe.mjs').href),reply=await physicalInput(file,'click',{target:'button'}),{actions}=await import(stub);
  assert.equal(reply.status,'Dispatched');assert.equal(actions.includes('activate'),i!==0);assert.equal(reply.physicalTiming.activationRequested,i!==0);
 }}finally{await rm(root,{recursive:true,force:true});}
});

test('focus-bound keyboard input refuses another control in the same owned window',()=>{
 const ui={focus:'timeline',widgets:[{id:'main',keyWindow:true,nativeWindow:10},{id:'timeline',window:'main',class:'TimelineWidget'},{id:'search',window:'main',editableText:true}]};
 const request={command:'key',key:'cmd+z',window:10,focusTarget:'timeline'};
 assert.deepEqual(keyboardWindowProof(ui,request),{verifiedKeyWindow:10});
 assert.throws(()=>keyboardWindowProof({...ui,focus:'search'},request),e=>e.status==='Blocked'&&e.code==='input_focus_changed'&&e.diagnostics.dispatch==='not_started'&&e.diagnostics.observedFocus==='search');
 assert.throws(()=>keyboardWindowProof({...ui,widgets:ui.widgets.filter(w=>w.id!=='timeline')},request),e=>e.status==='Blocked');
 assert.deepEqual(keyboardWindowProof({...ui,focus:'search'},{command:'key',key:'cmd+s',window:10}),{verifiedKeyWindow:10},'Window shortcuts retain their explicit window scope');
});
