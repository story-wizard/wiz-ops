import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {mkdir,realpath,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';

export async function speechModelIdentity(directory=path.join(homedir(),'.cache/huggingface/hub/models--FluidInference--parakeet-tdt-0.6b-v2-coreml/snapshots/ee09c569f73759e6d44c9bd16766f477b2b36d39')){
  for(const name of ['Encoder.mlmodelc','Decoder.mlmodelc','Preprocessor.mlmodelc','JointDecision.mlmodelc','parakeet_vocab.json'])await access(path.join(directory,name));
  const identity=await fingerprint(directory,{followFileLinks:true});return {directory,sha256:identity.sha256,files:identity.files,model:'FluidInference/parakeet-tdt-0.6b-v2-coreml',revision:path.basename(directory)};
}

import {ROOT,dataDirectory,readJSON,writeJSON,fingerprint,digest,sha,inside} from './files.mjs';
import {localBuilds,assertBuildIdentity} from '../builds.mjs';
import {sourceProvenance} from './source-provenance.mjs';
import {prepareFixtures,validateFixtures} from './fixtures.mjs';
import {ingestPython,validateIngestProfile} from './ingest.mjs';
import {selectedBuildRuntime,verifyRuntime,assertSelectedRuntime} from './runtime.mjs';
import {selectedRecipe,validateRecipe,requirementsFor} from './catalog.mjs';

import {assertMappedPackagedSchema} from './schema-compatibility.mjs';
export {assertMappedPackagedSchema};
export async function sourceIdentity(){return digest([(await fingerprint(path.join(ROOT,'runner'))).sha256,(await fingerprint(path.join(ROOT,'desktop'))).sha256,await sha(path.join(ROOT,'test-details.mjs')),await sha(path.join(ROOT,'explainer/notes.mjs'))]);}
export async function checkPrepared(dataDir=dataDirectory(),frozenPlan){
  dataDir=dataDirectory(dataDir);
  let plan=frozenPlan;
  if(!plan)try{plan=await readJSON(path.join(dataDir,'prepared.json'));}catch(e){if(e.code==='ENOENT')throw Error('Choose a build and test course, then prepare them before checking readiness.');throw e;}
  const {planHash,...content}=plan;if(digest(content)!==planHash)throw new Error('Prepared plan is corrupt. Prepare again.');
  if(await sourceIdentity()!==plan.runnerHash)throw new Error('Runner changed since preparation. Prepare again.');
  if(plan.runtime){
    assertSelectedRuntime(plan.runtime,plan.app,plan.packageHash);await verifyRuntime(plan.runtime,dataDir);
    const qualification=plan.attachmentQualification;
    if(!qualification||qualification.packageHash!==plan.packageHash||qualification.toolHash!==plan.runtime.bridgeHash||!inside(dataDir,qualification.receipt)||await sha(qualification.receipt)!==qualification.receiptHash)throw Error('Selected-build attachment evidence changed or is missing. Prepare again.');
  }
  const course=plan.recipe||await readJSON(path.join(ROOT,'runner/course.json'));
  validateRecipe(course);
  if(digest(course)!==plan.courseHash)throw new Error('Course changed since preparation.');
  const fixtures=await validateFixtures(plan.fixtureRoot);if(fixtures.sha256!==plan.fixtureHash)throw new Error('Fixtures changed since preparation.');
  if(requirementsFor(course.cases.map(c=>c.id),course.checkpoint).speechModel&&(!plan.speechModel||(await speechModelIdentity(plan.speechModel.directory)).sha256!==plan.speechModel.sha256))throw new Error('Cached speech model changed or is missing. Prepare again; downloads are disabled.');
  const pkg=await fingerprint(plan.app,{packageTree:true});if(pkg.sha256!==plan.packageHash)throw new Error('Wizard package changed since preparation. Prepare against the intended package again.');
  await access(ingestPython(plan.app),constants.X_OK);
  validateIngestProfile(plan.app);
  const schema=JSON.parse(execFileSync(path.join(plan.app,'Contents/MacOS/wiz-cli'),['project','create','--schema','--no-spawn'],{timeout:15000,maxBuffer:8*1024*1024,encoding:'utf8'}));
  if(digest(schema)!==plan.schemaHash)throw new Error('Packaged operation schema changed.');
  for(const c of course.cases)for(const op of c.operations)if(!schema.operations[op])throw new Error(`Missing packaged operation: ${op}`);
  return {plan,course,fixtures,schema};
}
export async function prepare({app='/Applications/Wizard.app',dataDir=dataDirectory(),ffmpeg,ffprobe,selection,runtime,fixtureRoot:providedFixtures,speechDirectory,onProgress=async()=>{}}={}){
  dataDir=dataDirectory(dataDir);
  await mkdir(dataDir,{recursive:true});app=await realpath(app);
  const course=selection?selectedRecipe(selection):await readJSON(path.join(ROOT,'runner/course.json'));
  validateRecipe(course);
  const requirements=requirementsFor(course.cases.map(c=>c.id),course.checkpoint);
  await onProgress('tools');
  if(runtime&&await realpath(runtime.app)!==app)throw Error('Desktop tests must use the selected build; a substitute instrumented app is not permitted.');
  const desktopRuntime=requirements.targets.some(t=>t!=='packaged')?await selectedBuildRuntime(app,dataDir):null;
  await access(ingestPython(app),constants.X_OK);
  validateIngestProfile(app);
  await onProgress('fixtures');
  const fixtureRoot=providedFixtures||path.join(dataDir,'fixtures',requirements.mediaPack==='core'?'gp-local-v0-core':'gp-local-v0');
  const fixtures=providedFixtures?await validateFixtures(fixtureRoot):await prepareFixtures(fixtureRoot,ffmpeg,ffprobe,{includeSpeech:requirements.mediaPack==='speech'});
  console.log('Fingerprinting the selected package…');
  await onProgress('build');
  const pkg=await fingerprint(app,{packageTree:true});
  assertBuildIdentity(await localBuilds(dataDir,{verify:false}),app,pkg.sha256);
  const version=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-',path.join(app,'Contents/Info.plist')],{timeout:10000,encoding:'utf8'}).trim();
  const schema=JSON.parse(execFileSync(path.join(app,'Contents/MacOS/wiz-cli'),['project','create','--schema','--no-spawn'],{timeout:15000,maxBuffer:8*1024*1024,encoding:'utf8'}));
  for(const c of course.cases)for(const op of c.operations)if(!schema.operations[op])throw new Error(`Missing operation ${op} for ${c.id}`);
  const captured=await readJSON(path.join(ROOT,'runner/contracts/installed-schema.json'));
  let schemaCompatibility;
  try{schemaCompatibility=assertMappedPackagedSchema(schema,captured,await readJSON(path.join(ROOT,'runner/contracts/packaged-schema-qualifications.json')));}
  catch(error){if(error.schemaCompatibility){await mkdir(path.join(dataDir,'schema-reviews'),{recursive:true});await writeJSON(path.join(dataDir,'schema-reviews',digest(schema)+'.json'),error.schemaCompatibility);}throw error;}
  const speechModel=requirements.speechModel?await speechModelIdentity(speechDirectory):null;
  await onProgress('attach');let attachmentQualification=null;
  if(desktopRuntime){
    const {attachSelectedBuild}=await import('../desktop/attach.mjs');const attached=await attachSelectedBuild({app,dataDir});
    try{const receipt=path.join(attached.session.root,'attachment-evidence.json');attachmentQualification={packageHash:attached.session.sourcePackageHash,toolHash:attached.session.toolHash,receipt,receiptHash:await sha(receipt)};}
    finally{attached.child.kill('SIGTERM');const force=setTimeout(()=>attached.child.kill('SIGKILL'),3000);await attached.closed;clearTimeout(force);}
  }
  await onProgress('ready');
  const content={kitVersion:2,runtime:desktopRuntime,attachmentQualification,...(selection?{recipe:course}:{}),speechModel,format:'wizard-smoke-prepared/v1',preparedAt:new Date().toISOString(),app,version,packageHash:pkg.sha256,packageFiles:pkg.files,schemaHash:digest(schema),fixtureRoot,fixtureHash:fixtures.sha256,courseHash:digest(course),runnerHash:await sourceIdentity(),runnerProvenance:await sourceProvenance(ROOT),courseId:course.id,cases:course.cases.map(c=>c.id),deferred:Object.keys(course.deferred),target:course.target,excludedPackagePaths:['Contents/MacOS/logs','**/__pycache__','**/*.pyc','**/.DS_Store']};
  content.schemaCompatibility=schemaCompatibility;
  const plan={...content,planHash:digest(content)};
  if(selection){await mkdir(path.join(dataDir,'plans'),{recursive:true});await writeJSON(path.join(dataDir,'plans',plan.planHash+'.json'),plan);}
  else{await writeJSON(path.join(dataDir,'prepared.json'),plan);
  await writeJSON(path.join(dataDir,'preflight.json'),{ok:true,checkedAt:new Date().toISOString(),planHash:plan.planHash,checks:['Runner and course fingerprinted','Packaged CLI schema mapped',fixtures.files.length+' real media fixtures probed and hashed; required model pinned','Package content fingerprinted'],wizardLaunched:false});}
  console.log(JSON.stringify({readyForFirstPilot:true,cases:plan.cases.length,deferred:plan.deferred.length,version,packageHash:pkg.sha256,appLaunched:Boolean(desktopRuntime),courseStarted:false}));return plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  try{if(process.argv.includes('--check')){const result=await checkPrepared(arg('--data-dir'));console.log(JSON.stringify({readyForFirstPilot:true,planHash:result.plan.planHash,wizardLaunched:false}));}else await prepare({app:arg('--app'),dataDir:arg('--data-dir'),ffmpeg:arg('--ffmpeg'),ffprobe:arg('--ffprobe')});}
  catch(error){console.error(error.message);process.exitCode=1;}
}
