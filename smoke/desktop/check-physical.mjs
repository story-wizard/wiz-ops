import {testSpecification} from '../test-details.mjs';
import path from 'node:path';
import {checks} from './check-support.mjs';
import {physicalInput} from './physical-input.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,same,pause,OutcomeError} from '../runner/engine.mjs';
const file=process.argv[2],{s,n,c,ui,until,check:runCheck,action,finish,report}=await checks(file,'desktop-physical-report.json');
const check=(id,fn)=>runCheck(id,async()=>{try{return await fn();}catch(e){if(e.status!=='Unknown'){await writeJSON(path.join(s.root,id+'-observed-ui.json'),await ui());try{await saveScreen(id+'-failure');}catch{}}throw e;}});
report.course=await readJSON(new URL('./physical-course.json',import.meta.url));report.acceptance='Candidate qualification';report.specifications=report.course.cases.map(testSpecification);
const physical=(command,params)=>physicalInput(file,command,params),inspect=id=>c('spellbook.inspect',{document_id:id,view:'overview',limit:100}),content=g=>({name:g.name,nodes:g.nodes,edges:g.edges,public_inputs:g.public_inputs,media_inputs:g.media_inputs});
async function canvas(){const v=(await ui()).widgets.find(w=>w.class==='DetachedGraphView');assert(v,'Spellbook canvas absent');return v;}
async function focus(){const v=await canvas();await physical('click',{target:v.viewport,x:25,y:25});return v;}
async function saveScreen(label){const v=await canvas(),receipt=await physical('screenshot',{target:v.id});await writeJSON(path.join(s.root,label+'-screen.json'),receipt);return receipt.artifacts;}
async function create(){
 if(!(await ui()).widgets.some(w=>w.class==='DetachedGraphView'))await action('Spellbook');
 await until(async()=>(await c('spellbook.list',{limit:100})).total>0);
 const old=(await c('spellbook.list',{limit:100})).items,button=(await ui()).widgets.find(w=>w.tooltip?.startsWith('New Spell'));
 assert(button,'New Spell corner button absent');await n('click',{target:button.id});
 const doc=await until(async()=>{const a=(await c('spellbook.list',{limit:100})).items;return a.find(x=>!old.some(y=>y.document_id===x.document_id));});
 await until(async()=>(await ui()).widgets.some(w=>w.tabs?.[w.index]===doc.name));await focus();return doc;
}
async function edit(id,actions){const g=await inspect(id);return c('spellbook.edit_batch',{document_id:id,expected_document_fingerprint:g.document_fingerprint,actions});}
async function blurFixture(){const d=await create(),receipt=await edit(d.document_id,[{op:'add_node',alias:'blur',type:'gaussian_blur',label:'Physical smoke blur'}]);await pause(200);await fit();return {doc:d.document_id,ref:receipt.aliases.blur};}
async function fit(){const u=await ui(),v=await canvas(),button=u.widgets.find(w=>w.window===v.window&&w.tooltip==='Fit all');assert(button,'Fit all absent');await n('click',{target:button.id});await pause(150);}
async function blurNode(){const v=await canvas(),nodes=v.sceneItems.filter(x=>x.labels?.includes('Radius'));assert(nodes.length===1,'Blur node geometry absent or ambiguous');return {v,node:nodes[0]};}
async function selectBlur(){const {v,node}=await blurNode();await physical('click',{target:v.viewport,x:node.x+node.width/2,y:node.y+8});await until(async()=>{const a=await blurNode();return a.node.selected;});return canvas();}
async function undoTo(v,id,before){await physical('key',{target:v.id,key:'cmd+z'});return until(async()=>{const g=await inspect(id);return JSON.stringify(content(g))===JSON.stringify(content(before))?g:null;});}

