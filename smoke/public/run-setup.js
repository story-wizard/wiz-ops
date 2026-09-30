const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths=['app','cli','qtPlugin','libraries','bridge'];
let saved={};try{saved=JSON.parse(localStorage.getItem('wizard-smoke-launcher')||'{}');}catch{}
let draft={app:saved.app||'',courseId:saved.courseId||'automated-full',runtimeId:saved.runtimeOverride||'default',name:'',operator:saved.operator||'Local tester',customRuntime:saved.customRuntime||{},request:saved.request||null};
let data={builds:[],courses:[],runtimes:[]},busy='',error='';
let api,render,toast,onStarted;
const remember=()=>localStorage.setItem('wizard-smoke-launcher',JSON.stringify({...draft,name:'',runtimeOverride:draft.runtimeId}));
const selected=()=>data.courses.find(c=>c.id===draft.courseId);
const needsRuntime=()=>selected()?.requirements?.targets.some(t=>t!=='packaged');
const runtimeChoice=()=>data.runtimes.find(r=>r.id===(draft.runtimeId==='default'?data.defaultRuntimeId:draft.runtimeId));
const descriptor=()=>{const r=runtimeChoice()?.runtime||(draft.runtimeId==='custom'?draft.customRuntime:{});return Object.fromEntries(paths.filter(k=>r[k]).map(k=>[k,r[k]]));};
const helperReady=()=>!needsRuntime()||runtimeChoice()?.available!==false&&['app','cli','qtPlugin'].every(k=>descriptor()[k]);
const choice=(id,label,current,disabled=false)=>`<option value="${esc(id)}" ${id===current?'selected':''} ${disabled?'disabled':''}>${esc(label)}</option>`;
const errorHelp=message=>/ENOENT.*(mlmodelc|parakeet)|speech model.*missing/i.test(message)?'The offline speech model required by this course is missing. Ask your team for the pinned model, then try again.':/different command schema|mapped.*schema|schema differs/i.test(message)?'This build uses an unsupported command interface. Choose a qualified build, or ask the team to update the test mapping.':/lacks WIZ_/i.test(message)?'The installed desktop test tools are incompatible. Ask your test setup owner to update them.':message;
export function configureRunSetup(deps){({api,render,toast,onStarted}=deps);}
export async function refreshRunSetup(){
 data=await api('/run-setup');
 if(!draft.app)draft.app=data.builds.find(b=>b.available)?.app||'';
 if(!data.courses.some(c=>c.id===draft.courseId&&!c.error))draft.courseId='automated-full';
 if(!['default','custom'].includes(draft.runtimeId)&&!data.runtimes.some(r=>r.id===draft.runtimeId&&r.available!==false))draft.runtimeId='default';
 remember();
}
export function runSetupView(active){
 const c=selected(),known=data.builds.some(b=>b.app===draft.app),locked=Boolean(busy||active||draft.request),helper=helperReady();
 return `<section class="launch-workspace"><div class="launch-heading"><h2>Test a Wizard build</h2><p>Choose a build and a course. We’ll prepare the test projects and save the results.</p></div>
 <form id="suite-setup-form"><fieldset ${locked?'disabled':''}><div class="launch-step"><span class="step-number" aria-hidden="true">1</span><div><label class="field">Build to test<select id="suite-build" required>${data.builds.map(b=>choice(b.app,b.label,known?draft.app:'custom',!b.available)).join('')}${choice('custom','Choose another build…',known?draft.app:'custom')}</select></label>${!known?`<label class="field">Path to Wizard.app<input id="suite-app" placeholder="/path/to/Wizard.app" value="${esc(draft.app)}" required><span class="field-help">Paste the path to the build you downloaded.</span></label>`:`<p class="build-location">${esc(draft.app)}</p>`}</div></div>
 <div class="launch-step"><span class="step-number" aria-hidden="true">2</span><div><label class="field">Test course<select id="suite-course">${data.courses.map(c=>choice(c.id,(c.id==='packaged-full'?'Build engine checks':c.title)+(c.error?' · unavailable':` · ${c.checkCount} checks`),draft.courseId,Boolean(c.error))).join('')}</select></label>
 ${c?.targets?`<div class="course-coverage" aria-label="Course coverage">${[['packaged','Build engine'],['desktop','Desktop editor'],['service','Background services']].filter(([k])=>c.targets[k]).map(([k,label])=>`<span><strong>${c.targets[k]}</strong>${label}</span>`).join('')}</div>`:''}
 <p class="field-help">${needsRuntime()?'Engine checks use your selected build. Desktop and service checks use separate test tools, selected automatically.':'Tests the engine inside your selected build and runs in the background.'}</p></div></div>
 <div class="launch-step"><span class="step-number" aria-hidden="true">3</span><div><label class="field"><span>Run name <span class="optional">Optional</span></span><input id="suite-name" value="${esc(draft.name)}" placeholder="e.g. Friday release" maxlength="200"></label><p class="field-help">Leave blank to use the course name and date.</p></div></div>
 ${needsRuntime()&&!helper?`<div class="helper-status needs-setup"><strong>Desktop test tools aren’t installed on this Mac</strong><p>${esc(data.runtimeSetupError||'Ask your test setup owner to install them. You can choose Build engine checks to run 57 checks while setup is pending.')}</p></div>`:''}
 <details class="launch-options"><summary>More options</summary><div class="option-content"><label class="field">Recorded by<input id="suite-operator" value="${esc(draft.operator)}" maxlength="120"></label>${needsRuntime()?`<details class="manual-helper"><summary>Test tools (advanced)</summary><p class="field-help">Normally selected automatically. Change this only when configuring the testing station.</p><label class="field">Test tools<select id="suite-runtime">${choice('default','Automatic — installed test tools',draft.runtimeId)}${data.runtimes.map(r=>choice(r.id,r.label||'Configured test tools',draft.runtimeId,r.available===false)).join('')}${choice('custom','Enter custom paths…',draft.runtimeId)}</select></label><label class="field">Import test-tools configuration<input type="file" id="suite-helper-file" accept=".json,application/json"></label>${draft.runtimeId==='custom'?`<div class="setup-fields">${paths.map(k=>`<label class="field">${({app:'Test app',cli:'Paired command-line tool',qtPlugin:'Qt plugin',libraries:'Runtime libraries (optional)',bridge:'Native bridge (optional)'})[k]}<input data-runtime-path="${k}" id="suite-runtime-${k}" value="${esc(draft.customRuntime[k]||'')}"></label>`).join('')}</div>`:''}</details>`:''}</div></details>
 </fieldset>
 ${error?`<div class="launch-error" role="alert"><strong>${draft.request?'Run status unavailable':'Tests haven’t started'}</strong><p>${esc(errorHelp(error))}</p>${errorHelp(error)!==error?`<details><summary>Technical details</summary><p>${esc(error)}</p></details>`:''}</div>`:''}
 ${draft.request?`<div class="launch-error" role="status"><strong>Start outcome needs checking</strong><p>The response was lost. Check the existing request before starting another run.</p><button type="button" class="button" data-setup="recover">Check start status</button></div>`:''}
 <div class="launch-footer">${active?`<p>A run is already ${esc(active.state.toLowerCase())}.</p><button type="button" class="button primary" data-setup="active">View active run</button>`:`<div><p>${busy||'Build, media and required tools are checked automatically.'}</p><small>Fresh disposable projects. Results saved on this Mac.</small></div><button class="button primary launch-start" type="submit" ${locked||!helper||!draft.app?'disabled':''}>${busy?'Please wait…':'Start '+(c?.checkCount||'')+' checks'}</button>`}</div>
 </form></section>`;
}
async function openRun(id){await onStarted(id);draft.request=null;remember();}
document.addEventListener('input',e=>{
 const key=({'suite-app':'app','suite-name':'name','suite-operator':'operator'})[e.target.id];
 if(key){draft[key]=e.target.value;error='';remember();if(key==='app')render();}
 if(e.target.dataset.runtimePath){draft.customRuntime[e.target.dataset.runtimePath]=e.target.value;error='';remember();render();}
});
document.addEventListener('change',async e=>{
 if(e.target.id==='suite-helper-file'){
  const file=e.target.files?.[0];if(!file||busy)return;busy='Checking test tools…';error='';render();
  try{const input=JSON.parse(await file.text()),r=await api('/runtimes','POST',input.runtime||input);await refreshRunSetup();draft.runtimeId=r.id;remember();toast('Test tools configured.');}
  catch(e){error=e.message;}finally{busy='';render();}return;
 }
 if(e.target.id==='suite-build')draft.app=e.target.value==='custom'?'':e.target.value;
 else if(e.target.id==='suite-course')draft.courseId=e.target.value;
 else if(e.target.id==='suite-runtime')draft.runtimeId=e.target.value;
 else return;error='';remember();render();
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='suite-setup-form')return;e.preventDefault();if(busy||draft.request||!helperReady())return;
 if(!draft.app.trim())return;if(!draft.operator.trim()){error='Enter who is recording this run in More options.';render();return;}
 let admitted=false;error='';busy='Preparing your build and test projects…';render();
 try{
  const plan=await api('/plans','POST',{app:draft.app.trim(),selection:{courseIds:[draft.courseId],...(draft.name.trim()?{title:draft.name.trim()}:{})},...(needsRuntime()?{runtime:descriptor()}:{})});
  draft.app=plan.app;busy='Starting tests…';draft.request={requestId:crypto.randomUUID(),planHash:plan.planHash,operator:draft.operator.trim()};remember();render();
  const r=await api('/runner/start','POST',draft.request);admitted=true;await openRun(r.runId);toast('Tests started.');
 }catch(e){error=e.message;if(!admitted&&draft.request&&e.status>=400&&e.status<500){draft.request=null;remember();}}finally{busy='';render();}
});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-setup]');if(!b||busy)return;
 try{
  if(b.dataset.setup==='active'){const r=await api('/runner');if(r.active)await onStarted(r.active.run_id);}
  if(b.dataset.setup==='recover'){busy='Checking start status…';render();const r=await api('/requests/'+draft.request.requestId);await openRun(r.id);error='';}
 }catch(e){error=e.message;}finally{busy='';render();}
});
