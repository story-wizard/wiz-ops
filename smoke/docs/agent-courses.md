# Agent-friendly courses

Saved custom courses and one-off selections span packaged engine, instrumented desktop and background service checks through the same local API. For the first release, use [automated build testing](automated-build-testing.md). The optional human checkpoint extension is outside that shipping scope.

For atomic calls and exploratory sessions, see [agent tools](agent-tools.md).

## What you can do

- Discover all checks, their execution targets, categories and acceptance eligibility.
- Save grouped courses with stable IDs and revisions; inspect older revisions.
- Resolve a saved course, category, explicit IDs, or grouped selection into an immutable prepared plan.
- Run that plan, observe status, wait, cancel and obtain a local report.
- Recover a lost start response using its request ID without duplicating execution.

Each selected course adds its connection checks and any declared shared-fixture sequence. The plan lists those additions. Selection/bin checks prepare their own fixtures: choosing bin duplication adds only the packaged and desktop connection checks, while retaining its rename and save/reopen assertions. Neighboring selection, lock, targeting, gap, rename, delete and graphic checks run only when selected. Execution is serial: packaged checks, background services, then foreground desktop. Packaged checks own disposable projects. New selections default to grouped desktop execution: compatible drivers share an owned session with separate per-check fixtures; authored setup/persistence sequences retain their dependencies. Groups organize the report and do not create parallel execution.

## Default mixed course

`smoke-full` is the default course. It combines accepted definitions with explicitly allowed qualification candidates across engine, service and desktop targets, including physical computer use. Run `courses --server URL` and `list --server URL` for current membership and counts. Candidate results retain their definition and verdict; inclusion does not approve them for custom courses.

```sh
node scripts/smoke.mjs plan --app /path/to/Wizard.app --course smoke-full --out /tmp/full-plan.json --server URL
node scripts/smoke.mjs run --plan /tmp/full-plan.json --operator "Your name" --wait --server URL
```

Preparation attaches the adapter to a disposable copy of that exact package. Keep the Mac unlocked and available for foreground stages. Every desktop execution group gets a fresh project and owned session; compatible checks keep their own fixture state within that group. Fail and Blocked continue into unrelated groups after confirmed cleanup; an uncertain action stops its session. A package missing required operations retains a Blocked result instead of substituting another build.

`automated-full` remains the accepted-only course. User-created courses remain accepted-only. Warm live-grade sampling stays outside the default because it does not establish Logan's cold-cache criterion. Idle CPU measurement is retained as a separate candidate probe; see [idle candidate](idle-candidate.md). The default revision is now 10. NAS remains deferred.

## Acceptance boundary

Custom courses can reference only accepted check definitions. A positive acceptance entry binds a check ID to the digest of its executable definition. Changed definitions become ineligible until reviewed again. Saving a course cannot change test definitions, acceptance or the maintained full course.

Charles accepted all existing checks linked to Logan’s checklist on September 27: 137 definitions. That dated decision remains in `scope/accepted-checks.json`. Current lane membership and eligibility come from `list` and `courses`; unset-rate export uses the desktop lane because its valid fixture uses New Project. Unlinked team additions and later candidates remain outside that decision. Acceptance does not require a current passing outcome. Runtime failures and broader checklist coverage are unchanged.

Acceptance is read from `scope/accepted-checks.json`. It is a lead-reviewed source record, not an agent-callable approval operation. Without that record, discovery still works but saving/planning custom courses is blocked. A prior passing run alone does not create acceptance.

This narrow eligibility boundary is implemented. The broader submission/review/publication workflow below is a design for later.

## CLI

Start the local service with `npm start`. The following commands work without a Tower window. For reliable machine-readable stdout, call Node directly, or use `npm run --silent smoke -- ...`.

```sh
node scripts/smoke.mjs list --category color
node scripts/smoke.mjs courses
node scripts/smoke.mjs course save --file examples/color-regression.json
node scripts/smoke.mjs course show --id color-regression
node scripts/smoke.mjs plan --app /Applications/Wizard.app --course color-regression --out /tmp/color-plan.json
node scripts/smoke.mjs run --plan /tmp/color-plan.json --operator "Developer name" --request-id color-change-001 --wait
```

These operations create or execute a course only after its referenced checks have acceptance records. The example is a proposed user course, not an addition to the canonical full Smoke Test course.

One-off category or ID selection needs no saved course:

