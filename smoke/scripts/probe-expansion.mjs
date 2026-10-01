// Disposable, journalled integration probe. Does not publish results into the dashboard.
import path from 'node:path';
import {mkdtemp,cp} from 'node:fs/promises';
import {checkPrepared} from '../runner/prepare.mjs';
import {PackagedEngine} from '../runner/engine.mjs';
import {executeCourse} from '../runner/run.mjs';
import {ROOT,dataDirectory,writeJSON} from '../runner/files.mjs';
const {plan,course,fixtures,schema}=await checkPrepared();
const root=await mkdtemp(path.join(dataDirectory(),'runs/expansion-probe-'));
console.log('ROOT',root);await cp(plan.fixtureRoot,path.join(root,'media'),{recursive:true});
const engine=new PackagedEngine(plan,root,'expansion-probe',schema);
try{await engine.start();const ids=process.argv.slice(2);const selected=ids.length?course.cases.filter(c=>ids.includes(c.id)):course.cases.slice(16);const outcomes=await executeCourse({course:{...course,cases:selected},engine,fixtures,onResult:async(c,status,note)=>{if(status!=='Running')console.log(c.id,status,note);}});await writeJSON(path.join(root,'report.json'),{outcomes});if(outcomes.some(r=>r.status!=='Pass'))process.exitCode=1;}finally{await engine.stop();}
