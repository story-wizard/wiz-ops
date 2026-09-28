import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assert} from './engine.mjs';

export function parsePPM(bytes){
  let offset=0;
  const space=n=>[9,10,13,32].includes(n);
  const token=()=>{while(offset<bytes.length){if(space(bytes[offset]))offset++;else if(bytes[offset]===35){while(offset<bytes.length&&bytes[offset]!==10)offset++;}else break;}const start=offset;while(offset<bytes.length&&!space(bytes[offset]))offset++;return bytes.subarray(start,offset).toString('ascii');};
  assert(token()==='P6','Expected a binary RGB PPM.');
  const width=Number(token()),height=Number(token()),max=Number(token());
  assert(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=4096&&height<=4096&&max===255,'Invalid PPM dimensions or depth.');
  assert(space(bytes[offset]),'Missing PPM pixel separator.');if(bytes[offset++]===13&&bytes[offset]===10)offset++;
  const pixels=bytes.subarray(offset);assert(pixels.length===width*height*3,'PPM pixel payload is incomplete.');return {width,height,pixels};
}
export const readPPM=async file=>parsePPM(await readFile(file));
export function pixelStats(frame){
  let sum=0,max=0,min=255,edge=0,count=0;const p=frame.pixels,row=frame.width*3;
  for(let i=0;i<p.length;i++){sum+=p[i];min=Math.min(min,p[i]);max=Math.max(max,p[i]);if(i%row>=3){edge+=Math.abs(p[i]-p[i-3]);count++;}if(i>=row){edge+=Math.abs(p[i]-p[i-row]);count++;}}
  return {width:frame.width,height:frame.height,mean:sum/p.length,min,max,edgeEnergy:edge/count,sha256:createHash('sha256').update(p).digest('hex')};
}
export function pixelDifference(a,b){assert(a.width===b.width&&a.height===b.height,'Compared frames have different dimensions.');let sum=0;for(let i=0;i<a.pixels.length;i++)sum+=Math.abs(a.pixels[i]-b.pixels[i]);return sum/a.pixels.length;}
export function visibleImage(frame){const s=pixelStats(frame);assert(s.mean>10&&s.max-s.min>100,'Expected visible test-pattern pixels.');return s;}
