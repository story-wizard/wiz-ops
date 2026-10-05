import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {withAgentAction,markUnknown} from './agent-proof.mjs';
import {fileURLToPath} from 'node:url';
import {readBugReporterParcel} from '../bug-reporter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {nativeCall} from './adapter.mjs';
import {waitForObservation} from './check-support.mjs';
import {OutcomeError} from '../runner/engine.mjs';

// Opening this tool is an explicit GUI action. No launch, resume, Submit, retry or discard path.
export async function prefillReporter(file,parcelFile,call=nativeCall){
 try{return await withAgentAction(file,()=>prefillOwned(file,parcelFile,call),{operation:'bug-report-prefill',params:{parcelFile}});}
 catch(e){if(e.status==='Unknown')await markUnknown(file,e);throw e;}
}
async function prefillOwned(file,parcelFile,call){
 const parcel=await readBugReporterParcel(parcelFile),s=await readJSON(file);
 const block=message=>{throw new OutcomeError(message,'Blocked');};
 if(s.state!=='Running'||s.inputMode==='service'||s.plan?.packageHash!==parcel.source.packageHash||s.bundle!==parcel.source.project)block('Use a running owned session on the parcel’s exact build and reproduction project.');
 const capability=await call(file,'capabilities');
 if(!capability.operations?.includes('bug-report-prefill'))block('Prepare this build with the updated Athanor attachment plugin.');
 const dialog=ui=>{const matches=ui.widgets.filter(w=>w.name==='BugReportDialog'&&w.id===w.window);if(matches.length>1)block('Multiple Report Bug dialogs are visible.');return matches[0];};
 let ui=await call(file,'inspect'),window=dialog(ui);
 if(!ui.widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(s.bundle)+' — Wizard')))block('The owned editor is showing a different project.');
 if(!window){const actions=ui.actions.filter(a=>a.enabled&&/^Report Bug(?:…|\.\.\.)?$/.test(a.text.replaceAll('&','')));if(actions.length!==1)block('No unique Report Bug action is available in this build.');await call(file,'action',{target:actions[0].id});
  window=await waitForObservation(async()=>dialog(await call(file,'inspect')),{description:'Report Bug dialog',timeoutMs:10000});
 }
 // Wait for app-owned diagnostics/screenshot collection; never overwrite a recovered pending report.
 await waitForObservation(async()=>{
  const observed=await call(file,'inspect');const current=dialog(observed);if(!current||current.id!==window.id)block('Report Bug dialog changed during preparation.');
  const controls=['BugReportSummary','BugReportSteps','BugReportExpected'].map(name=>observed.widgets.filter(w=>w.window===window.id&&w.name===name));
  if(controls.some(rows=>rows.length!==1))block('Reporter field controls are absent or ambiguous.');
  return controls.every(rows=>rows[0].enabled&&rows[0].editableText);
 },{description:'Report Bug draft is editable',timeoutMs:10000});
 const current=await readJSON(file);if(current.pid!==s.pid||current.generation!==s.generation||current.bundle!==s.bundle||current.plan?.packageHash!==s.plan.packageHash)block('Session identity changed before reporter prefill.');
 const readback=await call(file,'bug-report-prefill',{target:window.id,...parcel.fields});
 if(readback.submitted!==false||readback.state!=='Prefilled'||Object.entries(parcel.fields).some(([key,value])=>readback[key]!==value))throw new OutcomeError('Reporter field readback differs; inspect the dialog before continuing.','Unknown');
 const receipt={format:'athanor-bug-reporter-prefill/v1',at:new Date().toISOString(),state:'Prefilled',reportId:parcel.reportId,source:parcel.source,pid:s.pid,generation:s.generation,dialog:window.id,fields:readback,delivery:'not_submitted',attachments:'Retained in parcel; current app has no attachment importer'};
 const receiptPath=path.join(s.root,'bug-reporter-prefill-'+randomUUID()+'.json');await writeJSON(receiptPath,receipt);await appendFile(path.join(s.root,'operations.jsonl'),JSON.stringify({caseId:parcel.source.caseId,operation:'bug-report.prefill',at:receipt.at,status:'Completed',evidence:{artifacts:[receiptPath]}})+'\n');return {...receipt,receiptPath};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [file,parcel,...extra]=process.argv.slice(2);if(!file||!parcel||extra.length)throw Error('Usage: node desktop/bug-reporter.mjs SESSION.json /absolute/handoff.json');console.log(JSON.stringify(await prefillReporter(file,parcel),null,2));}
 catch(e){console.log(JSON.stringify({status:e.status||'Blocked',error:e.message,delivery:'not_submitted'}));process.exitCode=e.status==='Unknown'?5:3;}
}
