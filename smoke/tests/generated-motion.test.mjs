import test from 'node:test';
import assert from 'node:assert/strict';
import {proveGraphicMotion} from '../desktop/generated-fixture.mjs';

test('decoded MGFX motion rejects a static marker, wrong clock, missing pixels and wrong raster',()=>{
 const image=frame=>{const pixels=Buffer.alloc(1920*1080*3);for(let y=160;y<340;y++)for(let x=100+frame*20;x<280+frame*20;x++){const i=(y*1920+x)*3;pixels[i]=255;pixels[i+1]=204;pixels[i+2]=51;}return {width:1920,height:1080,pixels};};
 const frames=[0,24,47].map(frame=>({frame,image:image(frame)}));
 const proof=proveGraphicMotion(frames);assert.equal(proof.samples.length,3);assert.ok(proof.differences.every(d=>d>0));
 for(const broken of [frames.map(f=>({...f,image:image(0)})),frames.map(f=>({...f,image:image(f.frame+1)})),frames.map(f=>({...f,image:{...f.image,width:960}})),frames.map(f=>({...f,image:{...f.image,pixels:Buffer.alloc(1920*1080*3)}}))])assert.throws(()=>proveGraphicMotion(broken));
 assert.throws(()=>proveGraphicMotion(frames.slice(0,2)));assert.throws(()=>proveGraphicMotion([frames[0],frames[2],frames[1]]));
});
