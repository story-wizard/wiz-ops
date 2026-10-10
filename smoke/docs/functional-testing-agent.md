# Test a functional script with Athanor

A developer can give an agent a functional script, a build and permission to run
it, then review the results later. The agent translates that script into tests,
uses suitable fixtures and groups compatible work. Start with the existing
catalog and recipes; create a new check only for behavior they do not cover.

For nightly or weekly testing, use [workers](workers.md) to freeze both the maintained functional assertions and the full catalog inventory. New release-note tests enter as proposals with source provenance, fixture needs and independent expectations.

For ordinary trim/edit/history exploration, use the
[task packet](task-packets.md) to gather current context and valid request shapes
in one reply. After a run, its offline learning command exports review facts for
improving a parameterized recipe. Rebind every new run; old targets and outcomes
remain historical evidence.

## Turn the script into a plan

1. Retain the original script outside Git. Record the selected build, requested
   behaviors, required order, tested interaction and expected outcomes. Keep
   explicit instructions such as “drag”, “restart” or “use the same project”.
2. Discover current checks with `list`, membership with `courses`, and readiness
   with `setup`. Read a matching check's context before selecting it. Match its
   actual assertion and interaction route, not just its title.
3. Map each script requirement to an accepted check, a maintained qualification
   candidate or a new exploratory scenario. Record partial matches and uncovered
   requirements separately. A custom course selects accepted definitions;
   maintained candidates use their existing course subset.
4. For each scenario, define fixture inputs, baseline, action, independent
   assertion, evidence and reset/cleanup. Decide what must stay unchanged as
   well as what should change. Define the oracle before performing the action.
5. Retain the proposed groups and dependencies, then validate their executable
   selections or recipes. Run only within the user's authorized scope and the
   owned session's lifetime. Missing build, fixture or expected behavior needs
   clarification; available tools do not supply those requirements.

Use [agent courses](agent-courses.md) for existing checks,
[agent sequences](agent-sequences.md) for recipes and bounded plans, and
[test authoring](test-evidence.md) for a new reusable check. Arbitrary prose is
interpreted by the agent; the harness executes validated selections and authored
plans. It does not automatically compile a functional script into a course.

## Choose fixtures by what the test needs

Fresh is the executable starting project today. Existing checks populate it with
their declared synthetic media. Reuse those fixture builders and pure assertions
when their assumptions match; bind returned IDs instead of cached widget IDs,
filenames or coordinates.

For a supplied `.wiz`, follow [Golden Project intake](golden-project-intake.md).
Inventory it read-only, retain unknown fields, and request semantic roles such
as video with audio, a still, or enough usable source for a trim. Role candidates
are discovery hints. Verify actual source availability, timing and selected-build
support before binding them. Preserve the supplied project and media; use a
qualified disposable checkpoint copy for edits. Intake does not yet make a
supplied project executable through the course runner.

Record chosen asset/timeline IDs, source ranges, frame rates, root mappings,
checkpoint identity and expected initial state. A synthetic pixel or transcript
oracle needs adaptation for real media. Missing roles remain Blocked; do not
silently substitute another source. Keep source media local and declare bounded
evidence windows rather than exporting an entire long clip.

## Group work without changing the test

There are two levels of grouping: course checks sharing a qualified driver
session, and known actions sharing a batch or control plan. Neither removes
per-test assertions, captures or cleanup.

| Situation | Plan |
| --- | --- |
| Independent checks with compatible build, instrumentation and fixture assumptions | Use the runner's grouped mode. Keep separate per-check timelines, clips or Spells and baseline/evidence identities. |
| A script intentionally builds on an earlier edit | Keep its order and declared state dependency. Verify the prerequisite before continuing; a failed prerequisite blocks dependent cases. |
| Known action, settling condition and readback | Batch them with expected-outcome gates; include the required capture. |
| New IDs, unobserved geometry, dialogs or visual interpretation | End at a review checkpoint, inspect, then bind the next phase. |
| Restart, external reload, preference changes, long history or incompatible admission modes | Preserve the authored separate sessions and process restarts. Live curve sampling has its own scripted session. |
| New, unqualified combination | Prove fixture/reset compatibility in a focused attempt before making it a shared driver. Keep it separate meanwhile. |

Use `desktopMode: "grouped"` for normal selections; `"isolated"` retains the
earlier driver layout. Named course groups organize the report; they are not
arbitrary execution scheduling instructions. Read the frozen plan to see actual
prerequisites and desktop groups. Preserve the script's order in an agent-authored
procedure rather than assuming selection order controls every runner stage.

