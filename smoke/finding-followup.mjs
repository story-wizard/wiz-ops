import {digest} from './runner/files.mjs';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function decisiveEvidence(summary){
 if(!summary)return null;
 const failed=summary.failedStep,step=s=>({id:s.id,phase:s.phase,status:s.status});
 // Hash only authored comparisons and phase facts. Artifact paths, capture IDs,
 // source excerpts and timestamps are incidental. Values explicitly asserted by
 // the author (including identity/path invariants) must not be stripped or guessed.
 const semantic={failedStep:failed?{...step(failed),observation:failed.observation}:null,lastCompletedStep:summary.lastCompletedStep?.id||null,
  assertions:(summary.assertions||[]).filter(a=>a.stepId===failed?.id||['Fail','Blocked','Unknown'].includes(a.status)).map(a=>({stepId:a.stepId,status:a.status,invariant:a.invariant,expected:a.expected,actual:a.actual,failureReason:a.failureReason})),
  notRun:(summary.notRun||[]).map(step),blocked:(summary.blocked||[]).map(step)};
 return {failedStep:failed?step(failed):null,semanticHash:digest(canonical(semantic))};
}
// These are review annotations. They never change an outcome, submit an issue,
// resolve a case or authorize execution. Keep comparison evidence in the record.
export function findingObservation(record,c){
 const a=c.attempts.at(-1)||c.original;
 return {packageHash:record.baseline.identities.packageHash,checkId:c.id,
  definitionHash:a.definitionHash,status:a.status,expected:a.expected,
  observation:a.observation,classification:c.classification,decisiveEvidence:decisiveEvidence(a.conclusion)};
}
function evidence(record,c){const a=c.attempts.at(-1)||record.baseline;return {runId:a.runId,reportUrl:a.reportUrl,reportHash:a.reportHash};}
function reviewedEvidence(record,c){const proof=evidence(record,c);if(typeof proof.runId!=='string'||!proof.runId||!/^[a-f0-9]{64}$/.test(proof.reportHash||''))throw Error('Finding review needs a retained report identity.');return proof;}
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('Unknown or invalid finding follow-up field.');};
const text=(v,label,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Provide '+label+'.');return v.trim();};
export function reviewFindingFollowUp(record,c,input,actor,lookup){
 if(input===null)return null;
 fields(input,['kind','issue','owner','consequence','nextAction','reviewBy','evidence','reference']);
 if(!['new','known'].includes(input.kind)||c.classification==='Unresolved')throw Error('Classify the finding before reviewing it as new or known.');
 const observation=findingObservation(record,c);
 if(!/^[a-f0-9]{64}$/.test(observation.packageHash||'')||!/^[a-f0-9]{64}$/.test(observation.definitionHash||''))throw Error('Finding review needs a retained package and test definition.');
 const value={kind:input.kind,issue:text(input.issue,'an issue or local finding identifier',200),owner:text(input.owner,'a follow-up owner',200),consequence:text(input.consequence,'the consequence'),nextAction:text(input.nextAction,'the next action'),evidence:text(input.evidence,'the evidence compared'),reviewBy:input.reviewBy,reviewedBy:actor,reviewedAt:new Date().toISOString(),observation,occurrence:reviewedEvidence(record,c)};
 const date=new Date(value.reviewBy+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value.reviewBy||'')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value.reviewBy)throw Error('Provide a valid review-by date (YYYY-MM-DD).');
 if(input.kind==='known'){
  fields(input.reference,['investigationId','caseId','revision']);
  if(input.reference.investigationId===record.id)throw Error('A known finding must reference another investigation.');
  const source=lookup?.(input.reference.investigationId),prior=source?.cases.find(x=>x.id===input.reference.caseId);
  if(!source||source.revision!==input.reference.revision||!prior)throw Error('Referenced finding changed or is absent. Reload it before review.');
  const priorObservation=findingObservation(source,prior);
  if(digest(observation)!==digest(priorObservation))throw Error('Package, definition, outcome, observation, decisive evidence or classification changed. Review this as a new finding instead of a known match.');
  value.reference={...input.reference,...reviewedEvidence(source,prior),observation:priorObservation};
 }else if(input.reference!==undefined)throw Error('Only a known finding may reference an earlier occurrence.');
 return value;
}

export function findingFollowUp(record,c){
 const f=c.followUp;
 if(!f)return {state:'unresolved',reason:'No reviewed finding follow-up has been recorded.'};
 const changed=digest(findingObservation(record,c))!==digest(f.observation)||digest(evidence(record,c))!==digest(f.occurrence||null);
 return {...f,state:changed?'changed':f.kind,reason:changed?'The attempt, report, package, definition, outcome, observation or classification differs from the reviewed occurrence. Review again before reusing the issue link.':'Reviewed occurrence; this annotation does not change the test outcome.'};
}

// Search is bounded and advisory. Equal observations can have different causes.
export function relatedFindings(record,c,records,{limit=20}={}){
 const current=findingObservation(record,c),items=[];
 for(const r of records){if(r.id===record.id)continue;
  for(const other of r.cases){
   if(other.id!==c.id||other.original.definitionHash!==c.original.definitionHash)continue;
   const observation=findingObservation(r,other);
   items.push({investigationId:r.id,revision:r.revision,caseId:other.id,...evidence(r,other),observation,followUp:findingFollowUp(r,other),comparison:digest(current)===digest(observation)?'same recorded observation':'changed context or observation'});
   if(items.length===limit)return items;
  }
 }
 return items;
}
