# Athanor

**Athanor** takes its name from the alchemical furnace that maintains controlled heat for sustained transmutation. It runs repeatable Wizard tests and keeps their observations and evidence together.

The current UI keeps Wizard’s dark style. Existing CLI names, data formats and the `WizardSmoke` workspace path remain compatible.

A local testing harness with an agent CLI and a dashboard/results viewer for repeatable Wizard smoke tests. It creates disposable projects, executes selected checks, verifies state and output independently, and retains evidence. The web dashboard uses the same local service as agents and optional native clients.

The first release supports automated testing of a selected Wizard build and agent-driven spot tests. Desktop test tools can be included in a versioned harness bundle and selected automatically. Start with the [automated build guide](docs/automated-build-testing.md). This is the WIZ-423 smoke framework; second-machine qualification remains a follow-up, documented in [import status](docs/import-status.md).

Start with the [two-page getting-started guide (PDF)](docs/athanor-getting-started.pdf), or use [demo and first run](docs/demo-guide.md) for a short team walkthrough. The [agent onboarding prompt](examples/agent-onboarding.txt) hands the checkout to a user’s agent.

For agents driving Wizard with mouse and keyboard, use the [computer-use toolkit](docs/computer-use-agent.md). It supplies a prepared test session, scoped Qt observations, physical gestures, independent verification and an interactive evidence report.

Read the [October 2 changes](docs/changes-2026-10-02.md) for the expanded mixed course, physical checks and composable authoring guidance.

## Install a bundled harness

Double-click `Install Athanor.command` in a supplied bundle. On first opening, choose your browser; Athanor remembers it. Later, use `Open Athanor.command` in the external workspace. For terminal or agent use, from the bundle's `workspace` directory:

```sh
node scripts/harness.mjs install --bundle ..
node scripts/harness.mjs start
```

The bundle includes the external adapter and matching QtTest dependency, alongside source and guidance. It attaches to the selected Wizard package; it contains no replacement test app. Use `start --browser choose` to change browsers or `start --no-open` for agent use. Installation does not launch a test. See [build, install and update](docs/maintaining-harness.md) for packaging and maintenance, and [agent tools](docs/agent-tools.md) for single-check and atomic testing.

## Start from source without a Wizard build

Use Node.js 24 LTS; this release was verified with Node 24.19.0. The SQLite API requires at least Node 22.13. There are no npm dependencies to install.

From the `wiz-ops` checkout:

```sh
cd smoke
npm test
npm run scope:check
npm run open
```

The launcher chooses an available local port, asks which browser to use on first opening, and remembers your choice. Keep the terminal running. Use `npm run open -- --no-open` for agent use, then pass the printed URL with `--server URL` to CLI commands. `npm start` remains available at port 4317. The server binds only to loopback; starting it does not launch a course.

To hand setup to an agent, point it at [AGENTS.md](AGENTS.md) or give it this prompt:

> Set up Athanor from this checkout. Read AGENTS.md, run the framework checks, start the local service, and inspect setup and the accepted catalog. Help me select a compatible build and course, then run my selection and return the report with any failures or missing prerequisites.

The dashboard opens at **Run tests**: choose a build, choose a course and optionally name the run. Fresh workspaces default to **Logan’s checklist — full automated course** (`smoke-full`): 153 checks, including 137 accepted definitions and 16 qualification candidates. **All automated checks** (`automated-full`) keeps the accepted-only selection. **Build engine checks** selects 57 packaged checks without desktop tools. Press Prepare build to see adapter and fixture setup, then Start checks when ready. Setup failures include a copyable agent repair prompt. Run progress and reports live in **Results**. Foreground checks need the Mac unlocked and available; ordinary failures remain recorded while unrelated checks continue.

**Find a build…** lists recent GitHub packages, grouped Releases, Nightlies and Tagged builds, with search and saved multi-select filters. Add an exact tag, HTTPS URL, ZIP or existing app path. Downloads stay in the external workspace. Agents use `smoke.mjs builds` and `build`; see [Build finder](docs/build-finder.md).

Navigation remains visible below the shared banner. Filters offer checkbox multi-select, named saved views and last-view restoration. Report views retain filters in their page links. Click a Results row to open its details immediately in the right sidebar. Selecting another row updates the same panel. Details show operations, recorded actions and evidence, plus a copyable edit prompt for an agent.

A clean checkout shows the catalog and **no run history**. The versioned checklist contains criteria and coverage only; imported workbook outcomes are excluded. The field guide at `/explainer` describes checks and their operations; local evidence appears only when retained runs exist.

## Compose and run a course

Start the service above, then use the CLI in another terminal. Set `ATHANOR_URL` to the URL printed by the launcher, replacing `PORT` below:

```sh
export ATHANOR_URL="http://127.0.0.1:PORT"
node scripts/smoke.mjs list --category color --server "$ATHANOR_URL"
node scripts/smoke.mjs courses --server "$ATHANOR_URL"
node scripts/smoke.mjs course save --file examples/color-regression.json --server "$ATHANOR_URL"
node scripts/smoke.mjs course show --id color-regression --server "$ATHANOR_URL"
```

With a compatible local Wizard package and the prerequisites below:

