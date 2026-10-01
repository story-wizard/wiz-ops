import {nativeCall} from './adapter.mjs';
import {nativeDesktopInput} from './macos-input.mjs';
import {assert,pause,OutcomeError} from '../runner/engine.mjs';

export function windowPoint(widget,window,native,x,y){
 assert(widget.window===window.id&&window.window===window.id,'Pointer widget differs from its observed top-level window');
 assert(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<widget.width&&y<widget.height,'Pointer point exceeds the observed widget');
 // Qt widget coordinates exclude macOS title chrome; AX/CG window frames include it.
 const titleHeight=native.frame.height-window.height;
 assert(titleHeight>=0&&titleHeight<=80&&Math.abs(native.frame.width-window.width)<=1,'Native and Qt window geometry disagree');
 return {x:widget.x+x,y:titleHeight+widget.y+y};
}
export async function physicalInput(file,command,params={}){
 let u,widget,window;
 for(let i=0;i<5;i++){u=await nativeCall(file,'inspect');widget=u.widgets.find(w=>w.id===params.target);window=u.widgets.find(w=>w.id===widget?.window);if(widget&&window)break;await pause(100);}
 if(!widget||!window)throw new OutcomeError(`Physical input target ${params.target} (${widget?.class||'absent'}; window ${widget?.window||'absent'}) is not observable`,'Blocked');
 await nativeCall(file,'activate',{target:window.id});
 const native=await nativeDesktopInput(file,{command:'inspect',depth:0,mode:'window-server'});
 const matches=native.windows.filter(w=>w.title===window.title&&Math.abs(w.frame.width-window.width)<=1&&Math.abs(w.frame.height-window.height)<=80);
 assert(matches.length===1,'Native window title/geometry is absent or ambiguous');
 const target=matches[0],request={command,mode:'window-server',pid:native.pid,started:native.started,window:target.window,frame:target.frame};
 if(command==='key')request.key=params.key;
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
 }
 return nativeDesktopInput(file,request);
}
