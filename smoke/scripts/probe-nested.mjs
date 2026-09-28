import path from 'node:path';
import {mkdtemp,cp} from 'node:fs/promises';
import {checkPrepared} from '../runner/prepare.mjs';
import {PackagedEngine,ProjectSession,still} from '../runner/interactions.mjs';
import {ROOT,dataDirectory,writeJSON} from '../runner/files.mjs';
const {plan,fixtures,schema}=await checkPrepared();
const root=await mkdtemp(path.join(dataDirectory(),'runs/nested-probe-'));
console.log(root);await cp(plan.fixtureRoot,path.join(root,'media'),{recursive:true});
const engine=new PackagedEngine(plan,root,'nested-probe',schema);
try{
  await engine.start();const c=new ProjectSession(engine,'nested',fixtures);await c.setup();
  const inner=c.main,parent=await c.timeline('Parent');
  await c.call('timeline.place_cuts',{id:'nest',timeline_id:parent.id,cuts:[{id:'nested',source:{timeline_id:inner.id},source_range:{start_seconds:0,end_seconds:4},streams:'video_only',destination:{at:{seconds:0,track:parent.video}}}]});
  await writeJSON(path.join(root,'nested.json'),await c.inspect(parent));
  c.main=parent;await still(c,'nested');console.log('NESTED RENDERED');
}catch(error){console.log(error.message);await writeJSON(path.join(root,'failure.json'),{message:error.message});process.exitCode=1;}
finally{await engine.stop();}
