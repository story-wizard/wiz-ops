# Using Athanor

Athanor is the app name. Preserve the existing CLI names, formats and WizardSmoke workspace paths.

## Start from a checkout

Use Node.js 24 or newer, then run these commands from `smoke/`:

```sh
npm test
npm run scope:check
npm run open -- --no-open
```

Keep the launch process running. It prints a local URL on an available port. Pass that URL to every agent command with `--server URL`, for example `node scripts/smoke.mjs setup --server URL`. `npm run open` without `--no-open` asks for a browser on first opening and remembers the choice. No npm packages are needed.

Use an absolute `SMOKE_DATA_DIR` outside Git for a separate workspace; the default is the user's WizardSmoke directory. A fresh workspace starts with the catalog and no results. Never insert invented runs or outcomes into a tester's workspace.

Run `setup`, `list`, and `courses` first. Ask for the build and intended selection if the user has not supplied them. A compatible Wizard package and FFmpeg/FFprobe are needed for engine execution; desktop/service checks also require qualified desktop tools. Speech checks require the pinned offline model. Return the specific missing prerequisite rather than claiming the source clone supplies those binaries. See [source handoff](docs/source-handoff.md).

Read `docs/agent-tools.md` for single-check execution and atomic app/native tools. The dashboard is optional. Start with `node scripts/smoke.mjs setup --server URL` and `list --server URL`; both return JSON without executing tests.

Use `node scripts/smoke.mjs context --check ID --server URL` for a test definition, source pointers and edit prompt. Add `--export` to retain a curated context folder outside Git, or `--run ID` to use a run's frozen definition and source. Read `docs/test-evidence.md` when changing checks, step recording or evidence collection.

Use `plan --checks ID` for a focused check, then `run` for an evidence-backed verdict in the dashboard. Installed desktop tools are selected automatically. For exploratory calls, prepare a desktop selection and use `desktop/session.mjs start --plan FILE`, `call`, `native`, and `stop`. Resolve identities from current observations. Operation success alone is not a behavioral pass.

Run only when the user has authorized testing on that machine. Foreground sessions control the desktop. Preserve Fail, Blocked and Unknown, and inspect an uncertain mutation before doing anything else. Never retry a mutation merely because its response was lost.

For source or runtime updates, follow `docs/maintaining-harness.md`. Keep bundles, models, projects and evidence outside Git. Preserve existing run evidence and installed runtime versions.
