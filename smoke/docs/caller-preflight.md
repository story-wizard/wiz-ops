# Check the caller as well as Core

A Core persistence change can pass Core tests while breaking the App's saved
state or history expectations. The first preflight mapping pairs
`wiz_timeline_api_contracts_tests` with
`wizard_project_manager_reconcile_tests`. It reads the selected local checkouts,
verifies the current CMake registrations and test sources, and prints commands
as argument arrays. It does not compile, run tests or launch Wizard.

```sh
node scripts/caller-preflight.mjs --app /absolute/wizard --core /absolute/wizard-core \
  --app-build /absolute/app-build --core-build /absolute/core-build
```

Optional `--reviewed-app` and `--reviewed-core` accept exact commit hashes.
Omit build directories to inspect the mapping first; replace the placeholder
paths after configuring a matching pair. When supplied, build directories must
belong to those exact source checkouts, and the App's `WIZARD_CORE_CPP_DIR` must
match the requested Core. A different pair is Blocked. The output hashes both
test sources and registrations, and marks `executed:false`.

Review the printed targets, build them, then run both anchored CTest selections.
`--no-tests=error` prevents an empty selection from looking successful. Retain
the commands, output, source identities and results outside Git. Existing
binaries may predate the source, so discovery alone is not a test result. Keep
platform/sanitizer CI and selected-package acceptance separate. Add other
caller mappings only after verifying their actual source and test boundary.

## Source identities in receipts

Preparation records `runnerProvenance`; harness bundles record `sourceCommit`,
`sourceTree`, `sourceScopeTree` and `sourceDirty` beside the existing source byte
hash. The scoped tree identifies the command-root subtree in a larger repo.
These Git fields describe committed source. Dirty work and the copied snapshot
are described by the retained byte fingerprint; they are not the committed tree.
Source-only archives without Git report provenance unavailable.

Preflight comparisons expose `sameCommit`, `sameTree`, `sameScopeTree` and `clean`
separately. A rewritten commit can preserve a tree. A changed or dirty tree
needs review even when an old commit was approved. These observations never
refresh a pin, accept a review or substitute for the package hash. App/Core
source identities are not claimed as the provenance of a downloaded package.
