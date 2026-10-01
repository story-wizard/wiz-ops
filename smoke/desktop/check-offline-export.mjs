import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checks} from './check-support.mjs';
import {verifyDesktopPaths} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {assert,same,command} from '../runner/engine.mjs';
import {readPPM,pixelStats} from '../runner/pixels.mjs';
export async function exportMovie(s,id,format,codec,{bundle=s.bundle,timelineId=s.main.id,empty=false}={}){
 verifyDesktopPaths(s);assert(s.state==='Stopped','Offline export fixtures require the owned GUI to be stopped');
 const worker=path.join(s.app,'Contents/MacOS/wizard-export-worker'),macos=path.join(s.cliApp,'Contents/MacOS');
  const output=path.join(s.root,id+(format==='prores'?'.mov':'.mp4')),requestFile=path.join(s.root,id+'-request.json'),reportFile=path.join(s.root,id+'-export.json');
  const sample=await command(worker,['--print-sample-request',format,'--project-root',bundle,'--timeline',timelineId,'--output',output],{env:s.env});await writeJSON(path.join(s.root,id+'-sample.json'),sample);assert(sample.code===0&&!sample.timedOut,'Export request preparation failed');const request=JSON.parse(sample.stdout);same(request.frame_range.frame_rate,{numerator:24,denominator:1},'Resolved export rate');const suggestedFrames=request.frame_range.frame_count;
  assert(suggestedFrames===(empty?1:48),'Unexpected export fixture duration');request.frame_range.frame_count=48;await writeJSON(requestFile,request);
  const receipt=await command(worker,['--project-root',bundle,'--request',requestFile,'--report',reportFile,'--progress-stream'],{env:s.env,timeout:90000});await writeJSON(path.join(s.root,id+'-execution.json'),receipt);const report=await readJSON(reportFile);
  assert(!receipt.timedOut&&receipt.code===0&&report.outcome==='succeeded',`Application export failed: ${JSON.stringify(report.diagnostics)}`);assert(report.frames_requested===48&&report.frames_rendered===48&&report.frames_encoded===48&&report.frames_written===48,'Export did not finish every requested frame');
  const probeReceipt=await command(path.join(macos,'ffprobe'),['-v','error','-show_streams','-of','json',output]);assert(probeReceipt.code===0,'Movie cannot be probed');const probe=JSON.parse(probeReceipt.stdout);await writeJSON(path.join(s.root,id+'-probe.json'),probe);const video=probe.streams.find(x=>x.codec_type==='video'),audio=probe.streams.find(x=>x.codec_type==='audio');assert(video?.codec_name===codec&&video.width===1920&&video.height===1080&&video.avg_frame_rate==='24/1'&&video.nb_frames==='48'&&Math.abs(Number(video.duration)-2)<.01,'Movie stream differs from requested contract');assert(format==='prores'?audio?.codec_name?.startsWith('pcm_'):audio?.codec_name==='aac','Movie audio codec differs from requested contract');
  const decoded=path.join(s.root,id+'-decoded.ppm'),decode=await command(path.join(macos,'ffmpeg'),['-v','error','-i',output,'-ss','1','-frames:v','1','-pix_fmt','rgb24',decoded]);assert(decode.code===0,'Export frame cannot be decoded');const pixels=pixelStats(await readPPM(decoded));assert(empty?pixels.max<4:pixels.max-pixels.min>100&&pixels.edgeEnergy>.01,empty?'Empty timeline must export black pixels':'Exported movie frame is blank');return {output,suggestedFrames,workerHash:await sha(worker),frames:48,fps:24,codec,audio:audio.codec_name,pixels,scope:empty?'App-created empty timeline; requested 48 black frames at the resolved rate. Populated unset-rate export is not covered.':'Application worker and decoded output, not Export dialog or calibrated colour agreement'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {s,check,finish}=await checks(process.argv[2],'service-export-report.json');
 await check('S-EXPORT-PRORES',()=>exportMovie(s,'S-EXPORT-PRORES','prores','prores'));
 await check('S-EXPORT-AV1',()=>exportMovie(s,'S-EXPORT-AV1','av1','av1'));finish();
}
