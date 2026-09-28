import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {sourceRun,requestJob,jobDetails,runDirectory} from '../desktop/hub.mjs';
test('human findings and draft edits preserve original evidence, retain history, and reject stale binding',()=>{
 const data=mkdtempSync(path.join(tmpdir(),'smoke-handoff-'));try{
  const id='desktop-proof',root=path.join(data,'desktop-runs',id);mkdirSync(root,{recursive:true});
  const report={status:'Fail',results:[{id:'D-TRACK-ADD',status:'Fail',error:'Track absent'}]};writeFileSync(path.join(root,'desktop-course-report.json'),JSON.stringify(report));writeFileSync(path.join(root,'session.json'),'{}');
  assert.throws(()=>sourceRun(data,id,'stale-report-hash'),/Original report changed/);
  const origin=sourceRun(data,id),jobId=randomUUID(),jobRoot=path.join(data,'desktop-jobs',jobId);mkdirSync(jobRoot,{recursive:true});
  writeFileSync(path.join(jobRoot,'job.json'),JSON.stringify({id:jobId,root:jobRoot,kind:'handoff',state:'Finished',sourceRun:id,sourceReportHash:origin.reportHash}));writeFileSync(path.join(jobRoot,'bug-draft.md'),'Draft\n');
  assert.throws(()=>runDirectory(data,'../../elsewhere'),/Invalid/);
  assert.throws(()=>requestJob(data,jobId,'review',{outcome:'Pass',operator:'Tester',note:'looked okay'}),/required/);
  requestJob(data,jobId,'review',{outcome:'Could not reproduce',operator:'Tester',note:'One new video track appeared.'});
  requestJob(data,jobId,'review',{outcome:'Needs investigation',operator:'Tester',note:'Readback did not agree with the screen.'});
  let details=jobDetails(data,jobId);assert.equal(details.reviews.length,2);assert.equal(sourceRun(data,id).reportHash,origin.reportHash);assert.equal(sourceRun(data,id).report.results[0].status,'Fail');
  assert.match(details.bugDraft,/Readback did not agree/);
  requestJob(data,jobId,'draft',{text:'Edited local report'});assert.equal(jobDetails(data,jobId).bugDraft,'Edited local report');assert.equal(jobDetails(data,jobId).reviews.length,2);
  assert.throws(()=>requestJob(data,jobId,'capture'),/not available/);
  writeFileSync(path.join(root,'desktop-course-report.json'),JSON.stringify({...report,status:'Pass'}));
  assert.throws(()=>requestJob(data,jobId,'review',{outcome:'Confirmed defect',operator:'Tester',note:'Observed'}),/Original report changed/);
 }finally{rmSync(data,{recursive:true,force:true});}
});
