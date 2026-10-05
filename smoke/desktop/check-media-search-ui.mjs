import path from 'node:path';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import {uiWorkflows} from './ui-workflows.mjs';
import {usableGeometry} from './check-support.mjs';
import {ingestFixture} from './ingest-fixture.mjs';
import {verifySearchIdentity} from './ui-cohort-proof.mjs';
import {assert,OutcomeError,same} from '../runner/engine.mjs';
import {readJSON,sha} from '../runner/files.mjs';
const file=process.argv[2],h=await uiWorkflows(file,'desktop-media-search-report.json');
const {s,n,c,ui,until,check,stage,physical,observe,capture,unique,click,type,modelRow,value,search,clearSearch,finish}=h;
const assetPath=id=>path.join(s.root,'media',id==='plate'?'pattern_24.mov':'comet_report.mov');
async function list(){const result=await c('media.list_assets');assert(Array.isArray(result.assets),'Asset registry is incomplete');return result.assets;}
async function identity(row,expected){const id=await value(row,0,274);assert(id.available&&id.type==='QString'&&id.value===expected,'Model role is not bound to the expected asset in this build');return id.value;}
async function imported(name){const destination=path.join(s.root,'outside-project',name);await mkdir(path.dirname(destination),{recursive:true});await copyFile(assetPath('plate'),destination);return destination;}

await check('D-IMPORT-DIALOG',async()=>{
 const id='D-IMPORT-DIALOG',destination=await stage('setup','Place a synthetic source outside the project parent','prepare',()=>imported('outside-dialog.mov')),before=await list();
 await stage('picker','Open Import Files from the media context menu','execute',async()=>{
  const u=await ui(),view=unique(u,w=>w.class==='QTreeView'&&Array.isArray(w.model),'Media list'),viewport=unique(u,w=>w.id===view.viewport,'Media viewport');await physical('click',{target:viewport.id,x:viewport.width*.7,y:Math.max(10,viewport.height-20),button:'right'});
  let menu=await until(async()=>(await ui()).widgets.find(w=>w.class==='QMenu'&&w.menuItems?.some(a=>a.text==='Import')),{description:'Import menu'}),entry=menu.menuItems.find(a=>a.text==='Import');
  await physical('click',{target:menu.id,x:entry.x+entry.width/2,y:entry.y+entry.height/2});
  menu=await until(async()=>(await ui()).widgets.find(w=>w.class==='QMenu'&&w.menuItems?.some(a=>/^Files/.test(a.text))),{description:'Import Files submenu'});entry=menu.menuItems.find(a=>/^Files/.test(a.text));await physical('click',{target:menu.id,x:entry.x+entry.width/2,y:entry.y+entry.height/2});
 });
 let panel=await until(async()=>(await ui()).widgets.find(w=>w.class==='NSOpenPanel'||w.class==='QFileDialog'),{description:'Owned import file panel'});await capture(id,'before-picker',panel.id);
 await stage('path','Choose the external source through the physical file picker','execute',async()=>{
  await physical('key',{target:panel.id,key:'cmd+shift+g'});
  const binding=await until(async()=>{const u=await ui(),fields=u.widgets.filter(w=>w.editableText&&w.focused&&u.widgets.some(window=>window.id===w.window&&window.keyWindow===true));return fields.length===1?usableGeometry(u,fields[0]):null;},{description:'Focused Go to Folder field in the owned key window',stableForMs:250});const field=unique(await ui(),w=>w.id===binding.id,'Go to Folder field');await type(field,destination);
  // AppKit may accept a complete file path directly from Go to Folder.
  // Send Open only if the picker is still present; never replay a closed dialog.
  const panels=(await ui()).widgets.filter(w=>w.class==='NSOpenPanel'||w.class==='QFileDialog');assert(panels.length<=1,'Import panel became ambiguous');if(panels.length){panel=panels[0];await physical('key',{target:panel.id,key:'Return'});}
 });
 const after=await until(async()=>{const a=await list();return a.length===before.length+1?a:null;},{description:'Imported registry identity',timeoutMs:15000}),added=after.filter(a=>!before.some(b=>b.asset_id===a.asset_id));assert(added.length===1,'Import added unexpected assets');
 const resolved=await c('media.resolve_path',{asset_id:added[0].asset_id});same(resolved.path,destination,'Imported source path');same(await sha(destination),await sha(assetPath('plate')),'Source unchanged by import');
 await identity(await modelRow('outside-dialog.mov'),added[0].asset_id);await observe(id,'import',{before,after,resolved});await capture(id,'after',unique(await ui(),w=>w.class==='QTreeView'&&Array.isArray(w.model),'Media list').id,'widget');return {assetId:added[0].asset_id,path:destination};
});

