import path from 'node:path';
import {readFile,mkdir,mkdtemp,writeFile,cp,rename,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ROOT,digest,dataDirectory,fingerprint,inside,sha} from './runner/files.mjs';
import {localReport,exportLocalReport,renderInvestigationReview} from './reports.mjs';
import {writeBugReporterParcels,bugReporterFields,reporterLimits,qualifiedDiagnosticAfter} from './bug-reporter.mjs';
import {activeStates} from './runner/store.mjs';

export const classifications=['Unresolved','Harness','Environment','App'];
export const dispositions=['Investigate','Reproduce','Resolved'];
const text=(v,label,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Provide '+label+'.');return v.trim();};
const now=()=>new Date().toISOString();
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('Unknown or invalid investigation field.');};
export function initializeInvestigations(db){db.exec('CREATE TABLE IF NOT EXISTS investigations (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, content TEXT NOT NULL)');}
export function investigation(db,id){const row=db.prepare('SELECT content FROM investigations WHERE id=?').get(id);if(!row)throw Error('Investigation not found.');return JSON.parse(row.content);}
export function investigationList(db,runId){
 return db.prepare('SELECT content FROM investigations ORDER BY rowid DESC').all().map(r=>JSON.parse(r.content)).filter(r=>!runId||r.baseline.runId===runId||r.cases.some(c=>c.attempts.some(a=>a.runId===runId))||r.repros?.some(p=>p.runId===runId)).map(r=>{
  const primary=r.cases.filter(c=>!c.duplicateOf),drafts=primary.filter(c=>c.classification==='App'&&c.disposition==='Reproduce').map(c=>bugDraft(r,c));
  return {id:r.id,revision:r.revision,title:r.title,runId:r.baseline.runId,relatedRunIds:[...new Set([r.baseline.runId,...r.cases.flatMap(c=>c.attempts.map(a=>a.runId)),...(r.repros||[]).map(p=>p.runId).filter(Boolean)])],createdAt:r.createdAt,updatedAt:r.history.at(-1)?.at||r.createdAt,version:r.baseline.identities.version,caseCount:r.cases.length,openCount:primary.filter(c=>c.disposition!=='Resolved').length,needsTriageCount:primary.filter(c=>c.disposition==='Investigate').length,needsReproCount:primary.filter(c=>c.disposition==='Reproduce').length-drafts.filter(d=>d.ready).length,needsReviewCount:drafts.filter(d=>d.ready&&d.state!=='Confirmed for submission').length,confirmedCount:drafts.filter(d=>d.state==='Confirmed for submission').length};
 });
}
function terminal(run){if(!run?.execution||activeStates.includes(run.execution.state))throw Error('Finish the automated run before investigating.');}
function baseline(report,exported){return {runId:report.runId,title:report.title,identities:report.identities,selection:report.selection,evidenceStatus:report.acceptance.evidenceStatus,gaps:report.acceptance.gaps,reportUrl:exported.url,reportPath:exported.path,reportHash:digest(report)};}
export async function createInvestigation(db,run,dataDir,input={}){
 fields(input,['actor','title']);terminal(run);const actor=text(input.actor,'the creating person or agent',120);
 const {report}=await localReport(run,dataDir),exported=await exportLocalReport(run,dataDir);
 const cases=report.cases.filter(c=>['Fail','Blocked','Unknown','Not run'].includes(c.status)).map(c=>({id:c.id,title:c.title,classification:'Unresolved',disposition:'Investigate',reason:'',duplicateOf:null,original:{status:c.status,observation:c.observation,expected:c.expected,definitionHash:c.definitionHash,method:c.method,procedure:c.procedure||[],operations:c.operations,steps:(c.steps||[]).map(s=>({title:s.title,phase:s.phase}))},attempts:[],review:null}));
 if(!cases.length)throw Error('This run has no outcomes needing investigation.');
 const record={format:'athanor-investigation/v1',id:randomUUID(),revision:1,createdAt:now(),title:input.title?text(input.title,'a title',200):run.name+' — investigation',baseline:baseline(report,exported),cases,history:[{at:now(),actor,action:'Created',runId:run.id}]};
 db.prepare('INSERT INTO investigations VALUES (?,?,?)').run(record.id,1,JSON.stringify(record));return record;
}
function save(db,previous,next,actor,action,details){next.revision++;next.history.push({at:now(),actor:text(actor,'the recording person or agent',120),action,...details});const updated=db.prepare('UPDATE investigations SET revision=?,content=? WHERE id=? AND revision=?').run(next.revision,JSON.stringify(next),previous.id,previous.revision);if(updated.changes!==1)throw Error('Investigation changed. Reload before saving.');return next;}
function checked(db,id,input){const previous=investigation(db,id);if(input.revision!==previous.revision)throw Error('Investigation changed. Reload before saving.');return previous;}
export function previewTriage(previous,input){
 fields(input,['revision','actor','updates','log']);if(input.revision!==previous.revision)throw Error('Investigation changed. Reload before reviewing the proposal.');
 text(input.actor,'the recording person or agent',120);const next=structuredClone(previous);
 if(!Array.isArray(input.updates)||!input.updates.length||input.updates.length>next.cases.length)throw Error('Provide case triage updates.');
 const seen=new Set();for(const update of input.updates){
  fields(update,['id','classification','disposition','reason','duplicateOf']);const c=next.cases.find(c=>c.id===update.id);
  if(!c||seen.has(c.id)||!classifications.includes(update.classification)||!dispositions.includes(update.disposition))throw Error('Unknown, repeated or invalid triage case.');seen.add(c.id);
  Object.assign(c,{classification:update.classification,disposition:update.disposition,reason:text(update.reason,'evidence and reasoning for '+c.id),duplicateOf:update.duplicateOf||null,review:null});
 }
 for(const c of next.cases){const visited=new Set([c.id]);let current=c;while(current.duplicateOf){if(visited.has(current.duplicateOf))throw Error('Duplicate groups must not contain cycles.');visited.add(current.duplicateOf);current=next.cases.find(x=>x.id===current.duplicateOf);if(!current)throw Error('Duplicate target is outside this investigation.');}}
 const log=input.log===undefined?'':text(input.log,'an investigation log',30000);
 return {next,changes:input.updates.map(update=>({id:update.id,before:previous.cases.find(c=>c.id===update.id),after:next.cases.find(c=>c.id===update.id)})),log};
}
export function triageInvestigation(db,id,input){
 const previous=checked(db,id,input),{next,log}=previewTriage(previous,input);
 return save(db,previous,next,input.actor,'Triage',{updates:input.updates,log});
}
// Match the exact case-owned retained path and digest, never a same-named file from another capture.
export function diagnosticCaptures(item,report,buffers,runRoot){
 const owned=new Set((item.evidence||[]).map(a=>a.file)),captures=[];
 for(const file of owned){
  if(!/diagnostic-[a-f0-9-]+\.json$/.test(file))continue;
  let capture;try{capture=JSON.parse(buffers[file]);}catch{continue;}
  if(!capture||capture.id!==item.id||capture.profile!=='investigation'||!['before','after'].includes(capture.phase))continue;
  const artifacts=[];
  if(!Array.isArray(capture.artifacts)||!Array.isArray(capture.files))continue;
  for(const name of ['state.json','window.png','stdout.txt','stderr.txt']){
   const source=capture.artifacts?.find(f=>typeof f==='string'&&path.basename(f)===name&&inside(runRoot,f));
   const proof=source&&capture.files.find(f=>f.path===source);
   const matching=proof&&report.artifacts.filter(a=>owned.has(a.file)&&path.basename(a.source)===name&&a.sha256===proof.sha256)||[];
   const exact=matching.find(a=>[a.source,...a.sources||[]].some(s=>path.resolve(runRoot,s)===path.resolve(source)));
   // Legacy reports deduplicated identical bytes without retaining every source path. Show them, but do not qualify new drafts from that weaker association.
   const retained=exact||matching[0];
   if(retained)artifacts.push({file:retained.file,role:name==='window.png'?'Window screenshot':name==='state.json'?'Editor and timeline state':name==='stdout.txt'?'Application log':'Application error log',sha256:retained.sha256,sourceVerified:!!exact});
  }
  captures.push({phase:capture.phase,at:capture.at||null,pid:capture.pid,generation:capture.generation??null,manifest:file,artifacts,complete:capture.status==='Collected'&&Number.isInteger(capture.pid)&&capture.pid>0&&Number.isInteger(capture.generation)&&capture.generation>=0&&capture.artifacts?.length===4&&artifacts.length===4&&artifacts.every(a=>a.sourceVerified),error:capture.error||null});
 }
 return captures.sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
}
function hasDiagnosticEvidence(item,report,buffers,runRoot,profile){
 if(profile!=='investigation')return false;
 if(item.target==='packaged')return item.actions.some(a=>a.operation!=='check.observation'&&a.status!=='Unknown');
 const captures=diagnosticCaptures(item,report,buffers,runRoot);
 return !!qualifiedDiagnosticAfter(captures);
}
export async function linkReproduction(db,id,run,dataDir,input){
 fields(input,['revision','actor','runId']);const previous=checked(db,id,input);terminal(run);if(run.id===previous.baseline.runId)throw Error('Link a new reproduction, not the original run.');
 const {report,buffers}=await localReport(run,dataDir);if(report.identities.packageHash!==previous.baseline.identities.packageHash)throw Error('Reproduction uses a different build package. Start a separate investigation.');
 const matches=report.cases.filter(c=>previous.cases.some(x=>x.id===c.id));if(!matches.length)throw Error('This run has no investigation checks.');
 if(previous.history.some(h=>h.action==='Reproduction linked'&&h.runId===run.id))throw Error('This reproduction is already linked.');
 const exported=await exportLocalReport(run,dataDir),next=structuredClone(previous),profile=run.execution.recipe.selection?.diagnostics||'standard';
 for(const item of matches){const c=next.cases.find(c=>c.id===item.id);const diagnosticComplete=hasDiagnosticEvidence(item,report,buffers,run.execution.artifact_root,profile);c.attempts.push({diagnosticComplete,artifactRoot:run.execution.artifact_root,runId:run.id,status:item.status,observation:item.observation,expected:item.expected,method:item.method,procedure:item.procedure||[],steps:item.steps||[],definitionHash:item.definitionHash,definitionChanged:item.definitionHash!==c.original.definitionHash,diagnostics:profile,evidenceStatus:report.acceptance.evidenceStatus,gaps:report.acceptance.gaps,reportUrl:exported.url,reportPath:exported.path,reportHash:digest(report),recordedAt:now()});c.review=null;}
 return save(db,previous,next,input.actor,'Reproduction linked',{runId:run.id,checks:matches.map(c=>c.id)});
}
export function reproSelection(record){
 const ids=record.cases.filter(c=>c.disposition==='Reproduce'&&!c.duplicateOf).map(c=>c.id);if(!ids.length)throw Error('Mark at least one primary case Reproduce.');
 // Keep qualification candidates within the canonical course; never silently accept them.
 const candidates=record.baseline.selection?.qualificationIds||[];
 const suffix=' — diagnostic repro';
 return {project:'fresh',title:record.title.slice(0,200-suffix.length)+suffix,diagnostics:'investigation',...(ids.some(id=>candidates.includes(id))?{courseIds:['smoke-full'],subsetIds:ids}:{checkIds:ids})};
}
export function bugDraft(record,c){
 const attempt=c.attempts.at(-1),state=c.duplicateOf?'Review the primary case '+c.duplicateOf:c.disposition!=='Reproduce'?'Mark the primary case Reproduce':c.classification!=='App'?'Classify the case as App':!attempt?'Link a focused reproduction':attempt.status!=='Fail'?'Latest reproduction is '+attempt.status:attempt.diagnostics!=='investigation'?'Run the diagnostic repro course':!attempt.diagnosticComplete?'Complete the required diagnostic captures':attempt.gaps.length?'Review reproduction evidence gaps':null;
 const expected=attempt?.expected||c.original.expected,procedure=attempt?.procedure?.length?attempt.procedure:c.original.procedure?.length?c.original.procedure:(attempt?.steps?.length?attempt.steps:c.original.steps||[]).map(s=>s.title);
 const generated={summary:c.title,reproduction_steps:procedure.map((s,i)=>(i+1)+'. '+s).join('\n')||attempt?.method||c.original.method||'See the retained test steps',expected_result:expected};
 const basis=draftBasis(record,c),staleEdits=!!c.draftEdits&&digest(c.draftEdits.basis)!==digest(basis),editable=staleEdits?generated:{...generated,...c.draftEdits?.fields};
 const reporterFields=bugReporterFields(record,c,editable),oversized=Object.entries(reporterFields).some(([k,v])=>v.length>(k==='summary'?reporterLimits.summary:reporterLimits.text));
 const issue=state||(staleEdits?'Review edits retained from the previous attempt':Object.entries(editable).some(([k,v])=>typeof v!=='string'||!v.trim()||v.length>(k==='summary'?256:16000))?'Shorten or complete the bug draft fields':oversized?'Shorten the reproduction steps to leave room for recorded context':null);
 const body=`${editable.summary}\n\nBuild: ${record.baseline.identities.version}\nPackage SHA-256: ${record.baseline.identities.packageHash}\nTest: ${c.id}\n\nExpected\n${editable.expected_result}\n\nReproduction steps\n${editable.reproduction_steps}\n\nObserved\n${attempt?.observation||c.original.observation}\n\nInvestigation\n${c.reason||'Awaiting triage'}\n\nFirst run: ${record.baseline.runId}\nFirst evidence: ${record.baseline.reportPath}\nReproduction: ${attempt?.runId||'Pending'}\nReproduction evidence: ${attempt?.reportPath||'Pending'}\nDefinition changed: ${attempt?.definitionChanged?'Yes — review harness changes':'No'}\n\nReview the retained steps and evidence, paste this into Wizard Report a Bug, inspect the diagnostic attachments, and submit after human confirmation.`;
 return {caseId:c.id,title:editable.summary,fields:editable,generated,basis,staleEdits,previousEdits:staleEdits?c.draftEdits:null,ready:!issue,state:issue?'Needs work':c.review?.decision==='Confirmed'?'Confirmed for submission':c.review?.decision||'Draft',nextAction:issue||(c.review?.decision==='Confirmed'?'Submit through Wizard Report a Bug':c.review?.decision==='Rejected'?'Review rejected draft':c.review?.decision==='Needs work'?'Address human review notes':'Human review'),body,review:c.review,reportUrl:attempt?.reportUrl||record.baseline.reportUrl};
}
function draftBasis(record,c){const a=c.attempts.at(-1);return {runId:a?.runId||record.baseline.runId,definitionHash:a?.definitionHash||c.original.definitionHash};}
export function editBugDraft(db,id,input){
 fields(input,['revision','actor','caseId','fields']);const previous=checked(db,id,input),next=structuredClone(previous),c=next.cases.find(c=>c.id===input.caseId);
 if(!c||c.classification!=='App'||c.duplicateOf)throw Error('Choose a primary App case to edit its bug draft.');
 fields(input.fields,['summary','reproduction_steps','expected_result']);
 const values=Object.fromEntries(['summary','reproduction_steps','expected_result'].map(k=>[k,text(input.fields?.[k],k,k==='summary'?256:16000)]));
 c.draftEdits={fields:values,basis:draftBasis(previous,c),actor:text(input.actor,'the draft editor',120),at:now()};c.review=null;
 return save(db,previous,next,input.actor,'Draft edited',{caseId:c.id,basis:c.draftEdits.basis});
}
export function reviewDraft(db,id,input){
 fields(input,['revision','actor','caseId','decision','note']);const previous=checked(db,id,input),next=structuredClone(previous),c=next.cases.find(c=>c.id===input.caseId);
 if(!c||c.classification!=='App'||c.duplicateOf||c.disposition!=='Reproduce'||!['Confirmed','Needs work','Rejected'].includes(input.decision))throw Error('Choose an App case and a review decision.');
 if(input.decision==='Confirmed'&&!bugDraft(previous,c).ready)throw Error('Complete diagnostic reproduction and evidence before confirming.');
 c.review={decision:input.decision,reviewer:text(input.actor,'the human reviewer',120),note:text(input.note,'a review observation'),at:now()};
 return save(db,previous,next,input.actor,'Human review',{caseId:c.id,review:c.review});
}
export function agentInvestigationPrompt(record){return `Investigate Athanor run ${record.baseline.runId}. Open index.html for the reviewer view. Read START-HERE.md, review-data.json, reference/AGENTS.md, reference/docs/investigations.md, investigation.json, report/report.json and the retained per-check steps/evidence. Work in the current Athanor source checkout; keep frozen evidence intact.\n\nFor every case, separate Harness, Environment, App or Unresolved. Cite the evidence supporting the classification; do not classify Blocked as an app defect merely because it did not run. Group likely duplicates with duplicateOf only when observations support the same defect; log the reasoning. Resolve harness/environment issues first. Use triage-template.json with the current revision, your actor name, concrete reasons and Investigate/Reproduce/Resolved dispositions. Record it with node scripts/smoke.mjs investigation triage --id ${record.id} --file /absolute/path/triage.json --server <local-service>.\n\nExport the updated package to obtain repro-selection.json. Use that selection to prepare the exact build named in investigation.json in fresh isolated projects. Diagnostics adds before/after editor state, screenshots and log tails to the normal operation/step/failure evidence. Check diagnostic-capture records for collection errors. App telemetry, profiling, video and audio need their own qualified collectors; do not claim they were enabled. No automatic rerun is authorized by this package. Inspect Unknown actions before retrying any mutation.\n\nAfter an authorized focused run, link it using investigation link --id ${record.id} --run <repro-run-id> --revision <current> --actor <name>. New outcomes remain separate from the first run. Prepare local Report a Bug drafts and use investigation reporter --id ${record.id} --case CHECK_ID --server <local-service> for a bounded checksummed evidence parcel. Read reference/docs/bug-reporter-interop.md. Field prefill is a separate explicitly authorized GUI action; current app dialogs do not import parcel attachments. A person reviews the list, steps and evidence and records confirmation; the person submits through Wizard Report a Bug. Never create Jira issues, upload evidence or submit externally from this workflow.\n`;}
export async function exportInvestigation(db,id,dataDir){
 dataDir=dataDirectory(dataDir);const record=investigation(db,id),parent=path.join(dataDir,'exports');await mkdir(parent,{recursive:true});const stage=await mkdtemp(path.join(parent,'.investigation-'));
 try{
  const reviews=[];
  const inputs=new Map([[record.baseline.runId,record.baseline],...record.cases.flatMap(c=>c.attempts.map(a=>[a.runId,a]))]);
  for(const [runId,entry] of inputs){
   const root=await realpath(path.dirname(entry.reportPath));if(path.dirname(root)!==await realpath(parent)||!/^smoke-report-[a-f0-9-]{36}-[a-f0-9]{12}$/.test(path.basename(root)))throw Error('Report package escaped the local export directory.');
   const report=JSON.parse(await readFile(path.join(root,'report.json'),'utf8'));if(digest(report)!==entry.reportHash)throw Error('Retained investigation report changed.');
   const destination=runId===record.baseline.runId?'report':'reproductions/'+runId;await mkdir(path.join(stage,destination),{recursive:true});
   await cp(path.join(root,'index.html'),path.join(stage,destination,'index.html'));
   await writeFile(path.join(stage,destination,'report.json'),JSON.stringify(report,null,2)+'\n');
   const buffers={};
   for(const a of report.artifacts){if(path.basename(a.file)!==a.file)throw Error('Invalid report artifact name.');const source=await realpath(path.join(root,'evidence',a.file));if(!inside(root,source))throw Error('Report artifact escaped its package.');const bytes=await readFile(source);if(bytes.length!==a.bytes||await sha(source)!==a.sha256)throw Error('Retained report artifact changed: '+a.file);
    buffers[a.file]=bytes;
    await mkdir(path.join(stage,destination,'evidence'),{recursive:true});await cp(source,path.join(stage,destination,'evidence',a.file));
   }
   for(const item of report.cases.filter(c=>record.cases.some(x=>x.id===c.id)))reviews.push({caseId:item.id,runId,role:runId===record.baseline.runId?'First run':'Reproduction',status:item.status,observation:item.observation,expected:item.expected,method:item.method,procedure:item.procedure||[],steps:item.steps||[],report:destination+'/index.html',captures:diagnosticCaptures(item,report,buffers,entry.artifactRoot||path.join(dataDir,'runs',runId)),evidence:(item.evidence||[]).map(a=>({...a,sha256:report.artifacts.find(f=>f.file===a.file)?.sha256,bytes:report.artifacts.find(f=>f.file===a.file)?.bytes})),directory:destination});
  }
  for(const guide of ['AGENTS.md','docs/investigations.md','docs/bug-reporter-interop.md','docs/agent-courses.md','docs/test-evidence.md','docs/build-repair.md','docs/interaction-library.md']){await mkdir(path.dirname(path.join(stage,'reference',guide)),{recursive:true});await cp(path.join(ROOT,guide),path.join(stage,'reference',guide));}
  const drafts=record.cases.filter(c=>c.classification==='App'&&!c.duplicateOf).map((c,i)=>({...bugDraft(record,c),file:'drafts/bug-'+(i+1)+'.txt'}));
  await mkdir(path.join(stage,'drafts'),{recursive:true});
  for(const draft of drafts)await writeFile(path.join(stage,draft.file),draft.body+'\n');
  const parcels=await writeBugReporterParcels(record,reviews,drafts,stage);
  const contents={'bug-reporter.json':JSON.stringify(parcels,null,2),'index.html':renderInvestigationReview(record,reviews,drafts),'review-data.json':JSON.stringify(reviews,null,2),'investigation.json':JSON.stringify(record,null,2),'triage-template.json':JSON.stringify({revision:record.revision,actor:'Your agent',updates:record.cases.map(c=>({id:c.id,classification:c.classification,disposition:c.disposition,reason:c.reason||'Replace with evidence and reasoning',duplicateOf:c.duplicateOf})),log:'Investigation actions and findings'},null,2),'AGENT-PROMPT.txt':agentInvestigationPrompt(record),'bug-drafts.json':JSON.stringify(drafts,null,2),'START-HERE.md':`# ${record.title}\n\nOpen index.html for the review brief, before/after captures and bug drafts. Open report/index.html for the first run and reproductions/<run-id>/index.html for linked attempts. investigation.json retains triage and review history; the reports keep the original outcomes.\n\n1. Choose tasks/triage.txt, repair.txt, repro.txt or review.txt and give the corresponding JSON context and this directory to your agent.\n2. Preview the returned proposal, then apply reviewed triage through the local CLI/API and export again.\n3. Prepare repro-selection.json on the exact package, review the added prerequisites and start an authorized diagnostic course.\n4. The investigation-managed repro links when completed; link externally started runs explicitly. Export again.\n5. A person reviews index.html, drafts/ and the evidence, confirms or sends them back for more work, then submits through Wizard Report a Bug.\n\nMedia, app bytes and full projects remain in the local run workspace; use the existing run kit command for a complete reproduction kit. All debug here means the qualified harness captures listed in the diagnostic profile, not unconfigured app tracing.\n`};
  for(const task of ['triage','repair','repro','review']){const packet=investigationTask(record,{task});await mkdir(path.join(stage,'tasks'),{recursive:true});contents['tasks/'+task+'.json']=JSON.stringify(packet,null,2);contents['tasks/'+task+'.txt']=packet.prompt;}
  try{contents['repro-selection.json']=JSON.stringify(reproSelection(record),null,2);}catch{contents['repro-pending.txt']='Mark primary cases Reproduce, then export again.\n';}
  for(const [name,content]of Object.entries(contents))await writeFile(path.join(stage,name),content+'\n');
  const inventory=(await fingerprint(stage)).entries,manifest={format:'athanor-investigation-package/v1',id,revision:record.revision,inventory,inventoryHash:digest(inventory)};await writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const name='investigation-'+id+'-'+digest(manifest).slice(0,12),directory=path.join(parent,name);
  try{await rename(stage,directory);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;}
  return {id,revision:record.revision,url:'/exports/'+name+'/index.html',path:directory,manifest:path.join(directory,'manifest.json'),prompt:agentInvestigationPrompt(record),selection:contents['repro-selection.json']?JSON.parse(contents['repro-selection.json']):null,drafts,parcels};
 }finally{await rm(stage,{recursive:true,force:true});}
}

