const activeStates = new Set(['Queued', 'Preflight', 'Running', 'Waiting for human', 'Continuing']);
const movingStates = new Set(['Preflight', 'Running', 'Continuing']);
const completedStates = new Set(['Passed', 'Failed']);
const outcomes = ['Pass', 'Fail', 'Blocked', 'Running', 'N/A', 'Unknown'];
const smokeHead='<div class="smoke-head" aria-hidden="true"><i class="puff"></i><i class="puff"></i><i class="puff"></i><i class="puff"></i><i class="puff"></i></div><div class="energy-edge" aria-hidden="true"></div>';
export const progressEffects = `<svg class="progress-effects" aria-hidden="true" focusable="false"><defs>
 <filter id="steam-wisp" x="-20%" y="-50%" width="140%" height="200%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".012 .075" numOctaves="2" seed="12" result="flow"/>
  <feDisplacementMap in="SourceGraphic" in2="flow" scale="12" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".35"/>
 </filter>
 <filter id="steam-grain" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".045 .09" numOctaves="3" seed="8" result="grain"/>
  <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.8 2.8 2.8 0 -3.5" result="density"/>
  <feComposite in="SourceGraphic" in2="density" operator="in" result="cloud"/>
  <feDisplacementMap in="cloud" in2="grain" scale="9" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".4"/>
 </filter>
 <filter id="steam-energy" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".06 .12" numOctaves="2" seed="4" result="grain"/>
  <feDisplacementMap in="SourceGraphic" in2="grain" scale="5" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".45"/>
 </filter>
</defs></svg>`;

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
  return (minutes >= 60 ? Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') : minutes) + ':' + String(seconds % 60).padStart(2, '0');
}

export function buildImportProgress(progress={}) {
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const bytes=Number.isFinite(progress.bytes)&&progress.bytes>=0?progress.bytes:0,total=Number.isFinite(progress.totalBytes)&&progress.totalBytes>0?progress.totalBytes:null;
 const transferring=['Downloading','Receiving ZIP','Copying archive'].includes(progress.stage),known=transferring&&total!==null,done=progress.stage==='Ready';
 const steps=progress.phase==='validation'&&Number.isInteger(progress.completedSteps)&&Number.isInteger(progress.totalSteps)&&progress.totalSteps>0;
 const percent=done?100:steps?100*Math.min(progress.totalSteps,Math.max(0,progress.completedSteps))/progress.totalSteps:known?Math.min(100,100*bytes/total):null,moving=!progress.complete;
 const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':(n/1024**2).toFixed(1)+' MB';
 const detail=transferring?size(bytes)+(total?' of '+size(total):' transferred')+(known?' · '+Math.floor(percent)+'%':''):done?'Build selected':steps?`${progress.completedSteps} of ${progress.totalSteps} verification steps complete`:'';
 const stage=progress.stage||'Starting import',description=stage+(detail?' · '+detail:'');
 return `<div class="build-progress-heading"><strong role="status">${esc(stage)}</strong><span>${esc(detail)}</span></div><div class="run-progress build-transfer-progress ${percent===null?'indeterminate':''}" data-active="${moving}" role="progressbar" aria-label="${steps?'Build verification steps':'Build import progress'}" aria-valuetext="${esc(description)}" ${percent===null?'':`aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(percent)}"`}><div class="steam-channel"><div class="progress-fill" style="width:${percent===null?30:percent}%"><div class="color-fill"><span class="segment ${done?'pass':'running'}" style="width:100%"></span></div>${moving?smokeHead:''}</div></div></div>`;
}

