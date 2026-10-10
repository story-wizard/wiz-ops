import * as adapter from './adapter.mjs';
const {nativeCall}=adapter;
import {isDeepStrictEqual} from 'node:util';
import {digest} from '../runner/files.mjs';
import {nativeDesktopInput} from './macos-input.mjs';
import {assert,pause,OutcomeError} from '../runner/engine.mjs';
import {withAdapterAction,markUnknown,fields,requireProof,validateTimelinePoint} from './agent-proof.mjs';

const inputFields={click:['preserveWindowOrder','x','y','chrome','button','modifiers','clickCount','clipId','expectedClip'],drag:['x','y','chrome','toTarget','toX','toY','button','modifiers','path','durationMs','clipId','expectedClip','expectedToTarget','modelTarget','itemText','toTimelinePoint'],key:['key','requireFocus'],type:['text','commit'],scroll:['x','y','deltaX','deltaY'],screenshot:['crop']};
export function validatePhysicalInput(command,params){
 requireProof(Object.hasOwn(inputFields,command),'unsupported_physical_command','Choose click, drag, key, type, scroll or screenshot',['correct_parameters']);
 fields(params,['target','expected',...inputFields[command]],'physical input');
 requireProof(typeof params.target==='string'&&params.target.length>0,'invalid_params','Supply the ID of an observed physical target',['observe']);
 if(params.preserveWindowOrder!==undefined)requireProof(command==='click'&&typeof params.preserveWindowOrder==='boolean','invalid_params','preserveWindowOrder is a click-only native ordering guard',['correct_parameters']);
 if(params.requireFocus!==undefined)requireProof(command==='key'&&typeof params.requireFocus==='boolean','invalid_params','requireFocus is a boolean keyboard guard',['correct_parameters']);
 if(params.clipId!==undefined)requireProof(typeof params.clipId==='string'&&params.clipId.length>0,'invalid_params','Supply an observed clip identity',['observe']);
 if(params.toTimelinePoint!==undefined){fields(params.toTimelinePoint,['trackIndex','timeSeconds'],'toTimelinePoint');validateTimelinePoint(params.toTimelinePoint);requireProof(!params.path&&!params.chrome,'invalid_geometry','Track/time drops cannot mix paths or chrome',['correct_parameters']);}
 if(params.itemText!==undefined)requireProof(typeof params.itemText==='string'&&params.itemText.length>0&&params.itemText.length<=1024&&typeof params.modelTarget==='string'&&!params.path&&!params.chrome&&!params.clipId,'invalid_model_target','Declare an exact name and observed model view for the drag',['observe']);
 if(params.commit!==undefined){fields(params.commit,['documentId','inputId'],'commit');requireProof(command==='type'&&['documentId','inputId'].every(k=>typeof params.commit[k]==='string'&&params.commit[k].length>0&&params.commit[k].length<=128),'invalid_params','A text commit requires the observed Spell document and input IDs',['observe']);}
}
export function requireTargetGeometry(actual,expected){
 const keys=['id','window','x','y','width','height'];
 if(!keys.every(k=>actual[k]===expected[k])){
  const error=new OutcomeError('Target geometry changed before input; inspect the returned target and rebind','Blocked');
  error.code='input_binding_rejected';error.origin='harness';error.nextActions=['observe'];
  error.diagnostics={dispatch:'not_started',expected:Object.fromEntries(keys.map(k=>[k,expected[k]])),observed:Object.fromEntries([...keys,'visibleRect','clickRect'].filter(k=>actual[k]!==undefined).map(k=>[k,actual[k]]))};throw error;
 }
}
// ponytail: qualify saved Spell inputs only; other rebuilding controls retain Unknown.
export function spellTextBaseline(observed,target,commit,text){
 requireProof(observed.document_id===commit.documentId&&observed.kind==='instance'&&observed.state_source==='live_registry'&&observed.definition?.fingerprint&&observed.graph&&observed.scene&&Array.isArray(observed.outputs),'input_commit_unavailable','Use a complete live Spell instance readback',['observe']);
 const inputs=observed.graph.parameter_inputs?.filter(i=>i.id===commit.inputId)||[];
 requireProof(inputs.length===1,'input_commit_unavailable','The Spell input is absent or ambiguous',['observe']);const input=inputs[0];
 requireProof(target.name==='InspectorMultilineTextControl'&&target.class==='QPlainTextEdit'&&input.label&&[input.label,input.label+' (default)',input.label+' (override)'].includes(target.accessibleName),'input_commit_unavailable','The editable control must identify the declared Spell input',['observe']);
 const nodes=observed.graph.nodes?.filter(n=>n.id===input.node)||[],value=nodes[0]?.pass?.params?.[input.param];
 requireProof(nodes.length===1&&value?.type==='string'&&typeof text==='string'&&value.value!==text&&!['__proto__','prototype','constructor'].includes(input.param),'input_commit_unavailable','Use a changed string input with an exact node binding',['observe']);
 const state=Object.fromEntries(['document_id','kind','name','definition','graph','scene','outputs'].map(k=>[k,structuredClone(observed[k])]));
 return {input,state,text};
}
export function verifySpellTextCommit(baseline,observed,ui,target,receipt){
 const expected=structuredClone(baseline.state);expected.graph.nodes.find(n=>n.id===baseline.input.node).pass.params[baseline.input.param].value=baseline.text;
 const actual=Object.fromEntries(Object.keys(expected).map(k=>[k,observed[k]]));
 requireProof(observed.state_source==='live_registry'&&isDeepStrictEqual(actual,expected),'input_commit_unverified','The saved input or unrelated Spell state differs from the declared change',['observe']);
 const key=ui.widgets.find(w=>w.keyWindow===true),fields=ui.widgets.filter(w=>w.window===target.window&&w.name===target.name&&w.class===target.class&&w.editableText===true&&[baseline.input.label,baseline.input.label+' (default)',baseline.input.label+' (override)'].includes(w.accessibleName));
 requireProof(receipt.status==='Dispatched'&&receipt.postInput?.frontmost===true&&receipt.postInput.frontWindow===receipt.window&&key?.id===target.window&&key.nativeWindow===receipt.window&&!ui.modalWindow&&!ui.popupWindow&&fields.length===1&&(!ui.focus||ui.focus===fields[0].id),'input_commit_unverified','The saved change needs the same owned key window and one replacement field',['observe']);
 requireProof(ui.focus===target.id||!ui.widgets.some(w=>w.id===target.id),'input_commit_unverified','A surviving field that lost focus cannot use rebuild recovery',['observe']);
 return {verified:true,documentId:observed.document_id,inputId:baseline.input.id,target:target.id,replacement:fields[0].id,rebuilt:fields[0].id!==target.id,beforeHash:digest(baseline.state),afterHash:digest(actual),unchanged:'definition, unrelated graph values, scene, outputs'};
}
export function requireClipGeometry(actual,expected){
 const keys=['x','y','width','height'];
 requireProof(expected&&keys.every(k=>Number.isFinite(expected[k]))&&expected.width>0&&expected.height>0,'invalid_clip_geometry','Supply the complete observed clip rectangle',['observe']);
 requireProof(actual&&keys.every(k=>Number.isFinite(actual[k])&&actual[k]===expected[k]),'input_binding_rejected','Clip geometry changed after resolution; observe again before input',['observe']);
}

