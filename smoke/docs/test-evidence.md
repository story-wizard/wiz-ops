# Read, run and edit a smoke check

A test has a stable ID, an expected result and a definition hash. A prepared course freezes its selection, build, fixtures and runner. New runs also retain `test-specifications.json`, including the readable method and evidence requirements. Changing a check does not rewrite earlier results.

## Read a result

Open a check in the report. The panel shows the expected behavior, the observed result, the method, the recorded actions, evidence and an edit prompt. Operation receipts describe what was dispatched or observed. The test verdict comes from the independent assertions in its implementation.

Tests that use `step` also retain explicit setup, action, verification and cleanup steps. A started step without a completion receipt is Unknown. A later step without a start receipt is Not run. Historical reports use their recorded operations when explicit steps were not retained.

## Declare evidence

Add `evidence` to a check in its course JSON. Each entry names its purpose and collection point:

```json
[
  {"id":"operations","kind":"json","when":"during","required":true,"caption":"Application requests and independent timeline readback."},
  {"id":"app-state","kind":"image","when":"after","required":true,"caption":"The clip visible after the drop."},
  {"id":"preview-clip","kind":"video","when":"during","required":false,"caption":"Sampled preview sequence during the held gesture."}
]
```

Supported kinds are `image`, `video`, `audio` and `json`. Supported collection points are `before`, `during`, `after` and `failure`. Without an explicit declaration, a check requires its operation journal. The report lists missing required evidence separately from the recorded verdict.

Retain artifacts in the owned run directory. Include them in the result’s `evidence` object using absolute paths inside that directory or `evidence/` relative paths. Pass and fail results may both retain artifacts. Use captions to explain what a reader should look for. Screenshots and recordings must target the owned app window or preview, rather than the whole desktop.

The shared desktop check helpers automatically retain a failure-state JSON file and a screenshot of the observed owned window when capture is available. The JSON includes the original error, the last UI inspection, wait diagnostics and any capture errors. Capture failure does not replace the original verdict. These screenshots are Qt widget rasters; tests of displayed GPU imagery still need their declared presented-window capture. Bounded observation waits retain the expected condition, attempts, elapsed time and last returned observation. Give waits a descriptive condition when authoring checks.

The physical Render Graph checks require a `graph-state` JSON capture, retained as `CHECK-ID-graph-observations.txt`. It holds the before and after graph state used by the assertions. Input receipts cannot satisfy that requirement. Named `-before`, `-after` and `-undo` captures retain their collection point even if a later step fails.

The physical live-preview checks retain timed PNG samples and before/after graph JSON. Report export can encode those samples into a video at their observed spacing. This is a sampled preview sequence. Full motion or audio checks should declare and capture their own recording.

## Record readable steps

Declare a `steps` array in the check definition, with `id`, `title` and `phase`. In a desktop check:

```js
const {step} = await checks(sessionFile, 'desktop-report.json');
const fixture = await step({id:'setup', title:'Create an empty timeline', phase:'prepare'}, () => createFixture());
await step({id:'drop', title:'Drag the media row onto V1', phase:'execute'}, () => dragMedia(fixture));
await step({id:'verify', title:'Check source, position and duration', phase:'verify'}, () => verifyPlacement(fixture));
```

Requests made inside a step carry its ID. Assertions remain in the callback. Let errors propagate so the journal retains Fail, Blocked or Unknown. Do not catch an uncertain mutation and repeat it.

## Give an agent the context

```sh
node scripts/smoke.mjs context --check D-TRACK-ADD
node scripts/smoke.mjs context --check D-TRACK-ADD --export
```

The first command returns the definition, source pointers, focused run commands and edit prompt. The second retains a small context folder outside Git, with a manifest, guides and reference source. Start with `START-HERE.md`. The field guide’s **Edit this test** section also offers **Download context** and **Prepare agent pack**. Preparation records the folder path for the user to give their agent; it does not launch Wizard. `--run ID` selects the frozen definition and observed result from that run. A complete build/media rerun bundle remains available through `smoke kit --run ID`.

For a service on another port, add `--server http://127.0.0.1:PORT` to the CLI command. Context packs created through the service retain that address in their commands; direct desktop probes still use their prepared plan.

For edits, work in the source checkout. The context folder contains reference copies. Run the harness checks and a focused disposable test, then submit a changed accepted definition for lead review before adding it back to custom courses. For experiments, use the shared modules and atomic CLI tools in `docs/agent-tools.md`; resolve identities from current observations.

## Compose a test from reusable parts

Write each check so an agent can run it alone, include it in a course, or reuse its fixture and assertions in another check. The unit of composition is a behavior with explicit inputs and an observable outcome. A course selects those behaviors; it should not supply hidden state that makes them work.

