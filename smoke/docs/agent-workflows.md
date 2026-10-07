# Review and build agent workflows

Start from the exploratory session brief. Use CLI for exact application state,
Qt for controls and models, physical input for the gesture being tested, and
presented captures for visual review. Declare expected outcomes before editing.

## Review a plan

`plan-check` returns `review`; a prepared `task` returns `reviewPlan`. They describe
every action and expectation, exact branches, binding sources, review exits and
stop conditions. `planHash` identifies the compiled object. Large baseline values
are represented by checksums and sizes; they remain in the retained full plan.
Read them if the fixture or their meaning is not established. Smaller values stay
literal. The review sends no application input and does not reserve targets.

Use the reviewed plan once with its known request ID. Inspect its retained result
after a lost response. Never replay uncertain input. Compare assertions and
captures before declaring the functional result.

## Inspector example

Select a known numeric node in the clip graph and open its Inspector. Ask:

```json
{"question":"inspector-parameter","graphScope":{"timeline_id":"TIMELINE_ID","clip_id":"CLIP_ID"},"nodeId":"NODE_ID","parameter":"radius","label":"Radius"}
```

The answer binds the displayed clip-owner graph, its sole selected node, the
exact Inspector mutation-route row, enabled slider, styled thumb and canvas.
Graph, Inspector and timeline may occupy separate windows; control and preview
captures remain separate. It includes the
independent graph value. Wrong selection, incomplete scene items, ambiguous rows
and overlays are Blocked. An unpositioned physical click on an Inspector slider
focuses its freshly observed thumb; explicit coordinates still have their usual
meaning. Verify that focusing preserved the value before pressing Right.

`task` with `recipe:"inspector-edit-undo"` and those four declared values prepares
a known increase-and-Undo procedure. It retains independent graph/timeline
baselines, verifies only the numeric parameter increased, captures the edit,
physically focuses the same clip canvas, undoes and verifies exact restoration.
Before/changed/restored retain both Inspector and main-window captures. Use
`query` with `question:"inspector-change"`, the same graphScope/nodeId/parameter,
`baselineGraph`, `baselineTimeline` and `state:"changed"` or `"restored"` to reuse
that oracle independently. Changed means an increase, not an arbitrary edit.
Preview captures still require visual review; graph readback does not prove pixels.

## Timeline example without a completed recipe

```json
{"question":"timeline-clip","timelineId":"TIMELINE_ID","clipId":"CLIP_ID"}
```

The answer combines the complete CLI clip/timeline state with the uniquely
matching displayed canvas, owning window, current clip rectangle and body/edge
hit points. Coordinates are canvas-local. It rejects a wrong visible timeline,
ambiguous canvas, partial clip IDs and overlays. Independent transports may
observe different instants; this is not an atomic snapshot or a target reservation.

Build short phases from the requested functional script. For a right-edge trim,
physical drag can use the observed canvas, `clipId`, `part:"right-edge"` and
`toTimelinePoint:{"trackIndex":0,"timeSeconds":3}` on a qualified V1 fixture.
Both source edge and destination are resolved afresh before dispatch. Check exact
asset identity, source/timeline ranges, frame alignment and unrelated state after
the drag. Split at unrecognised dialogs or interpretation. Physically focus the
canvas only if it is not already focused. `timeline-clip.focus` reports canvas
focus and owning key window. Keep established focus; use `requireFocus:true`
on Undo/Redo. A body click may change selection. Save can materialize defaults
as a separate history commit: settle Save during fixture setup before freezing
the baseline, and verify the result after each Undo instead of repeating keys.
Save where the script requires it, and retain separate changed/restored/redone
captures. An observed edge or dispatched drag does not establish success.

## Measure the agent, not only the tool

Retain discovery, planning/review, tool execution, application waits and evidence
review time separately where observable. Report actor wall time and uncached
input/output tokens, not sums of overlapping nested timers. Compare the same
package and equivalent new fixtures with fresh sequential actors. Include at
least one functional brief without a completed recipe. Preserve failures and
protocol deviations; do not subtract inconvenient recovery or recapture time.

## Toolkit step shapes

Use `schema {}` to list toolkit names and `schema {"tool":"physical"}` for its
fields and example. `schema {"operation":"timeline.inspect"}` still returns
the selected build's application schema. A plan step is
`{"operation":"physical","params":{"command":"drag",...}}`, not an operation
named `drag`. Validation failures return the affected phase/step and toolkit
interface before any input. This is local metadata, with no app request.

## Right-trim outcome

`query` with `question:"timeline-trim"`, `timelineId`, `clipId`, complete
`baseline`, desired `endSeconds` and `state:"changed"` or `"restored"` combines
the displayed canvas/focus with independent domain readback. The narrow oracle
supports one timed same-clock speed-1 clip. Ordinary trim retains the timeline
extent and fills the vacated interval with a gap; ripple trim is different.
Source/track/clip identities, exact ranges, clock, links, other fields and source
integrity remain checked. Both `exact` and valid `carrier` source projections
are accepted; unavailable/rejected timing and diagnostic errors are rejected.
Redo must reproduce the verified changed state after verified restoration.

## Ideas borrowed from Holo4

Use one small observation to answer the immediate question, typed actions,
short validated procedures and explicit failure feedback. Existing Qt/CLI reads
supply these without another model call. Reuse a retained image for the same
review checkpoint; use a fresh capture when the question concerns changed pixels.
A visual localizer remains a separate deferred experiment. Its proposed point
would still need current process/window/content guards and independent readback.
No Holo4 model is installed or required by this workflow.

## Save and history

Save can create an empty history commit. Settling fixture Save before baseline
removes default-metadata churn but does not stop later Saves from adding history.
An Undo may therefore undo Save before undoing the edit. A frozen check requiring
one Undo retains its result; do not silently substitute a different procedure.

For a functional script whose goal is restoration, ask `query` with
`question:"timeline-history"`, `timelineId` and the baseline's exact
`baselineRevision`. It reads at most eight first-parent steps of the owned .wiz,
returns head/parent identities, operation labels, empty commits, completeness and
`stepsRemaining`, and rejects changed/shared history. It sends no input. Plan
only known reviewed steps. After each physical Undo, gate the observed history
head/remaining count and domain state before another input. An unexpected step,
merge, missing baseline, failed focus or Unknown stops for review. Once the
baseline is restored, Redo the intended edit and verify its exact state; Save's
empty history step need not be mistaken for the edit. Do not automatically consume
an arbitrary number of Undo steps or declare restoration from a shortcut receipt.

## Start small and read the decision

`schema {}` includes an executable read-only `planExample`. Replace its observed
project name, validate it with `plan-check`, and adapt it with the current task's
steps. Expectations use array paths (`["matched"]`), never dotted strings. The
interface and validation diagnostics advertise the same shape. Prefer an existing
`task` recipe for known procedures; this scaffold does not plan an unfamiliar UI.

Compact tool replies retain results over 2 KiB and prioritize status, outcome,
expected/actual values, targets, focus, identity and completeness flags. Whole
values are included or omitted; lists are never shortened to look complete. Read
`encoding`, `completeResult` and `omitted`; use the checksummed receipt for omitted
state. Plan gates still evaluate the full internal result. Read a retained image
once for its checkpoint and use that same artifact in reports and scoring. A
changed screen or a different declared checkpoint needs its own capture.
