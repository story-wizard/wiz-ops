import {progressBar,buildImportProgress,progressEffects} from './run-display.js';
import {startSmokeProgress} from './smoke-progress.js';
startSmokeProgress();
const slider=document.querySelector('#progress'),advance=document.querySelector('#advance'),still=document.querySelector('#still');
let position=Number(slider.value),previous=0,last=-1;
function render(){
 const complete=still.checked?100:Math.floor(position),running=!still.checked&&complete<100?1:0;
 const fail=Math.floor(complete*.12),blocked=Math.floor(complete*.06),na=Math.floor(complete*.03),unknown=Math.floor(complete*.02);
 const groups=[['Pass',complete-fail-blocked-na-unknown],['Fail',fail],['Blocked',blocked],['N/A',na],['Unknown',unknown],['Running',running],['Not run',100-complete-running]];
 const results=groups.flatMap(([status,n])=>Array.from({length:n},()=>({status}))),state=still.checked?'Failed':'Running';
 document.querySelector('#amount').value=complete+'%';
 document.querySelector('#progress-preview').innerHTML=progressEffects+`<section class="progress-hero"><h3>Course progress</h3>${progressBar(results,state)}<p class="palette">${groups.filter(([,n])=>n).map(([status,n])=>`<span>${n} ${status}</span>`).join('')}</p></section><section><h3>In the Results table</h3><div class="sample-row"><span>Local course</span><div>${progressBar(results,state)}</div><span>${complete} of 100 complete</span></div></section><section><h3>Build download</h3>${buildImportProgress({stage:still.checked?'Ready':'Downloading',bytes:complete*1024**2,totalBytes:100*1024**2,complete:still.checked})}</section>`;
}
slider.addEventListener('input',()=>{advance.checked=false;position=Number(slider.value);render();});
still.addEventListener('change',()=>{if(still.checked)advance.checked=false;render();});
advance.addEventListener('change',()=>{if(advance.checked)still.checked=false;render();});
function frame(now){if(advance.checked&&!still.checked&&!matchMedia('(prefers-reduced-motion: reduce)').matches){position=(position+Math.min(now-previous,100)*.003)%100;slider.value=String(position);if(Math.floor(position)!==last){last=Math.floor(position);render();}}previous=now;requestAnimationFrame(frame);}
window.addEventListener('pageshow',render);
render();requestAnimationFrame(frame);