```sh
node scripts/smoke.mjs plan --app /Applications/Wizard.app --category color --checks UP-01,A-LP-02 --project fresh
node scripts/smoke.mjs status --run RUN_ID
node scripts/smoke.mjs status --request-id color-change-001
node scripts/smoke.mjs wait --run RUN_ID --timeout 300
node scripts/smoke.mjs cancel --run RUN_ID
node scripts/smoke.mjs report --run RUN_ID
```

Use `--plan-hash HASH` instead of `--plan FILE` to launch the plan returned by a plan command. Planning and running remain separate, so an agent can show exactly what will execute. Output files use exclusive creation to preserve existing plans.

Use `--server http://127.0.0.1:PORT` for a different local smoke service. Remote destinations are not supported by this CLI.

### Course and selection files

The example file demonstrates flat named groups. Save revision 0 to create a course. To edit it, provide its current revision; a stale revision is rejected. Each revision remains stored, and a prepared plan keeps the revision it resolved.

A one-off selection file can contain:

```json
{
  "title": "Color plus project lifecycle",
  "project": "fresh",
  "courseIds": ["color-regression"],
  "checkIds": ["UP-01"],
  "categories": [],
  "groups": [
    {"id": "reopen", "title": "Reopen", "checks": ["A-LP-02"]}
  ]
}
```

Pass it with `plan --app PATH --file selection.json`. Do not combine a selection file with selector flags.

For a focused rerun within one existing course, use `courseIds` with `subsetIds` instead of `checkIds`:

```json
{"courseIds":["smoke-full"],"subsetIds":["D-SOURCE-COLOR","D-MGFX-BIN-DROP"],"project":"fresh","title":"Focused repair rerun"}
```

Only members of that course can be selected. Its revision and qualification labels remain in the frozen plan; prerequisites are added explicitly. This does not accept candidates or add them to custom courses. Additional selectors cannot be mixed with a course subset.

Check categories include both the declared runner stage and the original checklist category. The color/colour selector therefore includes the rendered clip-disable check even though its runner stage is Render. Selection does not infer categories from ID prefixes.

Overlapping checks run once, while their group memberships remain in the frozen plan and report. The packaged connection check runs first. Other packaged checks preserve first-selected order; desktop/service stages preserve their authored setup and reopen order. Unavailable variants, unknown checks, unaccepted definitions and empty selections fail explicitly.

### Agent output and exit codes

All commands return a `wizard-smoke-cli/v1` JSON envelope.

| Exit | Meaning |
|---|---|
| 0 | A query/plan/report command succeeded, or a completed run passed every selected check |
| 1 | Completed execution contains a failed check |
| 2 | Completed execution is blocked, interrupted, unknown or otherwise incomplete |
| 3 | Invalid request, unavailable service or unsuccessful command; inspect its error and request ID |
| 4 | Run admitted/still active, waiting for a human, wait expired, or cancellation requested |

Check the command, `result.complete` and `result.needsHuman` as well as the exit code. `run --wait` and `wait` return and attach a local report on completion or a human pause. A pause is not a passing completed course. Report delivery errors are separate from the test verdict. `status` only observes the run; it does not generate another report.

A wait timeout does not cancel execution. Start is never automatically retried. Reusing the same request ID with identical plan/operator returns the existing run; using it with different inputs is rejected. The CLI includes the request ID in an ambiguous start error for later lookup.

## Fixtures and current limits

Desktop and service selections attach matching external tools to a disposable copy of the selected package. Prepare the build through the dashboard or `prepare` / `preparation --id ID`; readiness freezes the package, shipped CLI and adapter identities. A matching installed bundle supplies the tools. A source checkout can compile them with a matching SDK. Missing tools or capabilities produce a repair prompt. Legacy runtime descriptors are retained for historical tooling and must not substitute another app for the selected package.

GUI search uses the search worker bundled in that selected package, covered by its package fingerprint. Service checks reject foreground input before dispatch. Desktop groups use fresh projects and sessions; compatible checks share a qualified driver, while authored persistence families retain their own sequence.

`list --target desktop` filters discovery. Category selection defaults to packaged checks for compatibility; `plan --category color --target all` includes corresponding checks across targets. Explicit check IDs and saved courses can mix targets without this flag.

The `examples/accepted-automated.json` course groups the accepted definitions retained in that example. It does not accept qualification candidates or the broader scope inventory.

