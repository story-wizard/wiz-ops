import test from 'node:test';
import assert from 'node:assert/strict';
import {livePreviewEvidence,requireRedGraphic} from '../desktop/check-support.mjs';
const image=value=>({sampleWidth:64,sampleHeight:32,sampleRgb:Buffer.alloc(64*32*3,value).toString('base64')});
const sample=(at,value)=>({startedAt:at,finishedAt:at+50,image:image(value)}),receipt={pointerDownAt:1000,pointerUpAt:5000};
test('live preview requires nonblank evolving frames collected while the pointer is held',()=>{
 const good=[sample(2000,30),sample(3000,50),sample(4000,70)];
 assert.equal(livePreviewEvidence(image(20),good,receipt).samplesDuringHold,3);
 for(const wrong of [good.map(x=>({...x,image:image(20)})),good.map(x=>({...x,image:image(50)})),good.map(x=>({...x,startedAt:x.startedAt+5000,finishedAt:x.finishedAt+5000})),[sample(2000,0),sample(3000,30),sample(4000,50)]])assert.throws(()=>livePreviewEvidence(image(20),wrong,receipt));
 assert.throws(()=>livePreviewEvidence(image(20),[sample(900,30),sample(2000,50),sample(4990,70)],receipt));
});

 test('generated graphic oracle rejects blank and wrong nonblank preview frames',()=>{
 const rgb=Buffer.alloc(64*32*3);for(let i=0;i<rgb.length;i+=3)rgb[i]=255;
 assert.equal(requireRedGraphic({...image(0),sampleRgb:rgb.toString('base64')}).redFraction,1);
 for(const bad of [image(0),image(255),image(90),{...image(0),sampleRgb:''}])assert.throws(()=>requireRedGraphic(bad));
 });
