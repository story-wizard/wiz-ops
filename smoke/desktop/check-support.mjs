import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {appendFile} from 'node:fs/promises';
import {desktopCall,nativeCall} from './adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,pause,OutcomeError} from '../runner/engine.mjs';

export const selectorNamesTimeline=(label,name)=>typeof label==='string'&&label.replace(/ \(\d+\)$/,'')===name;
export async function beginCheck(file,id){
 const s=await readJSON(file);if(s.selectedChecks&&!s.selectedChecks.includes(id))return false;
 s.currentCheck=id;await writeJSON(file,s);
 await appendFile(path.join(s.root,'check-events.jsonl'),JSON.stringify({id,status:'Running',at:new Date().toISOString()})+'\n');return true;
}
export async function endCheck(file,result){
 const s=await readJSON(file);await appendFile(path.join(s.root,'check-events.jsonl'),JSON.stringify({...result,at:new Date().toISOString()})+'\n');
}
export function widgetPixelDifference(a,b){
  const rgb=v=>{assert(v.sampleWidth===64&&v.sampleHeight===32&&typeof v.sampleRgb==='string','Invalid widget raster');const bytes=Buffer.from(v.sampleRgb,'base64');assert(bytes.length===64*32*3,'Incomplete widget pixels');return bytes;};
  const x=rgb(a),y=rgb(b);return x.reduce((sum,v,i)=>sum+Math.abs(v-y[i]),0)/x.length;
}

export async function checks(file,name){
  const s=await readJSON(file),report={scope:s.scope,inputMode:s.inputMode||'desktop',pid:s.pid,generation:s.generation,results:[]};
  const output=path.join(s.root,name),n=(op,p)=>nativeCall(file,op,p),c=(op,p,e)=>desktopCall(file,op,p,e),ui=()=>n('inspect');
  async function until(fn){for(let i=0;i<50;i++){const v=await fn();if(v)return v;await pause(100);}throw Error('Expected observation did not arrive within five seconds');}
  async function check(id,fn){if(!await beginCheck(file,id))return;try{report.results.push({id,status:'Pass',evidence:await fn()});}catch(e){report.results.push({id,status:e.status||'Fail',error:e.message});if(e.status==='Unknown'||e.fatal){report.fatal=e.message;await writeJSON(output,report);throw e;}}finally{if(report.results.at(-1)?.id===id)await endCheck(file,report.results.at(-1));}await writeJSON(output,report);}
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
  function finish(){writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.results.some(r=>r.status!=='Pass'))process.exitCode=1;}
  return {s,report,n,c,ui,until,check,activate,action,mediaItem,mediaMenu,openTimeline,finish};
}