Fresh is the available empty starting project. A check's setup populates it as required. Story-user and Large are reserved future inputs and currently fail readiness explicitly.

Color-only plans use the six-file synthetic core pack and no speech model. Speech checks require the eight-file pack and pinned speech model; mixed-media import requires the eight files but does not require transcription. Core media and the ingest environment remain a shared preparation baseline in this first implementation, even for checks that use fewer assets.

Current package compatibility uses conservative structural qualification against a retained reviewed contract. Additive operations and wider request enums may qualify automatically; other changes require review. Read the frozen plan and [build repair](build-repair.md) for the actual decision. A local run kit retains the exact runtime inputs and lists required external libraries. It does not automatically qualify arbitrary new schemas. The separate [harness bundle](maintaining-harness.md) includes desktop libraries and an installation/update path.

The canonical full Smoke Test course and V1 scope remain distinct from a custom course. The maintained `packaged-full` selection represents the packaged engine checks, not the entire mixed course or every behavior in Logan's checklist.

## Friday release testing

Choose the downloaded Friday package explicitly. Use the maintained
packaged engine course first:

```sh
node scripts/smoke.mjs plan --app "/path/to/Friday/Wizard.app" --course packaged-full --out /tmp/friday-plan.json
node scripts/smoke.mjs run --plan /tmp/friday-plan.json --operator "Tester name" --request-id friday-release-001
node scripts/smoke.mjs wait --run RUN_ID --timeout 45
node scripts/smoke.mjs report --run RUN_ID
```

Repeat `wait` while the run is active. A changed package requires a new plan.
Keep an unexpected result in the report and investigate it after the release
test. The report names the tested builds: selected package engine, instrumented
desktop/services, and selected package computer use. Filter by build to review
each lane.

### Historical computer-use companion

The companion and smoke-only Cocoa replacement below document the earlier pilot. For new testing, use selected-build external attachment and the toolkit in [computer-use testing](computer-use-agent.md); the maintained mixed course integrates physical candidates. Do not replace the selected package’s Cocoa plugin as part of the current workflow.

The UI pilot adds projectless and project Preferences, New Project, Save As,
quit/reopen, both New Spell paths, both Spellbook search shortcuts, and float/redock. These are pilot definitions
linked to Logan's rows; their results stay separate from the accepted course.

```sh
node scripts/computer-use.mjs prepare --run RUN_ID --data-dir "/path/to/smoke/workspace"
node scripts/computer-use.mjs status --run RUN_ID --data-dir "/path/to/smoke/workspace"
node scripts/computer-use.mjs record --run RUN_ID --data-dir "/path/to/smoke/workspace" --file /tmp/ui-observation.json
node scripts/smoke.mjs report --run RUN_ID
```

By default, prepare retains an unchanged package copy and a frozen checklist under the run's
`computer-use` directory. Bind Computer Use to that exact app path, read each
case's steps, and use keyboard/mouse input. Save screenshots and accessibility
observations in its `evidence` directory. Use a scratch directory and copy the
files there if the computer-use sandbox cannot write to the workspace directly.
The app uses the current macOS user's preferences; these checks keep preference
values unchanged and use only owned test projects.

Record one terminal observation at a time using the current pass revision:

```json
{
  "id": "C-UI-05-PROJECTLESS",
  "revision": 1,
  "status": "Pass",
  "note": "Application Preferences opened without a project. Cancel returned to the hub.",
  "artifacts": ["evidence/projectless-preferences.jpg", "evidence/returned-hub.txt"]
}
```

PNG and JPEG screenshots retain their original bytes. Pass/Fail requires a
screenshot. New Project also requires `project` with a saved bundle path relative
to the companion root. Save As requires `project` and `original`; independent
inspection checks that the original and copied timelines retain their bytes.
Saved projects belong under `projects/`. An already recorded verdict cannot be
overwritten. A fresh automated run supplies a fresh UI companion.

The New Project Location field takes the complete bundle path, for example
`.../computer-use/projects/Release UI First.wiz`. Supplying just the `projects`
directory creates a sibling `projects.wiz` bundle.

Use `--checks ID,ID` on `prepare` to freeze a subset in the requested order.
Save As and quit/reopen require New Project earlier in that selection.

### Smoke-only Cocoa attachment

An optional attachment replaces the Cocoa plugin in the owned copy of an
already built arm64 app. It supports the locally qualified Qt 6.11.2 plugin:

