# Automated build testing

Select a Wizard build, prepare its checks, run them, and open the report. The maintained `packaged-full` course has 57 checks against that package's headless engine, shipped CLI and ingest runtime. It creates disposable projects and runs without Tower, a visible Wizard editor, computer use or human sign-off.

## Use the dashboard

Start the service as described below and open <http://127.0.0.1:4317>. In **Run tests**, choose the build, choose the course, optionally name the run, then select **Start checks**. Preparation and validation happen automatically before execution. Progress and outcomes appear in **Results**; open the report after the run finishes.

The default **All automated checks** course selects all 137 accepted definitions: 57 packaged-engine, 73 desktop and 7 background-service checks. It does not add a human checkpoint or accept the six remaining candidate definitions. Existing failures and unavailable capabilities remain Fail or Blocked in the results.

The engine checks use the selected package. The other 80 checks use separately identified desktop test tools, chosen automatically from the testing station’s installed configuration or available retained setups. Testers do not need to select a helper. If those tools are missing, the dashboard explains that the station needs setup and keeps the full course disabled. **Build engine checks** remains available for a 57-check run. Overrides live under **More options → Test tools (advanced)**. Preparation and launch still verify the exact files and supported operations.

**More** holds fixture, coverage and catalog-maintenance tools. They are not required to launch a run. If a start response is lost, the form retains its request ID and offers **Check start status** rather than starting another run.

## Configure a testing station

Install a supplied harness bundle and start its dashboard:

```sh
node scripts/harness.mjs install --bundle /path/to/WizardSmokeHarness
node scripts/harness.mjs start
```

The installer includes the desktop app, paired CLI, Cocoa plugin, native adapter and Qt dependencies, then registers them as the default. No helper picker is required. Both dashboard and agent plans use that configuration. Opening the dashboard checks file presence without launching Wizard or executing a test.

See [build, install and update](maintaining-harness.md) for the bundle builder and maintenance steps. An explicit `desktop-runtime.json` in `SMOKE_DATA_DIR` remains supported for development; it accepts absolute paths or paths relative to the workspace.

## Prerequisites

- An arm64 Mac with Node.js 24 LTS. Node 24.19.0 is the verified runtime.
- A retained `Wizard.app` containing `wiz-cli`, `wizard-headless` and its Python ingest runtime. Preparation checks the package against the captured operation schema and rejects an incompatible build.
- FFmpeg and FFprobe at `/opt/homebrew/bin`. The preparation API also accepts explicit media-tool paths.
- For the full course, macOS Samantha speech synthesis and the pinned local Parakeet CoreML snapshot at `~/.cache/huggingface/hub/models--FluidInference--parakeet-tdt-0.6b-v2-coreml/snapshots/ee09c569f73759e6d44c9bd16766f477b2b36d39`. It must contain `Encoder.mlmodelc`, `Decoder.mlmodelc`, `Preprocessor.mlmodelc`, `JointDecision.mlmodelc` and `parakeet_vocab.json`. Preparation verifies the model files and does not download them.

The smaller color course below needs no speech model. There are no npm packages to install. A source clone supplies the framework; the selected Wizard build, media tools and model are separate runtime inputs. A retained run kit can supply the build, fixtures and required cached model; see [source handoff](source-handoff.md).

## Start the service

From the repository root:

```sh
cd smoke
npm test
npm run scope:check
export SMOKE_DATA_DIR="$HOME/Library/Application Support/WizardSmoke"
npm start
```

Keep this terminal open. The dashboard is at <http://127.0.0.1:4317>. Starting the service does not start a Wizard test. Runtime files stay in the external workspace, outside the checkout.

## Test a build

In another terminal, from `smoke/`, replace the app path and operator name:

```sh
node scripts/smoke.mjs plan --app "/path/to/Wizard.app" --course packaged-full --out /tmp/wizard-smoke-plan.json
node scripts/smoke.mjs run --plan /tmp/wizard-smoke-plan.json --operator "Tester name" --request-id release-test-001
node scripts/smoke.mjs status --request-id release-test-001
node scripts/smoke.mjs wait --run RUN_ID --timeout 45
```

The run command returns a run ID and exits with code 4 while execution is active. Replace `RUN_ID` with that ID. Repeat `wait` while it reports `complete: false`; a wait timeout leaves the tests running. When complete, the response includes the result counts and local report path. Open that path in a browser, or select the run in the dashboard.

Use a new request ID for each intended run. If the start response is lost, query `status --request-id release-test-001` before doing anything else. Reusing the same request ID with identical inputs retrieves the existing run; it does not start another one. Plan output uses exclusive creation: choose a fresh output filename when testing another build.

To export the report again or stop a run:

```sh
node scripts/smoke.mjs report --run RUN_ID
node scripts/smoke.mjs cancel --run RUN_ID
```

Cancellation is a request, not an immediate terminal verdict. Query status afterward and retain its cleanup evidence. Interrupted or uncertain operations remain Unknown, and dependent work is Blocked. Report export does not rerun tests.

## Start with a smaller course

For an initial setup check, save the supplied color/project-lifecycle course, then plan and run it. It resolves to 13 checks, including the owned-engine connection prerequisite:

```sh
node scripts/smoke.mjs course save --file examples/color-regression.json
node scripts/smoke.mjs plan --app "/path/to/Wizard.app" --course color-regression --out /tmp/wizard-color-plan.json
node scripts/smoke.mjs run --plan /tmp/wizard-color-plan.json --operator "Tester name" --request-id color-test-001
```

Save the example once per workspace. If it is already saved, reuse `color-regression`; revision 0 is only for creating a course. Use the same status, wait and report commands as above.

## Read the outcome

| Exit code from run/wait | Meaning |
| --- | --- |
| 0 | Completed; every selected check passed |
| 1 | Completed with a failed check |
| 2 | Interrupted, blocked, unknown or otherwise incomplete |
| 3 | Request or service error; inspect the returned error and request ID |
| 4 | Still active, wait expired or cancellation requested |

The report records the exact package, course, runner and fixture identities. It preserves every outcome and flags missing evidence. A passing count applies to the selected automated behavior on that build. The packaged course does not establish UI gestures, audible playback, computer-use reliability or every assertion in Logan's checklist.

Desktop and service selections are optional and identify their instrumented runtime separately from the selected package. Human checkpoints and external publication are outside this release workflow.
