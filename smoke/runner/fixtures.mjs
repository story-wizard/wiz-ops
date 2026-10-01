import {execFileSync} from 'node:child_process';
import {mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {readJSON,writeJSON,sha,digest} from './files.mjs';

export async function validateFixtures(directory){
  const manifest=await readJSON(path.join(directory,'manifest.json'));
  if(manifest.format!=='wizard-smoke-fixtures/v1'||![1,2,3].includes(manifest.version)||!Array.isArray(manifest.files)||manifest.files.length!==({1:6,2:7,3:8})[manifest.version])throw new Error('Fixture manifest is incomplete or has an unsupported version.');
  if(new Set(manifest.files.map(f=>f.file)).size!==manifest.files.length||new Set(manifest.files.map(f=>f.id)).size!==manifest.files.length)throw new Error('Fixture identities must be unique.');
  if(manifest.files.some(f=>typeof f.id!=='string'||!f.id||typeof f.file!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)))throw new Error('Fixture identity is invalid.');
  for(const f of manifest.files){if(path.basename(f.file)!==f.file||await sha(path.join(directory,f.file))!==f.sha256)throw new Error(`Fixture changed: ${f.file}`);}
  const {sha256,...content}=manifest;if(digest(content)!==sha256)throw new Error('Fixture manifest digest mismatch.');
  return manifest;
}
export async function prepareFixtures(directory,ffmpeg='/opt/homebrew/bin/ffmpeg',ffprobe='/opt/homebrew/bin/ffprobe',{includeSpeech=true}={}){
  try{await access(path.join(directory,'manifest.json'));const existing=await validateFixtures(directory);return !includeSpeech||existing.version===3?existing:existing.version===2?await addSpeechVideo(directory,existing,ffmpeg,ffprobe):await addSpeech(directory,existing,ffmpeg,ffprobe);}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(directory,{recursive:true});
  const run=(args)=>execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin',...args],{timeout:120000,maxBuffer:1024*1024});
  const definitions=[
    {id:'plate',file:'pattern_24.mov',expected:{has_video:true,has_audio:true,width:1920,height:1080,fps:24,duration:12},args:['-f','lavfi','-i','testsrc2=size=1920x1080:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','12','-c:v','prores_ks','-profile:v','0','-pix_fmt','yuv422p10le','-c:a','pcm_s16le','-ac','2','-threads','2']},
    {id:'motion',file:'motion_25.mp4',expected:{has_video:true,has_audio:false,width:1920,height:1080,fps:25,duration:8},args:['-f','lavfi','-i','testsrc2=size=1920x1080:rate=25','-t','8','-an','-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p','-threads','2']},
    {id:'audio',file:'tone.wav',expected:{has_video:false,has_audio:true,duration:8},args:['-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','8','-c:a','pcm_s16le','-ac','2']},
    {id:'still',file:'still.png',expected:{has_video:true,has_audio:false,width:1920,height:1080},args:['-f','lavfi','-i','testsrc=size=1920x1080:rate=1','-frames:v','1','-threads','1','-update','1']},
    {id:'mxf',file:'sample.mxf',expected:{has_video:true,has_audio:false,width:1920,height:1080,fps:25,duration:6},args:['-f','lavfi','-i','testsrc2=size=1920x1080:rate=25','-t','6','-an','-c:v','mpeg2video','-pix_fmt','yuv422p','-b:v','50M','-g','12','-threads','2','-f','mxf']},
    {id:'mask',file:'mask.png',expected:{has_video:true,has_audio:false,width:1920,height:1080},args:['-f','lavfi','-i',"nullsrc=s=1920x1080,geq=lum='if(lt(X,W/2),255,0)':cb=128:cr=128",'-frames:v','1','-pix_fmt','gray','-threads','1','-update','1']}
  ];
  const files=[];
  for(const item of definitions){
    const file=path.join(directory,item.file);
    try{await access(file);throw new Error(`Partial fixture pack already exists at ${directory}; preserve it and choose another output directory.`);}catch(error){if(error.code!=='ENOENT')throw error;}
    console.log(`Preparing ${item.file}`);run([...item.args,'-map_metadata','-1',file]);
    const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{timeout:15000,maxBuffer:1024*1024}));
    const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio'),e=item.expected;
    if(Boolean(video)!==e.has_video||Boolean(audio)!==e.has_audio)throw new Error(`Wrong generated streams: ${item.file}`);
    if(video&&(video.width!==e.width||video.height!==e.height))throw new Error(`Wrong generated dimensions: ${item.file}`);
    if(e.duration&&Math.abs(Number(probe.format.duration)-e.duration)>.05)throw new Error(`Wrong generated duration: ${item.file}`);
    if(e.fps&&video.r_frame_rate!==`${e.fps}/1`)throw new Error(`Wrong generated frame rate: ${item.file}`);
    files.push({id:item.id,file:item.file,sha256:await sha(file),expected:e,probe});
  }
  const content={format:'wizard-smoke-fixtures/v1',id:'GP-local-v0',version:1,description:'Synthetic local media only. tone.wav is not a speech/transcript fixture.',generator:execFileSync(ffmpeg,['-version'],{encoding:'utf8',timeout:10000}).split('\n')[0],files};
  const manifest={...content,sha256:digest(content)};await writeJSON(path.join(directory,'manifest.json'),manifest);return includeSpeech?addSpeech(directory,manifest,ffmpeg,ffprobe):manifest;
}