export function clipPoint(geometry,part='body'){
 assert(['body','left-edge','right-edge'].includes(part),'Choose body, left-edge or right-edge');
 const {rect:r,visibleRect:v}=geometry;assert(r&&v&&[r,v].every(a=>['x','y','width','height'].every(k=>Number.isFinite(a[k]))&&a.width>0&&a.height>0),'Clip has no visible geometry');
 const x=part==='left-edge'?r.x:part==='right-edge'?r.x+r.width-1:v.x+(v.width-1)/2,y=v.y+(v.height-1)/2;
 assert(x>=v.x&&x<v.x+v.width&&y>=v.y&&y<v.y+v.height,'Requested clip edge is outside the visible viewport; scroll and observe again');return {x,y};
}
export function modelItemPoint(view,viewport,text){
 requireProof(view?.viewport===viewport?.id&&view.rows===view.model?.length&&view.itemRects?.length===view.rows,'incomplete_observation','Model drag needs a complete current visible model',['observe']);
 const rows=view.model.flatMap((row,i)=>row[0]===text?[i]:[]);
 requireProof(rows.length===1,'ambiguous_target','Model drag needs one exact asset name',['observe']);
 const rect=view.itemRects.find(r=>r.row===rows[0]),v=viewport.visibleRect||{x:0,y:0,width:viewport.width,height:viewport.height};
 requireProof(rect&&[rect,v].every(r=>['x','y','width','height'].every(k=>Number.isFinite(r[k])))&&rect.width>0&&rect.height>0,'invalid_model_geometry','Model row has no current hit region',['observe']);
 const x=Math.max(rect.x,v.x),y=Math.max(rect.y,v.y),right=Math.min(rect.x+rect.width,v.x+v.width),bottom=Math.min(rect.y+rect.height,v.y+v.height);
 requireProof(right>x&&bottom>y,'clipped_model_target','Reveal the matching row before dragging',['reveal','observe']);
 return {x:x+(right-x-1)/2,y:y+(bottom-y-1)/2,row:rows[0],text};
}

