# Using Athanor

Athanor is the app name. Preserve the existing CLI names, formats and WizardSmoke workspace paths.

The October 3 local slice adds fourteen further UI/playback candidates, scoped model observations, native gestures and timed evidence recording. Read [harness control](docs/harness-control.md) for how these layers work and the retained qualification state. Candidate availability is not lead acceptance.

## Choose your task

Work from the command root: `smoke/` in a checkout or `workspace/` in a bundle. Read the guide for the requested task, then use live JSON discovery rather than reading every guide up front.

| Task | Start here |
| --- | --- |
| Run or compose an existing course | [Agent courses](docs/agent-courses.md) |
| Explore Wizard with mouse, keyboard and app operations | [Computer-use guide](docs/computer-use-agent.md) |
| Understand how the CLI, Qt adapter and physical input work together | [Harness control](docs/harness-control.md) |
| Plan and reuse short agent workflows | [Agent sequences](docs/agent-sequences.md) |
| Check the App caller of a Core persistence change | [Caller preflight](docs/caller-preflight.md) |
| Compare or improve agent control tooling | [Control harness baseline](docs/control-comparison.md) |
| Investigate failed checks and prepare bug drafts | [Investigations](docs/investigations.md) |
| Inventory a supplied .wiz project and plan representative-media checks | [Golden Project intake](docs/golden-project-intake.md) |
| Repair build compatibility or edit a test | [Build repair](docs/build-repair.md), then [test authoring](docs/test-evidence.md) |

Use `setup`, `list` and `courses` to discover readiness, current definitions and membership. Accepted definitions, runnable candidates, exploratory definitions and original Logan checklist rows are different inventories. Never substitute a documentation count for the catalog.

## Dashboard design

Design for desktop use on a capable Mac. Check full-screen and normal Mac window layouts first, with readable tables, clear run controls and room for evidence details. Keep narrow-window support as a fallback; do not compromise the desktop layout for mobile. Preserve the shared alchemical scene, restrained Athanor wordmark and Wizard mark. Use the selected Engraved ley scale progress treatment: neutral Billowing puff smoke inside plain glass, with bracketed, embossed outcome ticks below it. Keep the original smoke renderer without the extra foreground smoke experiments. Result colors belong to the ticks; preserve Pass, Fail, Blocked, Running, N/A, Unknown and pending counts. Animate only during active work; finished bars retain a faint still veil. Keep reduced-motion support and the static report fallback.

## Navigation, filters and evidence

Use the persistent navigation below the shared scene banner: Run tests, Results, Investigations, Checks, Test guide, and More. Investigations is the searchable follow-up index, with links from both baseline and focused repro results. More opens Desktop tools, Golden Project, Coverage and Logan's checklist. Direct workspace links are `/#setup`, `/#runs`, `/#catalog`, `/#investigations`, `/#desktop`, `/#gp`, `/#coverage` and `/#checklist`; the guide is `/explainer`.

Dropdown filters use checkbox multi-select: selected values within a field combine with OR; different fields combine with AND; no selection means all values. Build, course, sort order and evidence-record selectors remain single choices. Save filters stores a named view and the last selections per page in this browser. Workspace presets do not change courses or canonical definitions. Exported report filters and presets live in its URL fragment, which also preserves direct check links; copy the resulting link to retain that view.

Clicking an automated Results row opens the existing report evidence drawer immediately within Results. Reuse that viewer; keep one drawer, preserve its sandbox and close/keyboard controls, and avoid intermediate confirmation links. Test details show the expected outcome, how it runs, Operations used, observed actions and evidence. Keep technical/source diagnostics behind Troubleshoot. Edit this test provides an agent prompt and context pack; editing a definition still follows accepted-definition review and the framework checks in `docs/test-evidence.md`.

Use Find a build in New run, or the `builds` / `build` agent commands. Read `docs/build-finder.md` for inputs, prerequisites, download validation and external cache paths. GitHub discovery uses existing `gh` authentication. The PR author filter matches any included PR author; requester and publisher are separate fields. Read `docs/shared-build-catalog.md` for the durable catalog, conditional refresh and consumption by other tools. Downloading/selecting a build does not run a course.

Read `docs/demo-guide.md` for the short team walkthrough and `examples/agent-onboarding.txt` for the complete setup prompt.

Read `docs/changes-2026-10-02.md` for the current update. Use the maintained course and catalog as the authority for counts; historical pilot sections describe earlier tooling.

## Start from a checkout or bundle

Use Node.js 24 or newer. No npm dependency installation is needed.

