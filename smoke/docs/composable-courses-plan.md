# Composable smoke courses and an agent-facing CLI

September 27, 2026. Design for WIZ-423, primarily WIZ-506, with WIZ-504/505/507/512. The two packaged-engine slices are now implemented; see [the operating guide](agent-courses.md) for actual CLI commands and the initial acceptance boundary. The examples below remain the original interface sketch. Desktop/service composition and the native Tower composer are now implemented; canonical submission/review remains follow-up work. No Jira updates were made.

## Intended developer workflow

A developer asks their agent to run the color checks against a particular Wizard build. The agent discovers the checks, previews the exact selection and prerequisites, starts a frozen plan, waits or returns later, and reports the observed results with evidence links.

The same definitions and executor serve direct CLI callers, agents and Tower. Agents select checks and explain outcomes; they do not substitute their own operations or decide that different assertions are equivalent.

## What exists now

- Stable check IDs, course JSON, shared interaction helpers and real app assertions.
- Exact packaged build/fixture identities, disposable projects, operation journals and retained outcomes.
- Packaged prepare/preflight/start commands, with local HTML/JSON report delivery.
- Packaged-engine execution remains separate from framework and desktop evidence.
- Tower's read-only CLI inventory.

The packaged path now supports grouped saved courses and one-off selections, optional speech prerequisites, frozen plans, request recovery, status/wait/cancel and local reports. Custom selections require accepted check definitions; Charles has accepted the existing checklist-linked definitions for their stated automated scope. Desktop/service runners remain separate and depend on their local runtime setup.

## Project variants

| Variant | Meaning and plan |
|---|---|
| Fresh | An empty, newly created Wizard project. Available now; no separate delivered project archive is required. A check may populate its disposable Fresh project through its own setup recipe. |
| Story-user | Reserved future project input. Add its approved source project, media manifest, identity and preparation recipe when available. |
| Large | Reserved future project input. Add the same contract with its intended scale and expected state when available. |

Separate starting project from test preparation. Fresh is not the eight-file synthetic media pack, nor does it mean a test must run on an empty timeline. The pack is an input to preparation; the test declares the state it needs.

Future variants are explicitly unavailable until supplied. Requesting one must report Blocked before app mutation, rather than silently substituting Fresh. Tests declare supported variants; not every existing assertion can run unchanged on a populated project. Clone a supplied base into a disposable run location and map semantic roles such as primary timeline or reference clip to observed IDs. Preserve the original base. Adding Story-user or Large creates a new fixture version without changing historical runs.

This clarification updates planning semantics. It does not promote source-row outcomes or rewrite retained evidence.

## One source of truth

Use the existing definitions as the canonical registry for app functional/smoke checks. Preserve Logan's rows as the source of testing intent and keep links to the automated counterparts.

A course is a saved, user-editable selection and grouping of check IDs plus its project variants and execution requirements. Courses reference definitions; they do not copy expected results or implementations. A run is one execution of a frozen selection. It can originate from a saved course, a combination of course selections, or a one-off selection without first saving a course.

The **Smoke Test** course derived from Logan's checklist is the intended canonical full-test course. Its approval/versioning determines what constitutes a full smoke run. Other courses are first-class reusable selections, such as Color regression or Editing and persistence. They do not redefine the canonical full course or require release-scope approval merely to exist.

Users and agents can create, inspect, revise and run saved courses through the same API. Each saved course has a stable identity and revision. Runs retain the originating course revisions, resolved check definitions, groups, project variants and inputs. Editing a saved course affects future runs only.

Grouping organizes the plan and report; it does not implicitly share mutable project state between checks. Preserve requested group/order intent where possible and expose any prerequisite ordering constraints before launch. Initially deduplicate overlapping selections for the same check and project variant, preserving all group memberships in the report. Intentional repeated checks can later use explicit iteration identities. An unsupported runtime or variant remains visible as blocked rather than being silently dropped.

Keep the current files initially. A shared registry can read the packaged, desktop and service definitions without a format rewrite. The database can retain frozen run snapshots and editable catalog notes; executable assertions and expectations need a clear versioned owner.

Unit/component suites remain in their existing test frameworks. Tower can reference their reports, but a unit pass is not a smoke pass. This avoids creating a second source of truth for those suites.

## Smallest next slice: selected packaged checks

