import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReportViewer} from '../runner/report-viewer.mjs';
export function main(args){
 const flags={};for(let i=0;i<args.length;i+=2){if(!['--directory','--port'].includes(args[i])||flags[args[i]]||!args[i+1])throw Error('Use report-viewer --directory EXTERNAL_DIR --port PORT.');flags[args[i]]=args[i+1];}
 const port=Number(flags['--port']||0);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid viewer port.');
 const server=createReportViewer(flags['--directory']);server.listen(port,'127.0.0.1',()=>console.log('Athanor reports: http://127.0.0.1:'+server.address().port+'/'));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=3;}
