import path from 'node:path';
import {mkdir,readFile,appendFile,readdir} from 'node:fs/promises';
import {executeDesktop} from '../desktop/run.mjs';
import {executeService} from '../desktop/service-run.mjs';
import {writeJSON,readJSON} from './files.mjs';
import {targetFor} from './catalog.mjs';

export async function executeStages({plan,course,root,dataDir,onResult,isCancelled,signal,onStage=()=>{}}){
 const results=[];
 for(const target of ['service','desktop']){
  const selected=course.cases.filter(c=>targetFor(c.id)===target);if(!selected.length)continue;
  if(isCancelled()){for(const c of selected){const r={id:c.id,status:'Blocked',note:'Cancelled before this stage.'};results.push(r);await onResult(c,r.status,r.note);}continue;}
  onStage(target,selected.length);
  const directory=path.join(root,'stages',target);await mkdir(directory,{recursive:true});
  let observed=0,busy=false;
  const poll=async()=>{if(busy)return;busy=true;try{
   const names=await readdir(directory);if(!names.length)return;
   const file=path.join(directory,names[0],'check-events.jsonl');let lines;try{lines=(await readFile(file,'utf8')).trim().split('\n');}catch(e){if(e.code==='ENOENT')return;throw e;}
   for(const line of lines.slice(observed)){let event;try{event=JSON.parse(line);}catch{break;}
    observed++;const c=selected.find(c=>c.id===event.id);if(c){const reopens=['D-MEDIA-RELINK','D-DOCUMENT-EDIT','D-SB-TAB-RENAME','D-BIN-RENAME','D-BIN-DUPLICATE','D-BIN-DELETE','D-BIN-MGFX'];if(event.status!=='Pass'||!reopens.includes(c.id))await onResult(c,event.status,event.error||(event.status==='Running'?'Executing '+target+' check.':'Recorded '+target+' observation; course still in progress.'));}
   }
  }finally{busy=false;}};
  // Poll local receipts only. The executor owns all application mutations.
  const timer=setInterval(()=>void poll().catch(()=>{}),500);
  try{
   const execute=target==='desktop'?executeDesktop:executeService;
   const result=await execute({plan,dataDir,runtime:plan.runtime,directory,ids:selected.map(c=>c.id)},{isCancelled,signal});
   clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,10));await poll();
   await writeJSON(path.join(directory,'stage.json'),{target,root:result.root,report:result.report,sessionFile:result.sessionFile});
   for(const filename of ['operations.jsonl','native-events.jsonl','steps.jsonl']){
    let text;try{text=await readFile(path.join(result.root,filename),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
    for(const line of text.split('\n').filter(Boolean)){const receipt=JSON.parse(line);await appendFile(path.join(root,filename==='steps.jsonl'?'steps.jsonl':'operations.jsonl'),JSON.stringify({...receipt,caseId:receipt.caseId||'stage-setup',stage:target,...(filename==='steps.jsonl'?{}:{operation:receipt.operation||'native.'+receipt.request.op})})+'\n');}
   }
   let events=[];try{events=(await readFile(path.join(result.root,'check-events.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
   for(const c of selected){
    let observation=result.report.results.find(r=>r.id===c.id);const last=events.findLast(r=>r.id===c.id);
    if(last?.status==='Running')observation={id:c.id,status:'Unknown',error:'Check started but no terminal observation was retained.'};
    else if(last&&(!observation||observation.status==='Blocked'))observation=last;
    const status=observation?.status||'Blocked';
    const r={id:c.id,status,note:observation?.error||result.report.error||('Independent '+target+' assertions completed; see retained stage evidence.')};
    await appendFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:c.id,operation:'check.observation',stage:target,status:r.status,evidence:observation?.evidence||null,source:path.join(result.root,'desktop-course-report.json')})+'\n');
    results.push(r);await onResult(c,r.status,r.note);
   }
   if(results.some(r=>r.status==='Unknown'))throw Object.assign(Error('Uncertain stage outcome; later stages were not started.'),{status:'Unknown'});
   if(result.report.cleanupError)throw Object.assign(Error('Owned desktop cleanup requires inspection: '+result.report.cleanupError),{status:'Unknown'});
   if(result.report.error||result.report.status!=='Pass'&&!result.report.results.some(r=>['Fail','Blocked'].includes(r.status)))throw Object.assign(Error('Stage did not complete: '+(result.report.error||result.report.status)),{status:'Fail'});
  }finally{clearInterval(timer);}
 }
 return results;
}