1. **Discovery.** Return structured definitions with ID, source row, title, target, category/tags, expected behavior, supported project variants and prerequisite declarations. Start with exact IDs and existing categories. Add a small explicit color suite where cross-category graph checks belong; do not infer all coverage from ID prefixes.
2. **Plan.** Accept saved user courses and one-off combinations of check IDs or groups. Resolve the requested grouping/order against prerequisites and explain additions or ordering constraints. Reject empty or unknown selections. Freeze build, course revision, definition, fixture, variant and selection identities.
3. **Prepare and run.** Validate only the dependencies required by the resolved plan. A color-only plan must not require a speech model. Existing package/operation compatibility checks still apply; supporting a different schema requires deliberate compatibility work, not bypassing checks.
4. **Observe.** Provide structured status, bounded wait, cancellation and final results. A waiting client may disconnect without losing the run. Stopping the wait does not implicitly cancel app work. Ambiguous mutation outcomes remain Unknown, with no blind replay.
5. **Report.** Reuse the local report. Show requested checks, added prerequisites, selected results and the rest of the catalog as Not selected. A subset pass never becomes a full-course or source-row pass.

Keep execution serial initially. Many checks own their own disposable project, but process restart and UI focus requirements make automatic parallel execution an unsafe default. Desktop/service subsets follow after their readiness contracts join the same planner.

### Proposed CLI shape

This is an interface sketch, not a runnable command sequence today:

```sh
smoke list --target packaged --category colour --json
smoke plan --app /path/to/Wizard.app --suite colour --project fresh --out colour-plan.json
smoke run --plan colour-plan.json --operator "Developer name" --wait --json
smoke status --run RUN_ID --json
smoke report --run RUN_ID --format html
```

Also support explicit check IDs and unions of selections. Use documented canonical selector values, with any spelling aliases normalized before the plan is frozen.

Provide course list/show/save operations in the same CLI/API. Saving a course persists references and grouping metadata only. A one-off run uses the same planner without requiring a named course. The first implementation can support flat named groups without a nested workflow language.

JSON stdout must be a stable versioned envelope; progress and diagnostics go to stderr. An admitted response differs from a completed response. Define exit codes for completed pass, failed checks, incomplete/blocked/unknown results, and invalid requests. An agent must never interpret process exit zero from asynchronous admission as a passing course.

Keep the local service as execution owner. No Tower window is required. The CLI should state clearly when the service is unavailable and how to start it. Service-free execution is unnecessary for this slice.

## Contract changes that matter

- The prepared plan owns the exact selected check IDs and ordered prerequisite closure.
- Admission persists that resolved plan; execution reads it rather than rereading the full global course.
- Required operations, media/model inputs and runtime requirements derive from that plan.
- Reports compare outcomes with the selected plan, not the global candidate count.
- A caller request ID can identify an admitted run after a lost response and prevent accidental duplicate starts.
- The original full course remains a named selection using the same execution path.
- Saved user courses have stable IDs and revisions; ad hoc plans need no saved course. Full smoke acceptance refers to the canonical Smoke Test course revision, regardless of whether another custom run happens to pass.

Do not implement subset support by filtering the loop alone. That would leave admission, preflight and acceptance/report denominators disagreeing.

## Acceptance for the next slice

- An agent discovers color checks, previews a Fresh/package plan, runs it, waits and receives a readable summary plus the local report path.
- A user or agent saves a grouped custom course, runs it, revises it and confirms the earlier run retains its original selection and expectations. The same checks can also run as a one-off selection without saving a course.
- Only selected checks and declared prerequisites execute. Their normal independent assertions still run.
- The plan works without an unrelated speech-model installation.
- Unknown IDs, empty selections, unavailable project variants and incompatible capabilities are rejected or blocked explicitly before mutation.
- A changed package, definition or fixture invalidates stale preparation.
- A failed or interrupted selected check produces a non-success result. A lost start response cannot silently create a duplicate run.
- The report distinguishes selected and unselected tests and never claims the entire checklist passed.
- The full 57-check packaged course remains expressible through the same API and retains its existing evidence contract.

## Jira alignment and following work

- **WIZ-506:** explicitly calls for retained packages and named courses/subsets. This is the principal next slice. A CLI-first implementation creates the shared operation Tower will call, but does not by itself finish the ticket's dashboard package-selection criterion.
- **WIZ-504:** preserve every original row, partial coverage and reviewable required/excluded scope. Developer subsets do not revise the V1 acceptance set.
- **WIZ-505:** Fresh is established as the empty baseline; register Story-user and Large when provided. Preserve fixture versions and expected states.
- **WIZ-507:** exercise changed plans, lost responses and interruptions without rewriting history or replaying uncertain operations.
- **WIZ-512:** extend the existing local report with selection/prerequisite context. Shared destination and external delivery remain deferred for now.

After this slice: desktop/service selection through the same plan contract, portable workstation prerequisites, full required-scope acceptance, and the remaining shared-delivery/build/pilot commitments. Human handoff remains a separate deferred slice. No general workflow language, new scheduler or duplicated agent-only test scripts are needed.
