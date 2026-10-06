import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {checks,gapFixture,usableGeometry} from './check-support.mjs';
import {observedWidget} from './checklist-proof.mjs';
import {physicalInput,clipPoint} from './physical-input.mjs';
import {assert,clips,OutcomeError} from '../runner/engine.mjs';
import {writeJSON} from '../runner/files.mjs';

// Shared authored setup, physical actions and retained observations. Assertions
// stay in the check or its pure oracle; these helpers never manufacture Pass.
export async function uiWorkflows(file,reportName){
 const h=await checks(file,reportName),{s,n,c,ui,until,step}=h,retained=new Map();let sequence=0;
 const stage=(id,title,phase,fn)=>step({id,title,phase},fn),physical=(op,p)=>physicalInput(file,op,p);
 const remember=(id,p)=>{if(!retained.has(id))retained.set(id,[]);retained.get(id).push(p);};
 async function observe(id,phase,value){const p=path.join(s.root,'evidence',id+'-'+(++sequence)+'-graph-observations-'+phase+'.txt');await mkdir(path.dirname(p),{recursive:true});await writeJSON(p,value);remember(id,p);return p;}
 async function capture(id,phase,target,kind='presented'){
  const image=kind==='widget'?await n('snapshot-widget',{target}):await physical('screenshot',{target,crop:true});
  const p=path.join(s.root,'evidence',id+'-'+(++sequence)+'-'+phase+'.png');await mkdir(path.dirname(p),{recursive:true});await copyFile(image.path||image.output,p);remember(id,p);return {...image,path:p};
 }
 async function check(id,fn){return h.check(id,async()=>{try{return {...await fn(),artifacts:retained.get(id)||[]};}catch(e){e.evidence={...e.evidence,artifacts:[...(e.evidence?.artifacts||[]),...(retained.get(id)||[])]};throw e;}});}
 async function fixture(name){const before=await gapFixture(c,s.assets,name),view=await h.openTimeline(name);return {id:before.timeline.timeline_id,before,view,scope:{timeline_id:before.timeline.timeline_id,clip_id:clips(before)[0].clip_id}};}
 async function selectClip(f){const g=await n('timeline-clip-rect',{target:f.view.id,clipId:f.scope.clip_id});await physical('key',{target:f.view.id,key:'v'});await physical('click',{target:f.view.id,clipId:f.scope.clip_id,expectedClip:g.rect,...clipPoint(g)});await c('playback.seek',{time:1});}
 async function click(w,extra={}){return physical('click',{target:w.id,...extra});}
 async function type(w,text){await click(w);await physical('key',{target:w.id,key:'cmd+a'});await physical('type',{target:w.id,text});return physical('key',{target:w.id,key:'Return'});}
 const unique=(u,fn,label)=>observedWidget(u,fn,label);
 const surface=(u,fn,label)=>{const matches=u.widgets.filter(fn);if(matches.length!==1)throw new OutcomeError(label+' is absent or ambiguous','Blocked');return matches[0];};
 async function modelEntry(view,match){
  let cursor,offset=0,matches=[];
  do{const page=await n('model-page',{target:view.id,offset,limit:64,...(cursor?{cursor}:{})});cursor=page.cursor;
   page.model.forEach((r,i)=>{if(typeof match==='function'?match(r):r[0]===match)matches.push({view,page,row:offset+i,values:r});});if(!page.hasMore)break;offset=page.nextOffset;
   if(offset>4096)throw new OutcomeError('Media observation exceeds the bounded fixture size','Blocked');
  }while(true);
  if(matches.length!==1)throw new OutcomeError('Model row is absent or ambiguous: '+String(match),'Blocked');return matches[0];
 }
 async function modelRow(name){return modelEntry(surface(await ui(),w=>w.class==='QTreeView'&&Array.isArray(w.model),'Media list'),name);}
 async function value(row,column,role){return n('model-value',{target:row.view.id,offset:row.row,column,role,cursor:row.page.cursor});}
 async function search(text,source='Name'){
  const choices=(await ui()).actions.filter(a=>a.enabled&&a.text.replace(/\t\d+$/,'')===source);
  if(choices.length!==1)throw new OutcomeError('Search source is absent or ambiguous: '+source,'Blocked');await n('action',{target:choices[0].id});
  const field=unique(await ui(),w=>w.class==='MediaSearchField','Media search field');await type(field,text);
  return until(async()=>{const u=await ui(),status=unique(u,w=>w.name==='mediaSearchStatus','Search status').text||'',view=unique(u,w=>w.class==='QTreeView'&&Array.isArray(w.model),'Search results');
   if(/unavailable|error/i.test(status))throw new OutcomeError('Search backend unavailable: '+status,'Blocked');
   return unique(u,w=>w.id===field.id,'Search field').text===text&&!/searching|pending|loading/i.test(status)?{status,view,names:view.model.map(r=>r[0]),ui:u}:null;
  },{description:'Search completion',timeoutMs:15000});
 }
 async function clearSearch(){const field=unique(await ui(),w=>w.class==='MediaSearchField','Media search field');await n('text',{target:field.id,text:''});}
 async function activatePanel(title,klass){
  const label=unique(await ui(),w=>w.name==='dockWidgetTabLabel'&&w.text===title,title+' dock tab');await n('click',{target:label.id});
  await until(async()=>(await ui()).widgets.some(w=>w.class===klass||w.class.endsWith('::'+klass)),{description:title+' dock is active'});return surface(await ui(),w=>w.class===klass||w.class.endsWith('::'+klass),title+' panel');
 }
 async function floatPanel(title,klass,{width=800,height=600}={}){
  let u=await ui(),panel=surface(u,w=>w.class===klass||w.class.endsWith('::'+klass),title+' panel'),window=u.widgets.find(w=>w.id===panel.window);
  if(window.class!=='ads::CFloatingDockContainer'){
   const label=unique(u,w=>w.name==='dockWidgetTabLabel'&&w.text===title,title+' dock header');await physical('click',{target:label.id,x:label.width/2,y:label.height/2,button:'right'});
   const menu=await until(async()=>(await ui()).widgets.find(w=>w.class==='QMenu'&&w.menuItems?.some(a=>/detach|float/i.test(a.text)&&a.enabled))),entry=menu.menuItems.find(a=>/detach|float/i.test(a.text)&&a.enabled);await physical('click',{target:menu.id,x:entry.x+entry.width/2,y:entry.y+entry.height/2});
   window=await until(async()=>{const latest=await ui(),p=latest.widgets.find(w=>w.class===klass||w.class.endsWith('::'+klass)),w=latest.widgets.find(w=>w.id===p?.window);return w?.class==='ads::CFloatingDockContainer'?w:null;},{description:title+' floats'});
  }
  await n('resize-window',{target:window.id,width,height});await until(async()=>{const latest=await ui(),w=latest.widgets.find(w=>w.id===window.id);return w?.width===width&&w?.height===height?usableGeometry(latest,w):null;},{description:title+' has usable space',stableForMs:250});return surface(await ui(),w=>w.class===klass||w.class.endsWith('::'+klass),title+' floating panel');
 }
 return {...h,check,stage,physical,observe,capture,fixture,selectClip,click,type,unique,surface,modelEntry,modelRow,value,search,clearSearch,activatePanel,floatPanel,retained};
}
