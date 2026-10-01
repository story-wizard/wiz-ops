import http from 'node:http';
import {checkpoint as getCheckpoint,waitingCheckpoints,checkpointRequest,saveCheckpoint} from './runner/checkpoints.mjs';
import {towerSnapshot} from './tower.mjs';
import {towerLive} from './tower-live.mjs';
import {createExplainer} from './explainer/model.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {initializeAutomation,course,execution,createExecution,updateExecution,record,recoverInterrupted,runnerAlive} from './runner/store.mjs';
import {readJSON,writeJSON,digest,dataDirectory} from './runner/files.mjs';
import {checklistCoverage} from './coverage.mjs';
import {desktopState,desktopCourse,serviceCourse,startDesktopJob,requestJob,jobDetails,initializeDesktopCatalog,ownedDesktopSessions} from './desktop/hub.mjs';
import {checkPrepared,sourceIdentity,prepare} from './runner/prepare.mjs';
import {checkRegistry,courseList,getCourse,saveCourse,resolveSelection} from './runner/catalog.mjs';
import {runtimeList,saveRuntime,installedRuntime} from './runner/runtime.mjs';
import {exportRunKit} from './kits.mjs';
import {exportLocalReport} from './reports.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = dataDirectory();
const historyUrl=()=>existsSync(path.join(dataDir,'history.html'))?'/history':null;
mkdirSync(dataDir,{recursive:true});
const explainer=createExplainer(root,dataDir);
const db = new DatabaseSync(path.join(dataDir,'smoke.sqlite'));
db.exec('PRAGMA busy_timeout=5000;');
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tests (id TEXT PRIMARY KEY, definition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT NOT NULL, build TEXT NOT NULL, gp_version TEXT NOT NULL, course TEXT NOT NULL, operator TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (run_id TEXT NOT NULL REFERENCES runs(id), test_id TEXT NOT NULL, snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Not run', note TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '', recorded_by TEXT NOT NULL DEFAULT '', updated_at TEXT, revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(run_id,test_id));
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
const seed=JSON.parse(readFileSync(path.join(root,'catalog/catalog-seed.json')));
if (!db.prepare('SELECT value FROM metadata WHERE key=?').get('seeded')) {
  db.exec('BEGIN');
  try {
    const insert=db.prepare('INSERT INTO tests VALUES (?,?)');
    for(const test of seed.tests) insert.run(test.id,JSON.stringify(test));
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('seeded','1');
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
initializeAutomation(db);
initializeDesktopCatalog(db);
recoverInterrupted(db);
const checkpoint=JSON.parse(readFileSync(path.join(root,'catalog/checkpoints/logan-2026-09-25-2.json')));
const enums={execution:['Automated','Human','Unassigned'],course:['First automated','Local desktop','Local services','Human','Later','Backlog'],readiness:['Needs mapping','Needs capability','In development','Ready for pilot','Ready','Human checklist','Draft'],priority:['P0','P1','P2'],environment:['Local','NAS'],gpScope:['GP v0','Extension','Review']};
const statuses=['Not run','Running','Pass','Fail','Blocked','N/A','Unknown'];
let preparing=false;
const catalog=()=>db.prepare('SELECT definition FROM tests ORDER BY rowid').all().map(r=>JSON.parse(r.definition));
const getRun=(id)=>{
  const run=db.prepare('SELECT * FROM runs WHERE id=?').get(id); if(!run)return null;
  return {...run,checkpoint:getCheckpoint(db,id),execution:execution(db,id),results:db.prepare('SELECT * FROM results WHERE run_id=? ORDER BY rowid').all(id).map(r=>({...r,snapshot:JSON.parse(r.snapshot)}))};
};
function desktopExport(){const state=desktopState(dataDir);return {...state,jobs:state.jobs.map(j=>jobDetails(dataDir,j.id))};}
async function runSetup(){
 const previous=db.prepare('SELECT package_json FROM executions ORDER BY updated_at DESC LIMIT 20').all().map(r=>JSON.parse(r.package_json)),builds=[],runtimes=[],stored=await runtimeList(dataDir);
 let runtimeSetupError='';
 try{
  const runtime=await installedRuntime(dataDir);
  runtimes.push({id:digest(runtime),label:'Installed test tools',runtime});
 }catch(e){if(e.code!=='ENOENT')runtimeSetupError='The installed test-tools configuration could not be read.';}
 for(const p of previous){
  if(typeof p.app==='string'&&!builds.some(b=>b.app===p.app))builds.push({app:p.app,label:p.version||path.basename(p.app),available:existsSync(p.app)});
  if(p.runtime&&!runtimes.some(r=>r.id===digest(p.runtime)))runtimes.push({id:digest(p.runtime),label:'Previously used test tools',runtime:p.runtime});
 }
 if(!builds.some(b=>b.app==='/Applications/Wizard.app')&&existsSync('/Applications/Wizard.app')){
  let label='Installed Wizard';try{label+=' ('+execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-','/Applications/Wizard.app/Contents/Info.plist'],{encoding:'utf8',timeout:1000}).trim()+')';}catch{}
  builds.push({app:'/Applications/Wizard.app',label,available:true});
 }
 for(const r of stored)if(!runtimes.some(candidate=>candidate.id===r.id))runtimes.push(r);
 for(const r of runtimes){
  r.label ||= path.basename(r.runtime.app);
  const runtime=r.runtime;
  r.available=['app','cli','qtPlugin'].every(k=>typeof runtime[k]==='string'&&path.isAbsolute(runtime[k])&&existsSync(runtime[k]))&&existsSync(path.join(runtime.app,'Contents/MacOS/wizard'))&&existsSync(runtime.bridge||path.join(dataDir,'native/styles/libwizard_smoke.dylib'))&&(!runtime.libraries||existsSync(runtime.libraries));
 }
 const defaultRuntimeId=runtimes.find(r=>r.available)?.id||'';
 const registry=checkRegistry(),courses=courseList(db).filter(c=>!c.checkpoint).map(c=>{try{const s=resolveSelection(db,{courseIds:[c.id]});return {...c,checkCount:s.effectiveIds.length,requirements:s.requirements,targets:Object.fromEntries(['packaged','desktop','service'].map(t=>[t,s.effectiveIds.filter(id=>registry.find(c=>c.id===id)?.target===t).length]))};}catch(e){return {...c,error:e.message};}});
 return {builds,courses,runtimes,defaultRuntimeId,runtimeSetupError,project:'fresh'};
}
async function runnerStatus(){
  recoverInterrupted(db);
  let plan,preflight;try{plan=await readJSON(path.join(dataDir,'prepared.json'));preflight=await readJSON(path.join(dataDir,'preflight.json'));}catch{}
  const sourceMatches=plan?await sourceIdentity()===plan.runnerHash:false;
  const current=db.prepare("SELECT run_id FROM executions WHERE state IN ('Queued','Preflight','Running','Waiting for human','Continuing') ORDER BY updated_at DESC LIMIT 1").get();
  return {course,plan,preflight,prepared:Boolean(plan&&preflight?.ok&&preflight.planHash===plan.planHash&&sourceMatches),sourceMatches,active:current?execution(db,current.run_id):null};
}
async function catalogPayload(){
  const runner=await runnerStatus(),gp=structuredClone(seed.gp);gp.prepared=runner.prepared;
  if(runner.prepared){gp.status='Media prepared; project built during run';gp.components=gp.components.map(c=>c.id==='gp-media'?{...c,name:'Eight synthetic local fixtures',status:'Available',spec:'Eight generated files: pattern_24.mov (1080p24 ProRes + stereo, 12 s); motion_25.mp4 (1080p25 H.264, 8 s); tone.wav (48 kHz stereo, 8 s); still.png; sample.mxf (1080p25, 6 s); mask.png; comet_report.wav; comet_report.mov (matching synthetic speech audio/video). All have verified hashes and probe results.'}:c.id==='gp-speech'?{...c,status:'Available',spec:'Synthetic Samantha speech with known words and time ranges. Offline ASR uses a pinned cached Parakeet CoreML model. Transcript search uses the matching video asset; this package excludes audio-only assets from its search index.'}:c.id==='gp-project'||c.id==='gp-timelines'?{...c,status:'Built during run',spec:c.id==='gp-project'?'Fresh GP created through the packaged project operations for each independent test; no hand-authored .wiz files.':'Main at 24 fps and Secondary at 25 fps, with known source windows and exact whole-second clip positions. Additional tracks are created only by checks that need them.'}:c.id==='gp-graph'?{...c,name:'Small render graph',status:'Built during run',spec:'Insert a Gaussian blur into a clip graph, edit its radius, bypass it, then remove it. Verify topology and independently measured pixel changes.'}:c.id==='gp-mask'?{...c,status:'Available'}:{...c,status:'Deferred'});}
  return {...seed,gp,historyUrl:historyUrl(),tests:catalog(),runner,checkpoint:{source:checkpoint.source,sha256:checkpoint.sha256,build:checkpoint.sourceBuild,comparison:checkpoint.comparison,rows:checklistCoverage(checkpoint,{cases:[...course.cases,...[desktopCourse,serviceCourse].flatMap(d=>d.cases.map(c=>({...c,scope:d.target+'; '+c.expected})))]})}};
}
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const str=(value,label,max=6000)=>{if(typeof value!=='string'||value.length>max)fail(400,`Invalid ${label}.`);return value.trim();};
function validateTest(input,previous){
  const t={...previous};
  for(const [key,values] of Object.entries(enums)){ if(input[key]!==undefined){if(!values.includes(input[key]))fail(400,`Invalid ${key}.`);t[key]=input[key];}}
  for(const key of ['title','criteria','area','owner','approach','expected','blocker','notes'])if(input[key]!==undefined)t[key]=str(input[key],key,key==='title'?500:6000);
  for(const key of ['title','area','expected'])if(!t[key])fail(400,`${key} is required.`);
  if(t.execution==='Human'&&t.course==='First automated')fail(400,'Human tests belong in the Human or Later course.');
  if(t.course==='First automated'&&t.execution!=='Automated')fail(400,'First automated requires Automated execution.');
  if(input.fixtureIds!==undefined){if(!Array.isArray(input.fixtureIds)||!input.fixtureIds.every(id=>seed.gp.components.some(c=>c.id===id)))fail(400,'Unknown GP component.');t.fixtureIds=[...new Set(input.fixtureIds)];}
  return t;
}
const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
    const host=req.headers.host||'';
    if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))return send(403,{error:'Local access only.'});
    const url=new URL(req.url,`http://${host}`), parts=url.pathname.split('/').filter(Boolean);
    if(url.pathname.startsWith('/api/')){
      let body={};
      if(['POST','PATCH'].includes(req.method)){
        if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(403,{error:'Cross-origin writes are not accepted.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON is required.'});
        let text=''; for await(const chunk of req){text+=chunk;if(text.length>1_000_000)fail(413,'Request is too large.');}
        try{body=JSON.parse(text);}catch{fail(400,'Invalid JSON.');}
        if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'An object is required.');
      }
      if(url.pathname==='/api/tower/live'&&req.method==='GET')return send(200,towerLive({db,dataDir,selected:url.searchParams.get('run'),definitions:[...desktopCourse.cases,...serviceCourse.cases]}));
      if(url.pathname==='/api/tower'&&req.method==='GET')return send(200,{...towerSnapshot({runner:await runnerStatus(),desktop:desktopState(dataDir),runs:db.prepare('SELECT id FROM runs ORDER BY created_at DESC').all().map(r=>getRun(r.id)),guide:explainer.build(),details:id=>jobDetails(dataDir,id)}),historyUrl:historyUrl()});
      if(url.pathname==='/api/explainer'&&req.method==='GET')return send(200,explainer.build());
      if(parts[1]==='explainer'&&parts[2]==='files'&&parts.length===4&&req.method==='GET'){
        if(!/^[a-f0-9]{32}$/.test(parts[3]))fail(404,'Evidence file not found.');
        let file;try{file=explainer.file(parts[3]);if(!file){explainer.build();file=explainer.file(parts[3]);}}catch{}
        if(!file)fail(404,'Evidence file not found.');
        const type=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.mp4':'video/mp4','.mov':'video/quicktime','.wav':'audio/wav','.json':'application/json'})[path.extname(file)]||'text/plain; charset=utf-8';
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});return res.end(readFileSync(file));
      }
      if(url.pathname==='/api/desktop'&&req.method==='GET')return send(200,desktopState(dataDir));
      if(url.pathname==='/api/desktop/start'&&req.method==='POST'){
        if(preparing)fail(409,'A plan is being prepared.');
        if((await runnerStatus()).active)fail(409,'A packaged headless course is already active.');
        try{return send(202,startDesktopJob(dataDir,body));}catch(e){fail(409,e.message);}
      }
      if(parts[1]==='desktop'&&parts[2]==='jobs'&&parts.length===4&&req.method==='GET'){
        try{return send(200,jobDetails(dataDir,parts[3]));}catch(e){fail(404,e.message);}
      }
      if(parts[1]==='desktop'&&parts[2]==='jobs'&&parts.length===5&&req.method==='POST'){
        try{return send(200,requestJob(dataDir,parts[3],parts[4],body));}catch(e){fail(409,e.message);}
      }
      if(req.method==='GET'&&url.pathname==='/api/checkpoints'){recoverInterrupted(db);return send(200,{checkpoints:waitingCheckpoints(db)});}
      if(parts[1]==='runs'&&parts[3]==='checkpoint'){
        recoverInterrupted(db);const id=parts[2];
        if(req.method==='GET'&&parts.length===4){const c=getCheckpoint(db,id);if(!c)fail(404,'Checkpoint not found.');return send(200,c);}
        if(req.method==='POST'&&parts.length===5){
          let result;try{result=checkpointRequest(db,id,parts[4],body);}catch(e){fail(409,e.message);}
          if(!result.reused&&parts[4]!=='observe'){
            const job=execution(db,id),log=openSync(path.join(job.artifact_root,'checkpoint-worker.log'),'a');
            const failed=e=>{const c=getCheckpoint(db,id);saveCheckpoint(db,id,{...c,state:'Interrupted',error:e.message,verification:{status:'Unknown',note:e.message}});updateExecution(db,id,'Unknown',e.message);};
            try{const worker=spawn(process.execPath,[path.join(root,'runner/checkpoint-worker.mjs'),'--run-id',id],{cwd:root,env:{...process.env,SMOKE_DATA_DIR:dataDir},detached:true,stdio:['ignore',log,log]});if(worker.pid)db.prepare('UPDATE executions SET pid=? WHERE run_id=?').run(worker.pid,id);worker.on('error',failed);worker.unref();}catch(e){failed(e);throw e;}finally{closeSync(log);}
          }
          return send(200,result);
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/catalog')return send(200,await catalogPayload());
      if(req.method==='GET'&&url.pathname==='/api/checks')return send(200,{format:'wizard-smoke-checks/v1',target:'all',checks:checkRegistry()});
      if(req.method==='GET'&&url.pathname==='/api/runtimes')return send(200,{format:'wizard-smoke-runtimes/v1',runtimes:await runtimeList(dataDir)});
      if(req.method==='POST'&&url.pathname==='/api/runtimes'){try{return send(201,await saveRuntime(dataDir,body));}catch(e){fail(409,e.message);}}
      if(req.method==='GET'&&url.pathname==='/api/run-setup')return send(200,await runSetup());
      if(req.method==='GET'&&url.pathname==='/api/courses')return send(200,courseList(db));
      if(req.method==='GET'&&parts[1]==='courses'&&parts.length===3){try{return send(200,getCourse(db,parts[2],url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined));}catch(e){fail(404,e.message);}}
      if(req.method==='POST'&&url.pathname==='/api/courses'){try{return send(201,saveCourse(db,body));}catch(e){fail(409,e.message);}}
      if(req.method==='POST'&&url.pathname==='/api/plans'){
        if(preparing||(await runnerStatus()).active||ownedDesktopSessions(dataDir).length||desktopState(dataDir).jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)))fail(409,'A course, desktop setup or preparation is active.');
        if(typeof body.app!=='string'||!path.isAbsolute(body.app))fail(400,'Choose an explicit absolute app path.');
        let selection;try{selection=resolveSelection(db,body.selection);}catch(e){fail(409,e.message);}
        if(preparing)fail(409,'Another plan preparation became active.');
        preparing=true;try{return send(201,await prepare({app:body.app,dataDir,selection,runtime:body.runtime}));}catch(e){fail(409,e.message);}finally{preparing=false;}
      }
      if(req.method==='GET'&&parts[1]==='requests'&&parts.length===3){
        recoverInterrupted(db);const previous=db.prepare('SELECT run_id FROM execution_requests WHERE request_id=?').get(parts[2]);if(!previous)fail(404,'Request not found.');return send(200,getRun(previous.run_id));
      }
      if(req.method==='GET'&&parts[1]==='runs'&&parts.length===3){recoverInterrupted(db);const run=getRun(parts[2]);if(!run)fail(404,'Run not found.');return send(200,run);}
      if(req.method==='GET'&&url.pathname==='/api/runner'){recoverInterrupted(db);return send(200,await runnerStatus());}
      if(req.method==='POST'&&url.pathname==='/api/runner/preflight'){
        try{const {plan}=await checkPrepared(dataDir);const result={ok:true,planHash:plan.planHash,checkedAt:new Date().toISOString(),wizardLaunched:false,checks:['Package fingerprint unchanged','Fixture hashes unchanged','Runner and course unchanged','Required packaged operations present']};await writeJSON(path.join(dataDir,'preflight.json'),result);return send(200,result);}catch(error){const result={ok:false,checkedAt:new Date().toISOString(),wizardLaunched:false,error:error.message};await writeJSON(path.join(dataDir,'preflight.json'),result);return send(200,result);}
      }
      if(req.method==='POST'&&url.pathname==='/api/runner/start'){
        const operator=str(body.operator||'Local runner','operator',120),requestId=body.requestId;
        if(!operator)fail(400,'An operator is required.');
        if(requestId!==undefined){
          if(typeof requestId!=='string'||!requestId.match(/^[A-Za-z0-9-]{1,100}$/))fail(400,'Invalid request ID.');
          const previous=db.prepare('SELECT * FROM execution_requests WHERE request_id=?').get(requestId);
          if(previous){if(previous.plan_hash!==body.planHash||previous.operator!==operator)fail(409,'Request ID was already used with different inputs.');return send(200,{runId:previous.run_id,requestId,reused:true});}
        }
        if(preparing)fail(409,'A plan is being prepared.');
        if(ownedDesktopSessions(dataDir).length||desktopState(dataDir).jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)))fail(409,'A desktop course or human setup is active.');
        recoverInterrupted(db);let plan;
        if(typeof body.planHash==='string'&&/^[a-f0-9]{64}$/.test(body.planHash))try{plan=await readJSON(path.join(dataDir,'plans',body.planHash+'.json'));}catch(e){if(e.code!=='ENOENT')fail(409,'Stored plan cannot be read.');}
        if(plan){const {planHash,...content}=plan;if(planHash!==body.planHash||digest(content)!==planHash||await sourceIdentity()!==plan.runnerHash)fail(409,'Plan or runner changed. Prepare the selected course again.');}
        else{const status=await runnerStatus();if(!status.prepared)fail(409,'Prepare the fixture pack and current runner before starting.');if(body.planHash!==status.plan.planHash)fail(409,'Prepared plan changed. Review the run setup again.');plan=status.plan;}
        // Recheck after asynchronous identity reads, before synchronous admission/spawn.
        if(preparing||ownedDesktopSessions(dataDir).length||desktopState(dataDir).jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)))fail(409,'Another preparation or desktop setup became active.');
        if(requestId){const previous=db.prepare('SELECT * FROM execution_requests WHERE request_id=?').get(requestId);if(previous){if(previous.plan_hash!==body.planHash||previous.operator!==operator)fail(409,'Request ID was already used with different inputs.');return send(200,{runId:previous.run_id,requestId,reused:true});}}
        let id;try{id=createExecution(db,plan,dataDir,operator,requestId);}catch(error){fail(409,error.message);}
        const blocked=error=>{for(const r of db.prepare('SELECT test_id FROM results WHERE run_id=?').all(id))record(db,id,r.test_id,'Blocked',error.message,'');updateExecution(db,id,'Blocked',error.message);};
        let log;
        try{
          // Keep admission and PID registration in one event-loop turn so polling cannot recover a worker still being launched.
          const job=execution(db,id);mkdirSync(job.artifact_root,{recursive:true,mode:0o700});log=openSync(path.join(job.artifact_root,'runner.log'),'a');
          const worker=spawn(process.execPath,[path.join(root,'runner/run.mjs'),'--execute','--data-dir',dataDir,'--run-id',id],{cwd:root,env:{...process.env,SMOKE_DATA_DIR:dataDir},detached:true,stdio:['ignore',log,log]});
          if(worker.pid)db.prepare('UPDATE executions SET pid=? WHERE run_id=?').run(worker.pid,id);
          worker.on('error',blocked);worker.unref();
        }catch(error){blocked(error);throw error;}finally{if(log!==undefined)closeSync(log);}
        return send(202,{runId:id,requestId,reused:false});
      }
      if(req.method==='POST'&&url.pathname==='/api/runner/stop'){
        const job=execution(db,str(body.runId,'run ID',60));if(!job||!runnerAlive(job))fail(409,'No owned runner is active for this record.');process.kill(job.pid,'SIGTERM');return send(202,{message:'Stop requested. Pending work will be blocked and uncertain mutations retained as unknown.'});
      }
      if(req.method==='GET'&&url.pathname==='/api/runs')return send(200,db.prepare('SELECT id FROM runs ORDER BY created_at DESC').all().map(r=>getRun(r.id)));
      if(req.method==='POST'&&parts[1]==='runs'&&parts[3]==='kit'&&parts.length===4){recoverInterrupted(db);const run=getRun(parts[2]);if(!run)fail(404,'Run not found.');try{return send(201,await exportRunKit(run,dataDir));}catch(e){fail(409,e.message);}}
      if(req.method==='POST'&&parts[1]==='runs'&&parts[3]==='report'&&parts.length===4){
        recoverInterrupted(db);const run=getRun(parts[2]);if(!run)fail(404,'Run not found.');
        try{return send(201,await exportLocalReport(run,dataDir));}catch(e){fail(409,e.message);}
      }
      if(req.method==='GET'&&url.pathname==='/api/export')return send(200,{...seed,tests:catalog(),runs:db.prepare('SELECT id FROM runs').all().map(r=>getRun(r.id)),desktop:desktopExport(),exportedAt:new Date().toISOString()});
      if(req.method==='POST'&&url.pathname==='/api/exports'){
        if(!['csv','json'].includes(body.format))fail(400,'Choose CSV or JSON.');
        const tests=catalog();let content;
        if(body.format==='csv'){
          if(!Array.isArray(body.ids)||body.ids.length>10000||!body.ids.every(id=>tests.some(t=>t.id===id)))fail(400,'Choose valid test IDs.');
          const fields=['id','title','area','execution','course','readiness','priority','owner','environment','gpScope','sourceId','approach','expected','blocker','notes'];
          const cell=v=>'"'+String(v??'').replace(/^([\s]*[=+\-@])/,'\u0027$1').replaceAll('"','""')+'"';
          content=[fields,...body.ids.map(id=>fields.map(k=>tests.find(t=>t.id===id)[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
        }else content=JSON.stringify({...seed,tests,runs:db.prepare('SELECT id FROM runs').all().map(r=>getRun(r.id)),desktop:desktopExport(),exportedAt:new Date().toISOString()},null,2);
        const filename=`wizard-smoke-${Date.now()}-${randomUUID().slice(0,8)}.${body.format}`;
        const directory=path.join(dataDir,'exports');mkdirSync(directory,{recursive:true});
        writeFileSync(path.join(directory,filename),content);
        return send(201,{path:path.join(directory,filename),url:`/exports/${filename}`,filename});
      }
      if(req.method==='POST'&&url.pathname==='/api/tests'){
        const ids=new Set(catalog().map(t=>t.id)); let n=1;while(ids.has(`CT-${String(n).padStart(3,'0')}`))n++;
        const id=`CT-${String(n).padStart(3,'0')}`;
        const t=validateTest(body,{id,sourceId:null,sourceRow:null,sourceResults:null,kind:'Team addition',revision:1,execution:'Unassigned',course:'Backlog',readiness:'Draft',priority:'P1',environment:'Local',gpScope:'Review',owner:'Unassigned',fixtureIds:[],criteria:'',approach:'',expected:'',blocker:'',notes:''});
        db.prepare('INSERT INTO tests VALUES (?,?)').run(id,JSON.stringify(t));return send(201,t);
      }
      if(req.method==='PATCH'&&parts[1]==='tests'&&parts.length===3){
        const found=db.prepare('SELECT definition FROM tests WHERE id=?').get(parts[2]);if(!found)fail(404,'Test not found.');
        const previous=JSON.parse(found.definition);if(body.revision!==previous.revision)fail(409,'This test changed in another window. Reload it before saving.');
        const t=validateTest(body,previous);t.revision++;
        db.prepare('UPDATE tests SET definition=? WHERE id=?').run(JSON.stringify(t),t.id);return send(200,t);
      }
      if(req.method==='POST'&&url.pathname==='/api/runs'){
        const name=str(body.name,'name',200),build=str(body.build,'build',500),operator=str(body.operator,'operator',120),course=str(body.course,'course',100);
        if(!name||!build||!operator)fail(400,'Run name, packaged build identity and operator are required.');
        if(!enums.course.includes(course)||course==='Backlog')fail(400,'Choose a runnable course.');
        const tests=catalog().filter(t=>t.course===course&&t.kind!=='Placeholder');if(!tests.length)fail(400,'This course has no tests.');
        const id=randomUUID();db.exec('BEGIN');
        try{
          db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run(id,new Date().toISOString(),name,build,`${seed.gp.id} ${seed.gp.version}`,course,operator);
          const insert=db.prepare('INSERT INTO results (run_id,test_id,snapshot) VALUES (?,?,?)');for(const t of tests)insert.run(id,t.id,JSON.stringify(t));
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        return send(201,getRun(id));
      }
      if(req.method==='PATCH'&&parts[1]==='runs'&&parts[3]==='results'&&parts.length===5){
        if(execution(db,parts[2]))fail(409,'Automated evidence is read-only. Create a separate manual run to record a human observation.');
        const previous=db.prepare('SELECT * FROM results WHERE run_id=? AND test_id=?').get(parts[2],parts[4]);if(!previous)fail(404,'Run result not found.');
        if(body.revision!==previous.revision)fail(409,'This result changed in another window. Reload before saving.');
        if(!statuses.includes(body.status))fail(400,'Invalid result status.');
        const note=str(body.note??'','note'),evidence=str(body.evidence??'','evidence',2000),by=str(body.recordedBy,'recordedBy',120);
        if(!by)fail(400,'Record who observed this result.');
        if(['Pass','Fail','Blocked','N/A','Unknown'].includes(body.status)&&!note)fail(400,'Add an observation or reason for this outcome.');
        db.prepare('UPDATE results SET status=?,note=?,evidence=?,recorded_by=?,updated_at=?,revision=revision+1 WHERE run_id=? AND test_id=?').run(body.status,note,evidence,by,new Date().toISOString(),parts[2],parts[4]);
        return send(200,getRun(parts[2]));
      }
      return send(404,{error:'Endpoint not found.'});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed.'});
    if(url.pathname==='/history'){
      if(!historyUrl())fail(404,'No earlier history archive is installed.');
      const content=readFileSync(path.join(dataDir,'history.html'));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; sandbox"});return res.end(req.method==='HEAD'?undefined:content);
    }
    if(parts[0]==='exports'&&/^smoke-report-[a-f0-9-]{36}-[a-f0-9]{12}$/.test(parts[1]||'')&&((parts.length===3&&['index.html','report.json'].includes(parts[2]))||(parts.length===4&&parts[2]==='evidence'&&['plan.json','course.json','report.json','operations.jsonl','media-manifest.json','scope.json','execution-context.json','checkpoint.json'].includes(parts[3])))){
      let content;try{content=readFileSync(path.join(dataDir,...parts));}catch{fail(404,'Report file not found.');}
      const html=parts.at(-1)==='index.html';res.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin"});return res.end(req.method==='HEAD'?undefined:content);
    }
    if(parts[0]==='exports'&&parts.length===2&&/^wizard-smoke-\d+-[a-f0-9]{8}\.(csv|json)$/.test(parts[1])){
      let content;try{content=readFileSync(path.join(dataDir,'exports',parts[1]));}catch{fail(404,'Export not found.');}
      res.writeHead(200,{'Content-Type':parts[1].endsWith('.csv')?'text/csv; charset=utf-8':'application/json','Content-Disposition':`attachment; filename="${parts[1]}"`,'X-Content-Type-Options':'nosniff'});return res.end(content);
    }
    const assets={'/explainer':['explainer.html','text/html'],'/explainer.js':['explainer.js','text/javascript'],'/explainer.css':['explainer.css','text/css'],'/':['index.html','text/html'],'/desktop.js':['desktop.js','text/javascript'],'/run-setup.js':['run-setup.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/wizard-theme.css':['wizard-theme.css','text/css'],'/wizard-tokens.css':['wizard-tokens.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
    if(!assets[url.pathname])return send(404,{error:'File not found.'});
    const [file,type]=assets[url.pathname];const content=readFileSync(path.join(root,'public',file));
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'self'"});res.end(req.method==='HEAD'?undefined:content);
  }catch(error){send(error.status||500,{error:error.status?error.message:'Unable to save or load workspace data. Check the local server.'});if(!error.status)console.error(error);}
});
server.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log(`Wizard Smoke: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
