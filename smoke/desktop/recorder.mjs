import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {assert,command,pause,clips,same} from '../runner/engine.mjs';
import {verifyDesktopOwner,nativeCall,desktopCall} from './adapter.mjs';
import {physicalInput} from './physical-input.mjs';
import {cpuSeconds} from './check-idle.mjs';
import {widgetPixelDifference,waitForObservation} from './check-support.mjs';

// Fresh compositor capture is not an acknowledgement of a particular renderer frame.
export async function capturePresented(file,target){
 const s=await readJSON(file);verifyDesktopOwner(s);
 const startedAt=Date.now(),transportBefore=await desktopCall(file,'playback.query_transport'),image=await physicalInput(file,'screenshot',{target,crop:true}),transportAfter=await desktopCall(file,'playback.query_transport');
 const current=await readJSON(file);verifyDesktopOwner(current);
 same({pid:current.pid,started:current.processStart,generation:current.generation},{pid:s.pid,started:s.processStart,generation:s.generation},'Capture process generation');
 assert(image.pid===s.pid&&image.started===s.processStart&&image.capture?.frameStatus==='complete'&&Number.isFinite(image.capture.requestedTick)&&Number.isFinite(image.capture.displayedTick)&&image.capture.displayedTick>image.capture.requestedTick,'Capture is stale, incomplete or from another process');
 return {startedAt,finishedAt:Date.now(),transportBefore,transportAfter,image};
}
export function previewTransportMatches(sample,{frame,playbackGeneration}){
 return [sample.transportBefore,sample.transportAfter].every(t=>t&&t.frame===frame&&t.playback_generation===playbackGeneration&&t.playing===false&&t.scrubbing===false);
}
export async function waitForPreview(file,{target,frame,playbackGeneration,timeoutMs=6000},accept){
 assert(typeof target==='string'&&target.length>0&&Number.isInteger(frame)&&frame>=0&&Number.isInteger(playbackGeneration)&&playbackGeneration>=0&&Number.isInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=15000&&typeof accept==='function','Bind a stopped preview frame and a bounded pixel predicate');
 const s=await readJSON(file);verifyDesktopOwner(s);
 const root=path.join(s.root,'evidence','preview-'+randomUUID());await mkdir(root,{recursive:true});
 const manifest=path.join(root,'graph-observations-preview-after.json'),report={format:'athanor-preview-readiness/v1',expected:{target,frame,playbackGeneration},timeoutMs,samples:[],artifacts:[manifest],scope:'Fresh compositor captures bracketed by stopped logical transport; the check supplies the independent pixel predicate.'};
 const started=performance.now();let consecutive=0;
 try{
  const result=await waitForObservation(async()=>{
   const sample=await capturePresented(file,target),output=path.join(root,'frame-'+report.samples.length+'.png');await copyFile(sample.image.output,output);
   sample.image={...sample.image,output,path:output,sha256:await sha(output)};sample.elapsedMs=performance.now()-started;
   sample.transportMatches=previewTransportMatches(sample,report.expected);sample.accepted=sample.transportMatches?Boolean(await accept(sample.image,sample)):false;
   consecutive=sample.accepted?consecutive+1:0;report.samples.push(sample);report.artifacts.push(output);await writeJSON(manifest,report);
   return consecutive>=2?sample:false;
  },{description:'Expected displayed preview at logical frame '+frame,timeoutMs,intervalMs:50});
  report.complete=true;return {...result,manifest,artifacts:report.artifacts};
 }catch(e){report.error={message:e.message,status:e.status||'Fail',diagnostics:e.diagnostics||null};e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...report.artifacts]};throw e;}
 finally{report.elapsedMs=performance.now()-started;await writeJSON(manifest,report);}
}

