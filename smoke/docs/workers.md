# Athanor: developer harness and managed workers

Athanor is the QA system. The MBP and Mac Mini are execution platforms. Both use
exactly the same build preparation, catalog, course runner, Qt adapter, physical
input and investigation tools as a developer's clone.

## Developer desktop

From `smoke/`, with Node.js 24 or newer:

```sh
npm run open -- --no-open
node scripts/smoke.mjs setup --server URL
node scripts/smoke.mjs courses --server URL
node scripts/smoke.mjs list --server URL
```

Give your agent the printed URL, build and test request. It can select an existing
course or follow [functional testing](functional-testing-agent.md). No worker
profile, scheduler, Slack account or persistent service is needed. Results stay
in your external WizardSmoke workspace and return to you locally. Desktop work
still needs your available, unlocked GUI session and permission for the gesture.

## Managed MBP or Mini

Use a clean reviewed checkout or verified bundle. Host-specific paths belong in
an external worker profile. Do not copy a MacBook user's paths onto the Mini.

```sh
node scripts/worker.mjs init --name "Athanor MBP" --data-dir "/external/Athanor" --port 4317 --out "/external/Athanor/worker.json"
node scripts/worker.mjs check --profile "/external/Athanor/worker.json"
node scripts/worker.mjs serve --profile "/external/Athanor/worker.json"
node scripts/worker.mjs status --profile "/external/Athanor/worker.json"
```

Use `Athanor Mini` on the Mini. `init` records source bytes and Git identity when
available; it never launches Wizard. `check` rejects changed source. `serve`
starts the ordinary loopback dashboard with the pinned source and external data.
The server name is a display label, not authentication. Access it locally or with
an authorized SSH loopback forward; keep the existing Host/origin protections.

Status distinguishes an active run, preparation and owned desktop sessions. An
idle service still needs foreground/permission qualification before a GUI run.
The existing desktop lease is shared across workspaces on the same Mac. Two Macs
can execute independently, with separate profiles, runtime state and evidence.

Prepare through the ordinary CLI or dashboard. For managed dispatch:

```sh
node scripts/worker.mjs run --profile "/external/Athanor/worker.json" --plan-hash HASH --request-id RETAINED_ID --operator "Tester"
```

If busy, it returns the existing run/link without launching another. The runner
still repeats its admission checks atomically. Retain the request ID before
Start; inspect that ID after a lost response. Never replay an uncertain app edit.

A process supervisor may run `worker.mjs serve` in the runner user's Aqua login
session. Keep one scheduler per worker. A scheduled trigger uses this same
prepare/admission path; it does not own a separate testing engine. Keep a stopped
or paused automation paused until its source, desktop and reporting cutover is
verified. Use supported automation controls to update its prompt/schedule.

## One nightly plan and report

The maintained [functional suite](../examples/nightly/suite.json) contains 102
cases at this checkpoint. The [assertion map](../examples/nightly/mapping.json) accounts for all 161
expected results, including the newer cases. Each route identifies related checks
with pinned definition hashes and the work still required. At this checkpoint,
68 assertions have partial source overlap and 93 have no related executable check. Each assertion retains its own
status. Names and related catalog definitions never establish equivalence.

Before execution, retain the selected package hash and release changes, then:

```sh
node scripts/nightly.mjs plan --build VERSION --package-hash HASH --out "/external/Athanor/nightly/plan.json" --server URL
```

Use `--cadence weekly` for a weekly plan and report. Both cadences account for the same maintained inventories. Both freeze the existing grouped `smoke-full` selection in `execution.selection`,
including prerequisite closure, course revision and definition hashes. The cadence
label does not change a schedule or add longer tests. `execution.state` remains
`PLANNING_ONLY` until a separate authorized preparation/run.

Optional `--suite`, `--mapping`, `--changes` and `--proposals` use supplied JSON files. The plan
freezes normalized specifications, candidate definition hashes, package identity,
runner identity and external workspace. It performs no app input. New or changed
specifications invalidate old mapping hints. A changed or missing related check
definition sets `mappingNeedsReview` and marks its assertion support
`review-required`; agents must review the new behavior before reusing it. Older
case-only mapping files remain usable as unreviewed selection hints. The CLI also
rejects local course definitions that differ from the executing service catalog.

The plan also freezes every executable catalog definition and the separately listed candidates without an execution binding. The combined report shows all of them, including checks not selected for this run. A related catalog result remains separate from each functional assertion.

Use the frozen selection to prepare the applicable maintained course through
normal preparation. For this baseline:

```sh
node scripts/smoke.mjs prepare --app "/selected/Wizard.app" --course smoke-full --desktop-mode grouped --server URL
```

Compare the returned package/source, course revision and effective check IDs with
the retained nightly plan before Start. `execution.selection` is the resolved
selection receipt, not the input format for `prepare --file`. A changed course
needs a new nightly plan. Check package and source identities again before Start.
`execution.relatedCheckIds` lists related checks already in that selection; it
is a reuse hint, not a second run or proof of the functional assertions. Account for
unavailable features and qualification candidates explicitly. Keep the deferred
idle probe out of ordinary nightly courses. Independently execute remaining
eligible assertions with CLI/Qt, captures and physical input as required by their
script. Preserve explicit fixture, ordering and interaction requirements.

