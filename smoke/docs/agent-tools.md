# Spot testing with an agent

For scoped UI observations, physical gestures, condition waits and evidence-backed agent session reports, use the [computer-use toolkit](computer-use-agent.md). It builds on the atomic operations described below.

The CLI, application adapter and native adapter work without the dashboard. They use the same installed desktop tools, ownership checks and operation receipts as the automated courses.

For a focused explanation and edit prompt, run `node scripts/smoke.mjs context --check D-EDIT-DELETE --server URL`. Add `--export` for a curated reference folder, or `--run ID` for the frozen source and result of a previous run. See [test evidence](test-evidence.md) for readable steps, evidence declarations and acceptance after editing. These commands do not execute a test.

## Find the build first

Use `node scripts/smoke.mjs builds --server URL` to read recent Wizard GitHub packages. Import one with `build --tag TAG`, `build --asset ID`, `build --url HTTPS_URL` or `build --path ABSOLUTE_PATH`, always with the same `--server URL`. Use the returned `result.app` in your plan. See [Build finder](build-finder.md) for prerequisites, channel conventions and cache behavior. Build JSON includes PR authors and links, separate from the workflow requester; selecting an author matches mixed-author builds. Read [shared build catalog](shared-build-catalog.md) for durable metadata and incremental refresh.

The dashboard offers the same choices through Find a build. Its saved filter views are browser preferences, separate from the CLI's frozen course selection. Reports keep their saved views in the report link.

## Discover and run one check

From `smoke/` in a checkout or the installed bundle’s `workspace`, with the service running, set `ATHANOR_URL` to its printed URL:

```sh
export ATHANOR_URL="http://127.0.0.1:PORT"
node scripts/smoke.mjs setup --server "$ATHANOR_URL"
node scripts/smoke.mjs list --target desktop --server "$ATHANOR_URL"
node scripts/smoke.mjs plan --app /Applications/Wizard.app --checks D-EDIT-DELETE --out /tmp/track-check-plan.json --server "$ATHANOR_URL"
node scripts/smoke.mjs run --plan /tmp/track-check-plan.json --operator "Agent spot test" --request-id track-check-001 --server "$ATHANOR_URL"
node scripts/smoke.mjs status --request-id track-check-001 --server "$ATHANOR_URL"
```

`setup` returns known builds, courses and the automatic desktop-tool selection. `list` returns course-catalog definitions with their operations and requirements. The default `smoke-full` also includes explicit physical qualification candidates; unlinked exploratory checks remain in an owned session's context; see [computer-use testing](computer-use-agent.md). `plan` adds the declared prerequisites and freezes the exact selection; it does not execute the check. `run` executes only that selection and its prerequisites. The resulting verdict and evidence appear in Results. See [agent-friendly courses](agent-courses.md) for wait, cancel, report and request recovery.

Desktop/service plans automatically prepare an external adapter for the selected package and its shipped CLI. They never substitute a separate test app. Use `prepare` and poll `preparation --id ID` for step progress and a repair prompt; see [desktop setup](desktop-tools-setup.md). Packaged-only plans do not need the desktop adapter.

## Use atomic operations

For exploratory testing, prepare a desktop plan as above, then open an owned session instead of executing the course:

```sh
node desktop/session.mjs schema
node desktop/session.mjs start --plan /tmp/track-check-plan.json
```

Keep the start command running. It prints the owned session file, PID and project identity, then waits for that app to exit. It prepares a disposable baseline project and opens the selected package with external instrumentation. It does not run the selected checks. An unattended session is limited to 30 minutes.

In another terminal, replace `SESSION.json` with the returned path:

```sh
node desktop/session.mjs call SESSION.json project.get_name '{}'
node desktop/session.mjs native SESSION.json inspect '{}'
node desktop/session.mjs stop SESSION.json
```

