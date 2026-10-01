import {progressBar,progressEffects} from './run-display.js';
const results=[['Pass',7],['Fail',1],['Blocked',1],['Running',1],['Not run',10]].flatMap(([status,n])=>Array.from({length:n},()=>({status})));
document.querySelector('#progress-preview').innerHTML=progressEffects+progressBar(results,'Running');
