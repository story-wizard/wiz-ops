import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {externalPath} from '../runner/files.mjs';

export function resultSummary(run){
 const state=run.execution?.state;if(!state)throw Error('This is not an automated run.');
 const complete=!['Queued','Preflight','Running','Waiting for human','Continuing'].includes(state);
 const counts=run.results.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{});
 return {runId:run.id,state,complete,needsHuman:state==='Waiting for human',checkpoint:run.checkpoint||null,exitCode:!complete?4:state==='Passed'&&run.results.length>0&&run.results.every(r=>r.status==='Pass')?0:state==='Failed'?1:2,counts,build:run.build,selection:run.execution.recipe.selection||null,results:run.results.map(r=>({id:r.test_id,title:r.snapshot.title,status:r.status,observation:r.note}))};
}
export function client(base='http://127.0.0.1:4317'){
 const url=new URL(base);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use a local loopback smoke service.');
 return async(route,body)=>{
  let response;try{response=await fetch(new URL(route,url),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(route==='/api/plans'||route.endsWith('/kit')?300000:20000)});}
  catch(e){throw Error(body?'Response lost; inspect the request or saved records before retrying. No automatic retry was made.':'Local smoke service unavailable. Start it with npm start. '+e.message);}
  let value;try{value=await response.json();}catch{throw Error(body?'Response unreadable; outcome unknown. Inspect saved records before retrying.':'Unreadable service response.');}
  if(!response.ok)throw Error(value.error||'Request failed');return value;
 };
}
export async function waitForRun(call,id,{timeout=300,pollMs=1000}={}){
 if(!Number.isFinite(timeout)||timeout<0||timeout>3600)throw Error('Wait timeout must be 0–3600 seconds.');
 const deadline=Date.now()+timeout*1000;
 while(true){const summary=resultSummary(await call('/api/runs/'+encodeURIComponent(id)));if(summary.complete||summary.needsHuman)return summary;if(Date.now()>=deadline)return {...summary,waitTimedOut:true};await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(1,deadline-Date.now()))));}
}
export async function main(args){
 const command=args.shift(),sub=command==='course'?args.shift():null,flags={};
 const boolean=new Set(['--wait','--json']);
 for(let i=0;i<args.length;i++){const key=args[i];if(!key.startsWith('--')||Object.hasOwn(flags,key))throw Error('Invalid or duplicate option: '+key);if(boolean.has(key))flags[key]=true;else{const value=args[++i];if(!value||value.startsWith('--'))throw Error('Missing value for '+key);flags[key]=value;}}
 const options={list:['--category','--target'],checkpoints:[],checkpoint:['--run','--action','--file'],runtimes:[],runtime:['--file'],courses:[],course:sub==='save'?['--file']:['--id','--revision'],plan:['--app','--course','--checks','--category','--project','--file','--out','--title','--runtime','--target','--checkpoint'],run:['--plan-hash','--plan','--operator','--request-id','--wait','--timeout'],status:['--run','--request-id'],wait:['--run','--timeout'],cancel:['--run'],report:['--run'],kit:['--run']};
 if(!options[command]||Object.keys(flags).some(k=>!['--server','--json',...options[command]].includes(k)))throw Error('Usage: smoke list | courses | course show/save | plan | run | status | wait | cancel | report | kit | runtimes | runtime | checkpoints | checkpoint. See docs/agent-courses.md.');
 const call=client(flags['--server']),required=key=>{if(!flags[key])throw Error('Required option: '+key);return flags[key];},split=k=>(flags[k]||'').split(',').map(s=>s.trim()).filter(Boolean),runID=()=>required('--run');
 let result;
 if(command==='list'){result=await call('/api/checks');if(flags['--category']){const cat=flags['--category'].toLowerCase().replace(/^color$/,'colour');result.checks=result.checks.filter(c=>c.categories.some(s=>s.toLowerCase()===cat));}}
 if(command==='list'&&flags['--target'])result.checks=result.checks.filter(c=>c.target===flags['--target']);
 if(command==='checkpoints')result=await call('/api/checkpoints');
 if(command==='checkpoint'){const route='/api/runs/'+encodeURIComponent(runID())+'/checkpoint';if(flags['--action'])result=await call(route+'/'+flags['--action'],JSON.parse(await readFile(required('--file'),'utf8')));else result=await call(route);}
 if(command==='runtimes')result=await call('/api/runtimes');
 if(command==='runtime')result=await call('/api/runtimes',JSON.parse(await readFile(required('--file'),'utf8')));
 if(command==='courses')result=await call('/api/courses');
 if(command==='course'){
  if(sub==='save')result=await call('/api/courses',JSON.parse(await readFile(required('--file'),'utf8')));
  else if(sub==='show')result=await call('/api/courses/'+encodeURIComponent(required('--id'))+(flags['--revision']?'?revision='+encodeURIComponent(flags['--revision']):''));
  else throw Error('Use course show or course save.');
 }
 if(command==='plan'){
  const output=flags['--out']?externalPath(path.resolve(flags['--out'])):null;
  const selection=flags['--file']?JSON.parse(await readFile(flags['--file'],'utf8')):{courseIds:split('--course'),checkIds:split('--checks'),categories:split('--category'),project:flags['--project']||'fresh',...(flags['--checkpoint']?{checkpoint:flags['--checkpoint']}:{}),...(flags['--target']?{target:flags['--target']} : {}),...(flags['--title']?{title:flags['--title']}:{})};
  if(flags['--file']&&['--course','--checks','--category','--project','--title','--target','--checkpoint'].some(k=>flags[k]))throw Error('Use a selection file or selection flags, not both.');
  result=await call('/api/plans',{app:required('--app'),selection,...(flags['--runtime']?{runtime:JSON.parse(await readFile(flags['--runtime'],'utf8'))}:{})});
  if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 }
 if(command==='run'){
  if(Boolean(flags['--plan'])===Boolean(flags['--plan-hash']))throw Error('Choose exactly one of --plan or --plan-hash.');
  const planHash=flags['--plan']?JSON.parse(await readFile(flags['--plan'],'utf8')).planHash:flags['--plan-hash'],requestId=flags['--request-id']||randomUUID();
  try{result={...await call('/api/runner/start',{planHash,operator:required('--operator'),requestId}),state:'Admitted',complete:false,exitCode:4};}
  catch(e){throw Object.assign(e,{requestId});}
  if(flags['--wait'])result={...await waitForRun(call,result.runId,{timeout:Number(flags['--timeout']||300)}),requestId};
 }
 if(command==='status'){
  if(Boolean(flags['--run'])===Boolean(flags['--request-id']))throw Error('Choose --run or --request-id.');
  result=resultSummary(await call(flags['--run']?'/api/runs/'+encodeURIComponent(flags['--run']):'/api/requests/'+encodeURIComponent(flags['--request-id'])));
 }
 if(command==='wait')result=await waitForRun(call,runID(),{timeout:Number(flags['--timeout']||300)});
 if(command==='cancel')result={...await call('/api/runner/stop',{runId:runID()}),complete:false,exitCode:4};
 if(command==='kit')result=await call('/api/runs/'+encodeURIComponent(runID())+'/kit',{});
 if(command==='report')result=await call('/api/runs/'+encodeURIComponent(runID())+'/report',{});
 if(['run','wait'].includes(command)&&(result.complete||result.needsHuman)){
  try{result.report=await call('/api/runs/'+encodeURIComponent(result.runId)+'/report',{});}
  catch(e){result.report={publication:'Local report failed',error:e.message};}
 }
 return {format:'wizard-smoke-cli/v1',command,result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const envelope=await main(process.argv.slice(2));console.log(JSON.stringify(envelope,null,2));process.exitCode=envelope.result?.exitCode||0;}
 catch(e){console.log(JSON.stringify({format:'wizard-smoke-cli/v1',error:e.message,requestId:e.requestId||null,exitCode:3}));process.exitCode=3;}
}
