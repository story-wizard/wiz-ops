# Build, install and update the harness

Distribute a selected-build adapter bundle to testers. It contains the source, dashboard, agent tools, external Qt adapter and matching QtTest framework. It contains no Wizard application, historical runs or personal projects. Testers choose their Wizard build separately.

## Open the source checkout

From `smoke/`, run `npm run open`. The launcher chooses a local port and asks which browser to use on first opening. Agents use `npm run open -- --no-open` and pass its printed URL to CLI commands. No npm packages are needed.

## Make a bundle

On a Mac with a matching Qt SDK, select a package to establish the adapter version:

```sh
node scripts/harness.mjs bundle --app /path/to/Wizard.app --data-dir /external/build-workspace --out /external/Athanor-VERSION
node scripts/harness.mjs check --bundle /external/Athanor-VERSION
```

Bundling compiles or reuses the adapter, copies it beside the source, and verifies the complete inventory. It does not launch Wizard. The destination must be new and outside Git. The bundle can be relocated. Its manifest records source byte hashes, Git commit/tree identities, dirty state and tool hashes; it is an integrity check for a trusted bundle.

Selected-build bundles also include the compiled native input driver and foreground lease helper. They are matched by source hash and CPU architecture, copied into the external cache, and verified before use. Source-only checkouts compile this driver with the Swift compiler from macOS Command Line Tools. See [computer-use testing](computer-use-agent.md) for the agent workflow and physical permission checks.

## Install and open

Double-click `Install Athanor.command`, or from the bundle's `workspace` directory:

```sh
node scripts/harness.mjs install --bundle ..
node scripts/harness.mjs start --port 0
```

Installation keeps a versioned copy under the external WizardSmoke workspace and creates `Open Athanor.command`. It preserves old versions and reports, and refuses installation during active tests. Agents use `start --no-open`; `start --browser choose` changes the remembered browser.

Choose a build and course, press Prepare build, then Start checks after Ready. A bundle with matching tools needs no Qt SDK on the testing Mac. A different Qt version requires a matching adapter bundle or SDK compilation; preparation returns a repair prompt. Node.js 24+, local media tools and any course-specific model remain required. See [desktop setup](desktop-tools-setup.md).

## Update

Change source in Wiz Ops, run `npm test` and `npm run scope:check`, and retain focused runtime evidence. Make a new bundle in a new directory, let active tests finish, then install it. Prepare new plans after an update. Do not edit installed source or adapter bytes in place.

Legacy v1 bundles and `bundle --runtime FILE` remain available for historical tooling. They contain a separate instrumented app, which is not a valid substitute for the package selected in a new course.

## Qualify a packaged command schema

The baseline is `runner/contracts/installed-schema.json`. Extra reviewed package schemas are recorded by their exact hashes in `runner/contracts/packaged-schema-qualifications.json`, tied to that baseline hash. Preparation accepts the baseline, reviewed schemas, and conservative structural extensions of retained reviewed definitions. New operations and wider request enums can roll forward without a daily patch. Existing response, constraint, default and semantic-description changes still require review. The plan retains the compatibility decision and freezes the actual schema hash; readiness rechecks that exact identity. See [build repair](build-repair.md) for the complete policy. The instrumented desktop CLI has its own contract.

To qualify a new schema, read it using `wiz-cli project create --schema --no-spawn`, compare every operation against the baseline, inspect changes against the checks' requests and assertions, and add a qualification with its hash and review basis. Run the regression checks and prepare the actual package. Missing or unreviewed changes stay blocked. Updating the baseline requires reviewing its qualifications again.

The October 1 nightly differs only in `render.set_render_mode`: its mode enum adds `eighth` and the description clarifies preview resolution. The existing values and all other 161-operation contract fields are unchanged. This qualification makes that package usable with the mapped checks; it adds no new assertion for eighth-resolution playback.

## Regression checks and interrupted execution

### Repairing a failed course

Start with the retained run's package hash, schema, operation receipts and failure captures. Locate the failed phase before changing a check: fixture preparation, tested action, independent verification or cleanup. Fix shared bindings and validators before adding per-check workarounds. Preserve the original run and prepare a new plan from the repaired source.

The October 2 focused course ran on an unchanged `2026.10.02-39f5d60` nightly copy: 21 repair targets plus 13 fixture prerequisites. It finished with 30 Pass, 3 Fail and 1 Blocked. A separate source-colour retest passed after correcting its provenance assertion from `manual` to the observed `authored` value; the original failed attempt remains retained. Across the latest attempts, 19 of the 21 repair targets passed. MGFX bin duplication still shared its generation identity, and the physical bin drop was blocked by the macOS Screenshot overlay. The bin-name persistence prerequisite also failed. These remaining observations require follow-up; they are not repaired application behavior.