```sh
npm run open -- --no-open
node scripts/smoke.mjs setup --server URL
node scripts/smoke.mjs courses --server URL
node scripts/smoke.mjs list --server URL
```

Keep the launcher running and replace `URL` with its printed loopback address. `npm run open` without `--no-open` asks for a browser on first opening and remembers it. Use the same absolute external `SMOKE_DATA_DIR` for the service and all session commands; the default is the user's WizardSmoke workspace. Runtime state stays outside Git, and a fresh workspace has no runs.

Use the supplied build and selection, or ask if missing. `prepare` returns a progress ID; poll `preparation --id ID` for steps, readiness and a repair prompt. Preparation attaches matching tools to a disposable copy of the selected package. Never substitute another instrumented app. Read [desktop setup](docs/desktop-tools-setup.md) only when resolving its prerequisites. Review the frozen selection and added prerequisites, then run when the user has authorized testing on that machine. Preparation and discovery do not run a course.

For exploration, follow [computer-use guidance](docs/computer-use-agent.md). Start with `desktop/session.mjs start --plan FILE`, read the returned `agent-brief.json` first (`fullContext` retains `agent-context.json`), and use `desktop/session.mjs tool SESSION.json OP JSON`. Context lists build/process/project identities, current keys and operations, inspection limits, toolkit Pass contracts and the deadline. Run `preflight` before gestures. Scripted courses have their own assertions; exploratory observations cannot qualify an interactive Pass without a proof contract.

## Execution and evidence rules

- Bind every action to the selected build, current process and observed target. Ambiguity is Blocked. Foreground sessions hold a cross-workspace lease; keep the Mac unlocked and available. Never bypass the lock screen or change system security settings.
- Use CLI/Qt calls for setup and readback, and physical input for the gesture being tested. Verify independently and collect declared evidence. Operation success alone is not a behavioral pass. Preserve source snapshots and distinct capture filenames.
- Preserve Fail, Blocked and Unknown. Ordinary assertion failures continue into independent checks after confirmed cleanup. An uncertain mutation stops its session; inspect and resolve it, never replay it. A retest keeps earlier attempts intact.
- Recover a lost course start by querying its request ID first. A user-authorized retry may reuse the exact request ID, plan hash and operator after a 404; admission is idempotent. This does not authorize retrying app mutations.
- Report tests, build/tool identities, verdicts and the local report URL. Keep technical diagnostics behind Troubleshoot. Do not invent run results or publish bugs, Jira updates, uploads or messages without the user's request.
- Edit in a source checkout. Use `context --check ID --export --server URL` for source pointers and the repair prompt. Separate setup, tested action, pure assertions, evidence and cleanup. Changed accepted definitions need lead review. Run `npm test` and `npm run scope:check` after harness changes; these checks do not execute a Wizard course. If sandbox restrictions deny loopback/process inspection, use narrowly scoped approval without changing system permissions.

Build discovery defaults to 10 records per page. Filters search retained metadata before pagination. Use `builds --author me --page 2`, `--page-size all` for cached records and `--github-page N` for older provider pages. Inspect `nextGitHubPage` and `hasMoreGitHub`. The finder automatically loads older metadata in batches of 50, updating search without a Load older button. Changed downloaded caches require reimport or explicit local-build registration.

For source/runtime packaging follow [maintenance](docs/maintaining-harness.md); preserve installed versions and frozen run evidence. Read the [current update](docs/changes-2026-10-02.md) for dated changes.

For agent observation efficiency, use `observe` with 1–8 nonempty `selectors`
to sample related controls together. Repeated reads with `since` return the
smaller representation: `encoding: full` with `matches`, or `encoding: delta`
with `changes`. Check encoding and completeness; UI deltas do not establish
timeline, graph or output correctness. Both direct `physicalInput` and toolkit
input reject unknown fields before dispatch. Use `durationMs` for drags and
refresh geometry after `input_binding_rejected`. See the control baseline guide
for the contract and the broader control-family audit method.

For short known sequences, use `desktop/session.mjs batch SESSION.json STEPS.json`
with 1–8 ordinary tool requests. Use `expect` gates on readbacks before dependent
edits. Sequences stop at the first error or false expectation and retain individual
tool receipts; they provide no rollback or target reservation. Bots may keep
`desktop/session.mjs tools SESSION.json` open for sequential JSON-lines requests
instead of restarting Node per call. Inspect the session context's connection
contract. Request IDs correlate responses, not retries: never resend a lost
mutation. Preserve all frozen assertions, captures, fresh input guards and the
session deadline. See the computer-use guide for examples.

