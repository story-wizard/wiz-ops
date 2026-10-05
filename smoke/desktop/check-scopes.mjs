import {checks,widgetPixelDifference,scopeSelections} from './check-support.mjs';
import {assert,pause,same,snapshotState} from '../runner/engine.mjs';
const {s,n,c,ui,until,check,action,finish}=await checks(process.argv[2],'desktop-scopes-report.json');
await check('D-SCOPES-01',async()=>{
  const before=snapshotState(await c('timeline.inspect',{timeline_id:s.main.id}));await c('render.bind_timeline',{timeline_id:s.main.id,playhead_frame:0});await action('Scopes');let type,tap,window,uncertain=false;
  try{const u=await until(async()=>{const a=await ui();return a.widgets.some(w=>w.name==='scopesTypeCombo')?a:null;});type=u.widgets.find(w=>w.name==='scopesTypeCombo');tap=u.widgets.find(w=>w.name==='scopesTapCombo');window=type.window;
    const modes=scopeSelections(type,tap),observations=[];
    for(const mode of modes)for(let j=0;j<tap.items.length;j++){
      await n('select',{target:type.id,index:mode.index});await n('select',{target:tap.id,index:j});await c('playback.seek',{time:5});await pause(400);const view=(await ui()).widgets.find(w=>w.window===window&&/HistogramView|WaveformView/.test(w.class));assert(view,'Scope plot is not visible');const gap=await n('snapshot-widget',{target:view.id});await c('playback.seek',{time:1});
      const image=await until(async()=>{const captured=await n('snapshot-widget',{target:view.id});return widgetPixelDifference(gap,captured)>.5?captured:null;});observations.push({mode:mode.mode,tap:tap.items[j],meanPixelDifference:widgetPixelDifference(gap,image),gap:gap.path,image:image.path});
    }
    return {observations,availableModes:type.items,untestedModes:type.items.filter(mode=>!modes.some(m=>m.mode===mode)),scope:'Histogram, luma/RGB waveform and RGB parade react to video versus a black gap at each available tap.'};
  }catch(e){uncertain=e.status==='Unknown';throw e;}finally{if(!uncertain){if(type&&tap){await n('select',{target:type.id,index:type.index});await n('select',{target:tap.id,index:tap.index});await n('close-window',{target:window});}await c('playback.seek',{time:0});same(snapshotState(await c('timeline.inspect',{timeline_id:s.main.id})),before,'Scope checks preserve project');}}
});finish();
