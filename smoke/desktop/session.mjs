import {prepareDesktop,launchDesktop,desktopCall,stopDesktop,nativeCall} from './adapter.mjs';
import {readJSON} from '../runner/files.mjs';
const [action,target,operation,params]=process.argv.slice(2);
if(action==='start'||action==='resume'){
  const session=action==='start'?await prepareDesktop(target,operation):await readJSON(target);
  const {child,closed}=await launchDesktop(session);
  const stop=()=>child.kill('SIGTERM');process.on('SIGTERM',stop);process.on('SIGINT',stop);
  // An unattended agent session must not leave a GUI process running indefinitely.
  const limit=setTimeout(stop,30*60*1000);await closed;clearTimeout(limit);
}else if(action==='call')console.log(JSON.stringify(await desktopCall(target,operation,JSON.parse(params||'{}')),null,2));
else if(action==='native')console.log(JSON.stringify(await nativeCall(target,operation,JSON.parse(params||'{}')),null,2));
else if(action==='stop')await stopDesktop(target);
else throw new Error('Usage: start SOURCE.app [COCOA_PLUGIN] | resume SESSION.json | call SESSION.json operation JSON | native SESSION.json operation JSON | stop SESSION.json');
