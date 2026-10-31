import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {assert,OutcomeError} from './engine.mjs';

// Fixture intent is an isotropic blur in pixels. Resolve its authored fields
// from the selected project's published renderer registry before graph edits.
export async function blurParameters(bundle,radius){
  assert(Number.isFinite(radius)&&radius>=0,'Blur fixture radius must be nonnegative pixels.');
  const registry=JSON.parse(await readFile(path.join(bundle,'processing/video/node_registry.json'),'utf8'));
  const nodes=Array.isArray(registry.nodes)?registry.nodes.filter(n=>n.type==='gaussian_blur'):[];
  const unsupported=()=>{throw new OutcomeError('Inspect the selected renderer registry: Gaussian blur pixel-radius contract is not mapped.','Blocked');};
  if(registry.snapshot_version!==1||registry.generated_from?.registry!=='wiz-render'||nodes.length!==1)unsupported();
  const node=nodes[0],field=name=>Array.isArray(node.params)?node.params.filter(p=>p.name===name):[];
  const pixels=name=>{const p=field(name);return p.length===1&&p[0].param_type==='float'&&p[0].unit==='pixels'&&radius>=(p[0].hard_range_min??0)&&radius<=(p[0].hard_range_max??Infinity);};
  if(pixels('radius')&&!field('horizontal_radius').length&&!field('vertical_radius').length)return {radius};
  if(!field('radius').length&&pixels('horizontal_radius')&&pixels('vertical_radius')&&field('uniform_radius').length===1&&field('uniform_radius')[0].param_type==='bool'&&node.param_links?.some(l=>l.controller_param==='uniform_radius'&&l.mode==='proportional'&&Array.isArray(l.member_params)&&l.member_params.length===2&&l.member_params.includes('horizontal_radius')&&l.member_params.includes('vertical_radius')))return {uniform_radius:true,horizontal_radius:radius,vertical_radius:radius};
  unsupported();
}
export function blurRadius(params){
  if(Number.isFinite(params?.radius)&&params.horizontal_radius===undefined&&params.vertical_radius===undefined)return params.radius;
  assert(Number.isFinite(params?.horizontal_radius)&&params.horizontal_radius===params.vertical_radius&&params.radius===undefined,'Blur readback is not the expected isotropic radius.');
  return params.horizontal_radius;
}
export async function setBlurRadius(call,bundle,scope,nodeId,radius){
  const params=await blurParameters(bundle,radius);
  for(const [param,value]of Object.entries(params))await call('graph.set_param',{...scope,node_id:nodeId,param,value});
}