After an ordinary failure, continue independent cases only after confirming their
baseline or finishing owned cleanup. A batch stops at its first failed gate;
the agent decides whether the next independent case is safe. Unknown stops edits
and needs reconciliation, never replay. The runner's bounded fresh continuation
applies only to eligible checks that never started, after verified cleanup.

## Use each control layer for the right question

- CLI: prepare fixtures and read exact project, media, timing and graph state.
- Qt adapter: identify controls, focus, enabled state, selection and complete
  models. Bundle related observations and reuse the successful readiness sample.
- Presented screenshots, video or audio: verify what the user sees or hears.
- Physical input: exercise the gesture required by the script or a control that
  has no suitable semantic operation. A drag test still drags, even if CLI setup
  is faster.

Read `agent-brief.json` first. Discover shipped recipes with `task`, compile known
procedures with `recipe-check` or `workflow-check`, and inspect each emitted plan
before dispatch. Keep explicit review boundaries; never automatically execute all
workflow segments. Reuse evidence from the same checkpoint rather than requesting
duplicate screenshots. Check completeness and refresh when state changes; fresh
target guards still run before input.

## Keep physical actions and evidence aligned

- After an action that can open a dialog, query the expected dialog or inspect
  the owned key window before the next action. Capture a separate dialog using
  its own target; a main-window image does not establish that no dialog exists.
- Put keyboard chords in `key`, for example `"cmd+z"`. `modifiers` is for pointer
  clicks and drags. Physically focus the timeline and require focus before Undo.
- Verify Undo against the declared domain baseline and review the restored image.
  If it differs, inspect focus and bounded history before deciding what to do;
  do not blindly repeat the shortcut. Save can create its own history entry.
- Keep checkpoints in their declared order. Resolve a format decision before
  retaining the insertion checkpoint; an image from before that decision cannot
  serve as evidence of the committed insertion.
- Use the task's returned run/inspection commands and plan review. Inspect only
  omitted values needed for the assertion, rather than reading every receipt.
  When a wrapper rejects parameters before input, correct its documented shape;
  an Unknown action still requires reconciliation without replay.

## Example: edit, undo, then save and reopen

Suppose the script asks: “Place a video, trim its right edge, undo the trim, add a
video track, save and reopen. Check that the final project is preserved.”

| Case | Fixture and action | Independent outcome and evidence | Group |
| --- | --- | --- | --- |
| Place video | Bind a qualified video source/range; perform the required insertion route | Exact source, track, position and duration; complete timeline plus displayed frame | Edit session |
| Trim and Undo | Use that placed clip; physically trim and then Undo | Left edge/source identity preserved, right edge aligned to expected frames; exact restoration and before/trim/undo captures | Edit session; depends on placement |
| Add video track | Use the restored timeline; invoke the requested UI action | Exactly one new video-track identity; original tracks, clips and settings unchanged; capture | Edit session; depends on restoration |
| Save and reopen | Save the accumulated result, close normally and open in a fresh owned process | Same project identity, assets, tracks, clips and settings from saved state; reopened capture | Persistence phase; depends on verified save |

The script's shared project is intentional here. For unrelated trim and Add Track
regressions, use separate timelines instead. Existing checks may cover parts of
this script, but their own fixtures do not establish this end-to-end state chain.

## Retain a brief the next agent can use

Copy this planning outline into the external task workspace. It is a review
brief, not an executable selection or control-plan format.

```text
Task and original script:
Selected build and preparation/plan identity:
Execution scope, desktop availability and deadline:
Fixture/checkpoint identity, role bindings and source ranges:

For each case:
  ID and script requirement:
  Existing check/recipe or new exploratory scenario:
  Coverage: complete / partial / uncovered; required interaction route:
  Baseline, action and independent oracle:
  Required evidence and collection points:
  Execution group, dependencies and grouping reason:
  Reset/cleanup; conditions that stop or block dependents:

Return:
  Per-case outcome, observed behavior and evidence paths:
  Original versus retest attempts and unresolved actions:
  Build/fixture identity; run/report or session/receipt links:
  Setup, group wall time, public-operation time and agent request gaps:
  Coverage gaps, review questions and focused repro recommendations:
```

Existing courses return the local dashboard/report and retained per-check results.
Exploratory work returns session receipts, readable steps and evidence; it does
not automatically register new dashboard checks or change acceptance. Report
verified observations explicitly, and qualify a reusable definition through
[test authoring](test-evidence.md) before promoting it. Preserve Fail, Blocked,
Unknown and incomplete coverage. Use [investigations](investigations.md) for
deduplication, harness/app triage and focused diagnostic repro, with bug drafts
kept for human confirmation.