| Part | What it owns | Existing components |
|---|---|---|
| Definition | Stable ID, intended behavior, prerequisites, readable steps and evidence requirements | Course JSON and frozen test specifications |
| Fixture | A disposable project and returned project, timeline, clip and asset identities | `ProjectSession`, `gapFixture`, generated fixtures |
| Action | The actual path being tested | Application operations, Qt actions, or `physical-input.mjs` |
| Assertion | Readback compared with independently defined expectations | `verifyTrimmedClip`, `editorCheckpoint`, rendered pixel/audio measurements |
| Evidence | Before/after state, input receipts and useful captures | `checks().step`, operation journals, owned-window capture |
| Cleanup | Stop owned processes or restore the exact fixture | Session shutdown and explicit Undo/reopen checks |

Pass fixture identities and observations as arguments. Return a small result that another check can inspect. Keep state comparison functions free of launches, clicks and file writes; this makes them usable by scripted runs, agent attempts and small framework tests. The transport adapter handles process ownership and receipts. The assertion handles the behavior.

Choose the tested action deliberately. CLI setup is useful before a mouse gesture; the gesture itself must still use physical input when that is the claimed coverage. Use a read-only observation after the gesture. Do not use a repair operation to manufacture the expected state before checking it.

Do not chain otherwise independent checks through a shared mutable timeline. If a check really requires an earlier result, declare the dependency and block it when that prerequisite fails. Other checks should continue in fresh fixtures. A retry is a new attempt with its own evidence.

## Examples worth copying

These implementations show different kinds of testing, including patterns useful outside Wizard:

| Example | Pattern to reuse | Incorrect outcomes the assertion rejects |
|---|---|---|
| `P-TL-BIN-DROP` in `desktop/check-physical-editor.mjs` and `desktop/editor-proof.mjs` | Prepare through application operations, perform a real drag, inspect exact destination state | Wrong source, track, position, duration or unexpected extra clips |
| `P-RG-WIRE` in the same files | Bind source/destination identities, connect through physical input, compare the exact graph, then Undo/Redo | Wrong input port, extra edges, changed node parameters or incomplete restoration |
| `P-TL-TRIM` and `verifyTrimmedClip` in `desktop/check-support.mjs` | Separate the gesture from a pure state assertion | No trim, wrong clip/source, moved left edge, invalid source range or frame alignment |
| `P-CURVE-LIVE` and `livePreviewEvidence` in `desktop/check-support.mjs` | Check observations collected during a held action, using recorded input timing | Stale or blank samples, unchanged output, or changes appearing only after release |

The first three have runtime passes on the selected demo package in the October 2 qualification. The curve check demonstrates the authored sampling method; its latest runtime attempt was blocked by a desktop overlay. Keep implementation examples and runtime qualification results separately visible.

For graph assertions, read `tests/editor-proof.test.mjs`. It supplies correct state and representative wrong states to the production assertion. Wrong ports, unrelated mutations and foreign copied-node ownership must fail even when the input receipt says Dispatched. This is a useful general rule: every important assertion should have at least one small example of the defect it catches.

### Run an assertion without opening Wizard

From the command root, this example exercises the production trim assertion. It verifies a valid trim and proves that an unchanged clip is rejected:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {verifyTrimmedClip} from './desktop/check-support.mjs';

const before = {
  clip_id: 'example-clip',
  timeline_range: {start_seconds: 0, end_seconds: 4},
  source: {
    asset_id: 'example-asset', fps: 24,
    source_range: {start_seconds: 1, end_seconds: 5},
    projection_status: 'exact', projection_diagnostics: [],
    source_availability: 'bounded'
  }
};
const after = structuredClone(before);
after.timeline_range.end_seconds = 3;
after.source.source_range.end_seconds = 4;
assert.equal(verifyTrimmedClip(before, after, 24).projection, 'exact');
assert.throws(() => verifyTrimmedClip(before, before, 24));
console.log('Valid trim accepted; unchanged clip rejected.');
JS
```

This checks the assertion, with stub identities and no app input. Qualify the physical action separately on the designated build.

## Agent authoring brief

Give an agent an intended behavior, the build identity and a focused selection. Ask it to:

1. Find the closest maintained check and reuse its fixture, transport and evidence helpers.
2. State exactly what changes and what must stay unchanged. Resolve identities from current observations.
3. Implement the independent assertion and a small wrong-state example before claiming coverage.
4. Declare readable setup, action, verification and cleanup steps, plus evidence that explains the result.
5. Run framework checks and an authorized focused app test, retaining all outcomes and attempts.
6. Return the check ID, reuse points, evidence paths and remaining checklist scope for lead acceptance.

Reuse ordinary JavaScript modules and the existing CLI. Add a shared helper when two real checks need the same behavior. Wizard's adapters remain application-specific; the fixture/action/assertion/evidence pattern transfers to another application with its own operations and state reader.
