import {OutcomeError} from '../runner/engine.mjs';

export async function modelEntry(n,view,match){
 let cursor,offset=0,matches=[];
 do{
  const page=await n('model-page',{target:view.id,offset,limit:64,...(cursor?{cursor}:{})});cursor=page.cursor;
  page.model.forEach((r,i)=>{if(typeof match==='function'?match(r):r[0]===match)matches.push({view,page,row:offset+i,values:r});});
  if(!page.hasMore)break;offset=page.nextOffset;
  if(!Number.isInteger(offset)||offset<=page.offset||offset>4096)throw new OutcomeError('Media observation exceeds the bounded fixture size or has invalid pagination','Blocked');
 }while(true);
 if(matches.length!==1)throw new OutcomeError('Model row is absent or ambiguous: '+String(match),'Blocked');return matches[0];
}

// Re-observe only an explicitly rejected stale read, once. Rebind every role to
// the same new row/cursor; never reuse partial values, replay input or retry Unknown.
export async function readModelValues(n,view,match,requests){
 if(!Array.isArray(requests)||!requests.length||requests.length>8)throw new OutcomeError('Choose 1–8 model role reads','Blocked');
 const readRestarts=[];
 for(let attempt=0;attempt<2;attempt++){
  try{
   const row=await modelEntry(n,view,match),values=[],columns=[];
   for(const request of requests){
    let column=request.column;
    if(request.header instanceof RegExp){
     const matches=row.page.headers.map((h,i)=>({h,i})).filter(({h})=>new RegExp(request.header.source,request.header.flags.replace(/[gy]/g,'')).test(h));
     if(matches.length!==1)throw new OutcomeError('Model column is absent or ambiguous: '+request.header,'Blocked');column=matches[0].i;
    }
    if(!Number.isInteger(column)||column<0||column>63||!Number.isInteger(request.role)||request.role<0||request.role>1280)throw new OutcomeError('Choose a bounded model column and role','Blocked');
    values.push(await n('model-value',{target:view.id,offset:row.row,column,role:request.role,cursor:row.page.cursor}));columns.push(column);
   }
   return {row,values,columns,readRestarts};
  }catch(e){
   if(attempt||e.status==='Unknown'||e.message!=='Model changed between pages; restart inspection')throw e;
   readRestarts.push({error:e.message,attempt:attempt+1});
  }
 }
}