`schema` reads the captured desktop CLI contract without launching an app. `call` invokes one application operation. `native` invokes one native adapter operation, such as `inspect`, `click`, `key`, `select`, `text`, `drag`, `action` or `snapshot-presented`. Choose widget/action IDs from the latest inspection and use the parameter shapes demonstrated by the maintained desktop checks. The adapter binds each request to the owned process and GUI generation. Service sessions reject foreground input.

Application calls retain requests, responses and observed revisions in `operations.jsonl`. Native calls retain requests and responses in `native-events.jsonl`. Resolve returned identities, query the resulting state, and assert the behavior you intended. A dispatch receipt or success envelope is not a passing check. An ambiguous action remains Unknown and must not be replayed automatically.

Atomic probes keep their evidence in the owned session directory. During a tracked toolkit attempt, raw call/native commands share its admission boundary. Unqualified mutations invalidate its proof. They do not create dashboard Pass records. Use a focused course when a probe needs a durable verdict in Results.

## Compose tools in JavaScript

The shared UI helpers are in `desktop/ui-workflows.mjs`: owned fixture setup,
exact clip selection, physical field entry, revision-bound model traversal,
media identity readback and distinct retained captures. Pure grade, meter and
search assertions live in `desktop/ui-cohort-proof.mjs`. Use them in focused
courses or your own driver; dispatch success does not satisfy those assertions.

The toolkit exposes `observe` and `find` with an optional `scope` widget ID.
Scoped absence applies only to that subtree. `model` returns a cursor containing
the model identity, revision and root. Supply it on following pages; restart
observation if the model changes. `reveal` scrolls one observed row into view and
is a setup mutation. `model_value` reads an observed column and bounded Qt role,
including retained thumbnail images. Bind build-specific roles to independent
CLI identities before relying on them; column names come from the returned
headers. Never read guessed private object layouts.

Physical clicks support `clickCount: 2`. Clicks and drags support held
`modifiers: ["alt", "shift"]`; drags may carry a bounded path of 2–128 points in
one observed native window. The driver releases held keys and the pointer after
normal completion, guard rejection, SIGINT or SIGTERM. SIGKILL cannot run that
cleanup. Do not disable process/window/focus checks to get a gesture through.

The missing-term search, 100-clip clipboard and 50-step history candidates now
share their scripted assertions with interactive agent checkpoints. `begin`
returns the expanded action/checkpoint contract. Follow it exactly, verify each
checkpoint and retain the declared captures. The history contract has 150
explicit checkpoints; repetition is not a substitute for observed intermediate
states. New UI cohort candidates run through the normal course CLI and keep
their human-readable steps and evidence declarations in `desktop/course.json`.
The clipboard contract has a separate empty-destination checkpoint. Verify and
capture its newly observed canvas before Paste; it may have a different widget
ID from the source. Include these candidate IDs in the plan before starting an
interactive session, then use the returned contract rather than guessing IDs.

`runner/engine.mjs` exports `PackagedEngine`. `runner/interactions.mjs` exports `ProjectSession` and rendering, ingest and state helpers. `desktop/adapter.mjs` exports session preparation, launch, application calls, native calls and shutdown. They remain ordinary modules, independent of the web UI.

See the [interaction library](interaction-library.md) and the maintained checks for examples. Keep setup, action, independent verification and evidence distinct. Use explicit projects, timelines, assets and widgets rather than a guessed current selection.

Build discovery displays 10 records per page by default. Filters search all retained metadata before pagination. Agents can use `builds --author me --page 2`, `--page-size all` for the cached catalog, and `--github-page N` to load older metadata in batches of 50. Inspect `nextGitHubPage` and `hasMoreGitHub` before requesting the next provider page.

For a new build or feature that changes preparation or a mapped operation, use [build repair](build-repair.md). Exported context packs include a copyable repair prompt and the schema qualification references.

## Record a bounded playback window

Find the current `MetalPreviewWidget` and the intended `TimelineWidget` using the toolkit. Bind the canvas to CLI clip identities, start the behavior being tested, then collect timed evidence:

