import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync,writeFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT,dataDirectory} from './files.mjs';
import {initializeCourses,validateRecipe} from './catalog.mjs';
import {verifyDesktopOwner,verifyDesktopPaths} from '../desktop/adapter.mjs';
export const course=JSON.parse(readFileSync(path.join(ROOT,'runner/course.json'),'utf8'));
export const activeStates=['Queued','Preflight','Running'];
export function connect(dataDir){dataDir=dataDirectory(dataDir);const db=new DatabaseSync(path.join(dataDir,'smoke.sqlite'));db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');return db;}
export function initializeAutomation(db){
  db.exec(`CREATE TABLE IF NOT EXISTS executions(run_id TEXT PRIMARY KEY REFERENCES runs(id),state TEXT NOT NULL,pid INTEGER,plan_hash TEXT NOT NULL,package_json TEXT NOT NULL,course_json TEXT NOT NULL,artifact_root TEXT NOT NULL,updated_at TEXT NOT NULL,message TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS result_events(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,test_id TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);`);
  initializeCourses(db);
  const marker=`automation-catalog-${course.id}-${course.revision}`;
  if(db.prepare('SELECT value FROM metadata WHERE key=?').get(marker))return;
  db.exec('BEGIN IMMEDIATE');
  try{
    const originals=db.prepare('SELECT definition FROM tests').all().map(r=>JSON.parse(r.definition));
    db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run(marker,JSON.stringify(originals));
    for(const c of course.cases){
      const previous=originals.find(t=>t.id===c.id),source=originals.find(t=>t.id===c.sourceId);if(!previous&&!source)throw new Error(`Missing source test ${c.sourceId}`);
      const t={...(previous||source),id:c.id,sourceId:c.sourceId,title:c.title,approach:c.scope,expected:c.expected,execution:'Automated',course:'First automated',readiness:'Ready for pilot',gpScope:'GP v0',revision:previous?previous.revision+1:1,kind:previous?.kind||'Automated counterpart',sourceResults:previous?.sourceResults??null,blocker:'Prepared for a first packaged-engine pilot; no runtime pass is claimed.',automation:{course:course.id,revision:course.revision,stage:c.stage,operations:c.operations,target:course.target}};
      db.prepare('INSERT INTO tests VALUES (?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition').run(t.id,JSON.stringify(t));
    }
    for(const [id,reason] of Object.entries(course.deferred)){const t=originals.find(t=>t.id===id);if(!t)continue;t.readiness='Needs capability';t.blocker=reason;t.revision++;db.prepare('UPDATE tests SET definition=? WHERE id=?').run(JSON.stringify(t),id);}
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function execution(db,id){const row=db.prepare('SELECT * FROM executions WHERE run_id=?').get(id);return row?{...row,package:JSON.parse(row.package_json),recipe:JSON.parse(row.course_json),package_json:undefined,course_json:undefined}:null;}
export function createExecution(db,plan,dataDir,operator='Local runner',requestId){
  dataDir=dataDirectory(dataDir);
  const recipe=plan.recipe||course;validateRecipe(recipe);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(db.prepare("SELECT run_id FROM executions WHERE state IN ('Queued','Preflight','Running')").get())throw new Error('A local course is already active.');
    const definitions=db.prepare('SELECT definition FROM tests').all().map(r=>JSON.parse(r.definition));
    const selected=recipe.cases.map(c=>{const t=definitions.find(t=>t.id===c.id);if(!t||t.execution!=='Automated'||(c.target===undefined&&t.approach!==c.scope)||t.expected!==c.expected)throw new Error(`The definition of ${c.id} differs from its mapped executable contract. Review the recipe before running.`);return t;});
    const id=randomUUID(),at=new Date().toISOString();
    db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run(id,at,`${recipe.selection?recipe.title:'Local core'} · ${at.slice(0,16).replace('T',' ')}`,`${plan.version} · ${plan.packageHash.slice(0,12)}`,'GP-local-v0 / fixture '+plan.fixtureHash.slice(0,12),recipe.title,operator);
    for(const t of selected)db.prepare('INSERT INTO results(run_id,test_id,snapshot) VALUES (?,?,?)').run(id,t.id,JSON.stringify(t));
    db.prepare('INSERT INTO executions VALUES (?,?,?,?,?,?,?,?,?)').run(id,'Queued',null,plan.planHash,JSON.stringify(plan),JSON.stringify(recipe),path.join(dataDir,'runs',id),at,'Awaiting preflight; no Wizard process has started.');
    if(requestId)db.prepare('INSERT INTO execution_requests VALUES (?,?,?,?)').run(requestId,id,plan.planHash,operator);
    db.exec('COMMIT');return id;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function updateExecution(db,id,state,message,pid){db.prepare('UPDATE executions SET state=?,message=?,updated_at=?,pid=COALESCE(?,pid) WHERE run_id=?').run(state,message,new Date().toISOString(),pid??null,id);}
export function record(db,runId,testId,status,note,evidence){
  const at=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{db.prepare("UPDATE results SET status=?,note=?,evidence=?,recorded_by='Automated course runner',updated_at=?,revision=revision+1 WHERE run_id=? AND test_id=?").run(status,note,evidence||'',at,runId,testId);db.prepare('INSERT INTO result_events(run_id,test_id,status,note,created_at) VALUES (?,?,?,?,?)').run(runId,testId,status,note,at);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
export function runnerAlive(row){if(!row.pid)return false;try{const cmd=execFileSync('/bin/ps',['-p',String(row.pid),'-o','command='],{encoding:'utf8',timeout:2000});return cmd.includes('runner/run.mjs')&&cmd.includes(row.run_id);}catch{return false;}}
export function recoverInterrupted(db){
  for(const row of db.prepare("SELECT * FROM executions WHERE state IN ('Queued','Preflight','Running')").all()){
    if(runnerAlive(row))continue;
    const database=db.prepare('PRAGMA database_list').all().find(d=>d.name==='main');
    const cleanup=database?.file?cleanupInterrupted(row,path.dirname(database.file)):'No process cleanup without a file-backed workspace.';
    const note='Runner process is no longer present. No automatic replay was attempted. '+cleanup;
    for(const r of db.prepare("SELECT * FROM results WHERE run_id=? AND status IN ('Running','Not run')").all(row.run_id))record(db,row.run_id,r.test_id,r.status==='Running'?'Unknown':'Blocked',note,r.evidence);
    updateExecution(db,row.run_id,'Unknown',note);
  }
}

export function cleanupInterrupted(row,configuredDataDir){
  if(!/^[a-f0-9-]{36}$/.test(row.run_id))return 'No cleanup for an invalid run identity.';
  const data=dataDirectory(configuredDataDir),root=path.join(data,'runs',row.run_id);if(root!==row.artifact_root)return 'No process cleanup outside the owned workspace.';
  if(existsSync(root)&&realpathSync(root)!==root)return 'No cleanup through a redirected run path.';
  const attempts=[];
  for(const target of ['service','desktop']){
    const directory=path.join(root,'stages',target);if(!existsSync(directory))continue;
    for(const name of readdirSync(directory).filter(n=>/^desktop-[A-Za-z0-9]+$/.test(n))){
      const owned=path.join(directory,name),file=path.join(owned,'session.json');if(!existsSync(file))continue;
      const s=JSON.parse(readFileSync(file));
      if(s.root!==owned)continue;
      try{verifyDesktopPaths(s,data);}catch(e){attempts.push({kind:'session path rejected',detail:e.message});continue;}
      const children=path.join(owned,'owned-children.jsonl');
      if(existsSync(children))for(const line of readFileSync(children,'utf8').split('\n').filter(Boolean)){
        try{const c=JSON.parse(line);if(!c.command.includes(file)||!c.command.includes(path.join(ROOT,'desktop')))continue;
          const command=execFileSync('/bin/ps',['-p',String(c.pid),'-o','command='],{encoding:'utf8',timeout:2000}).trim(),started=execFileSync('/bin/ps',['-p',String(c.pid),'-o','lstart='],{encoding:'utf8',timeout:2000}).trim();
          if(command===c.command&&started===c.started){process.kill(-c.pid,'SIGTERM');attempts.push({pid:c.pid,kind:'check process group',signal:'SIGTERM'});}
        }catch(e){attempts.push({kind:'child already gone or identity unavailable',detail:e.message});}
      }
      if(s.state==='Running')try{verifyDesktopOwner(s,data);process.kill(s.pid,'SIGTERM');attempts.push({pid:s.pid,kind:'owned app',signal:'SIGTERM'});}catch(e){attempts.push({pid:s.pid,kind:'app already gone or identity unavailable',detail:e.message});}
    }
  }
  if(existsSync(root))writeFileSync(path.join(root,'interruption-cleanup.json'),JSON.stringify({at:new Date().toISOString(),attempts},null,2));
  return attempts.some(a=>a.signal)?'Sent termination only to identity-verified owned processes; inspect retained cleanup receipts.':'No live desktop process was verified for cleanup.';
}
