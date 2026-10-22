#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {recordRepair,exportRepair,listRepairs,readRepairInput} from '../runner/repair-record.mjs';

try{
 const {values:v,positionals:[command]}=parseArgs({allowPositionals:true,options:{'data-dir':{type:'string'},input:{type:'string'},id:{type:'string'},repo:{type:'string'},out:{type:'string'},mode:{type:'string'},investigation:{type:'string'}}});
 let result;
 if(command==='record'){const r=await recordRepair(v['data-dir'],await readRepairInput(v.input));result={id:r.id,revision:r.revision,occurrences:r.occurrences.length,gates:r.gates,publication:r.publication.state};}
 else if(command==='export')result=await exportRepair(v['data-dir'],v.id,{repo:v.repo,out:v.out,mode:v.mode});
 else if(command==='list')result=await listRepairs(v['data-dir'],v.investigation);
 else throw Error('Use repair.mjs record, list or export. Export is preview-only. See docs/build-repair.md.');
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
