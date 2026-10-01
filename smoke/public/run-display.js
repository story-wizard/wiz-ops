const activeStates = new Set(['Queued', 'Preflight', 'Running', 'Waiting for human', 'Continuing']);
const completedStates = new Set(['Passed', 'Failed']);
const outcomes = ['Pass', 'Fail', 'Blocked', 'Running', 'N/A', 'Unknown'];

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
  return (minutes >= 60 ? Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') : minutes) + ':' + String(seconds % 60).padStart(2, '0');
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

export function progressBar(results, state) {
  const total = results.length, counts = Object.fromEntries(outcomes.map(s => [s, results.filter(r => r.status === s).length]));
  const completed = total - results.filter(r => ['Not run', 'Running'].includes(r.status)).length;
  const description = outcomes.filter(s => counts[s]).map(s => counts[s] + ' ' + s.toLowerCase()).join(', ') || 'No checks recorded';
  return `<div class="run-progress" data-active="${activeStates.has(state)}" role="progressbar" aria-label="Check progress" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${completed}" aria-valuetext="${description}">${outcomes.map(s => `<span class="segment ${s.toLowerCase().replace(/[^a-z]+/g, '-')}" style="width:${total ? 100 * counts[s] / total : 0}%" title="${s}: ${counts[s]}"></span>`).join('')}</div>`;
}
