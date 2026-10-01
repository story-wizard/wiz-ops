import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checklistCoverage} from '../coverage.mjs';
import {methods} from './notes.mjs';
import {testSpecification,agentContext,actionHistory,evidenceCaption,mediaKind} from '../test-details.mjs';
import {checkRegistry} from '../runner/catalog.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const within=(base,file)=>file.startsWith(base+path.sep);
const allowed=new Set(['.json','.jsonl','.mjs','.cpp','.sh','.md','.png','.jpg','.jpeg','.mp4','.mov','.wav','.ppm','.log']);
export function createExplainer(root,dataRoot){
 let files=new Map();
 function register(file,label){
  try{const real=fs.realpathSync(file);if(!(within(path.join(root,'desktop'),real)||within(path.join(root,'runner'),real)||within(path.join(root,'explainer'),real)||within(path.join(root,'docs'),real)||within(fs.realpathSync(dataRoot),real)))return null;
   const stat=fs.statSync(real);if(!stat.isFile()||stat.size>32*1024*1024||!allowed.has(path.extname(real)))return null;
   const id=createHash('sha256').update(real).digest('hex').slice(0,32);files.set(id,real);return {id,label:label||path.basename(real),path:path.relative(root,real),bytes:stat.size,caption:evidenceCaption(real),kind:mediaKind(real),url:'/api/explainer/files/'+id};
  }catch{return null;}
 }
 function sourceIndex(){
  const found=new Map();
  for(const folder of ['runner','desktop'])for(const name of fs.readdirSync(path.join(root,folder)).filter(n=>n.endsWith('.mjs'))){
   const file=path.join(root,folder,name),text=fs.readFileSync(file,'utf8');
   // These are source pointers, not an inferred execution trace. Shared helpers stay linked separately.
   const matches=[...text.matchAll(/(?:\bcheck\(|\brunCheck\()\s*['"]([A-Z][A-Z0-9-]+)['"]|async\s+['"]([A-Z][A-Z0-9-]+)['"]\s*\(|['"]([A-Z][A-Z0-9-]+)['"]\s*:\s*\w+\s*=>/g)];
   for(let i=0;i<matches.length;i++){const m=matches[i],id=m[1]||m[2]||m[3],end=matches[i+1]?.index??Math.min(text.length,m.index+16000);const entry={file:path.relative(root,file),line:text.slice(0,m.index).split('\n').length,excerpt:text.slice(m.index,end).trim().slice(0,14000),link:register(file)};if(!found.has(id))found.set(id,[]);found.get(id).push(entry);}
  }
  for(const [id,name] of [['D-LP-02-RELAUNCH','desktop/run.mjs'],['D-SAVE-DISCARD','desktop/check-lifecycle.mjs'],['S-EXPORT-UNSET-RATE','desktop/check-unset-rate.mjs'],['D-BIN-RENAME','desktop/check-selection-bin.mjs'],['D-BIN-DUPLICATE','desktop/check-selection-bin.mjs'],['D-BIN-DELETE','desktop/check-selection-bin.mjs'],['D-BIN-MGFX','desktop/check-selection-bin.mjs']])if(!found.has(id)){const file=path.join(root,name),text=fs.readFileSync(file,'utf8'),at=text.indexOf("'"+id+"'");found.set(id,[{file:name,line:text.slice(0,at).split('\n').length,excerpt:text.slice(Math.max(0,at-100),at+5500),link:register(file)}]);}
  return found;
 }
 function record(file,id,kind,runId,session){
  if(!fs.existsSync(file))return null;const report=read(file),result=report.results?.find(x=>(x.id||x.test_id)===id);if(!result)return null;
  const dir=path.dirname(file),related=[];const seen=new Set();
  const add=(p,label)=>{const a=register(p,label);if(a&&!seen.has(a.id)){seen.add(a.id);related.push(a);}};
  add(file,'Result report');
  const visit=v=>{if(typeof v==='string'&&path.isAbsolute(v)&&within(dir,v))add(v);else if(v&&typeof v==='object')for(const value of Object.values(v))visit(value);};visit(result);
  const headless=kind==='Packaged course';
  if(headless){const evidence=path.join(dir,'projects',id);if(fs.existsSync(evidence))for(const name of fs.readdirSync(evidence).filter(n=>/\.(json|ppm|png)$/.test(n)))add(path.join(evidence,name));}
  const journal=name=>{try{return fs.readFileSync(path.join(dir,name),'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.caseId===id);}catch{return [];}};
  const actions=actionHistory(journal('operations.jsonl'),journal('native-events.jsonl'),journal('native-input.jsonl'));
  const clean=v=>JSON.parse(JSON.stringify(v,(k,value)=>k==='sampleRgb'?undefined:value));
  const mismatches=[];for(const [name,digest] of Object.entries(report.sources||{})){const f=path.join(root,'desktop',name);if(!fs.existsSync(f)||hash(f)!==digest)mismatches.push(name);}
  return {runId,kind,status:result.status,actions,observation:result.error||result.note||result.evidence?.scope||(result.status==='Pass'?'The report records the assertions as satisfied.':'See the recorded result for the outcome.'),result:clean(result),at:report.finishedAt||report.startedAt||fs.statSync(file).mtime.toISOString(),reportHash:hash(file),guiHash:report.guiHash||session?.guiHash,cliHash:report.cliHash||session?.desktopCliHash,packageHash:report.packageHash,fixtureHash:report.fixtureHash,revision:report.course?.revision||report.courseRevision||null,sourceAgreement:report.sources?(mismatches.length?'Changed since run':'Recorded files match'):'No per-file manifest',mismatches,courseError:report.error||null,context:runId==='desktop-vUae57'?'This attempt included harness faults in tab targeting and relink save ordering. Its failures do not independently establish product defects.':runId==='desktop-kp2OdB'?'This attempt stopped when the smoke window could not become active; the machine was subsequently observed locked.':null,artifacts:related,journals:['operations.jsonl',...(headless?[]:['native-events.jsonl'])].map(n=>register(path.join(dir,n),headless?'Operation journal — filter caseId '+id:'Run-wide '+n)).filter(Boolean),reopen:result.reopen||null};
 }
 function build(){
  files=new Map();const accepted=new Map(checkRegistry().map(c=>[c.id,c.accepted]));const specs=[['Packaged engine','runner/course.json'],['Foreground editor','desktop/course.json'],['Background services','desktop/service-course.json']].map(([target,file])=>({...read(path.join(root,file)),target}));
  const checkpoint=read(path.join(root,'catalog/checkpoints/logan-2026-09-25-2.json')),mapping=checklistCoverage(checkpoint,{cases:specs.flatMap(s=>s.cases)}),index=sourceIndex();
  const runBase=path.join(dataRoot,'runs'),packagedReports=fs.existsSync(runBase)?fs.readdirSync(runBase).filter(n=>/^[a-f0-9-]{36}$/.test(n)&&fs.existsSync(path.join(runBase,n,'report.json'))).map(n=>({id:n,file:path.join(runBase,n,'report.json'),report:read(path.join(runBase,n,'report.json'))})).sort((a,b)=>(b.report.completedAt||b.report.finishedAt||'').localeCompare(a.report.completedAt||a.report.finishedAt||'')):[];
  const desktopBase=path.join(dataRoot,'desktop-runs');const courseReports=fs.existsSync(desktopBase)?fs.readdirSync(desktopBase).filter(n=>/^desktop-[A-Za-z0-9]+$/.test(n)&&fs.existsSync(path.join(desktopBase,n,'desktop-course-report.json'))).map(n=>({id:n,file:path.join(desktopBase,n,'desktop-course-report.json'),report:read(path.join(desktopBase,n,'desktop-course-report.json'))})).sort((a,b)=>(b.report.finishedAt||'').localeCompare(a.report.finishedAt||'')):[];
  const focused={
   'D-PREVIEW-SCRUB':['desktop-m19ncl','desktop-playback-report.json'], 'D-PLAYBACK-INOUT':['desktop-m19ncl','desktop-playback-report.json'], 'D-PLAYBACK-LOOP':['desktop-m19ncl','desktop-playback-report.json'], 'D-SCRUB-CUTS':['desktop-m19ncl','desktop-playback-report.json'],
   'D-SB-TAB-RENAME':['desktop-5RBF3B','desktop-spell-ui-report.json'], 'D-SB-TAB-DUPLICATE':['desktop-5RBF3B','desktop-spell-ui-report.json'], 'D-SB-SEARCH-DROP':['desktop-5RBF3B','desktop-spell-ui-report.json'], 'D-SB-INSPECTOR-PREVIEW':['desktop-5RBF3B','desktop-spell-ui-report.json'],
   'D-MEDIA-RELINK':['desktop-lmjYUk','desktop-relink-report.json'], 'D-CURVE-RGB-CLIPBOARD':['desktop-6DfOlT','desktop-curves-report.json'], 'D-CURVE-HUE-RESET':['desktop-6DfOlT','desktop-curves-report.json']};
  const rows=specs.flatMap(spec=>spec.cases.map(c=>{
   let runId,file,kind;if(spec.target==='Packaged engine'){const latest=packagedReports.find(r=>r.report.results?.some(x=>(x.id||x.test_id)===c.id));runId=latest?.id||'a3f3360d-baf6-4c37-8e74-1f7912791c46';file=latest?.file||path.join(dataRoot,'runs',runId,'report.json');kind='Packaged course';}
   else if(focused[c.id]){[runId,file]=focused[c.id];file=path.join(desktopBase,runId,file);kind='Focused probe';}
   else{runId=spec.target==='Background services'?'desktop-rmkVfg':'desktop-SQs9c7';file=path.join(desktopBase,runId,'desktop-course-report.json');kind='Course record';}
   let session;const sp=path.join(path.dirname(file),'session.json');if(fs.existsSync(sp))session=read(sp);
   const reference=record(file,c.id,kind,runId,session),source=mapping.find(x=>x.id===c.sourceId),locations=index.get(c.id)||[];
   const history=spec.target==='Packaged engine'?[]:courseReports.filter(x=>x.id!==runId&&x.report.results?.some(y=>y.id===c.id)).slice(0,3).map(x=>record(x.file,c.id,'Course attempt',x.id));
   let persistence=null;const rp=c.id==='D-SB-TAB-RENAME'?'desktop-spell-ui-reopen-report.json':c.id==='D-MEDIA-RELINK'?'desktop-relink-reopen-report.json':null;if(rp)persistence=record(path.join(path.dirname(file),rp),c.id,'Persistence follow-up',runId,session);
   const ownArtifacts={ 'D-PREVIEW-SCRUB':['preview-scrub-observations.json'],'D-PLAYBACK-LOOP':['loop-capabilities.json'],'D-SCRUB-CUTS':['scrub-cuts-observed.json'],'D-SB-TAB-RENAME':['spell-ui-expected.json'],'D-SB-TAB-DUPLICATE':['spell-duplicate-menu.json'],'D-SB-INSPECTOR-PREVIEW':['spell-inspector-observed.json','spell-loaded-ui.json'],'D-MEDIA-RELINK':['relink-path-observations.json','relink-expected.json'],'D-CURVE-RGB-CLIPBOARD':['rgb-edited-graph.json'],'D-CURVE-HUE-RESET':['hue-edited-graph.json']};
   if(reference)for(const name of ownArtifacts[c.id]||[]){const a=register(path.join(path.dirname(file),name));if(a){reference.artifacts.push(a);const visit=v=>{if(typeof v==='string'&&path.isAbsolute(v)&&within(path.dirname(file),v)&&v.endsWith('.png')){const img=register(v);if(img&&!reference.artifacts.some(x=>x.id===img.id))reference.artifacts.push(img);}else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(read(path.join(path.dirname(file),name)));}}
   const literalOps=[...new Set(locations.flatMap(l=>[...l.excerpt.matchAll(/['"]((?:project|timeline|media|graph|render|playback|spellbook|generate|undo|bins|documents|search)\.[a-z_]+)['"]/g)].map(m=>m[1])))];
   const note=methods[c.id],method=note||c.scope||c.expected;
   const mechanism=spec.target==='Packaged engine'?'Packaged CLI':spec.target==='Background services'?(c.id.startsWith('S-EXPORT')?'Export worker':'App service API'): /^D-SB-(GRAPH|PARAMS|BYPASS|ATOMIC|STALE|INSTANCE|PERSIST)$/.test(c.id)?'CLI + app state':c.id==='D-SB-SEARCH-DROP'?'Qt drop adapter':c.id==='D-PLAYBACK-LOOP'||c.id==='D-SB-TAB-DUPLICATE'?'Capability check':'Qt UI + CLI';
   const specification=testSpecification(c),context=agentContext(c,{root,sources:locations.map(l=>({file:l.file,line:l.line})),accepted:accepted.get(c.id)||false,runId:reference?.runId,outcome:reference?.status});
   return {...c,specification,context,target:spec.target,courseId:spec.id,courseRevision:spec.revision,area:source?.area||c.stage||'Runtime contract',method,mechanism,reference,persistence,history,source:source?{id:source.id,criteria:source.criteria,environment:source.environment,remaining:source.remaining}:null,locations,operations:c.operations||literalOps,operationBasis:c.operations?'Declared by course':'Literal names in the linked excerpt; shared helper calls may add operations',newAddition:Boolean(focused[c.id])};
  }));
  return {generatedAt:new Date().toISOString(),rows,counts:specs.map(s=>({target:s.target,count:s.cases.length,revision:s.revision})),originalCount:checkpoint.rows.length,mapping:mapping.reduce((a,r)=>(a[r.coverage]=(a[r.coverage]||0)+1,a),{}),references:{checkpoint:register(path.join(root,'docs/automation-goal-progress.md'),'Validation checkpoint'),interactions:register(path.join(root,'docs/interaction-library.md'),'Shared interaction library')},caveat:'Reference evidence is curated from retained course records and focused probes. It is not a claim that the current 77-check foreground course completed. Recent attempts remain visible in each detail panel. Reading this page never launches Wizard.'};
 }
 return {build,file(id){const p=files.get(id);if(!p||fs.realpathSync(p)!==p||fs.statSync(p).size>32*1024*1024)return null;return p;}};
}