```sh
node scripts/computer-use.mjs prepare --run RUN_ID \
  --cocoa-plugin /path/to/reviewed/platforms/libqcocoa.dylib \
  --cocoa-sha256 REVIEWED_SHA256 \
  --checks C-UI-05-PROJECTLESS,C-LP-02-NEW,C-UI-05-PROJECT,C-LP-02-REOPEN
```

The runner checks the supplied hash and bundled Qt version, rewrites the
plugin's two Homebrew framework links to the app's original bundled frameworks,
and signs the replacement locally. It rejects any other package-file change.
The companion retains the source package hash, modified package hash and plugin
hashes. Reports label this lane "Smoke copy · patched Cocoa plugin".
The installed app and build pipeline stay unchanged.

September 30 qualification on `oz-model-reg-ui2` passed projectless Preferences,
New Project/save, project Preferences and a normal quit/reopen. The corner New
Spell button worked. Canvas coordinates were rejected by Computer Use with
`windowNotFoundAtPosition`, so shortcut and dock gestures remained blocked.
The earlier Save As probe crashed with a different QtWidgets accessibility stack.
Qualify each downloaded package before relying on this attachment for its UI course.

If the app exits or an action's outcome is uncertain, record `Unknown`, retain
the observation, and mark dependent checks `Blocked`. On September 30, the
`oz-model-reg-ui2` package passed projectless Preferences, then crashed in the
macOS accessibility path during New Project. The remaining three pilot checks
were blocked. Qualify this path on Friday's package before assigning it a UI
pass.

### Native input fallback

When the standard Computer Use app or coordinate lookup fails, use the owned
companion's native input command. It discovers the Unix PID by the exact
`wizard-bin` executable and reads that process's accessibility windows directly.
It uses accessibility actions for controls, macOS pointer events for physical
clicks/drags, PID-targeted keyboard events, and window-specific screenshots.

```sh
node scripts/computer-use.mjs input --run RUN_ID --data-dir "/path/to/smoke/workspace" --file /tmp/native-request.json
```

Start with `{"command":"inspect","depth":16}`. Use the returned PID, start time,
window ID and frame in subsequent requests. An example drag request is:

```json
{
  "command": "drag",
  "pid": 12345,
  "started": "COPY THE INSPECTED START TIME",
  "window": 67890,
  "frame": {"x": 100, "y": 100, "width": 1200, "height": 800},
  "button": "middle",
  "x": 400, "y": 300,
  "toX": 450, "toY": 330
}
```

Replace the sample identity and geometry with fresh observations. Coordinates
are relative to the window in macOS points; captures are two pixels per point.
`button` accepts `left` (default), `middle` and `right`. Other commands:

- `click`: same identity/geometry with `x`, `y`.
- `key`: same identity/geometry with `key`, such as `cmd+shift+n` or `cmd+k`.
- `action`: PID/start time, observed `path` or unique `identifier`, `role`, `title`,
  and optional `action` (default `AXPress`).
- `set-value`: same control identity with bounded `value`; secure fields are rejected.
- `screenshot`: PID/start time and `window`; the runner assigns its evidence path.

The helper compiles once into the external workspace using the installed Swift
compiler. Requests and receipts are retained under the run's `evidence/` folder;
screenshots can be passed directly to `record`. The helper checks package and
driver hashes, process start time, window geometry, foreground ownership and
pointer hit tests. It uses existing permissions and stops when they are absent.
It makes no app bundle, signature, preference or permission changes.

`Observed` identifies a successful read. `Dispatched` requires a subsequent
state or screenshot assertion. `Blocked` means no input was dispatched;
`Unknown` requires inspection before further actions and is never replayed
by this helper. The CLI returns exit 2 for either nonpassing state.

September 30 qualification on the existing smoke copy verified New Spell by
both native click and Command-Shift-N, Command-K search, panel-divider movement,
and physical middle-button canvas panning. Search-panel opening also reproduced
a QtWidgets accessibility crash in `QComboBox::clear`; retain it as a failed
app path. Node movement, wiring and float/redock still need their own fixtures
and outcome checks. These observations do not replace earlier frozen results.

### Physical Spellbook candidates

The next physical course exercises six Logan paths: New Spell (SB-01), both
search shortcuts and glossary drag/drop (SB-02), wire connection with Undo/Redo
(SB-03), D bypass (SB-05), node-move Undo boundaries (SB-11), and float/redock
with retained canvas content (SB-09).

