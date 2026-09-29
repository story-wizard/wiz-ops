import path from 'node:path';
import {cp,mkdir,access,mkdtemp,rename,rm,writeFile,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {retainLibraries} from './runner/libraries.mjs';
import {ROOT,dataDirectory,readJSON,writeJSON,fingerprint,digest,sha} from './runner/files.mjs';
import {activeStates} from './runner/store.mjs';
import {exportLocalReport} from './reports.mjs';

const copyOptions={recursive:true,verbatimSymlinks:true,mode:constants.COPYFILE_FICLONE};
const sources=['runner','desktop','scope','scripts','explainer','public','server.mjs','reports.mjs','kits.mjs','coverage.mjs','tower.mjs','tower-live.mjs','package.json'];
export async function snapshotSource(destination){
 await mkdir(destination,{recursive:true});
 for(const name of sources)await cp(path.join(ROOT,name),path.join(destination,name),copyOptions);
 for(const name of ['catalog-seed.json','checkpoints/logan-2026-09-25-2.json']){await mkdir(path.dirname(path.join(destination,'catalog',name)),{recursive:true});await cp(path.join(ROOT,'catalog',name),path.join(destination,'catalog',name),copyOptions);}
 return (await fingerprint(destination)).sha256;
}
export async function exportRunKit(run,dataDir){
 dataDir=dataDirectory(dataDir);
 const e=run.execution;if(!e||activeStates.includes(e.state))throw Error('A run kit requires a terminal automated run.');
 const root=path.join(dataDir,'runs',run.id);if(root!==e.artifact_root)throw Error('Invalid retained run root.');
 const source=path.join(root,'source'),sourceHash=(await fingerprint(source)).sha256;
 const context=await readJSON(path.join(root,'execution-context.json'));if(context.sourceHash!==sourceHash)throw Error('Retained runner source changed or is unavailable; this historical run cannot supply an exact kit.');
 const plan=e.package;if(plan.kitVersion!==2)throw Error('This historical snapshot predates retained runtime libraries. Execute a newly prepared course to create a portable kit.');if((await fingerprint(plan.app,{packageTree:true})).sha256!==plan.packageHash)throw Error('Selected package changed; restore the exact retained package before exporting its kit.');
 if(plan.runtime){for(const [file,hash]of [[plan.runtime.cli,plan.runtime.cliHash],[plan.runtime.qtPlugin,plan.runtime.qtHash],[plan.runtime.bridge,plan.runtime.bridgeHash]])if(await sha(file)!==hash)throw Error('Desktop runtime input changed.');if((await fingerprint(plan.runtime.app,{packageTree:true})).sha256!==plan.runtime.appHash)throw Error('Desktop app changed.');if(plan.runtime.libraries&&(await fingerprint(plan.runtime.libraries)).sha256!==plan.runtime.librariesHash)throw Error('Retained libraries changed.');}
 const report=await exportLocalReport(run,dataDir),parent=path.join(dataDir,'kits');await mkdir(parent,{recursive:true});
 const name='smoke-kit-'+run.id+'-'+digest({sourceHash,planHash:e.plan_hash,report:report.path}).slice(0,12),destination=path.join(parent,name);
 try{await access(path.join(destination,'kit.json'));return {path:destination,manifest:path.join(destination,'kit.json'),state:'Local kit retained'};}catch(error){if(error.code!=='ENOENT')throw error;}
 const temp=await mkdtemp(path.join(parent,'.kit-'));
 try{
  await cp(source,path.join(temp,'workspace'),copyOptions);
  await cp(plan.app,path.join(temp,'inputs/Package.app'),copyOptions);
  await cp(path.join(root,'media'),path.join(temp,'inputs/media'),copyOptions);
  // Relink checks move their disposable copies. The approved original fixture pack remains the rerun input.
  await cp(plan.fixtureRoot,path.join(temp,'inputs/media'),copyOptions);
  if(plan.runtime){await cp(plan.runtime.app,path.join(temp,'inputs/Desktop.app'),copyOptions);await cp(plan.runtime.cli,path.join(temp,'inputs/wiz-cli'),copyOptions);await cp(plan.runtime.qtPlugin,path.join(temp,'inputs/libqcocoa.dylib'),copyOptions);await cp(plan.runtime.bridge,path.join(temp,'inputs/libwizard_smoke.dylib'),copyOptions);}
  if(plan.speechModel)await cp(plan.speechModel.directory,path.join(temp,'inputs/speech-model'),{...copyOptions,dereference:true});
  await cp(root,path.join(temp,'evidence'),{...copyOptions,filter:src=>src!==source});
  await cp(path.dirname(report.path),path.join(temp,'report'),copyOptions);
  const libraries=plan.runtime?await retainLibraries(plan.runtime,path.join(temp,'inputs/libraries')):null;
  const external=libraries?.external||[];
  const selection=plan.recipe?.selection,content={format:'wizard-smoke-kit/v1',runId:run.id,planHash:e.plan_hash,packageHash:plan.packageHash,desktopHash:plan.runtime?.appHash||null,sourceHash,selection:selection?{title:selection.title,project:selection.project,groups:selection.groups,...(selection.checkpoint?{checkpoint:selection.checkpoint.id}:{})}:{courseIds:['packaged-full']},speechModel:!!plan.speechModel,retainedLibraries:!!libraries,externalDependencies:external,requirements:{platform:'darwin',architecture:process.arch,node:'>=22.13',foreground:!!selection?.requirements.foreground},limitations:['Original evidence preserves original absolute paths. Rerun creates new disposable projects from retained media.','Instrumented runtime may require the listed matching local Qt libraries; this kit is not a self-contained macOS installer.','No second-machine acceptance or external publication is claimed.']};
  await writeFile(path.join(temp,'README.md'),'# Local smoke run kit\n\nRun `node workspace/scripts/kit.mjs check` to verify files and local runtime dependencies. Run `node workspace/scripts/kit.mjs run --operator "Your name"` to execute the frozen selection in new projects. No C++ checkout is used.\n\nOpen report/index.html for original outcomes. New results use the external SMOKE_DATA_DIR workspace (the default is the user application-data directory). Runtime and original build identities remain distinct. See kit.json for dependencies and limitations.\n');
  const inventory=(await fingerprint(temp)).entries;await writeJSON(path.join(temp,'kit.json'),{...content,inventory,inventoryHash:digest(inventory)});
  await rename(temp,destination);return {path:destination,manifest:path.join(destination,'kit.json'),state:'Local kit retained',externalDependencies:external.length};
 }finally{await rm(temp,{recursive:true,force:true});}
}
