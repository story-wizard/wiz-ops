import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {bundleHarness,checkHarnessBundle,installHarness} from '../runner/harness.mjs';
import {dataDirectory,readJSON} from '../runner/files.mjs';
import {openDashboard} from '../runner/browser.mjs';

export async function main(args){
 const action=args.shift(),flags={};
 for(let i=0;i<args.length;i++){const key=args[i];if(key==='--no-open'&&!flags[key]){flags[key]=true;continue;}if(!['--runtime','--out','--bundle','--data-dir','--port','--browser'].includes(key)||flags[key]||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid option: '+key);flags[key]=args[++i];}
 const allowed={bundle:['--runtime','--out'],check:['--bundle'],install:['--bundle','--data-dir'],start:['--data-dir','--port','--browser','--no-open']};
 if(!allowed[action]||Object.keys(flags).some(k=>!allowed[action].includes(k))||(flags['--no-open']&&flags['--browser']))throw Error('Usage: harness bundle --runtime FILE --out DIR | check --bundle DIR | install --bundle DIR [--data-dir DIR] | start [--data-dir DIR] [--port PORT] [--browser default|choose|/path/Browser.app | --no-open]');
 const required=k=>{if(!flags[k])throw Error('Required option: '+k);return flags[k];};
 if(action==='bundle'){const input=await readJSON(required('--runtime'));return bundleHarness({runtime:input.runtime||input,destination:required('--out')});}
 if(action==='check'){const {base,manifest}=await checkHarnessBundle(required('--bundle'));return {path:base,id:manifest.id,verified:true,wizardLaunched:false};}
 if(action==='install')return installHarness(required('--bundle'),flags['--data-dir']);
 const data=dataDirectory(flags['--data-dir']),configuration=await readJSON(path.join(data,'desktop-runtime.json'));
 if(!configuration.harness?.workspace)throw Error('Install a harness bundle before starting the bundled dashboard.');
 const {base}=await checkHarnessBundle(path.dirname(configuration.harness.workspace));
 const port=flags['--port']||'4317';if(!/^\d+$/.test(port)||Number(port)>65535)throw Error('Port must be 0–65535.');
 const child=spawn(process.execPath,[path.join(base,'workspace/server.mjs')],{cwd:path.join(base,'workspace'),env:{...process.env,SMOKE_DATA_DIR:data,PORT:port},stdio:['inherit','inherit','inherit','ipc']});
 child.once('message',async message=>{
  if(message.type!=='listening'||flags['--no-open'])return;
  try{const result=await openDashboard(message.url,data,{browser:flags['--browser']});console.log(result.cancelled?'Browser selection cancelled. Open '+message.url+' when ready.':'Opened Athanor in '+result.browser+'.');}
  catch(e){console.error('Could not open the browser: '+e.message+' Dashboard: '+message.url);}
 });
 const stop=()=>child.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0||signal==='SIGTERM'?resolve():reject(Error('Dashboard exited '+code)));});}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
 return {stopped:true,wizardLaunched:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify({format:'wizard-smoke-harness-cli/v1',result:await main(process.argv.slice(2))},null,2));}
 catch(e){console.error(JSON.stringify({format:'wizard-smoke-harness-cli/v1',error:e.message}));process.exitCode=3;}
}
