import path from 'node:path';
import {mkdir,realpath} from 'node:fs/promises';
import {assert,same,near,clip} from './engine.mjs';
import {inside,writeJSON} from './files.mjs';
import {readPPM,pixelStats,pixelDifference,visibleImage} from './pixels.mjs';

import {still,evidence,reference} from './render-helpers.mjs';

function graphState(g){return {nodes:g.nodes.map(n=>({id:n.node_id,type:n.type,params:n.params,bypassed:n.bypassed})).sort((a,b)=>a.id.localeCompare(b.id)),edges:g.edges,inputs:g.inputs,outputs:g.outputs};}
export const renderCases={
  async 'A-EX-03'(c){
    await c.setup();const first=await still(c,'first',1),gap=await still(c,'gap',5),second=await still(c,'second',7),repeat=await still(c,'first-repeat',1);
    const expectedFirst=await reference(c,'first','pattern_24.mov',2),expectedSecond=await reference(c,'second','motion_25.mp4',1);
    visibleImage(first);visibleImage(second);assert(pixelStats(gap).max<=1,'An empty timeline interval did not render black.');
    // The fixtures share color bars. Compare each export with its independently decoded source frame, allowing the renderer's color transform.
    assert(pixelDifference(first,expectedFirst)+.5<pixelDifference(first,expectedSecond),'First export does not match its intended source frame better than the other clip.');
    assert(pixelDifference(second,expectedSecond)+.5<pixelDifference(second,expectedFirst),'Second export does not match its intended source frame better than the other clip.');
    assert(pixelDifference(first,repeat)<=1,'Returning to the original frame did not reproduce its pixels.');
    await evidence(c,{first,gap,second,repeat,expectedFirst,expectedSecond});return 'Four 1080p exports match the intended source frames, an empty interval renders black, and returning to a frame reproduces its pixels.';
  },
  async 'A-CO-07'(c){
    await c.setup();const before=await still(c,'enabled');visibleImage(before);
    const set=enabled=>c.call('timeline.set_enabled',{id:enabled?'enable':'disable',timeline_id:c.main.id,target:{clips:[{clip_id:c.a}],streams:'video_only'},enabled});
    await set(false);assert(clip(await c.inspect(c.main),c.a).enabled===false,'Clip did not disable.');const disabled=await still(c,'disabled');assert(pixelStats(disabled).max<=1,'Disabled video remained visible in the rendered frame.');
    await set(true);assert(clip(await c.inspect(c.main),c.a).enabled===true,'Clip did not re-enable.');const restored=await still(c,'restored');assert(pixelDifference(before,restored)<=1,'Re-enabled clip did not restore its original pixels.');
    await c.call('project.checkpoint');await c.call('project.close');await c.call('project.open');const reopened=await still(c,'reopened');assert(pixelDifference(before,reopened)<=1,'Reopened enabled clip changed its pixels.');await evidence(c,{before,disabled,restored,reopened});return 'Disabling hides the clip in a real render; enabling and reopening restore the original pixels.';
  },
  async 'A-RG-01'(c){
    await c.setup();const scope={timeline_id:c.main.id,clip_id:c.a};const get=()=>c.call('graph.get_clip_graph',scope);
    const initial=await get(),baseline=await still(c,'graph-baseline');visibleImage(baseline);
    const transform=initial.nodes.find(n=>n.type==='transform_2d'),composite=initial.nodes.find(n=>n.type==='composite');assert(transform&&composite,'Expected clip render graph nodes are missing.');
    const edge=initial.edges.find(e=>e.from_node===transform.node_id&&e.to_node===composite.node_id);assert(edge,'Expected transform-to-composite edge is missing.');
    await c.call('graph.insert_on_edge',{...scope,type:'gaussian_blur',from_node:edge.from_node,from_slot:edge.from_slot,to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output',params:{radius:16},expect_structural_revision:initial.structural_revision,expect_content_revision:initial.content_revision});
    let graph=await get();const added=graph.nodes.filter(n=>!initial.nodes.some(i=>i.node_id===n.node_id));assert(added.length===1&&added[0].type==='gaussian_blur','Graph did not add exactly one blur node.');const id=added[0].node_id;
    assert(graph.edges.some(e=>e.from_node===edge.from_node&&e.to_node===id)&&graph.edges.some(e=>e.from_node===id&&e.to_node===edge.to_node),'Blur node was not connected in the expected render path.');
    const blurred=await still(c,'blurred');assert(pixelDifference(baseline,blurred)>1,'Connected blur did not change rendered pixels.');assert(pixelStats(blurred).edgeEnergy<pixelStats(baseline).edgeEnergy*.98,'Blur did not reduce image edge contrast.');
    await c.call('graph.set_param',{...scope,node_id:id,param:'radius',value:0});graph=await get();assert(graph.nodes.find(n=>n.node_id===id).params.radius===0,'Blur radius did not update.');const zero=await still(c,'zero-radius');assert(pixelDifference(baseline,zero)<=1,'Zero-radius blur did not restore the reference.');
    await c.call('graph.set_param',{...scope,node_id:id,param:'radius',value:16});await c.call('graph.set_bypass',{...scope,node_id:id,bypassed:true});assert((await get()).nodes.find(n=>n.node_id===id).bypassed===true,'Graph node did not bypass.');const bypassed=await still(c,'bypassed');assert(pixelDifference(baseline,bypassed)<=1,'Bypassed blur still changed rendered pixels.');
    await c.call('graph.edit_batch',{...scope,ops:[{op:'delete_node',node_id:id},{op:'connect_edge',...edge}]});same(graphState(await get()),graphState(initial),'Restored render graph');const restored=await still(c,'graph-restored');assert(pixelDifference(baseline,restored)<=1,'Restored graph changed rendered pixels.');await evidence(c,{baseline,blurred,zero,bypassed,restored});return 'Graph insertion, parameter changes, bypass and removal matched graph readback and independently checked rendered pixels. Clipboard UI was not exercised.';
  },
  async 'A-IN-04-T'(c){
    await c.create();await c.call('media.add_media_root',{path:c.mediaRoot});const output=path.join(path.dirname(c.bundle),'thumbnails');await mkdir(output);
    const result=await c.call('media.generate_timeline_thumbnails',{path:path.join(c.mediaRoot,'motion_25.mp4'),output_dir:output,bucket_seconds:2,max_count:3,width:320,height:180,format:'ppm'});
    await writeJSON(path.join(path.dirname(c.bundle),'thumbnails.json'),result);
    const frames=result.thumbnails;assert(result.count===3&&Array.isArray(frames)&&frames.length===3,'Expected three thumbnail frames.');
    for(const [i,frame] of frames.entries()){assert(frame.bucket_index===i,'Thumbnail bucket order is wrong.');near(frame.source_seconds,i*2+1,'Thumbnail source time');}
    const images=[];for(const frame of frames){assert(inside(output,await realpath(frame.path)),'Thumbnail output escaped its run directory.');const image=await readPPM(frame.path);assert(image.width===320&&image.height===180,'Thumbnail raster mismatch.');visibleImage(image);images.push(image);}
    assert(pixelDifference(images[0],images[1])>.5&&pixelDifference(images[1],images[2])>.5,'Motion thumbnails contain duplicated/stale frames.');await evidence(c,Object.fromEntries(images.map((f,i)=>['thumbnail-'+i,f])));return 'Three generated 320×180 thumbnail frames contain distinct decoded motion frames. UI display and waveforms remain manual.';
  }
};
