import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir,copyFile,writeFile,realpath,mkdtemp,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {renderReport} from '../reports.mjs';
import {verifyDesktopPaths} from '../desktop/adapter.mjs';
import {readJSON,writeJSON,sha,digest,inside,dataDirectory} from '../runner/files.mjs';
import {testSpecification,actionHistory,stepHistory,evidenceItems,evidenceCoverage,agentPrompt} from '../test-details.mjs';

async function previewClip(s,observations,destination){
 const samples=observations.samples?.filter(x=>x.startedAt>=observations.receipt?.pointerDownAt&&x.finishedAt<=observations.receipt?.pointerUpAt)||[];
 if(samples.length<3)return false;
 const temp=await mkdtemp(path.join(destination,'.frames-'));
 try{
  const lines=[];for(let i=0;i<samples.length;i++){
   const source=await realpath(samples[i].image.path);if(!inside(s.root,source))throw Error('Preview sample escaped the owned run.');
   await copyFile(source,path.join(temp,'frame-'+i+'.png'));const seconds=((samples[i+1]?.startedAt||observations.receipt.pointerUpAt)-samples[i].startedAt)/1000;if(!Number.isFinite(seconds)||seconds<=0||seconds>10)throw Error('Invalid preview sample spacing.');
   lines.push("file 'frame-"+i+".png'",'duration '+seconds);
  }
  lines.push("file 'frame-"+(samples.length-1)+".png'");await writeFile(path.join(temp,'frames.txt'),lines.join('\n')+'\n');
  // Use the same full FFmpeg installation as the fixture generator; packaged FFmpeg omits padding and x264.
  await promisify(execFile)('/opt/homebrew/bin/ffmpeg',['-nostdin','-v','error','-f','concat','-safe','1','-i',path.join(temp,'frames.txt'),'-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart','-y',path.join(destination,'preview-clip.mp4')],{timeout:30000,maxBuffer:1024*1024});return true;
 }finally{await rm(temp,{recursive:true,force:true});}
}