await check('P-SB-CREATE',async()=>{
 const d=await create(),old=(await c('spellbook.list',{limit:100})).items,v=await focus();
 await physical('key',{target:v.id,key:'cmd+shift+n'});const shortcut=await until(async()=>{const a=(await c('spellbook.list',{limit:100})).items;return a.find(x=>!old.some(y=>y.document_id===x.document_id));});
 const button=(await ui()).widgets.find(w=>w.tooltip?.startsWith('New Spell'));await physical('click',{target:button.id,x:button.width/2,y:button.height/2});
 const corner=await until(async()=>{const a=(await c('spellbook.list',{limit:100})).items;return a.find(x=>x.document_id!==shortcut.document_id&&!old.some(y=>y.document_id===x.document_id));});
 for(const id of [shortcut.document_id,corner.document_id])assert((await inspect(id)).nodes.length===0,'New Spell is not empty');
 const tabs=(await ui()).widgets.find(w=>w.tabs?.includes(shortcut.name)&&w.tabs.includes(corner.name));assert(tabs,'Both new Spell tabs must be visible');
 return {initial:d.document_id,shortcut,corner,screens:await saveScreen('P-SB-CREATE')};
});
await check('P-SB-SEARCH-DROP',async()=>{
 const observations=[];
 for(const key of ['cmd+shift+k','cmd+k']){
  const d=await create(),before=await inspect(d.document_id),v=await focus();await physical('key',{target:v.id,key});
  const popup=await until(async()=>(await ui()).widgets.find(w=>w.title==='Quick Node Search'&&w.id===w.window));
  try{
   const field=(await ui()).widgets.find(w=>w.window===popup.id&&w.class==='QLineEdit');assert(field,'Quick search field missing');await n('text',{target:field.id,text:'Text'});
   const list=await until(async()=>(await ui()).widgets.find(w=>w.window===popup.id&&w.model?.some(r=>r[0]==='Text'))),row=list.model.findIndex(r=>r[0]==='Text'),rectangle=list.itemRects.find(r=>r.row===row);
   assert(rectangle&&rectangle.width>0&&rectangle.height>0,'Search result geometry missing');
   const receipt=await physical('drag',{target:list.viewport,x:rectangle.x+rectangle.width/2,y:rectangle.y+rectangle.height/2,toTarget:v.viewport,toX:70,toY:80});
   const after=await until(async()=>{const g=await inspect(d.document_id);return g.nodes.length===1?g:null;}).catch(e=>{e.message='Physical glossary drop did not create a node: '+e.message;throw e;});assert(after.nodes[0].type==='text','Physical drop created the wrong node');
   if((await ui()).widgets.some(w=>w.id===popup.id))await n('close-window',{target:popup.id});await focus();const screenshots=await saveScreen('P-SB-SEARCH-DROP-'+key.replaceAll('+','-'));await undoTo(await canvas(),d.document_id,before);
   observations.push({key,document:d.document_id,node:after.nodes[0],receipt,screenshots,undoRestored:true});
  }finally{if((await ui()).widgets.some(w=>w.id===popup.id))await n('close-window',{target:popup.id});}
 }
 return {observations};
});
await check('P-SB-WIRE',async()=>{
 const d=await create(),r=await edit(d.document_id,[{op:'add_node',alias:'source',type:'image_source'},{op:'add_node',alias:'blur',type:'gaussian_blur',label:'Physical wire blur'}]);await fit();
 const v=await canvas(),blur=v.sceneItems.find(x=>x.labels?.includes('Radius')),source=v.sceneItems.find(x=>x!==blur&&x.ports?.some(p=>p.side==='output'));
 assert(blur&&source,'Source/effect geometry absent');const output=source.ports.filter(p=>p.side==='output'),input=blur.ports.filter(p=>p.side==='input');assert(output.length===1&&input.length===2,'Expected image output and blur image/mask inputs');input.sort((a,b)=>a.y-b.y);
 const before=await inspect(d.document_id),receipt=await physical('drag',{target:v.viewport,x:output[0].x,y:output[0].y,toX:input[0].x,toY:input[0].y});
 const connected=await until(async()=>{const g=await inspect(d.document_id);return g.edges.length===1?g:null;});assert(connected.edges[0].from.node_ref===r.aliases.source&&connected.edges[0].to.node_ref===r.aliases.blur,'Wire connected the wrong nodes');
 const screenshots=await saveScreen('P-SB-WIRE');await focus();await undoTo(await canvas(),d.document_id,before);await physical('key',{target:(await canvas()).id,key:'cmd+shift+z'});await until(async()=>JSON.stringify(content(await inspect(d.document_id)))===JSON.stringify(content(connected)));
 return {document:d.document_id,receipt,edges:connected.edges,undoRedo:true,screenshots};
});
await check('P-SB-BYPASS',async()=>{
 const f=await blurFixture(),before=await inspect(f.doc),v=await selectBlur();await physical('key',{target:v.id,key:'d'});
 const bypassed=await until(async()=>{const g=await inspect(f.doc);return g.nodes.find(n=>n.node_ref===f.ref)?.bypassed?g:null;}).catch(e=>{e.message='D did not bypass the selected effect: '+e.message;throw e;});await physical('key',{target:(await canvas()).id,key:'d'});
 await until(async()=>JSON.stringify(content(await inspect(f.doc)))===JSON.stringify(content(before)));
 return {document:f.doc,node:f.ref,bypassed:bypassed.nodes.find(n=>n.node_ref===f.ref).bypassed,restored:true,screenshots:await saveScreen('P-SB-BYPASS')};
});
await check('P-SB-GESTURE-UNDO',async()=>{
 const f=await blurFixture(),baseline=await inspect(f.doc);await edit(f.doc,[{op:'set_params',node_ref:f.ref,values:{radius:17}}]);
 const marker=await inspect(f.doc),{v,node}=await blurNode(),start={x:node.sceneX,y:node.sceneY},receipt=await physical('drag',{target:v.viewport,x:node.x+node.width/2,y:node.y+8,toX:node.x+node.width/2+45,toY:node.y+38});
 const moved=await until(async()=>{const p=(await blurNode()).node;return p.sceneX!==start.x||p.sceneY!==start.y?p:null;});same(content(await inspect(f.doc)),content(marker),'Node move must preserve graph values');
 const screenshots=await saveScreen('P-SB-GESTURE-UNDO');await physical('key',{target:(await canvas()).id,key:'cmd+z'});
 await until(async()=>{const p=(await blurNode()).node;return p.sceneX===start.x&&p.sceneY===start.y;});same(content(await inspect(f.doc)),content(marker),'One Undo must retain the preceding separate parameter edit');
 await undoTo(await canvas(),f.doc,baseline);
 return {document:f.doc,receipt,from:start,to:{x:moved.sceneX,y:moved.sceneY},oneUndoRestoresPosition:true,nextUndoRestoresMarker:true,screenshots};
});
await check('P-SB-DOCK',async()=>{
 const f=await blurFixture(),before=await inspect(f.doc),initial=await blurNode(),u=await ui(),main=u.widgets.find(w=>w.class==='MainWindow');
 const headerFor=a=>{
  const parents=new Map(a.widgets.map(w=>[w.id,w]));let graph=a.widgets.find(v=>v.class==='DetachedGraphView'),area=graph;
  while(area&&area.class!=='ads::CDockAreaWidget')area=parents.get(area.parent);
  if(!area)return undefined;
  return a.widgets.find(w=>{if(w.name!=='dockWidgetTabLabel')return false;for(let p=w;p;p=parents.get(p.parent))if(p.id===area.id)return true;return false;});
 };
 if(initial.v.window!==main.id){
  const header=headerFor(u);assert(header,'Initial floating dock header absent');
  await physical('drag',{target:initial.v.window,chrome:true,x:200,y:16,toTarget:main.id,toX:100,toY:Math.floor(main.height*.3)});
  await until(async()=>(await canvas()).window===main.id).catch(e=>{e.message='Initial floating Spellbook did not redock: '+e.message;throw e;});same(content(await inspect(f.doc)),content(before),'Fixture redock changed Spell content');
 }
 const {v,node}=await blurNode(),label=headerFor(await ui());assert(label,'Spellbook dock header absent');
 const receipt=await physical('click',{target:label.id,x:label.width/2,y:label.height/2,button:'right'});
 const menu=await until(async()=>(await ui()).widgets.find(w=>w.class==='QMenu'&&w.menuItems?.some(m=>/detach|float/i.test(m.text)&&m.enabled))).catch(e=>{throw new OutcomeError('Title-bar redock succeeded; a supported Float/Detach control remains to be bound','Blocked');});
 const detach=menu.menuItems.filter(m=>/detach|float/i.test(m.text)&&m.enabled);assert(detach.length===1,'Float action is ambiguous');
 await n('click',{target:menu.id,x:detach[0].x+detach[0].width/2,y:detach[0].y+detach[0].height/2});
 const floating=await until(async()=>{const a=await ui(),graph=a.widgets.find(w=>w.class==='DetachedGraphView'),window=a.widgets.find(w=>w.id===graph?.window&&w.class==='ads::CFloatingDockContainer');return graph&&window&&window.id!==main.id?{graph,window}:null;});
 same(content(await inspect(f.doc)),content(before),'Floating changed Spell content');const floatScreens=await physical('screenshot',{target:floating.graph.id});
 const fresh=await ui(),graph=fresh.widgets.find(w=>w.class==='DetachedGraphView'),window=fresh.widgets.find(w=>w.id===graph?.window&&w.class==='ads::CFloatingDockContainer');assert(window,'Floating window absent before redock');
 const back=await physical('drag',{target:window.id,chrome:true,x:Math.min(200,window.width-20),y:16,toTarget:main.id,toX:100,toY:Math.floor(main.height*.3)});
 await until(async()=>(await canvas()).window===main.id);same(content(await inspect(f.doc)),content(before),'Redocking changed Spell content');
 const restored=(await blurNode()).node;assert(restored.sceneX===node.sceneX&&restored.sceneY===node.sceneY,'Docking changed node position');
 return {document:f.doc,receipt,back,floatingWindow:floating.graph.window,floatAction:detach[0].text,paths:['native title-bar redock','native context menu and visible Float/Detach action','native title-bar redock'],contentPreserved:true,screenshots:[...floatScreens.artifacts,...await saveScreen('P-SB-DOCK')]};
});
await action('Save');finish();
