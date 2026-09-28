import {execFileSync} from 'node:child_process';
import {mkdir,realpath,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';

export async function speechModelIdentity(directory=path.join(homedir(),'.cache/huggingface/hub/models--FluidInference--parakeet-tdt-0.6b-v2-coreml/snapshots/ee09c569f73759e6d44c9bd16766f477b2b36d39')){
  for(const name of ['Encoder.mlmodelc','Decoder.mlmodelc','Preprocessor.mlmodelc','JointDecision.mlmodelc','parakeet_vocab.json'])await access(path.join(directory,name));
  const identity=await fingerprint(directory,{followFileLinks:true});return {directory,sha256:identity.sha256,files:identity.files,model:'FluidInference/parakeet-tdt-0.6b-v2-coreml',revision:path.basename(directory)};
}

import {ROOT,dataDirectory,readJSON,writeJSON,fingerprint,digest} from './files.mjs';
import {prepareFixtures,validateFixtures} from './fixtures.mjs';
import {ingestPython,validateIngestProfile} from './ingest.mjs';
import {runtimeIdentity,verifyRuntime} from './runtime.mjs';
import {selectedRecipe,validateRecipe,requirementsFor} from './catalog.mjs';

export async function sourceIdentity(){return digest([(await fingerprint(path.join(ROOT,'runner'))).sha256,(await fingerprint(path.join(ROOT,'desktop'))).sha256]);}
export async function checkPrepared(dataDir=dataDirectory(),frozenPlan){
  dataDir=dataDirectory(dataDir);
  const plan=frozenPlan||await readJSON(path.join(dataDir,'prepared.json'));
  const {planHash,...content}=plan;if(digest(content)!==planHash)throw new Error('Prepared plan is corrupt. Prepare again.');
  if(await sourceIdentity()!==plan.runnerHash)throw new Error('Runner changed since preparation. Prepare again.');
  if(plan.runtime)await verifyRuntime(plan.runtime,dataDir);
  const course=plan.recipe||await readJSON(path.join(ROOT,'runner/course.json'));
  validateRecipe(course);
  if(digest(course)!==plan.courseHash)throw new Error('Course changed since preparation.');
  const fixtures=await validateFixtures(plan.fixtureRoot);if(fixtures.sha256!==plan.fixtureHash)throw new Error('Fixtures changed since preparation.');
  if(requirementsFor(course.cases.map(c=>c.id)).speechModel&&(!plan.speechModel||(await speechModelIdentity(plan.speechModel.directory)).sha256!==plan.speechModel.sha256))throw new Error('Cached speech model changed or is missing. Prepare again; downloads are disabled.');
  const pkg=await fingerprint(plan.app,{packageTree:true});if(pkg.sha256!==plan.packageHash)throw new Error('Wizard package changed since preparation. Prepare against the intended package again.');
  await access(ingestPython(plan.app),constants.X_OK);
  validateIngestProfile(plan.app);
  const schema=JSON.parse(execFileSync(path.join(plan.app,'Contents/MacOS/wiz-cli'),['project','create','--schema','--no-spawn'],{timeout:15000,maxBuffer:8*1024*1024,encoding:'utf8'}));
  if(digest(schema)!==plan.schemaHash)throw new Error('Packaged operation schema changed.');
  for(const c of course.cases)for(const op of c.operations)if(!schema.operations[op])throw new Error(`Missing packaged operation: ${op}`);
  return {plan,course,fixtures,schema};
}
export async function prepare({app='/Applications/Wizard.app',dataDir=dataDirectory(),ffmpeg,ffprobe,selection,runtime,fixtureRoot:providedFixtures,speechDirectory}={}){
  dataDir=dataDirectory(dataDir);
  await mkdir(dataDir,{recursive:true});app=await realpath(app);
  const course=selection?selectedRecipe(selection):await readJSON(path.join(ROOT,'runner/course.json'));
  validateRecipe(course);
  const requirements=requirementsFor(course.cases.map(c=>c.id));
  const desktopRuntime=requirements.targets.some(t=>t!=='packaged')?await runtimeIdentity(runtime,dataDir):null;
  await access(ingestPython(app),constants.X_OK);
  validateIngestProfile(app);
  const fixtureRoot=providedFixtures||path.join(dataDir,'fixtures',requirements.mediaPack==='core'?'gp-local-v0-core':'gp-local-v0');
  const fixtures=providedFixtures?await validateFixtures(fixtureRoot):await prepareFixtures(fixtureRoot,ffmpeg,ffprobe,{includeSpeech:requirements.mediaPack==='speech'});
  console.log('Fingerprinting the selected package…');
  const pkg=await fingerprint(app,{packageTree:true});
  const version=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-',path.join(app,'Contents/Info.plist')],{timeout:10000,encoding:'utf8'}).trim();
  const schema=JSON.parse(execFileSync(path.join(app,'Contents/MacOS/wiz-cli'),['project','create','--schema','--no-spawn'],{timeout:15000,maxBuffer:8*1024*1024,encoding:'utf8'}));
  for(const c of course.cases)for(const op of c.operations)if(!schema.operations[op])throw new Error(`Missing operation ${op} for ${c.id}`);
  const captured=await readJSON(path.join(ROOT,'runner/contracts/installed-schema.json'));
  if(digest(schema)!==digest(captured))throw new Error('This package has a different command schema from the mapped contract. Review the mapping before preparing it.');
  const speechModel=requirements.speechModel?await speechModelIdentity(speechDirectory):null;
  const content={kitVersion:2,runtime:desktopRuntime,...(selection?{recipe:course}:{}),speechModel,format:'wizard-smoke-prepared/v1',preparedAt:new Date().toISOString(),app,version,packageHash:pkg.sha256,packageFiles:pkg.files,schemaHash:digest(schema),fixtureRoot,fixtureHash:fixtures.sha256,courseHash:digest(course),runnerHash:await sourceIdentity(),courseId:course.id,cases:course.cases.map(c=>c.id),deferred:Object.keys(course.deferred),target:course.target,excludedPackagePaths:['Contents/MacOS/logs','**/__pycache__','**/*.pyc','**/.DS_Store']};
  const plan={...content,planHash:digest(content)};
  if(selection){await mkdir(path.join(dataDir,'plans'),{recursive:true});await writeJSON(path.join(dataDir,'plans',plan.planHash+'.json'),plan);}
  else{await writeJSON(path.join(dataDir,'prepared.json'),plan);
  await writeJSON(path.join(dataDir,'preflight.json'),{ok:true,checkedAt:new Date().toISOString(),planHash:plan.planHash,checks:['Runner and course fingerprinted','Packaged CLI schema mapped',fixtures.files.length+' real media fixtures probed and hashed; required model pinned','Package content fingerprinted'],wizardLaunched:false});}
  console.log(JSON.stringify({readyForFirstPilot:true,cases:plan.cases.length,deferred:plan.deferred.length,version,packageHash:pkg.sha256,appLaunched:false}));return plan;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  try{if(process.argv.includes('--check')){const result=await checkPrepared(arg('--data-dir'));console.log(JSON.stringify({readyForFirstPilot:true,planHash:result.plan.planHash,wizardLaunched:false}));}else await prepare({app:arg('--app'),dataDir:arg('--data-dir'),ffmpeg:arg('--ffmpeg'),ffprobe:arg('--ffprobe')});}
  catch(error){console.error(error.message);process.exitCode=1;}
}
