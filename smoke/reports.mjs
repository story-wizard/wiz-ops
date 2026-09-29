import path from 'node:path';
import {readFile,realpath,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {ROOT,dataDirectory,digest,inside} from './runner/files.mjs';
import {checkpoint} from './runner/checkpoints.mjs';
import {execution,activeStates} from './runner/store.mjs';

const files=['plan.json','course.json','report.json','operations.jsonl','media/manifest.json','scope.json','execution-context.json','checkpoint.json'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const counts=rows=>rows.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{});
export function retainedRun(db,id){
 const run=db.prepare('SELECT * FROM runs WHERE id=?').get(id);
 if(!run)throw Error('Run not found.');
 return {...run,checkpoint:checkpoint(db,id),execution:execution(db,id),results:db.prepare('SELECT * FROM results WHERE run_id=? ORDER BY rowid').all(id).map(r=>({...r,snapshot:JSON.parse(r.snapshot)}))};
}
export async function localReport(run,dataDir){
 const e=run.execution;if(!e)throw Error('This report requires an automated course execution.');
 if(activeStates.includes(e.state)&&e.state!=='Waiting for human')throw Error('Wait for the run to finish or be reconciled as interrupted before exporting.');
 const expectedRoot=path.join(path.resolve(dataDir),'runs',run.id);
 if(e.artifact_root!==expectedRoot)throw Error('Run artifact root does not match its identity.');
 const trustedRoot=path.join(await realpath(dataDir),'runs',run.id);
 const gaps=[],buffers={},artifacts=[];
 for(const file of files.filter(f=>f!=='checkpoint.json'||e.recipe.checkpoint)){
  try{
   const full=await realpath(path.join(expectedRoot,file));
   if(!inside(trustedRoot,full))throw Error('Evidence resolves outside the run directory.');
   const bytes=await readFile(full),name=file.replaceAll('/','-');
   buffers[name]=bytes;artifacts.push({file:name,source:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }catch(err){if(err.code!=='ENOENT')throw err;gaps.push('Missing retained '+file);}
 }
 const json=file=>{try{return JSON.parse(buffers[file]?.toString());}catch{gaps.push('Missing or invalid JSON: '+file);return null;}};
 const plan=json('plan.json'),course=json('course.json'),result=json('report.json'),fixtures=json('media-manifest.json');
 for(const field of ['planHash','packageHash','courseHash','fixtureHash','runnerHash'])if(!/^[a-f0-9]{64}$/.test(e.package[field]||''))gaps.push('Missing frozen identity: '+field);
 const identity=(value,key,expected,label)=>{if(!value||value[key]!==expected)gaps.push(label+' does not match the frozen execution.');};
 identity(plan,'planHash',e.plan_hash,'Prepared plan');
 if(plan){const {planHash,...content}=plan;if(digest(content)!==planHash)gaps.push('Prepared plan content digest is invalid.');}
 if(!course||digest(course)!==e.package.courseHash||digest(course)!==digest(e.recipe))gaps.push('Course definition does not match the frozen execution.');
 if(!plan||plan.packageHash!==e.package.packageHash||plan.fixtureHash!==e.package.fixtureHash)gaps.push('Package or fixture identity differs from the run record.');
 if(plan&&digest(plan)!==digest(e.package))gaps.push('Retained plan differs from the frozen database plan.');
 if(fixtures){const {sha256,...content}=fixtures;if(digest(content)!==sha256||sha256!==e.package.fixtureHash)gaps.push('Fixture manifest differs from the frozen execution.');}
 if(!result||result.runId!==run.id||result.state!==e.state||result.planHash!==e.plan_hash)gaps.push('Final report identity/state differs from the execution record.');
 const recorded=result?.results||[];
 if(recorded.length!==run.results.length||run.results.some(r=>!recorded.some(x=>(x.id||x.test_id)===r.test_id&&x.status===r.status&&(x.note??'')===(r.note??''))))gaps.push('Final report outcomes differ from retained database outcomes.');
 const expectedIDs=e.recipe.cases.map(c=>c.id),actualIDs=run.results.map(r=>r.test_id);
 if(new Set(actualIDs).size!==expectedIDs.length||actualIDs.length!==expectedIDs.length||expectedIDs.some(id=>!actualIDs.includes(id)))gaps.push('Required course results are missing or duplicated.');
 // ponytail: buffer one local course journal; stream it if retained courses outgrow memory.
 let receipts=[];try{const parsed=(buffers['operations.jsonl']?.toString()||'').split('\n').filter(Boolean).map(line=>JSON.parse(line));if(parsed.some(r=>!r||typeof r.caseId!=='string'||typeof r.operation!=='string'))throw Error('Invalid receipt');receipts=parsed;}catch{gaps.push('Operation journal is incomplete or invalid.');}
 if(!expectedIDs.length||e.state==='Passed'&&run.results.some(r=>r.status!=='Pass'))gaps.push('Execution summary disagrees with the required check outcomes.');
 const cases=run.results.map(r=>{
  const c=e.recipe.cases.find(c=>c.id===r.test_id),ops=receipts.filter(x=>x.caseId===r.test_id);
  if(r.status==='Pass'&&!ops.length)gaps.push(r.test_id+': passing observation has no operation receipts.');
  if(!['Pass','Fail','Blocked','Unknown','Not run','N/A'].includes(r.status))gaps.push(r.test_id+': nonterminal or unrecognized outcome '+r.status);
  return {id:r.test_id,title:r.snapshot.title,area:r.snapshot.area,sourceId:c?.sourceId||r.snapshot.sourceId,expected:c?.expected||r.snapshot.expected,operations:c?.operations||[],status:r.status,observation:r.note,recordedAt:r.updated_at,receiptCount:ops.length,operationDurationMs:ops.reduce((n,o)=>n+(Number(o.durationMs)||0),0)};
 });
 let scope,scopeBasis='Frozen with execution';
 if(buffers['scope.json'])scope=json('scope.json');
 else{scope=JSON.parse(await readFile(path.join(ROOT,'scope/v1-candidate.json'),'utf8'));scopeBasis='Current proposal for context; not frozen with this historical run';}
 let context=null;if(buffers['execution-context.json'])context=json('execution-context.json');
 if(context&&context.runnerHash!==e.package.runnerHash)gaps.push('Execution context does not identify the frozen runner.');
 let originals=[];
 if(scope?.checkpoint){
  const file='catalog/checkpoints/logan-2026-09-25-2.json',bytes=await readFile(path.join(ROOT,file));
  if(scope.checkpoint.file!==file||createHash('sha256').update(bytes).digest('hex')!==scope.checkpoint.sha256)gaps.push('Original checklist differs from the scope reference.');
  else originals=JSON.parse(bytes).rows;
 }
 const sourceRows=(scope?.sourceRows||[]).map(r=>({...r,criteria:originals.find(o=>o.id===r.id)?.criteria||'',results:cases.filter(c=>r.checkIds.includes(c.id)).map(c=>({id:c.id,status:c.status}))}));
 const human=run.checkpoint||null;if(e.recipe.checkpoint&&!human)gaps.push('Human checkpoint has no retained state.');
 if(human&&(!buffers['checkpoint.json']||digest(json('checkpoint.json'))!==digest(human)))gaps.push('Checkpoint artifact differs from its durable record.');
 const report={checkpoint:human,format:'wizard-smoke-local-report/v1',runId:run.id,asOf:e.updated_at,createdAt:run.created_at,operator:run.operator,title:run.name,
  execution:{state:e.state,message:e.message,target:e.recipe.target,courseId:e.recipe.id,courseRevision:e.recipe.revision,context},
  identities:{app:e.package.app,version:e.package.version,packageHash:e.package.packageHash,planHash:e.plan_hash,runnerHash:e.package.runnerHash,courseHash:e.package.courseHash,fixtureHash:e.package.fixtureHash,speechModel:e.package.speechModel,runtime:e.package.runtime||null},
  acceptance:{recordedOutcome:e.state,evidenceStatus:gaps.length?'Gaps found':'Ready for review',gaps:[...new Set(gaps)],scopeAcceptance:'Not assessed',explanation:'Checks retain their original outcomes. Evidence presence and consistency do not prove the assertions are sufficient or approve V1. Human, desktop, CI and publication acceptance are separate.'},
  counts:counts(cases),cases,selection:e.recipe.selection||null,fixtures,scope:{id:scope?.id,status:scope?.status,basis:scopeBasis,sourceRows},
  artifacts,delivery:{state:'Local only',externalPublication:'Not attempted',included:'Report, frozen run records and operation receipts when retained',excluded:'Media bytes, saved projects, rendered outputs and raw process logs stay in the original run folder; this is not a complete reproduction kit.'}};
 return {report,buffers};
}
export function renderReport(r){
 const table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(x=>'<th>'+escape(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(c=>'<tr>'+c.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const text=value=>'<pre>'+escape(typeof value==='string'?value:JSON.stringify(value,null,2))+'</pre>';
 const selection=r.selection?'<section><h2>Selected course</h2><p>'+escape(r.selection.requestedIds.length+' requested checks · '+r.selection.addedPrerequisites.length+' added prerequisites · '+r.selection.notSelected.length+' checks not selected · project '+r.selection.project)+'</p>'+table(['Group','Requested checks'],r.selection.groups.map(g=>[escape(g.title),escape(g.checks.join(', '))]))+'<p>'+escape(r.selection.addedPrerequisites.map(p=>p.id+': '+p.reason).join(' '))+'</p><details><summary>Course revisions and checks not selected</summary>'+text({courseRevisions:r.selection.courseRevisions,notSelected:r.selection.notSelected})+'</details><p>This custom selection does not claim full Smoke Test acceptance.</p></section>':'';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smoke report '+escape(r.runId)+'</title><style>body{color:#eeedf5;background:#17171c;font:16px/1.55 system-ui;margin:0}main{max-width:1200px;margin:auto;padding:40px 28px}h1{font-size:36px;line-height:1.15}h2{margin-top:38px}p{max-width:85ch;color:#c5c3d0}a{color:#bcaaff}nav{display:flex;gap:20px;flex-wrap:wrap}.cards{display:flex;flex-wrap:wrap;gap:16px}.card,details{padding:16px 20px;background:#24232d;border:1px solid #44404f;border-radius:12px}.card b{display:block;font-size:23px}summary{cursor:pointer;font-weight:650}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:12px;border-bottom:1px solid #44404f;text-align:left;vertical-align:top}th{color:#bcaaff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}small{display:block;color:#b8b5c7}strong{color:#fff}section{scroll-margin-top:20px}a:focus-visible,summary:focus-visible{outline:3px solid #baa2ff;outline-offset:4px}@media print{body{background:#fff;color:#111}p,small,strong,th,a{color:#111}.card,details{background:#fff}details{display:block}}</style><main>'+
 '<small>WIZARD · LOCAL SMOKE REPORT</small><h1>'+escape(r.title)+'</h1><p>'+escape(r.execution.target)+' · '+escape(r.identities.version)+'<br>Run '+escape(r.runId)+' · '+escape(r.operator)+' · snapshot '+escape(r.asOf)+'</p>'+
 '<nav><a href="#checks">Checks</a><a href="#acceptance">Acceptance</a><a href="#coverage">Coverage</a><a href="#fixtures">Fixtures</a><a href="#evidence">Evidence</a><a href="report.json">Report JSON</a></nav>'+
 '<h2>What this run establishes</h2><div class="cards"><div class="card"><small>Recorded execution</small><b>'+escape(r.execution.state)+'</b></div><div class="card"><small>Evidence inventory</small><b>'+escape(r.acceptance.evidenceStatus)+'</b></div><div class="card"><small>V1 acceptance</small><b>Not assessed</b></div></div><p>'+escape(r.acceptance.explanation)+'</p><p>'+escape(Object.entries(r.counts).map(([k,v])=>v+' '+k).join(' · '))+'</p>'+
 (r.checkpoint?'<section><h2>Human checkpoint</h2><p>'+escape(r.checkpoint.definition.title)+' · '+escape(r.checkpoint.state)+'</p><p>Human observations and automated verification are separate. A passing structural check cannot clear a human failure.</p>'+table(['Tester / recording method','Outcome','Observation','Hands-on time'],r.checkpoint.observations.map(o=>[escape(o.operator)+'<small>'+escape(o.recordedVia)+'</small>',escape(o.outcome),escape(o.note),escape(o.handsOnSeconds)+' seconds']))+'<details><summary>Instructions, diagnostics and continuation</summary>'+text(r.checkpoint)+'</details></section>':'')+selection+'<section id="checks"><h2>Checks and observations</h2>'+table(['Check / category','Outcome','Expected → observed','Ops / receipts'],r.cases.map(c=>[escape(c.id)+'<br><strong>'+escape(c.title)+'</strong><small>'+escape(c.area)+'</small>',escape(c.status),'<strong>'+escape(c.expected)+'</strong><p>'+escape(c.observation)+'</p>',escape(c.operations.join(', '))+'<small>'+c.receiptCount+' receipts · '+c.operationDurationMs+' ms summed operation time</small>']))+'</section>'+
 '<section id="acceptance"><h2>Acceptance evidence</h2><p>Readiness proves prerequisites before launch. A passing check records the assertion result for this build. Acceptance additionally requires review of the intended behavior, its independent oracle, representative variants, and defect-sensitive tests. This report does not grant that approval.</p><ul>'+r.acceptance.gaps.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul><details><summary>Build, course, fixture and environment identities</summary>'+text(r.identities)+text(r.execution.context||'Environment context was not retained by this older runner.')+'</details></section>'+
 '<section id="coverage"><h2>Coverage of Logan’s checklist</h2><p>'+escape(r.scope.status)+' · '+escape(r.scope.basis)+'. A passing counterpart does not pass the whole source row or all project variants.</p>'+table(['Source / area','Disposition','This run','Remaining behavior'],r.scope.sourceRows.map(s=>[escape(s.id)+'<small>'+escape(s.area)+'</small><p>'+escape(s.criteria)+'</p>',escape(s.disposition),s.results.length?s.results.map(x=>escape(x.id+': '+x.status)).join('<br>'):'Not exercised here',escape(s.remaining)+'<small>'+escape(s.representativeVariantAcceptance)+'</small>']))+'</section>'+
 '<section id="fixtures"><h2>Reproducible fixture inputs</h2><p>Media hashes identify the exact prepared bytes; generation on another OS/tool version is not assumed byte-identical. Fresh, Story-user and Large variants require their own agreed recipes and expected states.</p>'+table(['Fixture','Expected media','SHA-256'],(r.fixtures?.files||[]).map(f=>[escape(f.id)+'<small>'+escape(f.file)+'</small>',text(f.expected),text(f.sha256)]))+'</section>'+
 '<section id="evidence"><h2>Local delivery</h2><p>'+escape(r.delivery.included)+'. '+escape(r.delivery.excluded)+' Raw receipts can contain local paths and identifying context; external publication has not been attempted.</p>'+table(['Retained file','Bytes','SHA-256'],r.artifacts.map(a=>['<a href="evidence/'+encodeURIComponent(a.file)+'">'+escape(a.source)+'</a>',String(a.bytes),text(a.sha256)]))+'<p>Delivery state: <strong>Local only</strong>. Retry delivery independently of execution; never rerun tests just to regenerate this report.</p></section></main></html>';
}
export async function exportLocalReport(run,dataDir){
 dataDir=dataDirectory(dataDir);
 const {report,buffers}=await localReport(run,dataDir),name='smoke-report-'+run.id+'-'+digest(report).slice(0,12),parent=path.join(dataDir,'exports');
 await mkdir(parent,{recursive:true});const directory=path.join(parent,name),temporary=await mkdtemp(path.join(parent,'.report-'));
 try{
  await mkdir(path.join(temporary,'evidence'));
  for(const [file,bytes]of Object.entries(buffers))await writeFile(path.join(temporary,'evidence',file),bytes);
  await writeFile(path.join(temporary,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(path.join(temporary,'index.html'),renderReport(report));
  try{await rename(temporary,directory);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;}
 }finally{await rm(temporary,{recursive:true,force:true});}
 return {path:path.join(directory,'index.html'),url:'/exports/'+name+'/index.html',runId:run.id,evidenceStatus:report.acceptance.evidenceStatus,publication:'Local only'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
 let db;try{
  if(!args.includes('--run-id'))throw Error('Usage: npm run smoke:report -- --run-id ID [--data-dir PATH]');
  const data=dataDirectory(args.includes('--data-dir')?arg('--data-dir'):undefined);
  db=new DatabaseSync(path.join(data,'smoke.sqlite'),{readOnly:true});
  console.log(JSON.stringify(await exportLocalReport(retainedRun(db,arg('--run-id')),data),null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}finally{db?.close();}
}