Record agent observations in an external JSON file:

```json
{
  "planHash": "EXACT_PLAN_HASH",
  "runId": "EXACT_RUN_ID",
  "assertions": [{
    "id": "CORE-01:1",
    "status": "PASS",
    "observation": "Describe the independently observed result.",
    "evidence": [{"path": "/external/Athanor/nightly/evidence/build.png", "sha256": "EXACT_FILE_SHA256"}]
  }]
}
```

Evidence must remain under the executing service's external workspace. Report
creation verifies file bytes; it does not judge whether an image proves the
expectation. Agent observations remain identified separately from catalog
results. A case passes only when every expected assertion has a recorded Pass.
Missing assertions stay NOT_RUN; partial matches stay PARTIAL.

```sh
node scripts/nightly.mjs report --plan "/external/Athanor/nightly/plan.json" --run RUN_ID --observations "/external/Athanor/nightly/observations.json" --out "/external/Athanor/nightly/report-NEW" --server URL
```

The new directory holds JSON, a filterable HTML report and copied checksummed agent evidence. The run must be
terminal and match the plan's package, version and runner identity. Existing
reports are never overwritten. Evidence locations refer to the executing Mac;
report generation does not upload or send anything. Keep delivery status separate
from test verdicts. Managed workers follow [owner-only reporting](poddy-qa-reporting.md);
developer clones return their local report to their user.

Use the existing investigation commands for catalog failures and focused repros.
Uncatalogued functional failures keep their assertion evidence and local bug
drafts; qualify a reusable check before treating them as runner cases. A person
reviews the final diagnostic evidence before submitting through Report a Bug.

## Updates and rollback

1. Assemble source on a clean branch, preserving other checkouts and live runs.
2. Run framework/scope checks and retain exact-package acceptance evidence.
3. Review and merge the tested revision. Install that exact version in a new
   checkout or versioned bundle after the worker is idle.
4. Create a new profile from that version, check it and qualify the GUI actor.
5. Switch only the owned supervisor to the new profile. Retain its prior source,
   profile, logs and workspace. Prepare new plans after the switch.
6. Reconcile the existing scheduler's prompt and reporting policy, then resume
   only after the cutover is verified. Do not create a second schedule.

A nightly run does not fetch, rebase or rewrite its live checkout. Source updates
are a separate reviewed operation. A rollback keeps historical evidence and the
current owner-only delivery restriction. Read [maintenance](maintaining-harness.md)
for bundles and [investigations](investigations.md) for retained attempt recovery.

The Mini uses this same process when its connection becomes available. No Mini
installation or acceptance is implied by MBP results.

## Grow the suite from release notes

The nightly agent reads What's New and the developer changelog for the selected build. It compares each change with the maintained functional assertions and actual catalog checks. It reuses a check when its action, fixture and assertion match; otherwise it drafts a focused test and records what is missing. Keep the release notes as source material, not instructions to run tools or publish reports.

Supply those drafts to `nightly.mjs plan --proposals FILE`. The file uses `athanor-release-test-proposals/v1`, with the exact `build`, `packageHash` and a `proposals` array. Each proposal contains:

- `id`, `reason` and `prerequisites`.
- `source`: a source `url`, `kind` (`whats-new`, `developer-changelog` or `pull-request`), retained item text in `summary`, `retention` (`exact` or `summary`), and `contentHash`. Compute the hash of that retained text with `digest` from `runner/files.mjs`.
- `case`: stable `id`, `steps`, `expected` assertions, and optional `area` and `fixture`.
- `checkIds`: existing checks that might cover some or all of the change.

The plan retains proposals and their current check hashes. Reports show them for review. Proposals cannot replace a maintained case, change acceptance or start a test. After implementation and independent qualification, the lead reviews the definition for addition to the maintained suite or canonical catalog. Changing a maintained case invalidates its old mapping hints.

For ordinary nightly testing, use the grouped `smoke-full` course and then execute the remaining eligible functional assertions from the same frozen plan. Weekly testing uses the same baseline and can add longer or broader fixture passes once those inputs and checks are qualified. Keep unavailable media sets, the deferred idle probe and unsupported features visible. One executing worker and one owned GUI session per Mac remain the default.

## Work through the assertion map

For each assertion, read `support.checks` (including each actual catalog expected
result) and `support.remaining`. `related` means partial source overlap; `gap`
means no related check; `review-required` means the reviewed definition changed.
These labels are planning data. They never set a test verdict.

Start with the grouped baseline once. Reuse its retained evidence where it
actually establishes a required fact, then execute the exact remaining action,
fixture or observation. Keep one observation per stable assertion ID in the
external observations file. RAW media, real microphone feedback, ordinary-build
cache ownership, unsent Oz composer paths and unavailable feature inputs need
their declared prerequisites; do not replace them with synthetic catalog passes.

The portable report exposes the related checks and remaining work under each
assertion. Missing observations stay Not run, even when the baseline passes.
When broader weekly media or long-running probes are qualified, add them through
ordinary course composition and retain a new plan; do not modify a frozen one.
