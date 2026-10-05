import path from 'node:path';
import {uiWorkflows} from './ui-workflows.mjs';
import {verifyGradeIsolation,verifyRestoredGraph} from './ui-cohort-proof.mjs';
import {assert,OutcomeError,clips,same,snapshotState,command} from '../runner/engine.mjs';
import {readPPM,pixelDifference,visibleImage} from '../runner/pixels.mjs';
const file=process.argv[2],h=await uiWorkflows(file,'desktop-colour-panels-report.json');
const {s,n,c,ui,until,check,stage,fixture,selectClip,unique,physical,capture,observe,click,action,finish}=h;
const graph=f=>c('graph.get_clip_graph',f.scope);
let frameSequence=0;
const decoded=new Map();
async function presentedImage(image){
 if(!decoded.has(image.path)){const output=image.path+'.ppm',receipt=await command(path.join(s.app,'Contents/MacOS/ffmpeg'),['-hide_banner','-loglevel','error','-nostdin','-i',image.path,'-frames:v','1','-pix_fmt','rgb24','-threads','1',output],{env:s.env,cwd:s.root,timeout:10000});assert(receipt.code===0&&!receipt.timedOut,'Presented-image decode failed: '+receipt.stderr);decoded.set(image.path,await readPPM(output));}return decoded.get(image.path);
}
function inside(u,w,owner){const seen=new Set();while(w&&!seen.has(w.id)){if(w.id===owner.id)return true;seen.add(w.id);w=u.widgets.find(x=>x.id===w.parent);}return false;}
async function panel(name,klass){if(!(await ui()).widgets.some(w=>w.class===klass))await action(name);return until(async()=>{const u=await ui();return u.widgets.find(w=>w.class===klass)||null;},{description:name+' panel'});}
async function frame(id,f,label){const output=path.join(s.root,'evidence',id+'-'+(++frameSequence)+'-'+label+'.ppm');await c('render.export_still',{timeline_id:f.id,time:{value:24,rate:24},output});const image=await readPPM(output);visibleImage(image);return image;}
async function baseline(id,name,klass){const f=await fixture(id);await selectClip(f);f.panel=await panel(name,klass);f.graph=await graph(f);f.image=await frame(id,f,'before');f.preview=unique(await ui(),w=>w.class==='MetalPreviewWidget','Presented preview');f.screen=await capture(id,'before',f.preview.id);return f;}
async function gradeGesture(id,f,control,prefix,minimumDifference=.5,endpoint={x:.65,y:.4}){
 const before=await graph(f),screen=await capture(id,'before-gesture',f.preview.id);
 await physical('drag',{target:control.id,x:control.width*.5,y:control.height*.5,toX:control.width*endpoint.x,toY:control.height*endpoint.y,durationMs:700});
 const after=await until(async()=>{const g=await graph(f);return JSON.stringify(g.nodes)!==JSON.stringify(before.nodes)?g:null;},{description:'Grade parameters respond to the physical gesture'});
 const proof=verifyGradeIsolation(before,after,prefix),render=await frame(id,f,'after-'+control.id);assert(pixelDifference(f.image,render)>minimumDifference,'Grade gesture did not affect rendered pixels');
 const screenPixels=await presentedImage(screen),changed=await until(async()=>{const image=await capture(id,'after-gesture',f.preview.id),difference=pixelDifference(screenPixels,await presentedImage(image));return difference>.01?{image,difference}:null;},{description:'Displayed preview responds to the grade'});
 await observe(id,'gesture',{before,after,control,proof,pixelDifference:pixelDifference(f.image,render),displayDifference:changed.difference,displayComparison:'Full presented PNG pixels'});return {before,after,proof};
}
async function undo(id,f,before,target){await physical('key',{target,key:'cmd+z'});await until(async()=>{const g=await graph(f);try{verifyRestoredGraph(before,g);return g;}catch{return null;}},{description:'Undo restores the exact clip graph'});assert(pixelDifference(f.image,await frame(id,f,'undo-'+target))<=1,'Undo changed the reference pixels');await capture(id,'undo',f.preview.id);}

