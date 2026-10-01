import {openBuildFinder} from './build-finder.js';
import {progressBar} from './run-display.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let saved={};try{saved=JSON.parse(localStorage.getItem('wizard-smoke-launcher')||'{}');}catch{}
let draft={app:saved.app||'',courseId:saved.courseId||'automated-full',name:'',operator:saved.operator||'Local tester',prepared:saved.prepared||null,preparation:saved.preparation||null,request:saved.request||null};
let data={builds:[],courses:[],runtimes:[]},busy='',error='',requestMissing=false;
let api,render,toast,onStarted;
const remember=()=>localStorage.setItem('wizard-smoke-launcher',JSON.stringify({...draft,name:''}));
const buildReady=()=>Boolean(draft.app.trim())&&data.builds.find(b=>b.app===draft.app)?.available!==false;
const selected=()=>data.courses.find(c=>c.id===draft.courseId);
const needsRuntime=()=>selected()?.requirements?.targets.some(t=>t!=='packaged');
const ready=()=>draft.prepared?.app===draft.app&&draft.prepared?.courseId===draft.courseId;
const invalidate=()=>{draft.prepared=null;draft.preparation=null;};
const hint=(id,label,text)=>`<span class="field-hint"><button type="button" class="hint-trigger" aria-label="${esc(label)}" aria-describedby="${id}">?</button><span class="hint-text" role="tooltip" id="${id}">${esc(text)}</span></span>`;
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.field-hint').forEach(h=>h.dataset.dismissed='true');});
document.addEventListener('focusin',e=>e.target.closest('.field-hint')?.removeAttribute('data-dismissed'));
document.addEventListener('pointerover',e=>{const h=e.target.closest('.field-hint');if(h&&!h.contains(e.relatedTarget))h.removeAttribute('data-dismissed');});
const choice=(id,label,current,disabled=false)=>`<option value="${esc(id)}" ${id===current?'selected':''} ${disabled?'disabled':''}>${esc(label)}</option>`;
const errorHelp=message=>/ENOENT.*(realpath|stat).*\.app['"]?$/i.test(message)?'That Wizard build could not be found. Choose an installed build or paste the path to a downloaded Wizard.app.':/ENOENT.*(mlmodelc|parakeet)|speech model.*missing/i.test(message)?'The offline speech model required by this course is missing. Ask your team for the pinned model, then try again.':/different command schema|mapped.*schema|schema differs/i.test(message)?'This build uses an unsupported command interface. Choose a qualified build, or ask the team to update the test mapping.':/lacks WIZ_/i.test(message)?'The installed desktop test tools are incompatible. Ask your test setup owner to update them.':message;
export function configureRunSetup(deps){({api,render,toast,onStarted}=deps);}
export async function refreshRunSetup(){
 data=await api('/run-setup');
 if(!draft.app)draft.app=data.builds.find(b=>b.available)?.app||'';
 if(!data.courses.some(c=>c.id===draft.courseId&&!c.error))draft.courseId='automated-full';
 if(draft.preparation?.state==='Preparing'&&!busy){busy='Preparing your selected build…';void watchPreparation(draft.preparation.id);}
 remember();
}
export function runSetupView(active){
 const c=selected(),known=data.builds.some(b=>b.app===draft.app),locked=Boolean(busy||active||draft.request),isReady=ready();
 return `<section class="launch-workspace"><div class="launch-heading"><h2>New run</h2><p>Choose a build and course.</p></div>
 <form id="suite-setup-form"><fieldset ${locked?'disabled':''}><div class="launch-step"><div><div class="field"><div class="field-label"><label for="suite-build">Build</label>${known?hint('build-help','Build path',draft.app):''}<button type="button" class="text-button" data-setup="find-build">Find a build…</button></div><select id="suite-build" required>${data.builds.map(b=>choice(b.app,b.label,known?draft.app:'custom',!b.available)).join('')}${choice('custom','Choose another build…',known?draft.app:'custom')}</select>${known&&!buildReady()?`<p class="field-help">${esc(data.builds.find(b=>b.app===draft.app)?.error||'Reimport this build through Find a build before starting.')}</p>`:''}</div>${!known?`<label class="field">Path to Wizard.app<input id="suite-app" placeholder="/path/to/Wizard.app" value="${esc(draft.app)}" required><span class="field-help">Paste the path to the build you downloaded.</span></label>`:''}</div></div>
 <div class="launch-step"><div><div class="field"><div class="field-label"><label for="suite-course">Course</label>${hint('course-help','About course execution',needsRuntime()?'All checks use your selected build. Prepare sets up and verifies its desktop instrumentation automatically.':'Tests the engine inside your selected build and runs in the background.')}</div><select id="suite-course">${data.courses.map(c=>choice(c.id,(c.id==='packaged-full'?'Build engine checks':c.title)+(c.error?' · unavailable':` · ${c.checkCount} checks`),draft.courseId,Boolean(c.error))).join('')}</select></div>
 ${c?.targets?`<div class="course-coverage" aria-label="Course coverage">${[['packaged','Engine'],['desktop','Desktop'],['service','Services']].filter(([k])=>c.targets[k]).map(([k,label])=>`<span><strong>${c.targets[k]}</strong>${label}</span>`).join('')}</div>`:''}
 </div></div>
 <div class="launch-step"><div><div class="field"><div class="field-label"><label for="suite-name">Run name (optional)</label>${hint('run-name-help','About run names','Leave blank to use the course name and date.')}</div><input id="suite-name" value="${esc(draft.name)}" placeholder="e.g. Friday release" maxlength="200"></div></div></div>
 ${needsRuntime()?'<p class="field-help">Prepare automatically sets up the matching adapter and verifies attachment to this build.</p>':''}
 <details class="launch-options"><summary>More options</summary><div class="option-content"><label class="field">Recorded by<input id="suite-operator" value="${esc(draft.operator)}" maxlength="120"></label></div></details>
 </fieldset>
 ${draft.preparation?`<section class="preparation-progress" aria-label="Build preparation"><h3>${draft.preparation.state==='Ready'?'Build ready':draft.preparation.state==='Preparing'?'Preparing build':'Preparation stopped'}</h3>${progressBar(draft.preparation.steps||[],draft.preparation.state==='Preparing'?'Running':draft.preparation.state).replace('Check progress','Preparation progress')}<ol>${(draft.preparation.steps||[]).map(step=>`<li><span>${esc(step.title)}</span> <small>${esc(step.status)}</small></li>`).join('')}</ol>${draft.preparation.repairPrompt?`<details open><summary>Repair with your agent</summary><textarea readonly aria-label="Preparation repair prompt">${esc(draft.preparation.repairPrompt)}</textarea><button class="button" type="button" data-setup="copy-repair">Copy repair prompt</button></details>`:''}</section>`:''}
 ${error?`<div class="launch-error" role="alert"><strong>${draft.request?'Run status unavailable':'Tests haven’t started'}</strong><p>${esc(errorHelp(error))}</p>${errorHelp(error)!==error?`<details><summary>Technical details</summary><p>${esc(error)}</p></details>`:''}</div>`:''}
 ${draft.request&&!busy?`<div class="launch-error" role="status"><strong>Start outcome needs checking</strong><p>The response was lost. Check the existing request before starting another run.</p><button type="button" class="button" data-setup="recover">Check start status</button>${requestMissing?'<button type="button" class="button primary" data-setup="retry">Retry original start</button>':''}</div>`:''}
 <div class="launch-footer">${active?`<p>A run is already ${esc(active.state.toLowerCase())}.</p><button type="button" class="button primary" data-setup="active">View active run</button>`:`${busy?`<p role="status">${esc(busy)}</p>`:''}<button class="button primary launch-start" type="submit" ${locked||!buildReady()?'disabled':''}>${busy?'Please wait…':isReady?'Start '+(c?.checkCount||'')+' checks':'Prepare build'}</button>`}</div>
 </form></section>`;
}
async function openRun(id){await onStarted(id);draft.request=null;requestMissing=false;remember();}
document.addEventListener('input',e=>{
 const key=({'suite-app':'app','suite-name':'name','suite-operator':'operator'})[e.target.id];
 if(key){draft[key]=e.target.value;if(key==='app')invalidate();error='';remember();if(key==='app')render();}
});
document.addEventListener('change',async e=>{
 if(e.target.id==='suite-build')draft.app=e.target.value==='custom'?'':e.target.value;
 else if(e.target.id==='suite-course')draft.courseId=e.target.value;
 else if(e.target.id==='suite-name')draft.name=e.target.value;
 else return;invalidate();error='';remember();render();
});
async function watchPreparation(id){
 try{
  while(true){const job=await api('/preparations/'+id);draft.preparation=job;remember();render();if(job.state!=='Preparing'){
    if(job.state==='Ready'){draft.prepared={app:draft.app,courseId:draft.courseId,planHash:job.planHash};toast('Build ready. You can start your course.');}
    else error=job.error||'Preparation stopped. Inspect the retained attempt.';
    break;
   }await new Promise(resolve=>setTimeout(resolve,700));}
 }catch(e){error=e.message;}finally{busy='';remember();render();}
}
document.addEventListener('submit',async e=>{
 if(e.target.id!=='suite-setup-form')return;e.preventDefault();if(busy||draft.request||!buildReady())return;
 if(!draft.operator.trim()){error='Enter who is recording this run in More options.';render();return;}
 error='';
 if(!ready()){
  busy='Preparing your selected build…';draft.prepared=null;render();
  try{draft.preparation=await api('/preparations','POST',{app:draft.app.trim(),selection:{courseIds:[draft.courseId],...(draft.name.trim()?{title:draft.name.trim()}:{})}});remember();await watchPreparation(draft.preparation.id);}
  catch(e){error=e.message;busy='';render();}return;
 }
 let admitted=false;busy='Starting tests…';draft.request={requestId:crypto.randomUUID(),planHash:draft.prepared.planHash,operator:draft.operator.trim()};remember();render();
 try{const r=await api('/runner/start','POST',draft.request);admitted=true;await openRun(r.runId);toast('Tests started.');}
 catch(e){error=e.message;if(!admitted&&draft.request&&e.status>=400&&e.status<500){draft.request=null;draft.prepared=null;requestMissing=false;remember();}}finally{busy='';render();}
});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-setup]');if(!b||busy)return;
 try{
  if(b.dataset.setup==='copy-repair'){await navigator.clipboard.writeText(draft.preparation.repairPrompt);toast('Repair prompt copied.');return;}
  if(b.dataset.setup==='find-build')return await openBuildFinder({api,local:data.builds,onSelected:async build=>{draft.app=build.app;invalidate();await refreshRunSetup();if(!data.builds.some(b=>b.app===build.app))data.builds.push(build);remember();render();toast('Build selected.');}});
  if(b.dataset.setup==='active'){const r=await api('/runner');if(r.active)await onStarted(r.active.run_id);}
  if(b.dataset.setup==='recover'&&draft.request){busy='Checking start status…';requestMissing=false;render();try{const r=await api('/requests/'+draft.request.requestId);await openRun(r.id);error='';}catch(e){if(e.status!==404)throw e;requestMissing=true;error='This request has not been admitted. Retry the original start to reconcile it safely.';}}
  if(b.dataset.setup==='retry'&&draft.request&&requestMissing){busy='Retrying the original start…';requestMissing=false;error='';render();const r=await api('/runner/start','POST',draft.request);await openRun(r.runId);toast('Tests started.');}
 }catch(e){error=e.message;}finally{busy='';render();}
});
