import path from 'node:path';
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {ROOT,digest,dataDirectory,inside} from './runner/files.mjs';
import {methods,procedures} from './explainer/notes.mjs';
import {rawChecks,fullSmokeCourse} from './runner/catalog.mjs';
import {volumeContract} from './desktop/volume-contract.mjs';

export function evidenceSpec(check){
 const spec=check.evidence||[{id:'operations',kind:'json',when:'during',required:true,caption:'Requests and independent state observations recorded by the application adapter.'}];
 const ids=new Set();
 for(const item of spec){
  if(!item||!/^[a-z][a-z0-9-]*$/.test(item.id||'')||ids.has(item.id)||!['image','video','audio','json'].includes(item.kind)||!['before','during','after','failure'].includes(item.when)||typeof item.required!=='boolean'||typeof item.caption!=='string'||!item.caption.trim())throw Error('Invalid evidence specification for '+check.id);
  ids.add(item.id);
 }
 return spec;
}
export function testSpecification(check){
 return {id:check.id,title:check.title,definitionHash:check.definitionHash||digest(check),method:methods[check.id]||check.scope||check.expected,expected:check.expected,steps:(check.steps||[]).filter(s=>s&&typeof s==='object'&&s.id&&s.title),procedure:(check.steps||procedures[check.id]||[]).filter(s=>typeof s==='string'),evidence:evidenceSpec(check),...(check.proof?{proof:volumeContract(check)}:{})};
}
export function candidateChecks(){return ['desktop/physical-course.json','desktop/physical-editor-course.json'].flatMap(file=>JSON.parse(readFileSync(path.join(ROOT,file),'utf8')).cases.filter(c=>!rawChecks.some(r=>r.id===c.id)).map(c=>({...c,definitionHash:digest(c),accepted:false,candidateCourse:file.includes('physical-editor')?'editor':'spellbook'})));}
const words=value=>String(value||'').replaceAll('_',' ').replace(/\./g,' / ');
const names={
 'diagnostic.capture':'Collect the investigation screenshot, editor state and logs',
 'project.create':'Create the disposable test project','project.get_name':'Read the project name','project.checkpoint':'Save the project',
 'timeline.create':'Create a test timeline','timeline.inspect':'Read clips, tracks and exact timing','timeline.place_cuts':'Place fixture clips on the timeline',
 'media.list_assets':'Read the media library','media.import':'Import the fixture media','graph.get_clip_graph':'Read the clip’s nodes and connections',
 'graph.insert_on_edge':'Insert an effect into the clip graph','graph.disconnect_edge':'Disconnect the selected graph ports','playback.seek':'Seek the preview',
 'inspect':'Observe the editor controls','snapshot-presented':'Capture the displayed preview','screenshot':'Capture the owned app window',
 'activate':'Focus the test window','key':'Send a keyboard shortcut','click':'Click the observed control','drag':'Drag between observed controls',
 'clipboard-save':'Preserve the system clipboard','clipboard-restore':'Restore the system clipboard'
};
export function actionHistory(operations=[],native=[],input=[]){
 const rows=[...operations.filter(r=>r.operation!=='check.observation').map(r=>({...r,op:r.operation,channel:'Application'})),...native.map(r=>({...r,op:r.request?.op,params:r.request,channel:'Editor adapter'})),...input.map(r=>({...r,op:r.command||r.input?.command,params:r.input,channel:'macOS input'}))];
 return rows.sort((a,b)=>String(a.startedAt||a.at||'').localeCompare(String(b.startedAt||b.at||''))).map((r,i)=>{
  let envelope=r.response;try{if(!envelope&&r.stdout)envelope=JSON.parse(r.stdout);}catch{}
  const uncertain=r.status==='Unknown'||r.timedOut||r.signal||r.error&&!envelope;
  const rejected=envelope?.ok===false||['Blocked','Rejected'].includes(r.status);
  const expected=rejected&&r.expectedError&&envelope?.error?.code===r.expectedError;
  return {id:'action-'+(i+1),stepId:r.stepId||null,title:names[r.op]||words(r.op)||'Recorded native input',operation:r.op,channel:r.channel,at:r.startedAt||r.at||null,durationMs:r.durationMs??null,
   status:uncertain?'Unknown':expected?'Expected rejection':rejected?'Rejected':envelope?.ok===true||r.status==='Completed'?'Completed':'Recorded',
   detail:r.params?.key||r.params?.name||r.params?.text||'',receiptSequence:r.sequence||null};
 });
}
export function stepHistory(spec,events=[],actions=[]){
 return (spec.steps||[]).map(step=>{
  const records=events.filter(e=>e.stepId===step.id),terminal=records.at(-1)?.status==='Running'?null:records.findLast(e=>e.status!=='Running'),start=records.find(e=>e.status==='Running'),observed=actions.filter(a=>a.stepId===step.id);
  return {...step,status:terminal?.status||(start?'Unknown':observed.length?'Observed':'Not run'),startedAt:start?.at||observed[0]?.at||null,finishedAt:terminal?.at||null,observation:terminal?.observation||'',actionCount:observed.length};
 });
}
export function evidenceCaption(file){
 const name=path.basename(file).replace(/^computer-use-[a-f0-9]{12}-/,'');
 if(/^P-RG-.*-before\./.test(name))return 'Render Graph before the tested action.';
 if(/^P-RG-.*-after\./.test(name))return 'Render Graph after the tested action.';
 if(/^P-RG-.*-undo\./.test(name))return 'Render Graph after Undo restored the original graph.';
 if(/^D-SEARCH-FOCUS.*graph-observations/.test(name))return 'Project search results and timeline focus for each query.';
 if(/^D-SCOPES-VECTOR.*graph-observations/.test(name))return 'Vectorscope taps, frame positions and measured image differences.';
 if(/^D-SCOPES-VECTOR.*source-5/.test(name))return 'Presented preview at five seconds: the known black gap.';
 if(/^D-SCOPES-VECTOR.*source-1/.test(name))return 'Presented preview at one second: the known colour plate.';
 if(/^D-SCOPES-VECTOR.*-before\./.test(name))return 'Vectorscope trace while the preview shows the black gap.';
 if(/^D-SCOPES-VECTOR.*-after\./.test(name))return 'Vectorscope trace after seeking to the colour plate.';
 if(/^D-PROJECT.*graph-observations-quit/.test(name))return 'Normal Quit dispatch and the acknowledgment from the owned app process.';
 if(/^D-(PROJECT|PREFERENCES-PROJECTLESS).*graph-observations/.test(name))return 'Project identity, stored content and observed Preferences pages used by the assertion.';
 if(/^D-(PROJECT|PREFERENCES-PROJECTLESS).*-before\./.test(name))return 'Starting project before the tested workflow.';
 if(/^D-(PROJECT|PREFERENCES-PROJECTLESS).*reopened/.test(name))return 'Project content after reopening in a fresh app process.';
 if(/^D-PREFERENCES-PROJECTLESS.*preferences\./.test(name))return 'Application Preferences opened without a project.';
 if(/graph-observations/.test(name))return 'Before and after graph state, including the tested node or connection.';
 if(/-before\./.test(name))return 'Displayed preview before the gesture.';
 if(/-undo\./.test(name))return 'Displayed preview after Undo restored the baseline.';
 if(/-sample-(\d+)/.test(name))return 'Preview sampled during the held gesture, sample '+(Number(name.match(/-sample-(\d+)/)[1])+1)+'.';
 if(/live-observations/.test(name))return 'Before and after graph state, gesture timings and preview samples.';
 if(/rejection/.test(name))return 'The app’s rejection message and the action that triggered it.';
 if(/failure/.test(name))return 'App state when the check failed.';
 if(/preview-clip/.test(name))return 'Sampled preview sequence from the held gesture.';
 if(/native-.*-request/.test(name))return 'Native input request, including verified window and coordinates.';
 if(/native-.*-receipt/.test(name))return 'Native input result and process identity.';
 if(/native-.*\.png/.test(name))return 'Owned app window captured during this check.';
 return words(name.replace(/\.[^.]+$/,''));
}
export const mediaKind=file=>/\.(png|jpe?g|gif)$/i.test(file)?'image':/\.(mp4|mov|webm)$/i.test(file)?'video':/\.(wav|mp3|m4a|aac)$/i.test(file)?'audio':'json';
export function evidenceItems(files=[],spec=null,defaultWhen='after'){return files.map(file=>{const kind=mediaKind(file),when=/-before\./.test(file)?'before':/-sample-\d+|preview-clip|live-observations/.test(file)?'during':/-failure|rejection/.test(file)?'failure':/-undo\.|-after\.|graph-observations/.test(file)?'after':defaultWhen;const match=spec?.evidence.find(e=>e.id!=='operations'&&e.kind===kind&&e.when===when&&(e.id!=='preview-clip'||file.includes('preview-clip'))&&(e.id!=='graph-state'||file.includes('graph-observations')));return {file,kind,when,caption:evidenceCaption(file),specId:match?.id||null};});}
export function evidenceCoverage(spec,items=[],actions=[],outcome){
 return spec.evidence.map(e=>({...e,status:(e.id==='operations'?actions.length>0:items.some(a=>a.specId===e.id))?'Collected':outcome==='Blocked'&&e.when!=='failure'?'Not reached':e.required?'Missing':'Optional'}));
}
export function sourcePointers(id,root=ROOT){
 const found=[];
 for(const folder of ['runner','desktop'])for(const file of readdirSync(path.join(root,folder)).filter(n=>n.endsWith('.mjs'))){
  const relative=folder+'/'+file,source=readFileSync(path.join(root,relative),'utf8'),at=source.indexOf("'"+id+"'");
  if(at>=0)found.push({file:relative,line:source.slice(0,at).split('\n').length});
 }
 return found;
}
export function agentPrompt(spec,{root=ROOT,runId=null,outcome=null,sources=sourcePointers(spec.id,root),accepted=false}={}){
 const locations=sources.map(s=>path.join(root,s.file)+':'+s.line).join('\n');
 return `Edit smoke check ${spec.id}: ${spec.title}\n\nRequested change: [describe the change here]\n\nReference workspace: ${root}\nDefinition hash: ${spec.definitionHash}\n${runId?'Reference run: '+runId+'\nObserved outcome: '+(outcome||'See retained report')+'\n':''}\nExpected behavior: ${spec.expected}\nMethod: ${spec.method}\n\nRead these implementation locations and their shared helpers:\n${locations||'Locate this ID in runner/course.json or desktop/*course.json.'}\nWork in a source checkout. Compare the reference definition with the current check before editing; preserve frozen run snapshots. Read AGENTS.md and docs/test-evidence.md. Keep setup, action, independent verification and cleanup distinct. Use CLI/Oz operations, the Qt adapter or verified native input as the path requires.\n\nDeclare needed images, video, audio and JSON in the test’s evidence specification. Give each artifact a purpose and connect it to the step that collected it. Preserve Fail, Blocked and Unknown. Never replay an uncertain mutation.\n\nRun node --test --test-concurrency=1 tests/*.test.mjs. Prove a focused behavioral assertion rejects incorrect state, then prepare a new plan for the changed test on an authorized disposable app. Preserve prior runs. ${accepted?'This definition was accepted; a changed definition needs lead review before entering custom courses again.':'This is a candidate; submit it for lead review before adding it to the accepted course.'}\n\nReturn the code change, readable steps, evidence collected and remaining coverage gaps. Do not publish issues or reports without the user’s request.`;
}
export function agentContext(check,options={}){
 const spec=options.specification||testSpecification(check),root=options.root||ROOT,sources=options.sources||sourcePointers(check.id,root);
 const physicalCourse=check.candidateCourse||(check.id.startsWith('P-')?(check.id.startsWith('P-SB-')?'spellbook':'editor'):null);
 const qualifiedCandidate=!options.accepted&&!physicalCourse&&fullSmokeCourse().qualificationChecks.includes(check.id);
 const selection=qualifiedCandidate?{courseIds:['smoke-full'],subsetIds:[check.id],project:'fresh',title:check.title}:{checkIds:[check.id],project:'fresh',title:check.title};
 const port=options.servicePort===undefined?null:Number(options.servicePort);if(port!==null&&(!Number.isInteger(port)||port<1||port>65535))throw Error('Choose a valid local service port.');
 const context={format:'wizard-smoke-agent-context/v1',check:spec,sources,selection,accepted:options.accepted||false,runId:options.runId||null,prompt:agentPrompt(spec,{...options,root,sources}),repairPrompt:'Repair Athanor for this build or feature: [identity]. Intended course or checks: [selection]. Failure or missing behavior: [observation]. Work in the current source checkout and read AGENTS.md and docs/build-repair.md. Compare the actual contract with the mapped baseline. Qualify only reviewed schema hashes; update affected requests and independent assertions when behavior changes. Add new feature checks as candidates for lead acceptance. Validate preparation and authorized focused checks. Preserve frozen runs, Fail, Blocked and Unknown, and never replay an uncertain mutation. Commit and build a new versioned bundle. Return the cause, changes, evidence and remaining work.',guides:['docs/functional-testing-agent.md','docs/agent-sequences.md','docs/agent-workflows.md','docs/media-procedure.md','docs/golden-project-intake.md','docs/harness-control.md','docs/investigations.md','AGENTS.md','docs/changes-2026-10-02.md','docs/computer-use-agent.md','docs/agent-tools.md','docs/desktop-tools-setup.md','docs/agent-courses.md','docs/interaction-library.md','docs/test-evidence.md','docs/source-handoff.md','docs/maintaining-harness.md','docs/build-finder.md','docs/shared-build-catalog.md','docs/demo-guide.md','examples/agent-onboarding.txt','docs/build-repair.md'],
  commands:{schemaReview:'"/path/to/Wizard.app/Contents/MacOS/wiz-cli" project create --schema --no-spawn',discover:'node scripts/smoke.mjs setup',plan:`node scripts/smoke.mjs plan --app /path/to/Wizard.app --checks ${!options.accepted?'D-CLI-01':check.id} --out /tmp/smoke-plan.json`,run:physicalCourse?`node scripts/probe-physical.mjs --course ${physicalCourse} --plan /tmp/smoke-plan.json --checks ${check.id}`:!options.accepted?'node desktop/session.mjs start --plan /tmp/smoke-plan.json':'node scripts/smoke.mjs run --plan /tmp/smoke-plan.json --operator "Your name" --wait',context:`node scripts/smoke.mjs context --check ${check.id}`}};
 if(qualifiedCandidate){
  context.commands.plan='node scripts/smoke.mjs plan --app /path/to/Wizard.app --file /tmp/smoke-selection.json --out /tmp/smoke-plan.json';
  context.commands.run='node scripts/smoke.mjs run --plan /tmp/smoke-plan.json --operator "Your name" --wait';
  context.selectionInstructions='Save the supplied selection JSON as /tmp/smoke-selection.json before planning. This selects only the maintained candidate and its prerequisites; it does not accept the definition.';
 }
 if(port!==null){context.serviceUrl='http://127.0.0.1:'+port;for(const key of Object.keys(context.commands))if(context.commands[key].startsWith('node scripts/smoke.mjs '))context.commands[key]+=' --server '+context.serviceUrl;}
 return context;
}
export async function exportAgentContext(check,dataDir,options={}){
 const context=agentContext(check,options),root=options.root||ROOT,contents={'context.json':JSON.stringify(context,null,2)+'\n','definition.json':JSON.stringify(check,null,2)+'\n','EDIT-PROMPT.txt':context.prompt+'\n','BUILD-REPAIR-PROMPT.txt':context.repairPrompt+'\n','selection.json':JSON.stringify(context.selection,null,2)+'\n'};
 contents['START-HERE.md']=`# Athanor agent context\n\nCheck: ${check.id} - ${check.title}\n${context.runId?'Frozen reference run: '+context.runId:'Current definition'}\n\n1. Read context.json for the expected behavior, method, evidence requirements and implementation locations.\n2. Read reference/AGENTS.md and reference/docs/agent-tools.md. Reference files are retained copies; make edits in a source checkout. Preserve this pack and earlier run evidence.\n3. Ask the user for the desired change, or use EDIT-PROMPT.txt with their request. For a focused run, use the commands below from a configured source checkout.\n\n## Focused execution\n\n${context.selectionInstructions||''}\n\n${Object.entries(context.commands).filter(([key])=>key!=='context').map(([key,value])=>'### '+key+'\n\n'+value+'\n').join('\n')}\nChoose the build path and confirm local testing is authorized before launching the app. Candidate definitions require lead review before entering accepted courses. Keep Fail, Blocked and Unknown; inspect an uncertain mutation before any further action.\n\n## Build or feature repair\n\nUse BUILD-REPAIR-PROMPT.txt and reference/docs/build-repair.md when a new build cannot prepare or a feature changes the mapping. Repair in the current source checkout; preserve this reference pack and frozen runs.\n\n## Shared tools\n\nreference/docs/interaction-library.md describes application operations, the editor adapter and verified native input. reference/docs/test-evidence.md describes step recording and image, video, audio and JSON evidence. Reuse these components when remixing a check.\n\nmanifest.json records the definition and SHA-256 of every included file.\n`;
 for(const file of [...context.guides,...new Set(context.sources.map(s=>s.file)), 'desktop/agent-task.mjs','desktop/agent-plan.mjs','desktop/agent-recipes.mjs','desktop/agent-connection.mjs','desktop/plan-bindings.mjs','desktop/ui-query.mjs','desktop/checklist-proof.mjs','desktop/project-proof.mjs','desktop/volume-proof.mjs','desktop/volume-contract.mjs','desktop/volume-agent-proof.mjs','desktop/ui-workflows.mjs','desktop/ui-cohort-proof.mjs','desktop/ingest-fixture.mjs','desktop/recorder.mjs','runner/interactions.mjs','runner/engine.mjs','runner/prepare.mjs','runner/contracts/installed-schema.json','runner/contracts/packaged-schema-qualifications.json','runner/contracts/desktop-schema.json','desktop/adapter.mjs','desktop/agent-tools.mjs','desktop/agent-proof.mjs','desktop/editor-proof.mjs','desktop/check-support.mjs','desktop/physical-input.mjs','desktop/macos-input.mjs']){
  let full;try{full=realpathSync(path.join(root,file));}catch(e){if(e.code==='ENOENT')continue;throw e;}if(!inside(realpathSync(root),full))throw Error('Context source escaped the workspace.');contents['reference/'+file]=readFileSync(full);
 }
 const inventory=Object.entries(contents).map(([file,bytes])=>({file,bytes:Buffer.byteLength(bytes),sha256:digest(Buffer.isBuffer(bytes)?bytes.toString():bytes)}));
 const manifest={format:'wizard-smoke-agent-pack/v1',checkId:check.id,definitionHash:context.check.definitionHash,runId:context.runId,inventory};
 const parent=path.join(dataDirectory(dataDir),'agent-context'),name=check.id+'-'+digest(manifest).slice(0,12),destination=path.join(parent,name);await mkdir(parent,{recursive:true});const temp=await mkdtemp(path.join(parent,'.context-'));
 try{for(const [file,bytes]of Object.entries(contents)){await mkdir(path.dirname(path.join(temp,file)),{recursive:true});await writeFile(path.join(temp,file),bytes);}await writeFile(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');try{await rename(temp,destination);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;}}
 finally{await rm(temp,{recursive:true,force:true});}
 return {path:destination,manifest:path.join(destination,'manifest.json'),checkId:check.id,definitionHash:context.check.definitionHash};
}