async function addSpeech(directory,manifest,ffmpeg,ffprobe){
  const text='The silver camera follows a red bicycle. The lighthouse stands beside the quiet harbor. A purple umbrella rests near the garden gate.';
  const raw=path.join(directory,'speech.aiff'),file='comet_report.wav';
  execFileSync('/usr/bin/say',['-v','Samantha','-r','135','-o',raw,text],{timeout:30000});
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',raw,'-ar','16000','-ac','1','-map_metadata','-1',path.join(directory,file)],{timeout:30000});
  const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path.join(directory,file)],{encoding:'utf8',timeout:15000}));
  const duration=Number(probe.format.duration);if(!Number.isFinite(duration)||duration<6||duration>15||probe.streams.length!==1||probe.streams[0].sample_rate!=='16000')throw new Error('Speech fixture generation failed.');
  await writeJSON(path.join(directory,'manifest-v1.json'),manifest);
  const {sha256,...old}=manifest;
  const content={...old,version:2,description:'Seven synthetic local fixtures, including offline speech for transcript and search checks.',speech:{text,voice:'Samantha',rate:135,anchors:['silver camera','lighthouse','purple umbrella']},files:[...manifest.files,{id:'speech',file,sha256:await sha(path.join(directory,file)),expected:{has_video:false,has_audio:true,duration},probe}]};
  await writeJSON(path.join(directory,'manifest.json'),{...content,sha256:digest(content)});return addSpeechVideo(directory,await validateFixtures(directory),ffmpeg,ffprobe);
}

async function addSpeechVideo(directory,manifest,ffmpeg,ffprobe){
  const file='comet_report.mov';
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','color=c=blue:s=320x180:r=24','-i',path.join(directory,'comet_report.wav'),'-shortest','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','pcm_s16le','-threads','1','-map_metadata','-1',path.join(directory,file)],{timeout:30000});
  const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path.join(directory,file)],{encoding:'utf8',timeout:15000}));
  const {sha256,...old}=manifest;const content={...old,version:3,description:'Eight synthetic fixtures, including matching speech audio and video. Transcript search in this package indexes video assets.',files:[...manifest.files,{id:'speechVideo',file,sha256:await sha(path.join(directory,file)),expected:{has_video:true,has_audio:true,width:320,height:180,fps:24,duration:Number(probe.format.duration)},probe}]};
  await writeJSON(path.join(directory,'manifest-v2.json'),manifest);await writeJSON(path.join(directory,'manifest.json'),{...content,sha256:digest(content)});return validateFixtures(directory);
}
