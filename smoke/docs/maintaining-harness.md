# Build, install and update the harness

Distribute a selected-build adapter bundle to testers. It contains the source, dashboard, agent tools, external Qt adapter and matching QtTest framework. It contains no Wizard application, historical runs or personal projects. Testers choose their Wizard build separately.

## Open the source checkout

From `smoke/`, run `npm run open`. The launcher chooses a local port and asks which browser to use on first opening. Agents use `npm run open -- --no-open` and pass its printed URL to CLI commands. No npm packages are needed.

## Make a bundle

On a Mac with a matching Qt SDK, select a package to establish the adapter version:

```sh
node scripts/harness.mjs bundle --app /path/to/Wizard.app --data-dir /external/build-workspace --out /external/Athanor-VERSION
node scripts/harness.mjs check --bundle /external/Athanor-VERSION
```

Bundling compiles or reuses the adapter, copies it beside the source, and verifies the complete inventory. It does not launch Wizard. The destination must be new and outside Git. The bundle can be relocated. Its manifest records source and tool hashes; it is an integrity check for a trusted bundle.

## Install and open

Double-click `Install Athanor.command`, or from the bundle's `workspace` directory:

```sh
node scripts/harness.mjs install --bundle ..
node scripts/harness.mjs start --port 0
```

Installation keeps a versioned copy under the external WizardSmoke workspace and creates `Open Athanor.command`. It preserves old versions and reports, and refuses installation during active tests. Agents use `start --no-open`; `start --browser choose` changes the remembered browser.

Choose a build and course, press Prepare build, then Start checks after Ready. A bundle with matching tools needs no Qt SDK on the testing Mac. A different Qt version requires a matching adapter bundle or SDK compilation; preparation returns a repair prompt. Node.js 24+, local media tools and any course-specific model remain required. See [desktop setup](desktop-tools-setup.md).

## Update

Change source in Wiz Ops, run `npm test` and `npm run scope:check`, and retain focused runtime evidence. Make a new bundle in a new directory, let active tests finish, then install it. Prepare new plans after an update. Do not edit installed source or adapter bytes in place.

Legacy v1 bundles and `bundle --runtime FILE` remain available for historical tooling. They contain a separate instrumented app, which is not a valid substitute for the package selected in a new course.

## Qualify a packaged command schema

The baseline is `runner/contracts/installed-schema.json`. Extra reviewed package schemas are recorded by their exact hashes in `runner/contracts/packaged-schema-qualifications.json`, tied to that baseline hash. Preparation accepts either the baseline or one of those reviewed schemas, then freezes the actual schema hash in the plan. Readiness rechecks that exact identity. The instrumented desktop CLI has its own contract.

To qualify a new schema, read it using `wiz-cli project create --schema --no-spawn`, compare every operation against the baseline, inspect changes against the checks' requests and assertions, and add a qualification with its hash and review basis. Run the regression checks and prepare the actual package. Missing or unreviewed changes stay blocked. Updating the baseline requires reviewing its qualifications again.

The October 1 nightly differs only in `render.set_render_mode`: its mode enum adds `eighth` and the description clarifies preview resolution. The existing values and all other 161-operation contract fields are unchanged. This qualification makes that package usable with the mapped checks; it adds no new assertion for eighth-resolution playback.

## Regression checks and interrupted execution

The `Athanor framework checks` GitHub workflow runs the framework suite and scope integrity check on macOS with Node.js 24 when smoke source changes. It exercises fixtures and local servers without a Wizard package or desktop permissions. Application courses run separately on the testing Mac.

Ordinary failed assertions remain recorded and the run continues through independent checks and stages. Script completion and individual test observations are separate. An unexplained nonzero exit or failed stage finalization prevents a successful run, preserves completed observations, and stops later stages. Pointer cleanup balances a synthetic press even if the verified application loses focus; new gestures still require current process and window ownership.

If Start loses its response, use **Check start status**. If no admission is found, **Retry original start** resubmits the same immutable request ID and plan. Do not generate a new request ID to recover a lost response. The server reconciles a racing or duplicate admission under that original ID.
