import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checks} from './check-support.mjs';
import {verifyDesktopOwner} from './adapter.mjs';
import {writeJSON} from '../runner/files.mjs';
import {assert,pause,same,snapshotState} from '../runner/engine.mjs';

export const idlePolicy={durationSeconds:600,settleSeconds:300,intervalSeconds:5,meanCpuPercent:2,p95CpuPercent:5,units:'Percent of one CPU core',status:'Provisional limits approved by Charles on 2026-09-28; candidate definition awaiting review'};
export function cpuSeconds(text){
 const m=/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
 assert(m&&Number(m[4])<60&&(!m[2]||Number(m[3])<60),'Invalid process CPU time: '+text);
 return Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3])*60+Number(m[4]);
}
export function idleSummary(samples,policy=idlePolicy){
 assert(samples.length>=2,'Idle samples are missing');
 const start=samples[0],end=samples.at(-1);
 assert(end.elapsedSeconds-start.elapsedSeconds>=policy.durationSeconds,'Idle duration is incomplete');
 const intervals=[];
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],dt=b.elapsedSeconds-a.elapsedSeconds,dc=b.cpuSeconds-a.cpuSeconds;
  assert(Number.isFinite(dt)&&dt>0&&dt<=policy.intervalSeconds*3,'CPU sample gap or invalid elapsed time');
  assert(Number.isFinite(dc)&&dc>=0&&Number.isFinite(b.rssKiB)&&b.rssKiB>0,'Invalid process sample');
  if(a.elapsedSeconds>=policy.settleSeconds)intervals.push({seconds:dt,cpuPercent:100*dc/dt});
 }
 const observedSeconds=intervals.reduce((n,x)=>n+x.seconds,0);
 assert(observedSeconds>=policy.durationSeconds-policy.settleSeconds-policy.intervalSeconds*2,'Insufficient settled idle samples');
 const meanCpuPercent=intervals.reduce((n,x)=>n+x.seconds*x.cpuPercent,0)/observedSeconds;
 // Time-weighted percentile prevents irregular sampling from hiding long busy intervals.
 const sorted=intervals.toSorted((a,b)=>a.cpuPercent-b.cpuPercent);let seconds=0,p95CpuPercent=0;
 for(const x of sorted){seconds+=x.seconds;if(seconds>=observedSeconds*.95){p95CpuPercent=x.cpuPercent;break;}}
 return {meanCpuPercent,p95CpuPercent,observedSeconds,samples:intervals.length,rssStartKiB:start.rssKiB,rssEndKiB:end.rssKiB,pass:meanCpuPercent<=policy.meanCpuPercent&&p95CpuPercent<=policy.p95CpuPercent};
}
export async function runIdle(file){
 const {s,c,ui,check,finish}=await checks(file,'service-idle-report.json');
 await check('S-PF-IDLE',async()=>{
  await c('playback.pause');const before=await c('playback.query_transport');assert(!before.playing,'Idle fixture is playing');
  const timeline=snapshotState(await c('timeline.inspect',{timeline_id:s.main.id}));
  const initial=await ui();assert(initial.widgets.some(w=>w.class==='MainWindow'),'Editor window missing');
  const samples=[],sampleFile=path.join(s.root,'idle-samples.jsonl'),started=performance.now();
  do{
   verifyDesktopOwner(s);
   const value=execFileSync('/bin/ps',['-p',String(s.pid),'-o','time=','-o','rss='],{encoding:'utf8',timeout:3000}).trim().split(/\s+/);
   assert(value.length===2,'Process resource sample is missing');
   const sample={at:new Date().toISOString(),elapsedSeconds:(performance.now()-started)/1000,cpuSeconds:cpuSeconds(value[0]),rssKiB:Number(value[1])};
   samples.push(sample);await appendFile(sampleFile,JSON.stringify(sample)+'\n');
   if(sample.elapsedSeconds>=idlePolicy.durationSeconds+samples[0].elapsedSeconds)break;
   await pause(idlePolicy.intervalSeconds*1000);
  }while(true);
  const summary=idleSummary(samples),after=await c('playback.query_transport');
  const evidence={policy:idlePolicy,summary,before,after,sampleFile,scope:'Idle editor process with populated synthetic Fresh project; child processes, GPU utilization, other projects and system-wide CPU are separate'};
  await writeJSON(path.join(s.root,'idle-evidence.json'),evidence);
  assert(!after.playing&&after.frame===before.frame,'Transport changed during idle measurement');
  same(snapshotState(await c('timeline.inspect',{timeline_id:s.main.id})),timeline,'Idle timeline unchanged');
  assert(summary.pass,`Idle CPU exceeds provisional limits: mean ${summary.meanCpuPercent.toFixed(2)}%, p95 ${summary.p95CpuPercent.toFixed(2)}%; see idle-evidence.json`);
  return evidence;
 });finish();
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runIdle(process.argv[2]);
