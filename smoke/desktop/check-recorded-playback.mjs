import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {uiWorkflows} from './ui-workflows.mjs';
import {recordPresented,verifyPlaybackRecording} from './recorder.mjs';
import {ingestFixture} from './ingest-fixture.mjs';
import {assert,same,snapshotState,clips,OutcomeError,command} from '../runner/engine.mjs';
const file=process.argv[2],h=await uiWorkflows(file,'desktop-recorded-playback-report.json');
const {s,n,c,ui,until,check,stage,physical,observe,capture,unique,click,action,openTimeline,selectClip,finish}=h;

async function fixture(name,{graded=false}={}){
 const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),track=t.tracks.find(t=>t.kind==='video').track_id;
 await c('timeline.place_cuts',{id:'recorded-playback-fixture',timeline_id:t.timeline_id,cuts:Array.from({length:8},(_,i)=>({id:'cut-'+i,source:{asset_id:s.assets.plate},source_range:{start_seconds:0,end_seconds:8},streams:'video_only',destination:{at:{seconds:i*8,track}}}))});
 const before=await c('timeline.inspect',{timeline_id:t.timeline_id}),f={id:t.timeline_id,before,scope:{timeline_id:t.timeline_id,clip_id:clips(before)[0].clip_id}};
 if(graded)for(const clip of clips(before)){
  const scope={timeline_id:f.id,clip_id:clip.clip_id},g=await c('graph.get_clip_graph',scope),composite=g.nodes.find(n=>n.type==='composite'),edge=g.edges.find(e=>e.to_node===composite?.node_id);assert(edge,'Graded fixture has no composite input');
  // This package reports the timeline's projected revision even for a fresh
  // clip whose edit gate is clip-local. Fixture setup is serialized under the
  // owned bundle revision gate; verify every created graph before playback.
  const effects=[{type:'wiz.color.grading_primary',params:{'grade.primary.saturation':.8}},{type:'wiz.color.balance_group',params:{'balance.grade.exposure_contrast.exposure':.2}},{type:'gaussian_blur',params:{radius:2}}];
  await c('graph.edit_batch',{...scope,ops:effects.map((effect,i)=>({op:'insert_on_edge',local_ref:-i-1,...effect,...(i?{from_local_ref:-i,from_slot:'output'}:{from_node:edge.from_node,from_slot:edge.from_slot}),to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output'}))});
  const built=await c('graph.get_clip_graph',scope);assert(effects.every(effect=>built.nodes.some(n=>n.type===effect.type))&&built.nodes.length===g.nodes.length+3,'Atomic graded fixture is incomplete');
 }
 f.view=await openTimeline(name);await selectClip(f);f.preview=unique(await ui(),w=>w.class==='MetalPreviewWidget','Recorded playback preview');f.graph=await c('graph.get_clip_graph',f.scope);return f;
}
async function transportButton(){return unique(await ui(),w=>w.name==='previewPlayPauseButton'&&w.enabled,'Preview Play/Pause');}
async function toggle(f){if(f)await physical('key',{target:f.inputTarget||f.view.id,key:'space'});else await click(await transportButton());}
async function play(f){await c('playback.seek',{time:0});await toggle(f);await until(async()=>{const t=await c('playback.query_transport');return t.playing&&t.frame>0?t:null;},{description:'Physical playback advances'});}
async function stop(f){if(!(await c('playback.query_transport')).playing)return;await toggle(f);await until(async()=>!(await c('playback.query_transport')).playing,{description:'Physical pause'});}
async function recording(id,f,onSample){const r=await recordPresented(file,{target:f.preview.id,timelineTarget:f.view.id,timelineId:f.id,durationMs:12000,intervalMs:1000,maxSamples:8},onSample);h.retained.set(id,[...(h.retained.get(id)||[]),...r.artifacts]);return r;}

await check('D-INSPECTOR-PLAYBACK',async()=>{
 const id='D-INSPECTOR-PLAYBACK',f=await stage('setup','Prepare eight clips with six-node graded graphs','prepare',()=>fixture(id,{graded:true}));
 await stage('inspector','Select the blur node and open its real Inspector','prepare',async()=>{
  assert(f.graph.nodes.length>=6,'Inspector fixture is not a six-node graph');const node=f.graph.nodes.find(n=>n.type==='gaussian_blur');assert(node,'Inspector blur missing');if(!(await ui()).widgets.some(w=>w.class==='RenderGraphView'&&w.timelineId===f.id))await action('Render Graph');
  // The visible scene is clip-scoped; CLI graph_id names its parent timeline
  // graph. Bind the actual clip scene identity and its independently read nodes.
  const sceneId='clip:'+f.id+':'+f.scope.clip_id;
  let view=unique(await ui(),w=>w.class==='RenderGraphView'&&w.timelineId===f.id&&w.graphId===sceneId,'Fixture render graph');const fit=unique(await ui(),w=>w.window===view.window&&w.tooltip==='Fit all','Fit graph');await n('click',{target:fit.id});view=unique(await ui(),w=>w.id===view.id,'Fixture render graph');const rect=view.sceneItems.find(x=>x.nodeId===node.node_id);assert(rect,'Blur geometry missing');await physical('click',{target:view.viewport,x:rect.x+rect.width/2,y:rect.y+Math.min(8,rect.height/2)});
  await until(async()=>(await ui()).widgets.find(w=>w.id===view.id)?.sceneItems.some(x=>x.nodeId===node.node_id&&x.selected));if(!(await ui()).widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Radius'))await action('Inspector');await until(async()=>(await ui()).widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Radius'));
  // Activating the Timeline dock changes the Inspector owner to clip context.
  // Keep the selected node owner and send the global shortcut through its window.
  const current=await ui();f.inputTarget=unique(current,w=>w.class==='InspectorPanel','Selected node Inspector').id;f.view=unique(current,w=>w.class==='TimelineWidget'&&w.clipIds?.includes(f.scope.clip_id),'Recorded fixture video canvas');
  if(!current.widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Radius'))throw new OutcomeError('The blur Inspector was lost during fixture setup','Blocked');
 });
 let uncertain=false;try{
  await stage('play','Start playback using Space in the selected node Inspector window','execute',()=>play(f));const recorded=await stage('record','Collect presented motion, transport and resource samples','verify',()=>recording(id,f,async()=>assert((await ui()).widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Radius'),'Inspector disappeared during a playback sample')));
  const proof=verifyPlaybackRecording(recorded);assert((await ui()).widgets.some(w=>w.name==='InspectorParamLabel'&&w.text==='Radius'),'Inspector disappeared during playback');same(snapshotState(await c('timeline.inspect',{timeline_id:f.id})),snapshotState(f.before),'Playback preserves timeline');const graph=await c('graph.get_clip_graph',f.scope);same({nodes:graph.nodes,edges:graph.edges},{nodes:f.graph.nodes,edges:f.graph.edges},'Inspector playback preserves grade graph');await observe(id,'after',{proof,graph,binding:recorded.binding});await capture(id,'after',f.preview.id);return {...proof,scope:'Visible Inspector on a six-node graded graph with advancing presented playback. Every-frame/drop counts and comparison baselines remain separate.'};
 }catch(e){uncertain=e.status==='Unknown';throw e;}finally{if(!uncertain)await stage('pause','Pause playback physically','cleanup',()=>stop(f));}
});

await check('D-INGEST-PLAYBACK',async()=>{
 const id='D-INGEST-PLAYBACK',f=await stage('setup','Prepare playback and sixteen four-minute synthetic audio sources','prepare',()=>fixture(id)),assets=[];await mkdir(path.join(s.root,'background-media'),{recursive:true});
 const source=path.join(s.root,'background-media','background-0.wav');
 const generated=await command(path.join(s.app,'Contents/MacOS/ffmpeg'),['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','240','-c:a','pcm_s16le','-ac','2','-threads','2',source],{env:s.env,cwd:s.root,timeout:15000});assert(generated.code===0&&!generated.timedOut,'Background tone generation failed');await observe(id,'fixture-source',{generated,durationSeconds:240,count:16});
 for(let i=0;i<16;i++){const media_path=path.join(s.root,'background-media','background-'+i+'.wav');if(i)await copyFile(source,media_path);const a=await c('media.import_asset',{path:media_path});assets.push({asset_id:a.asset_id,media_path});}
 let work,interval,uncertain=false;
 try{
  await stage('play','Start physical playback before submitting local ingest','execute',play);
  const recorded=await stage('concurrent','Run the packaged ingest worker while recording playback','execute',async()=>{
   work=ingestFixture(file,assets,{audioAnalysis:true,onStarted:value=>{interval=value;},onFinished:value=>{Object.assign(interval,value);}});work.catch(()=>{});return recording(id,f);
  });
  const ingest=await work;await observe(id,'worker-after',{interval,ingest,assets});assert(ingest.summary?.operations_run?.filter(x=>x.operation==='audio_analyze'&&x.status==='ok').length===assets.length,'Requested audio analysis did not complete for every source');const overlap=recorded.samples.filter(x=>x.startedAt>=interval.startedAt&&x.finishedAt<=interval.finishedAt);if(overlap.length<3)throw new OutcomeError('The local workload finished before three complete playback samples overlapped; increase the bounded fixture','Blocked');
  const proof=verifyPlaybackRecording(recorded,{overlap:interval});same(snapshotState(await c('timeline.inspect',{timeline_id:f.id})),snapshotState(f.before),'Concurrent ingest preserves playback timeline');await capture(id,'after',f.preview.id);return {...proof,worker:interval,ingested:assets.length,scope:'Packaged offline source ingest concurrent with physical playback. Actual Oz conversation routing and transcript/embedding/provider workloads remain separate.'};
 }catch(e){uncertain=e.status==='Unknown';throw e;}finally{if(work)await work.catch(()=>{});if(!uncertain)await stage('pause','Pause playback physically','cleanup',stop);}
});
finish();
