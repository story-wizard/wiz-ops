// Diagnostic runs retain evidence but never create dashboard pass records.
import path from 'node:path';
import {mkdtemp,cp} from 'node:fs/promises';
import {checkPrepared} from '../runner/prepare.mjs';
import {PackagedEngine} from '../runner/engine.mjs';
import {executeCourse} from '../runner/run.mjs';
import {ROOT,dataDirectory,writeJSON} from '../runner/files.mjs';
const ids=process.argv.slice(2);
const {plan,course,fixtures,schema}=await checkPrepared();
if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!course.cases.some(c=>c.id===id)))throw new Error('Supply unique case IDs from the prepared course.');
const root=await mkdtemp(path.join(dataDirectory(),'runs/case-probe-'));console.log(root);
await cp(plan.fixtureRoot,path.join(root,'media'),{recursive:true});
await writeJSON(path.join(root,'plan.json'),plan);
const engine=new PackagedEngine(plan,root,'case-probe',schema);
try{
  await engine.start();const selected={...course,cases:ids.map(id=>course.cases.find(c=>c.id===id))};
  const results=await executeCourse({course:selected,engine,fixtures,onResult:async(c,status,note)=>console.log(c.id,status,note)});
  await writeJSON(path.join(root,'probe-report.json'),{results,course:selected});if(results.some(r=>r.status!=='Pass'))process.exitCode=1;
}finally{await engine.stop();}
