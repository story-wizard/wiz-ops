import {rawChecks,targetFor,families} from './catalog.mjs';
import {digest} from './files.mjs';
import {operationSupport} from './schema-compatibility.mjs';

export const desktopSetupOperations=['project.create','project.get_name','project.checkpoint','project.close','project.open','media.add_media_root','media.import_asset','media.resolve_path','timeline.create','timeline.place_cuts','timeline.inspect'];
export function operationsForCheck(c){
  const original=rawChecks.find(x=>x.id===c.id)||c;
  return [...new Set([...(original.operations||[]).filter(op=>/^[a-z_]+\.[a-z0-9_]+$/.test(op)),...(targetFor(c.id)!=='packaged'?desktopSetupOperations:[]),...(/^[DP]-SB-/.test(c.id)?['spellbook.list','spellbook.inspect']:[])])];
}
export function prerequisitesForCheck(id){return [...families.filter(f=>f.includes(id)).flat(),...id!=='A-CLI-01'?['A-CLI-01']:[],...targetFor(id)==='desktop'&&id!=='D-CLI-01'?['D-CLI-01']:[]];}
export function admitChecks(course,schema,captured,qualifications){
 const support=operationSupport(schema,captured,qualifications),allowed=new Set(support.qualifiedOperations);
 const checks=course.cases.map(c=>{
  const original=rawChecks.find(x=>x.id===c.id)||c;
  const operations=operationsForCheck(c);
  const missing=operations.filter(op=>!schema.operations[op]),unqualified=operations.filter(op=>schema.operations[op]&&!allowed.has(op));
  return {id:c.id,definitionHash:digest(original),operations,state:missing.length?'N/A':unqualified.length?'Blocked':'Ready',reason:missing.length?'Build does not support required operations: '+missing.join(', '):unqualified.length?'Operation contract needs review: '+unqualified.join(', '):'Required operation contracts qualified.',missingOperations:missing,unqualifiedOperations:unqualified};
 });
 const direct=new Map(checks.map(c=>[c.id,c]));
 for(const c of checks){if(c.state!=='Ready')continue;const prerequisites=prerequisitesForCheck(c.id);const blocked=prerequisites.map(id=>direct.get(id)).filter(p=>p&&p.state!=='Ready');if(blocked.length){c.state='Blocked';c.reason='Required check unavailable: '+blocked.map(p=>p.id+' ('+p.state+')').join(', ');}}
 return {format:'athanor-capability-admission/v1',schemaHash:digest(schema),...support,checks};
}
export function requireQualifiedOperation(plan,operation){
 if(plan?.admission&&!plan.admission.qualifiedOperations.includes(operation))throw Object.assign(Error('Operation contract is not qualified for this prepared build: '+operation),{status:'Blocked',code:'operation_contract_unqualified',diagnostics:{dispatch:'not_started',operation}});
}
