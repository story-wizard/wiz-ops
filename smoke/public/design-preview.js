import {progressBar,progressEffects} from './run-display.js';
const results=[['Pass',7],['Fail',1],['Blocked',1],['Running',1],['Not run',10]].flatMap(([status,n])=>Array.from({length:n},()=>({status})));
const variants=[['a','Arcane current','Curling wisps stay behind the spark; a faint wisp remains at the origin.'],['b','Furnace breath','Soft steam pulses around a warm ignition point.'],['c','Silver veil','A restrained silver ribbon with a needle of light.']];
document.querySelector('#progress-preview').innerHTML=progressEffects+variants.map(([id,title,description])=>`<section class="variant-${id}"><div class="study-heading"><h3><span>${id.toUpperCase()}</span> ${title}</h3><span class="study-note">${id==='a'?'Recommended':''}</span></div><p>${description}</p>${progressBar(results,'Running')}<div class="palette"><span class="pass">Pass</span><span class="fail">Fail</span><span class="blocked">Blocked</span><span class="running">Running</span></div></section>`).join('');
const slider=document.querySelector('#progress'),advance=document.querySelector('#advance'),still=document.querySelector('#still');
let position=Number(slider.value),previous=0;
const setProgress=value=>{position=value;slider.value=String(value);document.body.style.setProperty('--preview-progress',value+'%');document.querySelector('#amount').value=Math.round(value)+'%';};
slider.addEventListener('input',()=>{advance.checked=false;setProgress(Number(slider.value));});
function tick(now){if(advance.checked&&!still.checked&&!matchMedia('(prefers-reduced-motion: reduce)').matches)setProgress((position+Math.min(now-previous,100)*.004)%100);previous=now;requestAnimationFrame(tick);}
requestAnimationFrame(tick);
