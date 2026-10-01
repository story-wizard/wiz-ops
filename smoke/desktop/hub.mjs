import path from 'node:path';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync,openSync,closeSync,realpathSync,appendFileSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {ROOT,dataDirectory} from '../runner/files.mjs';
import {verifyDesktopOwner} from './adapter.mjs';
export const desktopCourse=JSON.parse(readFileSync(path.join(ROOT,'desktop/course.json')));
export const serviceCourse=JSON.parse(readFileSync(path.join(ROOT,'desktop/service-course.json')));
export const reviewOutcomes=['Confirmed defect','Could not reproduce','Setup blocked','Needs investigation'];
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function runDirectory(data,id){if(!/^desktop-[A-Za-z0-9]+$/.test(id))throw Error('Invalid desktop run ID');const base=path.join(data,'desktop-runs'),dir=path.join(base,id);if(!existsSync(dir)||!realpathSync(dir).startsWith(realpathSync(base)+path.sep))throw Error('Unknown desktop run');return dir;}
export function sourceRun(data,id,expectedHash){const root=runDirectory(data,id),report=read(path.join(root,'desktop-course-report.json')),session=read(path.join(root,'session.json'));const reportHash=digest(path.join(root,'desktop-course-report.json'));if(expectedHash&&expectedHash!==reportHash)throw Error('Original report changed; review the run setup again');return {root,report,session,reportHash};}
function live(job){try{return Boolean(job.pid)&&execFileSync('/bin/ps',['-p',String(job.pid),'-o','command='],{encoding:'utf8'}).includes(path.join(ROOT,'desktop/worker.mjs')+' '+job.id);}catch{return false;}}
export function ownedDesktopSessions(data){
 const directories=[path.join(data,'desktop-runs'),path.join(data,'attachments')],runs=path.join(data,'runs'),sessions=[];
 if(existsSync(runs))for(const id of readdirSync(runs).filter(id=>/^[a-f0-9-]{36}$/.test(id)))for(const target of ['service','desktop'])directories.push(path.join(runs,id,'stages',target));
 for(const directory of directories){if(!existsSync(directory))continue;for(const id of readdirSync(directory).filter(id=>/^(desktop|attach)-[A-Za-z0-9]+$/.test(id))){const file=path.join(directory,id,'session.json');if(!existsSync(file))continue;try{const s=read(file);if(['Attached','Running'].includes(s.state)){verifyDesktopOwner(s,data);sessions.push({file,pid:s.pid,root:s.root});}}catch{}}}
 return sessions;
}
export function desktopState(data){
 const base=path.join(data,'desktop-runs'),jobsDir=path.join(data,'desktop-jobs');
 const runs=existsSync(base)?readdirSync(base).filter(id=>/^desktop-[A-Za-z0-9]+$/.test(id)&&existsSync(path.join(base,id,'desktop-course-report.json'))).map(id=>{const x=sourceRun(data,id);return {id,...x.report,reportHash:x.reportHash};}).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)):[];
 const jobs=existsSync(jobsDir)?readdirSync(jobsDir).filter(id=>/^[a-f0-9-]{36}$/.test(id)).map(id=>{const file=path.join(jobsDir,id,'job.json'),j=read(file);if(['Preparing','Ready','Running'].includes(j.state)&&!live(j))return {...j,state:'Interrupted',message:'Worker stopped. Inspect its retained session before starting again.'};return j;}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)):[];
 return {course:desktopCourse,serviceCourse,runs,jobs,ownedSessions:ownedDesktopSessions(data),outcomes:reviewOutcomes};
}
export function startDesktopJob(data,body){
 data=dataDirectory(data);
 if(ownedDesktopSessions(data).length)throw Error('An owned desktop process remains active; finish or inspect its session before another launch.');
 if(!['course','service','handoff'].includes(body.kind))throw Error('Unknown job kind');
 if(desktopState(data).jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)))throw Error('A desktop course or human setup is already active');
 const base=path.join(data,'desktop-runs');for(const name of existsSync(base)?readdirSync(base):[]){const file=path.join(base,name,'session.json');if(!existsSync(file))continue;const s=read(file);if(s.state!=='Running')continue;let alive=false;try{verifyDesktopOwner(s,data);alive=true;}catch{}if(alive)throw Error('An owned desktop app is still running. Finish its setup before starting another.');}
 const source=sourceRun(data,body.sourceRun,body.sourceReportHash),definition=desktopCourse.cases.find(c=>c.id===body.caseId);
 if(body.kind==='handoff'&&(!definition?.steps||!source.report.results.some(r=>r.id===body.caseId&&['Fail','Blocked','Unknown'].includes(r.status))))throw Error('Choose a failed check with a functional brief');
 const id=randomUUID(),root=path.join(data,'desktop-jobs',id);mkdirSync(root,{recursive:true,mode:0o700});
 const job={id,kind:body.kind,sourceRun:body.sourceRun,sourceReportHash:source.reportHash,caseId:body.caseId||null,state:'Preparing',createdAt:new Date().toISOString(),root,diagnosticProfile:'State, GUI controls and bounded application logs; no CPU/GPU profiler',definition:definition||null};
 // Admission and PID registration stay synchronous so a polling request cannot see a half-started worker.
 writeFileSync(path.join(root,'job.json'),JSON.stringify(job));const fd=openSync(path.join(root,'worker.log'),'a');
 try{const child=spawn(process.execPath,[path.join(ROOT,'desktop/worker.mjs'),id],{cwd:ROOT,env:{...process.env,SMOKE_DATA_DIR:data},detached:true,stdio:['ignore',fd,fd]});job.pid=child.pid;writeFileSync(path.join(root,'job.json'),JSON.stringify(job));child.on('error',e=>{writeFileSync(path.join(root,'job.json'),JSON.stringify({...job,state:'Failed',message:e.message}));});child.unref();}finally{closeSync(fd);}
 return job;
}
export function getJob(data,id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid job ID');const root=path.join(data,'desktop-jobs',id),j=read(path.join(root,'job.json'));if(j.root!==root)throw Error('Job path mismatch');return j;}
export function requestJob(data,id,action,body={}){
 const j=getJob(data,id);if(!['capture','profile','finish','review','draft'].includes(action))throw Error('Unknown handoff action');
 if(j.kind!=='handoff')throw Error('This is not a human setup');
 const source=sourceRun(data,j.sourceRun);if(source.reportHash!==j.sourceReportHash)throw Error('Original report changed; review this handoff before continuing');
 if(['review','draft'].includes(action)&&j.state==='Preparing')throw Error('Wait for setup to finish or report its failure before recording a finding');
 if(action==='draft'){if(typeof body.text!=='string'||body.text.length>32000)throw Error('Invalid draft');mkdirSync(path.join(j.root,'draft-versions'),{recursive:true});writeFileSync(path.join(j.root,'draft-versions',randomUUID()+'.md'),body.text);writeFileSync(path.join(j.root,'bug-draft.md'),body.text);return {saved:true};}
 if(action==='review'){
  if(!reviewOutcomes.includes(body.outcome)||typeof body.operator!=='string'||!body.operator.trim()||body.operator.length>120||typeof body.note!=='string'||!body.note.trim()||body.note.length>6000)throw Error('A reviewer, outcome and observation are required');
  const entry={id:randomUUID(),at:new Date().toISOString(),operator:body.operator.trim(),outcome:body.outcome,note:body.note.trim(),sourceReportHash:j.sourceReportHash};
  mkdirSync(path.join(j.root,'reviews'),{recursive:true});writeFileSync(path.join(j.root,'reviews',entry.id+'.json'),JSON.stringify(entry,null,2));appendFileSync(path.join(j.root,'bug-draft.md'),`\n### ${entry.at} — ${entry.operator}\n\n${entry.outcome}\n\n${entry.note}\n`);return entry;
 }
 if(j.state!=='Ready'||!live(j))throw Error('The prepared app is not available');
 const request=path.join(j.root,'request.json');if(existsSync(request))throw Error('A diagnostic request is already pending');writeFileSync(request,JSON.stringify({action,id:randomUUID()}),{flag:'wx'});return {requested:action};
}
export function jobDetails(data,id){let j=getJob(data,id);if(['Preparing','Ready','Running'].includes(j.state)&&!live(j))j={...j,state:'Interrupted',message:'Worker stopped; inspect the retained session before starting another.'};const reviews=path.join(j.root,'reviews');return {...j,brief:existsSync(path.join(j.root,'brief.md'))?readFileSync(path.join(j.root,'brief.md'),'utf8'):'',ozPrompt:existsSync(path.join(j.root,'oz-prompt.txt'))?readFileSync(path.join(j.root,'oz-prompt.txt'),'utf8'):'',bugDraft:existsSync(path.join(j.root,'bug-draft.md'))?readFileSync(path.join(j.root,'bug-draft.md'),'utf8'):'',reviews:existsSync(reviews)?readdirSync(reviews).filter(n=>n.endsWith('.json')).map(n=>read(path.join(reviews,n))).sort((a,b)=>a.at.localeCompare(b.at)):[]};}

export function initializeDesktopCatalog(db){
 for(const [name,definition] of [['Local desktop',desktopCourse],['Local services',serviceCourse]])for(const c of definition.cases){
  const stored=db.prepare('SELECT definition FROM tests WHERE id=?').get(c.id);if(stored&&JSON.parse(stored.definition).revision!==1)continue;
  const source=c.sourceId?JSON.parse(db.prepare('SELECT definition FROM tests WHERE id=?').get(c.sourceId).definition):{};
  const t={...source,id:c.id,sourceId:c.sourceId,sourceRow:source.sourceRow||null,sourceResults:null,title:c.title,criteria:c.expected,area:source.area||'Desktop interaction',execution:'Automated',course:name,readiness:'Ready for pilot',priority:'P1',environment:'Local',gpScope:'GP v0',owner:'Unassigned',fixtureIds:['gp-project','gp-media','gp-timelines'],revision:1,kind:c.sourceId?'Automated counterpart':'Team addition',approach:definition.target,expected:c.expected,blocker:'See run evidence; not release-package acceptance.',notes:'Automated failures require a separate human investigation; original results are immutable.',automation:{course:definition.id,target:definition.target}};
  db.prepare('INSERT INTO tests VALUES (?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition').run(c.id,JSON.stringify(t));
 }
}
