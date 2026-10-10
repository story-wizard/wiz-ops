# Task packets and learning from runs

Start with a task packet when a functional script needs a procedure you have not
planned yet. It brings current state, request shapes and verification guidance
together. Known procedures still use `task` with `recipe`.

## Ordinary right trim

Discover the interface without opening Wizard:

```sh
node desktop/session.mjs toolkit task
```

Once the user has made the desktop available and the selected-build session is
ready, use its command root and external workspace:

```sh
node desktop/session.mjs tool SESSION.json task '{"intent":"timeline-trim","values":{"timelineId":"CURRENT_TIMELINE_ID","clipId":"CURRENT_CLIP_ID","endSeconds":4}}'
```

The persistent connection accepts the same request:

```json
{"id":"discover-trim","operation":"task","params":{"intent":"timeline-trim","values":{"timelineId":"CURRENT_TIMELINE_ID","clipId":"CURRENT_CLIP_ID","endSeconds":4}},"compact":true}
```

Supply real observed IDs and the script's requested right edge. The packet uses
one `timeline-clip` query with `includeBaseline:true`. That query combines CLI
timeline state, Qt controls and clip geometry. The baseline comes from the same
timeline read; the UI and domain transports do not form an atomic snapshot.
The ordinary query omits that large baseline unless requested.

The packet contains the complete baseline, its hash, the selected schema hash,
focus state, targets, exact request shapes and suggested Before, Changed,
Restored, Redone and Saved phases. It returns `status: "Observed"` and sends no
input. It does not compile an arbitrary functional script. This first packet
requires a single video clip at normal speed with matching source/timeline frame
rates and an interior right edge on an exact frame boundary. Ripple, cross-rate,
multiclip and audio-only trims need their own procedures.

Read `encoding` and `omitted` in compact replies. Missing fields remain in the
checksummed receipt. Choose only the phases required by the script, assign
distinct capture titles and validate the assembled batches or plan before input.
Required physical gestures stay physical. Focus-sensitive Undo/Redo uses
`requireFocus:true`; if focus is absent, inspect, use the packet's physical focus
request and verify unchanged state before continuing. An unexpected state or
Unknown ends that sequence for inspection.

Settle fixture Save before the baseline. Do not insert Save before a script that
requires exactly one Undo. `history`, when available, provides a bounded read of
history from the baseline revision. Review it rather than blindly consuming
commits. The Saved phase checks timeline state after Save; add the script's
independent saved-ref or fresh-process persistence assertion before judging Save.

## Preserve a useful procedure

The packet's `reuse.recipeRequest` supplies freshly bound parameters for
`timeline-right-trim`. Send that object to `task`, review the compiled plan and
dispatch its returned `runRequest` once. This recipe groups preflight, baseline
verification, Before capture, the physical trim, exact changed-state verification
and After capture. Its terminal exit requires review before Undo or another edit.
It is an exploration example, outside canonical course membership.

Keep the parameterized recipe in source. Keep bound values, plans, reports and
learning notes in the external workspace. The next run must gather a new packet
and compile against its selected schema; do not reuse an old packet or plan.
Physical input still refreshes targets and retains the normal ownership guards.

## Learn from a retained plan

After execution, inspect the plan's outcome and required images. Use its full
`receipt.path` and SHA-256 to export a review note without a live session:

```sh
node desktop/session.mjs learn RECEIPT.json --sha256 RECEIPT_SHA256
```

The command verifies the supplied checksum, reads one terminal plan receipt and
prints `athanor-procedure-learning/v1`. It makes no app calls or file writes.
Redirect its output to your external workspace if you want to keep it. The note
includes execution outcome, elapsed/public-operation timings, gates, retained
captures and the exercised branch index. It preserves Fail, Blocked and Unknown.
Old receipts without a schema hash retain an explicit null value.

Raw parameters, project names, paths, typed text, widget IDs, coordinates and
branch values stay in the original receipt. The note has no executable plan and
always requires review. Its checksum checks byte identity; it does not establish
the correctness of the run. Review the original assertions and images before
using the note to change a recipe.

For each useful finding:

1. Identify the missing instruction, unnecessary discovery read, state-dependent
   branch or incorrect expectation from the original evidence.
2. Edit the relevant typed recipe or task guidance. Preserve independent assertions,
   required captures, script order and review exits. Test every new branch,
   including rejection of unknown values.
3. Run `recipe-check` or `workflow-check` with fresh values and the selected schema,
   then the framework checks. Qualify changed behavior on the designated build
   when the desktop is available.
4. Obtain testing-lead review before changing an accepted test or canonical course.

A successful trace observes one path, not every declared branch. Failed and
Unknown attempts remain useful evidence, but cannot supply permission to retry
input. Timing records describe their own boundaries; nested Qt/native durations
overlap public-operation time and must not be added to it.

## What to reuse

| Reuse after review | Refresh at execution |
| --- | --- |
| Parameterized actions, assertions and evidence requirements | Fixture baseline and semantic IDs |
| Explicit branches and their verification | Current branch value and complete observations |
| Command shapes qualified against a contract | Selected-build compatibility |
| Historical durations and failure explanations | Process/generation, focus and geometry |

Model prompt caching, live UI state and parameterized procedure reuse are separate
mechanisms. This slice preserves procedures and evidence for review. It does not
automatically train an agent, promote recipes or replay successful runs.
