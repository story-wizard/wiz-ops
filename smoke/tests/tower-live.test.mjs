import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {towerLive} from '../tower-live.mjs';

test('live reads discover runs from idle, retain planned rows and separate current activity from outcomes without writes',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'tower-live-')),db=new DatabaseSync(':memory:');
 try{
 db.exec(`CREATE TABLE runs(id TEXT,name TEXT,created_at TEXT,build TEXT); CREATE TABLE executions(run_id TEXT,state TEXT,updated_at TEXT,message TEXT,course_json TEXT);
 CREATE TABLE results(run_id TEXT,test_id TEXT,status TEXT,updated_at TEXT,snapshot TEXT,note TEXT); CREATE TABLE result_events(run_id TEXT,test_id TEXT,status TEXT,created_at TEXT);`);
 assert.equal(towerLive({db,dataDir:root}).active,false);
 const recipe={target:'Mixed',revision:1,cases:[{id:'A',title:'First',target:'packaged',expected:'One'},{id:'B',title:'Second',target:'desktop',expected:'Two'},{id:'C',title:'Third'}]};
 db.prepare('INSERT INTO runs VALUES (?,?,?,?)').run('run-1','My run','2026-09-28T10:00:00Z','Build');
 db.prepare('INSERT INTO executions VALUES (?,?,?,?,?)').run('run-1','Running','2026-09-28T10:01:00Z','Desktop',JSON.stringify(recipe));
 for(const [id,status] of [['A','Pass'],['B','Running'],['C','Not run']])db.prepare('INSERT INTO results VALUES (?,?,?,?,?,?)').run('run-1',id,status,'2026-09-28T10:02:00Z','{}','Observation');
 db.prepare('INSERT INTO result_events VALUES (?,?,?,?)').run('run-1','B','Running','2026-09-28T10:01:30Z');
 const before=db.prepare('SELECT total_changes() AS n').get().n;
 let live=towerLive({db,dataDir:root});
 assert.equal(live.activeRun,'run-1');assert.equal(live.detail.live.planned,3);assert.equal(live.detail.live.completed,1);
 assert.equal(live.detail.live.currentCheckID,'B');assert.equal(live.detail.live.phase,'Desktop editor');
 assert.equal(live.detail.results[1].startedAt,'2026-09-28T10:01:30Z');assert.equal(live.detail.results[2].status,'Not run');
 assert.equal(live.runs[0].results.length,0,'Summary must not carry all check details');
 assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before,'Status reads changed execution state');
 db.prepare("UPDATE results SET status='Fail' WHERE test_id='B'").run();db.prepare("UPDATE results SET status='Blocked' WHERE test_id='C'").run();
 db.prepare("UPDATE executions SET state='Failed',updated_at='2026-09-28T10:03:00Z'").run();
 live=towerLive({db,dataDir:root,selected:'run-1'});
 assert.equal(live.active,false);assert.equal(live.detail.live.completed,3);assert.equal(live.detail.live.counts.Pass,1);assert.equal(live.detail.live.counts.Fail,1);assert.equal(live.detail.live.counts.Blocked,1);
 assert.equal(live.detail.live.currentCheckID,null);assert.equal(live.detail.live.finishedAt,'2026-09-28T10:03:00Z');
 assert.throws(()=>towerLive({db,dataDir:root,selected:'../../secret'}),/Invalid run/);
 // Standalone desktop/service activity uses its own selected scope, never the full catalog.
 const folder=path.join(root,'desktop-runs','desktop-live');mkdirSync(folder,{recursive:true});
 writeFileSync(path.join(folder,'session.json'),JSON.stringify({state:'Running',inputMode:'service',startedAt:'2026-09-28T11:00:00Z',selectedChecks:['S-IDLE'],env:{SECRET:'must-not-leak'}}));
 writeFileSync(path.join(folder,'check-events.jsonl'),JSON.stringify({id:'S-IDLE',status:'Running',at:'2026-09-28T11:00:01Z'})+'\n{"partial":');
 live=towerLive({db,dataDir:root,selected:'desktop-live',definitions:[{id:'S-IDLE',title:'Idle CPU'}]});
 assert.equal(live.activeRun,'desktop-live');assert.equal(live.detail.live.planned,1);assert.equal(live.detail.live.currentCheckID,'S-IDLE');assert.equal(live.detail.results[0].title,'Idle CPU');
 assert.ok(!JSON.stringify(live).includes('must-not-leak'));
 writeFileSync(path.join(folder,'desktop-course-report.json'),JSON.stringify({status:'Pass',startedAt:'2026-09-28T11:00:00Z',finishedAt:'2026-09-28T11:10:00Z',course:{title:'Idle',cases:[{id:'S-IDLE',title:'Frozen idle'}]},results:[{id:'S-IDLE',status:'Pass'}]}));
 live=towerLive({db,dataDir:root,selected:'desktop-live'});assert.equal(live.active,false);assert.equal(live.detail.live.completed,1);assert.equal(live.detail.results[0].title,'Frozen idle');
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('HTTP live endpoint discovers an externally recorded run without reconciliation or catalog work',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events');
 const root=mkdtempSync(path.join(tmpdir(),'tower-live-http-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',SMOKE_DATA_DIR:root},stdio:['ignore','pipe','pipe']});
 let db;
 try{
  const base=await new Promise((resolve,reject)=>{let text='';child.stderr.on('data',d=>{text+=d;});child.stdout.on('data',d=>{text+=d;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.on('error',reject);child.on('exit',c=>reject(Error('Fixture server exited '+c+': '+text)));});
  let response=await fetch(base+'/api/tower/live');assert.equal(response.status,200);assert.equal((await response.json()).active,false);
  db=new DatabaseSync(path.join(root,'smoke.sqlite'));
  db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run('external-run','2026-09-28T12:00:00Z','External','Build','gp','Course','Fixture');
  db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?)').run('external-run','Running',null,'hash','{}',JSON.stringify({cases:[{id:'A',title:'Current',target:'desktop'}]}),path.join(root,'runs/external-run'),'2026-09-28T12:00:00Z','Desktop');
  db.prepare('INSERT INTO results(run_id,test_id,snapshot,status) VALUES (?,?,?,?)').run('external-run','A','{}','Running');
  response=await fetch(base+'/api/tower/live?run=external-run');const live=await response.json();
  assert.equal(live.activeRun,'external-run');assert.equal(live.detail.results[0].title,'Current');assert.ok(!('checks' in live));
  assert.equal(db.prepare('SELECT state FROM executions WHERE run_id=?').get('external-run').state,'Running','Read endpoint reconciled/mutated a missing process');
  assert.equal((await fetch(base+'/api/tower/live?run=../../bad')).status,400);
 }finally{db?.close();if(child.exitCode===null){const closed=once(child,'exit');child.kill('SIGTERM');await closed;}rmSync(root,{recursive:true,force:true});}
});
