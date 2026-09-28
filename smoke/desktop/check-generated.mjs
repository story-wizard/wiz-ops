import path from 'node:path';
import {checks} from './check-support.mjs';
import {createLocalGraphic} from './generated-fixture.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,same,clips,snapshotState} from '../runner/engine.mjs';
import {readPPM,pixelDifference} from '../runner/pixels.mjs';
const verify=process.argv[3]==='verify';
const {s,c,check,finish}=await checks(process.argv[2],verify?'service-generated-reopen-report.json':'service-generated-report.json');
const inspect=generation_id=>c('generate.inspect',{target:{kind:'generation',generation_id}});
const timeline=timeline_id=>c('timeline.inspect',{timeline_id});
const values=g=>({generation_id:g.generation_id,content_id:g.content_id,parameters:g.parameters.map(p=>({path:p.descriptor.param_path,value:p.value}))});
const expectedFile=path.join(s.root,'generated-expected.json');
let frameSequence=0;
async function frame(id,seconds=1){const output=path.join(s.root,`generated-frame-${++frameSequence}-${Date.now()}.ppm`);await c('render.export_still',{timeline_id:id,time:{value:seconds*24,rate:24},output});const image=await readPPM(output);assert(image.width===1920&&image.height===1080,'Wrong MGFX raster');return image;}
async function title(generation_id,value){const g=await inspect(generation_id);await c('generate.set_params',{target:{kind:'generation',generation_id},expected_owner_revision:g.owner_revision,expected_params_revision:g.params_rev,values:{'title.text':value},reset:[]});}
if(verify){
  await check('S-MGFX-PERSIST',async()=>{const expected=await readJSON(expectedFile);assert(expected.generations.length>=2,'Missing independent-generation fixture');for(const g of expected.generations)same(values(await inspect(g.generation_id)),g,'Reopened generation identity and values');for(const t of expected.timelines)same(snapshotState(await timeline(t.timeline.timeline_id)),t,'Reopened generated timeline');const image=await frame(expected.renderTimeline);assert(pixelDifference(await readPPM(expected.reference),image)<=1,'Reopened MGFX pixels changed');return {generations:expected.generations.map(g=>g.generation_id),newProcess:s.pid,pixelsRestored:true};});finish();
}else{
  let valid,copy,copyTimeline,copyFrame;
  await check('S-MGFX-DUPLICATE-DEFAULT',async()=>{const g=await createLocalGraphic(c,s),before=values(await inspect(g.generation.generation_id));const result=await c('generate.duplicate',{source_generation_id:g.generation.generation_id,label_suffix:' default descriptor copy'});assert(result.generation_id!==g.generation.generation_id,'Duplicate reused source identity');same(values(await inspect(g.generation.generation_id)),before,'Duplication preserves source');return {source:g.generation.generation_id,copy:result.generation_id,scope:'Copy must accept an optional group label omitted during successful admission'};});
  await check('S-MGFX-DUPLICATE',async()=>{
    valid=await createLocalGraphic(c,s,{groupLabel:'Title'});const source=valid.generation.generation_id,before=values(await inspect(source)),original=await frame(valid.timeline);
    const t=await c('timeline.create',{name:'Independent graphic copy',video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}});copyTimeline=t.timeline_id;
    copy=await c('generate.duplicate',{source_generation_id:source,label_suffix:' independent',destination:{kind:'timeline',timeline_id:copyTimeline,at:{offset_seconds:0},fit:{mode:'fit_to_timeline'},overlap:'reject'}});assert(copy.generation_id!==source,'Duplicate reused generation identity');assert(copy.destination.nested.timeline_id!==valid.destination.nested.timeline_id,'Duplicate reused compound identity');assert(pixelDifference(original,await frame(copyTimeline))<=1,'Duplicate changed initial pixels');
    await title(copy.generation_id,'INDEPENDENT COPY HAS ITS OWN TITLE 12345');same(values(await inspect(source)),before,'Copy edit preserves original generation');assert(pixelDifference(original,await frame(valid.timeline))<=1,'Copy edit changed original pixels');copyFrame=await frame(copyTimeline);assert(pixelDifference(original,copyFrame)>.01,'Copy title did not change copied pixels');return {source,copy:copy.generation_id,sourceCompound:valid.destination.nested.timeline_id,copyCompound:copy.destination.nested.timeline_id,independentValuesAndPixels:true,scope:'Application duplicate operation; bin context-menu gesture is separate'};
  });
  await check('S-MGFX-CLIP-COPY',async()=>{
    assert(valid,'MGFX fixture prerequisite failed');const before=await timeline(valid.timeline),original=await frame(valid.timeline),source=values(await inspect(valid.generation.generation_id));
    // The application's MGFX clipboard route uses generate.duplicate. Generic
    // timeline.move_clips(copy=true) deliberately retains the referenced material.
    await c('generate.duplicate',{source_generation_id:valid.generation.generation_id,label_suffix:' placed copy',destination:{kind:'timeline',timeline_id:valid.timeline,at:{offset_seconds:2},track:{id:valid.destination.parent.track_id},fit:{mode:'fit_to_timeline'},overlap:'reject'}});
    const after=await timeline(valid.timeline),added=clips(after).filter(x=>!clips(before).some(y=>y.clip_id===x.clip_id));assert(added.length===1&&added[0].clip_id!==valid.destination.parent.clip_id,'Clip copy did not create independent identity');
    const target={kind:'generated_placement',timeline_id:valid.timeline,clip_id:added[0].clip_id},copied=await c('generate.inspect',{target});assert(copied.generation_id!==valid.generation.generation_id,'Copied placement still shares original generation');await title(copied.generation_id,'CLIP COPY CHANGED INDEPENDENTLY');same(values(await inspect(valid.generation.generation_id)),source,'Copied placement edit preserves source');assert(pixelDifference(original,await frame(valid.timeline))<=1,'Copied placement changed original pixels');assert(pixelDifference(original,await frame(valid.timeline,3))>.01,'Copied placement pixels did not change');return {original:valid.destination.parent.clip_id,copy:added[0].clip_id,generation:copied.generation_id,scope:'Application generate.duplicate operation used by MGFX copy/paste; actual keyboard routing remains separate'};
  });
  await check('S-MGFX-UNDO-PUBLISH',async()=>{
    const g=await createLocalGraphic(c,s,{groupLabel:'Title',label:'Undo publish fixture'}),before=await timeline(g.timeline),original=await frame(g.timeline);assert(clips(before).length===1,'Unexpected publication fixture');assert((await c('undo.undo')).moved,'Undo publish was a no-op');assert(clips(await timeline(g.timeline)).length===0,'Undo publish left a placed clip');assert((await c('undo.redo')).moved,'Redo publish was a no-op');same(snapshotState(await timeline(g.timeline)),snapshotState(before),'Redo restores published identities');assert(pixelDifference(original,await frame(g.timeline))<=1,'Redo publish did not restore pixels');return {generation:g.generation.generation_id,compound:g.destination.nested.timeline_id,undoRemovesPlacement:true,redoRestoresPixels:true,scope:'Placement history; retained undo assets are not classified as orphaned files'};
  });
  if(valid&&copy){const reference=path.join(s.root,'generated-persistence-reference.ppm');await c('render.export_still',{timeline_id:copyTimeline,time:{value:24,rate:24},output:reference});await writeJSON(expectedFile,{generations:[values(await inspect(valid.generation.generation_id)),values(await inspect(copy.generation_id))],timelines:[snapshotState(await timeline(valid.timeline)),snapshotState(await timeline(copyTimeline))],reference,renderTimeline:copyTimeline});}
  await c('project.checkpoint');finish();
}