Before planning physical work, read [agent sequences](docs/agent-sequences.md).
Plan each known phase ahead, bind targets and expected values from the current
session, and split at new IDs, dialogs, geometry or decisions. Use
`desktop/session.mjs batch-check SESSION.json STEPS.json` to validate the complete
array against the selected schema without app requests or writes. Reuse the
editable JSON in `examples/sequences/`; replace its placeholders and preserve
the selected check's frozen actions, assertions and captures. Review each phase
before dispatching another. Parameter validation does not reserve targets.
For compact batch responses, add `--compact` (or JSON-lines `compact:true`). Read
the checksummed full `receipt.path` for required domain state, and inspect gates,
returned mutation indexes and `summary.continuation` before proceeding. Unknown
requires reconciliation; storage failures return the full response for retention.
For bounded branching, use `plan-check SESSION.json CONTROL_PLAN.json`, then
`plan SESSION.json CONTROL_PLAN.json --compact`. Control plans contain up to eight
named batch phases and 32 declared steps. Every path validates before input.
Branches compare explicit values in the final complete read-only step; unknown
values, incomplete data, failed gates and Unknown stop execution. Keep review
checkpoints for new IDs, geometry and interpretation. Progress and final receipts
stay inside the owned session. Inspect them and tool journals after a lost reply;
never resend a plan. The agent still authors and reviews the plan; automatic plan
generation and Jev remain deferred. See the sequence guide and media-plan example.

## Default checklist and qualification

A fresh launcher defaults to `smoke-full`: accepted core checks plus the maintained allowlist of physical/checklist qualification candidates. `automated-full` remains accepted-only; custom courses cannot promote candidates. Read `docs/agent-courses.md` for current composition. New physical groups must expose their selected definitions in `agent-context.json`, execute in fresh owned projects, preserve failures and retain native-input receipts in the course report. Stage executors run from the retained source snapshot. Keep the Mac unlocked for desktop checks; never attempt to bypass the lock screen or change system security settings.

The default `smoke-full` revision 8 excludes `S-PF-IDLE`. It adds ten qualification candidates for project search across timeline focus, physical blur Inspector editing, mask clipboard/history, vectorscope tap response, New Project, Save As, projectless Preferences, missing-term search, 100-clip clipboard and 50-step physical history. Read the current qualification notes in `docs/harness-control.md`; lead acceptance remains separate. Keep the ten-minute idle measurement as a separate candidate probe for later; do not put it back into ordinary runs. See `docs/idle-candidate.md`.

## Local investigations

Read [the October 4 investigation update](docs/changes-2026-10-04-investigations.md) for the current local slice.

Read `docs/investigations.md` after a failing course. Open the exported `index.html` for human review and `review-data.json` for process-bound captures and attachment roles; `drafts/` holds individual bug text. Use frozen procedures when available, preserve the legacy method fallback, and never invent missing steps. Exported review is read-only; record a person's decision in the live investigation. Results → Investigate packages the first report for agent triage, groups supported duplicates, creates a diagnostic repro selection and retains linked attempts. Classify harness/environment/app/unresolved with evidence, preserve original outcomes, and log actions with revision-checked updates. Report a Bug drafts require a person to review and confirm before they submit. Use `investigation reporter --id ID --case CHECK_ID --server URL` for a verified evidence parcel and the draft-only GUI prefill prompt. Read `docs/bug-reporter-interop.md`; prefill requires separate GUI authorization and an owned session on the same build/project. Do not inject parcels into Wizard's pending-report store or claim attachments were delivered by field prefill. The local workflow never submits externally or creates Jira issues. Investigation diagnostics add qualified captures; do not claim app tracing/profiling is enabled without a collector.

Use `investigation task --id ID --task triage|repair|repro|review --case CHECK_ID --server URL` for a scoped agent handoff, and `investigation evidence` for case-owned evidence. Return triage proposals for `investigation proposal` preview before applying reviewed updates. The investigation page has Brief, Evidence, Attempts and Bug draft tabs; use recorded outcomes and frozen procedures, not operation exit alone. Draft edits clear prior confirmation and remain bound to the latest attempt. Managed `investigation prepare/start` retain admission IDs and link completed repros on inspection; they reuse the normal execution guards. Preparation can launch Wizard for attachment verification. Obtain desktop availability first. Inspect a retained request after a lost response, never replay unknown app mutations, and never bypass an active foreground lease. See the investigation guide for JSON edit and review contracts.

