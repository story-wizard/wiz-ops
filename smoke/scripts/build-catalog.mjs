import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const source = JSON.parse(readFileSync(new URL('catalog/logan-source.json', root)));
const auto = {
  'LP-02': ['Project lifecycle', 'Create a disposable project, save, quit the owned app process, relaunch the same package and reopen it.', 'Project settings, media identities and timeline structure survive a real process restart.', ['gp-project','gp-timelines']],
  'IN-01': ['Mixed-media import', 'Import the six local fixture files through the packaged ingestion path.', 'Every fixture is registered once with the expected stream types, dimensions, frame rate and duration.', ['gp-media']],
  'IN-03': ['Import outside the project folder', 'Import a fixture copy from a temporary directory outside the project bundle parent.', 'The source resolves and remains readable after project reopen.', ['gp-media']],
  'IN-06': ['Speech transcript', 'Ingest the speech fixture using a pinned local transcription configuration.', 'The expected phrase is present with timestamps within an agreed tolerance; job status and coverage agree.', ['gp-speech']],
  'IN-07': ['Bin item lifecycle', 'Duplicate a bin item, rename the duplicate, then delete it.', 'The original retains its identity and source; only the duplicate is removed.', ['gp-media']],
  'IN-08': ['Local media relink', 'Move a disposable source file, observe offline state, then relink it.', 'The original asset identity and timeline references survive; decoding resumes from the new path.', ['gp-media','gp-timelines']],
  'SS-01': ['Transcript phrase search', 'Search for the exact phrase in the speech fixture after ingestion completes.', 'The expected asset and annotated time range are returned.', ['gp-speech']],
  'SS-03': ['Filename-only search', 'Search for a unique fixture filename token absent from transcript text.', 'The intended asset is returned by identity.', ['gp-media']],
  'SS-04': ['No-match search', 'Search for a reserved absent token using an explicitly defined search mode and threshold.', 'The result set is empty. Confirm product semantics before implementing this assertion.', ['gp-media']],
  'SS-05': ['Search after new ingest', 'Ingest an additional disposable copy with a unique name and query it in the same session.', 'The new asset is searchable without restarting the app.', ['gp-media']],
  'SS-07': ['Project-wide search', 'Search for an asset used only in the secondary timeline while the primary timeline is focused.', 'Results include the secondary-timeline asset and are not restricted to timeline focus.', ['gp-timelines','gp-media']],
  'UP-01': ['Undo and redo across timelines', 'Apply 20 known edits across two timelines, undo all, then redo all.', 'Each state matches its recorded expected revision and both timelines return to their exact baseline after undo.', ['gp-timelines']],
  'UP-03': ['Working colour space undo', 'Change the project working colour space and undo once.', 'A single undo restores the prior colour-space setting and the expected reference render.', ['gp-project','gp-media']],
  'RG-03': ['Matte connection', 'Connect a known grayscale matte to a supported maskable node.', 'The graph connection is correct and rendered sample pixels match the masked reference within tolerance.', ['gp-mask','gp-graph']],
  'SB-03': ['Local Spellbook graph', 'Create a source, two local effects and output; connect, disconnect and reconnect edges.', 'Graph identities and edges match the expected topology; the graph remains valid after reconnect.', ['gp-spell']],
  'SB-12': ['Spellbook restart persistence', 'Save a project with the local spell, quit the owned process, relaunch and reopen.', 'Spell graph, parameters and retained results survive the restart.', ['gp-spell','gp-project']],
  'EX-02': ['Export with unset timeline frame rate', 'Create an unset-frame-rate timeline variant and export it through the packaged export path.', 'The documented fallback frame rate is used and the file decodes with expected duration. Define fallback before implementation.', ['gp-timelines','gp-media']],
  'CLI-01': ['Connect to the packaged editor', 'Launch the test-owned packaged app and connect its shipped CLI to the disposable project.', 'The server identifies the expected app process, build and open project.', ['gp-project']],
  'CLI-02': ['CLI operation reaches the live editor', 'Perform a bounded edit through the shipped CLI and read the live editor model revision.', 'The live editor observes the new revision and the expected clip state, with an independent app-side observation.', ['gp-timelines']]
};
const companions = [
  ['LP-04','Saved and dirty project state','Save a known edit, make a second edit, then discard it through the project operation path.','The saved state is clean and discard restores the last saved revision. Keyboard shortcut and close-dialog behavior remain in LP-04.',['gp-project']],
  ['IN-04','Generated media previews','Ingest the fixture pack and inspect the generated thumbnail, filmstrip and waveform artifacts.','Expected artifacts exist, decode and match known media. Their visible layout remains in IN-04.',['gp-media']],
  ['TL-01','Insert and overwrite clips','Insert then overwrite clips at known frame positions using editor operations.','Clip order, durations, source offsets and affected track contents match exact expectations. Drag behavior remains in TL-01.',['gp-timelines']],
  ['TL-02','Split selected and unselected clips','Split at known frames with an explicit selection and with no selection.','Only the expected clips split and source ranges remain continuous. The B shortcut remains in TL-02.',['gp-timelines']],
  ['TL-03','Trim, ripple and slip','Apply one trim, one gap ripple delete and one slip through the editor operations.','Exact clip frame ranges, source offsets and gap lengths match the oracle. Gesture checks remain in TL-03.',['gp-timelines']],
  ['TL-04','Copy across frame rates','Copy and cut clips, paste within a timeline and into the alternate-frame-rate timeline.','Source identity, timing conversion and removal semantics match the documented frame-rounding rule. Clipboard shortcuts remain in TL-04.',['gp-timelines']],
  ['TL-05','Link and unlink audio/video','Link a fixture audio/video pair, edit it, then unlink and edit one component.','Linked operations affect the pair; independent edits after unlink affect only the target. UI selection toggle remains in TL-05.',['gp-timelines']],
  ['TL-06','Locked-track edit protection','Lock a track and attempt a split and move through the operation interface.','Both edits are refused and the timeline is unchanged. Drag and shortcut routing remain in TL-06.',['gp-timelines']],
  ['TL-08','Compound clip editing','Create a compound from two clips, edit its inner timeline and inspect the parent.','The compound and parent references remain valid; the expected inner edit survives save/reopen. UI navigation remains in TL-08.',['gp-compound']],
  ['CO-08','Source colour override','Set a fixture source colour-space override, render a reference frame, then revert.','The override persists correctly and the reverted image returns to the baseline within tolerance. UI controls remain in CO-08.',['gp-media']],
  ['RG-01','Render graph operations','Add, connect, copy and remove supported local nodes through the graph operations.','Graph topology and ownership match the expected state; a short reference render confirms effect. Panel interaction remains in RG-01.',['gp-graph']],
  ['SB-06','Local spell execution and delivery','Run the local deterministic spell through the packaged operation path.','The run completes and its retained output is decoded and linked to the correct bin asset. Console presentation remains in SB-06.',['gp-spell']],
  ['EX-01','Short movie export','Export the GP primary timeline range through the packaged export operation.','The output decodes with expected dimensions, frame count, colour samples and audio timing. Cmd+E and subjective preview comparison remain in EX-01.',['gp-media','gp-timelines']]
];
const laterAuto = new Set(['LP-03','OZ-08','OZ-15','OZ-16','EX-04','PF-15','PF-17','PF-19','PF-21','PF-23','PF-25']);
function fixtureFor(row) {
  if (row.environment === 'NAS') return [];
  if (row.id.startsWith('TL-') || row.id.startsWith('PB-') || row.id.startsWith('UP-')) return ['gp-timelines'];
  if (row.id.startsWith('IN-') || row.id.startsWith('SS-')) return ['gp-media'];
  if (row.id.startsWith('SB-')) return ['gp-spell'];
  if (row.id.startsWith('CO-') || row.id.startsWith('RG-')) return ['gp-graph'];
  return ['gp-project'];
}
const tests = source.rows.map(row => {
  const placeholder = /^\[New feature/.test(row.criteria);
  const first = Boolean(auto[row.id]);
  const deferred = row.environment === 'NAS' || row.area === 'Performance' || laterAuto.has(row.id);
  const definition = auto[row.id];
  return {
    id: row.id, sourceId: row.id, title: definition?.[0] || row.criteria,
    area: row.area, criteria: row.criteria, environment: row.environment,
    execution: placeholder ? 'Unassigned' : (first || laterAuto.has(row.id) ? 'Automated' : 'Human'),
    course: placeholder ? 'Backlog' : (first ? 'First automated' : (deferred ? 'Later' : 'Human')),
    readiness: placeholder ? 'Draft' : (first || laterAuto.has(row.id) ? 'Needs mapping' : 'Human checklist'),
    priority: first ? 'P0' : (placeholder || deferred ? 'P2' : 'P1'),
    owner: row.owner === 'All' || row.owner?.includes('TBD') ? 'Unassigned' : row.owner,
    fixtureIds: definition?.[3] || fixtureFor(row), gpScope: first ? 'GP v0' : (deferred || row.area === 'Oz / MGFX' || row.area === 'New Features' ? 'Extension' : 'Review'),
    approach: definition?.[1] || (placeholder ? 'Define the feature and expected outcome.' : (row.environment === 'NAS' ? 'Deferred until the local course works. Execute the original checklist manually in the meantime.' : (laterAuto.has(row.id) ? 'Candidate for a later automated course; identify required fixtures and observable checks.' : 'A person executes the complete original checklist step. No automated handoff in this version.'))),
    expected: definition?.[2] || row.criteria,
    blocker: first ? 'Map a packaged operation and define independent assertions; the GP fixtures are not built yet.' : (deferred ? 'Outside the first local GP course.' : ''),
    notes: '', sourceRow: row.sourceRow, kind: placeholder ? 'Placeholder' : 'Original',
    revision: 1
  };
});
for (const [sourceId,title,approach,expected,fixtureIds] of companions) {
  const original = tests.find(t => t.id === sourceId);
  tests.push({...original,id:`A-${sourceId}`,title,criteria:approach,execution:'Automated',course:'First automated',readiness:'Needs mapping',priority:'P0',fixtureIds,gpScope:'GP v0',approach,expected,blocker:'Map packaged operations and reference checks. This covers editor behavior; the original UI checklist remains a separate human test.',kind:'Automated counterpart'});
}
const components = [
  {id:'gp-project',name:'Disposable project bundle',kind:'Project',spec:'GP-local-v0.1: known project settings, named bins and a manifest of stable asset identities.',purpose:'Open, save, dirty state, real process restart and CLI attachment.',status:'Specified'},
  {id:'gp-media',name:'Six small local media fixtures',kind:'Media pack',spec:'pattern_24.mov (ProRes, 12 s, 1080p24, stereo + frame marks); motion_25.mp4 (H.264, 8 s, 1080p25); speech.wav (8 s, 48 kHz); still.png (1080p); sample.mxf (6 s, 1080p25); mask.png (grayscale). Filenames are stubs.',purpose:'Mixed import, metadata, source references, thumbnails, audio, relink, colour and export.',status:'Specified'},
  {id:'gp-speech',name:'Known speech and search expectations',kind:'Oracle',spec:'speech.wav contains one recorded phrase and timed speech markers. Include a unique filename token and an absent search token. Pin the local ingest configuration.',purpose:'Transcript generation, timestamp search and newly ingested search coverage.',status:'Specified'},
  {id:'gp-timelines',name:'Two short timelines',kind:'Timeline',spec:'Main at 24 fps with 2 video / 2 audio tracks, linked AV, one gap and overlapping clips; Secondary at 25 fps with a distinct asset. Variants are made in disposable copies.',purpose:'Insert, overwrite, split, trim, slip, link, undo/redo, targeting and cross-rate copy.',status:'Specified'},
  {id:'gp-compound',name:'One small compound',kind:'Timeline',spec:'Two existing fixture clips grouped into a compound with a known inner timeline.',purpose:'Compound creation, inner edits and persistence.',status:'Specified'},
  {id:'gp-graph',name:'Minimal colour graph',kind:'Graph',spec:'A local source and supported colour node with a mask input. Expected graph topology and reference renders are versioned.',purpose:'Node operations, colour changes, mask wiring and reversible edits.',status:'Specified'},
  {id:'gp-mask',name:'Known grayscale mask',kind:'Media',spec:'Use mask.png from the media pack: half white, half black, with a narrow gray transition.',purpose:'Check actual masked pixels, not only a successful graph connection.',status:'Specified'},
  {id:'gp-spell',name:'One local Spellbook graph',kind:'Spellbook',spec:'still.png → two supported local image effects → output. No external provider. Record graph parameters, output properties and retained result identity.',purpose:'Graph edits, local execution, delivery to the bin and restart persistence.',status:'Specified'}
];
const gp = {id:'GP-v0',version:'0.1',name:'Limited local Golden Project',status:'Specification only',components,excluded:['NAS mounts and disconnects','Large and performance projects','Historical-format project fixture','External AI generation and live model checks','Third-party OFX / AU plugins','MGFX generation and complex graphics','Human/agent handoff orchestration'],rules:['Use a fresh disposable copy for independent tests.','Keep the source project and media pack read-only.','Record exact build, fixture version and test revision for every run.','Do not mark GP support as ready until the actual fixture and reference results are validated.']};
const payload = {schemaVersion:1,source:{file:source.source,sheet:source.sheet,build:source.sourceBuild,date:'2026-09-25',originalRows:source.rows.length},gp,tests};
writeFileSync(new URL('catalog/catalog-seed.json',root),JSON.stringify(payload,null,2)+'\n');
console.log(`${tests.length} canonical rows; ${tests.filter(t=>t.course==='First automated').length} first-course candidates; ${components.length} GP components.`);