| Repair | Focused checks | Required result |
| --- | --- | --- |
| Common fields in schema unions; MGFX prerequisite receipts | S-MGFX-DUPLICATE-DEFAULT, S-MGFX-DUPLICATE, S-MGFX-CLIP-COPY, S-MGFX-PERSIST, D-MGFX-01, D-MGFX-CLIPBOARD | Actual independent generation identities, values and rendered pixels; a failed duplicate blocks persistence. |
| Valid carrier timing after UI edits | D-EDIT-SPLIT-REDO, D-EDIT-TRIM, D-EDIT-SLIP, D-BLADE-NO-SELECTION | Exact expected ranges, frame alignment, source identity and Undo/Redo still match. Rejected authority remains a failure. |
| Current preview readout | D-PB-01, D-PLAYBACK-SWITCH, D-EXPORT-STILL | The owned timecode or scrubber advances and seeks with transport; still output decodes correctly. Record which readout was used. |
| Expanded scope options | D-SCOPES-01 | The four promised modes react at each available tap. Record extra modes separately. |
| Supported Curves reset button | D-CURVE-RGB-CLIPBOARD, D-CURVE-HUE-RESET | Authored curve state clears or becomes neutral, pixels return to baseline and resetting the copy preserves the source. |
| Current MGFX bin placement | D-BIN-MGFX | Bin duplication creates an independent generation with matching initial pixels and independent edits. |
| Marked-range loop shortcut | D-PLAYBACK-LOOP | Retained transport samples show advancing frames and at least two wraps within the marks. |
| Deliberate missing-media startup | D-MEDIA-RELINK | Continue Offline is allowed once only for the selected check's single moved asset, matching bytes and owned paths. Relink restores live paths, pixels and persistence. Ordinary Missing Media still blocks. |
| Source-colour menu binding | D-SOURCE-COLOR | Select an observed editable menu value; independent graph provenance and pixels change, then Undo restores them. |
| Renderer-safe group paths | D-MGFX-BIN-DROP | New fixture directories exclude the URL fragment delimiter; the actual bin drop and resulting graphic still require verification. |

This is 21 prior failed or blocked checks. The planner adds their fixture prerequisites explicitly. Keep the ten-minute idle check out of this selection.

Missing Spellbook operations are build capability blocks. Report them before launching a GUI for a group that cannot execute; never substitute a fabricated model or a successful key dispatch. Physical input still requires a clear owned window. Occlusion diagnostics identify the covering process/window without retaining another application's document title.

Focused reproduction also found these important distinctions:

- Curves reset chrome can be outside the content ancestry. Bind the observed reset action to the editor's owning window, retaining uniqueness and panel identity. An omitted authored curve override means the application's neutral default; require the same node identity and independent baseline pixels as well.
- MGFX publication Redo can pass alone and fail after generation duplication and clip-copy activity. Preserve both attempts and the preceding sequence. Keep this authored reproduction separate from independent fixture groups.
- Twenty-cut scrubbing is **Not run** when graph insertion fails during setup. Retain expected and returned revisions in the operation journal. Do not retry a stale mutation blindly or weaken revision guards.
- Keep a controlled plain-path versus literal-`#` renderer reproduction when investigating path handling. Safe ordinary group paths avoid the defect; they do not establish that the application handles `#` correctly.
- External timeline adoption needs before/after state even when its expected notification never appears. A clipboard path that passes in isolation does not establish the original failure's root cause.

Reports collect declared output paths and capture receipts, rather than filenames displayed in UI models. A blocked check's unreached captures are labelled **Not reached**; collected artifacts remain visible, and missing required failure captures remain gaps. Worker exports retain operation receipts and stop on an uncertain worker outcome without replaying it.

Existing script groups share setup within a fresh fixture. Independent mutating groups retain separate projects. Before combining more checks, define their required baseline, mutations and verified restoration. Immutable fixture bytes and package/tool metadata can be reused; sharing live timelines or Undo stacks needs a separate design.

The `Athanor framework checks` GitHub workflow runs the framework suite and scope integrity check on macOS with Node.js 24 when smoke source changes. It exercises fixtures and local servers without a Wizard package or desktop permissions. Application courses run separately on the testing Mac.

Ordinary failed assertions remain recorded and the run continues through independent checks and stages. Script completion and individual test observations are separate. An unexplained nonzero exit or failed stage finalization prevents a successful run, preserves completed observations, and stops later stages. Pointer cleanup balances a synthetic press even if the verified application loses focus; new gestures still require current process and window ownership.

If Start loses its response, use **Check start status**. If no admission is found, **Retry original start** resubmits the same immutable request ID and plan. Do not generate a new request ID to recover a lost response. The server reconciles a racing or duplicate admission under that original ID.

For Core/App persistence changes, use [caller preflight](caller-preflight.md) to
select both sides of the boundary and inspect exact source identities. It is
read-only planning; build/test results, CI and packaged acceptance remain separate.

Managed MBP/Mini deployments use [pinned worker profiles](workers.md). Qualify updates in a new version and switch the owned supervisor only when idle; nightly execution never rebases a live checkout. Developer clones need no worker profile or scheduler.
