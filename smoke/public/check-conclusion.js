const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Same recorded comparison in the live investigation and standalone reviewer.
export function renderConclusion(summary,evidenceHref=()=>null){
 if(!summary)return '';
 const failed=summary.failedStep,assertions=summary.assertions||[],notRun=summary.notRun||[];
 if(!failed&&!assertions.length&&!notRun.length)return '';
 const comparison=assertions.map(a=>{
  const href=a.artifact&&evidenceHref(a.artifact);
  return `<section class="assertion-comparison"><h4>${escape(a.title)} · ${escape(a.status)}</h4>${a.evidenceStatus==='Needs review'?'<p>Assertion evidence needs review: the retained proof does not match this comparison.</p>':''}${a.invariant?`<p>${escape(a.invariant)}</p>`:''}<dl><dt>Expected</dt><dd><pre>${escape(JSON.stringify(a.expected,null,2))}</pre></dd><dt>Observed</dt><dd><pre>${escape(JSON.stringify(a.actual,null,2))}</pre></dd></dl>${href?`<a href="${escape(href)}" target="_blank" rel="noopener">Open assertion evidence</a>`:''}</section>`;
 }).join('');
 return `<section class="check-conclusion"><h3>${failed?.status==='Fail'&&assertions.some(a=>a.stepId===failed.id)?'Failed assertion':failed?'Stopped at':'Recorded comparisons'}</h3>${failed?`<p><strong>${escape(failed.title)}</strong> · ${escape(failed.phase)} · ${escape(failed.status)}</p>`:''}${comparison}${assertions.find(a=>a.stepId===failed?.id)?.question?`<p><strong>Next inspection:</strong> ${escape(assertions.find(a=>a.stepId===failed.id).question)}</p>`:''}${summary.lastCompletedStep?`<p><small>Last completed: ${escape(summary.lastCompletedStep.title)}</small></p>`:''}${(summary.blocked||[]).map(s=>`<p><strong>Blocked: ${escape(s.title)}</strong> — ${escape(s.reason)}</p>`).join('')}${notRun.length?`<p><strong>Not reached:</strong> ${notRun.map(s=>escape(s.title)+(s.reason?' — '+escape(s.reason):'')).join('; ')}.</p>`:''}</section>`;
}