## Shared runner planning

Read [Studio hosting](docs/studio-hosting.md) for the proposed single-runner pilot and scaling path. The current server is loopback-only, with no team authentication or roles. Do not expose it by loosening Host/origin guards, using public tunnels, or trusting browser-supplied operator names as identity. Studio deployment, permission changes and remote test execution require specific authorization under the Studio access policy. Desktop checks need the runner user's unlocked GUI session; remote browser access alone does not provide that session.

Project workflow candidates use `desktop/check-projects.mjs` with pure assertions in `desktop/project-proof.mjs`. Rebind the session only after the visible MainWindow confirms the owned destination. New Project and Save As must verify fresh-process persistence and unchanged original timelines; projectless Preferences must start at the hub. Pointer guarding excludes only the system cursor at its reserved Window Server layer; real overlays still block input.

Volume and search candidates use `desktop/check-volume-search.mjs` and pure assertions in `desktop/volume-proof.mjs`. Every selected candidate has its own fixture group. History latency includes physical dispatch and independent readback; retain it as a measurement until a performance policy is reviewed.

Long foreground driver sequences may declare `scriptTimeoutMs` (1000–600000 ms). The executor uses the largest selected declaration, with a 120000 ms default. This is an execution budget, separate from performance acceptance. Interrupted drivers retain Unknown before a missing report can mask the cause.


Readiness helpers live in `desktop/check-support.mjs` and
`desktop/recorder.mjs`. Use complete observations for absence, stable usable
geometry for floating panels, and owned key-window/focus observations for native
file entry. Waits are read-only and never reserve input targets. For stopped
preview verification, use fresh transport-bracketed captures with an independent
pixel predicate; two matching samples are required and all settling samples are
retained. Compositor freshness is distinct from renderer-frame acknowledgement.
Keep observation budgets separate from performance acceptance and preserve
historical failed attempts. See `docs/agent-tools.md` for helper contracts.

For reusable control recipes and guarded result bindings, read the sequence guide.
`recipe-check SESSION RECIPE VALUES` compiles typed JSON into a validated plan
without app input. Runtime values stay external. Choose a known plan request ID
before dispatch; recover via `plan-inspect`, never replay. Inspection exposes
retained prefixes and possible in-flight actions without writes or resumption.
Bindings carry complete unique observed IDs/model offsets only, refresh their
literal source before use and preserve every ordinary input guard. Geometry and
new dialogs stay review checkpoints. Recipe gates remain exploration until the
selected check's frozen proof contract is satisfied.

For a Core/App persistence change, use `scripts/caller-preflight.mjs --app DIR --core DIR`
and read `docs/caller-preflight.md`. Verify configured build directories, build and
run both mapped targets, and retain outputs. Discovery never counts as passed tests.
Exact reviewed hashes compare commits and trees separately; do not update pins or
accept dirty source automatically. Preparation/bundle Git identities are separate
from the retained byte fingerprint and selected package hash.

### Recipe workflow planning

Use `desktop/session.mjs workflow-check SESSION.json WORKFLOW.json` to compose
ordered typed recipes before dispatch. The output is read-only compilation,
with recipe/value hashes, namespaced phases/bindings and separate plan segments.
Only recipe-authored `continueAfter` exits may join, and those must finish with
a gated full read-only step followed only by captures. Every other exit remains
a review stop. Preserve independent assertions and captures; geometry, new
dialogs and interpretation remain agent decisions. Inspect one segment and run
it once with a known plan ID; never automatically execute all segments or replay
Unknown. See `docs/agent-sequences.md#compose-recipes-before-dispatch`.

### Compact control entry

Start exploratory control from `agent-brief.json`. Use `tool SESSION.json task` to list recipes and prepare a reviewed existing plan before writing one. Add Track accepts only optional values.timelineId and binds the rest without input; the default fixture main must be displayed. Other recipes require explicit observed values. Returned run/inspection commands and the brief's persistent JSON-lines connection bind the session workspace. Scope is an observed ID string; model itemRects use the returned viewport. Default checkbox clicks use current styled clickRect metadata, followed by checked/enabled readback. Capture dialogs separately and review one image per required result. Single-tool CLI results over 4 KiB retain full checksummed receipts; read exact values there when needed. JSON-lines tool clients opt into `compact:true`. Saved Spell string typing may declare `commit:{documentId,inputId}` for exact readback and owned replacement-control verification. Other focus loss remains Unknown. Reobserve after rebuilds, keep independent assertions/captures, and never replay uncertain input.