```sh
node desktop/session.mjs tool SESSION.json recording '{"target":"PREVIEW_ID","timelineTarget":"CANVAS_ID","timelineId":"TIMELINE_ID","durationMs":12000,"intervalMs":1000,"maxSamples":8}'
```

The operation returns owned artifact paths, sample count, elapsed time and collection cost. The manifest keeps fresh frame receipts, transport brackets and CPU/RSS. The video preserves sampling gaps and uses the selected package's OpenH264 encoder, with dimensions rounded to even pixels; the original PNGs remain available. A tracked attempt exports the video, images and manifest together. This is diagnostic collection; an authored assertion still decides Pass, and toolkit proof captures remain separate.

JavaScript drivers can call `recordPresented` and `verifyPlaybackRecording` from `desktop/recorder.mjs`. Provide an observed worker interval when testing concurrent work. The pure verifier rejects wrong-process, stale, blank, static or stopped samples and insufficient overlap.

For a clipped floating panel, use the native `resize-window` operation with an observed top-level window ID and integer `width`/`height`. The adapter checks the available display and minimum control size. `floatPanel` in the shared UI helpers opens a panel's dock menu and gives its controls usable space. This is fixture setup; use physical input for the behavior under test.
Activating or floating one dock can change which tab is visible in another area.
Use `activatePanel` for the intended existing dock, then bind its freshly observed
canvas to CLI clip identities. Keep dock visibility separate from keyboard focus.

## Compare control improvements

Use the [control harness baseline](control-comparison.md) to preserve and verify
the original matched comparison, prepare equivalent fixtures, and score new
attempts. `observe` now returns an `observationId`; repeat the same query with
`since` for an adaptive response: `encoding: "full"` has current `matches`,
while `encoding: "delta"` has `changes`. The smaller representation is returned.
Use `selectors: [{...}, {...}]` for 1–8 related control queries from one
inspection, instead of several round trips. Full snapshots stay local, and
observations remain diagnostic rather than Pass evidence. Native key aliases
are listed in the session context. Shared `physicalInput` rejects unsupported
fields; use `durationMs` for a drag and refresh geometry after a Blocked binding.


## Wait for a displayed preview

`capturePresented(file, target)` in `desktop/recorder.mjs` captures a fresh
compositor frame between two transport reads and rechecks process generation.
It works during playback and returns observations without assigning a verdict.

For a stopped preview, `waitForPreview(file, {target, frame,
playbackGeneration, timeoutMs}, accept)` retains every capture and transport
bracket. Supply `frame` and `playback_generation` from the current transport
read, and an independent pixel predicate in `accept(image, sample)`. It requires
two consecutive fresh, stopped, frame/generation-matching samples accepted by
that predicate, within a 1–15 second observation budget (6 seconds by default).
An unchanged wrong image cannot satisfy the predicate. Timeout evidence includes
all collected PNGs and `graph-observations-preview-after.json`.

Compositor freshness and logical transport agreement are recorded separately.
The build does not currently expose a public renderer-presented-frame identity.
Use a fixture or reference acquired before the tested gesture to check displayed
pixels; do not seek the reference while qualifying that gesture. Scrubber checks
now use physical input and this bounded sampler instead of a fixed 180 ms sleep.
The observation budget is separate from an accepted performance threshold.

Shared floating-panel setup waits for 250 ms of usable, unchanged geometry.
Import Files waits for the focused Go to Folder field in its owned key window.
These waits improve setup; the physical driver still validates each dispatch.

For the selected `2026.10.02-39f5d60` package, clip-graph readback reports a
projected timeline revision while single-edge edits check clip-local revisions.
The twenty-cut fixture therefore uses `graph.edit_batch` through the serialized,
owned `desktopCall` bundle-revision guard. It reads back each inserted node,
saturation value and both replacement edges before testing UI scrubbing.
Use this only for isolated fixture setup on the qualified build; a stale or
Unknown tested mutation still needs inspection and must not be replayed.