await check('D-MEDIA-THUMBNAIL',async()=>{
 const id='D-MEDIA-THUMBNAIL';await clearSearch();let row;
 await stage('thumbnail','Read the cached thumbnail for the known plate','verify',async()=>{
  const thumb=await until(async()=>{row=await modelRow('pattern_24.mov');await identity(row,s.assets.plate);const image=await value(row,0,270);return image.available&&image.path?image:null;},{description:'Source thumbnail',timeoutMs:15000});
  assert(thumb.width>64&&thumb.height>32,'Thumbnail is too small to represent the source');
  const rgb=Buffer.from(thumb.sampleRgb||'','base64');assert(rgb.length===6144,'Thumbnail raster is incomplete');let bright=0,chroma=0;for(let i=0;i<rgb.length;i+=3){bright+=Math.max(rgb[i],rgb[i+1],rgb[i+2]);chroma+=Math.max(rgb[i],rgb[i+1],rgb[i+2])-Math.min(rgb[i],rgb[i+1],rgb[i+2]);}assert(bright/2048>40&&chroma/2048>25,'Known colour-plate thumbnail is blank or lacks its coloured bars');
  const out=path.join(s.root,'evidence',id+'-after.png');await mkdir(path.dirname(out),{recursive:true});await copyFile(thumb.path,out);h.retained.set(id,[out]);await observe(id,'thumbnail',{assetId:s.assets.plate,thumbnail:thumb,row});
 });await capture(id,'after-bin',row.view.id,'widget');return {assetId:s.assets.plate,scope:'Cached source thumbnail identity and visible media list; timeline filmstrip and waveform shape remain additional coverage'};
});

await check('D-MEDIA-COLOR-COLUMN',async()=>{
 const id='D-MEDIA-COLOR-COLUMN';await clearSearch();const row=await modelRow('pattern_24.mov');await identity(row,s.assets.plate);
 const column=row.page.headers.findIndex(h=>/colou?r\s*space/i.test(h));if(column<0)throw new OutcomeError('Media model has no identified colour-space column','Blocked');
 const cell=await value(row,column,0),sidecar=await readJSON(path.join(s.bundle,'assets/clips',s.assets.plate+'.json'));
 assert(cell.available&&typeof cell.value==='string'&&/709/.test(cell.value),'Rec.709 fixture colour column is empty or wrong');
 const source=JSON.stringify(sidecar);assert(/709/i.test(source),'Fixture sidecar does not identify the expected Rec.709 source');
 await observe(id,'column',{assetId:s.assets.plate,column,header:row.page.headers[column],cell,sidecar});await capture(id,'after',row.view.id,'widget');return {assetId:s.assets.plate,colour:cell.value};
});

await check('D-TRANSCRIPT-SEARCH',async()=>{
 const id='D-TRANSCRIPT-SEARCH',pid=s.pid;if(!s.plan.speechModel)throw new OutcomeError('Prepare this check with the pinned offline speech model','Blocked');
 const asset=await stage('ingest','Import and transcribe the synthetic spoken fixture','prepare',async()=>{const a=await c('media.import_asset',{path:assetPath('speech')});await ingestFixture(file,[{asset_id:a.asset_id,media_path:assetPath('speech')}],{speech:true});return a.asset_id;});
 const result=await stage('search','Physically search Transcript for silver camera','execute',()=>search('silver camera','Transcript'));
 assert(result.names.includes('comet_report.mov'),'Transcript UI returned the wrong clip');
 // The ordinary GP also contains an intentionally untranscribed tone source.
 // Require exhaustive word-time evidence for the spoken fixture itself; keep
 // the physical UI query project-wide and retain its reported completeness.
 const semantic=await c('search.query',{query:{kind:'text',text:'silver camera'},sources:['transcript'],scope:{kind:'assets',asset_ids:[asset]},include:['excerpt']});await observe(id,'backend',{asset,semantic});
 assert(semantic.completion==='complete'&&!semantic.truncated,'Transcript search incomplete');const hit=semantic.matches.find(m=>m.item_id===asset),e=hit?.evidence.find(e=>e.source==='transcript');assert(e?.match_range&&e.match_range.start_secs<.5&&e.match_range.end_secs>.8&&e.match_range.end_secs<1.5,'Transcript timestamps differ from the known spoken phrase');
 const row=await modelRow('comet_report.mov');await identity(row,asset);
 await observe(id,'search',{pid,asset,result:{names:result.names,status:result.status,rows:result.view.model},semantic});await capture(id,'after',result.view.id,'widget');await clearSearch();same((await readJSON(file)).pid,pid,'Search did not restart Wizard');return {assetId:asset,range:e.match_range,scope:'Physical transcript query with correct asset and backend word range; seek activation is a separate check'};
});

await check('D-INGEST-SEARCH-LIVE',async()=>{
 const id='D-INGEST-SEARCH-LIVE',pid=s.pid,name='fresh-search-'+s.harnessId+'.mov',query=name.replace(/\.mov$/,''),before=await stage('before','Search before importing a uniquely named clip','prepare',()=>search(query));assert(before.names.length===0,'Unique new source already appears in search');await clearSearch();
 const destination=await imported(name),asset=await stage('ingest','Import and ingest the new clip in the same process','execute',async()=>{const a=await c('media.import_asset',{path:destination});await ingestFixture(file,[{asset_id:a.asset_id,media_path:destination}]);return a.asset_id;});
 const after=await stage('search','Repeat the physical search without restarting Wizard','verify',()=>search(query));assert(after.names.includes(name),'Newly ingested source did not appear');
 const row=await modelRow(name),rows=[{id:await identity(row,asset)}];verifySearchIdentity(rows,asset);same((await readJSON(file)).pid,pid,'Live ingest restarted Wizard');await observe(id,'transition',{pid,before:{names:before.names,status:before.status},after:{names:after.names,status:after.status},asset});await capture(id,'after',after.view.id,'widget');await clearSearch();return {pid,assetId:asset,scope:'Filename lane after local source ingest; transcript/embedding live indexing is additional coverage'};
});
finish();
