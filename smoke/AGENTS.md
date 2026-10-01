# Using Athanor (Smoke)

Athanor is the app name; Smoke is the everyday moniker. See README.md for the naming decision. Preserve the existing machine identifiers and retained workspace paths.

Read `docs/agent-tools.md` for single-check execution and atomic app/native tools. The dashboard is optional. Start with `node scripts/smoke.mjs setup` and `list`; both return JSON without executing tests.

Use `node scripts/smoke.mjs context --check ID` for a test definition, source pointers and edit prompt. Add `--export` to retain a curated context folder outside Git, or `--run ID` to use a run's frozen definition and source. Read `docs/test-evidence.md` when changing checks, step recording or evidence collection.

Use `plan --checks ID` for a focused check, then `run` for an evidence-backed verdict in the dashboard. Installed desktop tools are selected automatically. For exploratory calls, prepare a desktop selection and use `desktop/session.mjs start --plan FILE`, `call`, `native`, and `stop`. Resolve identities from current observations. Operation success alone is not a behavioral pass.

Run only when the user has authorized testing on that machine. Foreground sessions control the desktop. Preserve Fail, Blocked and Unknown, and inspect an uncertain mutation before doing anything else. Never retry a mutation merely because its response was lost.

For source or runtime updates, follow `docs/maintaining-harness.md`. Keep bundles, models, projects and evidence outside Git. Preserve existing run evidence and installed runtime versions.