```sh
node scripts/smoke.mjs plan --app /Applications/Wizard.app --course color-regression --out /tmp/color-plan.json --server "$ATHANOR_URL"
node scripts/smoke.mjs run --plan /tmp/color-plan.json --operator "Developer name" --request-id color-change-001 --wait --server "$ATHANOR_URL"
node scripts/smoke.mjs status --request-id color-change-001 --server "$ATHANOR_URL"
node scripts/smoke.mjs report --run RUN_ID --server "$ATHANOR_URL"
```

Planning fingerprints the selected package, fixture recipe, generated media and runner. Running rechecks those identities. Selection adds declared prerequisites, deduplicates overlapping checks and freezes the effective course. An uncertain mutation is not silently replayed.

See [agent-friendly courses](docs/agent-courses.md) for explicit IDs, categories, groups, cancellation and recovery by request ID.

The maintained `packaged-full` course contains 57 automated checks and runs without a desktop helper or human checkpoint. Desktop/service courses attach to the selected build. See [desktop setup](docs/desktop-tools-setup.md) for automatic adapter preparation and SDK prerequisites. The existing [human checkpoint extension](docs/human-checkpoints.md) is outside the supported first-release workflow.

## What is included

| Execution target | Definitions | Boundary |
| --- | ---: | --- |
| Packaged engine | 57 | Uses the selected package's headless engine, shipped CLI and local ingest tools |
| Foreground desktop | 94 | Uses the selected packaged app, its shipped CLI, external Qt observations and physical input where specified |
| Background app services | 8 | Uses the selected package and export worker with UI input disabled during checks; includes the provisional idle CPU candidate |
| **Runnable catalog** | **159** | Available definitions, including candidates; the default course selects 153 |

**137 definitions are accepted for custom-course selection.** The default course adds 16 maintained qualification candidates; five unlinked team checks and the idle CPU candidate stay outside it. The scope inventory also retains two exploratory physical definitions excluded from the runnable catalog. Logan's 137 original checklist rows are a different count: the runnable catalog maps to 82 rows, 27 have no counterpart, 24 NAS rows are deferred and four are placeholders. A mapped row can cover only part of its original behavior.

- [Proposed full scope](docs/v1-scope.md)
- [Shared interaction library](docs/interaction-library.md)
- [Composable test authoring and examples](docs/test-evidence.md#compose-a-test-from-reusable-parts)
- [Idle CPU candidate](docs/idle-candidate.md)

The testing lead's accepted-definition registry is source-controlled. Saving a custom course cannot accept new definitions or change canonical membership.

## Runtime prerequisites

The framework checks and catalog work without Wizard. Actual smoke execution currently targets macOS and additionally needs:

- A compatible retained `Wizard.app` with shipped CLI/headless engine, ingest runtime and media tools. The exact operation-schema check rejects unreviewed packages.
- Local FFmpeg/FFprobe for synthetic media. The fixture builder defaults to Homebrew paths; preparation accepts overrides.
- For speech checks, the pinned cached Parakeet CoreML model and local macOS speech synthesis. Preparation does not download a model.
- For desktop/service checks, a matching bundled adapter, or a matching Qt SDK and local compiler for automatic adapter setup. Foreground tests need an unlocked desktop. Read [desktop setup](docs/desktop-tools-setup.md) for the exact prerequisites.

Native adapter compilation currently assumes Homebrew Qt at `/opt/homebrew`; see `desktop/native/build.sh`. The bundle builder retains the matching external tools for test stations; those stations do not need a Qt SDK for that version. A source clone compiles tools when no matching bundle is available. An arbitrary release build is not assumed compatible.

Fresh starts as an empty project and receives synthetic media/state as needed. Story-user, Large and NAS remain deferred. Full desktop OS interaction and human judgments are separate from CLI or Qt action assertions.

## Data and evidence

Definitions, normalized checklist data, acceptance records, fixture recipes and source are versioned. Runtime state is ignored by Git: SQLite databases, plans, copied applications, media/model caches, runs, captures and reports.

The default workspace on macOS is `~/Library/Application Support/WizardSmoke` (`~/.local/state/WizardSmoke` elsewhere). It holds databases, courses, plans, fixtures, copied apps, native builds, runs, reports and kits. Set an absolute `SMOKE_DATA_DIR` to use another disk or location. The server and every related CLI command must use the same setting. Paths inside a Git checkout, including symlink aliases, are rejected.

```sh
export SMOKE_DATA_DIR="$HOME/Library/Application Support/WizardSmoke"
npm start
```

Read-only source definitions live in `catalog/`. Do not move existing run folders blindly: saved plans and evidence retain absolute paths and exact source/build identities. Older local history is not migrated automatically.

Each actual run retains its build identity, immutable check snapshots, operation receipts, observations and report. Automated observations cannot be overwritten through the manual-result endpoint. Fail, Blocked and Unknown remain distinct. Local reports do not imply team publication or release acceptance.

## Development and integrations

`npm test` exercises temporary databases, process fixtures, local HTTP servers, deliberately wrong responses and interruption handling. It does not run a Wizard course. `npm run scope:check` verifies the inventory and recipe hashes without launching Wizard.

The optional native client consumes the same API; its source is not included. The lightweight read-only live feed is described in [tower-live.md](docs/tower-live.md). This import adds no build-pipeline hook, deployment, Studio service, scheduled job or external message delivery.

For checkout handoff and the first team pilot, use [source-handoff.md](docs/source-handoff.md).
