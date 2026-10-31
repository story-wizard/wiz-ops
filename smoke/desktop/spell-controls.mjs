import {blurParameters,blurRadius} from '../runner/graph-parameters.mjs';
import {OutcomeError} from '../runner/engine.mjs';

// Use the same published renderer contract as clip graphs. Native Spell
// controls project effective values instead of graph.set_param's plain values.
export function spellBlurRadius(node){
 return blurRadius(Object.fromEntries(Object.entries(node.controls||{}).map(([key,value])=>[key,value.effective])));
}
export async function spellBlurParameters(call,bundle,radius){
 const values=await blurParameters(bundle,radius),catalog=await call('spellbook.catalog',{type:'gaussian_blur'}),rows=catalog.items?.filter(n=>n.type==='gaussian_blur')||[];
 if(rows.length!==1||!Object.keys(values).every(key=>rows[0].controls?.some(p=>p.key===key&&p.editable===true)))throw new OutcomeError('The published native Spell blur controls do not support this fixture.','Blocked');
 return values;
}
export async function spellBlurInput(call,bundle){
 const values=await spellBlurParameters(call,bundle,17);
 return Object.hasOwn(values,'radius')?'radius':'horizontal_radius';
}
