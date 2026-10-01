# Spot testing with an agent

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

`setup` returns known builds, courses and the automatic desktop-tool selection. `list` returns accepted and candidate definitions with their operations and requirements. `plan` adds the declared prerequisites and freezes the exact selection; it does not execute the check. `run` executes only that selection and its prerequisites. The resulting verdict and evidence appear in Results. See [agent-friendly courses](agent-courses.md) for wait, cancel, report and request recovery.

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

`schema` reads the captured 177-operation desktop CLI contract without launching an app. `call` invokes one application operation. `native` invokes one native adapter operation, such as `inspect`, `click`, `key`, `select`, `text`, `drag`, `action` or `snapshot-presented`. Choose widget/action IDs from the latest inspection and use the parameter shapes demonstrated by the maintained desktop checks. The adapter binds each request to the owned process and GUI generation. Service sessions reject foreground input.

Application calls retain requests, responses and observed revisions in `operations.jsonl`. Native calls retain requests and responses in `native-events.jsonl`. Resolve returned identities, query the resulting state, and assert the behavior you intended. A dispatch receipt or success envelope is not a passing check. An ambiguous action remains Unknown and must not be replayed automatically.

Atomic probes keep their evidence in the owned session directory. They do not create dashboard Pass records. Use a focused course when a probe needs a durable verdict in Results.

## Compose tools in JavaScript

`runner/engine.mjs` exports `PackagedEngine`. `runner/interactions.mjs` exports `ProjectSession` and rendering, ingest and state helpers. `desktop/adapter.mjs` exports session preparation, launch, application calls, native calls and shutdown. They remain ordinary modules, independent of the web UI.

See the [interaction library](interaction-library.md) and the maintained checks for examples. Keep setup, action, independent verification and evidence distinct. Use explicit projects, timelines, assets and widgets rather than a guessed current selection.

Build discovery displays 50 records per page by default. Filters search all retained metadata before pagination. Agents can use `builds --author me --page 2`, `--page-size all` for the cached catalog, and `--github-page N` to load older metadata in batches of 50. Inspect `nextGitHubPage` and `hasMoreGitHub` before requesting the next provider page.

For a new build or feature that changes preparation or a mapped operation, use [build repair](build-repair.md). Exported context packs include a copyable repair prompt and the schema qualification references.
