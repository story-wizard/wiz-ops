import {fileURLToPath} from 'node:url';
import {beginPerformance,endPerformance,performancePolicy} from './performance.mjs';
import {mkdir,cp,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ROOT,dataDirectory,writeJSON,digest} from './files.mjs';
import {checkPrepared} from './prepare.mjs';
import {PackagedEngine,OutcomeError} from './engine.mjs';
import {CaseContext,cases} from './cases.mjs';
import {snapshotSource} from '../kits.mjs';
import {prepareCheckpoint} from '../desktop/checkpoint.mjs';
import {pathToFileURL} from 'node:url';
import {targetFor} from './catalog.mjs';
import {testSpecification} from '../test-details.mjs';
import {connect,execution,updateExecution,record} from './store.mjs';

export async function executeCourse({course,engine,fixtures,onResult,isCancelled=()=>false}){
  let stopReason=null;const outcomes=[];const overallDeadline=Date.now()+course.timeoutSeconds*1000;
  for(const item of course.cases){
    if(stopReason||isCancelled()||Date.now()>=overallDeadline){const note=stopReason||(isCancelled()?'Run stopped by operator.':'Course deadline exceeded.');outcomes.push({id:item.id,status:'Blocked',note});await onResult(item,'Blocked',note);continue;}
    const binding=()=>({pid:engine.child?.pid,processStart:engine.processStart,generation:engine.generation,packageHash:engine.plan?.packageHash});
    const measurement=await beginPerformance(engine.root,item.id,binding());
    engine.caseId=item.id;engine.deadline=Math.min(overallDeadline,Date.now()+(item.timeoutSeconds||course.caseTimeoutSeconds)*1000);await onResult(item,'Running',item.scope);
    try{const note=await cases[item.id](new CaseContext(engine,item.id,fixtures));if(isCancelled())throw new OutcomeError('Run stopped during the check. Inspect the retained project before a new run.','Unknown');outcomes.push({id:item.id,status:'Pass',note});await onResult(item,'Pass',note);}
    catch(error){const status=isCancelled()?'Unknown':error.status||'Fail',note=error.message;outcomes.push({id:item.id,status,note});await onResult(item,status,note);if(status==='Unknown'||item.id==='A-CLI-01'||!engine.child||engine.child.exitCode!==null||engine.child.signalCode)stopReason=`Blocked after ${item.id}: ${note}`;}
    finally{await endPerformance(measurement,binding());}
  }
  return outcomes;
}
async function run(dataDir,runId){
  dataDir=dataDirectory(dataDir);process.env.SMOKE_DATA_DIR=dataDir;
  const db=connect(dataDir),row=execution(db,runId);if(!row)throw new Error('Unknown run ID. Create the run through the dashboard.');
  if(!/^[a-f0-9-]{36}$/.test(runId)||row.artifact_root!==path.join(dataDir,'runs',runId))throw Error('Run artifact root differs from the configured workspace.');
  if(row.state!=='Queued')throw new Error('This run has already been attempted; automatic resume is disabled.');
  let engine,cancelled=false,results=[];const controller=new AbortController();const stop=()=>{cancelled=true;controller.abort();if(engine)void engine.stop();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try{
    updateExecution(db,runId,'Preflight','Verifying package, fixtures, recipe and runner identities.',process.pid);
    const {plan,course,fixtures,schema}=await checkPrepared(dataDir,row.package);if(plan.planHash!==row.plan_hash)throw new Error('Prepared plan differs from the frozen run.');
    if(cancelled)throw new OutcomeError('Stopped before launch.','Blocked');
    await mkdir(row.artifact_root,{recursive:true,mode:0o700});
    const root=await realpath(row.artifact_root);if(root!==row.artifact_root)throw new Error('Run artifact path must not contain symlinks.');
    await writeJSON(path.join(root,'plan.json'),plan);await writeJSON(path.join(root,'course.json'),course);
    const specifications={format:'wizard-smoke-test-specifications/v1',courseHash:plan.courseHash,runnerHash:plan.runnerHash,checks:course.cases.map(testSpecification)};
    await writeJSON(path.join(root,'test-specifications.json'),specifications);
    await cp(path.join(ROOT,'scope/v1-candidate.json'),path.join(root,'scope.json'));
    const sourceHash=await snapshotSource(path.join(root,'source'));
    await writeJSON(path.join(root,'execution-context.json'),{startedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,node:process.version,osRelease:os.release(),operator:db.prepare('SELECT operator FROM runs WHERE id=?').get(runId).operator,sourceHash,testSpecificationsHash:digest(specifications),evidenceMode:course.target,performancePolicy,diagnostics:course.selection?.diagnostics||'standard',runtime:plan.runtime||null,runnerHash:plan.runnerHash});
    await cp(plan.fixtureRoot,path.join(root,'media'),{recursive:true,errorOnExist:true,force:false});
    engine=new PackagedEngine(plan,root,runId,schema);await engine.start();
    updateExecution(db,runId,'Running','Running the local packaged-engine course.',process.pid);
    const onResult=async(item,status,note)=>{record(db,runId,item.id,status,note,path.join(root,'operations.jsonl'));await writeJSON(path.join(root,'progress.json'),{runId,target:course.target,updatedAt:new Date().toISOString(),results:db.prepare('SELECT test_id,status,note FROM results WHERE run_id=?').all(runId)});};
    results=await executeCourse({course:{...course,cases:course.cases.filter(c=>targetFor(c.id)==='packaged')},engine,fixtures,isCancelled:()=>cancelled,onResult});
    await engine.stop();
    if(results.some(r=>r.status==='Unknown'))throw new OutcomeError('Uncertain packaged outcome; later stages were not started.','Unknown');
    if(results.some(r=>r.id==='A-CLI-01'&&r.status!=='Pass'))throw new OutcomeError('Connection prerequisite did not pass.','Blocked');
    const {executeStages}=await import(pathToFileURL(path.join(root,'source/runner/stages.mjs')).href);
    if(course.cases.some(c=>targetFor(c.id)!=='packaged'))results.push(...await executeStages({plan,course,root,dataDir,onResult,isCancelled:()=>cancelled,signal:controller.signal,onStage:(target,count)=>updateExecution(db,runId,'Running',`Running ${target} stage: ${count} selected checks.`,process.pid)}));
    if(course.checkpoint&&!cancelled){await prepareCheckpoint(db,runId,dataDir);return;}
    const state=results.some(r=>r.status==='Unknown')?'Unknown':results.some(r=>r.status==='Fail')?'Failed':results.some(r=>r.status==='Blocked')?'Blocked':'Passed';
    const note=`${results.filter(r=>r.status==='Pass').length}/${course.cases.length} selected checks passed. ${Object.keys(course.deferred).length} candidates remain outside this course. Scope: ${course.target}.`;
    await writeJSON(path.join(root,'report.json'),{runId,state,scope:course.scope,planHash:plan.planHash,packageHash:plan.packageHash,fixtureHash:plan.fixtureHash,courseRevision:course.revision,results,deferred:course.deferred,completedAt:new Date().toISOString()});
    updateExecution(db,runId,state,note);console.log(JSON.stringify({runId,state,note}));if(state!=='Passed')process.exitCode=1;
  }catch(error){
    const pending=db.prepare("SELECT test_id,status FROM results WHERE run_id=? AND status IN ('Running','Not run')").all(runId);
    const status=error.status==='Unknown'||pending.some(r=>r.status==='Running')?'Unknown':error.status==='Fail'||db.prepare("SELECT 1 FROM results WHERE run_id=? AND status='Fail'").get(runId)?'Failed':'Blocked';
    for(const r of pending)record(db,runId,r.test_id,r.status==='Running'?'Unknown':'Blocked',error.message,'');
    updateExecution(db,runId,status,error.message);
    try{await writeJSON(path.join(row.artifact_root,'report.json'),{runId,state:status,error:error.message,planHash:row.plan_hash,package:row.package,course:row.recipe,results:db.prepare('SELECT test_id,status,note FROM results WHERE run_id=?').all(runId),completedAt:new Date().toISOString()});}catch(reportError){console.error(`Could not save failure report: ${reportError.message}`);}
    console.error(error.message);process.exitCode=1;
  }
  finally{if(engine)await engine.stop();process.off('SIGTERM',stop);process.off('SIGINT',stop);db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  if(!process.argv.includes('--execute')||!arg('--run-id')){console.error('Use the dashboard to create and explicitly start a frozen course. This command requires --execute --run-id ID.');process.exitCode=2;}
  else await run(dataDirectory(arg('--data-dir')),arg('--run-id'));
}
