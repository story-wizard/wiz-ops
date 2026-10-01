import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Uses the dashboard's admission path: no second runner or silent package fallback.
export async function startPrepared({app,planHash,operator,base='http://127.0.0.1:4317'}){
 const url=new URL(base);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use a local loopback smoke service URL.');
 if(!app||!path.isAbsolute(app)||!/^[a-f0-9]{64}$/.test(planHash||'')||typeof operator!=='string'||!operator.trim()||operator.length>120)throw Error('Explicit --app PATH, --plan-hash SHA256 and --operator NAME are required.');
 const call=async(route,body)=>{
  let response;try{response=await fetch(new URL(route,url),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}
  catch(e){throw Error(body?'Start response lost; outcome unknown. Inspect run history before retrying.':e.message);}
  let value;try{value=await response.json();}catch{throw Error(body?'Start response unreadable; outcome unknown. Inspect run history before retrying.':'Unreadable readiness response.');}
  if(!response.ok)throw Error(value.error||'Smoke service rejected the request.');
  return value;
 };
 const status=await call('/api/runner');
 if(status.active)throw Error('A packaged course is already active.');
 if(!status.prepared||status.plan?.planHash!==planHash||status.plan.app!==await realpath(app))throw Error('Selected package or prepared plan differs. Prepare and review the intended build again.');
 const receipt=await call('/api/runner/start',{planHash,operator:operator.trim()});
 if(typeof receipt.runId!=='string')throw Error('Start receipt has no run ID; outcome unknown. Inspect run history before retrying.');
 return {runId:receipt.runId,app:status.plan.app,packageHash:status.plan.packageHash,planHash,execution:'Admitted; preflight and test results are still pending'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),allowed=['--app','--plan-hash','--operator','--server'];
 try{
  const values={};for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||!args[i+1]||values[args[i]])throw Error('Usage: npm run smoke:run -- --app /path/Wizard.app --plan-hash SHA256 --operator NAME [--server http://127.0.0.1:4317]');values[args[i]]=args[i+1];}
  console.log(JSON.stringify(await startPrepared({app:values['--app'],planHash:values['--plan-hash'],operator:values['--operator'],base:values['--server']}),null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
