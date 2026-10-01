import path from 'node:path';
import {assert,command} from './engine.mjs';
import {writeJSON} from './files.mjs';
import {readPPM,pixelStats} from './pixels.mjs';

export async function still(c,label,time=1){
  return frame(c,label,Math.round(time*c.main.fps));
}
export async function frame(c,label,index,timeline=c.main){
  assert(Number.isInteger(index)&&index>=0&&Number.isFinite(timeline.fps)&&timeline.fps>0,'A frame export needs a nonnegative frame and explicit timeline rate.');
  const output=path.join(path.dirname(c.bundle),label+'.ppm');const result=await c.call('render.export_still',{timeline_id:timeline.id,time:{value:index,rate:timeline.fps},output});
  assert(result.output===output&&result.timeline_frame===index,'Still export returned the wrong path or timeline frame.');
  const image=await readPPM(output);assert(image.width===1920&&image.height===1080,'Still export has the wrong raster.');return image;
}
export async function evidence(c,frames){await writeJSON(path.join(path.dirname(c.bundle),'pixels.json'),Object.fromEntries(Object.entries(frames).map(([label,image])=>[label,pixelStats(image)])));}
export async function reference(c,label,file,seconds){
  const output=path.join(path.dirname(c.bundle),'reference-'+label+'.ppm');
  const args=['-hide_banner','-loglevel','error','-nostdin','-ss',String(seconds),'-i',path.join(c.mediaRoot,file),'-frames:v','1','-pix_fmt','rgb24','-threads','1',output];
  const receipt=await command(path.join(c.engine.macos,'ffmpeg'),args,{env:c.engine.env,cwd:c.engine.root,timeout:10000});await writeJSON(path.join(path.dirname(c.bundle),'reference-'+label+'.json'),{args,...receipt});
  assert(receipt.code===0&&!receipt.timedOut,`Independent source decode failed: ${receipt.stderr}`);return readPPM(output);
}

export async function insertEffect(c,type,params={}){
  const scope={timeline_id:c.main.id,clip_id:c.a};
  const graph=await c.call('graph.get_clip_graph',scope);
  const composite=graph.nodes.find(n=>n.type==='composite');
  const edge=graph.edges.find(e=>e.to_node===composite?.node_id);
  assert(edge,'Expected composite input is missing.');
  await c.call('graph.insert_on_edge',{...scope,type,params,from_node:edge.from_node,from_slot:edge.from_slot,to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output',expect_structural_revision:graph.structural_revision,expect_content_revision:graph.content_revision});
  const updated=await c.call('graph.get_clip_graph',scope);
  const added=updated.nodes.filter(n=>!graph.nodes.some(old=>old.node_id===n.node_id));
  assert(added.length===1&&added[0].type===type,'Effect insertion did not create the requested node.');
  const node=added[0];assert(updated.edges.some(e=>e.from_node===edge.from_node&&e.to_node===node.node_id)&&updated.edges.some(e=>e.from_node===node.node_id&&e.to_node===edge.to_node),'Effect is not in the rendered path.');
  return {scope,node,edge};
}