export function windowPoint(widget,window,native,x,y){
 assert(widget.window===window.id&&window.window===window.id,'Pointer widget differs from its observed top-level window');
 assert(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<widget.width&&y<widget.height,'Pointer point exceeds the observed widget');
 if(widget.visibleRect){const r=widget.visibleRect;if(!(r.width>0&&r.height>0&&x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height))throw new OutcomeError('Pointer point lies outside the observed visible region; reveal the control and inspect again','Blocked');}
 // Qt widget coordinates exclude macOS title chrome; AX/CG window frames include it.
 const titleHeight=native.frame.height-window.height;
 assert(titleHeight>=0&&titleHeight<=80&&Math.abs(native.frame.width-window.width)<=1,'Native and Qt window geometry disagree');
 return {x:widget.x+x,y:titleHeight+widget.y+y};
}
export function defaultClickPoint(widget){
 if(widget.name==='InspectorSliderControl'){
  const h=widget.handle,v=widget.visibleRect||{x:0,y:0,width:widget.width,height:widget.height};
  requireProof(Array.isArray(h)&&h.length===2&&h.every(Number.isFinite)&&h[0]>=v.x&&h[0]<v.x+v.width&&h[1]>=v.y&&h[1]<v.y+v.height,'clipped_slider_thumb','Reveal the current Inspector thumb before focusing it',['observe']);
  return {x:h[0],y:h[1]};
 }
 if(!widget.clickRect)return {x:widget.width/2,y:widget.height/2};
 const r=widget.clickRect,v=widget.visibleRect||{x:0,y:0,width:widget.width,height:widget.height};
 assert(['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=widget.width&&r.y+r.height<=widget.height,'Invalid styled click rectangle');
 const x=Math.max(r.x,v.x),y=Math.max(r.y,v.y),right=Math.min(r.x+r.width,v.x+v.width),bottom=Math.min(r.y+r.height,v.y+v.height);
 if(!(right>x&&bottom>y))throw new OutcomeError('The styled click region is clipped; reveal the control and inspect again','Blocked');
 return {x:x+(right-x-1)/2,y:y+(bottom-y-1)/2};
}
export async function physicalInput(file,command,params={}){
 validatePhysicalInput(command,params);
 return withAdapterAction(file,command!=='screenshot',command,params,async()=>{try{return await physicalInputOwned(file,command,params);}catch(e){if(e.status==='Unknown'&&command!=='screenshot')await markUnknown(file,e);else if(e.status!=='Unknown'&&/Pointer point exceeds|Native and Qt window geometry disagree|Pointer widget differs|Target geometry changed|Clip geometry changed|Native window title\/geometry is absent or ambiguous/.test(e.message)){e.status='Blocked';e.code='input_binding_rejected';e.origin='harness';e.nextActions=['observe'];}throw e;}});
}
export function postInputFocus(ui,target,receipt,command){
 if(command!=='type'&&!(command==='click'&&target.editableText))return;
 const key=ui.widgets.find(w=>w.keyWindow===true),field=ui.widgets.find(w=>w.id===target.id);
 if(ui.focus!==target.id||!field?.editableText||field.window!==key?.id||key?.nativeWindow!==receipt.window){const e=new OutcomeError('The editable target did not retain focus after input; inspect before continuing','Unknown');e.code='input_focus_lost';e.diagnostics={target:target.id,focus:ui.focus,keyWindow:key?.nativeWindow||null};throw e;}
}
async function physicalInputOwned(file,command,params={}){
 const began=performance.now(),timing={};let mark=began;
 const measured=name=>{const now=performance.now();timing[name]=now-mark;mark=now;};
 let u,widget,window;
 for(let i=0;i<5;i++){u=await nativeCall(file,'inspect');widget=u.widgets.find(w=>w.id===params.target);window=u.widgets.find(w=>w.id===widget?.window);if(widget&&window)break;await pause(100);}
 if(!widget||!window)throw new OutcomeError(`Physical input target ${params.target} (${widget?.class||'absent'}; window ${widget?.window||'absent'}) is not observable`,'Blocked');
 if(params.expected)requireTargetGeometry(widget,params.expected);
 let modelBinding;if(params.itemText!==undefined){modelBinding=modelItemPoint(u.widgets.find(w=>w.id===params.modelTarget),widget,params.itemText);params={...params,x:modelBinding.x,y:modelBinding.y};}
 if(params.clipId){const fresh=await nativeCall(file,'timeline-clip-rect',{target:widget.id,clipId:params.clipId});requireClipGeometry(fresh.rect,params.expectedClip);}
 if(command==='type'&&!(widget.editableText===true&&u.focus===widget.id))throw new OutcomeError('Physically click the intended editable field before typing; secure and read-only fields are unavailable','Blocked');
 const readCommit=()=>adapter.desktopCall(file,'spellbook.inspect',{document_id:params.commit.documentId,view:'raw'});
 const commit=params.commit?spellTextBaseline(await readCommit(),widget,params.commit,params.text):null;
 measured('targetReadMs');
 const activationRequested=command!=='screenshot'&&params.preserveWindowOrder!==true&&!(window.active===true&&window.keyWindow===true);
 if(activationRequested)await nativeCall(file,'activate',{target:window.id});
 measured('activationMs');
 const native=await nativeDesktopInput(file,{command:'inspect',depth:0,mode:'window-server'});
 measured('nativeInspectionMs');
 const matches=native.windows.filter(w=>(window.nativeWindow?w.window===window.nativeWindow:w.title===window.title)&&Math.abs(w.frame.width-window.width)<=1&&Math.abs(w.frame.height-window.height)<=80);
 assert(matches.length===1,'Native window title/geometry is absent or ambiguous');
 const target=matches[0],request={command,mode:'window-server',pid:native.pid,started:native.started,window:target.window,frame:target.frame};
 if(command==='screenshot'&&params.crop){const r=widget.visibleRect||{x:0,y:0,width:widget.width,height:widget.height},p=windowPoint(widget,window,target,r.x,r.y);request.captureRect={...p,width:r.width,height:r.height};}
 if(command==='key'){request.key=params.key;if(params.requireFocus)request.focusTarget=widget.id;}
 else if(command==='type'){request.text=params.text;request.focusTarget=widget.id;}
 else if(command!=='screenshot'){
  if(params.chrome){
   assert(widget.id===window.id&&Number.isFinite(params.x)&&params.x>=120&&params.x<target.frame.width&&params.y>=0&&params.y<target.frame.height-window.height,'Choose an observed native title-bar drag point away from window controls');
   request.x=params.x;request.y=params.y;
  }else {const point=command==='click'&&(params.x===undefined||params.y===undefined)?defaultClickPoint(widget):null;Object.assign(request,windowPoint(widget,window,target,params.x??point?.x,params.y??point?.y));}
  if(command==='drag'){
   const destination=u.widgets.find(w=>w.id===(params.toTarget||params.target));
   assert(destination,'Observe the drag destination');
   if(params.expectedToTarget)requireTargetGeometry(destination,params.expectedToTarget);
   if(params.toTimelinePoint){const geometry=await nativeCall(file,'timeline-point',{target:destination.id,...params.toTimelinePoint});params={...params,toX:geometry.point.x,toY:geometry.point.y};}
   const destinationWindow=u.widgets.find(w=>w.id===destination.window),targets=native.windows.filter(w=>w.title===destinationWindow?.title&&Math.abs(w.frame.width-destinationWindow.width)<=1&&Math.abs(w.frame.height-destinationWindow.height)<=80);
   assert(targets.length===1,'Native destination window is absent or ambiguous');
   const to=windowPoint(destination,destinationWindow,targets[0],params.toX,params.toY);request.toX=to.x;request.toY=to.y;request.toWindow=targets[0].window;request.toFrame=targets[0].frame;
  }
  if(params.button)request.button=params.button;
  if(params.modifiers!==undefined)request.modifiers=params.modifiers;
  if(params.clickCount!==undefined)request.clickCount=params.clickCount;
  if(params.path!==undefined){assert(command==='drag'&&Array.isArray(params.path)&&params.path.length>=2&&params.path.length<=128,'Use a bounded drag path');request.path=params.path.map(p=>windowPoint(widget,window,target,p.x,p.y));}
  if(params.durationMs!==undefined)request.durationMs=params.durationMs;
  if(command==='scroll'){request.deltaX=params.deltaX??0;request.deltaY=params.deltaY??0;}
 }
 measured('requestMappingMs');
 const receipt=await nativeDesktopInput(file,request);measured('nativeDispatchMs');
 if(modelBinding)receipt.modelBinding=modelBinding;
 if(command==='type'||command==='click'&&widget.editableText){
  try{let after;for(let i=0;i<10;i++){after=await nativeCall(file,'inspect');if(after.focus===widget.id||commit&&!after.widgets.some(w=>w.id===widget.id))break;await pause(100);}if(commit)receipt.commit=verifySpellTextCommit(commit,await readCommit(),after,widget,receipt);else postInputFocus(after,widget,receipt,command);receipt.focus={target:widget.id,focused:after.focus,keyWindow:after.widgets.find(w=>w.keyWindow)?.nativeWindow,observedAt:new Date().toISOString()};}
  catch(e){e.status='Unknown';e.code=e.code||'post_input_observation_failed';e.nextActions=['observe','verify_resolution','resolve'];e.diagnostics={...e.diagnostics,receipt};throw e;}
 }
 measured('postInputReadMs');
 receipt.physicalTiming={...timing,totalMs:performance.now()-began,activationRequested,scope:'Physical wrapper; nested native timings overlap. Admission and outer agent target lookup excluded.'};
 return receipt;
}
