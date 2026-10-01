import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {appendFile} from 'node:fs/promises';
import {desktopCall,nativeCall} from './adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,pause,OutcomeError,clips,bounds} from '../runner/engine.mjs';

// A normal finish is required: a prior Fail cannot explain a later script crash.
// Exit 1 with that receipt retains ordinary non-Pass verdicts and permits independent checks.
export function requireScriptCompletion(receipt,report,name){
 const explained=report.results.some(r=>['Fail','Blocked'].includes(r.status));
 assert(report.completed===true&&!receipt.aborted&&!receipt.timedOut&&(receipt.code===0||receipt.code===1&&explained)&&!report.fatal&&!report.results.some(r=>r.status==='Unknown'),`${name} did not complete safely (exit ${receipt.code}); inspect its execution receipt and report.`);
}

export function requirePassed(results,ids){
 const missing=ids.filter(id=>results.find(r=>r.id===id)?.status!=='Pass');
 if(missing.length)throw new OutcomeError('Required checks did not pass: '+missing.map(id=>id+' ('+(results.find(r=>r.id===id)?.status||'not executed')+')').join(', '),'Blocked');
}
export function requireExactTimingFixture(snapshot){
 const timed=clips(snapshot).filter(c=>c.source?.timing==='timed');
 const rejected=timed.filter(c=>c.source.projection_status!=='exact');
 if(!timed.length||rejected.length)throw new OutcomeError('Source timing fixture is not exact: '+JSON.stringify(rejected.map(c=>({clip:c.clip_id,status:c.source.projection_status,diagnostics:c.source.projection_diagnostics}))),'Blocked');
}
export async function gapFixture(c,assets,name){
 try{
  const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}}),track=t.tracks.find(x=>x.kind==='video').track_id;
  await c('timeline.place_cuts',{id:'gap-'+t.timeline_id,timeline_id:t.timeline_id,cuts:[
   {id:'plate',source:{asset_id:assets.plate},source_range:{start_seconds:1,end_seconds:5},streams:'video_only',destination:{at:{seconds:0,track}}},
   {id:'motion',source:{asset_id:assets.motion},source_range:{start_seconds:0,end_seconds:2},streams:'video_only',destination:{at:{seconds:6,track}}}
  ]});
  const before=await c('timeline.inspect',{timeline_id:t.timeline_id}),items=clips(before);assert(items.length===2,'Expected two fixture clips');
  bounds(items[0],0,4,1,5);bounds(items[1],6,8,0,2);assert(items[0].source.asset_id===assets.plate&&items[1].source.asset_id===assets.motion,'Fixture source identities differ');return before;
 }catch(e){throw new OutcomeError(name+' setup: '+e.message,e.status==='Unknown'?'Unknown':'Blocked');}
}

export const selectorNamesTimeline=(label,name)=>typeof label==='string'&&label.replace(/ \(\d+\)$/,'')===name;
export async function beginCheck(file,id){
 const s=await readJSON(file);if(s.selectedChecks&&!s.selectedChecks.includes(id))return false;
 s.currentCheck=id;s.currentStep=null;await writeJSON(file,s);
 await appendFile(path.join(s.root,'check-events.jsonl'),JSON.stringify({id,status:'Running',at:new Date().toISOString()})+'\n');return true;
}
export async function endCheck(file,result){
 const s=await readJSON(file);await appendFile(path.join(s.root,'check-events.jsonl'),JSON.stringify({...result,at:new Date().toISOString()})+'\n');
}
export async function recordStep(file,definition,fn){
 const session=await readJSON(file);if(!session.currentCheck||session.currentStep)throw Error('A step requires an active check and cannot be nested.');
 if(!definition?.id||!definition.title)throw Error('A step needs an ID and readable title.');
 const journal=path.join(session.root,'steps.jsonl'),entry={caseId:session.currentCheck,stepId:definition.id,title:definition.title,phase:definition.phase||'execute'};
 session.currentStep=definition.id;await writeJSON(file,session);await appendFile(journal,JSON.stringify({...entry,status:'Running',at:new Date().toISOString()})+'\n');
 try{const value=await fn();await appendFile(journal,JSON.stringify({...entry,status:'Completed',at:new Date().toISOString()})+'\n');return value;}
 catch(e){await appendFile(journal,JSON.stringify({...entry,status:e.status||'Fail',observation:e.message,at:new Date().toISOString()})+'\n');throw e;}
 finally{const latest=await readJSON(file);latest.currentStep=null;await writeJSON(file,latest);}
}
export function widgetPixelDifference(a,b){
  const rgb=v=>{assert(v.sampleWidth===64&&v.sampleHeight===32&&typeof v.sampleRgb==='string','Invalid widget raster');const bytes=Buffer.from(v.sampleRgb,'base64');assert(bytes.length===64*32*3,'Incomplete widget pixels');return bytes;};
  const x=rgb(a),y=rgb(b);return x.reduce((sum,v,i)=>sum+Math.abs(v-y[i]),0)/x.length;
}
export function livePreviewEvidence(baseline,samples,receipt){
 const held=samples.filter(x=>x.startedAt>=receipt.pointerDownAt&&x.finishedAt<=receipt.pointerUpAt),changed=held.filter(x=>widgetPixelDifference(x.image,baseline)>1.5);
 assert(held.length>=3,'Insufficient preview samples during the held gesture');assert(changed.length>=3,'Displayed preview did not update during the held gesture');
 const evolving=held.filter((x,i)=>i&&widgetPixelDifference(x.image,held[i-1].image)>.1);assert(evolving.length>=2,'Displayed preview did not evolve through the gesture');
 for(const x of held){const rgb=Buffer.from(x.image.sampleRgb,'base64');assert(rgb.reduce((a,b)=>a+b,0)/rgb.length>5,'Preview became blank during drag');}
 return {samplesDuringHold:held.length,changedSamples:changed.length,evolvingSamples:evolving.length,maxCaptureMs:Math.max(...held.map(x=>x.finishedAt-x.startedAt)),maxSampleGapMs:Math.max(...held.slice(1).map((x,i)=>x.startedAt-held[i].startedAt))};
}

