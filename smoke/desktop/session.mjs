import {prepareDesktop,launchDesktop,desktopCall,stopDesktop,nativeCall} from './adapter.mjs';
import {checkPrepared} from '../runner/prepare.mjs';
import {readJSON} from '../runner/files.mjs';
const [action,target,operation,params]=process.argv.slice(2);
if(action==='start'||action==='resume'){
  let session;
  if(action==='resume')session=await readJSON(target);
  else if(target==='--plan'){const prepared=await checkPrepared(undefined,await readJSON(operation)),runtime=prepared.plan.runtime;if(!runtime)throw Error('Prepare a desktop selection before opening an atomic-tool session.');session=await prepareDesktop(runtime.app,runtime.qtPlugin,runtime.cli,{plan:prepared.plan});}
  else session=await prepareDesktop(target,operation);
  const {child,closed}=await launchDesktop(session);
  const stop=()=>child.kill('SIGTERM');process.on('SIGTERM',stop);process.on('SIGINT',stop);
  // An unattended agent session must not leave a GUI process running indefinitely.
  const limit=setTimeout(stop,30*60*1000);await closed;clearTimeout(limit);
}else if(action==='call')console.log(JSON.stringify(await desktopCall(target,operation,JSON.parse(params||'{}')),null,2));
else if(action==='native')console.log(JSON.stringify(await nativeCall(target,operation,JSON.parse(params||'{}')),null,2));
else if(action==='stop')await stopDesktop(target);
else if(action==='schema')console.log(JSON.stringify(await readJSON(new URL('../runner/contracts/desktop-schema.json',import.meta.url)),null,2));
else throw new Error('Usage: schema | start --plan PLAN.json | start SOURCE.app [COCOA_PLUGIN] | resume SESSION.json | call SESSION.json operation JSON | native SESSION.json operation JSON | stop SESSION.json');
