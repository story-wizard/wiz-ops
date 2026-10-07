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
canvas before Undo/Redo; use `requireFocus:true` on those keyboard actions.
Save where the script requires it, and retain separate changed/restored/redone
captures. An observed edge or dispatched drag does not establish success.

## Measure the agent, not only the tool

Retain discovery, planning/review, tool execution, application waits and evidence
review time separately where observable. Report actor wall time and uncached
input/output tokens, not sums of overlapping nested timers. Compare the same
package and equivalent new fixtures with fresh sequential actors. Include at
least one functional brief without a completed recipe. Preserve failures and
protocol deviations; do not subtract inconvenient recovery or recapture time.
