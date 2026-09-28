import path from 'node:path';
import {stat} from 'node:fs/promises';
import {command,assert,pause} from '../runner/engine.mjs';
import {writeJSON} from '../runner/files.mjs';
import {readPPM,pixelStats} from '../runner/pixels.mjs';

// The application prepares the export, including its authorized MGFX bindings.
export async function exportDialog({s,n,ui,until},output,seconds=2){
  const u=await ui();await n('action',{target:u.actions.find(a=>a.name==='exportVideoAction').id});
  const opened=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='exportDialog')?a:null;});
  const dialog=opened.widgets.find(w=>w.name==='exportDialog'),ws=opened.widgets.filter(w=>w.window===dialog.id),end=ws.find(w=>w.class==='QLabel'&&w.text==='End');
  try{
    const format=ws.find(w=>w.name==='exportFormatCombo');await n('select',{target:format.id,index:format.items.indexOf('MP4 (H.264)')});
    await n('text',{target:ws.find(w=>w.name==='exportStartEdit').id,text:'00:00:00:00'});
    await n('text',{target:ws.find(w=>w.class==='QLineEdit'&&w.y===end.y).id,text:`00:00:${String(seconds).padStart(2,'0')}:00`});
    await n('text',{target:ws.find(w=>w.class==='QLineEdit'&&w.text.endsWith('.mp4')).id,text:output});
    await writeJSON(output+'.controls.json',await ui());await n('click',{target:ws.find(w=>w.class==='QPushButton'&&w.text==='Export').id});
    const macos=path.join(s.cliApp,'Contents/MacOS');let probe;
    for(let i=0;i<100;i++){
      try{await stat(output);const p=await command(path.join(macos,'ffprobe'),['-v','error','-show_streams','-of','json',output],{timeout:2000});if(p.code===0){probe=JSON.parse(p.stdout);break;}}catch(e){if(e.code!=='ENOENT')throw e;}
      await pause(100);
    }
    assert(probe,'Export did not publish a readable movie within the bounded wait');
    const video=probe.streams.find(v=>v.codec_type==='video'),audio=probe.streams.find(v=>v.codec_type==='audio');
    assert(video?.codec_name==='h264'&&video.width===1920&&video.height===1080&&video.nb_frames===String(seconds*24)&&video.avg_frame_rate==='24/1'&&Number(video.duration)===seconds,'Export stream did not match requested range/format');assert(audio?.codec_name==='aac','Export has no AAC stream');
    const decoded=output+'.ppm',receipt=await command(path.join(macos,'ffmpeg'),['-v','error','-i',output,'-ss','1','-frames:v','1','-pix_fmt','rgb24',decoded]);assert(receipt.code===0,'Export frame cannot be decoded');const pixels=pixelStats(await readPPM(decoded));assert(pixels.max-pixels.min>100&&pixels.edgeEnergy>.01,'Exported movie is blank');
    await writeJSON(output+'.probe.json',probe);return {output,frames:seconds*24,fps:24,duration:seconds,raster:[1920,1080],audio:'AAC stream present; not an audible-sync check',pixels};
  }finally{
    const remaining=await ui(),cancel=remaining.widgets.find(w=>w.window===dialog.id&&w.class==='QPushButton'&&w.text==='Cancel');if(cancel)await n('click',{target:cancel.id});
  }
}

export async function exportStillDialog({s,n,ui,until},output){
  await n('action',{target:(await ui()).actions.find(a=>a.name==='exportVideoAction').id});
  let u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='exportDialog')?a:null;});
  const d=u.widgets.find(w=>w.name==='exportDialog'),format=u.widgets.find(w=>w.name==='exportFormatCombo');
  try{
    await n('select',{target:format.id,index:format.items.indexOf('Still at Playhead')});u=await ui();
    const field=u.widgets.find(w=>w.window===d.id&&w.class==='QLineEdit'&&/\.(jpg|jpeg|png)$/i.test(w.text));assert(field,'Still output field is unavailable');
    await n('text',{target:field.id,text:output});await writeJSON(output+'.controls.json',await ui());await n('click',{target:u.widgets.find(w=>w.window===d.id&&w.class==='QPushButton'&&w.text==='Export').id});
    await until(async()=>{try{return (await stat(output)).size>0;}catch(e){if(e.code==='ENOENT')return false;throw e;}});
    const decoded=output+'.ppm',r=await command(path.join(s.cliApp,'Contents/MacOS/ffmpeg'),['-v','error','-i',output,'-frames:v','1','-pix_fmt','rgb24',decoded]);assert(r.code===0,'Application still cannot be decoded');return {output,decoded,pixels:pixelStats(await readPPM(decoded))};
  }finally{const cancel=(await ui()).widgets.find(w=>w.window===d.id&&w.text==='Cancel'&&w.class==='QPushButton');if(cancel)await n('click',{target:cancel.id});}
}
