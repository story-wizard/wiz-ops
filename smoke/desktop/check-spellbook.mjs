import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {checks} from './check-support.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,same,pause} from '../runner/engine.mjs';
const {s,n,c,ui,until,check,activate,action,finish}=await checks(process.argv[2],process.argv[3]==='verify'?'desktop-spellbook-reopen-report.json':'desktop-spellbook-report.json');
const inspect=(document_id,view='overview',node_ref)=>c('spellbook.inspect',{document_id,view,...(node_ref?{node_ref}:{}),limit:100});
const content=i=>({document_id:i.document_id,name:i.name,kind:i.kind,nodes:i.nodes,edges:i.edges,public_inputs:i.public_inputs,media_inputs:i.media_inputs});
const expectedFile=path.join(s.root,'spellbook-expected.json');
if(process.argv[3]==='verify'){
  await check('D-SB-PERSIST',async()=>{const expected=await readJSON(expectedFile);for(const e of expected){same(content(await inspect(e.overview.document_id)),content(e.overview),'Reopened Spell graph');for(const node of e.nodes)same((await inspect(e.overview.document_id,'node',node.nodes[0].node_ref)).nodes,node.nodes,'Reopened native parameters');}return {documents:expected.map(e=>e.overview.document_id),freshProcess:s.pid,graphAndParametersRestored:true};});
  await check('D-SB-LOGGING',async()=>{
    async function verbose(value){await action('Preferences...');let u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.class==='PreferencesDialog')?a:null;});const d=u.widgets.find(w=>w.class==='PreferencesDialog'),nav=u.widgets.find(w=>w.name==='settingsNavigation');await n('item-click',{target:nav.id,row:nav.model.findIndex(r=>r[0]==='Debug')});u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='projectSpellbookVerboseLogCheck')?a:null;});const toggle=u.widgets.find(w=>w.name==='projectSpellbookVerboseLogCheck'),previous=toggle.checked;if(previous!==value)await n('click',{target:toggle.id});await n('click',{target:u.widgets.find(w=>w.window===d.id&&w.text==='OK').id});await until(async()=>!(await ui()).widgets.some(w=>w.class==='PreferencesDialog'));return previous;}
    const previous=await verbose(true);
    try{await action('Spellbook');let u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.class==='DetachedGraphView')?a:null;});const consoleButton=u.widgets.find(w=>w.text==='Console');assert(consoleButton,'Spellbook console toggle missing');if(!u.widgets.some(w=>w.class==='QPlainTextEdit'))await n('click',{target:consoleButton.id});
      const console=await until(async()=>(await ui()).widgets.find(w=>w.class==='QPlainTextEdit'&&w.text?.includes('[debug]')&&w.text.includes('gaussian_blur')));await writeJSON(path.join(s.root,'spellbook-debug-console.json'),console);return {console:console.id,debugLines:console.text.split('\n').filter(l=>l.startsWith('[debug]')).length,observed:'Native graph reconstruction messages in the visible console; no provider run'};
    }finally{await verbose(previous);}
  });finish();
}else{
  let document,refs;
  const view=async()=>{const v=(await ui()).widgets.find(w=>w.class==='DetachedGraphView');assert(v,'Spellbook canvas unavailable');await activate(v);return v;};
  const edit=async actions=>{assert(document,'Spell creation prerequisite failed');const before=await inspect(document);return c('spellbook.edit_batch',{document_id:document,expected_document_fingerprint:before.document_fingerprint,actions});};
  await check('D-SB-CREATE',async()=>{
    const before=await c('spellbook.list',{limit:100});assert(before.total===0,'Fresh Spellbook fixture must be empty');await action('Spellbook');await until(async()=>(await c('spellbook.list')).total===1);
    const v=await view();await n('key',{target:v.id,key:'Ctrl+Shift+N'});await until(async()=>(await c('spellbook.list')).total===2);
    const u=await ui(),button=u.widgets.find(w=>w.tooltip.startsWith('New Spell'));assert(button,'New Spell button missing');await n('click',{target:button.id});
    const list=await until(async()=>{const a=await c('spellbook.list');return a.total===3?a:null;});assert(new Set(list.items.map(x=>x.document_id)).size===3,'Spell IDs are not independent');document=list.items.at(-1).document_id;
    const tabs=(await ui()).widgets.find(w=>w.class==='QTabBar'&&w.tabs.includes(list.items.at(-1).name));assert(tabs?.tabs.length===3,'Created spells absent from visible tabs');return {documents:list.items,paths:['open panel','shortcut','plus button']};
  });
  await check('D-SB-QUICK-SEARCH',async()=>{
    assert(document,'Spell creation prerequisite failed');const before=content(await inspect(document)),v=await view();await n('key',{target:v.id,key:'Ctrl+Shift+K'});let popup;
    try{let u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.title==='Quick Node Search'&&w.window===w.id)?a:null;});popup=u.widgets.find(w=>w.title==='Quick Node Search'&&w.window===w.id);const search=u.widgets.find(w=>w.window===popup.id&&w.class==='QLineEdit');await n('text',{target:search.id,text:'Text'});
      u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.window===popup.id&&w.model?.some(r=>r[0]==='Text'))?a:null;});const list=u.widgets.find(w=>w.window===popup.id&&w.model?.some(r=>r[0]==='Text'));await n('item-click',{target:list.id,row:list.model.findIndex(r=>r[0]==='Text'),double:true});await until(async()=>(await inspect(document)).nodes.some(x=>x.type==='text'));
    }finally{if(popup&&(await ui()).widgets.some(w=>w.id===popup.id))await n('close-window',{target:popup.id});}
    const current=await view();await n('key',{target:current.id,key:'Ctrl+Z'});await until(async()=>JSON.stringify(content(await inspect(document)))===JSON.stringify(before));return {query:'Text',insertedType:'text',undoRestored:true,scope:'Quick-search shortcut and double-click insertion; drag/drop remains separate'};
  });
  await check('D-SB-GRAPH',async()=>{
    const receipt=await edit([{op:'add_node',alias:'source',type:'image_source'},{op:'add_node',alias:'blur',type:'gaussian_blur'},{op:'add_node',alias:'grade',type:'wiz.color.exposure_contrast'},{op:'connect',from_ref:'$source',from_port:'image',to_ref:'$blur',to_port:'input'},{op:'connect',from_ref:'$blur',from_port:'output',to_ref:'$grade',to_port:'input'}]);refs=receipt.aliases;
    assert(receipt.ui_reconciled&&receipt.generation_submitted===false,'Graph must reconcile without generation');const connected=await inspect(document);assert(connected.nodes.length===3&&connected.edges.length===2,'Connected graph is incomplete');
    const edge={from_ref:refs.blur,from_port:'output',to_ref:refs.grade,to_port:'input'};await edit([{op:'disconnect',...edge}]);const detached=await inspect(document);assert(detached.edges.length===1&&!detached.nodes.find(x=>x.node_ref===refs.grade).inputs[0].connected_from,'Disconnect left grade input connected');await edit([{op:'connect',...edge}]);same(content(await inspect(document)),content(connected),'Reconnect graph');return {document,refs,edges:connected.edges,disconnectedAndRestored:true,scope:'Native authoring; source remains unbound, no rendered-output claim'};
  });
  await check('D-SB-PARAMS',async()=>{assert(refs,'Graph prerequisite failed');await edit([{op:'set_params',node_ref:refs.blur,values:{radius:17}}]);const node=(await inspect(document,'node',refs.blur)).nodes[0];assert(node.controls.radius.effective===17,'Native radius did not update');return {node:refs.blur,radius:17,scope:'CLI parameter readback; Inspector and preview not implied'};});
  await check('D-SB-BYPASS',async()=>{assert(refs,'Graph prerequisite failed');await edit([{op:'set_node_state',node_ref:refs.blur,bypassed:true}]);assert((await inspect(document,'node',refs.blur)).nodes[0].bypassed===true,'Bypass did not update');await edit([{op:'set_node_state',node_ref:refs.blur,bypassed:false}]);assert((await inspect(document,'node',refs.blur)).nodes[0].bypassed===false,'Bypass did not restore');return {bypassedAndRestored:true,scope:'Application operation, not D shortcut'};});
  await check('D-SB-UNDO',async()=>{
    assert(refs,'Graph prerequisite failed');const before=content(await inspect(document));await edit([{op:'rename_node',node_ref:refs.blur,label:'Smoke blur renamed'},{op:'set_node_state',node_ref:refs.grade,bypassed:true}]);const after=content(await inspect(document));assert(after.nodes.some(x=>x.label==='Smoke blur renamed')&&after.nodes.find(x=>x.node_ref===refs.grade).bypassed,'Batch edits absent');const v=await view();
    await n('key',{target:v.id,key:'Ctrl+Z'});await until(async()=>JSON.stringify(content(await inspect(document)))===JSON.stringify(before));await n('key',{target:v.id,key:'Ctrl+Shift+Z'});await until(async()=>JSON.stringify(content(await inspect(document)))===JSON.stringify(after));return {oneUndoRestoresWholeBatch:true,redoRestoresWholeBatch:true};
  });
  await check('D-SB-ATOMIC',async()=>{
    assert(refs,'Graph prerequisite failed');const before=await inspect(document);await c('spellbook.edit_batch',{document_id:document,expected_document_fingerprint:before.document_fingerprint,actions:[{op:'rename_node',node_ref:refs.blur,label:'MUST NOT COMMIT'},{op:'connect',from_ref:refs.source,from_port:'missing-port',to_ref:refs.grade,to_port:'input'}]},['invalid_spellbook_edit']);same(await inspect(document),before,'Rejected batch leaves all state unchanged');return {invalidBatchRejected:true,noPartialRename:true};
  });
  await check('D-SB-STALE',async()=>{
    assert(refs,'Graph prerequisite failed');const before=await inspect(document);await edit([{op:'rename_node',node_ref:refs.blur,label:'Current blur'}]);const current=await inspect(document);assert(current.document_fingerprint!==before.document_fingerprint,'Mutation did not change document fingerprint');await c('spellbook.edit_batch',{document_id:document,expected_document_fingerprint:before.document_fingerprint,actions:[{op:'rename_node',node_ref:refs.blur,label:'STALE MUST NOT COMMIT'}]},['stale_document']);same(await inspect(document),current,'Stale edit leaves current state unchanged');return {staleFingerprintRejected:true};
  });
  await check('D-SB-INSTANCE',async()=>{
    assert(refs,'Graph prerequisite failed');await edit([{op:'expose_input',node_ref:refs.blur,param:'radius',input_id:'blur-radius',label:'Blur radius'}]);const before=await inspect(document),instance=randomUUID();
    await c('spellbook.instantiate',{document_id:document,expected_document_fingerprint:before.document_fingerprint,instance_id:instance,name:'Independent smoke instance',inputs:{'blur-radius':31}});const clone=await inspect(instance);assert(clone.kind==='instance'&&clone.document_id!==document,'Instance identity missing');const blur=clone.nodes.find(x=>x.type==='gaussian_blur');assert((await inspect(instance,'node',blur.node_ref)).nodes[0].controls.radius.effective===31,'Instance input not applied');same(await inspect(document),before,'Instance creation preserves definition');
    await c('spellbook.edit_batch',{document_id:instance,expected_document_fingerprint:clone.document_fingerprint,actions:[{op:'set_inputs',values:{'blur-radius':43}}]});assert((await inspect(instance,'node',blur.node_ref)).nodes[0].controls.radius.effective===43,'Instance input edit absent');assert((await inspect(document,'node',refs.blur)).nodes[0].controls.radius.effective===17,'Instance edit leaked to definition');return {definition:document,instance,definitionRadius:17,instanceRadius:43};
  });
  // Freeze observed content for a separate check in a genuinely new process.
  const expected=[];for(const d of (await c('spellbook.list',{limit:100})).items){const overview=await inspect(d.document_id);const nodes=[];for(const node of overview.nodes)nodes.push(await inspect(d.document_id,'node',node.node_ref));expected.push({overview,nodes});}
  assert(expected.some(e=>e.overview.nodes.length===3),'Persistence fixture was not authored');await writeJSON(expectedFile,expected);await action('Save');await pause(200);finish();
}
