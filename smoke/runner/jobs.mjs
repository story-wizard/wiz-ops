import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {dataDirectory,digest} from './files.mjs';

export const terminalJobs=new Set(['Complete','Blocked','Unknown','Cancelled']);
const validID=id=>typeof id==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(id);
export function validateJobRequest(request){
 if(!request||Object.keys(request).some(k=>!['requestId','build','selection','operator','timeoutMinutes','nightly'].includes(k))||!validID(request.requestId)||typeof request.operator!=='string'||!request.operator.trim()||request.operator.length>120)throw Error('Supply a retained request ID, build, selection and operator.');
 if(request.nightly!==undefined&&request.nightly!==true)throw Error('Nightly mode must be true or omitted.');
 const b=request.build;if(!b||Object.keys(b).some(k=>!['kind','value'].includes(k))||!['latest-nightly','tag','app'].includes(b.kind))throw Error('Choose latest-nightly, an official tag or an absolute app.');
 if(b.kind==='latest-nightly'?b.value!==undefined:typeof b.value!=='string'||!b.value||b.value.length>4096||b.kind==='app'&&(!path.isAbsolute(b.value)||!b.value.endsWith('.app')))throw Error('Invalid build request.');
 if(!request.selection||typeof request.selection!=='object'||Array.isArray(request.selection))throw Error('Supply a course selection.');
 if(request.selection.checkpoint!==undefined)throw Error('Unattended jobs cannot wait for manual checkpoints. Use the ordinary interactive harness for that course.');
 const timeout=request.timeoutMinutes??180;if(!Number.isInteger(timeout)||timeout<1||timeout>720)throw Error('Job timeout must be 1–720 minutes.');
 return {...request,operator:request.operator.trim(),timeoutMinutes:timeout};
}
export function processIdentity(pid){
 try{const text=execFileSync('/bin/ps',['-p',String(pid),'-o','lstart=','-o','command='],{encoding:'utf8',timeout:2000}).trim();return text?{pid,identity:text}:null;}
 catch(e){if(e.status===1)return null;throw Error('Cannot inspect controller ownership; no takeover is allowed.');}
}
export function nextDaily(schedule,after,previousSlot=null){
 if(!schedule||typeof schedule.timeZone!=='string'||!Number.isInteger(schedule.hour)||schedule.hour<0||schedule.hour>23||!Number.isInteger(schedule.minute)||schedule.minute<0||schedule.minute>59)throw Error('Supply timezone and daily hour/minute.');
 const format=new Intl.DateTimeFormat('en-US',{timeZone:schedule.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),day=p=>p.year+'-'+p.month+'-'+p.day,previousDay=previousSlot?day(Object.fromEntries(format.formatToParts(Date.parse(previousSlot)).map(x=>[x.type,x.value]))):null;
 // Minute search handles timezone offsets and daylight-saving skips without a dependency.
 for(let t=Math.floor(after/60000)*60000+60000;t<=after+49*3600000;t+=60000){const p=Object.fromEntries(format.formatToParts(t).map(x=>[x.type,x.value]));if(day(p)!==previousDay&&Number(p.hour)===schedule.hour&&Number(p.minute)===schedule.minute)return new Date(t).toISOString();}
 throw Error('No daily slot in the next 49 hours.');
}
export class JobStore{
 constructor(dataDir,{policyHash=null}={}){if(policyHash!==null&&!/^[a-f0-9]{64}$/.test(policyHash))throw Error('Invalid controller policy identity.');this.policyHash=policyHash;this.dataDir=dataDirectory(dataDir);mkdirSync(this.dataDir,{recursive:true});this.db=new DatabaseSync(path.join(this.dataDir,'controller.sqlite'));this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,record TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state,created_at);
 CREATE TABLE IF NOT EXISTS job_events(seq INTEGER PRIMARY KEY,job_id TEXT NOT NULL,record TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS controller_lease(id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS controller_schedule(id INTEGER PRIMARY KEY CHECK(id=1),record TEXT NOT NULL);`);}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 get(id){const row=this.db.prepare('SELECT record FROM jobs WHERE id=?').get(id);return row?JSON.parse(row.record):null;}
 list(){return this.db.prepare('SELECT record FROM jobs ORDER BY created_at,id').all().map(r=>JSON.parse(r.record));}
 next(){const row=this.db.prepare("SELECT record FROM jobs WHERE state NOT IN ('Complete','Blocked','Unknown','Cancelled') ORDER BY created_at,id LIMIT 1").get();return row?JSON.parse(row.record):null;}
 events(id){return this.db.prepare('SELECT record FROM job_events WHERE job_id=? ORDER BY seq').all(id).map(r=>JSON.parse(r.record));}
 submit(request,selection,profileHash,now=Date.now()){return this.transaction(()=>this.insert(request,selection,profileHash,now));}
 insert(input,selection,profileHash,now){if(!/^[a-f0-9]{64}$/.test(profileHash||'')||selection?.format!=='wizard-smoke-selection/v2'||!selection.effectiveIds?.length)throw Error('Freeze a resolved selection and worker profile before queue admission.');const request=validateJobRequest(input),hash=digest({request,selection,profileHash,...(this.policyHash?{policyHash:this.policyHash}:{})}),old=this.get(request.requestId);if(old){if(old.requestHash!==hash)throw Error('Request ID already belongs to different inputs.');return old;}
 const at=new Date(now).toISOString(),job={format:'athanor-job/v1',id:request.requestId,requestHash:hash,request,selection,profileHash,...(this.policyHash?{policyHash:this.policyHash}:{}),state:'Queued',createdAt:at,updatedAt:at,deadline:new Date(now+request.timeoutMinutes*60000).toISOString(),preparationId:randomUUID(),runRequestId:randomUUID(),cancelRequested:false};
 this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?)').run(job.id,hash,job.state,at,JSON.stringify(job));this.event(job,'Submitted');return job;}
 event(job,note){this.db.prepare('INSERT INTO job_events(job_id,record) VALUES (?,?)').run(job.id,JSON.stringify({at:job.updatedAt,state:job.state,note}));}
 update(id,patch,note){return this.transaction(()=>{const job=this.get(id);if(!job)throw Error('Job not found.');const next={...job,...patch,updatedAt:new Date().toISOString()};this.db.prepare('UPDATE jobs SET state=?,record=? WHERE id=?').run(next.state,JSON.stringify(next),id);this.event(next,note||next.state);return next;});}
 cancel(id){const job=this.get(id);if(!job)throw Error('Job not found.');if(terminalJobs.has(job.state))return job;return this.update(id,{cancelRequested:true},'Cancellation requested; active work must settle.');}
 claim(inspect=processIdentity){const owner=inspect(process.pid);if(!owner)throw Error('Cannot establish controller process identity.');return this.transaction(()=>{const row=this.db.prepare('SELECT record FROM controller_lease WHERE id=1').get();if(row){const old=JSON.parse(row.record),live=inspect(old.pid);if(live&&live.identity===old.identity)return null;}
 const lease={...owner,token:randomUUID()};this.db.prepare('INSERT INTO controller_lease VALUES (1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(JSON.stringify(lease));return lease;});}
 release(lease){this.db.prepare('DELETE FROM controller_lease WHERE id=1 AND json_extract(record,\'$.token\')=?').run(lease.token);}
 schedule(){const row=this.db.prepare('SELECT record FROM controller_schedule WHERE id=1').get();return row?JSON.parse(row.record):null;}
 saveSchedule(input,now=Date.now()){if(Object.keys(input||{}).some(k=>!['timeZone','hour','minute','request','selection','profileHash','policyHash'].includes(k)))throw Error('Unknown schedule field.');validateJobRequest(input.request);const value={...input,enabled:false,nextDue:nextDaily(input,now)};this.db.prepare('INSERT INTO controller_schedule VALUES (1,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(JSON.stringify(value));return value;}
 enable(enabled,now=Date.now()){return this.transaction(()=>{const s=this.schedule();if(!s)throw Error('Save a schedule first.');if(enabled&&this.policyHash&&s.policyHash!==this.policyHash)throw Error('Schedule policy changed; save and review before enabling.');s.enabled=enabled;if(enabled)s.nextDue=nextDaily(s,now);this.db.prepare('UPDATE controller_schedule SET record=? WHERE id=1').run(JSON.stringify(s));return s;});}
 due(now=Date.now()){return this.transaction(()=>{const s=this.schedule();if(!s?.enabled||Date.parse(s.nextDue)>now)return null;if(this.policyHash&&s.policyHash!==this.policyHash)throw Error('Schedule belongs to another controller policy; save and review a new schedule before enabling.');const slot=s.nextDue,request={...s.request,requestId:'nightly-'+slot.replace(/[^0-9]/g,'')},job=this.insert(request,s.selection,s.profileHash,now);s.lastDue=slot;s.nextDue=nextDaily(s,now,slot);this.db.prepare('UPDATE controller_schedule SET record=? WHERE id=1').run(JSON.stringify(s));return job;});}
 close(){this.db.close();}
}
