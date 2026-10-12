import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';

export function packetMetrics(packet){
 const bytes=Buffer.byteLength(JSON.stringify(packet,null,2)+'\n'),cases=packet.cases||packet.checksNeedingReview||[];
 return {bytes,estimatedTokens:Math.ceil(bytes/4),estimateBasis:'UTF-8 bytes / 4; approximate, not billed tokens',cases:cases.length,casesWithComparison:cases.filter(c=>c.conclusion?.assertions?.length).length,proofLinks:cases.flatMap(c=>c.conclusion?.assertions||[]).filter(a=>a.artifact).length};
}
export function executionMetrics(report,events=[]){
 const groups=report.groups||[],phases=groups.flatMap(g=>(g.timings||[]).map(t=>({...t,group:g.name})));
 if(!groups.length)phases.push(...report.timings||[]);
 const checks=events.filter(e=>e.operation==='performance.collect').map(e=>({caseId:e.caseId,elapsedMs:e.summary?.elapsedMs??null,collectionMs:e.summary?.collectionMs??null,status:e.status}));
 const diagnostics=events.filter(e=>e.operation==='diagnostic.capture').map(e=>({caseId:e.caseId,phase:e.phase,durationMs:e.durationMs??null,status:e.status}));
 const elapsed=Date.parse(report.finishedAt)-Date.parse(report.startedAt);
 return {wallMs:Number.isFinite(elapsed)&&elapsed>=0?elapsed:null,groups:groups.map(g=>({name:g.name,durationMs:g.durationMs??null,prepareBoundaryMs:Number.isFinite(Date.parse(g.preparedAt)-Date.parse(g.startedAt))?Date.parse(g.preparedAt)-Date.parse(g.startedAt):null})),phases,checks,diagnostics,
  gaps:[...(!phases.length?['Historical report has no prepare/launch/reopen/cleanup phase timers.']:[]),...(diagnostics.some(d=>d.durationMs===null)?['Historical diagnostic captures have no duration.']:[])],timingBasis:'Recorded intervals. Check time includes its diagnostics; cleanup may include close. Overlapping rows must not be summed.'};
}
export async function reviewSessionMetrics(session){
 assert.ok(typeof session.lane==='string'&&session.lane.trim(),'Name the review lane.');
 const elapsed=Date.parse(session.concludedAt)-Date.parse(session.startedAt);
 assert.ok(Number.isFinite(elapsed)&&elapsed>=0,'Supply ordered reviewer timestamps.');
 assert.ok(typeof session.correctConclusion==='boolean'&&Array.isArray(session.files)&&session.files.every(f=>typeof f==='string')&&Array.isArray(session.unsupportedClaims)&&session.unsupportedClaims.every(c=>typeof c==='string'),'Supply reviewed correctness, files read and unsupported claims.');
 const files=await Promise.all([...new Set(session.files)].map(async file=>{const info=await stat(file);assert.ok(info.isFile(),'Review evidence must be a file.');return {file,bytes:info.size};}));
 const bytes=files.reduce((n,f)=>n+f.bytes,0);
 return {lane:session.lane,elapsedMs:elapsed,timeToCorrectConclusionMs:session.correctConclusion?elapsed:null,correctConclusion:session.correctConclusion,filesOpened:session.files.length,uniqueFiles:files.length,bytesRead:bytes,estimatedTokens:Math.ceil(bytes/4),unsupportedClaims:session.unsupportedClaims,basis:'Reviewer-supplied timestamps and evaluated claims; bytes are unique files, excluding repeated/partial reads. Tokens use bytes / 4.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [beforeFile,afterFile,reportFile,journalFile,reviewsFile,...extra]=process.argv.slice(2);
 assert.ok(beforeFile&&afterFile&&reportFile&&journalFile&&!extra.length,'Usage: node scripts/review-cost.mjs BEFORE.json AFTER.json DESKTOP-REPORT.json OPERATIONS.jsonl [REVIEW-SESSIONS.json]');
 const read=async file=>JSON.parse(await readFile(file,'utf8'));
 const [before,after,report,journal]=await Promise.all([read(beforeFile),read(afterFile),read(reportFile),readFile(journalFile,'utf8')]);
 const identity=p=>p.build?.packageHash||p.identities?.build?.packageHash;
 assert.ok(identity(before)&&identity(before)===identity(after),'Compare packets from the same package.');
 const cases=p=>(p.cases||p.checksNeedingReview||[]).map(c=>c.id).sort();assert.deepEqual(cases(before),cases(after),'Compare the same check set.');
 const events=journal.split('\n').filter(Boolean).map(JSON.parse);
 const sessions=reviewsFile?await read(reviewsFile):[];assert.ok(Array.isArray(sessions),'Review sessions must be an array.');
 console.log(JSON.stringify({format:'athanor-review-cost/v1',packageHash:identity(before),before:packetMetrics(before),after:packetMetrics(after),execution:executionMetrics(report,events),reviewSessions:await Promise.all(sessions.map(reviewSessionMetrics)),reviewStatus:sessions.length?'Recorded reviewer evaluation':'Not measured; run equal-brief reviews and retain their evaluation.'},null,2));
}
