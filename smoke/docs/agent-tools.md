# Spot testing with an agent

The CLI, application adapter and native adapter work without the dashboard. They use the same installed desktop tools, ownership checks and operation receipts as the automated courses.

## Discover and run one check

From the installed bundle's `workspace` directory, with the dashboard service running:

```sh
node scripts/smoke.mjs setup
node scripts/smoke.mjs list --target desktop
node scripts/smoke.mjs plan --app /Applications/Wizard.app --checks D-TRACK-ADD --out /tmp/track-check-plan.json
node scripts/smoke.mjs run --plan /tmp/track-check-plan.json --operator "Agent spot test" --request-id track-check-001
node scripts/smoke.mjs status --request-id track-check-001
```

`setup` returns known builds, courses and the automatic desktop-tool selection. `list` returns accepted and candidate definitions with their operations and requirements. `plan` adds the declared prerequisites and freezes the exact selection; it does not execute the check. `run` executes only that selection and its prerequisites. The resulting verdict and evidence appear in Results. See [agent-friendly courses](agent-courses.md) for wait, cancel, report and request recovery.

Desktop/service plans use the installed bundle when `--runtime` is omitted. An explicit runtime file remains available for qualifying a replacement. Packaged-only plans do not need the desktop tools.

## Use atomic operations

For exploratory testing, prepare a desktop plan as above, then open an owned session instead of executing the course:

```sh
node desktop/session.mjs schema
node desktop/session.mjs start --plan /tmp/track-check-plan.json
```

Keep the start command running. It prints the owned session file, PID and project identity, then waits for that app to exit. It prepares a disposable baseline project and opens the instrumented editor. It does not run the selected checks. An unattended session is limited to 30 minutes.

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