export async function exportPhysicalReport(file){
 const s=await readJSON(file);verifyDesktopPaths(s,s.dataDir);
 const run=await readJSON(path.join(s.root,'desktop-physical-report.json')),course=run.course;
 const ops=(await readFile(path.join(s.root,'operations.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),buffers=new Map(),artifacts=[];
 const journal=async name=>{try{return (await readFile(path.join(s.root,name),'utf8')).split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 const native=await journal('native-events.jsonl'),input=await journal('native-input.jsonl'),events=await journal('steps.jsonl');
 for(const event of input)if(!event.command&&event.request){const request=await realpath(path.join(s.root,event.request));if(!inside(path.join(s.root,'evidence'),request))throw Error('Native request escaped its run.');event.input=await readJSON(request);event.command=event.input.command;}
 const parent=path.join(dataDirectory(s.dataDir),'exports');await mkdir(parent,{recursive:true});const temporary=await mkdtemp(path.join(parent,'.physical-report-'));await mkdir(path.join(temporary,'evidence'));
 try{
 const gather=value=>{if(typeof value==='string')return value.startsWith('evidence/')?[value]:[];if(Array.isArray(value))return value.flatMap(gather);if(value&&typeof value==='object')return Object.values(value).flatMap(gather);return [];};
 const cases=[],selected=course.cases.filter(c=>s.selectedChecks.includes(c.id));
 for(const definition of selected){
  const result=run.results.find(r=>r.id===definition.id)||{status:'Blocked',error:'An earlier uncertain action stopped execution.'};
  let failure;try{failure=await readJSON(path.join(s.root,definition.id+'-failure-screen.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const supplements=[];for(const suffix of ['live-observations','graph-observations','rejection']){const relative='evidence/'+definition.id+'-'+suffix+'.txt';try{supplements.push({artifacts:[relative],observations:await readJSON(path.join(s.root,relative))});}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(const suffix of ['before','after','undo']){const relative='evidence/'+definition.id+'-'+suffix+'.png';try{await realpath(path.join(s.root,relative));supplements.push({artifacts:[relative]});}catch(e){if(e.code!=='ENOENT')throw e;}}
  const relativeFiles=new Set(gather([result.evidence,failure,supplements])),files=[];for(const relative of relativeFiles){
   const source=await realpath(path.join(s.root,relative));if(!inside(path.join(s.root,'evidence'),source))throw Error('Candidate evidence resolves outside its run');
   const hash=await sha(source),name='computer-use-'+hash.slice(0,12)+'-'+path.basename(source);
   if(!buffers.has(name)){buffers.set(name,source);artifacts.push({file:name,source:relative,sha256:hash,bytes:(await readFile(source)).length});}files.push(name);
  }
  const live=supplements.find(x=>x.artifacts.some(f=>f.includes('live-observations'))),warnings=[];
  if(live)try{
   const frames=await mkdtemp(path.join(temporary,'.preview-'));if(await previewClip(s,live.observations,frames)){const source=path.join(frames,'preview-clip.mp4'),hash=await sha(source),name='computer-use-'+hash.slice(0,12)+'-'+definition.id+'-preview-clip.mp4';buffers.set(name,source);artifacts.push({file:name,source:'Timed retained preview samples',sha256:hash,bytes:(await readFile(source)).length});files.unshift(name);}
  }catch(e){warnings.push('Preview sequence: '+e.message);}
  const spec=run.specifications?.find(c=>c.id===definition.id)||testSpecification(definition),actions=actionHistory(ops.filter(o=>o.caseId===definition.id),native.filter(o=>o.caseId===definition.id),input.filter(o=>o.caseId===definition.id||relativeFiles.has(o.request))),evidence=evidenceItems(files,spec,result.status==='Fail'?'failure':'after');
  cases.push({id:definition.id,title:definition.title,area:definition.area||'Spellbook',target:'desktop',status:result.status,observation:result.error||result.evidence?.summary||({
   'P-SB-CREATE':'Both native creation paths produced distinct empty Spell tabs.',
   'P-SB-SEARCH-DROP':'Both shortcuts opened search; physical Text drags created nodes and Undo restored empty graphs.',
   'P-SB-WIRE':'Physical port drag created the correct edge; Undo and Redo removed and restored it.',
   'P-SB-BYPASS':'D bypassed the selected effect and restored it.',
   'P-SB-GESTURE-UNDO':'One Undo restored the dragged node; the next reversed the preceding parameter edit.',
   'P-SB-DOCK':'Float/redock preserved the document, graph, parameters and node positions.'
  }[definition.id]),expected:definition.expected,method:spec.method,methodBasis:run.specifications?'Frozen with this run':'Current guide; frozen course definition',definitionHash:spec.definitionHash,steps:stepHistory(spec,events.filter(e=>e.caseId===definition.id),actions),actions,evidence,evidenceRequirements:evidenceCoverage(spec,evidence,actions),evidenceWarnings:warnings,measurements:Object.fromEntries(Object.entries(result.evidence||{}).filter(([k,v])=>typeof v==='number'&&!['pid','generation'].includes(k))),editPrompt:agentPrompt(spec,{runId:path.basename(s.root),outcome:result.status}),operations:[...new Set(ops.filter(o=>o.caseId===definition.id).map(o=>o.operation)),'CoreGraphics mouse/keyboard','Qt state inspection'],evidenceFiles:files});
 }
 const counts=cases.reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{}),id=randomUUID();
 const sourceRows=[...new Set(selected.map(c=>c.sourceId))].map(sourceId=>{const paths=selected.filter(c=>c.sourceId===sourceId);return {id:sourceId,criteria:paths.map(c=>c.title).join('; '),disposition:'Candidate physical paths',results:cases.filter(c=>paths.some(p=>p.id===c.id)).map(c=>({id:c.id,status:c.status}))};});
 const report={format:'wizard-smoke-physical-candidate-report/v1',runId:id,title:course.title||'Physical Spellbook · candidate qualification',operator:'Local automated runner',asOf:new Date().toISOString(),identities:{version:s.plan.version,sourcePackageHash:s.cliPackageHash,instrumentedAppHash:s.guiHash,bridgeHash:s.bridgeHash,pairedCliHash:s.desktopCliHash,courseHash:digest(course),preparedRunnerHash:s.plan.runnerHash},execution:{state:cases.every(c=>c.status==='Pass')?'Passed':cases.some(c=>c.status==='Fail')?'Failed':'Blocked',target:course.target,context:{session:s.root,pid:run.pid,generation:run.generation,acceptance:'Candidate qualification'}},counts,cases,targets:[{target:'desktop',build:'Isolated instrumented Wizard',hash:s.guiHash,counts}],fixtures:{project:s.bundle,media:s.plan.fixtureHash},acceptance:{gaps:[],evidenceStatus:'Retained local qualification'},scope:{sourceRows},artifacts};
 report.acceptance.gaps=cases.flatMap(c=>[...c.evidenceWarnings,...c.evidenceRequirements.filter(e=>e.status==='Missing').map(e=>c.id+': missing required evidence '+e.id)]);
 const html=renderReport(report),name='smoke-report-'+id+'-'+digest({report,html}).slice(0,12),directory=path.join(parent,name);
 for(const [name,source] of buffers)await copyFile(source,path.join(temporary,'evidence',name));
 // Remove encoding scratch files before finalizing the immutable report.
 const {readdir}=await import('node:fs/promises');for(const item of await readdir(temporary))if(item.startsWith('.preview-'))await rm(path.join(temporary,item),{recursive:true});
 await writeJSON(path.join(temporary,'report.json'),report);await writeFile(path.join(temporary,'index.html'),html);await rename(temporary,directory);return {path:path.join(directory,'index.html'),url:'/exports/'+name+'/index.html',counts,session:s.root};
 }finally{await rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await exportPhysicalReport(process.argv[2]),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
