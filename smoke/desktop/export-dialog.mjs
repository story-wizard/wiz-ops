import path from 'node:path';
import {stat} from 'node:fs/promises';
import {command,assert,pause} from '../runner/engine.mjs';
import {writeJSON} from '../runner/files.mjs';
import {readPPM,pixelStats} from '../runner/pixels.mjs';
import {observedWidget} from './checklist-proof.mjs';

const control=(ui,dialog,fn,label)=>observedWidget(ui,w=>w.window===dialog&&fn(w),label);
export async function setExportOutput({n,ui},dialog,output){
 const state=await ui(),named=state.widgets.some(w=>w.window===dialog&&w.name==='exportNameEdit');
 if(named){
  const name=control(state,dialog,w=>w.name==='exportNameEdit','Export file name'),location=control(state,dialog,w=>w.name==='exportLocationEdit','Export location');
  await n('text',{target:location.id,text:path.dirname(output)});await n('text',{target:name.id,text:path.basename(output)});
 }else await n('text',{target:control(state,dialog,w=>w.class==='QLineEdit'&&/\.(mp4|jpg|jpeg|png)$/i.test(w.text),'Export output').id,text:output});
}
export async function configureExport(h,dialog,output,{still=false,seconds=2}={}){
 const {n,ui,until}=h,state=await ui(),old=state.widgets.some(w=>w.window===dialog&&w.name==='exportFormatCombo');
 if(old){
  const format=control(state,dialog,w=>w.name==='exportFormatCombo','Export format');assert(Array.isArray(format.items),'Export format choices are unavailable');const index=format.items.indexOf(still?'Still at Playhead':'MP4 (H.264)');assert(index>=0,'Requested export format is unavailable');await n('select',{target:format.id,index});
 }else{
  const preset=control(state,dialog,w=>w.name==='exportPreset_'+(still?'still':'h264')&&w.enabled,'Export preset');await n('click',{target:preset.id});
  await until(async()=>{const latest=await ui();return control(latest,dialog,w=>w.id===preset.id,'Selected export preset').checked?latest:null;},{description:'Export preset selected'});
 }
 if(!still){
  let latest=await ui();
  if(!old){const custom=control(latest,dialog,w=>w.name==='exportRange2'&&w.enabled,'Custom export range');await n('click',{target:custom.id});latest=await ui();}
  const start=control(latest,dialog,w=>w.name==='exportStartEdit'&&w.enabled,'Export start'),end=latest.widgets.some(w=>w.window===dialog&&w.name==='exportEndEdit')?control(latest,dialog,w=>w.name==='exportEndEdit'&&w.enabled,'Export end'):control(latest,dialog,w=>w.class==='QLineEdit'&&w.y===control(latest,dialog,w=>w.class==='QLabel'&&w.text==='End','End label').y,'Export end');
  await n('text',{target:start.id,text:'00:00:00:00'});await n('text',{target:end.id,text:`00:00:${String(seconds).padStart(2,'0')}:00`});
 }
 await setExportOutput(h,dialog,output);
 return control(await ui(),dialog,w=>w.class==='QPushButton'&&w.text==='Export'&&w.enabled,'Export command');
}

export function completedExportClose(ui){
 const dialogs=ui.widgets.filter(w=>w.window===w.id&&w.title==='Export'&&ui.widgets.some(child=>child.window===w.id&&child.text==='Export Complete'));
 const buttons=ui.widgets.filter(w=>dialogs.length===1&&w.window===dialogs[0].id&&w.class==='QPushButton'&&w.text==='Close'&&w.enabled);
 assert(dialogs.length<=1&&(!dialogs.length||buttons.length===1),'Completed export window is ambiguous');
 return buttons[0];
}
async function closeCompletedExport({n,ui,until}){
 const button=completedExportClose(await ui());if(!button)return;
 await n('click',{target:button.id});await until(async()=>!(await ui()).widgets.some(w=>w.id===button.window),{description:'Completed export window closed'});
}
// The application prepares the export, including its authorized MGFX bindings.
export async function exportDialog({s,n,ui,until},output,seconds=2){
  await closeCompletedExport({n,ui,until});
  const u=await ui(),actions=u.actions.filter(a=>a.name==='exportVideoAction'&&a.enabled);assert(actions.length===1,'Export action is absent or ambiguous');await n('action',{target:actions[0].id});
  const opened=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='exportDialog')?a:null;});
  const dialog=observedWidget(opened,w=>w.name==='exportDialog','Export dialog');
  let uncertain=false;
  try{
    const button=await configureExport({n,ui,until},dialog.id,output,{seconds});
    await writeJSON(output+'.controls.json',await ui());await n('click',{target:button.id});
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
  }catch(e){uncertain=e.status==='Unknown';throw e;}finally{if(!uncertain){
    const remaining=await ui(),cancel=remaining.widgets.find(w=>w.window===dialog.id&&w.class==='QPushButton'&&w.text==='Cancel');if(cancel)await n('click',{target:cancel.id});
    await closeCompletedExport({n,ui,until});
  }}
}

export async function exportStillDialog({s,n,ui,until},output){
  await closeCompletedExport({n,ui,until});
  const actions=(await ui()).actions.filter(a=>a.name==='exportVideoAction'&&a.enabled);assert(actions.length===1,'Export action is absent or ambiguous');await n('action',{target:actions[0].id});
  let u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='exportDialog')?a:null;});
  const d=observedWidget(u,w=>w.name==='exportDialog','Export dialog');
  let uncertain=false;
  try{
    const button=await configureExport({n,ui,until},d.id,output,{still:true});await writeJSON(output+'.controls.json',await ui());await n('click',{target:button.id});
    await until(async()=>{try{return (await stat(output)).size>0;}catch(e){if(e.code==='ENOENT')return false;throw e;}});
    const decoded=output+'.ppm',r=await command(path.join(s.cliApp,'Contents/MacOS/ffmpeg'),['-v','error','-i',output,'-frames:v','1','-pix_fmt','rgb24',decoded]);assert(r.code===0,'Application still cannot be decoded');return {output,decoded,pixels:pixelStats(await readPPM(decoded))};
  }catch(e){uncertain=e.status==='Unknown';throw e;}finally{if(!uncertain){const cancel=(await ui()).widgets.find(w=>w.window===d.id&&w.text==='Cancel'&&w.class==='QPushButton');if(cancel)await n('click',{target:cancel.id});await closeCompletedExport({n,ui,until});}}
}
