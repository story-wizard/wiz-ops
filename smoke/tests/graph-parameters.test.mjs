import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {blurParameters,blurRadius,setBlurRadius} from '../runner/graph-parameters.mjs';
const pixel=name=>({name,param_type:'float',unit:'pixels',hard_range_min:0,hard_range_max:2000});
const current=()=>({type:'gaussian_blur',params:[pixel('horizontal_radius'),pixel('vertical_radius'),{name:'uniform_radius',param_type:'bool'}],param_links:[{controller_param:'uniform_radius',mode:'proportional',member_params:['horizontal_radius','vertical_radius']}]});
test('blur fixture intent follows the published pixel contract while stale fields and unreviewed domains are rejected',async()=>{
 const root=await mkdtemp('/private/tmp/athanor-graph-params-'),bundle=path.join(root,'Owned.wiz'),directory=path.join(bundle,'processing/video');await mkdir(directory,{recursive:true});
 const save=node=>writeFile(path.join(directory,'node_registry.json'),JSON.stringify({snapshot_version:1,generated_from:{registry:'wiz-render'},nodes:[node]}));
 try{
  await save({type:'gaussian_blur',params:[pixel('radius')]});assert.deepEqual(await blurParameters(bundle,16),{radius:16});assert.equal(blurRadius({radius:16}),16);
  await save(current());assert.deepEqual(await blurParameters(bundle,16),{uniform_radius:true,horizontal_radius:16,vertical_radius:16});
  const readback={horizontal_radius:16,vertical_radius:16,uniform_radius:true},calls=[];
  await setBlurRadius(async(op,p)=>{calls.push({op,...p});assert(Object.hasOwn(readback,p.param),'A stale parameter must never dispatch');readback[p.param]=p.value;},bundle,{timeline_id:'tl',clip_id:'clip'},'node',0);
  assert.equal(blurRadius(readback),0);assert.equal(calls.length,3);assert(calls.every(c=>c.op==='graph.set_param'&&c.node_id==='node'&&c.clip_id==='clip'));
  assert.throws(()=>blurRadius({horizontal_radius:0,vertical_radius:16}));assert.throws(()=>blurRadius({radius:16,horizontal_radius:16,vertical_radius:16}));
  for(const mutate of [n=>n.params[0].unit='percent',n=>n.params[1].name='unreviewed',n=>n.params[0].hard_range_max=1,n=>n.params.push(pixel('radius')),n=>n.param_links[0].mode='unreviewed']){const n=current();mutate(n);await save(n);await assert.rejects(()=>blurParameters(bundle,16),e=>e.status==='Blocked');}
 }finally{await rm(root,{recursive:true,force:true});}
});
