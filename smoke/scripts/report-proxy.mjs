import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReportProxy} from '../runner/report-viewer.mjs';
export function main(args){
 const flags={};for(let i=0;i<args.length;i+=2){if(!['--tailscale-ip','--port','--viewer-port'].includes(args[i])||flags[args[i]]||!args[i+1])throw Error('Use report-proxy --tailscale-ip IP --port PORT --viewer-port LOOPBACK_PORT.');flags[args[i]]=args[i+1];}
 const host=flags['--tailscale-ip'],port=Number(flags['--port']);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid proxy port.');
 const server=createReportProxy({host,viewerPort:Number(flags['--viewer-port'])});server.listen(port,host,()=>console.log('Athanor private reports: http://'+host+':'+port+'/'));return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=3;}
