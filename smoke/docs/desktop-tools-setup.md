# Prepare the selected build

Athanor uses the Wizard build the user selects. Preparation sets up an external Qt test plugin, makes a disposable copy of that package, and verifies attachment before enabling a course. The package's executable, bundled Qt and signature stay unchanged. The plan and report identify the selected package and the external adapter separately.

## User flow

1. Open Athanor from the checkout and select a build and course.
2. Press Prepare build. The page shows progress through adapter setup, fixtures, package and schema validation, attachment, and the ready plan.
3. If preparation stops, open Repair with your agent and copy its prompt. The prompt includes the selected build, failed preparation and retained diagnostics.
4. When the build is ready, press Start checks. Preparation does not start a test course.

Changing the build, course or run name requires a new preparation. Cached media and matching adapters can be reused; prior plans and reports remain intact.

## Agent workflow

Read AGENTS.md. Use the same external workspace and printed service URL for every command:

```sh
node scripts/smoke.mjs setup --server URL
node scripts/smoke.mjs prepare --app /path/to/Wizard.app --checks D-CLI-01,D-CLI-02 --server URL
node scripts/smoke.mjs preparation --id PREPARATION_ID --server URL
```

Preparation returns an ID immediately. Poll that ID to read its steps. Ready returns a planHash; Failed returns the error and repairPrompt. A Preparing response exits with code 4, a Ready response with 0, and a failed or interrupted response with 3. Inspect an interrupted attempt before creating another one.

After Ready, the user or agent can start the frozen selection:

```sh
node scripts/smoke.mjs run --plan-hash PLAN_HASH --operator "Tester name" --request-id UNIQUE_ID --wait --server URL
```

The synchronous `plan` command remains available. It also sets up and qualifies attachment for desktop selections. Engine-only selections do not need the desktop adapter.

## Automatic adapter setup

A matching adapter bundled beside the source is copied into the external cache automatically, without compilation. The source checkout also includes the Qt adapter and its build script. For desktop selections, Athanor reads the package's Qt version, finds a matching local SDK, compiles the adapter, retains QtTest, and points the external test libraries at the package's own Qt frameworks. It caches the tools by source hash, Qt version and CPU architecture. Changed or missing cached files are rejected.

The current source bootstrap needs macOS Command Line Tools, `pkg-config`, and a matching Homebrew Qt SDK at `/opt/homebrew/opt/qtbase`. Agents should inspect these before diagnosing setup:

```sh
xcode-select -p
command -v clang++ pkg-config
/opt/homebrew/opt/qtbase/bin/qtpaths --qt-version
/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' /path/to/Wizard.app/Contents/Frameworks/QtCore.framework/Versions/A/Resources/Info.plist
```

Use the SDK version requested by the error. Installing an arbitrary newer Qt does not qualify an older package. Use `harness bundle --app APP --out DIR` to create a precompiled matching adapter distribution for Macs without that SDK. See [packaging](maintaining-harness.md). Wiz Ops currently has no published harness release to download automatically; source-only clones compile locally when no bundled adapter matches.

Legacy instrumented test-app bundles remain historical tooling. They must not replace the selected app in a new plan. Missing application operations are recorded as Blocked and need a supported UI path or an updated test mapping.

## Attachment evidence

Preparation retains the package hash, adapter hash, actual executable path and PID, isolated settings path, loaded Qt library paths and UI inspection. A completed course also retains the Golden Project, operations, native actions and verdicts. The attachment receipt is fingerprinted in the plan and checked before execution.

The adapter advertises protocol version, supported commands, capture methods and inspection limits in its readiness receipt. Preparation verifies the required startup commands; atomic native calls reject unavailable commands before dispatch. Use `node desktop/session.mjs native SESSION.json capabilities '{}'` to inspect the attached adapter.

Independent desktop groups use fresh projects and sessions. Persistence steps retain their own fixture through the save/reopen sequence. A failed restoration preserves that group's observations and lets the next independent group start after owned-process cleanup is confirmed. Unconfirmed cleanup stops further launches. Missing Media during opening is reported with its dialog; the harness does not choose Continue Offline automatically.

For a direct diagnostic probe, an agent can run:

```sh
node desktop/attach.mjs --app /path/to/Wizard.app
```

It attaches to a disposable copy and prints the owned session. It stops after two minutes or when interrupted. It does not create a passing test result.

## Agent sandbox requirements

Framework checks start loopback HTTP servers and inspect local processes with `ps`. Run them where those operations are permitted. Errors such as `listen EPERM` or `spawnSync /bin/ps EPERM` describe the agent's sandbox restrictions. Request narrowly scoped execution outside that sandbox through the agent's normal approval mechanism; do not change macOS permissions or bypass protections.

Actual desktop checks also need an unlocked desktop. Screen capture and physical input have their own macOS permissions. Report a missing permission precisely and let the user handle the system prompt.

### SSH and desktop permissions

SSH connectivity, the logged-in desktop and macOS privacy grants are separate
prerequisites. A permission probe run by `swift -e` over SSH does not qualify the
helper used by a local Codex or Terminal session. Test the actual cached native
helper from the intended launch context, without launching Wizard or posting input:

```sh
# Work from smoke/ and use the same external workspace as the intended service.
export SMOKE_DATA_DIR="$HOME/Library/Application Support/Athanor/workspace"
TASK_NATIVE_DRIVER="$(node --input-type=module -e 'import {nativeInputDriver} from "./desktop/macos-input.mjs"; console.log((await nativeInputDriver(process.env.SMOKE_DATA_DIR)).driver)')"
"$TASK_NATIVE_DRIVER" --permissions
```

The result reports `permissions.accessibility`, `permissions.input` and
`permissions.screenCapture` for that helper's execution context. This command
does not request grants, inspect an app or dispatch input. Bound the process
wait; a timeout is an incomplete observation, not a false permission result.
True permissions do not establish an unlocked desktop, ownership or passing tests.

If SSH returns false, repeat from the logged-in local agent before prescribing
privacy changes. A GUI launch job can have different permission attribution from
Codex or Terminal. Switching launch contexts does not grant access. If the actual
execution context still lacks access, the user must enable the relevant app/helper
in System Settings → Privacy & Security → Accessibility and Screen & System Audio
Recording. Recheck in the same context afterward. Do not edit TCC databases,
disable protections or grant unrelated SSH processes broad access.

For a new remote desktop worker, use an external Application Support workspace
rather than Documents/Desktop/Downloads: protected-folder access is an additional
permission boundary for independently launched helpers. Keep historical workspaces
intact; create a new workspace instead of silently migrating frozen plans. On Poddy,
the identical helper stalled in dyld opening its Documents executable but returned
normally from Application Support. Keep that startup finding distinct from the
subsequent privacy results.
