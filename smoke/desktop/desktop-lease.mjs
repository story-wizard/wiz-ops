import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {nativeInputDriver} from './macos-input.mjs';
import {OutcomeError} from '../runner/engine.mjs';

// The kernel releases flock when the helper exits; stdin EOF follows launcher exit.
export async function acquireDesktopLease(dataDir){
 const {driver}=await nativeInputDriver(dataDir),child=spawn(driver,['--desktop-lease'],{stdio:['pipe','pipe','ignore']});
 const closed=new Promise(resolve=>child.once('close',resolve)),lines=createInterface({input:child.stdout});
 let timer,receipt;
 try{receipt=await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(new OutcomeError('Foreground lease helper did not respond.','Blocked')),5000);
  child.once('error',reject);child.once('close',()=>reject(new OutcomeError('Foreground lease helper exited before readiness.','Blocked')));
  lines.once('line',line=>{try{const r=JSON.parse(line);r.status==='Acquired'?resolve(r):reject(new OutcomeError(r.error||'Desktop is occupied.','Blocked'));}catch(e){reject(e);}});
 });}catch(e){child.stdin.end();child.kill('SIGTERM');await closed;throw e;}finally{clearTimeout(timer);lines.close();}
 receipt.driver=driver;
 return {receipt,release:async()=>{child.stdin.end();await closed;}};
}
export function verifyDesktopLease(session){
 const lease=session.desktopLease;
 if(!lease?.pid||!lease.started||!lease.driver)throw new OutcomeError('This session has no shared desktop lease. Start a new prepared session.','Blocked');
 try{
  const command=execFileSync('/bin/ps',['-p',String(lease.pid),'-o','comm='],{encoding:'utf8'}).trim();
  const started=execFileSync('/bin/ps',['-p',String(lease.pid),'-o','lstart='],{encoding:'utf8'}).trim();
  if(command!==lease.driver||started!==lease.started)throw Error('Lease owner changed');
 }catch(cause){
  const denied=['EPERM','EACCES'].includes(cause.code),error=new OutcomeError(denied?'Process inspection was denied; the foreground lease could not be verified. Check scoped process access before restarting.':'The foreground session lease ended. Inspect and stop its app before restarting.','Blocked');
  error.code=denied?'lease_inspection_denied':'desktop_lease_ended';error.origin=denied?'environment':'harness';error.nextActions=['inspect'];throw error;
 }
}