These definitions live in `desktop/physical-course.json`. They are included as qualification candidates in `smoke-full`, while remaining outside the accepted set. Use an existing prepared plan with the
isolated desktop runtime and the current runner fingerprint. Execution exports
an interactive report automatically:

```sh
node scripts/probe-physical.mjs --list
node scripts/probe-physical.mjs --plan /absolute/current-plan.json
node scripts/probe-physical.mjs --plan /absolute/current-plan.json --checks P-SB-WIRE,P-SB-GESTURE-UNDO
node scripts/export-physical-report.mjs /absolute/desktop-run/session.json
```

Each check prepares a new Spell. CLI operations author fixtures; native input
executes the tested gesture; CLI state, widget geometry and retained screenshots
verify the result. The wire fixture uses an image source and one blur with its
image and mask inputs. Source → two effects → output remains an expansion of
that row.

For these node-heavy checks, `physical-input.mjs` combines Qt widget inspection
with the native driver's `window-server` mode. It reads window ownership and
geometry through CoreGraphics and sends physical events without querying Qt's
accessibility tree. This avoids activating the combo accessibility crash path.
The driver checks popup layers, both ends of cross-window drags, process start
time and foreground ownership. Floating panels use their native title bar;
docked panels are resolved through their owning dock area, including elided
labels. Float/Detach uses an observed context-menu action. Existing accessibility commands remain available for other controls.

The local report uses the same filtered/sortable report table and keeps requests,
receipts and screenshots under expandable evidence. An uncertain mutation stops
execution. A failed assertion remains a failed result for investigation; the
runner does not repair the application or publish Jira issues.

### Physical editor candidates

```sh
node scripts/probe-physical.mjs --course editor --list
node scripts/probe-physical.mjs --course editor --plan /absolute/current-plan.json
node scripts/probe-physical.mjs --course editor --plan /absolute/current-plan.json --checks P-RG-WIRE,P-CURVE-LIVE
```

This candidate course maps seven physical paths to TL-01, RG-01, PF-05 and
PF-07. Every mutating path creates a fresh timeline/clip. Bin drops explicitly
keep timeline settings when Wizard asks. Known drop rejections are captured
and dismissed; an unexpected modal dialog blocks further execution.

Render Graph port geometry is read from the smoke plugin; mouse gestures and
shortcuts use the verified native PID/window driver. The driver accepts bounded
drag durations up to ten seconds. Native execution is asynchronous so the
runner can sample the displayed Metal preview while the pointer is held.
Only samples entirely between recorded mouse-down/up times count. Live-preview
assertions reject stale, blank, unchanged and post-release-only frames. Reports
retain sample images, capture timings, input receipts and graph observations,
including when a check fails.

PF-05 currently uses an existing primary-grade node and a warmed displayed
frame. Cold-cache first-frame qualification remains a separate expansion.
The local sample intervals measure observation responsiveness; frame-rate and
stall acceptance budgets still need their own measurements and agreement.
TL-01 insert placement and RG-01 adding a node from the library remain separate
paths. Candidate outcomes stay outside the accepted set until reviewed. The default course includes bin drop/overwrite, move/pan, wire, clipboard, trim and continuous curve sampling; cold-grade sampling stays excluded.

## Local run kits

```sh
node scripts/smoke.mjs kit --run RUN_ID
```

Export retains the report, original projects/output/logs, media, package, optional instrumented app/CLI/Qt plugin, required cached model, and the source snapshot recorded at execution. It refuses changed packages or missing source snapshots. Historical runs made before source retention cannot supply an exact kit.

Move the exported folder, then run:

```sh
node workspace/scripts/kit.mjs check
node workspace/scripts/kit.mjs run --operator "Developer name"
```

The check verifies retained bytes and listed local library dependencies. Run starts its own loopback service, prepares the frozen selection from retained inputs and creates new results in the configured external workspace. Original evidence keeps its original paths. New projects use the relocated media and retained development libraries. The runner records loaded files and rejects libraries loaded from development checkout paths. Node and matching declared macOS/Homebrew dependencies are required. Keep kits local until evidence has been reviewed for external sharing.

## Future submissions and promotion — design only

Users and agents may propose new tests or reusable courses. The testing lead, Charles or a designated reviewer, decides what enters the accepted catalog or canonical full course.

Proposed lifecycle:

1. **Draft:** author defines intended behavior, source-row relationship, setup/variants, assertions and evidence requirements.
2. **Submitted:** freeze the candidate revision and attach execution evidence, representative wrong-result proof, and known limitations.
3. **Review:** testing lead accepts the stated scope, requests changes, or declines it.
4. **Accepted definition:** record reviewer, exact revision and acceptance scope. It becomes eligible for user-created courses.
5. **Canonical membership:** separately approve adding that accepted test or course to the full Smoke Test course. Release a new canonical course revision.

A useful custom course need not enter the canonical set. Acceptance of a test also need not make it mandatory in every full run. Changed behavior/assertions must return for review; previous run evidence remains tied to the old definition. Withdrawal affects future plans and must be explicit.

Do not allow a submitter or execution agent to self-approve merely because tests passed. Current source-file authority is a local development boundary, not a multi-user permission system. Reviewer roles, audit history, UI, approval commands and submission storage are not implemented in these slices.

## Jira mapping

- WIZ-506: named courses/subsets and chosen-package execution. Tower now supplies native course management, explicit package/runtime selection, plan review and launch.
- WIZ-504/505: preserved full scope, Fresh support and explicit future project variants.
- WIZ-507: frozen run definitions, interrupted outcomes and idempotent start receipts.
- WIZ-512: selection-aware local reporting; external delivery remains deferred.

No Jira records or external services were changed.

## Investigate outcomes

Use `investigation create/show/triage/link/review/export` and `investigations --run ID` to package a completed course, record agent triage, prepare a focused diagnostic selection and retain Report a Bug drafts for human review. See `docs/investigations.md` for the exact sequence and payloads. Exported `repro-selection.json` works with the existing prepare/plan commands; results and local notes remain separate.

## October 3 checklist expansion

`smoke-full` revision 3 adds four independent candidates: `D-SEARCH-FOCUS`, `D-INSPECTOR-BLUR-PHYSICAL`, `D-MASK-CLIPBOARD-PHYSICAL` and `D-SCOPES-VECTOR`. They remain outside the accepted registry until reviewed. Use a focused selection file with `courseIds: ["smoke-full"]` and `subsetIds` containing the desired candidate IDs. Each gets its own desktop group and owned fixture. Context packs for these maintained candidates supply that selection and the normal plan/run commands. On the selected October 2 nightly, search focus and physical blur/Undo passed. Mask paste retained an unexpected wiring failure, and vectorscope Post IDT retained a response failure. Read [Harness control](harness-control.md) for the three control layers and examples.

## Project lifecycle candidates

`smoke-full` revision 4 adds `D-PROJECT-NEW`, `D-PROJECT-SAVE-AS` and `D-PREFERENCES-PROJECTLESS`. Select each independently with a maintained-course subset. Each starts in its own owned project and uses Qt controls for the user action, CLI/file readbacks for content, normal Quit acknowledgments and a fresh process for reopening. They remain candidates until lead review. The original project is compared after creating or editing a separate bundle.


## Grouped and isolated execution

`smoke-full` revision 10 keeps grouped desktop execution and adds the three
[functional cohort candidates](functional-cohort.md) to the earlier 177-check
baseline. Compatible checks from one driver reuse its owned Wizard
session while creating their separate test timelines or Spells. Its file-loss and raw-note history checks use isolated sessions. Project lifecycle, live curve sampling, external
reload, preference changes, long history and selected import probes still use
separate sessions. Save/reopen assertions keep their required process restarts.

Choose `smoke-isolated` in the dashboard for the previous layout, or prepare the
same selection using `--desktop-mode isolated`. Existing authored shared-fixture
families stay together in both modes. For example:

```sh
node scripts/smoke.mjs prepare --app /path/to/Wizard.app --course smoke-full --server URL
node scripts/smoke.mjs prepare --app /path/to/Wizard.app --course smoke-isolated --server URL
```

A selection file may set `"desktopMode": "grouped"` or `"isolated"`. The frozen
plan records the policy; old plans without the field keep the earlier layout.
Check membership and acceptance are independent of execution mode. Failures keep
their evidence. Unknown is never replayed; after verified cleanup, checks that
never started can get one new session. A second setup failure remains Blocked.

Desktop group receipts record `startedAt`, `preparedAt`, `finishedAt` and
`durationMs`, plus the source report and session identity. Wall time includes
package/fixture preparation and cleanup. Keep these separate from action timings
and model reasoning time when comparing performance. Profiling collectors remain
future work.
