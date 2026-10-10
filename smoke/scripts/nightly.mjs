import path from 'node:path';
import {readFile,writeFile,mkdir,stat,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ROOT,externalPath,sha} from '../runner/files.mjs';
import {createNightlyPlan,consolidateNightly,nightlyHTML,blockedPreparationReport} from '../runner/nightly.mjs';
import {checkRegistry,resolveSelection} from '../runner/catalog.mjs';
import {client} from './smoke.mjs';

async function input(file){if((await stat(file)).size>1024*1024)throw Error('Nightly input exceeds 1 MiB.');return JSON.parse(await readFile(file,'utf8'));}
export async function main(args){
 const command=args.shift(),flags={};for(let i=0;i<args.length;i++){const key=args[i],value=args[++i];if(!key?.startsWith('--')||Object.hasOwn(flags,key)||!value||value.startsWith('--'))throw Error('Invalid Nightly option.');flags[key]=value;}
 const allowed={plan:['--courses','--suite','--mapping','--build','--package-hash','--changes','--proposals','--cadence','--out','--server'],blocked:['--preparation','--build','--suite','--out','--server'],report:['--plan','--run','--observations','--out','--server']};
 if(!allowed[command]||Object.keys(flags).some(k=>!allowed[command].includes(k)))throw Error('Usage: nightly plan --build VERSION --package-hash HASH --out FILE [--courses IDS] | report --plan FILE --run RUN_ID --out NEW_DIR [--observations FILE], with --server URL. See docs/workers.md.');
 const required=k=>{if(!flags[k])throw Error('Required option: '+k);return flags[k];},call=client(required('--server')),output=externalPath(path.resolve(required('--out')));
 if(command==='blocked'){
  const [job,catalog,worker]=await Promise.all([call('/api/preparations/'+encodeURIComponent(required('--preparation'))),call('/api/checks'),call('/api/worker')]);
  if(worker.sourceMatches!==true)throw Error('The service source changed; preserve the blocked preparation and inspect its source.');
  const selection=resolveSelection({},job.selection),report=blockedPreparationReport(job,await input(flags['--suite']||path.join(ROOT,'examples/nightly/suite.json')),catalog.checks,{build:required('--build'),runnerHash:worker.sourceHash,dataDir:worker.dataDir},selection);
  await mkdir(output,{recursive:false});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});await writeFile(path.join(output,'index.html'),nightlyHTML(report),{flag:'wx',mode:0o600});
  return {path:output,preparationId:job.id,executionStarted:false,state:'Blocked',delivery:'LOCAL_ONLY'};
 }
 if(command==='plan'){
  const suite=await input(flags['--suite']||path.join(ROOT,'examples/nightly/suite.json')),mappings=await input(flags['--mapping']||path.join(ROOT,'examples/nightly/mapping.json'));
  const [catalog,worker]=await Promise.all([call('/api/checks'),call('/api/worker')]);
  if(worker.sourceMatches!==true)throw Error('The service source changed; restart the qualified version before planning.');
  const courseIds=flags['--courses']?flags['--courses'].split(',').map(s=>s.trim()):['smoke-full','macos-regression'];
  if(!courseIds.length||new Set(courseIds).size!==courseIds.length||courseIds.some(id=>!['smoke-full','macos-regression','smoke-isolated','automated-full','packaged-full'].includes(id)))throw Error('Choose distinct maintained course IDs for --courses.');
  const selection=resolveSelection({},{courseIds,desktopMode:courseIds.includes('smoke-isolated')?'isolated':'grouped'}),local=new Map(checkRegistry().map(c=>[c.id,c.definitionHash])),remote=new Map(catalog.checks.map(c=>[c.id,c.definitionHash]));
  if(selection.effectiveIds.some(id=>remote.get(id)!==local.get(id)))throw Error('Local course definitions differ from the service catalog; plan from its matching checkout.');
  const plan=createNightlyPlan(suite,[...catalog.checks,...(catalog.candidates||[])],{build:required('--build'),packageHash:required('--package-hash'),runnerHash:worker.sourceHash,dataDir:worker.dataDir,releaseChanges:flags['--changes']?await input(flags['--changes']):[]},mappings,{cadence:flags['--cadence']||'nightly',proposals:flags['--proposals']?await input(flags['--proposals']):undefined,executionSelection:selection});
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  return {path:output,planHash:plan.planHash,cadence:plan.cadence,catalogCheckCount:plan.catalogInventory.length,caseCount:plan.cases.length,assertionCount:plan.cases.reduce((n,c)=>n+c.assertions.length,0),assertionSupport:plan.cases.flatMap(c=>c.assertions).reduce((n,a)=>(n[a.support.coverage]=(n[a.support.coverage]||0)+1,n),{}),selectedCheckCount:plan.execution.selection.effectiveIds.length,releaseProposalCount:plan.releaseTestProposals.length,executionStarted:false};
 }
 const plan=await input(required('--plan')),run=await call('/api/runs/'+encodeURIComponent(required('--run'))),observations=flags['--observations']?await input(flags['--observations']):{};
 const report=await consolidateNightly(plan,run,observations);
 await mkdir(output,{recursive:false});await mkdir(path.join(output,'evidence'));
 const copied=new Set();for(const c of report.cases)for(const a of c.assertions)for(const e of a.evidence||[]){
  if(copied.has(e.relativePath))continue;const destination=path.join(output,e.relativePath);await copyFile(e.path,destination,constants.COPYFILE_EXCL);if(await sha(destination)!==e.sha256)throw Error('Evidence changed while exporting. Preserve this incomplete export and inspect before retrying.');copied.add(e.relativePath);
 }
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});await writeFile(path.join(output,'index.html'),nightlyHTML(report),{flag:'wx',mode:0o600});
 return {path:output,runId:run.id,cases:report.caseCounts,assertions:report.assertionCounts,catalog:report.catalog.counts,delivery:'LOCAL_ONLY'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify({format:'athanor-nightly-cli/v1',result:await main(process.argv.slice(2))},null,2));}
 catch(error){console.error(JSON.stringify({format:'athanor-nightly-cli/v1',error:error.message}));process.exitCode=3;}
}
