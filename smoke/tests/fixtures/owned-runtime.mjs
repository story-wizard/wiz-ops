import path from 'node:path';
import {copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';

// Keep an explicitly ready owned process for the exact ownership checks.
export async function ownedRuntime(t,executable){
 await copyFile(process.execPath,executable);
 // A shared Homebrew runtime keeps its original private library search roots.
 const env={...process.env,...process.platform==='darwin'?{DYLD_LIBRARY_PATH:[path.dirname(process.execPath),path.resolve(path.dirname(process.execPath),'../lib'),process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')}:{}};
 const child=spawn(executable,['-e','process.stdout.write("ready\\n");setInterval(()=>{},1000)'],{env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',spawnError;
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
 child.on('error',error=>{spawnError=error;});
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-65536);});
 const diagnostics=()=>JSON.stringify({pid:child.pid,code:child.exitCode,signal:child.signalCode,error:spawnError?.message,stdout,stderr});
 const stop=async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');return closed;};
 t.after(stop);
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Owned fixture runtime did not become ready: '+diagnostics())),5000);
   const finish=error=>{clearTimeout(timer);child.stdout.off('data',read);child.off('error',failed);child.off('close',exited);error?reject(error):resolve();};
   const read=chunk=>{stdout=(stdout+chunk).slice(-65536);if(stdout==='ready\n')finish();};
   const failed=error=>finish(Error('Owned fixture runtime spawn failed: '+error.message+' '+diagnostics()));
   const exited=()=>finish(Error('Owned fixture runtime exited before readiness: '+diagnostics()));
   child.stdout.on('data',read);child.once('error',failed);child.once('close',exited);
  });
  if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned fixture runtime is no longer alive: '+diagnostics());
  return child;
 }catch(error){await stop();throw error;}
}
