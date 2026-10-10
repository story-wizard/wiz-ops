import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {captureDesktop} from './diagnostics.mjs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {appendFile,cp} from 'node:fs/promises';
import {desktopCall,nativeCall,captureDesktopFailure} from './adapter.mjs';
import {readJSON,writeJSON,sha} from '../runner/files.mjs';
import {failureStatus,assert,pause,OutcomeError,clips,bounds,near} from '../runner/engine.mjs';

// A normal finish is required: a prior Fail cannot explain a later script crash.
// Exit 1 with that receipt retains ordinary non-Pass verdicts and permits independent checks.
export function desktopScriptTimeout(cases){
 const budgets=cases.filter(c=>c.scriptTimeoutMs!==undefined).map(c=>c.scriptTimeoutMs);
 assert(budgets.every(ms=>Number.isInteger(ms)&&ms>=1000&&ms<=600000),'Desktop driver budgets must be 1000–600000 milliseconds');
 // Each declared per-check budget survives aggregation; ordinary authored drivers retain their default.
 return Math.max(120000,budgets.reduce((total,ms)=>total+ms,0));
}
export function requireScriptReceipt(receipt,name){
 if(receipt.timedOut||receipt.overflow||receipt.aborted){const e=new OutcomeError(name+' was interrupted before a terminal report; outcome unknown. Inspect the retained receipts before retrying.','Unknown');e.diagnostics={timedOut:!!receipt.timedOut,overflow:!!receipt.overflow,aborted:!!receipt.aborted,exitCode:receipt.code,signal:receipt.signal||null};throw e;}
}
export function requireScriptCompletion(receipt,report,name){
 requireScriptReceipt(receipt,name);
 const explained=report.results.some(r=>['Fail','Blocked'].includes(r.status));
 assert(report.completed===true&&!receipt.aborted&&!receipt.timedOut&&(receipt.code===0||receipt.code===1&&explained)&&!report.fatal&&!report.results.some(r=>r.status==='Unknown'),`${name} did not complete safely (exit ${receipt.code}); inspect its execution receipt and report.`);
}

