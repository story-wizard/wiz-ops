import path from 'node:path';
import {mkdir,readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {digest,inside,sha,writeJSON} from './runner/files.mjs';

export const reporterLimits={summary:256,text:16000,json:256*1024,logs:1024*1024,total:10*1024*1024};
const uuid=hash=>`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
const redact=s=>s.replace(/((?:api[_-]?key|authorization|token|secret)\s*[:=]\s*)([^\s,]+)/gi,'$1[REDACTED]');

export function qualifiedDiagnosticAfter(captures){
 return [...captures].reverse().find(after=>after.complete&&after.phase==='after'&&!after.error&&captures.some(before=>before.complete&&before.phase==='before'&&!before.error&&before.pid===after.pid&&before.generation===after.generation));
}

export function bugReporterFields(record,c,edited={}){
 const attempt=c.attempts.at(-1),procedure=attempt?.procedure?.length?attempt.procedure:c.original.procedure||[];
 const steps=procedure.map((s,i)=>(i+1)+'. '+s).join('\n')||attempt?.method||c.original.method||'See the retained test steps.';
 return {summary:edited.summary||c.title,reproduction_steps:`Steps\n${edited.reproduction_steps||steps}\n\nObserved\n${attempt?.observation||c.original.observation}\n\nInvestigation\n${c.reason||'See the retained investigation.'}\n\nAthanor investigation: ${record.id}\nCheck: ${c.id}\nFocused run: ${attempt?.runId||'Pending'}\nPackage SHA-256: ${record.baseline.identities.packageHash}`,expected_result:edited.expected_result||attempt?.expected||c.original.expected};
}

// A portable input for an app-owned importer. Never writes Wizard's pending-report slot.
export async function writeBugReporterParcels(record,reviews,drafts,stage){
 const parcels=[];
 for(const draft of drafts){
  const c=record.cases.find(c=>c.id===draft.caseId),attempt=c.attempts.at(-1);
  if(!/^[A-Z0-9-]{1,80}$/.test(c.id))throw Error('Invalid reporter case ID.');
  const review=reviews.find(r=>r.caseId===c.id&&r.runId===(attempt?.runId||record.baseline.runId));
  const directory='bug-reporter/'+c.id,root=path.join(stage,directory);await mkdir(root,{recursive:true,mode:0o700});
  const fields=bugReporterFields(record,c,draft.fields);
  const issues=[];if(!draft.ready)issues.push(draft.nextAction);
  if(fields.summary.length>reporterLimits.summary||fields.reproduction_steps.length>reporterLimits.text||fields.expected_result.length>reporterLimits.text)issues.push('Shorten the reporter fields to their documented limits.');
  const captures=review?.captures||[],after=qualifiedDiagnosticAfter(captures),screenshot=after?.artifacts.find(a=>a.role==='Window screenshot');
  if(!after)issues.push('Collect a verified before/after pair from the same process and launch generation.');
  const source={investigationId:record.id,revision:record.revision,caseId:c.id,runId:review.runId,packageHash:record.baseline.identities.packageHash,version:record.baseline.identities.version,report:review.report,definitionHash:attempt?.definitionHash||c.original.definitionHash};
  const attachments=[];
  async function attach(name,bytes,role,original){await writeFile(path.join(root,name),bytes,{mode:0o600});attachments.push({file:name,role,bytes:bytes.length,sha256:await sha(path.join(root,name)),...(original?{source:original}:{})});}
  let project=null;
  const state=after?.artifacts.find(a=>a.role==='Editor and timeline state');
  if(state)try{const value=JSON.parse(await readFile(path.join(stage,review.directory,'evidence',state.file)));project=value.bundle||null;}catch{issues.push('The retained editor state is not valid JSON.');}
  if(!path.isAbsolute(project||''))issues.push('Retain the reproduction project identity in the diagnostic state.');
  source.project=project;
  if(screenshot){const bytes=await readFile(path.join(stage,review.directory,'evidence',screenshot.file));
   if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))issues.push('The retained screenshot is not a PNG.');
   else await attach('screenshot.png',bytes,'Failure reproduction window',review.directory+'/evidence/'+screenshot.file);
  }else issues.push('Collect a diagnostic window screenshot during the focused reproduction.');
  const diagnostics={format:'athanor-reproduction-diagnostics/v1',source,expected:fields.expected_result,observed:attempt?.observation||c.original.observation,captures,steps:review.steps||[],evidence:review.evidence.map(a=>({...a,path:review.directory+'/evidence/'+a.file})),collection:{appReporterDiagnostics:'Not collected by this parcel',appTracing:'Not configured',profiling:'Not configured'}};
  const bytes=Buffer.from(JSON.stringify(diagnostics));
  if(bytes.length<=reporterLimits.json)await attach('diagnostics.json',bytes,'Reproduction provenance and evidence index');
  else issues.push('Diagnostic index exceeds the reporter JSON limit.');
  const logs=after?.artifacts.filter(a=>['Application log','Application error log'].includes(a.role))||[];
  if(logs.length){const content=redact((await Promise.all(logs.map(async a=>a.role+'\n'+await readFile(path.join(stage,review.directory,'evidence',a.file),'utf8')))).join('\n\n'));const logBytes=Buffer.from(content);
   if(logBytes.length<=reporterLimits.logs)await attach('logs.txt',logBytes,'Retained bounded process logs');else issues.push('Retained logs exceed the reporter attachment limit.');
  }
  const report={schema_version:1,report_id:uuid(digest({source,fields})),...fields,delivery_status:'not_submitted',captured_at:after?.at||null,screenshots:screenshot?[{file:'screenshot.png',source:'Retained Athanor reproduction',pid:after.pid,generation:after.generation}]:[]};
  const reportBytes=Buffer.from(JSON.stringify(report));
  if(reportBytes.length>reporterLimits.json||reportBytes.length+attachments.reduce((n,a)=>n+a.bytes,0)>reporterLimits.total)issues.push('Reporter payload exceeds its size limit.');
  await attach('report.json',reportBytes,'Draft fields in Wizard reporter format');
  const handoff={format:'athanor-bug-reporter-handoff/v1',source,fields,reportId:report.report_id,attachments,readyForPrefill:draft.ready&&!issues.length,readyForSubmission:draft.ready&&!issues.length&&c.review?.decision==='Confirmed',review:c.review,delivery:'not_submitted',issues,limits:reporterLimits};
  await writeJSON(path.join(root,'handoff.json'),{...handoff,contentHash:digest(handoff)});
  await writeFile(path.join(root,'START-HERE.txt'),'Read handoff.json and inspect the indexed evidence. report.json and its attachments are a local draft, not an app pending report.\nThe current Wizard dialog accepts field prefill; it does not import these attachments. An app-owned importer is needed to deliver this historical evidence together with freshly collected app diagnostics.\nUse desktop/bug-reporter.mjs only in an authorized, owned session on this build and project. It fills an empty editable Report Bug dialog and stops before Submit. Never inject this folder into Wizard bug-reports/pending.\n',{mode:0o600});
  parcels.push({caseId:c.id,path:directory+'/handoff.json',reportId:handoff.reportId,readyForPrefill:handoff.readyForPrefill,readyForSubmission:handoff.readyForSubmission,issues});
 }
 return parcels;
}

export async function readBugReporterParcel(file){
 if(!path.isAbsolute(file))throw Error('Provide an absolute reporter handoff path.');
 const root=await realpath(path.dirname(file)),value=JSON.parse(await readFile(file,'utf8')),{contentHash,...content}=value;
 if(value.format!=='athanor-bug-reporter-handoff/v1'||digest(content)!==contentHash)throw Error('Reporter handoff changed or has an unsupported format.');
 if(!value.readyForPrefill||value.delivery!=='not_submitted')throw Error('Complete the focused reproduction evidence before reporter prefill.');
 if(!/^[a-f0-9]{64}$/.test(value.source?.packageHash)||!path.isAbsolute(value.source?.project||''))throw Error('Reporter handoff needs its build and reproduction project identity.');
 if(Object.keys(value.fields||{}).sort().join(',')!=='expected_result,reproduction_steps,summary')throw Error('Unsupported reporter fields.');
 for(const [key,text]of Object.entries(value.fields)){const limit=key==='summary'?reporterLimits.summary:reporterLimits.text;if(typeof text!=='string'||!text.trim()||text.length>limit)throw Error('Invalid reporter field: '+key);}
 if(!Array.isArray(value.attachments)||!value.attachments.some(a=>a.file==='screenshot.png')||!value.attachments.some(a=>a.file==='diagnostics.json')||!value.attachments.some(a=>a.file==='report.json'))throw Error('Reporter attachments are incomplete.');
 let total=0;const names=new Set();
 for(const a of value.attachments){if(names.has(a.file))throw Error('Repeated reporter attachment.');names.add(a.file);if(!['report.json','screenshot.png','diagnostics.json','logs.txt'].includes(a.file))throw Error('Unsupported reporter attachment.');const full=await realpath(path.join(root,a.file));if(!inside(root,full)||(await stat(full)).size!==a.bytes||await sha(full)!==a.sha256)throw Error('Reporter attachment changed: '+a.file);if(a.file.endsWith('.json')&&a.bytes>reporterLimits.json||a.file==='logs.txt'&&a.bytes>reporterLimits.logs)throw Error('Reporter attachment exceeds its size limit.');total+=a.bytes;}
 if(total>reporterLimits.total)throw Error('Reporter parcel exceeds its size limit.');
 return value;
}