// Serve only immutable inventory members. No source, workspace or sibling-file access.
export async function readInvestigationFile(dataDir,name,relative){
 if(!/^investigation-[a-f0-9-]{36}-[a-f0-9]{12}$/.test(name)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid investigation package path.');
 const parent=await realpath(path.join(dataDirectory(dataDir),'exports')),root=await realpath(path.join(parent,name));
 if(path.dirname(root)!==parent)throw Error('Investigation package escaped its export directory.');
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 if(digest(manifest.inventory)!==manifest.inventoryHash||!name.endsWith(digest(manifest).slice(0,12)))throw Error('Investigation manifest changed.');
 const member=manifest.inventory.find(([file])=>file===relative);if(!member)throw Error('File is not in the investigation inventory.');
 const file=await realpath(path.join(root,relative));if(!inside(root,file))throw Error('Investigation file escaped its package.');
 const bytes=await readFile(file);if(bytes.length!==member[1]||await sha(file)!==member[2])throw Error('Investigation file changed.');return bytes;
}

export async function reporterHandoff(db,id,dataDir,input){
 fields(input,['caseId']);const record=investigation(db,id),c=record.cases.find(c=>c.id===input.caseId);
 if(!c||c.classification!=='App'||c.duplicateOf||c.disposition!=='Reproduce')throw Error('Choose a primary App case marked Reproduce.');
 const pack=await exportInvestigation(db,id,dataDir),parcel=pack.parcels.find(p=>p.caseId===c.id),file=path.join(pack.path,parcel.path);
 return {...parcel,path:file,packageUrl:pack.url,command:['node','desktop/bug-reporter.mjs','/absolute/SESSION.json',file],prompt:`Prepare Wizard Report Bug from ${file}. Read the parcel, its source build/project identities, attachments, review and issues first. Keep all evidence local.
This prompt does not authorize launching or operating Wizard. Once GUI work is explicitly authorized, use an owned foreground Athanor session on this exact package and retained reproduction project; resume the original session when available. Run node desktop/bug-reporter.mjs SESSION.json ${JSON.stringify(file)}. It checks capabilities, preserves existing drafts and pending reports, fills the three fields, verifies readback and records a receipt. It stops before Submit.
The current app dialog does not import historical attachments. Keep this parcel with the report; an app-owned importer must accept it before treating these attachments as delivered. Do not write the app pending-report store, retry uncertain mutations, upload or submit. A person reviews and confirms the draft, inspects the app's captures, and chooses submission.`};
}

export function caseNextAction(record,c){
 const draft=bugDraft(record,c),a=c.attempts.at(-1);
 if(c.duplicateOf)return {action:'primary',label:'Review primary case',reason:'Grouped with '+c.duplicateOf};
 if(c.disposition==='Resolved')return {action:'evidence',label:'Review resolution evidence',reason:c.reason};
 if(c.classification==='Unresolved'||c.disposition==='Investigate')return {action:'triage',label:'Classify this case',reason:'Compare the recorded action and evidence before choosing a cause.'};
 if(a?.status==='Unknown')return {action:'evidence',label:'Inspect interrupted attempt',reason:'Establish the outcome before preparing another attempt.'};
 if(a?.status==='Pass')return {action:'triage',label:'Review passing repro',reason:'Record whether the original issue is resolved or still needs investigation.'};
 if(a?.status==='Fail'&&c.classification!=='App')return {action:'triage',label:'Review failing repro',reason:'Compare the new failure with the original observation and update its cause.'};
 if(c.classification==='App'&&draft.ready)return {action:'draft',label:c.review?.decision==='Confirmed'?'Review confirmed draft':'Review bug draft',reason:draft.nextAction};
 if(draft.staleEdits)return {action:'draft',label:'Review earlier draft edits',reason:draft.nextAction};
 if(c.classification==='App'&&a?.status==='Fail'&&a.diagnostics==='investigation'&&a.diagnosticComplete&&!a.gaps?.length)return {action:'draft',label:'Edit bug draft',reason:draft.nextAction};
 return {action:'repro',label:a?'Review diagnostic repro setup':'Open repro setup',reason:a?draft.nextAction:'Use the same package and retain a separate diagnostic attempt.'};
}

export function investigationTask(record,{task='triage',caseId}={}){
 if(!['triage','repair','repro','review'].includes(task))throw Error('Unknown investigation task.');
 const cases=caseId?record.cases.filter(c=>c.id===caseId):record.cases;if(!cases.length)throw Error('Investigation case not found.');
 const updates=cases.map(c=>({id:c.id,classification:c.classification,disposition:c.disposition,reason:c.reason||'Replace with observed evidence and reasoning',duplicateOf:c.duplicateOf}));
 const brief={triage:'Classify each case and suggest evidence-supported duplicate groups. Return a proposal for review; do not apply it.',repair:'Locate a harness or setup defect in the current source checkout. Preserve the original outcome, repair shared helpers when justified, and return the patch, verification evidence and checks needing rerun. Do not turn an app failure into a harness repair without evidence.',repro:'Review the focused selection, exact package and added prerequisites. Describe setup, the tested action, independent assertions, required collectors and cleanup. Do not start execution from this handoff alone.',review:'Review the latest reproduction and draft. Explain whether the evidence supports the reported behavior, what is missing and what a person should inspect. Human confirmation and submission remain separate actions.'}[task];
 const packet={format:'athanor-investigation-task/v1',investigationId:record.id,revision:record.revision,task,caseIds:cases.map(c=>c.id),build:record.baseline.identities,repros:record.repros||[],baselineReport:{runId:record.baseline.runId,url:record.baseline.reportUrl,path:record.baseline.reportPath},brief,cases:cases.map(c=>({id:c.id,title:c.title,classification:c.classification,disposition:c.disposition,expected:c.original.expected,observed:c.original.observation,reason:c.reason,attempts:c.attempts.map(a=>({runId:a.runId,status:a.status,observation:a.observation,definitionChanged:a.definitionChanged,reportUrl:a.reportUrl,diagnosticComplete:a.diagnosticComplete,gaps:a.gaps})),nextAction:caseNextAction(record,c)})),proposalTemplate:{revision:record.revision,actor:'Your agent',updates,log:'Actions taken, evidence inspected and remaining questions'}};
 packet.prompt=`Athanor ${task} task for investigation ${record.id}, revision ${record.revision}.\n${brief}\n\nCases: ${packet.caseIds.join(', ')}\nBuild: ${record.baseline.identities.version}\nPackage: ${record.baseline.identities.packageHash}\nRead the task context, immutable reports and declared evidence. Use investigation evidence --id ${record.id} --case CHECK_ID --server URL for case-owned evidence links; exported tasks are relative to the enclosing investigation package. Cite run/check IDs and evidence files. Preserve Fail, Blocked, Unknown and the first run; incomplete or unreached checks are not app defects.\nUse the current source checkout and docs/investigations.md. Return JSON matching proposalTemplate when proposing triage changes. Its revision must match the current investigation; suggestions are reviewed before application. For repairs return source changes and execution evidence separately.\nNo app launch, rerun, upload, external message, bug submission or Jira publication is authorized by this packet. Unknown mutations require inspection and must not be replayed. A person records final review.\n`;
 return packet;
}

// Read retained report metadata. Artifact requests use the existing hash-checked export routes.
export async function investigationEvidence(record,caseId,dataDir){
 const c=record.cases.find(c=>c.id===caseId);if(!c)throw Error('Investigation case not found.');
 const parent=await realpath(path.join(dataDirectory(dataDir),'exports')),attempts=[];
 for(const entry of [record.baseline,...c.attempts]){
  const root=await realpath(path.dirname(entry.reportPath));
  if(path.dirname(root)!==parent||!/^smoke-report-[a-f0-9-]{36}-[a-f0-9]{12}$/.test(path.basename(root)))throw Error('Report package escaped the local export directory.');
  const report=JSON.parse(await readFile(path.join(root,'report.json'),'utf8'));if(digest(report)!==entry.reportHash)throw Error('Retained investigation report changed.');
  const item=report.cases.find(x=>x.id===caseId);if(!item)throw Error('Retained case is absent from its report.');
  const buffers={};for(const a of item.evidence||[]){if(path.basename(a.file)!==a.file)throw Error('Invalid evidence filename.');if(/diagnostic-[a-f0-9-]+\.json$/.test(a.file)){const file=await realpath(path.join(root,'evidence',a.file));if(!inside(root,file))throw Error('Evidence escaped its report.');const bytes=await readFile(file),proof=report.artifacts.find(x=>x.file===a.file);if(!proof||bytes.length!==proof.bytes||await sha(file)!==proof.sha256)throw Error('Retained diagnostic capture changed.');buffers[a.file]=bytes;}}
  const artifactRoot=entry.artifactRoot||path.join(dataDirectory(dataDir),'runs',entry.runId),url='/exports/'+path.basename(root);
  const evidence=(item.evidence||[]).map(a=>{const proof=report.artifacts.find(x=>x.file===a.file);if(!proof)throw Error('Evidence is absent from the report inventory.');return {...a,url:'/api/investigations/'+encodeURIComponent(record.id)+'/artifact?'+new URLSearchParams({case:caseId,run:entry.runId,file:a.file}),bytes:proof.bytes,sha256:proof.sha256};});
  const captures=diagnosticCaptures(item,report,buffers,artifactRoot),diagnosticComplete=hasDiagnosticEvidence(item,report,buffers,artifactRoot,entry.diagnostics||'standard');
  attempts.push({runId:entry.runId,role:entry===record.baseline?'First run':'Reproduction',status:item.status,observation:item.observation,expected:item.expected,method:item.method,procedure:item.procedure||[],steps:item.steps||[],actions:item.actions||[],definitionHash:item.definitionHash,definitionChanged:entry.definitionChanged||false,recordedAt:entry.recordedAt||null,reportUrl:url+'/index.html#check='+encodeURIComponent(caseId),diagnostics:entry.diagnostics||'standard',diagnosticComplete,gaps:entry.gaps||[],captures,evidence});
 }
 return {caseId,revision:record.revision,attempts,nextAction:caseNextAction(record,c)};
}

export async function verifyReviewEvidence(record,caseId,dataDir){
 const c=record.cases.find(c=>c.id===caseId);if(!c||!bugDraft(record,c).ready)throw Error('Complete diagnostic reproduction and evidence before confirming.');
 const evidence=await investigationEvidence(record,caseId,dataDir);if(!evidence.attempts.at(-1)?.diagnosticComplete)throw Error('Complete the verified diagnostic captures before confirming.');const entry=c.attempts.at(-1),root=await realpath(path.dirname(entry.reportPath)),report=JSON.parse(await readFile(path.join(root,'report.json'),'utf8'));
 for(const proof of report.artifacts){if(path.basename(proof.file)!==proof.file)throw Error('Invalid evidence filename.');const file=await realpath(path.join(root,'evidence',proof.file));if(!inside(root,file))throw Error('Evidence escaped its report.');const bytes=await readFile(file);if(bytes.length!==proof.bytes||await sha(file)!==proof.sha256)throw Error('Retained review evidence changed: '+proof.file);}
}

export async function readInvestigationArtifact(record,caseId,runId,file,dataDir){
 if(typeof file!=='string'||path.basename(file)!==file)throw Error('Invalid evidence filename.');
 const evidence=await investigationEvidence(record,caseId,dataDir),attempt=evidence.attempts.find(a=>a.runId===runId),proof=attempt?.evidence.find(a=>a.file===file);
 if(!proof)throw Error('Evidence is not owned by this case and attempt.');
 const entry=runId===record.baseline.runId?record.baseline:record.cases.find(c=>c.id===caseId)?.attempts.find(a=>a.runId===runId);
 const root=await realpath(path.dirname(entry.reportPath)),source=await realpath(path.join(root,'evidence',file));if(!inside(root,source))throw Error('Evidence escaped its report.');
 const bytes=await readFile(source);if(bytes.length!==proof.bytes||await sha(source)!==proof.sha256)throw Error('Retained evidence changed.');return bytes;
}

// Durable intent before preparation/start. The existing preparation and runner own execution.
export function recordRepro(db,id,input){
 fields(input,['revision','actor','requestId','app']);const previous=investigation(db,id),actor=text(input.actor,'the operator',120);
 if(typeof input.requestId!=='string'||!/^[-A-Za-z0-9]{1,100}$/.test(input.requestId))throw Error('Provide a unique request ID.');
 const app=text(input.app||previous.baseline.identities.app,'the designated app');if(!path.isAbsolute(app))throw Error('Use an absolute app path.');
 const prior=previous.repros?.find(r=>r.requestId===input.requestId);
 if(prior){if(prior.actor!==actor||prior.app!==app)throw Error('Repro request ID was already used with different inputs.');return {record:previous,repro:prior,reused:true};}
 if(input.revision!==previous.revision)throw Error('Investigation changed. Reload before preparing.');const selection=reproSelection(previous);
 if(previous.repros?.some(r=>['Requested','Preparing','Ready','Starting','Running','Unknown'].includes(r.state)))throw Error('Inspect the existing repro attempt before creating another.');
 const next=structuredClone(previous),repro={id:randomUUID(),requestId:input.requestId,preparationId:randomUUID(),selection,app,actor,state:'Requested',createdAt:now()};(next.repros??=[]).push(repro);
 return {record:save(db,previous,next,actor,'Repro requested',{reproId:repro.id}),repro,reused:false};
}
export function updateRepro(db,id,reproId,changes){
 fields(changes,['state','planHash','runId','error','preparation','linkedAt']);const previous=investigation(db,id),next=structuredClone(previous),r=next.repros?.find(r=>r.id===reproId);if(!r)throw Error('Repro attempt not found.');
 const changed=Object.entries(changes).some(([k,v])=>digest(r[k]??null)!==digest(v));if(!changed)return previous;
 Object.assign(r,changes,{updatedAt:now()});return save(db,previous,next,r.actor,'Repro status',{reproId,state:r.state,runId:r.runId||null});
}
export function closeRepro(db,id,input){
 fields(input,['revision','actor','reproId']);const previous=checked(db,id,input),next=structuredClone(previous),r=next.repros?.find(r=>r.id===input.reproId);
 if(!r||r.runId||!['Ready','Failed','Interrupted'].includes(r.state))throw Error('Only an unstarted, settled preparation can be closed. Inspect active or uncertain admission first.');
 r.state='Closed';r.closedAt=now();return save(db,previous,next,input.actor,'Repro selection closed',{reproId:r.id});
}
export async function reconcileRepros(db,id,dataDir,{preparation,request,getRun}){
 let record=investigation(db,id);
 for(const saved of record.repros||[]){
  let r=record.repros.find(x=>x.id===saved.id);
  if(['Requested','Preparing'].includes(r.state)){
   let p;try{p=await preparation(r.preparationId);}catch(e){if(e.code!=='ENOENT')throw e;if(Date.now()-Date.parse(r.createdAt)<15000)continue;record=updateRepro(db,id,r.id,{state:'Unknown',error:'Preparation admission was not retained. Inspect the original request before creating another attempt.'});continue;}
   if(p.id!==r.preparationId||p.app!==r.app||!['Preparing','Ready','Failed','Interrupted'].includes(p.state)){record=updateRepro(db,id,r.id,{state:'Unknown',error:'The retained preparation does not match this repro intent. Inspect its ID, selected app and state before continuing.'});continue;}
   const state=p.state==='Ready'?(p.packageHash===record.baseline.identities.packageHash?'Ready':'Failed'):p.state;
   record=updateRepro(db,id,r.id,{state,preparation:p,...(p.planHash?{planHash:p.planHash}:{}),...(state==='Failed'?{error:p.error||'The prepared package differs from the first run.'}:{})});
  }
  r=record.repros.find(x=>x.id===saved.id);
  if(r.state==='Starting'&&!r.runId){const admitted=request(r.requestId);if(admitted){if(admitted.plan_hash!==r.planHash||admitted.operator!==r.actor)throw Error('Recovered admission differs from the repro intent.');record=updateRepro(db,id,r.id,{state:'Running',runId:admitted.run_id});}}
  r=record.repros.find(x=>x.id===saved.id);
  if(r.runId&&r.state==='Running'){
   const run=getRun(r.runId);if(!run)throw Error('Recorded repro run is unavailable.');
   if(!activeStates.includes(run.execution?.state)){
    if(!record.history.some(h=>h.action==='Reproduction linked'&&h.runId===run.id))record=await linkReproduction(db,id,run,dataDir,{revision:record.revision,actor:r.actor,runId:run.id});
    record=updateRepro(db,id,r.id,{state:'Linked',linkedAt:now()});
   }
  }
 }
 return record;
}
