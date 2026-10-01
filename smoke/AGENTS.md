# Using Athanor

Athanor is the app name. Preserve the existing CLI names, formats and WizardSmoke workspace paths.

## Dashboard design

Design for desktop use on a capable Mac. Check full-screen and normal Mac window layouts first, with readable tables, clear run controls and room for evidence details. Keep narrow-window support as a fallback; do not compromise the desktop layout for mobile. Preserve the shared alchemical scene, restrained Athanor wordmark and Wizard mark. Use the Arcane current progress treatment: taper the steam behind a clear leading spark. Steam and the magical leading edge animate only during an active run; a faint stationary origin wisp remains on finished bars. Keep status colors and reduced-motion support.

## Navigation, filters and evidence

Use the persistent navigation below the shared scene banner: Run tests, Results, Checks, Test guide, and More. More opens Desktop tools, Golden Project, Coverage and Logan's checklist. Direct workspace links are `/#setup`, `/#runs`, `/#catalog`, `/#desktop`, `/#gp`, `/#coverage` and `/#checklist`; the guide is `/explainer`.

Dropdown filters use checkbox multi-select: selected values within a field combine with OR; different fields combine with AND; no selection means all values. Build, course, sort order and evidence-record selectors remain single choices. Save filters stores a named view and the last selections per page in this browser. Workspace presets do not change courses or canonical definitions. Exported report filters and presets live in its URL fragment, which also preserves direct check links; copy the resulting link to retain that view.

Clicking an automated Results row opens the existing report evidence drawer immediately within Results. Reuse that viewer; keep one drawer, preserve its sandbox and close/keyboard controls, and avoid intermediate confirmation links. Test details show the expected outcome, how it runs, Operations used, observed actions and evidence. Keep technical/source diagnostics behind Troubleshoot. Edit this test provides an agent prompt and context pack; editing a definition still follows accepted-definition review and the framework checks in `docs/test-evidence.md`.

Use Find a build in New run, or the `builds` / `build` agent commands. Read `docs/build-finder.md` for inputs, prerequisites, download validation and external cache paths. GitHub discovery uses existing `gh` authentication. The PR author filter matches any included PR author; requester and publisher are separate fields. Read `docs/shared-build-catalog.md` for the durable catalog, conditional refresh and consumption by other tools. Downloading/selecting a build does not run a course.

Read `docs/demo-guide.md` for the short team walkthrough and `examples/agent-onboarding.txt` for the complete setup prompt.

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

Run only when the user has authorized testing on that machine. Foreground sessions control the desktop. Record ordinary failed assertions and continue through independent checks; block dependent checks when fixture restoration or script completion fails. Preserve Fail, Blocked and Unknown, and inspect an uncertain mutation before doing anything else. Never retry a mutation merely because its response was lost.

For new-build preparation failures or feature changes, read `docs/build-repair.md`. Context packs include a build-repair prompt, mapped contracts and qualification records. Qualify exact reviewed schemas, update affected assertions for behavioral changes, and keep new feature checks behind lead acceptance. For source or runtime updates, follow `docs/maintaining-harness.md`. Keep bundles, models, projects and evidence outside Git. Preserve existing run evidence and installed runtime versions.

Build discovery displays 50 records per page by default. Filters search all retained metadata before pagination. Agents can use `builds --author me --page 2`, `--page-size all` for the cached catalog, and `--github-page N` to load older metadata in batches of 50. Inspect `nextGitHubPage` and `hasMoreGitHub` before requesting the next provider page.

For lost course-start responses, query the original request ID first. If the service returns 404, an explicitly requested retry may use the exact same request ID, plan hash and operator; admission is idempotent. Do not retry application mutations through this mechanism. Changed downloaded caches are blocked from reuse; reimport legacy archives to establish their package fingerprint, or explicitly register a modified app as a local build.
