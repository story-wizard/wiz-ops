import path from 'node:path';
import {open,mkdir,writeFile,cp} from 'node:fs/promises';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert} from '../runner/engine.mjs';
import {nativeCall,desktopCall} from './adapter.mjs';

async function logTail(file){
 try{const f=await open(file,'r');try{const size=(await f.stat()).size,buf=Buffer.alloc(Math.min(size,32768));await f.read(buf,0,buf.length,Math.max(0,size-buf.length));return buf.toString('utf8').replace(/((?:api[_-]?key|authorization|token|secret)\s*[:=]\s*)([^\s,]+)/gi,'$1[REDACTED]');}finally{await f.close();}}
 catch(e){return `Not collected: ${e.message}`;}
}
export async function captureDesktop(file,directory){
 const s=await readJSON(file);await mkdir(directory,{recursive:true});
 const ui=await nativeCall(file,'inspect');
 assert(ui.widgets.some(w=>w.class==='MainWindow'&&w.title.startsWith(path.basename(s.bundle)+' — Wizard')),'The owned editor has a different project open.');
 const timeline=await desktopCall(file,'timeline.inspect',{timeline_id:s.main.id});
 await writeJSON(path.join(directory,'state.json'),{at:new Date().toISOString(),pid:s.pid,bundle:s.bundle,timeline,ui});
 for(const stream of ['stdout','stderr'])await writeFile(path.join(directory,stream+'.log'),await logTail(path.join(s.root,`gui-${s.generation}.${stream}.log`)));
 const main=ui.widgets.find(w=>w.class==='MainWindow');if(main){const shot=await nativeCall(file,'screenshot',{target:main.id});assert(shot.path.startsWith(s.native+path.sep),'Unexpected screenshot path');await cp(shot.path,path.join(directory,'window.png'));}
 return timeline;
}
