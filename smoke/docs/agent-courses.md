# Agent-friendly courses

Saved custom courses and one-off selections span packaged engine, instrumented desktop and background service checks through the same local API. For the first release, use [automated build testing](automated-build-testing.md). The optional human checkpoint extension is outside that shipping scope.

For atomic calls and exploratory sessions, see [agent tools](agent-tools.md).

## What you can do

- Discover all checks, their execution targets, categories and acceptance eligibility.
- Save grouped courses with stable IDs and revisions; inspect older revisions.
- Resolve a saved course, category, explicit IDs, or grouped selection into an immutable prepared plan.
- Run that plan, observe status, wait, cancel and obtain a local report.
- Recover a lost start response using its request ID without duplicating execution.

Each selected course adds its connection checks and any declared shared-fixture sequence. The plan lists those additions. Execution is serial: packaged checks, background services, then foreground desktop. Packaged checks own disposable projects; desktop/service checks share a disposable project within their authored stage. Groups organize the report and do not create parallel execution.

## Acceptance boundary

Custom courses can reference only accepted check definitions. A positive acceptance entry binds a check ID to the digest of its executable definition. Changed definitions become ineligible until reviewed again. Saving a course cannot change test definitions, acceptance or the maintained full course.

Charles accepted all existing checks linked to Logan’s checklist on September 27: 137 definitions. The current execution lanes contain 57 packaged, 73 desktop and 7 service checks: unset-rate export moved to the desktop lane because its valid fixture uses New Project. Five unlinked team additions and the subsequent idle CPU candidate remain outside that decision. The CLI can compose all 137 accepted definitions. Acceptance does not require a current passing outcome. Runtime failures and broader checklist coverage are unchanged.

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

For desktop/service selections, the installed harness bundle is the default. For an explicit override, pass `--runtime runtime.json` with retained files:

```json
{
  "app": "/path/to/Instrumented Wizard.app",
  "cli": "/path/to/paired/wiz-cli",
  "qtPlugin": "/path/to/smoke/libqcocoa.dylib",
  "libraries": "/path/to/retained/runtime-libraries"
}
```

The optional `libraries` directory holds retained development libraries. The plan fingerprints those files, the native bridge and the paired schema. The app must expose the isolated automation startup hooks. It is recorded separately from `--app`, the packaged engine used for preparation and packaged checks. No historical run is needed to select a runtime. `runtime --file runtime.json` retains a runtime descriptor; `runtimes` lists descriptors. Descriptors are checked again during preparation and launch.

The isolated desktop app uses the search worker bundled in the explicitly selected preparation package. That worker is covered by the package fingerprint. GUI search therefore exercises the instrumented app together with this packaged worker; it is not a claim about an independently distributed desktop bundle.

`list --target desktop` filters discovery. Category selection defaults to packaged checks for compatibility; `plan --category color --target all` includes corresponding checks across targets. Explicit check IDs and saved courses can mix targets without this flag.

The `examples/accepted-automated.json` course groups all 137 accepted definitions. It does not approve the separate 143-candidate V1 scope.

Fresh is the available empty starting project. A check's setup populates it as required. Story-user and Large are reserved future inputs and currently fail readiness explicitly.

Color-only plans use the six-file synthetic core pack and no speech model. Speech checks require the eight-file pack and pinned speech model; mixed-media import requires the eight files but does not require transcription. Core media and the ingest environment remain a shared preparation baseline in this first implementation, even for checks that use fewer assets.

Current package compatibility remains conservative: the selected package must match the mapped operation schema. A local run kit retains the exact runtime inputs and lists required external libraries. It does not automatically qualify arbitrary new schemas. The separate [harness bundle](maintaining-harness.md) includes desktop libraries and an installation/update path.

The canonical full Smoke Test course and V1 scope remain distinct from a custom course. The maintained `packaged-full` selection represents all 57 packaged checks, not all 143 automated definitions or every behavior in Logan's checklist.

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
