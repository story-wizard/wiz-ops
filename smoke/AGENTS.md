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

Read `docs/changes-2026-10-02.md` for the current update. Use the maintained course and catalog as the authority for counts; historical pilot sections describe earlier tooling.

## Start from a checkout or bundle

Use Node.js 24 or newer. The command root is `smoke/` in a repository checkout and `workspace/` in a delivered bundle. It contains `package.json`, `scripts/`, `desktop/` and `docs/`; guidance paths below are relative to that root. Run:

```sh
npm test
npm run scope:check
npm run open -- --no-open
```

Keep the launch process running. It prints a local URL on an available port. Pass that URL to every agent command with `--server URL`, for example `node scripts/smoke.mjs setup --server URL`. `npm run open` without `--no-open` asks for a browser on first opening and remembers the choice. No npm packages are needed.

Use an absolute `SMOKE_DATA_DIR` outside Git for a separate workspace; the default is the user's WizardSmoke directory. A fresh workspace starts with the catalog and no results. Never insert invented runs or outcomes into a tester's workspace.

Run `setup`, `list`, and `courses` first. Ask for the build and intended selection if the user has not supplied them. Read [desktop tool setup](docs/desktop-tools-setup.md). Prepare the selected build before running: `smoke.mjs prepare` returns a progress ID; `smoke.mjs preparation --id ID` returns steps, readiness and an agent repair prompt. The dashboard has separate Prepare and Start actions. Preparation sets up a matching adapter and verifies it against the selected package. Never substitute a separate instrumented app. A compatible Wizard package and FFmpeg/FFprobe are needed for engine execution. Speech checks require the pinned offline model. Resolve missing prerequisites from the repair prompt and retain the failed attempt.

Read `docs/agent-tools.md` for single-check execution and atomic app/native tools. The dashboard is optional. Start with `node scripts/smoke.mjs setup --server URL` and `list --server URL`; both return JSON without executing tests.

For computer-use testing, read `docs/computer-use-agent.md`. Start an owned session with `desktop/session.mjs start --plan FILE`, then use `desktop/session.mjs tool SESSION.json OP JSON`. Ready prints the session and `agent-context.json` paths. Run `preflight` before gestures. Physically click and verify the editable field before native Unicode `type`; use bounded physical `scroll` for offscreen controls. Inspect the actual key window and focused control when keys are blocked. Use scoped `observe` and exact `find` selectors, `geometry` for clip bodies/edges, `physical` for the action being tested, `wait` for read-only conditions, and `verify` plus `capture` before recording Pass. Repeated checks have separate attempts. An Unknown mutation requires inspection, current verification and explicit `resolve`; stop can close its owned app without a new save/edit. Foreground attachment holds an OS lease across workspaces. Bundle delivery includes the compiled native driver; source checkouts compile it once with Swift from macOS Command Line Tools. Agent reports reuse the interactive report viewer and remain outside Git.

Attached adapters advertise versioned capabilities, supported native commands, capture methods and inspection limits. Read the session receipt or use `desktop/session.mjs native SESSION.json capabilities '{}'` before choosing a native route. Desktop execution isolates independent script groups in fresh projects and sessions, while persistence steps keep their own fixture. Preserve group failures, require confirmed owned-process cleanup before another launch, and never replay an uncertain action. Shared check helpers retain failure-state JSON and owned-window screenshots automatically; label observation waits with the condition being checked. Repeated captures must keep distinct filenames.

Use `node scripts/smoke.mjs context --check ID --server URL` for a test definition, source pointers and edit prompt. Add `--export` to retain a curated context folder outside Git, or `--run ID` to use a run's frozen definition and source. Read `docs/test-evidence.md` when changing checks, step recording or evidence collection.

Treat checks as reusable examples: keep fixture setup, tested action, pure independent assertions, evidence and cleanup separable. Read the composition and authoring examples in `docs/test-evidence.md`; that guide is included in exported agent packs. A check should run alone with explicit identities and declared prerequisites. Reuse the existing adapters and helpers, isolate mutable fixtures, and demonstrate a representative wrong result that its assertion rejects. Keep application-specific transports separate from state comparison logic. Course membership does not imply full checklist coverage or runtime qualification.

Use `plan --checks ID` for a focused check, then `run` for an evidence-backed verdict in the dashboard. Desktop tools attach to a byte-identical disposable copy of the selected build, using its shipped CLI and bundled Qt. For exploratory calls, prepare a desktop selection and use `desktop/session.mjs start --plan FILE`, `call`, `native`, and `stop`. Resolve identities from current observations. Operation success alone is not a behavioral pass.

Framework checks need loopback servers and local process inspection. If the agent sandbox denies `listen` or `ps`, use the agent's narrowly scoped approval mechanism to run those checks outside that sandbox. Do not change system permissions to make framework checks pass.

Run only when the user has authorized testing on that machine. Foreground sessions control the desktop. Record ordinary failed assertions and continue through independent checks; block dependent checks when fixture restoration or script completion fails. Preserve Fail, Blocked and Unknown, and inspect an uncertain mutation before doing anything else. Never retry a mutation merely because its response was lost.

For new-build preparation failures or feature changes, read `docs/build-repair.md`. Context packs include a build-repair prompt, mapped contracts and qualification records. Qualify exact reviewed schemas, update affected assertions for behavioral changes, and keep new feature checks behind lead acceptance. For source or runtime updates, follow `docs/maintaining-harness.md`. Keep bundles, models, projects and evidence outside Git. Preserve existing run evidence and installed runtime versions.

Build discovery displays 10 records per page by default. Filters search all retained metadata before pagination. Agents can use `builds --author me --page 2`, `--page-size all` for the cached catalog, and `--github-page N` to load older metadata in batches of 10. Inspect `nextGitHubPage` and `hasMoreGitHub` before requesting the next provider page.

For lost course-start responses, query the original request ID first. If the service returns 404, an explicitly requested retry may use the exact same request ID, plan hash and operator; admission is idempotent. Do not retry application mutations through this mechanism. Changed downloaded caches are blocked from reuse; reimport legacy archives to establish their package fingerprint, or explicitly register a modified app as a local build.


## Default checklist and qualification

A fresh launcher defaults to `smoke-full`: accepted core checks plus the maintained allowlist of physical/checklist qualification candidates. `automated-full` remains accepted-only; custom courses cannot promote candidates. Read `docs/agent-courses.md` for current composition. New physical groups must expose their selected definitions in `agent-context.json`, execute in fresh owned projects, preserve failures and retain native-input receipts in the course report. Stage executors run from the retained source snapshot. Keep the Mac unlocked for desktop checks; never attempt to bypass the lock screen or change system security settings.

The default `smoke-full` revision 2 excludes `S-PF-IDLE`. Keep the ten-minute idle measurement as a separate candidate probe for later; do not put it back into ordinary runs. See `docs/idle-candidate.md`.