await check('D-PRIMARY-PANEL',async()=>{
 const id='D-PRIMARY-PANEL',f=await stage('setup','Prepare a selected colour plate and Primary panel','prepare',()=>baseline(id,'Primary Grade','PrimaryGradePanel'));
 const u=await ui(),wheels=u.widgets.filter(w=>w.class==='ColorWheelWidget'&&inside(u,w,f.panel)).sort((a,b)=>a.y-b.y||a.x-b.x);
 if(![3,4].includes(wheels.length))throw new OutcomeError('Primary exposes no supported three/four-band layout','Blocked');
 const gamma=unique(u,w=>wheels.some(x=>x.id===w.id)&&u.widgets.some(label=>label.parent===w.parent&&label.text==='Gamma'),'Primary Gamma wheel'),wheel=await stage('wheel','Physically drag the Gamma wheel and compare graph and pixels','execute',()=>gradeGesture(id,f,gamma,'grade.primary.'));
 await stage('undo-wheel','Undo the wheel and compare the entire graph','verify',()=>undo(id,f,wheel.before,gamma.id));
 const p=unique(await ui(),w=>inside(u,w,f.panel)&&w.class==='DragValueEdit'&&/^Pivot/.test(w.tooltip),'Primary pivot');
 const contrast=unique(u,w=>wheels.some(x=>x.id===w.id)&&u.widgets.some(label=>label.parent===w.parent&&label.text==='Contrast'),'Primary Contrast wheel');
 const pivot=await stage('pivot','Drag the pivot with nonneutral Contrast','execute',async()=>{
  // This is the contrast pivot. Gamma alone leaves contrast neutral and can
  // correctly produce no pixel change when the pivot moves.
  await gradeGesture(id,f,contrast,'grade.primary.');f.image=await frame(id,f,'pivot-reference');return gradeGesture(id,f,p,'grade.primary.',.02);
 });await stage('undo-pivot','Undo pivot independently','verify',()=>undo(id,f,pivot.before,p.id));
 // The dock title bar hosts this selector outside the panel's child tree.
 const model=unique(await ui(),w=>w.window===f.panel.window&&Array.isArray(w.items)&&w.items.includes('Log')&&w.items.includes('Linear'),'Primary model selector');
 const before=await graph(f);await stage('model','Choose Linear through the physical selector','execute',async()=>{
  await click(model);const popup=await until(async()=>{const observed=await ui();return observed.widgets.find(w=>w.window!==f.panel.window&&w.model?.some(row=>row[0]==='Linear'))||null;},{description:'Primary model popup'}),observed=await ui(),viewport=unique(observed,w=>w.id===popup.viewport,'Primary model popup viewport'),index=popup.model.findIndex(row=>row[0]==='Linear'),rect=popup.itemRects[index];assert(rect&&rect.height>0,'Linear model row has no visible geometry');await physical('click',{target:viewport.id,x:rect.x+rect.width/2,y:rect.y+rect.height/2});
 });
 const after=await until(async()=>{const g=await graph(f);return g.nodes.some(n=>n.params?.['grade.primary.style']==='GRADING_STYLE_LIN')?g:null;},{description:'Explicit Linear model persisted'});await observe(id,'model',{before,after});verifyGradeIsolation(before,after,'grade.primary.');
 assert(pixelDifference(f.image,await frame(id,f,'linear-model'))>.02,'Changing the explicit model did not affect rendered pixels');await capture(id,'linear-model',f.preview.id);
 await stage('undo-model','Undo the model change and restore the exact graph and pixels','verify',()=>undo(id,f,before,model.id));
 return {wheels:2,pivot:true,model:'GRADING_STYLE_LIN',scope:'Gamma/Contrast wheels, contrast pivot and explicit Linear model; other primary bands remain additional coverage'};
});

await check('D-TONE-ZONES',async()=>{
 const id='D-TONE-ZONES',f=await stage('setup','Prepare a selected plate and Tone panel','prepare',()=>baseline(id,'Tone','TonePanel'));
 const initial=await ui(),wheels=initial.widgets.filter(w=>w.class==='ColorWheelWidget'&&inside(initial,w,f.panel)&&!initial.widgets.some(label=>label.parent===w.parent&&/^Global$/i.test(label.text||''))).sort((a,b)=>a.y-b.y||a.x-b.x);
 if(wheels.length!==5)throw new OutcomeError('Tone does not expose five independently bound zone wheels','Blocked');const results=[];
 for(const [i,wheel] of wheels.entries())await stage('zone-'+i,'Edit and reset Tone zone '+(i+1),'execute',async()=>{
  await click(wheel);const change=await gradeGesture(id,f,wheel,'grade.tone.',.02,{x:.9,y:.2});
  const u=await ui(),reset=unique(u,w=>inside(u,w,f.panel)&&w.enabled&&/^Reset this zone/.test(w.tooltip),'Selected Tone zone reset');await click(reset);
  const restored=await frame(id,f,'reset-zone-'+i);assert(pixelDifference(f.image,restored)<=1,'Reset zone did not restore the reference pixels');
  const resetGraph=await graph(f);await observe(id,'zone-'+i,{change,resetGraph});results.push({zone:i,reset:reset.id,changes:change.proof.changes});await capture(id,'reset-zone-'+i,f.preview.id);
 });same(snapshotState(await c('timeline.inspect',{timeline_id:f.id})),snapshotState(f.before),'Tone preserves clip timing');return {zones:results};
});

await check('D-BALANCE-PANEL',async()=>{
 const id='D-BALANCE-PANEL',f=await stage('setup','Prepare a selected plate and Balance panel','prepare',()=>baseline(id,'Balance','BalancePanel')),results=[];
 const specs=[['Exposure',/^Exposure in stops/,'balance.grade.exposure_contrast.exposure',0],['Contrast',/^Contrast around/,'balance.grade.exposure_contrast.contrast',1],['Temperature',/^Assumed scene illuminant/,'balance.grade.white_balance.temperature',6500],['Tint',/^Green\/magenta/,'balance.grade.white_balance.tint',0]];
 for(const [label,tooltip,key,neutral] of specs)await stage(label.toLowerCase(),'Drag '+label+' and verify independent Undo','execute',async()=>{
  const u=await ui(),control=unique(u,w=>inside(u,w,f.panel)&&w.enabled&&/GradeLevelSlider$/.test(w.class)&&tooltip.test(w.tooltip),'Balance '+label);
  const change=await gradeGesture(id,f,control,'balance.grade.'),edited=change.after.nodes.find(node=>Object.hasOwn(node.params||{},key)),prior=change.before.nodes.find(node=>node.node_id===edited?.node_id)?.params?.[key]??neutral;assert(edited&&Number.isFinite(edited.params[key])&&Math.abs(edited.params[key]-prior)>1e-5,'Balance changed a different control');await undo(id,f,change.before,control.id);results.push({control:label,key});
 });same(snapshotState(await c('timeline.inspect',{timeline_id:f.id})),snapshotState(f.before),'Balance preserves clip timing');return {controls:results};
});
finish();
