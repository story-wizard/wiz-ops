import {beginCheck,endCheck} from './check-support.mjs';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {exportDialog} from './export-dialog.mjs';
import {desktopCall,nativeCall} from './adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,pause,same,snapshotState,clips} from '../runner/engine.mjs';
import {readPPM,pixelDifference,pixelStats} from '../runner/pixels.mjs';
const file=process.argv[2],s=await readJSON(file),attempt=String(Date.now()),directory=path.join(s.root,`editor-${attempt}`);
await mkdir(directory);
const report={scope:s.scope,pid:s.pid,generation:s.generation,guiHash:s.guiHash,bridgeHash:s.bridgeHash,cliHash:s.desktopCliHash,results:[]};
const call=(op,params)=>desktopCall(file,op,params),native=(op,params)=>nativeCall(file,op,params),ui=()=>native('inspect');
async function until(fn){for(let i=0;i<100;i++){const v=await fn();if(v)return v;await pause(100);}throw new Error('Expected editor observation did not arrive within ten seconds.');}
async function check(id,fn){if(!await beginCheck(file,id))return;try{report.results.push({id,status:'Pass',evidence:await fn()});}catch(e){report.results.push({id,status:e.status||'Fail',error:e.message});if(e.status==='Unknown'){await writeJSON(path.join(directory,'report.json'),report);await endCheck(file,report.results.at(-1));throw e;}}await writeJSON(path.join(directory,'report.json'),report);await endCheck(file,report.results.at(-1));}
async function focusTimeline(){const u=await ui();await native('activate',{target:u.widgets.find(w=>w.class==='MainWindow').id});await until(async()=>(await ui()).widgets.some(w=>w.class==='MainWindow'&&w.active));return (await ui()).widgets.filter(w=>w.class==='TimelineWidget').sort((a,b)=>a.y-b.y)[0];}
async function frame(label,timeline=s.main.id){const output=path.join(directory,label+'.ppm');await call('render.export_still',{timeline_id:timeline,time:{value:24,rate:24},output});const image=await readPPM(output);assert(image.width===1920&&image.height===1080,'Wrong rendered raster');return image;}
await call('render.bind_timeline',{timeline_id:s.main.id,playhead_frame:0});
await check('D-EDIT-CLIPBOARD',async()=>{
  const before=await call('timeline.inspect',{timeline_id:s.main.id}),v=await focusTimeline();
  // ponytail: fixed hit point for this GP and default layout; replace with clip geometry hooks when layouts vary.
  await native('click',{target:v.id,x:25,y:115});await native('clipboard-save');let restored;
  try{
    await native('key',{target:v.id,key:'Ctrl+C'});await pause(100);const clipboard=await native('clipboard-mark');
    assert(clipboard.formats.includes('application/x-wizard-timeline-clips'),'Copy did not publish Wizard clips');
    const at=before.timeline.duration_seconds;await call('playback.seek',{time:at});await native('key',{target:v.id,key:'Ctrl+V'});
    const after=await until(async()=>{const a=await call('timeline.inspect',{timeline_id:s.main.id});return clips(a).length===clips(before).length+1?a:null;});
    const added=clips(after).filter(c=>!clips(before).some(b=>b.clip_id===c.clip_id));assert(added.length===1,'Paste did not create one independent clip');const original=clips(before).find(c=>c.clip_id===s.clip);
    same(added[0].source,original.source,'Pasted source');same(added[0].timeline_range,{start_seconds:at,end_seconds:at+4},'Pasted placement');
    await native('key',{target:v.id,key:'Ctrl+Z'});await until(async()=>{const a=await call('timeline.inspect',{timeline_id:s.main.id});return clips(a).length===clips(before).length;});same(snapshotState(await call('timeline.inspect',{timeline_id:s.main.id})),snapshotState(before),'Undo paste');
    return {original:original.clip_id,pasted:added[0].clip_id,mime:clipboard.formats,undoRestored:true};
  }finally{restored=await native('clipboard-restore');await writeJSON(path.join(directory,'clipboard-restoration.json'),restored);assert(restored.restored,'Clipboard changed externally; original was not restored');}
});
await check('D-INSPECTOR-01',async()=>{
  const v=await focusTimeline();await native('click',{target:v.id,x:25,y:115});let u=await ui();if(!u.widgets.some(w=>w.class==='ads::CFloatingDockContainer'&&w.title==='Inspector'))await native('action',{target:u.actions.find(a=>a.text==='Inspector').id});
  u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='InspectorSectionHeading'&&w.text==='Transform 2D')?a:null;});
  if(!u.widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Position X')){const h=u.widgets.find(w=>w.name==='InspectorSectionHeading'&&w.text==='Transform 2D');await native('click',{target:u.widgets.find(w=>w.name==='InspectorSectionDisclosure'&&w.window===h.window&&w.y===h.y).id});}
  u=await ui();const label=u.widgets.find(w=>w.name==='InspectorParamLabel'&&w.text==='Position X'),slider=u.widgets.find(w=>w.name==='InspectorSliderControl'&&w.window===label.window&&Math.abs(w.y-label.y)<5);
  await native('activate',{target:label.window});
  const graph=()=>call('graph.get_clip_graph',{timeline_id:s.main.id,clip_id:s.clip});const before=await graph(),node=before.nodes.find(n=>n.params?.position_x!==undefined),original=await frame('inspector-before');
  await native('key',{target:slider.id,key:'Right'});const after=await until(async()=>{const g=await graph();return g.nodes.find(n=>n.node_id===node.node_id).params.position_x===node.params.position_x+1?g:null;});
  const delta=pixelDifference(original,await frame('inspector-after'));assert(delta>0.01,'Inspector edit did not change rendered pixels');
  u=await ui();const l=u.widgets.find(w=>w.name==='InspectorParamLabel'&&w.text==='Position X');await native('click',{target:u.widgets.find(w=>w.name==='InspectorResetButton'&&w.window===l.window&&Math.abs(w.y-l.y)<5).id});await pause(100);
  same((await graph()).nodes.find(n=>n.node_id===node.node_id).params,node.params,'Reset parameters');const resetDelta=pixelDifference(original,await frame('inspector-reset'));assert(resetDelta===0,'Reset did not restore pixels');return {positionBefore:node.params.position_x,positionAfter:after.nodes.find(n=>n.node_id===node.node_id).params.position_x,delta,resetDelta};
});
await check('D-EXPORT-01',async()=>{await focusTimeline();return exportDialog({s,n:native,ui,until},path.join(directory,'export.mp4'));});
await check('D-MGFX-01',async()=>{
  const d=await call('generate.renderers',{detail:'full'}),p=d.profile,t=await call('timeline.create',{name:`Local MGFX ${attempt}`,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),source=`.wiz/generate/staging/smoke-${attempt}`;
  const adapter=d.renderers.find(r=>r.id==='web').adapters.find(a=>a.id==='hyperframes');assert(adapter.contract.execution.network==='disabled','MGFX must be local');const scaffold=adapter.contract.entry.scaffold.find(f=>f.path==='src/index.html').content.replace('<body>','<body style="margin:0;background:#ff0000">');await mkdir(path.join(s.bundle,source,'src'),{recursive:true});await writeFile(path.join(s.bundle,source,'src/index.html'),scaffold);
  const g=await call('generate.graphics',{renderer:{id:'web',adapter:'hyperframes'},content:{source_path:source,entry:'src/index.html'},parameters:{profile_id:p.profile_id,profile_version:p.profile_version,profile_hash:p.profile_hash,descriptors:[{param_path:'title.text',param_type:'string',default_value:'Synthetic smoke title',display_label:'Title'}],initial_values:{}},label:'Synthetic smoke title',render:{duration_frames:48,width:1920,height:1080,fps:{num:24,den:1}},destination:{kind:'timeline',timeline_id:t.timeline_id,at:{offset_seconds:0},fit:{mode:'fit_to_timeline'},overlap:'reject'}});
  assert(g.destination.state==='committed','MGFX placement did not commit');const original=await frame('mgfx-before',t.timeline_id);assert(pixelStats(original).max>100,'MGFX frame is blank');const target={kind:'generation',generation_id:g.generation.generation_id},before=await call('generate.inspect',{target});
  await call('generate.set_params',{target,expected_owner_revision:before.owner_revision,expected_params_revision:before.params_rev,values:{'title.text':'CHANGED SMOKE TITLE 123456789'},reset:[]});const after=await call('generate.inspect',{target});assert(after.parameters.find(p=>p.descriptor.param_path==='title.text').value==='CHANGED SMOKE TITLE 123456789','MGFX title was not retained');const delta=pixelDifference(original,await frame('mgfx-after',t.timeline_id));assert(delta>0.01,'MGFX title did not change pixels');return {generationId:g.generation.generation_id,timeline:t.timeline_id,pixelDelta:delta,network:'disabled'};
});
report.completed=true;await writeJSON(path.join(s.root,'desktop-editor-report.json'),report);console.log(JSON.stringify(report,null,2));if(report.results.some(r=>r.status!=='Pass'))process.exitCode=1;