export async function checks(file,name){
  const s=await readJSON(file),report={scope:s.scope,inputMode:s.inputMode||'desktop',pid:s.pid,generation:s.generation,results:[]};
  const output=path.join(s.root,name),n=(op,p)=>nativeCall(file,op,p),c=(op,p,e)=>desktopCall(file,op,p,e),ui=()=>n('inspect');
  async function until(fn){for(let i=0;i<50;i++){const v=await fn();if(v)return v;await pause(100);}throw Error('Expected observation did not arrive within five seconds');}
  async function check(id,fn,requires=[]){if(!await beginCheck(file,id))return;try{requirePassed(report.results,requires);report.results.push({id,status:'Pass',evidence:await fn()});}catch(e){report.results.push({id,status:e.status||'Fail',error:e.message});if(e.status==='Unknown'||e.fatal){report.fatal=e.message;await writeJSON(output,report);throw e;}}finally{if(report.results.at(-1)?.id===id)await endCheck(file,report.results.at(-1));}await writeJSON(output,report);}
  async function activate(w){for(let i=0;i<10;i++){await n('activate',{target:w.window});await pause(100);if((await ui()).widgets.some(a=>a.id===w.window&&a.active))return;}const e=new OutcomeError('The owned smoke window could not retain keyboard focus; unlock the desktop before retrying','Blocked');e.fatal=true;throw e;}
  async function action(text){const matches=(await ui()).actions.filter(a=>a.text===text&&a.enabled);assert(matches.length===1,`Expected one enabled action: ${text}`);await n('action',{target:matches[0].id});}
  async function mediaItem(name){return until(async()=>(await ui()).widgets.find(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name)));}
  async function mediaMenu(name,label){
    const view=await mediaItem(name);await activate(view);await n('item-click',{target:view.id,text:name,context:true});
    const menu=await until(async()=>(await ui()).widgets.find(w=>w.class==='QMenu'&&w.menuItems?.some(a=>a.text===label&&a.enabled)));
    const actions=menu.menuItems.filter(a=>a.text===label&&a.enabled);assert(actions.length===1,'Menu action is ambiguous');const a=actions[0];
    await n('click',{target:menu.id,x:a.x+Math.floor(a.width/2),y:a.y+Math.floor(a.height/2)});await until(async()=>!(await ui()).widgets.some(w=>w.id===menu.id));
  }
  async function openTimeline(name){const view=await mediaItem(name);await activate(view);await n('item-click',{target:view.id,text:name,double:true});await until(async()=>(await ui()).widgets.some(w=>w.name==='panelSubtabSelector'&&selectorNamesTimeline(w.text,name)));const v=(await ui()).widgets.filter(w=>w.class==='TimelineWidget').sort((a,b)=>a.y-b.y)[0];assert(v,'Timeline is unavailable');await activate(v);return v;}
  function finish(){report.completed=true;writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.results.some(r=>r.status!=='Pass'))process.exitCode=1;}
  return {s,report,n,c,ui,until,check,step:(definition,fn)=>recordStep(file,definition,fn),activate,action,mediaItem,mediaMenu,openTimeline,finish};
}
