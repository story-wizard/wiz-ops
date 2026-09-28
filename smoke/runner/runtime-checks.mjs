import path from 'node:path';
import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {assert,same,near,clips,bounds,snapshotState,command} from './engine.mjs';
import {writeJSON} from './files.mjs';
import {verifyIngestSidecar} from './ingest.mjs';
import {ingestAssets,reopen,still,frame,reference,insertEffect,search,mixReport} from './interactions.mjs';
import {pixelDifference,pixelStats,visibleImage} from './pixels.mjs';

async function nest(c,source,name){
  const t=await c.timeline(name);
  await c.call('timeline.place_cuts',{id:`nest-${++c.sequence}`,timeline_id:t.id,cuts:[{id:'nested',source:{timeline_id:source.id},source_range:{start_seconds:0,end_seconds:4},streams:'video_only',destination:{at:{seconds:0,track:t.video}}}]});
  const items=clips(await c.inspect(t));assert(items.length===1&&items[0].source.kind==='timeline_ref'&&items[0].source.timeline_id===source.id,'Nested clip lost its child timeline identity.');return t;
}
export const runtimeCases={
  async 'A-TL-08-N'(c){
    await c.setup();const inner=c.main,original=await still(c,'inner-before');
    const parent=await nest(c,inner,'Parent'),outer=await nest(c,parent,'Outer');
    assert(pixelDifference(original,await frame(c,'nested-before',24,outer))<=1,'Double nesting changed source pixels.');
    const e=await insertEffect(c,'wiz.color.exposure_contrast');await c.call('graph.set_param',{...e.scope,node_id:e.node.node_id,param:'grade.exposure_contrast.exposure',value:1});
    const changed=await still(c,'inner-changed');assert(pixelDifference(original,changed)>2,'Child edit control did not change pixels.');
    assert(pixelDifference(changed,await frame(c,'nested-changed',24,outer))<=1,'Child edit did not reach the nested render.');
    await c.call('undo.undo');assert(pixelDifference(original,await frame(c,'nested-undone',24,outer))<=1,'Nested render did not follow child undo.');
    await c.call('undo.redo');const states=await Promise.all([inner,parent,outer].map(t=>c.inspect(t).then(snapshotState)));
    await reopen(c);for(let i=0;i<3;i++)same(snapshotState(await c.inspect([inner,parent,outer][i])),states[i],'Nested persistence');
    assert(pixelDifference(changed,await frame(c,'nested-reopened',24,outer))<=1,'Nested render changed on reopen.');
    return 'Two levels of timeline references render the child, follow its grade edit/undo/redo and survive reopen. Compound creation, tab navigation and live playback remain separate.';
  },
  async 'A-PB-05-R'(c){
    await c.create();await c.call('media.add_media_root',{path:c.mediaRoot});
    const ids=['plate','motion','mxf'];for(const id of ids)await c.import(id);
    await ingestAssets(c.engine,c.bundle,ids.map(id=>({asset_id:c.assets[id],media_path:path.join(c.mediaRoot,c.fixtures.files.find(f=>f.id===id).file)})));
    c.main=await c.timeline('Mixed codecs');
    for(let i=0;i<ids.length;i++)await c.place(c.main,c.assets[ids[i]],i*2,i*2,i*2+2);
    const sources=await Promise.all(ids.map((id,i)=>reference(c,id,c.fixtures.files.find(f=>f.id===id).file,i*2)));
    const stats=[];
    for(const i of [0,1,2,1,0,2]){
      const image=await frame(c,'codec-'+stats.length,i*48);visibleImage(image);
      const error=pixelDifference(image,sources[i]);assert(error<8,`${ids[i]} rendering differs from its independent source decode (${error}).`);
      for(let j=0;j<ids.length;j++)if(j!==i)assert(error+.5<pixelDifference(image,sources[j]),'Codec cut retained another source frame.');
      stats.push({codec:ids[i],frame:i*48,meanAbsoluteError:error,...pixelStats(image)});
    }
    await writeJSON(path.join(path.dirname(c.bundle),'mixed-codecs.json'),stats);
    return 'ProRes, H.264 and MXF cuts render against independent FFmpeg source decodes in changing seek order. Still-image admission, MGFX and real-time playback/drop checks remain separate.';
  },
  async 'A-PB-09-R'(c){
    await c.setup();const expected=await still(c,'source-at-two-seconds');const observations=[];
    for(const fps of [25,23.976,29.97]){
      const t=await c.timeline('Different rate '+fps,fps);await c.place(t,c.assets.plate,0,1,5);
      const s=await c.inspect(t);same(s.timeline.frame_rate,fps===25?{numerator:25,denominator:1}:fps===23.976?{numerator:24000,denominator:1001}:{numerator:30000,denominator:1001},'Exact rational timeline rate');
      const index=fps===25?25:fps===23.976?24:30,image=await frame(c,'rate-'+fps,index,t);
      assert(pixelDifference(expected,image)<=1,'Mixed-rate decode selected the wrong source frame.');
      observations.push({rate:s.timeline.frame_rate,frame:index,seconds:index/t.fps,pixels:pixelStats(image)});
    }
    await writeJSON(path.join(path.dirname(c.bundle),'rates.json'),observations);
    return 'A 24 fps source renders the intended frame on 25, 24000/1001 and 30000/1001 timelines with exact frame addressing. Live cadence/audio sync remain separate.';
  },
  async 'A-TL-04-F'(c){
    await c.setup();const source=await c.timeline('Fractional source',23.976),destination=await c.timeline('Fractional destination',29.97);
    const id=(await c.place(source,c.assets.plate,0,0,1.001))[0].clip_id;
    const initial=snapshotState(await c.inspect(source));bounds(clips(initial)[0],0,1.001,0,1.001);
    await c.move(source,[id],destination,.1001,{copy:true,ripple:{source:false,destination:false}});
    const copied=clips(await c.inspect(destination));assert(copied.length===1&&copied[0].clip_id!==id,'Fractional copy identity is wrong.');bounds(copied[0],.1001,1.1011,0,1.001);
    near(copied[0].timeline_range.start_seconds*destination.fps,3,'Destination first frame');near(copied[0].timeline_range.end_seconds*destination.fps,33,'Destination last boundary');
    same(snapshotState(await c.inspect(source)),initial,'Fractional source unchanged');
    await c.call('undo.undo');assert(clips(await c.inspect(destination)).length===0,'Fractional copy undo left clips.');await c.call('undo.redo');
    await reopen(c);bounds(clips(await c.inspect(destination))[0],.1001,1.1011,0,1.001);
    return 'A 24-frame 24000/1001 source span copies to frames 3–33 at 30000/1001, preserving source time, independent identity and undo/redo/reopen. GUI clipboard remains separate.';
  },
  async 'A-PB-03-R'(c){
    await c.setup();const t=await c.timeline('Linked cut');
    const placed=await c.place(t,c.assets.plate,0,1,5,{streams:'linked'}),v=placed.find(p=>p.stream==='video').clip_id;
    const before=await mixReport(c,t,'before-cut');const frames=[];for(const n of [47,48,49])frames.push(await frame(c,'before-'+n,n,t));
    await c.call('timeline.split_clips',{id:'linked-cut',timeline_id:t.id,streams:'linked',splits:[{id:'cut',clips:[{clip_id:v}],points:{timeline_seconds:[2]}}]});
    const after=await c.inspect(t);assert(clips(after).length===4&&after.links.length===2,'Linked split lost a stream or link.');
    for(const track of after.tracks){const items=track.items.filter(i=>i.kind==='clip').sort((a,b)=>a.timeline_range.start_seconds-b.timeline_range.start_seconds);assert(items.length===2,'Split stream count differs.');bounds(items[0],0,2,1,3);bounds(items[1],2,4,3,5);}
    const sound=await mixReport(c,t,'after-cut');
    // Level continuity is a bounded audio check, not sample-identical splice proof.
    // A 0.01 dB RMS budget is below the loss from dropping a full 24 fps frame in this four-second tone.
    assert(Math.abs(sound.master.rms_db-before.master.rms_db)<.01,'Linked cut changed the rendered audio level.');near(sound.master.peak_db,before.master.peak_db,'Linked cut peak');
    for(const [i,n]of [47,48,49].entries())assert(pixelDifference(frames[i],await frame(c,'after-'+n,n,t))<=1,'Splitting changed video at the cut.');
    return 'Linked splitting preserves contiguous V/A source windows, both link groups, offline audio level/sample count and video frames immediately around the cut. Live A/V sync remains separate.';
  },
  async 'A-PF-13-I'(c){
    await c.create();const dir=path.join(path.dirname(c.bundle),'bulk-media');await mkdir(dir);const seed=path.join(dir,'seed.mp4');
    const receipt=await command('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',path.join(c.mediaRoot,'motion_25.mp4'),'-t','0.24','-vf','scale=160:90','-an','-c:v','libx264','-preset','ultrafast','-threads','1',seed],{env:c.engine.env,timeout:15000});
    await writeJSON(path.join(dir,'generation.json'),receipt);assert(receipt.code===0&&!receipt.timedOut,'Bulk fixture generation failed.');
    await c.call('media.add_media_root',{path:dir});const assets=[],start=performance.now();
    for(let i=0;i<201;i++){const file=path.join(dir,`bulk_${String(i).padStart(3,'0')}.mp4`);await copyFile(seed,file);assets.push({asset_id:await c.import('motion',file),media_path:file});}
    assert(new Set(assets.map(a=>a.asset_id)).size===201,'Distinct bulk source paths were conflated.');
    // Small batches stay within the shared ingest timeout and retain one durable receipt per batch.
    for(let i=0;i<assets.length;i+=20){await ingestAssets(c.engine,c.bundle,assets.slice(i,i+20));await copyFile(path.join(path.dirname(c.bundle),'ingest.json'),path.join(path.dirname(c.bundle),`ingest-batch-${i}.json`));}
    const elapsedMs=performance.now()-start;
    for(const index of [0,100,200]){const matches=(await search(c,`bulk_${String(index).padStart(3,'0')}`)).matches;same(matches.map(m=>m.item_id),[assets[index].asset_id],'Bulk name search');same((await c.call('media.resolve_path',{asset_id:assets[index].asset_id})).path,assets[index].media_path,'Bulk source path');}
    const all=await c.call('media.list_assets');await writeJSON(path.join(path.dirname(c.bundle),'bulk-result.json'),{elapsedMs,assets:assets.length,listed:all});
    await reopen(c);for(const a of assets)verifyIngestSidecar(JSON.parse(await readFile(path.join(c.bundle,'assets/clips',a.asset_id+'.json'),'utf8')),a.asset_id);
    return `201 independently registered small video files complete packaged local ingest and retain source records after reopen; sampled search results return exact identities. ${elapsedMs.toFixed(0)} ms retained; UI scrolling/concurrent responsiveness remains separate.`;
  }
};
