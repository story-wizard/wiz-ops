import {nativeCall} from './adapter.mjs';
import {nativeDesktopInput} from './macos-input.mjs';
import {assert,pause,OutcomeError} from '../runner/engine.mjs';
import {withAdapterAction,markUnknown} from './agent-proof.mjs';

export function clipPoint(geometry,part='body'){
 assert(['body','left-edge','right-edge'].includes(part),'Choose body, left-edge or right-edge');
 const {rect:r,visibleRect:v}=geometry;assert(r&&v&&[r,v].every(a=>['x','y','width','height'].every(k=>Number.isFinite(a[k]))&&a.width>0&&a.height>0),'Clip has no visible geometry');
 const x=part==='left-edge'?r.x:part==='right-edge'?r.x+r.width-1:v.x+(v.width-1)/2,y=v.y+(v.height-1)/2;
 assert(x>=v.x&&x<v.x+v.width&&y>=v.y&&y<v.y+v.height,'Requested clip edge is outside the visible viewport; scroll and observe again');return {x,y};
}

export function windowPoint(widget,window,native,x,y){
 assert(widget.window===window.id&&window.window===window.id,'Pointer widget differs from its observed top-level window');
 assert(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<widget.width&&y<widget.height,'Pointer point exceeds the observed widget');
 // Qt widget coordinates exclude macOS title chrome; AX/CG window frames include it.
 const titleHeight=native.frame.height-window.height;
 assert(titleHeight>=0&&titleHeight<=80&&Math.abs(native.frame.width-window.width)<=1,'Native and Qt window geometry disagree');
 return {x:widget.x+x,y:titleHeight+widget.y+y};
}
export async function physicalInput(file,command,params={}){
 return withAdapterAction(file,command!=='screenshot',command,params,async()=>{try{return await physicalInputOwned(file,command,params);}catch(e){if(e.status==='Unknown')await markUnknown(file,e);throw e;}});
}
export function postInputFocus(ui,target,receipt,command){
 if(command!=='type'&&!(command==='click'&&target.editableText))return;
 const key=ui.widgets.find(w=>w.keyWindow===true),field=ui.widgets.find(w=>w.id===target.id);
 if(ui.focus!==target.id||!field?.editableText||field.window!==key?.id||key?.nativeWindow!==receipt.window){const e=new OutcomeError('The editable target did not retain focus after input; inspect before continuing','Unknown');e.code='input_focus_lost';e.diagnostics={target:target.id,focus:ui.focus,keyWindow:key?.nativeWindow||null};throw e;}
}
async function physicalInputOwned(file,command,params={}){
 let u,widget,window;
 for(let i=0;i<5;i++){u=await nativeCall(file,'inspect');widget=u.widgets.find(w=>w.id===params.target);window=u.widgets.find(w=>w.id===widget?.window);if(widget&&window)break;await pause(100);}
 if(!widget||!window)throw new OutcomeError(`Physical input target ${params.target} (${widget?.class||'absent'}; window ${widget?.window||'absent'}) is not observable`,'Blocked');
 if(params.expected)assert(['id','window','x','y','width','height'].every(k=>widget[k]===params.expected[k]),'Target geometry changed after resolution; observe again before input');
 if(params.clipId){const fresh=await nativeCall(file,'timeline-clip-rect',{target:widget.id,clipId:params.clipId});assert(JSON.stringify(fresh.rect)===JSON.stringify(params.expectedClip),'Clip geometry changed after resolution; observe again before input');}
 if(command==='type'&&!(widget.editableText===true&&u.focus===widget.id))throw new OutcomeError('Physically click the intended editable field before typing; secure and read-only fields are unavailable','Blocked');
 if(command!=='screenshot')await nativeCall(file,'activate',{target:window.id});
 const native=await nativeDesktopInput(file,{command:'inspect',depth:0,mode:'window-server'});
 const matches=native.windows.filter(w=>w.title===window.title&&Math.abs(w.frame.width-window.width)<=1&&Math.abs(w.frame.height-window.height)<=80);
 assert(matches.length===1,'Native window title/geometry is absent or ambiguous');
 const target=matches[0],request={command,mode:'window-server',pid:native.pid,started:native.started,window:target.window,frame:target.frame};
 if(command==='screenshot'&&params.crop){const r=widget.visibleRect||{x:0,y:0,width:widget.width,height:widget.height},p=windowPoint(widget,window,target,r.x,r.y);request.captureRect={...p,width:r.width,height:r.height};}
 if(command==='key')request.key=params.key;
 else if(command==='type'){request.text=params.text;request.focusTarget=widget.id;}
 else if(command!=='screenshot'){
  if(params.chrome){
   assert(widget.id===window.id&&Number.isFinite(params.x)&&params.x>=120&&params.x<target.frame.width&&params.y>=0&&params.y<target.frame.height-window.height,'Choose an observed native title-bar drag point away from window controls');
   request.x=params.x;request.y=params.y;
  }else Object.assign(request,windowPoint(widget,window,target,params.x,params.y));
  if(command==='drag'){
   const destination=u.widgets.find(w=>w.id===(params.toTarget||params.target));
   assert(destination,'Observe the drag destination');
   const destinationWindow=u.widgets.find(w=>w.id===destination.window),targets=native.windows.filter(w=>w.title===destinationWindow?.title&&Math.abs(w.frame.width-destinationWindow.width)<=1&&Math.abs(w.frame.height-destinationWindow.height)<=80);
   assert(targets.length===1,'Native destination window is absent or ambiguous');
   const to=windowPoint(destination,destinationWindow,targets[0],params.toX,params.toY);request.toX=to.x;request.toY=to.y;request.toWindow=targets[0].window;request.toFrame=targets[0].frame;
  }
  if(params.button)request.button=params.button;
  if(params.durationMs!==undefined)request.durationMs=params.durationMs;
  if(command==='scroll'){request.deltaX=params.deltaX??0;request.deltaY=params.deltaY??0;}
 }
 const receipt=await nativeDesktopInput(file,request);
 if(command==='type'||command==='click'&&widget.editableText){
  try{let after;for(let i=0;i<10;i++){after=await nativeCall(file,'inspect');if(after.focus===widget.id)break;await pause(100);}postInputFocus(after,widget,receipt,command);receipt.focus={target:widget.id,focused:after.focus,keyWindow:after.widgets.find(w=>w.keyWindow)?.nativeWindow,observedAt:new Date().toISOString()};}
  catch(e){e.status='Unknown';e.code=e.code||'post_input_observation_failed';e.nextActions=['observe','verify_resolution','resolve'];e.diagnostics={...e.diagnostics,receipt};throw e;}
 }
 return receipt;
}
