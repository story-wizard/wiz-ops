import {nativeUIInput} from '../desktop/macos-input.mjs';
import {prepareUI,recordUI,retainedUI} from '../desktop/computer-use.mjs';
import {readJSON,dataDirectory} from '../runner/files.mjs';
const [command,...args]=process.argv.slice(2),flags={};
try{
 for(let i=0;i<args.length;i+=2){if(!['--run','--data-dir','--file','--checks','--cocoa-plugin','--cocoa-sha256'].includes(args[i])||!args[i+1]||Object.hasOwn(flags,args[i]))throw Error('Invalid option');flags[args[i]]=args[i+1];}
 if(!flags['--run']||!['prepare','status','record','input'].includes(command))throw Error('Use computer-use.mjs prepare|status|record|input --run UUID [--file observation.json].');
 const data=dataDirectory(flags['--data-dir']);
 if(command!=='prepare'&&['--checks','--cocoa-plugin','--cocoa-sha256'].some(k=>flags[k]))throw Error('Runtime and selection options belong to prepare.');
 const result=command==='input'?await nativeUIInput(data,flags['--run'],await readJSON(flags['--file'])):command==='prepare'?await prepareUI(data,flags['--run'],{checks:flags['--checks']?.split(','),cocoaPlugin:flags['--cocoa-plugin'],cocoaSha256:flags['--cocoa-sha256']}):command==='record'?await recordUI(data,flags['--run'],await readJSON(flags['--file'])):await retainedUI(data,flags['--run']);
 console.log(JSON.stringify(result,null,2));
 if(command==='input'&&['Blocked','Unknown'].includes(result.status))process.exitCode=2;
}catch(e){console.error(e.message);process.exitCode=1;}
