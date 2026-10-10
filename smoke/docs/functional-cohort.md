# Local availability, raw notes and animated tails

These three checks are unaccepted qualification candidates in `smoke-full`
revision 10. The course now selects 180 definitions; accepted-only custom courses
retain their existing 137 accepted definitions. Source/component verification and
execution against the selected package are separate records.

| Check | Actions | Independent observations |
| --- | --- | --- |
| D-MISSING-MEDIA-LIVE | Import an owned source copy, display it, move it aside, restore identical bytes, physically play/pause. | Actual file absence and failed probing; fresh stopped Preview captures; changed/restored timeline paint; preserved placement and source identity; advancing transport. |
| D-RAW-NOTES-PERSIST | Write an unmanaged document, rename the timeline, update the file, physically Undo/Redo, Save and reopen. | Exact latest Unicode/CRLF file bytes; real timeline history state; different process identity; saved timeline and note readback. |
| S-MGFX-TAIL-TIMING | Create a native animated marker; split at one second; trim/extend; Undo/Redo; copy tail; Save/reopen. | Original decoded frames captured before editing; nonstatic known marker; exact head/tail bounds; corresponding frame pixels; saved placements and generation ownership in a new process. |

## Run the cohort

From the `smoke/` command root, save this selection outside Git:

```json
{
  "courseIds": ["smoke-full"],
  "subsetIds": [
    "D-MISSING-MEDIA-LIVE",
    "D-RAW-NOTES-PERSIST",
    "S-MGFX-TAIL-TIMING"
  ],
  "desktopMode": "grouped"
}
```

```sh
node scripts/smoke.mjs plan --app "/selected/Wizard.app" --file "/external/Athanor/cohort-selection.json" --out "/external/Athanor/cohort-plan.json" --server URL
node scripts/smoke.mjs run --plan "/external/Athanor/cohort-plan.json" --operator "Your name" --request-id RETAINED_ID --wait --server URL
```

The resolver adds packaged and desktop connection prerequisites. Media-loss and
raw-note checks deliberately use separate fresh sessions: the first temporarily
removes a source; the second requires its own history and restart. The graphic
check uses the existing background-service session and does not dispatch physical
input. Full-course runs keep their ordinary grouped behavior elsewhere.

The source-loss helper restores its owned file even when a UI assertion fails.
Its copied source completes the selected package's offline ingest before placement,
so missing technical metadata cannot prevent the availability test from starting.
It rejects symlinks, outside-root sources and an occupied offline destination.
If another file appears at the original path or the moved bytes change, it keeps
both files and returns Unknown instead of overwriting them. Inspect retained
receipts; do not replay an uncertain app action.

## What the evidence establishes

Media loss is tested live in the same instrumented editor, without a restart,
relink or cache clear. Timeline-paint comparisons establish a changed/restored
painted region; review the retained image to confirm the semantic missing icon.
The legacy ordinary uninstrumented-build path remains separate.

Raw notes here means externally authored files under the canonical `documents`
root, matching the Core persistence regression. The legacy script instead says
notes on a clip or timeline. That broader annotation path remains unmapped; this
check does not change the original script to make it fit.

The animation references come from the unsplit graphic. A restarted or shifted
tail cannot pass merely because its duration looks right. The fixture positively
checks motion and compares decoded pixels at exact rational frame times. Tail
extension is bounded to the admitted two-second source. Copy uses the application
`timeline.move_clips` route; actual keyboard MGFX clipboard and independently
editable duplicated generation state remain separate checks.

Both persistence checks withhold their preliminary Pass until reopen completes.
Merged evidence keeps the original and reopened artifacts, preserves an earlier
failure and records fresh-process observations in the final result.

## October 10 qualification checkpoint

On official `2026.10.10-ad6fa5e`, run
`79e3b4ee-9815-4c85-a64e-6d0120d0ccaa` passed both connection prerequisites
and raw-note history/Save/fresh-process persistence. The two setup failures were
repaired: omit the unsupported graphic descriptor `range` and ingest the copied
availability source before placement.

Focused repair run `53c2ff3e-c176-4acb-9bf8-c21ea026b0c4` passed its connection
checks but retained two later failures. Animated split/trim/extension and three
Undo states matched independent reference pixels; the first Redo reported
`moved=false` and `can_redo=false`. Copy/reopen were not reached. Source removal
made a fresh probe fail, but eight presented captures retained the same frame.
Review cached-frame/open-decoder assumptions before classifying that as an app
defect. The owned source was restored with identical bytes; recovery/playback
assertions were not reached. Neither candidate has a complete functional Pass.

Per-step receipts are not yet emitted by these drivers. Reports say
`No step record` when unbound recorded actions prevent an honest `Not run`
inference. Use recorded actions, retained state and captures to inspect progress;
that label never supplies a step verdict or changes a check outcome.

## Reuse and maintenance

The controls and filesystem/oracle helpers are shared through the existing
harness, not a separate testing engine. Source files:

- `desktop/functional-cohort-proof.mjs`: guarded source loss, stable placement
  comparisons, raw-note history/reopen and tail timing/pixel assertions.
- `desktop/check-functional-cohort.mjs`: the two foreground check bindings.
- `desktop/check-generated-tail.mjs`: animated source-clock and reopen binding.
- `desktop/check-support.mjs`: merged reopen verdict/evidence handling.

Agent context and the Test guide describe these routes and list their operations.
The maintained nightly assertion map pins their exact definitions as partial
support for MISSING-MEDIA-01, NOTES-UNDO-01, MGFX-01 and MGFX-02. After edits, review
those mappings, update scope hashes and run the framework and scope checks. A new
lead acceptance entry requires the usual reviewed definition decision.