export function requirePassed(results,ids){
 const missing=ids.filter(id=>results.find(r=>r.id===id)?.status!=='Pass');
 if(missing.length)throw new OutcomeError('Required checks did not pass: '+missing.map(id=>id+' ('+(results.find(r=>r.id===id)?.status||'not executed')+')').join(', '),'Blocked');
}
export async function waitForObservation(fn,{description='Expected observation',timeoutMs=5000,intervalMs=100,stableForMs=0}={}){
 assert(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000&&Number.isFinite(intervalMs)&&intervalMs>0&&Number.isFinite(stableForMs)&&stableForMs>=0&&stableForMs<=2000&&stableForMs<=timeoutMs,'Observation wait must be bounded');
 const started=performance.now();let attempts=0,last,previous,stableSince;
 do{
  attempts++;last=await fn();const now=performance.now();
  if(last){if(stableSince===undefined||!isDeepStrictEqual(previous,last)){previous=stableForMs?structuredClone(last):last;stableSince=now;}if(now-started<=timeoutMs&&now-stableSince>=stableForMs)return last;}
  else{previous=undefined;stableSince=undefined;}
  await pause(Math.min(intervalMs,Math.max(0,timeoutMs-(performance.now()-started))));
 }while(performance.now()-started<timeoutMs);
 const e=new OutcomeError(description+' did not arrive within '+timeoutMs+'ms ('+attempts+' observations).');e.diagnostics={expected:description,elapsedMs:performance.now()-started,attempts,stableForMs,lastObservation:last??null};throw e;
}
// A read-only geometry result is a readiness observation, never an input reservation.
export function usableGeometry(ui,target){
 const keys=['x','y','width','height'],rect=target?.visibleRect;
 if(!target?.enabled||!target.window||!keys.every(k=>Number.isFinite(target[k]))||target.width<=0||target.height<=0||rect&&(!keys.every(k=>Number.isFinite(rect[k]))||rect.width<=0||rect.height<=0)||ui.modalWindow&&ui.modalWindow!==target.window||ui.popupWindow&&ui.popupWindow!==target.window)return false;
 return Object.fromEntries(['id','window','nativeWindow',...keys,'visibleRect'].filter(k=>target[k]!==undefined).map(k=>[k,target[k]]));
}
export function requireExactTimingFixture(snapshot){
 const timed=clips(snapshot).filter(c=>c.source?.timing==='timed');
 const rejected=timed.filter(c=>c.source.projection_status!=='exact');
 if(!timed.length||rejected.length)throw new OutcomeError('Source timing fixture is not exact: '+JSON.stringify(rejected.map(c=>({clip:c.clip_id,status:c.source.projection_status,diagnostics:c.source.projection_diagnostics}))),'Blocked');
}
export function requireValidSourceTiming(source){
 const range=source?.source_range;
 assert(['exact','carrier'].includes(source?.projection_status)&&Array.isArray(source.projection_diagnostics)&&source.projection_diagnostics.length===0&&source.source_availability==='bounded','Source projection is rejected or unavailable');
 assert(range&&Number.isFinite(range.start_seconds)&&Number.isFinite(range.end_seconds)&&range.start_seconds>=0&&range.end_seconds>range.start_seconds&&Number.isFinite(source.fps)&&source.fps>0,'Source timing range or clock is invalid');
 for(const value of [range.start_seconds,range.end_seconds])near(value*source.fps,Math.round(value*source.fps),'Source frame alignment');
 return source.projection_status;
}
export function requireOrdinaryTimingFixture(snapshot,clipId){
 try{
  const matches=clips(snapshot).filter(c=>c.clip_id===clipId),rate=snapshot.timeline?.fps;
  assert(matches.length===1&&snapshot.next_cursor==null,'Incomplete or ambiguous timing fixture');
  const item=matches[0];requireValidSourceTiming(item.source);
  assert(item.source.timing==='timed'&&item.speed===1&&Number.isFinite(rate)&&rate>0&&item.source.fps===rate,'Fixture needs ordinary same-clock timing');
  near(item.source.source_range.end_seconds-item.source.source_range.start_seconds,item.timeline_range.end_seconds-item.timeline_range.start_seconds,'Fixture source duration');
  for(const value of [item.timeline_range.start_seconds,item.timeline_range.end_seconds])near(value*rate,Math.round(value*rate),'Fixture timeline frame alignment');
 }catch(e){throw new OutcomeError('Source timing fixture is not ordinary: '+e.message,'Blocked');}
}
export function timelineDockToOpen(ui){
 const canvases=ui.widgets.filter(w=>w.class==='TimelineWidget');
 if(canvases.length){
  const panels=new Set(canvases.map(w=>w.timelinePanel)),windows=new Set(canvases.map(w=>w.window));
  if(canvases.length===1||panels.size===1&&!panels.has(undefined)&&windows.size===1&&!windows.has(undefined))return null;
  throw new OutcomeError('Timeline dock is ambiguous across panels','Blocked');
 }
 const tabs=ui.widgets.filter(w=>w.name==='dockWidgetTabLabel'&&w.text==='Timeline');
 if(tabs.length!==1)throw new OutcomeError('Timeline dock is absent or ambiguous','Blocked');
 return tabs[0];
}
export function timelineCanvas(ui,trackId){
 const canvases=ui.widgets.filter(w=>w.class==='TimelineWidget');
 timelineDockToOpen(ui);
 const matches=trackId?canvases.filter(w=>w.trackIdsTruncated===false&&w.trackIds?.includes(trackId))
  :canvases.length===1?canvases:canvases.filter(w=>w.clipIdsTruncated===false&&w.clipIds?.length);
 if(matches.length!==1)throw new OutcomeError('Timeline canvas is absent or ambiguous; supply the intended track identity','Blocked');
 return matches[0];
}
export function scopeSelections(type,tap){
 const modes=['Histogram','Waveform (Luma)','Waveform (RGB)','RGB Parade'],taps=['Post IDT','Post Primary','Pre DVT'];
 assert(modes.every(mode=>type?.items?.includes(mode))&&taps.every(value=>tap?.items?.includes(value)),'Required scope modes or taps are absent');
 return modes.map(mode=>({mode,index:type.items.indexOf(mode)}));
}
export function missingCheckOperations(id,schema){
 // Spellbook checks need semantic identities as well as visible controls.
 if(!/^[DP]-SB-/.test(id))return [];
 return ['spellbook.list','spellbook.inspect'].filter(op=>!schema?.operations?.[op]);
}
export function visiblePlayhead(ui,fps=24){
 if(!Number.isFinite(fps)||fps<=0)throw new OutcomeError('Playback readout needs a valid timeline clock','Blocked');
 const main=ui.widgets.filter(w=>w.class==='MainWindow');
 const controls=ui.widgets.filter(w=>main.length===1&&w.window===main[0].id);
 const labels=controls.filter(w=>w.name==='previewCurrentTimecode'&&/^\d+:\d{2}:\d{2}:\d{2}$/.test(w.text||''));
 if(labels.length===1){const [h,m,s,f]=labels[0].text.split(':').map(Number);if(m>=60||s>=60||f>=Math.ceil(fps))throw new OutcomeError('Visible timecode is invalid for the timeline clock','Blocked');return {kind:'timecode',seconds:h*3600+m*60+s+f/fps,widget:labels[0].id,text:labels[0].text};}
 const bars=controls.filter(w=>w.name==='previewScrubBar'&&Number.isFinite(w.value)&&Number.isFinite(w.minimum)&&Number.isFinite(w.maximum)&&w.value>=w.minimum&&w.value<=w.maximum);
 if(labels.length||bars.length!==1||controls.some(w=>w.name==='previewCurrentTimecode'))throw new OutcomeError('No unique visible playback readout is available; inspect the current preview controls and update the binding','Blocked');
 return {kind:'scrubber',seconds:bars[0].value/1000,widget:bars[0].id};
}
export function curveResetControl(ui,editorId){
 const widgets=ui.widgets,ancestor=(widget,test)=>{const seen=new Set();while(widget&&!seen.has(widget.id)){if(test(widget))return widget;seen.add(widget.id);widget=widgets.find(w=>w.id===widget.parent);}return null;};
 const editor=widgets.find(w=>w.id===editorId),owner=ancestor(editor,w=>w.class.endsWith('CurvesPanel'));
 // Floating panel chrome is a sibling of the content, rather than its descendant.
 const buttons=widgets.filter(w=>owner&&w.enabled&&/^(Reset every curve|Reset all curves)/.test(w.tooltip||'')&&(ancestor(w,p=>p.id===owner.id)||w.name==='panelChromeAction'&&editor.window&&w.window===editor.window));
 if(buttons.length!==1)throw new OutcomeError('No unique supported Curves reset control is available in the active panel','Blocked');
 return buttons[0];
}
export function isNeutralCurve(curve,kind){
 const points=curve?.value?.points;
 if(!['rgb','hue'].includes(kind)||curve?.schema_id!=='wiz.color.bspline_curve.v1'||curve.schema_version!==1||!Array.isArray(points)||points.length<2)return false;
 if(!points.every((p,i)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&(!i||p.x>points[i-1].x)&&Math.abs(p.y-(kind==='rgb'?p.x:0))<1e-6))return false;
 return kind==='hue'||points[0].x===0&&points.at(-1).x===1;
}
export function sourceColorControl(ui,graphId){
 const labels=ui.widgets.filter(w=>w.graphView===graphId&&['Color Space','Input Color Space'].includes(w.text));
 const controls=ui.widgets.filter(w=>w.graphView===graphId&&w.enabled&&(
  w.class==='RenderGraphEnumButton'&&labels.some(label=>label.parent===w.parent)||
  w.class==='QComboBox'&&w.items?.some(text=>/auto|detect/i.test(text))&&w.items.some(text=>/sRGB|ACEScg|Rec\.709/.test(text))));
 if(controls.length!==1)throw new OutcomeError('No unique editable source colour control is bound to the selected graph','Blocked');
 return controls[0];
}
export function hasAuthoredSourceColor(graph,type,value){
 const nodes=graph.nodes.filter(n=>n.type===type);
 return nodes.length===1&&nodes[0].params?.['input.cst.src']===value&&nodes[0].params['input.cst.src.provenance']==='authored';
}
export function menuValuePath(items,value){
 const matches=[];
 function visit(rows,parents,depth){if(depth>4)return;for(const item of rows||[]){if(!item.enabled)continue;const next=[...parents,item];if(!item.submenu&&item.value===value)matches.push(next);if(item.items)visit(item.items,next,depth+1);}}
 visit(items,[],0);
 if(matches.length!==1)throw new OutcomeError('Menu value is absent or ambiguous: '+value,'Blocked');
 return matches[0];
}
export async function selectMenuValue({n,ui,until},menu,value){
 const sequence=menuValuePath(menu.menuItems,value);let currentId=menu.id;
 for(const expected of sequence){
  const observed=await until(async()=>(await ui()).widgets.find(w=>w.id===currentId&&w.class==='QMenu'),{description:'Source colour menu is visible'});
  const action=observed.menuItems.find(item=>item.id===expected.id&&item.enabled);assert(action&&action.width>0&&action.height>0,'Observed menu action is not selectable');
  await n('click',{target:observed.id,x:action.x+action.width/2,y:action.y+action.height/2});
  currentId=action.submenu;
 }
 await until(async()=>!(await ui()).widgets.some(w=>w.id===menu.id),{description:'Source colour choice committed'});
 return {value,path:sequence.map(item=>item.text)};
}
export function verifyLoopSamples(samples,inFrame,outFrame){
 assert(Number.isInteger(inFrame)&&Number.isInteger(outFrame)&&outFrame>inFrame&&samples.length>=8,'Loop observations or marked bounds are incomplete');
 assert(samples.every(s=>s.playing&&!s.scrubbing&&Number.isInteger(s.frame)&&s.frame>=inFrame&&s.frame<=outFrame),'Playback left the marked range or stopped');
 const wraps=samples.filter((s,i)=>i&&samples[i-1].frame-s.frame>=Math.max(2,(outFrame-inFrame)/2)).length;
 assert(wraps>=2&&new Set(samples.map(s=>s.frame)).size>=5&&samples.some(s=>s.frame>=outFrame-3),'Playback did not advance to the boundary and wrap twice');
 return {inFrame,outFrame,wraps,samples:samples.length};
}
export function verifyTrimmedClip(before,after,timelineFps){
 // Same-clock Fresh fixture; cross-rate trimming needs its own rational timing oracle.
 assert(before.clip_id===after.clip_id&&before.source.asset_id===after.source.asset_id,'Trim identity changed');
 near(after.timeline_range.start_seconds,before.timeline_range.start_seconds,'Trim left edge preserved');
 assert(after.timeline_range.end_seconds>after.timeline_range.start_seconds&&after.timeline_range.end_seconds<before.timeline_range.end_seconds,'Right trim did not shorten the intended edge');
 const source=after.source,range=source.source_range;
 requireValidSourceTiming(source);
 near(range.start_seconds,before.source.source_range.start_seconds,'Source start preserved');
 near(range.end_seconds-range.start_seconds,after.timeline_range.end_seconds-after.timeline_range.start_seconds,'Trim source duration');
 assert(Number.isFinite(source.fps)&&source.fps>0&&Number.isFinite(timelineFps)&&timelineFps>0,'Trim clocks are absent');
 for(const [value,rate] of [[range.start_seconds,source.fps],[range.end_seconds,source.fps],[after.timeline_range.start_seconds,timelineFps],[after.timeline_range.end_seconds,timelineFps]])near(value*rate,Math.round(value*rate),'Trim frame alignment');
 return {projection:source.projection_status,sourceRange:range,timelineRange:after.timeline_range};
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

export async function twentyCutFixture(c,assets,name='Twenty-cut scrub smoke',onGrade=async()=>{}){
 const t=await c('timeline.create',{name,video_format:{preset:'hd_1080p_24'},audio:{sample_rate:48000,channels:2}});
 await c('timeline.place_cuts',{id:'scrub-cuts',timeline_id:t.timeline_id,cuts:Array.from({length:20},(_,i)=>({id:'cut'+i,source:{asset_id:i%2?assets.motion:assets.plate},source_range:{start_seconds:1,end_seconds:2},streams:'video_only',destination:{at:{seconds:i,track:t.tracks.find(t=>t.kind==='video').track_id}}}))});
 const cuts=(await c('timeline.inspect',{timeline_id:t.timeline_id})).tracks.flatMap(t=>t.items.filter(i=>i.kind==='clip')),grades=[];
 assert(cuts.length===20,'Twenty-cut fixture has the wrong clip count');
 for(let i=1;i<cuts.length;i+=2){
  const scope={timeline_id:t.timeline_id,clip_id:cuts[i].clip_id},g=await c('graph.get_clip_graph',scope),edge=g.edges.find(e=>e.from_node===g.nodes.find(n=>n.type==='transform_2d').node_id&&e.to_node===g.nodes.find(n=>n.type==='composite').node_id);assert(edge,'Fixture clip has no transform-to-composite edge');
  // Readback reports a projected timeline revision, while single-edge edits
  // gate on clip-local revisions. Use the public atomic batch, serialized by
  // desktopCall's owned bundle-revision guard, and verify the inserted graph.
  await c('graph.edit_batch',{...scope,ops:[{op:'insert_on_edge',local_ref:-1,type:'wiz.color.grading_primary',from_node:edge.from_node,from_slot:edge.from_slot,to_node:edge.to_node,to_slot:edge.to_slot,edge_type:edge.type,new_input_slot:'input',new_output_slot:'output',params:{'grade.primary.saturation':0}}]});
  const after=await c('graph.get_clip_graph',scope),added=after.nodes.filter(n=>!g.nodes.some(before=>before.node_id===n.node_id)),grade=added[0];
  assert(after.nodes.length===g.nodes.length+1&&added.length===1&&grade.type==='wiz.color.grading_primary'&&grade.params?.['grade.primary.saturation']===0,'Fixture saturation grade is missing or incorrect');
  assert(after.edges.length===g.edges.length+1&&after.edges.some(e=>e.from_node===edge.from_node&&e.from_slot===edge.from_slot&&e.to_node===grade.node_id&&e.to_slot==='input')&&after.edges.some(e=>e.from_node===grade.node_id&&e.from_slot==='output'&&e.to_node===edge.to_node&&e.to_slot===edge.to_slot)&&!after.edges.some(e=>e.from_node===edge.from_node&&e.to_node===edge.to_node&&e.from_slot===edge.from_slot&&e.to_slot===edge.to_slot),'Fixture grade is not inserted on the intended edge');
  grades.push({index:i,scope,before:g,after});await onGrade({timelineId:t.timeline_id,clipIds:cuts.map(c=>c.clip_id),grades});
 }

 return {timelineId:t.timeline_id,clipIds:cuts.map(c=>c.clip_id),grades};
}

export const selectorNamesTimeline=(label,name)=>typeof label==='string'&&label.replace(/ \(\d+\)$/,'')===name;
export async function captureInvestigation(file,id,phase,capture=captureDesktop){
 const s=await readJSON(file);if(s.plan?.recipe?.selection?.diagnostics!=='investigation'||!s.pid||s.state!=='Running')return null;
 const directory=path.join(s.root,'evidence','diagnostic-'+randomUUID());let error=null;
 try{await capture(file,directory);for(const stream of ['stdout','stderr'])await cp(path.join(directory,stream+'.log'),path.join(directory,stream+'.txt'));}catch(e){error=e.message;}
 const manifest=path.join(s.root,'diagnostic-'+randomUUID()+'.json'),at=new Date().toISOString();
 const artifacts=error?[]:[path.join(directory,'state.json'),path.join(directory,'window.png'),path.join(directory,'stdout.txt'),path.join(directory,'stderr.txt')];
 const files=[];try{for(const file of artifacts)files.push({path:file,sha256:await sha(file)});}catch(e){error=e.message;}
 await writeJSON(manifest,{format:'athanor-diagnostic-capture/v1',files,id,phase,at,pid:s.pid,generation:s.generation??null,artifacts,status:error?'Collection incomplete':'Collected',error,profile:'investigation',appTracing:'Not configured',profiling:'Not configured'});
 await appendFile(path.join(s.root,'operations.jsonl'),JSON.stringify({caseId:id,operation:'diagnostic.capture',at,phase,pid:s.pid,generation:s.generation??null,status:error?'Incomplete':'Completed',evidence:{artifacts:[manifest,...artifacts]}})+'\n');return {manifest,artifacts,error};
}
export async function beginCheck(file,id){
 const s=await readJSON(file);if(s.selectedChecks&&!s.selectedChecks.includes(id))return false;
 s.currentCheck=id;s.currentStep=null;await writeJSON(file,s);
 await captureInvestigation(file,id,'before');
 await appendFile(path.join(s.root,'check-events.jsonl'),JSON.stringify({id,status:'Running',at:new Date().toISOString()})+'\n');return true;
}
export async function endCheck(file,result){
 if(!['Pass','Fail','Blocked','Unknown','N/A'].includes(result.status))result.status=failureStatus(result);
 await captureInvestigation(file,result.id,'after');
 const s=await readJSON(file);await appendFile(path.join(s.root,'check-events.jsonl'),JSON.stringify({...result,at:new Date().toISOString()})+'\n');
}
export async function recordStep(file,definition,fn){
 const session=await readJSON(file);if(!session.currentCheck||session.currentStep)throw Error('A step requires an active check and cannot be nested.');
 if(!definition?.id||!definition.title)throw Error('A step needs an ID and readable title.');
 const journal=path.join(session.root,'steps.jsonl'),entry={caseId:session.currentCheck,stepId:definition.id,title:definition.title,phase:definition.phase||'execute'};
 session.currentStep=definition.id;await writeJSON(file,session);await appendFile(journal,JSON.stringify({...entry,status:'Running',at:new Date().toISOString()})+'\n');
 try{const value=await fn();await appendFile(journal,JSON.stringify({...entry,status:'Completed',at:new Date().toISOString()})+'\n');return value;}
 catch(e){await appendFile(journal,JSON.stringify({...entry,status:failureStatus(e),observation:e.message,at:new Date().toISOString()})+'\n');throw e;}
 finally{const latest=await readJSON(file);latest.currentStep=null;await writeJSON(file,latest);}
}
export function widgetPixelDifference(a,b){
  const rgb=v=>{assert(v.sampleWidth===64&&v.sampleHeight===32&&typeof v.sampleRgb==='string','Invalid widget raster');const bytes=Buffer.from(v.sampleRgb,'base64');assert(bytes.length===64*32*3,'Incomplete widget pixels');return bytes;};
  const x=rgb(a),y=rgb(b);return x.reduce((sum,v,i)=>sum+Math.abs(v-y[i]),0)/x.length;
}
export function requireRedGraphic(image){
 widgetPixelDifference(image,image);const rgb=Buffer.from(image.sampleRgb,'base64');let red=0,total=0;
 // The local fixture has a red background. Sample away from its central title and letterboxing.
 for(let y=8;y<24;y++)for(let x=8;x<24;x++){const i=(y*64+x)*3;total++;if(rgb[i]>160&&rgb[i]>rgb[i+1]*1.8&&rgb[i]>rgb[i+2]*1.8)red++;}
 assert(red/total>.75,'Preview does not show the known red graphic fixture');return {redFraction:red/total};
}
export function livePreviewEvidence(baseline,samples,receipt){
 const held=samples.filter(x=>x.startedAt>=receipt.pointerDownAt&&x.finishedAt<=receipt.pointerUpAt),changed=held.filter(x=>widgetPixelDifference(x.image,baseline)>1.5);
 assert(held.length>=3,'Insufficient preview samples during the held gesture');assert(changed.length>=3,'Displayed preview did not update during the held gesture');
 const evolving=held.filter((x,i)=>i&&widgetPixelDifference(x.image,held[i-1].image)>.1);assert(evolving.length>=2,'Displayed preview did not evolve through the gesture');
 for(const x of held){const rgb=Buffer.from(x.image.sampleRgb,'base64');assert(rgb.reduce((a,b)=>a+b,0)/rgb.length>5,'Preview became blank during drag');}
 return {samplesDuringHold:held.length,changedSamples:changed.length,evolvingSamples:evolving.length,maxCaptureMs:Math.max(...held.map(x=>x.finishedAt-x.startedAt)),maxSampleGapMs:Math.max(...held.slice(1).map((x,i)=>x.startedAt-held[i].startedAt))};
}

export async function failedCheckEvidence(file,error,id){
 const captured=await captureDesktopFailure(file,error,id),collected=error.evidence||{};
 return {...collected,...captured,artifacts:[...new Set([...(collected.artifacts||[]),...(captured.artifacts||[])])]};
}

export async function checks(file,name){
  const s=await readJSON(file),report={scope:s.scope,inputMode:s.inputMode||'desktop',pid:s.pid,generation:s.generation,results:[]};
  const output=path.join(s.root,name),n=(op,p)=>nativeCall(file,op,p),c=(op,p,e)=>desktopCall(file,op,p,e),ui=()=>n('inspect');
  const until=waitForObservation;
  async function check(id,fn,requires=[]){if(!await beginCheck(file,id))return;try{const missing=missingCheckOperations(id,s.schema);if(missing.length){const error=new OutcomeError('Selected build cannot run '+id+': missing '+missing.join(', ')+'. Choose a build that exposes these operations.','Blocked');error.diagnostics={missingOperations:missing};throw error;}requirePassed(report.results,requires);report.results.push({id,status:'Pass',evidence:await fn()});}catch(e){report.results.push({id,status:failureStatus(e),error:e.message,diagnostics:e.diagnostics||null,evidence:await failedCheckEvidence(file,e,id)});if(e.status==='Unknown'||e.fatal){report.fatal=e.message;await writeJSON(output,report);throw e;}}finally{if(report.results.at(-1)?.id===id)await endCheck(file,report.results.at(-1));}await writeJSON(output,report);}
  async function activate(w){for(let i=0;i<10;i++){await n('activate',{target:w.window});await pause(100);if((await ui()).widgets.some(a=>a.id===w.window&&a.active))return;}const e=new OutcomeError('The owned smoke window could not retain keyboard focus; unlock the desktop before retrying','Blocked');e.fatal=true;throw e;}
  async function action(text){const matches=(await ui()).actions.filter(a=>a.text===text&&a.enabled);assert(matches.length===1,`Expected one enabled action: ${text}`);await n('action',{target:matches[0].id});}
  async function mediaItem(name){return until(async()=>(await ui()).widgets.find(w=>w.class==='QTreeView'&&w.model?.some(r=>r[0]===name)),{description:'Media item '+name});}
  async function mediaMenu(name,label){
    const view=await mediaItem(name);await activate(view);await n('item-click',{target:view.id,text:name,context:true});
    const menu=await until(async()=>(await ui()).widgets.find(w=>w.class==='QMenu'&&w.menuItems?.some(a=>a.text===label&&a.enabled)));
    const actions=menu.menuItems.filter(a=>a.text===label&&a.enabled);assert(actions.length===1,'Menu action is ambiguous');const a=actions[0];
    await n('click',{target:menu.id,x:a.x+Math.floor(a.width/2),y:a.y+Math.floor(a.height/2)});await until(async()=>!(await ui()).widgets.some(w=>w.id===menu.id));
  }
  async function openTimeline(name,trackId){const tab=timelineDockToOpen(await ui());if(tab){await n('click',{target:tab.id});await until(async()=>(await ui()).widgets.some(w=>w.class==='TimelineWidget'),{description:'Timeline dock is visible'});}const view=await mediaItem(name);await activate(view);await n('item-click',{target:view.id,text:name,double:true});await until(async()=>(await ui()).widgets.some(w=>w.name==='panelSubtabSelector'&&selectorNamesTimeline(w.text,name)),{description:'Timeline '+name+' is open'});const v=timelineCanvas(await ui(),trackId);await activate(v);return v;}
  function finish(){report.completed=true;writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.results.some(r=>r.status!=='Pass'))process.exitCode=1;}
  return {s,report,n,c,ui,until,check,step:(definition,fn)=>recordStep(file,definition,fn),activate,action,mediaItem,mediaMenu,openTimeline,finish};
}
