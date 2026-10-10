import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveWorkerProfile,workerClient,workerRun,checkWorkerProfile} from '../runner/worker.mjs';
import {readJSON} from '../runner/files.mjs';
import {main as harness} from './harness.mjs';

export async function main(args){
 const command=args.shift(),flags={};
 for(let i=0;i<args.length;i++){const key=args[i],value=args[++i];if(!key?.startsWith('--')||Object.hasOwn(flags,key)||!value||value.startsWith('--'))throw Error('Invalid worker option.');flags[key]=value;}
 const allowed={init:['--name','--data-dir','--port','--out'],check:['--profile'],serve:['--profile'],status:['--profile'],run:['--profile','--plan-hash','--request-id','--operator']};
 if(!allowed[command]||Object.keys(flags).some(k=>!allowed[command].includes(k)))throw Error('Usage: worker init --name NAME --data-dir DIR --out FILE [--port PORT] | check/serve/status/run --profile FILE. See docs/workers.md.');
 const required=k=>{if(!flags[k])throw Error('Required option: '+k);return flags[k];};
 if(command==='init')return saveWorkerProfile(required('--out'),{name:required('--name'),dataDir:required('--data-dir'),port:Number(flags['--port']||4317)});
 const file=required('--profile');
 if(command==='check')return {...await checkWorkerProfile(await readJSON(file)),sourceVerified:true,wizardLaunched:false};
 if(command==='serve'){const profile=await checkWorkerProfile(await readJSON(file));process.env.ATHANOR_WORKER_NAME=profile.name;return harness(['serve','--data-dir',profile.dataDir,'--port',String(profile.port),'--no-open']);}
 const {call}=await workerClient(file);
 return command==='status'?call('/api/worker'):workerRun(call,{planHash:required('--plan-hash'),requestId:required('--request-id'),operator:required('--operator')});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify({format:'athanor-worker-cli/v1',result:await main(process.argv.slice(2))},null,2));}
 catch(error){console.error(JSON.stringify({format:'athanor-worker-cli/v1',error:error.message}));process.exitCode=3;}
}