export function recordingOptions({durationMs=12000,intervalMs=1000,maxSamples=8,...extra}={}){
 assert(!Object.keys(extra).length,'Unknown recording option');
 assert(Number.isInteger(durationMs)&&durationMs>=1000&&durationMs<=60000,'Recording duration must be 1–60 seconds');
 assert(Number.isInteger(intervalMs)&&intervalMs>=500&&intervalMs<=10000,'Recording interval must be 500–10000 ms');
 assert(Number.isInteger(maxSamples)&&maxSamples>=3&&maxSamples<=32,'Recording sample budget must be 3–32');
 return {durationMs,intervalMs,maxSamples};
}

// Sampled evidence, with real gaps retained. This is not a frame-drop counter.
export async function recordPresented(file,{target,timelineTarget,timelineId,durationMs,intervalMs,maxSamples}={},onSample=async()=>{}){
 const options=recordingOptions({durationMs,intervalMs,maxSamples}),s=await readJSON(file);verifyDesktopOwner(s);
 assert(typeof target==='string'&&typeof timelineTarget==='string'&&typeof timelineId==='string','Bind a preview, timeline canvas and timeline identity');
 const before=await desktopCall(file,'timeline.inspect',{timeline_id:timelineId}),ids=clips(before).map(c=>c.clip_id).sort(),initial=await nativeCall(file,'inspect');
 const view=initial.widgets.find(w=>w.id===timelineTarget&&w.class==='TimelineWidget'),preview=initial.widgets.find(w=>w.id===target&&w.class==='MetalPreviewWidget');
 assert(view&&preview&&!view.clipIdsTruncated,'Recording surfaces are unavailable or incomplete');same(view.clipIds,ids,'Recording canvas identity');
 const root=path.join(s.root,'evidence','recording-'+randomUUID());await mkdir(root,{recursive:true});
 const report={format:'athanor-presented-recording/v1',binding:{pid:s.pid,started:s.processStart,generation:s.generation,packageHash:s.guiHash,timelineId,timelineTarget,target},options,samples:[],artifacts:[],scope:'Sampled compositor frames, bracketed transport and owned-process CPU/RSS. Sampling cost is retained; audio and every-frame/drop-rate measurement require separate collectors.'},started=performance.now(),origin=Date.now();
 const manifest=path.join(root,'graph-observations-recording-after.json');report.artifacts.push(manifest);
 try{
  while(report.samples.length<options.maxSamples&&performance.now()-started<options.durationMs){
   const current=await readJSON(file);verifyDesktopOwner(current);same({pid:current.pid,started:current.processStart,generation:current.generation},{pid:s.pid,started:s.processStart,generation:s.generation},'Recorder process generation');
   const u=await nativeCall(file,'inspect',{target:timelineTarget}),canvas=u.widgets.find(w=>w.id===timelineTarget&&w.window===view.window);assert(canvas&&!canvas.clipIdsTruncated,'Recording canvas is no longer visible');same(canvas.clipIds,ids,'Recording canvas still contains the frozen clips');
   const captured=await capturePresented(file,target),{transportBefore,image,transportAfter}=captured;
   const resource=await command('/bin/ps',['-p',String(s.pid),'-o','time=','-o','rss='],{timeout:3000}),values=resource.stdout.trim().split(/\s+/);assert(resource.code===0&&values.length===2,'Recorder process metrics are unavailable');
   const output=path.join(root,'frame-'+report.samples.length+'.png');await copyFile(image.output,output);report.artifacts.push(output);
   const sample={...captured,finishedAt:Date.now(),elapsedMs:performance.now()-started,transportBefore,transportAfter,image:{...image,output,sha256:await sha(output)},resources:{cpuSeconds:cpuSeconds(values[0]),rssKiB:Number(values[1])}};
   sample.observationCostMs=sample.finishedAt-sample.startedAt;report.samples.push(sample);await writeJSON(manifest,report);await onSample(sample);
   await pause(Math.min(Math.max(0,options.intervalMs-sample.observationCostMs),Math.max(0,options.durationMs-(performance.now()-started))));
  }
  assert(report.samples.length>=3,'Recording has fewer than three complete samples');
  const lines=report.samples.flatMap((x,i)=>['file \'frame-'+i+'.png\'',...(i<report.samples.length-1?['duration '+((report.samples[i+1].startedAt-x.startedAt)/1000).toFixed(6)]:[])]);await writeFile(path.join(root,'frames.concat'),lines.join('\n')+'\n');
  const video=path.join(root,'sampled-playback-after.mp4'),encoded=await command(path.join(s.app,'Contents/MacOS/ffmpeg'),['-hide_banner','-loglevel','error','-nostdin','-f','concat','-safe','0','-i',path.join(root,'frames.concat'),'-vf','scale=w=ceil(iw/2)*2:h=ceil(ih/2)*2','-fps_mode','vfr','-c:v','libopenh264','-pix_fmt','yuv420p','-threads','2',video],{env:s.env,cwd:root,timeout:15000});
  report.video={path:video,kind:'Sampled preview with original sample intervals',conversion:'OpenH264 / yuv420p; dimensions rounded up to even pixels. Original PNGs retained.',receipt:encoded};assert(encoded.code===0&&!encoded.timedOut,'Sampled video encoding failed: '+encoded.stderr);report.artifacts.push(video);report.complete=true;
 }catch(e){report.error={message:e.message,status:e.status||'Fail'};e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...report.artifacts]};throw e;}
 finally{report.startedAt=new Date(origin).toISOString();report.finishedAt=new Date().toISOString();report.elapsedMs=performance.now()-started;report.totalObservationCostMs=report.samples.reduce((n,x)=>n+x.observationCostMs,0);await writeJSON(manifest,report);}
 return report;
}

