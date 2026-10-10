import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJSON} from '../runner/files.mjs';
import {prepareDelivery,recordDelivery,inspectDelivery} from '../runner/delivery.mjs';

export async function main(args){
 const command=args.shift(),flags={};for(let i=0;i<args.length;i+=2){if(!['--report','--file'].includes(args[i])||flags[args[i]]||!args[i+1])throw Error('Use delivery prepare/record --report DIR --file JSON.');flags[args[i]]=args[i+1];}
 if(command==='inspect'&&flags['--report']&&!flags['--file'])return inspectDelivery(flags['--report']);
 if(!['prepare','record'].includes(command)||!flags['--report']||!flags['--file'])throw Error('Use delivery prepare/record --report DIR --file JSON, or inspect --report DIR.');
 const input=await readJSON(flags['--file']);return command==='prepare'?prepareDelivery(flags['--report'],input):recordDelivery(flags['--report'],input);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{console.log(JSON.stringify(await main(process.argv.slice(2)),null,2));}catch(e){console.error(e.message);process.exitCode=3;}
