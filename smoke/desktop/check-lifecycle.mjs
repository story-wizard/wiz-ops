import path from 'node:path';
import {launchDesktop,nativeCall,desktopCall} from './adapter.mjs';
import {readJSON,writeJSON} from '../runner/files.mjs';
import {assert,same,snapshotState,pause} from '../runner/engine.mjs';

// holder tracks the currently owned child even if a later assertion fails.
export async function saveDiscard(file,holder){
  const initial=await readJSON(file),result={id:'D-SAVE-DISCARD',status:'Pass'},observations=[];
  const ui=()=>nativeCall(file,'inspect'),c=(op,p)=>desktopCall(file,op,p),n=(op,p)=>nativeCall(file,op,p);
  const inspect=()=>c('timeline.inspect',{timeline_id:initial.main.id});
  async function close(discard){
    await n('close-window',{target:(await ui()).widgets.find(w=>w.class==='MainWindow').id});let dialogSeen=false;
    for(let i=0;i<70;i++){
      if(holder.live.child.exitCode!==null||holder.live.child.signalCode){await holder.live.closed;assert(holder.live.child.exitCode===0,'Application did not exit cleanly');const s=await readJSON(file);s.state='Stopped';await writeJSON(file,s);assert(discard===dialogSeen,discard?'Dirty close did not prompt':'Clean close unexpectedly prompted');return;}
      let state;try{state=await ui();}catch(e){await Promise.race([holder.live.closed,pause(500)]);if(holder.live.child.exitCode!==null||holder.live.child.signalCode)continue;throw e;}const box=state.widgets.find(w=>w.class==='QMessageBox');
      if(box){await writeJSON(path.join(initial.root,'lifecycle-dialog.json'),state);if(!discard){const cancel=state.widgets.find(w=>w.window===box.id&&w.text==='Cancel');if(cancel)await n('click',{target:cancel.id});throw Error('Saved project still shows a dirty-close prompt');}const button=state.widgets.find(w=>w.window===box.id&&w.text==="Don't Save");assert(button,'Discard choice unavailable');await n('click',{target:button.id});dialogSeen=true;}
      await pause(100);
    }
    throw Error('App did not close within the bounded lifecycle check');
  }
  try{
    const before=await inspect();const save=(await ui()).actions.find(a=>a.text==='Save'&&a.enabled);await n('action',{target:save.id});await pause(300);observations.push({phase:'saved',pid:(await readJSON(file)).pid,snapshot:snapshotState(before)});await close(false);
    holder.live=await launchDesktop(await readJSON(file));same(snapshotState(await inspect()),snapshotState(before),'Clean-close saved content');
    const originalPid=initial.pid;assert((await readJSON(file)).pid!==originalPid,'Clean close did not use a new process');const name='Discarded smoke edit';await c('timeline.update',{id:'discard-dirty-edit',timeline_id:initial.main.id,changes:{name}});assert((await inspect()).timeline.name===name,'Dirty edit missing');observations.push({phase:'dirty',pid:(await readJSON(file)).pid,name});await close(true);
    holder.live=await launchDesktop(await readJSON(file));const restored=await inspect();same(snapshotState(restored),snapshotState(before),'Discard restored saved state');result.evidence={cleanCloseWithoutPrompt:true,discardPrompt:true,restoredName:restored.timeline.name,pids:[...observations.map(x=>x.pid),(await readJSON(file)).pid]};
  }catch(e){result.status=e.status||'Fail';result.error=e.message;}
  await writeJSON(path.join(initial.root,'desktop-lifecycle-report.json'),{results:[result],observations});return result;
}