export function verifyPlaybackRecording(recording,{overlap}={}){
 assert(recording.complete&&recording.samples.length>=3,'Playback recording is incomplete');
 const samples=recording.samples;let previous=-1,evolving=0;
 for(const [i,x] of samples.entries()){
  assert(x.startedAt<=x.finishedAt&&(!i||x.startedAt>=samples[i-1].finishedAt),'Recording timestamps are unordered');
  assert(x.image.pid===recording.binding.pid&&x.image.started===recording.binding.started&&x.image.capture?.frameStatus==='complete'&&x.image.capture.displayedTick>x.image.capture.requestedTick,'Recording frame is stale or belongs to another process');
  assert(x.transportBefore.playing&&x.transportAfter.playing&&x.transportAfter.frame>=x.transportBefore.frame&&x.transportBefore.frame>previous,'Playback stopped or failed to advance between samples');previous=x.transportAfter.frame;
  const rgb=Buffer.from(x.image.sampleRgb||'','base64');assert(rgb.length===6144&&rgb.reduce((n,v)=>n+v,0)/rgb.length>5,'Recording preview is blank or incomplete');
  assert(Number.isFinite(x.resources.cpuSeconds)&&x.resources.cpuSeconds>=0&&Number.isFinite(x.resources.rssKiB)&&x.resources.rssKiB>0,'Invalid resource observation');
  if(i){assert(x.resources.cpuSeconds>=samples[i-1].resources.cpuSeconds,'Process CPU counter moved backwards');if(widgetPixelDifference(x.image,samples[i-1].image)>.1)evolving++;}
 }
 assert(evolving>=2,'Presented playback did not evolve through the observation window');
 let overlappingSamples;if(overlap){assert(Number.isFinite(overlap.startedAt)&&Number.isFinite(overlap.finishedAt)&&overlap.finishedAt>overlap.startedAt,'Background interval is missing');overlappingSamples=samples.filter(x=>x.startedAt>=overlap.startedAt&&x.finishedAt<=overlap.finishedAt).length;assert(overlappingSamples>=3,'Fewer than three complete playback samples overlapped background work');}
 return {samples:samples.length,evolving,firstFrame:samples[0].transportBefore.frame,lastFrame:samples.at(-1).transportAfter.frame,overlappingSamples,observationCostMs:recording.totalObservationCostMs};
}
