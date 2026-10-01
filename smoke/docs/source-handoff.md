# Source handoff

The source lives under `wiz-ops/smoke/`. A clone supplies the catalog, web dashboard, agent CLI, course definitions, interaction library, native adapter source and framework tests. It supplies the [harness bundle builder](maintaining-harness.md). Distribute its versioned source/runtime bundle to testing stations; historical run evidence stays separate.

## Install a bundled harness

See [build, install and update](maintaining-harness.md). The bundle contains the instrumented app, paired CLI, native adapter, Qt dependencies, dashboard, agent entry points, docs and framework tests. Installation preserves older versions and registers the desktop tools automatically. The selected build and course-specific media/model inputs remain separate.

## Validate a clean checkout

Use Node.js 24 LTS (24.19.0 verified). From the repository root:

```sh
cd smoke
npm test
npm run scope:check
npm run open -- --no-open
```

The source launcher works without an installed bundle, chooses an available loopback port, and prints its URL. Keep it running; pass that URL with `--server URL` to every CLI command. Use `npm run open` to choose a browser on first opening and save that choice. No npm dependency installation is needed. Open the printed URL or its `/explainer` page to inspect the catalog. Starting the service does not run Wizard. A fresh workspace must show no runs; source-workbook observations must never become automated results.

## Included and excluded

Included: executable checks, adapters, CLI/API, dashboard, original checklist criteria, accepted-definition hashes, fixture recipes, operation-schema contract and text documentation.

Excluded: original spreadsheet binaries, historical dashboard images, SQLite/run data, prepared plans, generated media, model caches, copied apps, native binaries, captures, local environment files and prior Git history. Historical run-report documents and workbook outcomes are also excluded.

The normalized checklist still contains team criteria and issue references. The operation contract describes Wizard's application interface. Omitting runtime data does not make this a generic or redacted public test framework.

## Give this checkout to an agent

Start with the repository's `AGENTS.md`, which points to `smoke/AGENTS.md`. The agent can validate the framework, launch the dashboard, discover builds and accepted checks, compose a course, prepare the selected build, run it and return its report. Use the same `SMOKE_DATA_DIR` and printed service URL throughout.

A source clone supplies code and definitions. A testing station still needs the compatible build and media tools listed in the automated build guide. Install a supplied harness bundle for desktop/service checks, or configure a qualified runtime through the agent CLI. Use an engine-only selection while those tools are unavailable.

## First actual smoke execution on another machine

Use the [automated build guide](automated-build-testing.md) for a small first run and the full 57-check packaged course. Both complete without a human checkpoint.

1. Select a retained package whose operation schema matches the checked contract.
2. Configure local media tools and only the model prerequisites needed by the chosen checks.
3. Prepare a small packaged-only course and review the package/fixture identities and added prerequisites.
4. Run it, inspect the retained evidence and test one failure/interruption path.
5. Configure and qualify the instrumented desktop runtime separately before using desktop/service checks.

The CLI and portable-kit helpers are in [agent-courses.md](agent-courses.md) and [build-evidence-local-reports.md](build-evidence-local-reports.md). These helpers do not establish that a second-machine pilot has happened. Do not copy a developer's absolute runtime paths and assume they identify the intended build.

## Run a retained workstation kit

Export a terminal run from the local service:

```sh
node scripts/smoke.mjs kit --run RUN_ID --server URL
```

Copy the returned kit directory to an external location on the target Mac. From that directory:

```sh
node workspace/scripts/kit.mjs check
node workspace/scripts/kit.mjs run --operator "Tester name"
```

`check` verifies retained files and listed local dependencies without launching Wizard. `run` prepares the retained package and media, starts its own loopback service, and creates a new run in the external `SMOKE_DATA_DIR` workspace. It preserves the original report under `report/index.html`. Paths containing spaces, such as macOS Application Support, are supported. Node is still required; desktop and speech selections have additional declared runtime inputs.

A successful relocated-kit run on one Mac proves that path relocation works for that selected course. Second-machine acceptance still requires running it on another Mac. Keep the resulting report and any failed attempt; do not replace an uncertain outcome with a rerun's pass.

## Source archive

From the repository root, after committing:

```sh
mkdir -p "$HOME/Library/Application Support/WizardSmoke/archives"
git archive --format=tar.gz --output="$HOME/Library/Application Support/WizardSmoke/archives/smoke-source.tar.gz" HEAD smoke/
```

This includes committed `smoke/` source only. It does not collect ignored runtime data or upload the archive. Record the Ops commit ID alongside the archive.
