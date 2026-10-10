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

 test('physical editor captures keep captions as evidence metadata, outside strict input requests',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');const root=await mkdtemp('/private/tmp/athanor-editor-caption-');
 try{
  const source=await readFile(new URL('../desktop/check-physical-editor.mjs',import.meta.url),'utf8'),start=source.indexOf('async function screen('),end=source.indexOf('\nconst check=',start);assert.ok(start>=0&&end>start);
  await writeFile(root+'/probe.mjs',`import path from 'node:path';import {validatePhysicalInput} from '${new URL('../desktop/physical-input.mjs',import.meta.url).href}';import {writeJSON} from '${new URL('../runner/files.mjs',import.meta.url).href}';const s={root:${JSON.stringify(root)}};const ui=async()=>({widgets:[{id:'main',class:'MainWindow'}]});const physical=async(command,params)=>{validatePhysicalInput(command,params);return {status:'Observed',window:params.target};};const retainImage=async(r,label)=>({...r,label});\n`+source.slice(start,end)+'\nexport {screen};');
  const {screen}=await import(pathToFileURL(root+'/probe.mjs').href),receipt=await screen('live-curve');assert.equal(receipt.status,'Observed');assert.equal(receipt.title,'live-curve · owned Wizard window');assert.equal(receipt.window,'main');
 }finally{await rm(root,{recursive:true,force:true});}
 });
