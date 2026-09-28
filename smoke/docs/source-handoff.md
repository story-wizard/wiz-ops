# Source handoff

The source lives under `wiz-ops/smoke/`. A clone supplies the catalog, web dashboard, agent CLI, course definitions, interaction library, native adapter source and framework tests. It does not supply the complete Wizard runtime or historical run evidence.

## Validate a clean checkout

With Node.js 22.13 or newer (Node 24.19.0 verified), from the repository root:

```sh
cd smoke
npm test
npm run scope:check
PORT=4318 npm start
```

No npm dependency installation is needed. The service binds to loopback. Open <http://127.0.0.1:4318/explainer> to inspect the catalog. Starting the service does not run Wizard. A fresh workspace must show no runs; source-workbook observations must never become automated results.

## Included and excluded

Included: executable checks, adapters, CLI/API, dashboard, original checklist criteria, accepted-definition hashes, fixture recipes, operation-schema contract and text documentation.

Excluded: original spreadsheet binaries, historical dashboard images, SQLite/run data, prepared plans, generated media, model caches, copied apps, native binaries, captures, local environment files and prior Git history. Historical run-report documents and workbook outcomes are also excluded.

The normalized checklist still contains team criteria and issue references. The operation contract describes Wizard's application interface. Omitting runtime data does not make this a generic or redacted public test framework.

## First actual smoke execution on another machine

1. Select a retained package whose operation schema matches the checked contract.
2. Configure local media tools and only the model prerequisites needed by the chosen checks.
3. Prepare a small packaged-only course and review the package/fixture identities and added prerequisites.
4. Run it, inspect the retained evidence and test one failure/interruption path.
5. Configure and qualify the instrumented desktop runtime separately before using desktop/service checks.

The CLI and portable-kit helpers are in [agent-courses.md](agent-courses.md) and [build-evidence-local-reports.md](build-evidence-local-reports.md). These helpers do not establish that a second-machine pilot has happened. Do not copy a developer's absolute runtime paths and assume they identify the intended build.

## Source archive

From the repository root, after committing:

```sh
mkdir -p "$HOME/Library/Application Support/WizardSmoke/archives"
git archive --format=tar.gz --output="$HOME/Library/Application Support/WizardSmoke/archives/smoke-source.tar.gz" HEAD smoke/
```

This includes committed `smoke/` source only. It does not collect ignored runtime data or upload the archive. Record the Ops commit ID alongside the archive.
