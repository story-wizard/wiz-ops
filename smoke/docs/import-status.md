# Automated build testing: repository scope

The first release supports selecting a compatible Wizard build, running automated checks, and producing a local report. The maintained `packaged-full` course supplies 57 engine checks. Human handoff, Oz guidance, tester sign-off, external report delivery and build dispatch are outside this release's requirements. Existing optional checkpoint code remains available for separate development.

Follow [automated build testing](automated-build-testing.md) for the operator commands and prerequisites.

Source imported from local checkpoint `b87fe06b836e0a2cb3452da3090847169166c31f` onto Ops base `e0e8066c2efa1e8d796407794cf704524af90cf9`, under `smoke/`. The owner approved wiz-ops as the publication destination.

## Scope

The import includes the Node service, CLI, dashboard, shared interactions, native adapter source, checks, source-only checklist criteria, accepted-definition registry and authoring documentation. Native client source remains separate. Existing Ops scripts and deployment configuration are unchanged.

Runtime state now uses one external workspace for packaged and desktop execution, recovery, reports, kits and native compilation. The macOS default is `~/Library/Application Support/WizardSmoke`; `SMOKE_DATA_DIR` overrides it. Output inside Git checkouts is rejected. Source definitions live in `catalog/` and do not contain workbook outcomes, notes or comparisons.

Original XLSX, screenshots, historical run reports, databases, applications, media, model caches and execution evidence are excluded. Existing local history remains in its original location; this source import does not migrate it or seed historical passes.

## Verification boundary

Framework tests exercise startup, source-only catalog integrity, custom selection, external workspace writes, desktop ownership bounds, recovery and report semantics without launching Wizard. Native compilation can be checked independently. Actual packaged/desktop smoke and second-machine acceptance require compatible runtime inputs and fresh retained evidence.

## Follow-up qualification

- [ ] Qualify a retained package against the operation schema and record runtime versions.
- [ ] Run a small packaged course on a second machine and inspect its evidence and interruption handling.
- [ ] Document Homebrew media/Qt tools and speech-model prerequisites.
- [ ] Supply and qualify the external adapter attached to each selected packaged build for desktop checks.
- [ ] Review candidate scope and resolve missing capabilities; mapped rows are not full coverage.

These follow-ups qualify use on another machine and broader desktop coverage. Repository publication does not claim that they have passed. Merging, deployment, build dispatch and shared report publication remain separate actions.
