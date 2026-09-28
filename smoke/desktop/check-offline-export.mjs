import path from 'node:path';
import {cp} from 'node:fs/promises';
import {checks} from './check-support.mjs';
import {verifyDesktopPaths} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {assert,same,command,OutcomeError} from '../runner/engine.mjs';
import {readPPM,pixelStats} from '../runner/pixels.mjs';
const {s,check,finish}=await checks(process.argv[2],'service-export-report.json');verifyDesktopPaths(s);assert(s.state==='Stopped','Offline export fixtures require the owned GUI to be stopped');
const worker=path.join(s.app,'Contents/MacOS/wizard-export-worker'),macos=path.join(s.cliApp,'Contents/MacOS');
async function exportMovie(id,format,codec,bundle=s.bundle){
  const output=path.join(s.root,id+(format==='prores'?'.mov':'.mp4')),requestFile=path.join(s.root,id+'-request.json'),reportFile=path.join(s.root,id+'-export.json');
  const sample=await command(worker,['--print-sample-request',format,'--project-root',bundle,'--timeline',s.main.id,'--output',output],{env:s.env});await writeJSON(path.join(s.root,id+'-sample.json'),sample);assert(sample.code===0&&!sample.timedOut,'Export request preparation failed');const request=JSON.parse(sample.stdout);same(request.frame_range.frame_rate,{numerator:24,denominator:1},'Resolved export rate');const suggestedFrames=request.frame_range.frame_count;
  if(bundle!==s.bundle&&suggestedFrames!==48)throw new OutcomeError(`Unset-rate fixture is not ready: application describes ${suggestedFrames} frame(s) for the known eight-second timeline. The earlier probe also returned an incoherent timeline snapshot. Build an unset-rate fixture through supported creation before treating its export as app evidence.`,'Blocked');
  assert(suggestedFrames===48,'Unexpected export fixture duration');request.frame_range.frame_count=48;await writeJSON(requestFile,request);
  const receipt=await command(worker,['--project-root',bundle,'--request',requestFile,'--report',reportFile,'--progress-stream'],{env:s.env,timeout:90000});await writeJSON(path.join(s.root,id+'-execution.json'),receipt);const report=await readJSON(reportFile);
  assert(!receipt.timedOut&&receipt.code===0&&report.outcome==='succeeded',`Application export failed: ${JSON.stringify(report.diagnostics)}`);assert(report.frames_requested===48&&report.frames_rendered===48&&report.frames_encoded===48&&report.frames_written===48,'Export did not finish every requested frame');
  const probeReceipt=await command(path.join(macos,'ffprobe'),['-v','error','-show_streams','-of','json',output]);assert(probeReceipt.code===0,'Movie cannot be probed');const probe=JSON.parse(probeReceipt.stdout);await writeJSON(path.join(s.root,id+'-probe.json'),probe);const video=probe.streams.find(x=>x.codec_type==='video'),audio=probe.streams.find(x=>x.codec_type==='audio');assert(video?.codec_name===codec&&video.width===1920&&video.height===1080&&video.avg_frame_rate==='24/1'&&video.nb_frames==='48'&&Math.abs(Number(video.duration)-2)<.01,'Movie stream differs from requested contract');assert(format==='prores'?audio?.codec_name?.startsWith('pcm_'):audio?.codec_name==='aac','Movie audio codec differs from requested contract');
  const decoded=path.join(s.root,id+'-decoded.ppm'),decode=await command(path.join(macos,'ffmpeg'),['-v','error','-i',output,'-ss','1','-frames:v','1','-pix_fmt','rgb24',decoded]);assert(decode.code===0,'Export frame cannot be decoded');const pixels=pixelStats(await readPPM(decoded));assert(pixels.max-pixels.min>100&&pixels.edgeEnergy>.01,'Exported movie frame is blank');return {output,suggestedFrames,workerHash:await sha(worker),frames:48,fps:24,codec,audio:audio.codec_name,pixels,scope:'Application worker and decoded output, not Export dialog or calibrated colour agreement'};
}
await check('S-EXPORT-PRORES',()=>exportMovie('S-EXPORT-PRORES','prores','prores'));
await check('S-EXPORT-AV1',()=>exportMovie('S-EXPORT-AV1','av1','av1'));
await check('S-EXPORT-UNSET-RATE',async()=>{
  const bundle=path.join(s.root,'unset-rate.wiz');await cp(s.bundle,bundle,{recursive:true});const file=path.join(bundle,'timelines',s.main.id,'timeline.otio'),timeline=await readJSON(file);same(timeline.metadata.wiz.settings.frame_rate,{rate:1,value:24},'Original fixture rate');timeline.metadata.wiz.settings.frame_rate={value:0,rate:1};await writeJSON(file,timeline);same((await readJSON(file)).metadata.wiz.settings.frame_rate,{value:0,rate:1},'Unset fixture on disk');const result=await exportMovie('S-EXPORT-UNSET-RATE','mp4','h264',bundle);same((await readJSON(file)).metadata.wiz.settings.frame_rate,{value:0,rate:1},'Worker must resolve rather than rewrite unset rate');return {...result,fixture:bundle,storedRate:'0/1',resolvedRate:'24/1'};
});finish();
