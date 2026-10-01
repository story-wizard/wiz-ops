// Bounded, read-only projection. No reconciliation, source hashing, logs or process control.
import {readFileSync,statSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const activeStates=new Set(['Queued','Preflight','Running']);
const terminal=new Set(['Pass','Fail','Blocked','Unknown','N/A']);
const cache=new Map();
function json(file){
  if(!existsSync(file))return null;
  const stat=statSync(file);if(stat.size>2_000_000)throw Error('Live record exceeds its size limit.');
  const stamp=`${stat.mtimeMs}:${stat.size}`,old=cache.get(file);if(old?.stamp===stamp)return old.value;
  const value=JSON.parse(readFileSync(file,'utf8'));
  if(cache.size>=256)cache.clear();cache.set(file,{stamp,value});return value;
}
function directories(base,pattern){
  if(!existsSync(base))return [];
  return readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()&&pattern.test(d.name)).map(d=>path.join(base,d.name))
    .sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs).slice(0,100);
}
function progress(state,rows,at,updated,phase=''){
  const counts={};for(const r of rows)counts[r.status]=(counts[r.status]||0)+1;
  const current=activeStates.has(state)?rows.filter(r=>r.status==='Running').sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0]:null;
  return {planned:rows.length,completed:rows.filter(r=>terminal.has(r.status)).length,counts,
    currentCheckID:current?.id||null,phase:phase||state,startedAt:at,
    lastActivity:[updated,...rows.map(r=>r.updatedAt)].filter(Boolean).sort().at(-1)||at,
    finishedAt:activeStates.has(state)?null:updated||null};
}
function databaseRun(db,run,detail){
  const execution=db.prepare('SELECT state,updated_at,message,course_json FROM executions WHERE run_id=?').get(run.id);
  const recipe=JSON.parse(execution.course_json),cases=recipe.cases||[];
  const rows=db.prepare(`SELECT test_id,status,updated_at${detail?',snapshot,note':''} FROM results WHERE run_id=? ORDER BY rowid`).all(run.id);
  const starts=new Map(db.prepare("SELECT test_id,MAX(created_at) AS at FROM result_events WHERE run_id=? AND status='Running' GROUP BY test_id").all(run.id).map(r=>[r.test_id,r.at]));
  const results=rows.map(r=>{const frozen=detail?JSON.parse(r.snapshot):{},definition=cases.find(c=>c.id===r.test_id)||{};return {id:r.test_id,status:r.status,updatedAt:r.updated_at,startedAt:starts.get(r.test_id)||null,
    ...(detail?{title:definition.title||frozen.title||r.test_id,expected:definition.expected||frozen.expected||'',observation:r.note||'',canPrepare:false}: {})};});
  const order=new Map(cases.map((c,i)=>[c.id,i]));results.sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
  const current=results.find(r=>r.status==='Running'),target=cases.find(c=>c.id===current?.id)?.target;
  const phase=({packaged:'Packaged engine',service:'Background services',desktop:'Desktop editor'})[target]||execution.message||execution.state;
  const live=progress(execution.state,results,run.created_at,execution.updated_at,phase);
  return {id:run.id,title:run.name,kind:cases.some(c=>c.target&&c.target!=='packaged')?'composed':'packaged',at:run.created_at,target:recipe.target||'',build:run.build,state:execution.state,context:execution.message||'',revision:recipe.revision||0,live,...(detail?{results}:{})};
}
function desktopRuns(dataDir,definitions,selected){
  return directories(path.join(dataDir,'desktop-runs'),/^desktop-[A-Za-z0-9]+$/).flatMap(root=>{
    const session=json(path.join(root,'session.json'));if(!session)return [];
    const report=json(path.join(root,'desktop-course-report.json')),id=path.basename(root);
    const cases=report?.course?.cases||definitions.filter(c=>(session.selectedChecks||[]).includes(c.id));
    const ids=report?.course?.cases?.map(c=>c.id)||session.selectedChecks||[];
    if(!ids.length)return [];
    let events=[];
    const journal=path.join(root,'check-events.jsonl');
    if(existsSync(journal)){
      // These journals contain one small start/end record per check; never read the operations log.
      if(statSync(journal).size>2_000_000)throw Error('Live check journal exceeds its size limit.');
      for(const line of readFileSync(journal,'utf8').split('\n')){if(!line.trim())continue;try{events.push(JSON.parse(line));}catch{break;}}
    }
    const state=report?.status||(session.state==='Running'?'Running':session.state==='Stopped'?'Unknown':'Preflight');
    const results=ids.map(id=>{
      const sequence=events.filter(e=>e.id===id),event=sequence.at(-1),record=report?.results?.find(r=>r.id===id),c=cases.find(c=>c.id===id)||{};
      return {id,title:c.title||id,status:record?.status||event?.status||'Not run',expected:c.expected||'',observation:record?.error||event?.error||'',canPrepare:Boolean(report&&c.steps?.length),
        startedAt:sequence.findLast(e=>e.status==='Running')?.at||null,updatedAt:event?.at||report?.finishedAt||null};
    });
    const at=report?.startedAt||session.startedAt||'',updated=report?.finishedAt||events.at(-1)?.at||at;
    const kind=session.inputMode==='service'?'service':'desktop';
    return [{id,title:report?.course?.title||(kind==='service'?'Background services':'Desktop course'),kind,at,target:report?.scope||session.scope||'',build:`GUI ${(session.guiHash||'').slice(0,12)}`,state,context:report?.error||'',revision:report?.course?.revision||0,
      reportHash:report?createHash('sha256').update(readFileSync(path.join(root,'desktop-course-report.json'))).digest('hex'):null,
      live:progress(state,results,at,updated,kind==='service'?'Background services':'Desktop editor'),results}];
  });
}
export function towerLive({db,dataDir,selected=null,definitions=[]}){
  if(selected!==null&&!/^[A-Za-z0-9-]{1,80}$/.test(selected))throw Object.assign(Error('Invalid run identity.'),{status:400});
  const recent=db.prepare('SELECT r.* FROM runs r JOIN executions e ON e.run_id=r.id ORDER BY r.created_at DESC LIMIT 30').all();
  const active=db.prepare("SELECT r.* FROM runs r JOIN executions e ON e.run_id=r.id WHERE e.state IN ('Queued','Preflight','Running') ORDER BY r.created_at DESC LIMIT 8").all();
  const selectedRow=selected?db.prepare('SELECT r.* FROM runs r JOIN executions e ON e.run_id=r.id WHERE r.id=?').get(selected):null;
  const unique=[...new Map([...recent,...active,...(selectedRow?[selectedRow]:[])].map(r=>[r.id,r])).values()];
  const standalone=desktopRuns(dataDir,definitions,selected);
  const summaries=[...unique.map(r=>databaseRun(db,r,false)),...standalone.map(({results,...r})=>r)].sort((a,b)=>b.at.localeCompare(a.at));
  const activeRun=summaries.find(r=>activeStates.has(r.state))?.id||null;
  const wanted=selected||activeRun||summaries[0]?.id;
  const row=unique.find(r=>r.id===wanted),detail=row?databaseRun(db,row,true):standalone.find(r=>r.id===wanted)||null;
  const jobs=directories(path.join(dataDir,'desktop-jobs'),/^[a-f0-9-]{36}$/).map(root=>json(path.join(root,'job.json'))).filter(j=>j&&['Preparing','Ready','Running'].includes(j.state));
  return {format:'wizard-smoke-live/v1',observedAt:new Date().toISOString(),active:activeRun!==null||jobs.length>0,activeRun,runs:summaries.map(r=>({...r,results:[]})),detail};
}