export function runTiming(run, history = [], now = Date.now()) {
  const execution = run.execution, start = Date.parse(run.created_at);
  if (!execution || !Number.isFinite(start)) return null;
  const active = activeStates.has(execution.state), end = active ? now : Date.parse(execution.updated_at);
  const elapsedMs = Number.isFinite(end) && end >= start ? end - start : null;
  const totalMs = completedStates.has(execution.state) ? elapsedMs : null;
  let estimatedTotalMs = null, samples = 0;
  const identity = r => {
    const p = r.execution?.package;
    if (!p?.packageHash || !p.courseHash || !p.runnerHash || !p.fixtureHash) return null;
    return JSON.stringify([p.packageHash, p.courseHash, p.runnerHash, p.fixtureHash, p.speechModel?.sha256 || null,
      ...['appHash', 'cliHash', 'qtHash', 'bridgeHash', 'librariesHash'].map(k => p.runtime?.[k] || null)]);
  };
  const signature = identity(run);
  if (active && signature && !execution.recipe?.checkpoint) {
    const durations = history.filter(r => r.id !== run.id && completedStates.has(r.execution?.state) && identity(r) === signature &&
      !r.execution.recipe?.checkpoint && Array.isArray(r.results) && r.results.length > 0 && r.results.length === r.execution.recipe?.cases?.length &&
      r.results.every(c => ['Pass', 'Fail', 'Blocked', 'N/A'].includes(c.status)))
      .map(r => Date.parse(r.execution.updated_at) - Date.parse(r.created_at)).filter(n => Number.isFinite(n) && n > 0).slice(0, 10).sort((a, b) => a - b);
    samples = durations.length;
    if (samples) estimatedTotalMs = (durations[Math.floor((samples - 1) / 2)] + durations[Math.floor(samples / 2)]) / 2;
  }
  return {active, elapsedMs, totalMs, estimatedTotalMs, samples};
}

// One grouped mark per check, across the full course scale. Decoration never changes the run verdict.
function outcomeScale(counts,total,moving){
 const order=['Pass','Fail','Blocked','N/A','Unknown','Running'],occupied=order.reduce((n,s)=>n+counts[s],0);
 let index=0;
 const marks=[...order.map(status=>[status,counts[status]]),['Not run',total-occupied]].flatMap(([status,n])=>Array.from({length:n},()=>{
  const number=++index,kind=status==='Not run'?'pending':status.toLowerCase().replace(/[^a-z]+/g,'-');
  return `<i class="outcome-tick ${kind}${number%10===0?' major':''}${moving&&number===occupied?' leading':''}" title="${status}: mark ${number}"></i>`;
 })).join('');
 return `<div class="outcome-scale" aria-hidden="true"><div class="outcome-line">${order.map(status=>`<span class="${status.toLowerCase().replace(/[^a-z]+/g,'-')}" style="width:${total?100*counts[status]/total:0}%"></span>`).join('')}</div><div class="outcome-ticks" style="--tick-count:${total||1}">${marks}</div></div>`;
}

export function progressBar(results, state) {
  const total = results.length, counts = Object.fromEntries(outcomes.map(s => [s, results.filter(r => r.status === s).length]));
  const completed = total - results.filter(r => ['Not run', 'Running'].includes(r.status)).length;
  const description = outcomes.filter(s => counts[s]).map(s => counts[s] + ' ' + s.toLowerCase()).join(', ') || 'No checks recorded';
  const occupied = Object.values(counts).reduce((a,b) => a+b,0), moving = movingStates.has(state) && occupied > 0;
  return `<div class="run-progress ley-progress" data-active="${moving}" role="progressbar" aria-label="Check progress" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${completed}" aria-valuetext="${description}"><div class="steam-channel"><div class="progress-fill" style="width:${total ? 100 * occupied / total : 0}%"><div class="color-fill">${outcomes.map(s => `<span class="segment ${s.toLowerCase().replace(/[^a-z]+/g, '-')}" style="width:${occupied ? 100 * counts[s] / occupied : 0}%" title="${s}: ${counts[s]}"></span>`).join('')}</div>${moving?smokeHead:''}</div></div>${outcomeScale(counts,total,moving)}</div>`;
}
