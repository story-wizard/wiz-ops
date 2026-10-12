import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJSON} from '../runner/files.mjs';
import {prepareDelivery,recordDelivery,inspectDelivery,verifyReportRoute} from '../runner/delivery.mjs';

export async function main(args){
 const command=args.shift(),flags={};for(let i=0;i<args.length;i+=2){if(!['--report','--file','--route'].includes(args[i])||flags[args[i]]||!args[i+1])throw Error('Use delivery prepare/record --report DIR --file JSON.');flags[args[i]]=args[i+1];}
 const route=flags['--route']?verifyReportRoute(await readJSON(flags['--route'])):null;
 if(command==='inspect'&&flags['--report']&&!flags['--file'])return inspectDelivery(flags['--report'],route);
 if(!['prepare','record'].includes(command)||!flags['--report']||!flags['--file'])throw Error('Use delivery prepare/record --report DIR --file JSON, or inspect --report DIR.');
 const input=await readJSON(flags['--file']);if(command==='prepare'&&route&&JSON.stringify(verifyReportRoute(input))!==JSON.stringify(route))throw Error('Preparation route differs from selected destination.');return command==='prepare'?prepareDelivery(flags['--report'],input,{perDestination:!!route}):recordDelivery(flags['--report'],input,route);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{console.log(JSON.stringify(await main(process.argv.slice(2)),null,2));}catch(e){console.error(e.message);process.exitCode=3;}
