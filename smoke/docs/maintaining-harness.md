# Build, install and update the harness

Distribute a harness bundle to testers. It contains the source snapshot, dashboard, agent tools, instrumented desktop app, paired CLI, Cocoa plugin, native adapter and all discovered non-system desktop libraries, including Qt frameworks and the matching QML import modules and plugins. A source clone contains the bundle builder rather than those binaries.

The build under test remains a separate choice. Node.js 24 or newer, the selected package's ingest runtime, FFmpeg/FFprobe and any course-specific offline speech model are still required. The Build finder can download and select the target Wizard package using the testing Mac’s GitHub connection; see [Build finder](build-finder.md) for `gh`, Python and macOS tool requirements. The installer does not download a target package or model.

## Open the source checkout

From `smoke/`, run `npm run open`. This uses the current checkout, selects an available port and opens your chosen browser. Use `npm run open -- --no-open` for agents, and pass its printed URL to CLI commands with `--server URL`. It needs Node.js and no installed bundle. The selected Wizard build and execution prerequisites are still separate inputs.

`harness start` continues to launch the verified installed bundle. `harness serve` launches the current source; `npm run open` is its shortcut.

## Make a bundle

From `smoke/`, supply the already qualified desktop runtime descriptor. Its paths identify the retained app, CLI, Cocoa plugin, adapter and optional existing libraries:

```sh
node scripts/harness.mjs bundle --runtime /path/to/runtime.json --out /path/outside/git/WizardSmokeHarness-VERSION
node scripts/harness.mjs check --bundle /path/outside/git/WizardSmokeHarness-VERSION
```

Bundling reads the paired CLI schema with `--no-spawn`, copies the source and runtime, collects library dependencies, and verifies the copied identities. It does not compile the app or launch a smoke test. The destination must be new and outside Git. The manifest records the source hash, runtime hashes and complete file inventory; it is finalized before the directory is published.

The bundle contains no historical runs, personal projects or cached models. It includes the framework tests and documentation. Preserve the bundle directory structure when copying it to another Mac. The inventory detects missing, changed or extra files; it is an integrity check for a trusted bundle, not a signature establishing its publisher.

## Install and open it

On the receiving Mac, double-click `Install Athanor.command` in the extracted bundle. It installs the harness and opens the dashboard on an available local port. For agent or terminal use, from the bundle's `workspace` directory:

```sh
node scripts/harness.mjs install --bundle ..
node scripts/harness.mjs start
```

Installation verifies the bundle, copies it into a versioned directory under the external workspace, and atomically writes the default desktop-tool configuration. The default workspace is `~/Library/Application Support/WizardSmoke`. Set `SMOKE_DATA_DIR` or pass `--data-dir DIR` for another location. The installer returns the installed source directory for direct agent commands.

The first opening asks which browser to use: the system default, Safari, or another browser application. The choice is saved in `browser.json` under the external workspace. `start --browser choose` changes it; `--browser default` selects the current system default. Agents can use `start --no-open` to print the address without opening a browser or prompting.

`start` verifies the installed bundle and starts its loopback service at port 4317. Use `--port 4318` for a specific port, or `--port 0` for an available port. The browser opens after the service is ready. Testers choose their build and course; the installed test tools are selected automatically. Installation also creates `Open Athanor.command` in the external workspace for subsequent launches.

## Update source or runtime

1. Change the source in Ops, or select a newly qualified instrumented runtime. Keep packaged and desktop operation contracts separate.
2. Run `npm test` and `npm run scope:check`. For changed assertions or runtime behavior, perform the authorized focused application checks and retain their evidence. Qualify `D-CLI-01` against each new bundle: the owned editor and its panels must load using the retained libraries and QML imports. Definition acceptance and passing runtime results remain separate decisions.
3. Commit the source, then build a new bundle into a new version directory. Record the Ops commit alongside its source hash and runtime identities.
4. Let active tests finish and stop the old dashboard. Install the new bundle and start its dashboard. Installation refuses active run/session records.

The installer keeps older version directories and existing runs/reports. A prepared plan keeps its original runtime paths and hashes. Switching the default does not rewrite old evidence. Reinstalling an older retained bundle restores that default; prepare a fresh plan before running its checks.

Do not edit installed source or runtime files in place. Make the change in Ops and publish another bundle. Existing installed versions are frozen so previous run evidence remains explainable.

## Qualify a packaged command schema

The baseline is `runner/contracts/installed-schema.json`. Extra reviewed package schemas are recorded by their exact hashes in `runner/contracts/packaged-schema-qualifications.json`, tied to that baseline hash. Preparation accepts either the baseline or one of those reviewed schemas, then freezes the actual schema hash in the plan. Readiness rechecks that exact identity. The instrumented desktop CLI has its own contract.

To qualify a new schema, read it using `wiz-cli project create --schema --no-spawn`, compare every operation against the baseline, inspect changes against the checks' requests and assertions, and add a qualification with its hash and review basis. Run the regression checks and prepare the actual package. Missing or unreviewed changes stay blocked. Updating the baseline requires reviewing its qualifications again.

The October 1 nightly differs only in `render.set_render_mode`: its mode enum adds `eighth` and the description clarifies preview resolution. The existing values and all other 161-operation contract fields are unchanged. This qualification makes that package usable with the mapped checks; it adds no new assertion for eighth-resolution playback.

## Regression checks and interrupted execution

The `Athanor framework checks` GitHub workflow runs the framework suite and scope integrity check on macOS with Node.js 24 when smoke source changes. It exercises fixtures and local servers without a Wizard package or desktop permissions. Application courses run separately on the testing Mac.

Script completion and individual test observations are separate. An unexplained nonzero exit or failed stage finalization prevents a successful run, preserves completed observations, and stops later stages. Pointer cleanup balances a synthetic press even if the verified application loses focus; new gestures still require current process and window ownership.

If Start loses its response, use **Check start status**. If no admission is found, **Retry original start** resubmits the same immutable request ID and plan. Do not generate a new request ID to recover a lost response. The server reconciles a racing or duplicate admission under that original ID.
