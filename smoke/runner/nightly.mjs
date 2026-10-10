import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {digest,sha,inside,externalPath} from './files.mjs';

const statuses=['PASS','FAIL','PARTIAL','BLOCKED','NOT_RUN','UNKNOWN'];
const text=value=>typeof value==='string'&&value.trim()&&value.length<=8192;
export function nightlyCases(suite){
 if(!Array.isArray(suite?.cases)||!suite.cases.length||suite.cases.length>500)throw Error('Nightly suite needs 1–500 cases.');
 const ids=new Set();return suite.cases.map(c=>{
  if(!text(c.id)||!c.id.match(/^[A-Za-z0-9_-]+$/)||ids.has(c.id)||!Array.isArray(c.steps)||!c.steps.length||!c.steps.every(text)||!Array.isArray(c.expected)||!c.expected.length||!c.expected.every(text)||c.expected.length>100)throw Error('Invalid or duplicate Nightly case: '+c.id);
  ids.add(c.id);return {id:c.id,area:c.area||'Unassigned',steps:c.steps,expected:c.expected,...(c.fixture?{fixture:c.fixture}:{})};
 });
}
export function releaseTestProposals(input,catalog,identity){
 if(!input)return [];
 if(input.format!=='athanor-release-test-proposals/v1'||input.build!==identity.build||input.packageHash!==identity.packageHash||!Array.isArray(input.proposals)||input.proposals.length>200)throw Error('Release-test proposals must identify this exact build/package.');
 const ids=new Set(),caseIds=new Set(),byId=new Map(catalog.map(c=>[c.id,c]));
 return input.proposals.map(p=>{
  if(!p||Object.keys(p).some(k=>!['id','source','case','checkIds','reason','prerequisites'].includes(k))||!text(p.id)||!/^[A-Za-z0-9_-]+$/.test(p.id)||ids.has(p.id)||!text(p.reason)||!Array.isArray(p.prerequisites)||!p.prerequisites.every(text)||!Array.isArray(p.checkIds)||new Set(p.checkIds).size!==p.checkIds.length||!p.checkIds.every(text))throw Error('Invalid release-test proposal.');
  const s=p.source;let url;try{url=new URL(s?.url);}catch{throw Error('Release-test proposal needs a source URL.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!['whats-new','developer-changelog','pull-request'].includes(s.kind)||!text(s.summary)||!['exact','summary'].includes(s.retention)||s.contentHash!==digest(s.summary)||Object.keys(s).some(k=>!['url','kind','summary','retention','contentHash'].includes(k)))throw Error('Invalid release-test source provenance.');
  const definition=nightlyCases({cases:[p.case]})[0];if(caseIds.has(definition.id))throw Error('Duplicate proposed functional case.');ids.add(p.id);caseIds.add(definition.id);
  return {...p,case:definition,specHash:digest(definition),status:'Proposed',candidates:p.checkIds.map(id=>{const c=byId.get(id);return {id,available:!!c&&c.executable!==false,definitionHash:c?.definitionHash||null,accepted:c?.accepted===true};})};
 });
}

export function createNightlyPlan(suite,catalog,identity,mappings={},{cadence='nightly',proposals,executionSelection}={}){
 if(!text(identity?.build)||!['packageHash','runnerHash'].every(k=>/^[a-f0-9]{64}$/.test(identity[k]))||typeof identity.dataDir!=='string'||!path.isAbsolute(identity.dataDir))throw Error('Freeze build, package hash and runner hash before planning.');
 if(!['nightly','weekly'].includes(cadence))throw Error('Choose nightly or weekly planning.');
 const cases=nightlyCases(suite),byId=new Map(catalog.map(c=>[c.id,c]));
 if(byId.size!==catalog.length)throw Error('Duplicate catalog definitions in the nightly plan.');
 const proposed=releaseTestProposals(proposals,catalog,identity);
 if(proposed.some(p=>cases.some(c=>c.id===p.case.id)))throw Error('A proposal must not replace a maintained functional case.');
 const content={format:'athanor-nightly-plan/v1',cadence,identity,suiteHash:digest(cases),catalogHash:digest(catalog),cases:cases.map(c=>{
  const mapping=mappings[c.id],specHash=digest(c),current=mapping?.specHash===specHash;
  const routes=current?mapping.assertions:undefined;
  if(routes!==undefined){
   if(!Array.isArray(routes)||routes.length!==c.expected.length)throw Error('Invalid assertion mapping: '+c.id);
   const remainingIds=new Set(c.expected.map((_e,i)=>c.id+':'+(i+1)));
   for(const a of routes){
    if(!a||Object.keys(a).some(k=>!['id','checks','remaining'].includes(k))||!remainingIds.delete(a.id)||!Array.isArray(a.remaining)||!a.remaining.length||!a.remaining.every(text)||!Array.isArray(a.checks))throw Error('Invalid assertion mapping: '+c.id);
    const ids=new Set();for(const d of a.checks){
     if(!d||Object.keys(d).some(k=>!['id','definitionHash'].includes(k))||!text(d.id)||ids.has(d.id)||!/^[a-f0-9]{64}$/.test(d.definitionHash))throw Error('Invalid assertion mapping: '+c.id);
     ids.add(d.id);
    }
   }
  }
  const candidate=(id,pinned)=>{const d=byId.get(id),needsReview=!!pinned&&d?.definitionHash!==pinned;return {id,available:!!d&&d.executable!==false&&!needsReview,definitionHash:d?.definitionHash||null,accepted:d?.accepted===true,...(pinned?{mappedDefinitionHash:pinned,needsReview}:{})};};
  const assertions=c.expected.map((expected,i)=>{
   const id=c.id+':'+(i+1),route=routes?.find(a=>a.id===id),checks=route?.checks.map(d=>({...candidate(d.id,d.definitionHash),expected:byId.get(d.id)?.expected||null}))||[];
   return {id,expected,status:'NOT_RUN',support:{coverage:!routes&&mapping||checks.some(d=>d.needsReview)?'review-required':checks.length?'related':'gap',checks,remaining:route?.remaining||[current?'Review the case-level selection hints and independently execute this assertion.':'No current assertion mapping; review and execute the original specification.']}};
  });
  return {...c,specHash,candidates:routes?[...new Map(assertions.flatMap(a=>a.support.checks).map(d=>[d.id,d])).values()]:current?(mapping.checkIds||[]).map(id=>candidate(id)):[],mappingNeedsReview:!!mapping&&!current||assertions.some(a=>a.support.coverage==='review-required'),assertions};
 }),catalogInventory:catalog.map(c=>({id:c.id,title:c.title||c.id,definitionHash:c.definitionHash,sourceId:c.sourceId||null,target:c.target||null,accepted:c.accepted===true,executable:c.executable!==false,status:'NOT_RUN',functionalCandidates:cases.filter(f=>mappings[f.id]?.specHash===digest(f)&&mappings[f.id]?.checkIds?.includes(c.id)).map(f=>f.id)})),releaseTestProposals:proposed,mappingPolicy:'Candidates guide selection only. Record each legacy assertion independently; catalog Pass does not establish equivalence. Release-test proposals do not change maintained cases, acceptance or execution.'};
 if(executionSelection){
  if(executionSelection.format!=='wizard-smoke-selection/v2'||!Array.isArray(executionSelection.effectiveIds)||!executionSelection.effectiveIds.length||new Set(executionSelection.effectiveIds).size!==executionSelection.effectiveIds.length||executionSelection.effectiveIds.some(id=>!byId.has(id)||byId.get(id).executable===false||!byId.get(id).accepted&&!executionSelection.qualificationIds?.includes(id)))throw Error('Nightly execution selection is unavailable or unqualified.');
  content.execution={state:'PLANNING_ONLY',selection:executionSelection,definitions:executionSelection.effectiveIds.map(id=>({id,definitionHash:byId.get(id).definitionHash})),relatedCheckIds:[...new Set(content.cases.flatMap(c=>c.candidates.filter(d=>d.available&&executionSelection.effectiveIds.includes(d.id)).map(d=>d.id)))]};
 }
 return {...content,planHash:digest(content)};
}
export async function consolidateNightly(plan,run,observations={}){
 const {planHash,...content}=plan;
 if(plan.format!=='athanor-nightly-plan/v1'||digest(content)!==planHash)throw Error('Nightly plan changed.');
 if(!run?.execution||!['Passed','Failed','Blocked','Cancelled','Unknown'].includes(run.execution.state))throw Error('Use a terminal automated run.');
 const p=run.execution.package;
 if(p.packageHash!==plan.identity.packageHash||p.runnerHash!==plan.identity.runnerHash||p.version!==plan.identity.build)throw Error('Run build/source identity differs from the Nightly plan.');
 if(observations.planHash!==undefined&&observations.planHash!==planHash||observations.runId!==undefined&&observations.runId!==run.id)throw Error('Assertion observations belong to another plan or run.');
 const supplied=observations.assertions||[];
 if(!Array.isArray(supplied)||supplied.length>5000)throw Error('Invalid assertion observations.');
 if(supplied.length&&(observations.planHash!==planHash||observations.runId!==run.id))throw Error('Bind assertion observations to the exact plan and run.');
 const evidenceRoot=await realpath(externalPath(plan.identity.dataDir));
 let evidenceBytes=0,evidenceFiles=0;
 const known=new Map(plan.cases.flatMap(c=>c.assertions.map(a=>[a.id,a]))),entries=new Map();
 for(const a of supplied){
  if(Object.keys(a).some(k=>!['id','status','observation','evidence'].includes(k))||!known.has(a.id)||entries.has(a.id)||!statuses.includes(a.status)||!text(a.observation)||!Array.isArray(a.evidence)||!a.evidence.every(e=>e&&typeof e.path==='string'&&path.isAbsolute(e.path)&&/^[a-f0-9]{64}$/.test(e.sha256)))throw Error('Invalid or duplicate assertion observation: '+a.id);
  if(['PASS','FAIL','PARTIAL'].includes(a.status)&&!a.evidence.length)throw Error('Observed assertions require retained evidence: '+a.id);
  for(const e of a.evidence){
   const file=await realpath(e.path),metadata=await lstat(e.path);
   evidenceBytes+=metadata.size;evidenceFiles++;
   if(evidenceBytes>512*1024*1024||evidenceFiles>1000)throw Error('Nightly evidence exceeds the bounded report inventory.');
   if(!inside(evidenceRoot,file)||!metadata.isFile()||metadata.isSymbolicLink()||metadata.size>128*1024*1024||await sha(file)!==e.sha256)throw Error('Nightly evidence is missing, changed or outside the worker workspace: '+a.id);
  }
  entries.set(a.id,{...a,evidence:a.evidence.map(e=>({...e,relativePath:'evidence/'+e.sha256+(['.png','.jpg','.jpeg','.webp','.gif','.mp4','.mov','.wav','.mp3','.json','.log','.txt','.otio'].includes(path.extname(e.path).toLowerCase())?path.extname(e.path).toLowerCase():'.txt')})),origin:'Agent observation'});
 }
 const cases=plan.cases.map(c=>{
  const assertions=c.assertions.map(a=>({...a,...entries.get(a.id)})),states=assertions.map(a=>a.status);
  const status=states.includes('UNKNOWN')?'UNKNOWN':states.includes('FAIL')?'FAIL':states.every(s=>s==='PASS')?'PASS':states.every(s=>s==='NOT_RUN')?'NOT_RUN':states.every(s=>['NOT_RUN','BLOCKED'].includes(s))?'BLOCKED':'PARTIAL';
  return {...c,assertions,status};
 });
 const counts=rows=>rows.reduce((n,r)=>(n[r.status]=(n[r.status]||0)+1,n),{});
 const inventory=(plan.catalogInventory||[]).map(c=>{const result=run.results.find(r=>r.test_id===c.id);return {...c,status:result?.status||'NOT_RUN',observation:result?.note||'Not executed in this run',evidence:result?.evidence||null};});
 return {format:'athanor-nightly-report/v1',cadence:plan.cadence||'nightly',planHash,runId:run.id,identity:plan.identity,cases,caseCounts:counts(cases),assertionCounts:counts(cases.flatMap(c=>c.assertions)),catalogInventory:inventory,catalogInventoryCounts:counts(inventory),releaseTestProposals:plan.releaseTestProposals||[],plannedExecution:plan.execution||null,
  catalog:{state:run.execution.state,counts:counts(run.results),checks:run.results.map(r=>({id:r.test_id,title:r.snapshot.title,status:r.status,observation:r.note,evidence:r.evidence}))},
  releaseChanges:plan.identity.releaseChanges||[],delivery:{state:'LOCAL_ONLY'},investigationRecommended:run.results.some(r=>['Fail','Blocked','Unknown'].includes(r.status))};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function nightlyHTML(report){
 const rows=report.cases.flatMap(c=>c.assertions.map(a=>`<tr data-status="${escape(a.status)}"><td>${escape(c.id)}<small>${escape(c.area)}</small></td><td>${escape(a.expected)}${a.support?'<details><summary>Check support · '+escape(a.support.coverage)+'</summary><p>'+(a.support.checks.map(d=>escape(d.id+(d.needsReview?' (review required)':''))+(d.expected?'<small>'+escape(d.expected)+'</small>':'')).join('<br>')||'No related check')+'</p><p>'+escape(a.support.remaining.join(' '))+'</p></details>':''}</td><td>${escape(a.status)}</td><td>${escape(a.observation||'Awaiting execution')}<small>${(a.evidence||[]).map(e=>'<a href="'+escape(e.relativePath)+'">View evidence · '+escape(e.sha256.slice(0,12))+'</a>').join('<br>')}</small></td></tr>`));
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Athanor ${report.cadence==='weekly'?'weekly':'nightly'} report</title><style>body{margin:0;background:#14191f;color:#d6e1eb;font:15px system-ui}main{max-width:1400px;margin:auto;padding:36px}h1{font-size:28px}small{display:block;color:#a0acb9;margin-top:6px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:14px;border-bottom:1px solid #343e48;vertical-align:top}th,select,input{background:#25313b;color:#d6e1eb}input,select{padding:10px;border:1px solid #536777;border-radius:6px}header{border-bottom:1px solid #7c99ab;padding-bottom:24px}pre{white-space:pre-wrap}a{color:#9bc6e5}</style><main><header><h1>Athanor · ${report.cadence==='weekly'?'Weekly':'Nightly'} report</h1><p>${escape(report.identity.build)} · Run ${escape(report.runId)}</p><p>${report.cases.length} functional cases · ${escape(JSON.stringify(report.caseCounts))}</p><p>Catalog: ${escape(report.catalog.state)} · ${escape(JSON.stringify(report.catalog.counts))}</p></header><h2>Functional assertions</h2><input id="search" placeholder="Search cases and assertions" aria-label="Search assertions"> <select id="status" aria-label="Filter status"><option value="">All statuses</option>${statuses.map(s=>`<option>${s}</option>`).join('')}</select><table><thead><tr><th>Case</th><th>Expected result</th><th>Status</th><th>Observation / evidence locations</th></tr></thead><tbody id="assertions">${rows.join('')}</tbody></table><h2>Catalog results</h2><table><thead><tr><th>Check</th><th>Status</th><th>Observation</th></tr></thead><tbody>${report.catalog.checks.map(c=>`<tr><td>${escape(c.id)}<small>${escape(c.title)}</small></td><td>${escape(c.status)}</td><td>${escape(c.observation)}<small>${escape(c.evidence)}</small></td></tr>`).join('')}</tbody></table><h2>Complete catalog inventory</h2><p>${escape(JSON.stringify(report.catalogInventoryCounts||{}))}</p><table><thead><tr><th>Check</th><th>Acceptance</th><th>Result</th><th>Related functional cases</th></tr></thead><tbody>${(report.catalogInventory||[]).map(c=>`<tr><td>${escape(c.title)}<small>${escape(c.id)}</small></td><td>${c.accepted?'Accepted':'Candidate'}</td><td>${escape(c.status)}${c.executable===false?'<small>Not executable</small>':''}</td><td>${escape(c.functionalCandidates.join(', ')||'No mapping hint')}</td></tr>`).join('')}</tbody></table><h2>Release-note test proposals</h2>${(report.releaseTestProposals||[]).length?(report.releaseTestProposals||[]).map(p=>`<section><h3>${escape(p.id)} · Proposed</h3><p>${escape(p.reason)}</p><p><a href="${escape(p.source.url)}">${escape(p.source.kind)}</a> · ${escape(p.source.summary)} · ${escape(p.source.retention)} retained</p><p>Expected: ${escape(p.case.expected.join('; '))}</p><p>Prerequisites: ${escape(p.prerequisites.join('; '))}</p></section>`).join(''):'<p>No proposals retained for this build.</p>'}<h2>Build and source identity</h2><pre>${escape(JSON.stringify(report.identity,null,2))}</pre><p>Agent evidence is included beside this page. Catalog evidence remains in its retained run report. Delivery: local report retained.</p><script>const search=document.querySelector('#search'),status=document.querySelector('#status');function filter(){for(const row of document.querySelectorAll('#assertions tr'))row.hidden=!!status.value&&row.dataset.status!==status.value||!row.textContent.toLowerCase().includes(search.value.toLowerCase())}search.addEventListener('input',filter);status.addEventListener('change',filter)</script></main></html>`;
}
