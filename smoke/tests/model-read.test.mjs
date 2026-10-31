import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {modelEntry,readModelValues} from '../desktop/model-read.mjs';
import {OutcomeError} from '../runner/engine.mjs';

test('a stale read discards partial roles, finds the moved row and binds every value to the fresh cursor',async()=>{
 let revision=1,stale=true;const calls=[];
 const n=async(op,p)=>{
  calls.push({op,...p});assert.ok(['model-page','model-value'].includes(op),'Only read operations are permitted');
  if(op==='model-page'){
   const rows=Array.from({length:130},(_,i)=>[i===(revision===1?0:129)?'plate':'asset-'+i]),end=Math.min(p.offset+64,rows.length);
   return {offset:p.offset,model:rows.slice(p.offset,end),headers:['Name','Colour space'],cursor:{revision},hasMore:end<rows.length,nextOffset:end};
  }
  assert.equal(p.cursor.revision,revision);
  if(p.role===0&&stale){stale=false;revision++;throw new OutcomeError('Model changed between pages; restart inspection','Fail');}
  assert.equal(p.offset,revision===1?0:129);
  return {available:true,value:p.role===274?'asset-id-'+revision:'Rec.709-'+revision};
 };
 const result=await readModelValues(n,{id:'bin'},'plate',[{column:0,role:274},{header:/colou?r\s*space/i,role:0}]);
 assert.equal(result.row.row,129);assert.deepEqual(result.values.map(v=>v.value),['asset-id-2','Rec.709-2'],'No value from the stale cursor survives');assert.equal(result.readRestarts.length,1);assert.equal(calls.filter(c=>c.op==='model-page'&&c.offset===0).length,2);
});

test('model inspection never retries Unknown, other errors or an unstable second read; duplicate rows fail closed',async()=>{
 for(const error of [new OutcomeError('Model changed between pages; restart inspection','Unknown'),new OutcomeError('Missing owned window','Blocked')]){
  let calls=0;await assert.rejects(()=>readModelValues(async()=>{calls++;throw error;},{id:'bin'},'plate',[{column:0,role:274}]),e=>e===error);assert.equal(calls,1);
 }
 let calls=0;const stale=new OutcomeError('Model changed between pages; restart inspection','Fail');
 await assert.rejects(()=>readModelValues(async()=>{calls++;throw stale;},{id:'bin'},'plate',[{column:0,role:274}]),e=>e===stale);assert.equal(calls,2);
 await assert.rejects(()=>modelEntry(async()=>({offset:0,model:[['plate'],['plate']],cursor:{revision:1},hasMore:false}),{id:'bin'},'plate'),e=>e.status==='Blocked'&&/ambiguous/.test(e.message));
 await assert.rejects(()=>modelEntry(async()=>({offset:0,model:[['plate']],cursor:{revision:1},hasMore:true,nextOffset:0}),{id:'bin'},'plate'),e=>e.status==='Blocked'&&/pagination/.test(e.message));
 let values=0;await assert.rejects(()=>readModelValues(async()=>{values++;return {offset:0,model:[['plate']],headers:['Colour space','Color space'],cursor:{revision:1},hasMore:false};},{id:'bin'},'plate',[{header:/colou?r\s*space/i,role:0}]),/ambiguous/);assert.equal(values,1,'Ambiguous columns never dispatch a value read');
});

test('the colour-column consumer still rejects a wrong asset or missing Rec.709 and keeps its sidecar and screenshot witnesses',async()=>{
 const source=await readFile(new URL('../desktop/check-media-search-ui.mjs',import.meta.url),'utf8'),start=source.indexOf("await check('D-MEDIA-COLOR-COLUMN'"),end=source.indexOf("\nawait check('D-TRANSCRIPT-SEARCH'",start);
 assert.ok(start>0&&end>start);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('check','clearSearch','unique','ui','modelValues','s','assert','readJSON','path','observe','capture',source.slice(start,end));
 for(const [asset,colour,sidecar,passes]of [['expected','Rec.709','Rec.709',true],['wrong','Rec.709','Rec.709',false],['expected','unknown','Rec.709',false],['expected','Rec.709','unknown',false]]){
  let captured=0,observed=0;
  const execute=()=>run(async(_id,fn)=>fn(),async()=>{},()=>({id:'bin'}),async()=>({}),async()=>({row:{view:{id:'bin'},page:{headers:['Name','Colour space']}},columns:[0,1],values:[{available:true,type:'QString',value:asset},{available:true,value:colour}],readRestarts:[]}),{assets:{plate:'expected'},bundle:'/synthetic'},assert,async()=>({colour:sidecar}),{join:()=>'/synthetic/sidecar'},async()=>{observed++;},async()=>{captured++;});
  if(passes){await execute();assert.equal(captured,1);assert.equal(observed,1);}else{await assert.rejects(execute);assert.equal(captured,0);}
 }
});
