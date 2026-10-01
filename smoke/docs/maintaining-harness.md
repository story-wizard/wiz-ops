# Build, install and update the harness

Distribute a harness bundle to testers. It contains the source snapshot, dashboard, agent tools, instrumented desktop app, paired CLI, Cocoa plugin, native adapter and all discovered non-system desktop libraries, including Qt frameworks and the matching QML import modules and plugins. A source clone contains the bundle builder rather than those binaries.

The build under test remains a separate choice. Node.js 24 or newer, the selected package's ingest runtime, FFmpeg/FFprobe and any course-specific offline speech model are still required. This bundle does not install the target Wizard build or download a model.

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
