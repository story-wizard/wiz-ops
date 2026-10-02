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
