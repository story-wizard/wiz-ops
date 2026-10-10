import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readJSON,writeJSON} from './files.mjs';

const exec=promisify(execFile);
export const performancePolicy={format:'athanor-performance-policy/v1',sampling:'Check boundary samples',units:{cpu:'Seconds consumed by the owned process',memory:'RSS in KiB',elapsed:'Milliseconds'},limits:'No performance acceptance thresholds',scope:'Instrumented owned process only; excludes child processes, GPU, system load and peak memory.'};
export function parseProcessSample(text,binding){
 const m=/^(.+?)\s+((?:(?:\d+)-)?(?:\d+:)?\d+:\d+(?:\.\d+)?)\s+(\d+)\s*$/.exec(text.trim());
 if(!m||m[1]!==binding.processStart)throw Error('Process start identity changed or metrics are unavailable.');
 const time=/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(m[2]);
 if(Number(time[4])>=60||time[2]&&Number(time[3])>=60||Number(m[3])<=0)throw Error('Invalid process resource sample.');
 return {at:new Date().toISOString(),binding,cpuSeconds:Number(time[1]||0)*86400+Number(time[2]||0)*3600+Number(time[3])*60+Number(time[4]),rssKiB:Number(m[3])};
}
export async function sampleProcess(binding){
 if(!Number.isInteger(binding?.pid)||binding.pid<=0||!binding.processStart)throw Error('No verified live process identity for resource collection.');
 const {stdout}=await exec('/bin/ps',['-p',String(binding.pid),'-o','lstart=','-o','time=','-o','rss='],{timeout:2000,maxBuffer:4096});
 return parseProcessSample(stdout,binding);
}
async function collect(binding,sample){
 const started=performance.now();try{return {sample:await sample(binding),collectionMs:performance.now()-started};}
 catch(e){return {sample:null,gap:e.message,collectionMs:performance.now()-started};}
}
export async function beginPerformance(root,id,binding,{sample=sampleProcess}={}){
 if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Invalid check identity for performance evidence.');
 const directory=path.join(root,'performance');await mkdir(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'performance-'+id+'-'+randomUUID()+'.json'),startedAt=new Date().toISOString(),startTick=process.hrtime.bigint().toString(),before=await collect(binding,sample);
 const record={format:'athanor-check-performance/v1',id,policy:performancePolicy,startedAt,startTick,before,status:'Collecting'};
 await writeFile(file,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 await appendFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:id,operation:'performance.start',at:startedAt,status:'Recorded',evidence:{artifacts:[file]}})+'\n');return file;
}
export function summarizePerformance(record,after){
 const a=record.before.sample,b=after.sample,gaps=[record.before.gap,after.gap].filter(Boolean);
 if(a&&b&&(a.binding.pid!==b.binding.pid||a.binding.processStart!==b.binding.processStart||a.binding.generation!==b.binding.generation||a.binding.packageHash!==b.binding.packageHash))gaps.push('Process generation changed; CPU/RSS deltas are unavailable.');
 if(a&&b&&b.cpuSeconds<a.cpuSeconds)gaps.push('Process CPU counter moved backwards.');
 const elapsedMs=Number(process.hrtime.bigint()-BigInt(record.startTick))/1e6;
 return {...record,after,finishedAt:new Date().toISOString(),elapsedMs,collectionMs:record.before.collectionMs+after.collectionMs,status:gaps.length?'Incomplete':'Collected',gaps,
  metrics:a&&b&&!gaps.length?{cpuSeconds:b.cpuSeconds-a.cpuSeconds,rssBeforeKiB:a.rssKiB,rssAfterKiB:b.rssKiB,rssDeltaKiB:b.rssKiB-a.rssKiB}:null};
}
export async function endPerformance(file,binding,{sample=sampleProcess}={}){
 const report=summarizePerformance(await readJSON(file),await collect(binding,sample));await writeJSON(file,report);
 const root=path.dirname(path.dirname(file));await appendFile(path.join(root,'operations.jsonl'),JSON.stringify({caseId:report.id,operation:'performance.collect',at:report.finishedAt,status:report.status==='Collected'?'Completed':'Incomplete',evidence:{artifacts:[file]},summary:{elapsedMs:report.elapsedMs,collectionMs:report.collectionMs,metrics:report.metrics,gaps:report.gaps}})+'\n');return report;
}
