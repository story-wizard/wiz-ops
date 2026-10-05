import path from 'node:path';
import {checks,gapFixture,twentyCutFixture,widgetPixelDifference,verifyLoopSamples} from './check-support.mjs';
import {writeJSON} from '../runner/files.mjs';
import {assert,near,pause,OutcomeError} from '../runner/engine.mjs';
import {waitForPreview} from './recorder.mjs';
import {physicalInput} from './physical-input.mjs';
const {s,n,c,ui,until,check,openTimeline,activate,finish}=await checks(process.argv[2],'desktop-playback-report.json');
let v;const key=k=>n('key',{target:v.id,key:k}),transport=()=>c('playback.query_transport');
const rasterStats=image=>{widgetPixelDifference(image,image);const rgb=Buffer.from(image.sampleRgb,'base64');let chroma=0;for(let i=0;i<rgb.length;i+=3)chroma+=Math.max(...rgb.subarray(i,i+3))-Math.min(...rgb.subarray(i,i+3));return {brightness:rgb.reduce((a,b)=>a+b,0)/rgb.length,chroma:chroma/(rgb.length/3)};};
async function captureAt(q,accept){const preview=(await ui()).widgets.find(w=>w.class==='MetalPreviewWidget');assert(preview,'Metal preview unavailable');return waitForPreview(process.argv[2],{target:preview.id,frame:q.frame,playbackGeneration:q.playback_generation},accept);}
async function seekReference(seconds,predicate){await c('playback.seek',{time:seconds});const q=await until(async()=>{const t=await transport();return !t.playing&&!t.scrubbing&&Math.abs(t.time-seconds)<.01?t:null;});let previous;return captureAt(q,image=>{const stable=previous&&widgetPixelDifference(previous,image)<1.5;previous=image;return stable&&predicate(image);});}
async function scrub(seconds){await activate(v);const bar=(await ui()).widgets.find(w=>w.name==='previewScrubBar');assert(bar?.handle&&bar.groove,'Scrub handle geometry unavailable');const x=Math.round(bar.groove[0]+bar.groove[2]*(seconds*1000-bar.minimum)/(bar.maximum-bar.minimum));await physicalInput(process.argv[2],'drag',{target:bar.id,x:bar.handle[0],y:bar.handle[1],toX:x,toY:bar.handle[1],durationMs:400});return until(async()=>{const t=await transport();return !t.playing&&!t.scrubbing&&Math.abs(t.time-seconds)<.1?t:null;});}
await check('D-PREVIEW-SCRUB',async()=>{
 const baseline=await gapFixture(c,s.assets,'Preview scrub smoke');await writeJSON(path.join(s.root,'preview-scrub-baseline.json'),baseline);v=await openTimeline(baseline.timeline.name);
 const references={};try{
  // Freeze moving-frame neighbours before the gesture. One-frame pointer
  // quantization must compare the landed frame, not a different movie frame.
  for(const frame of [23,24,25,120,167,168,169])references[frame]=await seekReference(frame/24,image=>frame===120?rasterStats(image).brightness<3:rasterStats(image).brightness>5);
  assert(widgetPixelDifference(references[24].image,references[120].image)>20&&widgetPixelDifference(references[168].image,references[120].image)>20,'Frame and alternate-gap references indistinguishable');
 }catch(e){e.message='Scrub reference setup: '+e.message;if(e.status!=='Unknown')e.status='Blocked';e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...Object.values(references).flatMap(r=>r.artifacts)]};throw e;}
 const observations=[];for(const at of [1,5,7,1]){const q=await scrub(at);assert(Math.abs(q.time-at)<=1/24+.001,'Scrub landed more than one frame from pointer target');const reference=references[at===5?120:q.frame];assert(reference,'Landed preview frame has no frozen reference');const a=await captureAt(q,image=>widgetPixelDifference(image,reference.image)<1.5);observations.push({requested:at,transport:q,reference:reference.image.path,readiness:a.manifest,pixelDelta:widgetPixelDifference(a.image,reference.image),image:a.image});await writeJSON(path.join(s.root,'preview-scrub-observations.json'),observations);}return {targets:[1,5,7,1],frames:observations.map(x=>x.transport.frame),deltas:observations.map(x=>x.pixelDelta),artifacts:[...Object.values(references).flatMap(r=>r.artifacts),...observations.flatMap(x=>[x.readiness,x.image.path])],scope:'Physical scrubber drag; two fresh compositor captures match the landed-frame reference sought before testing. Stopped transport brackets each capture. Six seconds is an observation budget; pointer landing allows one-frame quantization.'};
});
await check('D-PLAYBACK-INOUT',async()=>{v=await openTimeline((await c('timeline.inspect',{timeline_id:s.main.id})).timeline.name);await activate(v);try{await c('playback.seek',{time:1});await key('I');await until(async()=>(await ui()).widgets.find(w=>w.name==='previewMarkInButton')?.checked);await c('playback.seek',{time:3});await key('O');await until(async()=>(await ui()).widgets.find(w=>w.name==='previewMarkOutButton')?.checked);await key('Shift+I');await until(async()=>(await transport()).frame===24);await key('Shift+O');await until(async()=>(await transport()).frame===73);return {inFrame:24,outExclusiveFrame:73};}finally{await key('Alt+X');await until(async()=>!(await ui()).widgets.some(w=>['previewMarkInButton','previewMarkOutButton'].includes(w.name)&&w.checked));}});
await check('D-PLAYBACK-LOOP',async()=>{
 v=await openTimeline((await c('timeline.inspect',{timeline_id:s.main.id})).timeline.name);await activate(v);const samples=[],observations=path.join(s.root,'loop-observations.json');let uncertain=false;
 try{
  await c('playback.pause');await c('playback.seek',{time:1});await key('I');await until(async()=>(await ui()).widgets.find(w=>w.name==='previewMarkInButton')?.checked);
  await c('playback.seek',{time:2});await key('O');await until(async()=>(await ui()).widgets.find(w=>w.name==='previewMarkOutButton')?.checked);
  // The app's shortcut registry owns Loop Playback In to Out; it need not be a QAction.
  await key('Ctrl+L');await until(async()=>{const t=await transport();return t.playing?t:null;},{description:'Marked-range loop starts playback'});const deadline=Date.now()+6000;
  do{samples.push(await transport());await writeJSON(observations,{shortcut:'Ctrl+L',inFrame:24,outFrame:49,samples});await pause(100);}while(Date.now()<deadline);
  const measurement=verifyLoopSamples(samples,24,49);return {shortcut:'Ctrl+L',observations,measurement,scope:'Marked-range keyboard loop with transport advancement and two observed wraps'};
 }catch(e){uncertain=e.status==='Unknown';throw e;}
 finally{if(!uncertain){await c('playback.pause');await key('Alt+X');await until(async()=>!(await ui()).widgets.some(w=>['previewMarkInButton','previewMarkOutButton'].includes(w.name)&&w.checked));}}
});
await check('D-SCRUB-CUTS',async()=>{
 try{
 await twentyCutFixture(c,s.assets,'Twenty-cut scrub smoke',fixture=>writeJSON(path.join(s.root,'scrub-cuts-fixture.json'),fixture));
 }catch(e){const failure=new OutcomeError('Twenty-cut fixture setup: '+e.message,e.status==='Unknown'?'Unknown':'Blocked');failure.diagnostics={...e.diagnostics,phase:'prepare',testedAction:'Not run',operations:path.join(s.root,'operations.jsonl')};throw failure;}
 v=await openTimeline('Twenty-cut scrub smoke');const refs=[];for(const at of [.5,1.5])refs.push(await seekReference(at,image=>{const m=rasterStats(image);return m.brightness>20&&(at===1.5?m.chroma<3:m.chroma>50);}));assert(widgetPixelDifference(refs[0].image,refs[1].image)>20,'Alternating clip references must differ');const observations=[];
 for(const index of [0,19,4,17,8,1,18,3]){const q=await scrub(index+.5),actual=await captureAt(q,image=>{const m=rasterStats(image);return m.brightness>20&&(index%2?m.chroma<3:m.chroma>50);});const {chroma,brightness}=rasterStats(actual.image);observations.push({index,frame:q.frame,chroma,brightness,capture:actual.image.path,readiness:actual.manifest});await writeJSON(path.join(s.root,'scrub-cuts-observed.json'),observations);}return {clips:20,order:observations,artifacts:[...refs.flatMap(r=>r.artifacts),...observations.flatMap(x=>[x.capture,x.readiness])],scope:'Physical jumps across cuts, requiring two fresh matching gray/colour observations and stopped bracketed transport.'};
});
await openTimeline((await c('timeline.inspect',{timeline_id:s.main.id})).timeline.name);
finish();
