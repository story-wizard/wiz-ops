// Read-only projection for Tower. Execution and review remain owned by existing routes.
export function towerSnapshot({runner, desktop, runs, guide, details}) {
  const checks=guide.rows.map(r=>({id:r.id,title:r.title,area:r.area||'General',target:r.target,
    expected:r.expected||'',method:r.method||'',mechanism:r.mechanism||'',operations:r.operations||[],
    operationBasis:r.operationBasis||'',limit:r.source?.remaining||r.scope||'',
    reference:r.reference?{status:r.reference.status,runId:r.reference.runId,at:r.reference.at||'',
      observation:r.reference.observation||'',context:r.reference.context||'',agreement:r.reference.sourceAgreement||''}:null}));
  const byID=new Map(checks.map(c=>[c.id,c]));
  const contexts=new Map(guide.rows.flatMap(r=>[r.reference,...r.history].filter(Boolean).map(e=>[e.runId,e.context||e.courseError||''])));
  const results=(rs,definitions)=>rs.map(r=>{
    const id=r.id||r.test_id, definition=definitions.find(d=>d.id===id)||r.snapshot||{};
    return {id,title:definition.title||byID.get(id)?.title||id,status:r.status,
      expected:definition.expected||'',observation:r.note||r.error||r.reason||(r.status==='Pass'?'Recorded assertions were satisfied.':'No observation recorded.'),
      canPrepare:Boolean(desktop.course.cases.find(c=>c.id===id)?.steps?.length&&['Fail','Blocked','Unknown'].includes(r.status))};
  });
  const history=[...runs.map(r=>({id:r.id,title:r.name,kind:r.execution?(r.execution.package?.runtime?'composed':'packaged'):'manual',at:r.created_at,
    target:r.execution?.recipe?.target||'Manual record',build:r.build,state:r.execution?.state||'Manual',
    context:r.execution?.message||'',revision:r.execution?.recipe?.revision||0,
    results:results(r.results,r.execution?.recipe?.cases||[]).map(r=>({...r,canPrepare:false}))})),
    ...desktop.runs.map(r=>({id:r.id,title:r.course?.title||'Desktop course',kind:r.inputMode==='service'?'service':'desktop',at:r.startedAt,
      target:r.scope||r.course?.target||'Local GUI',build:`GUI ${(r.guiHash||'unknown').slice(0,12)} · CLI ${(r.cliHash||'unknown').slice(0,12)}`,
      state:r.status||'Unknown',revision:r.course?.revision||0,context:contexts.get(r.id)||r.error||'',reportHash:r.reportHash,
      results:results(r.results,r.course?.cases||[])}))].sort((a,b)=>b.at.localeCompare(a.at));
  const active=Boolean(runner.active||desktop.ownedSessions?.length||desktop.jobs.some(j=>['Preparing','Ready','Running'].includes(j.state)));
  return {format:'wizard-smoke-tower/v1',observedAt:new Date().toISOString(),active,
    runner:{prepared:runner.prepared,planHash:runner.plan?.planHash||'',build:runner.plan?.version||'No prepared package',
      app:runner.plan?.app||'',count:runner.course.cases.length,activeRun:runner.active?.run_id||null},
    courses:[{id:'packaged',title:'Packaged engine',count:runner.course.cases.length,target:runner.course.target},
      {id:'course',title:'Foreground editor',count:desktop.course.cases.length,target:desktop.course.target},
      {id:'service',title:'Background services',count:desktop.serviceCourse.cases.length,target:desktop.serviceCourse.target}],
    checks,runs:history,outcomes:desktop.outcomes,
    jobs:desktop.jobs.map(j=>{const d=j.kind==='handoff'?details(j.id):j;return {id:j.id,kind:j.kind,title:j.definition?.title||({course:'Foreground course',service:'Background services'}[j.kind])||'Human setup',
      state:j.state,at:j.createdAt,sourceRun:j.sourceRun,caseId:j.caseId||'',message:j.message||'',
      steps:j.definition?.steps||[],expected:j.definition?.expected||'',ozPrompt:d.ozPrompt||'',bugDraft:d.bugDraft||'',
      reviews:(d.reviews||[]).map(r=>({id:r.id,at:r.at,operator:r.operator,outcome:r.outcome,note:r.note}))};})};
}
