import path from 'node:path';
import {readFile,realpath,mkdir,mkdtemp,writeFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {ROOT,dataDirectory,digest,inside} from './runner/files.mjs';
import {checkpoint} from './runner/checkpoints.mjs';
import {execution,activeStates} from './runner/store.mjs';
import {retainedUI} from './desktop/computer-use.mjs';
import {testSpecification,actionHistory,stepHistory,evidenceItems,evidenceCoverage,agentPrompt} from './test-details.mjs';
import {checkRegistry} from './runner/catalog.mjs';
import {runTiming,formatDuration,progressBar,progressEffects} from './public/run-display.js';

const wizardTokens=await readFile(new URL('./public/wizard-tokens.css',import.meta.url),'utf8');
const sceneURI='data:image/jpeg;base64,'+(await readFile(new URL('./public/athanor-scene.jpg',import.meta.url))).toString('base64');
const smokeURI='data:image/png;base64,'+(await readFile(new URL('./public/brand-smoke.png',import.meta.url))).toString('base64');
const wordmarkURI='data:image/png;base64,'+(await readFile(new URL('./public/athanor-wordmark.png',import.meta.url))).toString('base64');
const wizardLogoURI='data:image/svg+xml;base64,'+(await readFile(new URL('./public/wizard-logo.svg',import.meta.url))).toString('base64');
const smokeTheme=(await readFile(new URL('./public/smoke-theme.css',import.meta.url),'utf8')).replaceAll('/athanor-scene.jpg',sceneURI).replaceAll('/brand-smoke.png',smokeURI).replaceAll('/athanor-wordmark.png',wordmarkURI);
const filterScript=(await readFile(new URL('./public/filters.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const files=['plan.json','course.json','report.json','operations.jsonl','media/manifest.json','scope.json','execution-context.json','checkpoint.json'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const counts=rows=>rows.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{});
const reportControls=`
const body=document.querySelector('#checks tbody'),rows=[...body.rows];
const search=document.querySelector('#search'),result=document.querySelector('#result'),area=document.querySelector('#area'),target=document.querySelector('#target'),sort=document.querySelector('#sort');
const count=document.querySelector('#visible-count'),empty=document.querySelector('#empty');
const priority=['Fail','Unknown','Blocked','Not run','Pass','N/A'];
function update(){
 const query=search.value.trim().toLowerCase();
 const ordered=[...rows].sort((a,b)=>sort.value==='name'?a.dataset.title.localeCompare(b.dataset.title,undefined,{numeric:true}):sort.value==='result'?priority.indexOf(a.dataset.result)-priority.indexOf(b.dataset.result)||Number(a.dataset.order)-Number(b.dataset.order):Number(a.dataset.order)-Number(b.dataset.order));
 let visible=0;
 for(const row of ordered){row.hidden=!!((query&&!row.textContent.toLowerCase().includes(query))||!matchesFilter(row.dataset.result,selectedValues(result))||!matchesFilter(row.dataset.area,selectedValues(area))||!matchesFilter(row.dataset.target,selectedValues(target)));if(!row.hidden)visible++;body.append(row);}
 count.textContent=visible+' of '+rows.length+' checks';empty.hidden=visible!==0;enhanceFilters();rememberFilters('report',controlSnapshot(['search','result','area','target','sort']));
}
search.addEventListener('input',update);for(const field of [result,area,target,sort])field.addEventListener('change',update);
document.querySelector('#reset').addEventListener('click',()=>{search.value=result.value=area.value=target.value='';sort.value='course';update();});
restoreControls(readFilterStore('report').last,['search','result','area','target','sort']);
savedFilters(document.querySelector('.controls'),'report',()=>controlSnapshot(['search','result','area','target','sort']),view=>{restoreControls(view,['search','result','area','target','sort']);update();});
update();`;
const detailControls=`
const dialog=document.querySelector('#test-detail');
if(dialog){
 let active=null,opener=null;
 const embedded=new URLSearchParams(location.search).get('detail')==='1'&&window.parent!==window;
 if(embedded)document.body.classList.add('detail-only');
 const panels=[...dialog.querySelectorAll('[data-panel]')];
 function show(id){active=id;for(const panel of panels)panel.hidden=panel.dataset.panel!==id;document.querySelector('#detail-position').textContent='Check '+(Number(id)+1)+' of '+rows.length;dialog.scrollTop=0;}
 body.addEventListener('click',event=>{const button=event.target.closest('[data-open]');if(button){opener=button;show(button.dataset.open);dialog.showModal();}});
 document.querySelector('#detail-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{if(embedded)window.parent.postMessage({type:'athanor-close-details'},'*');else opener?.focus();});
 function requestedCheck(){const requested=new URLSearchParams(location.hash.slice(1)).get('check'),row=rows.find(r=>r.dataset.checkId===requested);if(row){show(row.dataset.order);if(!dialog.open){if(embedded)dialog.show();else dialog.showModal();}}}
 requestedCheck();
 if(embedded){window.addEventListener('hashchange',requestedCheck);document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dialog.close();}});}
 for(const [id,direction]of [['detail-prev',-1],['detail-next',1]])document.querySelector('#'+id).addEventListener('click',()=>{const visible=rows.filter(r=>!r.hidden),index=visible.findIndex(r=>r.dataset.order===active),next=visible[index+direction];if(next)show(next.dataset.order);});
 dialog.addEventListener('click',async event=>{const copy=event.target.closest('[data-copy]');if(!copy)return;const field=dialog.querySelector('[data-panel="'+active+'"] textarea');try{await navigator.clipboard.writeText(field.value);copy.textContent='Copied';}catch{field.focus();field.select();copy.textContent=document.execCommand('copy')?'Copied':'Selected · copy with your keyboard';}});
}
`;
export const reportScriptHash=createHash('sha256').update(filterScript+reportControls+detailControls).digest('base64');
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
 for(const file of ['test-specifications.json','steps.jsonl']){try{const full=await realpath(path.join(expectedRoot,file));if(!inside(trustedRoot,full))throw Error('Evidence resolves outside the run directory.');const bytes=await readFile(full);buffers[file]=bytes;artifacts.push({file,source:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}catch(err){if(err.code!=='ENOENT')throw err;}}
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
 let specifications=null,stepEvents=[];if(buffers['test-specifications.json']){specifications=json('test-specifications.json');if(specifications?.courseHash!==e.package.courseHash||specifications?.runnerHash!==e.package.runnerHash)gaps.push('Test specification snapshot differs from the frozen execution.');}
 if(buffers['steps.jsonl'])try{stepEvents=buffers['steps.jsonl'].toString().split('\n').filter(Boolean).map(JSON.parse);}catch{gaps.push('Step journal is incomplete or invalid.');}
 const retainArtifact=async source=>{
  const full=await realpath(source);if(!inside(trustedRoot,full))throw Error('Check artifact resolves outside its run.');
  if((await stat(full)).size>32*1024*1024)throw Error('Check artifact exceeds the 32 MB report limit.');
  const bytes=await readFile(full),hash=createHash('sha256').update(bytes).digest('hex'),name='computer-use-'+hash.slice(0,12)+'-'+path.basename(full);
  if(!buffers[name]){buffers[name]=bytes;artifacts.push({file:name,source:path.relative(trustedRoot,full),bytes:bytes.length,sha256:hash});}return name;
 };
 const registry=checkRegistry(),cases=[];for(const r of run.results){
  const c=e.recipe.cases.find(c=>c.id===r.test_id),ops=receipts.filter(x=>x.caseId===r.test_id);
  if(r.status==='Pass'&&!ops.some(o=>o.operation!=='check.observation'))gaps.push(r.test_id+': passing observation has no operation receipts.');
  if(!['Pass','Fail','Blocked','Unknown','Not run','N/A'].includes(r.status))gaps.push(r.test_id+': nonterminal or unrecognized outcome '+r.status);
  const target=c?.target||(/^D-/.test(r.test_id)?'desktop':/^S-/.test(r.test_id)?'service':'packaged');
  const spec=specifications?.checks?.find(s=>s.id===r.test_id)||testSpecification({...c,id:r.test_id,title:r.snapshot.title,expected:c?.expected||r.snapshot.expected});
  if(specifications&&spec.definitionHash!==digest(c))gaps.push(r.test_id+': test specification definition differs from the frozen course.');
  const actions=actionHistory(ops.filter(o=>!o.operation.startsWith('native.')&&!o.operation.startsWith('physical.')),ops.filter(o=>o.operation.startsWith('native.')),ops.filter(o=>o.operation.startsWith('physical.'))),found=new Set();
  const visit=(v,base=expectedRoot)=>{if(typeof v==='string'&&(v.startsWith('evidence/')||path.isAbsolute(v))&&/\.(png|jpe?g|gif|mp4|mov|webm|wav|mp3|m4a|json|txt)$/i.test(v))found.add(path.isAbsolute(v)?v:path.join(base,v));else if(v&&typeof v==='object')Object.values(v).forEach(x=>visit(x,base));};
  for(const o of ops){const base=o.source?path.dirname(o.source):expectedRoot;visit(o.evidence||o.response?.result,base);if(o.operation.startsWith('physical.')){visit(o.request,base);visit(o.receipt,base);}if(o.operation.startsWith('render.')&&o.stdout)try{visit(JSON.parse(o.stdout).result);}catch{}}
  try{for(const name of await readdir(path.join(expectedRoot,'projects',r.test_id)))if(/\.(png|json)$/.test(name))found.add(path.join(expectedRoot,'projects',r.test_id,name));}catch(err){if(err.code!=='ENOENT')throw err;}
  const evidenceFiles=[];for(const source of found)try{evidenceFiles.push(await retainArtifact(source));}catch(err){gaps.push(r.test_id+': '+err.message);}
  const evidence=evidenceItems(evidenceFiles,spec),requirements=evidenceCoverage(spec,evidence,actions);
  for(const requirement of requirements.filter(x=>x.status==='Missing'))gaps.push(r.test_id+': missing required evidence '+requirement.id);
  cases.push({id:r.test_id,title:r.snapshot.title,area:r.snapshot.area,target,sourceId:c?.sourceId||r.snapshot.sourceId,expected:spec.expected,operations:c?.operations||[],status:r.status,observation:r.note,recordedAt:r.updated_at,receiptCount:ops.length,operationDurationMs:ops.reduce((n,o)=>n+(Number(o.durationMs)||0),0),method:spec.method,methodBasis:specifications?'Frozen with this run':'Current test guide',definitionHash:spec.definitionHash,steps:stepHistory(spec,stepEvents.filter(x=>x.caseId===r.test_id),actions),actions,evidence,evidenceRequirements:requirements,editPrompt:agentPrompt(spec,{runId:run.id,outcome:r.status,accepted:registry.find(x=>x.id===r.test_id)?.accepted||false})});
 }
 let computerUse=null;
 try{
  computerUse=await retainedUI(dataDir,run.id);
  if(computerUse){
   if((computerUse.sourcePackageHash||computerUse.packageHash)!==e.package.packageHash)throw Error('Computer-use pass targets a different source package.');
   const include=async(source,name)=>{const bytes=await readFile(path.join(expectedRoot,source));buffers[name]=bytes;artifacts.push({file:name,source,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});};
   await include('computer-use/pass.json','computer-use-pass.json');
   for(const r of computerUse.results)for(const a of r.artifacts)await include('computer-use/'+a.file,'computer-use-'+a.sha256.slice(0,12)+'-'+path.basename(a.file));
   computerUse.cases=computerUse.results.map(r=>{const c=computerUse.course.cases.find(c=>c.id===r.id);return {...c,area:'Release UI pilot',target:computerUse.runtimeOverride?'computer-use-patched':'computer-use',status:r.status,observation:r.note,operations:['OS keyboard, mouse and accessibility'],evidenceFiles:r.artifacts.map(a=>'computer-use-'+a.sha256.slice(0,12)+'-'+path.basename(a.file))};});
  }
 }catch(error){computerUse=null;gaps.push('Computer-use evidence: '+error.message);}
 let scope,scopeBasis='Frozen with execution';
 if(buffers['scope.json'])scope=json('scope.json');
 else{scope=JSON.parse(await readFile(path.join(ROOT,'scope/v1-candidate.json'),'utf8'));scopeBasis='Current proposal for context; not frozen with this historical run';}
 let context=null;if(buffers['execution-context.json'])context=json('execution-context.json');
 if(context?.testSpecificationsHash&&digest(specifications)!==context.testSpecificationsHash)gaps.push('Test specification content differs from its retained digest.');
 if(context&&context.runnerHash!==e.package.runnerHash)gaps.push('Execution context does not identify the frozen runner.');
 let originals=[];
 if(scope?.checkpoint){
  const file='catalog/checkpoints/logan-2026-09-25-2.json',bytes=await readFile(path.join(ROOT,file));
  if(scope.checkpoint.file!==file||createHash('sha256').update(bytes).digest('hex')!==scope.checkpoint.sha256)gaps.push('Original checklist differs from the scope reference.');
  else originals=JSON.parse(bytes).rows;
 }
 const sourceRows=(scope?.sourceRows||[]).map(r=>({...r,criteria:originals.find(o=>o.id===r.id)?.criteria||'',results:[...cases.filter(c=>r.checkIds.includes(c.id)).map(c=>({id:c.id,status:c.status})),...(computerUse?.cases||[]).filter(c=>c.sourceId===r.id).map(c=>({id:c.id,status:c.status,pilot:true}))]}));
 const human=run.checkpoint||null;if(e.recipe.checkpoint&&!human)gaps.push('Human checkpoint has no retained state.');
 if(human&&(!buffers['checkpoint.json']||digest(json('checkpoint.json'))!==digest(human)))gaps.push('Checkpoint artifact differs from its durable record.');
 const report={checkpoint:human,timing:runTiming(run),format:'wizard-smoke-local-report/v1',runId:run.id,asOf:e.updated_at,createdAt:run.created_at,operator:run.operator,title:run.name,
  execution:{state:e.state,message:e.message,target:e.recipe.target,courseId:e.recipe.id,courseRevision:e.recipe.revision,context},
  identities:{app:e.package.app,version:e.package.version,packageHash:e.package.packageHash,planHash:e.plan_hash,runnerHash:e.package.runnerHash,courseHash:e.package.courseHash,fixtureHash:e.package.fixtureHash,speechModel:e.package.speechModel,runtime:e.package.runtime||null},
  acceptance:{recordedOutcome:e.state,evidenceStatus:gaps.length?'Gaps found':'Ready for review',gaps:[...new Set(gaps)],scopeAcceptance:'Not assessed',explanation:'Checks retain their original outcomes. Evidence presence and consistency do not prove the assertions are sufficient or approve V1. Human, desktop, CI and publication acceptance are separate.'},
  counts:counts(cases),cases,computerUse,targets:[...[...new Set(cases.map(c=>c.target))].map(target=>({target,counts:counts(cases.filter(c=>c.target===target)),build:target==='packaged'?e.package.version:'Instrumented app',hash:target==='packaged'?e.package.packageHash:e.package.runtime?.appHash||null})),...(computerUse?[{target:computerUse.runtimeOverride?'computer-use-patched':'computer-use',counts:counts(computerUse.cases),build:computerUse.version,hash:computerUse.packageHash}]:[])],selection:e.recipe.selection||null,fixtures,scope:{id:scope?.id,status:scope?.status,basis:scopeBasis,sourceRows},
  artifacts,delivery:{state:'Local only',externalPublication:'Not attempted',included:'Report, frozen run records and operation receipts when retained',excluded:'Media bytes, saved projects, rendered outputs and raw process logs stay in the original run folder; this is not a complete reproduction kit.'}};
 return {report,buffers};
}
export function renderReport(r){
 const text=value=>'<pre>'+escape(typeof value==='string'?value:JSON.stringify(value,null,2))+'</pre>';
 const table=(heads,rows)=>'<div class="table"><table><thead><tr>'+heads.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const badge=value=>'<span class="badge '+(['Pass','Passed','Completed'].includes(value)?'pass':['Fail','Failed'].includes(value)?'fail':'')+'">'+escape(value)+'</span>';
 const options=(values)=>[...new Set(values)].sort().map(v=>'<option value="'+escape(v)+'">'+escape(v)+'</option>').join('');
 const targetLabel=t=>({packaged:'Selected package engine',desktop:'Instrumented desktop',service:'Instrumented services','computer-use':'Selected package · computer use','computer-use-patched':'Smoke copy · patched Cocoa plugin'}[t]||t);
 const rows=[...r.cases,...(r.computerUse?.cases||[])];
 const artifactHtml=a=>{const url='evidence/'+encodeURIComponent(a.file),link='<a href="'+url+'" target="_blank" rel="noopener">Open evidence</a>';return '<figure>'+(a.kind==='image'?'<a href="'+url+'" target="_blank" rel="noopener"><img loading="lazy" src="'+url+'" alt="'+escape(a.caption)+'"></a>':a.kind==='video'?'<video controls preload="metadata" src="'+url+'"></video>':a.kind==='audio'?'<audio controls preload="metadata" src="'+url+'"></audio>':link)+'<figcaption>'+escape(a.caption)+'</figcaption></figure>';};
 const measureLabels={samplesDuringHold:'Frames captured while held',changedSamples:'Frames changed from baseline',evolvingSamples:'Frames changed during the drag',maxCaptureMs:'Longest frame capture',maxSampleGapMs:'Longest gap between captures',heldMs:'Gesture held'};
 const detail=(c,i)=>{
  const recorded=c.actions||[],useful=recorded.filter(a=>!['project.get_name','inspect','activate'].includes(a.operation)),actions=[];for(const a of useful.length?useful:recorded){const last=actions.at(-1);if(last&&last.operation===a.operation&&last.status===a.status&&last.channel===a.channel&&last.stepId===a.stepId){last.count++;last.durationMs+=(a.durationMs||0);}else actions.push({...a,count:1});}
  const actionList=actions.map(a=>'<li><strong>'+escape(a.title)+'</strong>'+(a.count>1?' <small>'+a.count+' recorded calls</small>':'')+'<small>'+escape(a.channel)+' · '+escape(a.status)+(a.detail?' · '+escape(a.detail):'')+'</small></li>').join('');
  const evidence=c.evidence||evidenceItems(c.evidenceFiles||[]),media=evidence.filter(a=>a.kind!=='json'),json=evidence.filter(a=>a.kind==='json');
  const history=c.attempts?.length?'<h3>Attempt history</h3><p>'+escape(c.historyLabel)+'</p>'+c.attempts.map((a,n)=>'<details><summary>Attempt '+(n+1)+' · '+badge(a.status)+' · '+escape(a.mode)+'</summary><p>'+escape(a.observation)+'</p><small>'+escape(a.attempt)+' · '+escape(a.qualification)+' · '+escape(a.recordedAt||'Open attempt')+'</small>'+(a.verdictHistory.length>1?'<p class="gap">Conflicting historical verdicts retained: '+a.verdictHistory.map(v=>badge(v.status)).join(' ')+'</p>':'')+'<ol class="steps">'+a.actions.map(x=>'<li>'+escape(x.title)+'<small>'+escape(x.channel)+' · '+escape(x.status)+'</small></li>').join('')+'</ol><div class="gallery">'+a.evidence.map(artifactHtml).join('')+'</div>'+(a.uncertainties?.length?'<h4>Unknown actions</h4>'+a.uncertainties.map(u=>'<p class="gap">'+escape(u.operation)+' · '+escape(u.error)+'</p>').join(''):'')+(a.resolutions?.length?'<h4>Uncertainty resolutions</h4>'+a.resolutions.map(r=>'<p>'+escape(r.result.note)+'</p>').join('')+a.resolutionEvidence.map(artifactHtml).join(''):'')+'<details><summary>Qualifying proof</summary>'+text(a.proof||'Historical record')+'</details></details>').join(''):'';
  return '<article data-panel="'+i+'" hidden><small>'+escape(c.id)+' · '+escape(c.area)+'</small><h2>'+escape(c.title)+'</h2><div class="summary">'+badge(c.status)+'</div><p class="assertion">'+escape(c.expected)+'</p><p>'+escape(c.observation)+'</p>'+history+'<h3>How the test works</h3><p>'+escape(c.method||c.expected)+'</p><div class="ops">'+c.operations.map(op=>'<code>'+escape(op)+'</code>').join('')+'</div>'+(c.steps?.length?'<h3>Steps in this run</h3><ol class="steps">'+c.steps.map(s=>'<li><strong>'+escape(s.title)+'</strong><small>'+escape(s.phase)+' · '+escape(s.status)+(s.observation?' · '+escape(s.observation):'')+'</small></li>').join('')+'</ol>':'')+'<h3>Recorded actions</h3>'+(actions.length?'<ol class="steps">'+actions.slice(0,12).map(a=>'<li><strong>'+escape(a.title)+'</strong><small>'+escape(a.channel)+' · '+escape(a.status)+(a.count>1?' · '+a.count+' calls':'')+(a.detail?' · '+escape(a.detail):'')+'</small></li>').join('')+'</ol>'+(actions.length>12?'<details><summary>All '+actions.length+' action groups</summary><ol class="steps">'+actionList+'</ol></details>':''):'<p>No action journal was retained for this check.</p>')+(c.measurements&&Object.keys(c.measurements).length?'<h3>Measurements</h3>'+table(['Observation','Value'],Object.entries(c.measurements).map(([k,v])=>[escape(measureLabels[k]||k),escape(k.endsWith('Ms')?(v>=1000?(v/1000).toFixed(2)+' s':Math.round(v)+' ms'):v)])):'')+'<h3>Evidence</h3>'+(media.length?'<div class="gallery">'+media.slice(0,6).map(artifactHtml).join('')+'</div>'+(media.length>6?'<details><summary>More captures · '+(media.length-6)+'</summary><div class="gallery">'+media.slice(6).map(artifactHtml).join('')+'</div></details>':''):'')+(json.length?'<details><summary>Observations and requests · '+json.length+'</summary>'+json.map(artifactHtml).join('')+'</details>':'')+(!evidence.length?'<p>Open the operation journal under Technical details for the recorded requests and responses.</p>':'')+(c.evidenceRequirements?.length?'<details><summary>Evidence requested by this test</summary>'+table(['Capture','Purpose','Collection'],c.evidenceRequirements.map(e=>[escape(e.kind)+'<small>'+escape(e.when)+'</small>',escape(e.caption),escape(e.status)+(e.required?'<small>Required</small>':'')]))+'</details>':'')+(c.editPrompt?'<details class="edit"><summary>Edit this test</summary><p>Describe your change in the prompt, then give it to your agent.</p><textarea readonly aria-label="Agent edit prompt">'+escape(c.editPrompt)+'</textarea><button data-copy type="button">Copy edit prompt</button></details>':'')+'<details><summary>Test identity</summary><small>'+escape(c.methodBasis||'Recorded course')+'</small>'+text(c.definitionHash||'See course record')+'</details></article>';
 };
 const checks='<div class="table"><table id="checks"><thead><tr><th>Check</th><th>Area</th><th>Tested build</th><th>Result</th><th>Observation</th></tr></thead><tbody>'+rows.map((c,i)=>'<tr data-check-id="'+escape(c.id)+'" data-order="'+i+'" data-title="'+escape(c.title)+'" data-result="'+escape(c.status)+'" data-area="'+escape(c.area||'Uncategorized')+'" data-target="'+escape(c.target||'packaged')+'"><td><button class="test-name" data-open="'+i+'">'+escape(c.title)+'</button><small>'+escape(c.id)+'</small></td><td>'+escape(c.area||'Uncategorized')+'</td><td>'+escape(targetLabel(c.target||'packaged'))+'</td><td>'+badge(c.status)+(c.historyLabel?'<small class="'+(c.earlierFailures?'gap':'')+'">'+escape(c.historyLabel)+'</small>':'')+'</td><td><p>'+escape(c.observation)+'</p><button class="show-detail" data-open="'+i+'">View test details</button></td></tr>').join('')+'</tbody></table></div>';
 const drawer='<dialog id="test-detail" aria-labelledby="detail-heading"><div class="drawer-top"><span id="detail-heading">Test details</span><span id="detail-position"></span><div><button id="detail-prev" aria-label="Previous check">←</button><button id="detail-next" aria-label="Next check">→</button><button id="detail-close" aria-label="Close test details">×</button></div></div>'+rows.map(detail).join('')+'</dialog>';

 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(r.title)} · Athanor report</title><style>${wizardTokens}
 :root{color-scheme:dark}body{color:#d4d4d4;background:#1a1a1a;font:13px/1.5 var(--font-ui);margin:0}main{max-width:1100px;margin:auto;padding:20px}h1{font-size:18px;line-height:1.4;margin:18px 0 8px}h2{font-size:15px;margin:22px 0 10px}p,small{color:#aaa}a{color:var(--link)}header{display:flex;justify-content:space-between;gap:20px;font-size:12px;color:#888}.summary{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:20px 0}.badge{display:inline-block;padding:3px 8px;border-radius:3px;background:#303030;color:#ccc;white-space:nowrap;font-size:12px}.pass{background:#233b29;color:#8bce94}.fail{background:#442727;color:#ff8585}details{padding:14px 0;border-top:1px solid #383838;margin:12px 0}summary{cursor:pointer;color:#aaa}.table{overflow:auto;border:1px solid var(--border);border-radius:3px}table{border-collapse:collapse;width:100%;text-align:left}th{background:var(--header);color:var(--secondary);font-size:12px;font-weight:400}th,td{padding:10px 12px;border-bottom:1px solid var(--surface);vertical-align:top}td{min-width:70px}td:first-child{width:33%}td p{margin:0}td details{font-size:12px;margin-bottom:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}small{display:block}a:focus-visible,summary:focus-visible{outline:2px solid var(--selection);outline-offset:4px}.gap{color:#e0b050}.controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:12px 0}.controls label{display:grid;gap:5px;font-size:12px;color:#aaa}.controls label:first-child{flex:1;min-width:180px}input,select,button{font:inherit;color:inherit;background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:7px 9px}button{cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--selection);outline-offset:2px}[hidden]{display:none!important}#visible-count{color:#aaa;font-size:12px;margin:8px 0}#empty{padding:18px;color:#aaa;border:1px solid var(--border)}@media(max-width:600px){main{padding:20px 16px}h1{font-size:18px}td,th{padding:10px 8px;font-size:12px}}@media print{.controls{display:none}body{background:white;color:#111}p,small,a,summary,th{color:#333}.table{overflow:visible}}
 body.detail-only main{display:none}body.detail-only dialog{width:100vw;box-shadow:none;border:0;animation:none}
 .test-name{background:none;border:0;padding:0;text-align:left;font-weight:600;color:#d4d4d4}.show-detail{font-size:12px;margin-top:8px;background:none;color:var(--link);padding:4px 0;border:0}dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(720px,100vw);height:100dvh;max-height:100dvh;max-width:100vw;background:#202020;color:#d4d4d4;border:0;border-left:1px solid #444;padding:0;overflow:auto}dialog::backdrop{background:#0006}.drawer-top{position:sticky;top:0;background:#202020;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #444;padding:12px 20px;z-index:2}.drawer-top div{display:flex;gap:6px}article{padding:24px 28px 40px}article h2{font-size:22px;line-height:1.3;margin:10px 0}article h3{font-size:14px;margin:26px 0 12px}article p{max-width:75ch}.assertion{border-left:2px solid var(--link);padding-left:14px}.ops{display:flex;flex-wrap:wrap;gap:6px}.ops code{background:#303030;padding:3px 6px;font-size:11px}.steps{padding-left:22px}.steps li{padding:6px 0}.steps strong{font-weight:500}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0 0 14px}figure img,figure video{width:100%;background:#151515;border:1px solid #444;border-radius:3px}figure video,figure audio{max-width:100%}figure:has(video),figure:has(audio){grid-column:1/-1}figcaption{color:#aaa;font-size:12px;margin-top:6px}textarea{width:100%;box-sizing:border-box;min-height:220px;resize:vertical;background:#181818;color:#ccc;border:1px solid #444;padding:12px;font:12px/1.6 var(--font-ui);margin-bottom:10px}@media(max-width:600px){article{padding:20px}.gallery{grid-template-columns:1fr}.drawer-top{font-size:11px;padding:10px}}
 ${smokeTheme}</style><main>${progressEffects}<header class="report-banner"><span class="smoke-brand smoke-wordmark">Athanor report</span><div class="header-actions"><a class="text-button" href="report.json">Download data</a></div><img class="wizard-signature" src="${wizardLogoURI}" alt="Wizard" width="64" height="14"></header><h1>${escape(r.title)}</h1><p>${escape(r.identities.version)} · ${escape(r.operator)} · ${escape(r.asOf)}</p><div class="summary">${badge(r.execution.state)}${Object.entries(r.counts).map(([k,v])=>'<span>'+v+' '+escape(k.toLowerCase())+'</span>').join('')}</div>${r.attemptCounts?'<p>All attempts: '+Object.entries(r.attemptCounts).map(([k,v])=>v+' '+escape(k.toLowerCase())).join(' · ')+'</p>':''}
 ${r.timing?'<div class="run-timing"><div><span>'+(r.timing.totalMs!==null?'Total time':'Elapsed at export')+'</span><strong>'+formatDuration(r.timing.totalMs??r.timing.elapsedMs)+'</strong></div></div>':''}${progressBar(rows,r.execution.state)}
 ${r.checkpoint?'<section><h2>Human check '+badge(r.checkpoint.state)+'</h2>'+table(['Tester','Finding','Observation'],r.checkpoint.observations.map(o=>[escape(o.operator),badge(o.outcome),escape(o.note)]))+(r.checkpoint.verification?'<p>Save and reopen '+badge(r.checkpoint.verification.status)+'</p>':'')+'</section>':''}
 <section><h2>Tested builds</h2>${table(['Execution','Build','Results'],(r.targets||[]).map(t=>[escape(targetLabel(t.target)),escape(t.build)+'<small>'+escape(t.hash?.slice(0,12)||'Identity unavailable')+'</small>',escape(Object.entries(t.counts).map(([k,v])=>v+' '+k).join(' · '))]))}${r.computerUse?'<p>Computer-use pilot · '+badge(r.computerUse.state)+' · '+escape(Object.entries(counts(r.computerUse.cases)).map(([k,v])=>v+' '+k).join(' · '))+'<small>Recorded '+escape(r.computerUse.updatedAt||r.computerUse.createdAt)+'</small></p>':''}</section><section><h2>Checks</h2><div class="controls"><label>Search checks<input id="search" type="search" placeholder="Name, ID, observation or Ops"></label><label>Result<select multiple id="result"><option value="">All results</option>${options(rows.map(c=>c.status))}</select></label><label>Area<select multiple id="area"><option value="">All areas</option>${options(rows.map(c=>c.area||'Uncategorized'))}</select></label><label>Tested build<select multiple id="target"><option value="">All builds</option>${[...new Set(rows.map(c=>c.target||'packaged'))].map(t=>'<option value="'+escape(t)+'">'+escape(targetLabel(t))+'</option>').join('')}</select></label><label>Sort<select id="sort"><option value="course">Course order</option><option value="name">Check name</option><option value="result">Result · needs attention first</option></select></label><button id="reset" type="button">Reset</button></div><p id="visible-count" role="status" aria-live="polite">${rows.length} checks</p>${checks}<p id="empty" hidden>No checks match these filters.</p></section>
 ${r.acceptance.gaps.length?'<details class="gap"><summary>Evidence needs attention · '+r.acceptance.gaps.length+'</summary><ul>'+r.acceptance.gaps.map(g=>'<li>'+escape(g)+'</li>').join('')+'</ul></details>':''}
 <details><summary>Technical details</summary><p>Run ${escape(r.runId)} · ${escape(r.execution.target)}</p><h2>Build and course</h2>${text(r.identities)}${r.selection?'<h2>Selection</h2>'+text(r.selection):''}${r.computerUse?'<h2>Computer-use runtime</h2>'+text({sourcePackageHash:r.computerUse.sourcePackageHash||r.computerUse.packageHash,packageHash:r.computerUse.packageHash,runtimeOverride:r.computerUse.runtimeOverride||null}):''}<h2>Environment</h2>${text(r.execution.context)}${r.sessionUncertainty?'<h2>Unresolved session action</h2>'+text(r.sessionUncertainty):''}<h2>Fixtures</h2>${text(r.fixtures)}${r.checkpoint?'<h2>Checkpoint</h2>'+text({state:r.checkpoint.state,observations:r.checkpoint.observations,verification:r.checkpoint.verification}):''}<h2>Evidence files</h2>${table(['File','Bytes','SHA-256'],r.artifacts.map(a=>['<a href="evidence/'+encodeURIComponent(a.file)+'">'+escape(a.source)+'</a>',String(a.bytes),text(a.sha256)]))}</details>
 <details><summary>Checklist coverage</summary>${table(['User path','Coverage','Checks in this run'],r.scope.sourceRows.map(s=>[escape(s.criteria||s.id),escape(s.disposition),s.results.map(x=>escape(x.id)+': '+escape(x.status)).join('<br>')||'—']))}</details></main>${drawer}<script>${filterScript}${reportControls}${detailControls}</script></html>`;
}
export async function exportLocalReport(run,dataDir){
 dataDir=dataDirectory(dataDir);
 const {report,buffers}=await localReport(run,dataDir),html=renderReport(report),name='smoke-report-'+run.id+'-'+digest({report,html}).slice(0,12),parent=path.join(dataDir,'exports');
 await mkdir(parent,{recursive:true});const directory=path.join(parent,name),temporary=await mkdtemp(path.join(parent,'.report-'));
 try{
  await mkdir(path.join(temporary,'evidence'));
  for(const [file,bytes]of Object.entries(buffers))await writeFile(path.join(temporary,'evidence',file),bytes);
  await writeFile(path.join(temporary,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(path.join(temporary,'index.html'),html);
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
