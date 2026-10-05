import path from 'node:path';
import {mkdir,realpath} from 'node:fs/promises';
import {controlProtocol,prepareControlFixture,scoreControlTask} from '../desktop/control-comparison.mjs';
import {externalPath,readJSON,writeJSON,sha,inside} from '../runner/files.mjs';
import {assert} from '../runner/engine.mjs';

const [operation,...args]=process.argv.slice(2);
if(operation==='protocol'&&!args.length)console.log(JSON.stringify(controlProtocol,null,2));
else if(operation==='verify-baseline'&&args.length===1){
 const root=await realpath(args[0]);
 for(const [name,hash] of Object.entries(controlProtocol.baseline.files))assert(await sha(path.join(root,name))===hash,'Frozen baseline changed: '+name);
 const identity=await readJSON(path.join(root,'identity.json'));assert(identity.packageSha256===controlProtocol.baseline.packageSha256,'Baseline package differs');
 const manifest=await readJSON(path.join(root,'SHA256.json'));
 for(const [name,hash] of Object.entries(manifest)){
  const file=await realpath(path.join(root,name));assert(inside(root,file),'Baseline artifact escaped its directory');assert(await sha(file)===hash,'Baseline artifact changed: '+name);
 }
 console.log(JSON.stringify({verified:true,baseline:controlProtocol.baseline.id,files:Object.keys(manifest).length,packageHash:identity.packageSha256}));
}else if(operation==='score'&&args.length===1)console.log(JSON.stringify(scoreControlTask(await readJSON(args[0])),null,2));
else if(operation==='fixture'&&args.length===5){
 const [session,task,lane,round,out]=args,directory=externalPath(out);
 // Refuse to overwrite evidence from an earlier attempt, including failed setup.
 await mkdir(directory,{recursive:false});
 try{const fixture=await prepareControlFixture(session,{task,lane,round:Number(round)});await writeJSON(path.join(directory,'fixture.json'),fixture);console.log(JSON.stringify({ready:true,fixture:path.join(directory,'fixture.json'),protocol:fixture.protocol}));}
 catch(e){await writeJSON(path.join(directory,'setup-failure.json'),{status:e.status||'Blocked',error:e.message,diagnostics:e.diagnostics||null});throw e;}
}else throw Error('Usage: control-comparison.mjs protocol | verify-baseline DIRECTORY | score TASK.json | fixture SESSION.json TASK LANE ROUND NEW_EXTERNAL_DIRECTORY');
