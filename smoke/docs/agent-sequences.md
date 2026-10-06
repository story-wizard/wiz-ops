# Plan agent sequences

Use a batch for a short phase whose next actions are already known. Keep the
agent's decisions at the points where new information could change the plan.
The live Add Track pilot reduced eight requests to two and averaged 50.6 seconds
versus 13.4 seconds. Both lanes kept eight operations and passed in two rounds.
That result supports fewer request boundaries for known steps. Measure other
workflows separately; see [the comparison notes](control-comparison.md).

## Plan before dispatch

1. Read the session context and the selected check's frozen procedure. Run
   preflight and inspect the current target, project and baseline. Obtain desktop
   availability before preparation or input.
2. Write the expected change and the independent readback that distinguishes it
   from a failed action. Choose the screenshot or other evidence required by the
   check. Preserve every named verification and capture checkpoint.
3. Split the procedure into phases, usually 3–6 steps, up to 8. Within a phase,
   every input, read and expectation must be expressible now. Stop at the first
   result that requires interpretation or supplies an ID for the next phase.
4. Bind selectors, project names, entity IDs and expected values from this
   session. Give physical actions their declared `actionId` when running a
   frozen check. Add `expect` gates before dependent edits and use bounded
   read-only `wait` for a known settling condition.
5. Save the array outside Git and run `batch-check`. Execute it once, inspect
   every returned result and expectation, then decide on the next phase.

| Situation | How to group it |
| --- | --- |
| Known field and expected value | Click, select text, type, commit, wait for the known condition, read back and capture |
| Known button and current canvas | Precondition gate, click, save if required, independent domain readback and capture |
| Result needed to find a new clip, row or window | Finish the read phase; inspect the result and bind a new sequence |
| Dialog or canvas geometry not observed yet | Open it, end the phase, inspect it before further input |
| Asynchronous job with a known terminal condition | Use a bounded wait, then read its complete outcome; a timeout ends the phase |
| Branch, partial model, unexpected modal or uncertain mutation | Stop and inspect the retained state; never guess a continuation or replay an Unknown edit |

## Check, then run

Keep the same external `SMOKE_DATA_DIR` used by the session. From the command
root, copy an example into your external workspace and edit its values:

```sh
node desktop/session.mjs batch-check SESSION.json /absolute/steps.json
node desktop/session.mjs batch SESSION.json /absolute/steps.json
```

`batch-check` reads the session's selected-build schema and validates the whole
array using the execution validator. It returns `status: "Valid"`,
`executed: false`, the step count and zero-based `gateIndexes`. It makes no app
requests or writes. It does not resolve targets or evaluate expected values.
It also lists mutation/capture indexes and advisory `precondition_gate`,
`outcome_gate`, `capture_checkpoint` and `review_checkpoint` suggestions. These
describe places to review; they do not insert actions or establish coverage.
An expired session or stale selector can pass parameter validation and still be
rejected at execution. Every dispatched step retains its ordinary guards.

The executor runs the array in order. Each `expect` compares the tool result
directly, not the CLI envelope's `result` field. It supports `path`, `equals`,
`notEquals`, `length` and `includes`. For example:

```json
{"operation":"call","params":{"operation":"project.get_name"},"expect":{"path":["name"],"equals":"YOUR_OBSERVED_PROJECT_NAME"}}
```

A false expectation is Fail and stops later steps. Completed means all tools
and supplied gates completed; record a test Pass only through its frozen proof
contract. There is no rollback or target reservation in a batch.
Use a new sequence when you need a value returned by the previous one.

## Adapt the examples

- [Add Video Track](../examples/sequences/add-video-track.json) assumes a current
  empty timeline with V1 and A1. Replace the project name and timeline/view IDs,
  and change the expected count if your fixture differs. The count gate catches
  a missing track. For the final assertion, compare the complete timeline with
  its baseline: exactly one new video track, correct identity, preserved
  original tracks and unchanged clips/settings. Inspect that checkpoint before
  a separate Undo phase, then require exact restoration and another capture.
- [Known-term search](../examples/sequences/search-known-term.json) requires the
  observed Name-search controls and a known fixture result. Replace the term
  and expected status with values defined by your fixture and selected build.
  Narrow selectors if the model view is ambiguous. After the batch, inspect the
  query and complete results model, compare the names with the expected set and
  check that domain state was preserved. Page a truncated model before deciding.

Both are editable exploration examples. To use them in a tracked check, adapt
the phases to that check's declared actions, `verify` assertions and captures.
Do not change a frozen procedure merely to fit a batch. Use a window capture
that includes the controls being tested; an empty canvas image cannot explain
which track header was added.

Before dispatch, ask: do I know each target and value, will a failed precondition
stop the dependent input, and where will I review the complete result? If an
answer needs the next tool response, split there. Avoid repeated full snapshots,
fixed sleeps, guessed coordinates and batches filled to eight just to save a
request. Scope related observations together and retain the required evidence.

## Review and reuse

Use `batch SESSION.json /absolute/steps.json --compact` when the next decision
can use the gates and evidence references. The JSON-lines equivalent is
`{"id":"phase-1","compact":true,"steps":[...]}`. The default still returns full
results. Compact replies include a checksum and `receipt.path` pointing to the
complete results, parameters and build/process identity inside the session.
Read required domain values from that file before planning another phase.

Every batch now has a `summary` listing returned steps, gate outcomes, evidence
references and `returnedMutationIndexes`. These indexes use the same app-mutation
classification as admission. They describe operations that returned, including
an edit whose later expectation failed; they do not establish a test Pass.
`uncertainStep` marks an Unknown step whose effect needs reconciliation.

| `summary.continuation.state` | Agent action |
| --- | --- |
| `review_checkpoint` | Review the domain outcome and evidence before the next phase |
| `rebind_target` | Inspect fresh bindings and prior edits; do not repeat the whole batch |
| `inspect_blocker` | Inspect the timeout, admission or environment failure |
| `inspect_failure` | Review the failed assertion with the earlier completed actions |
| `reconcile_unknown` | Stop editing and reconcile the named uncertain action |
| `retain_receipt` | Save the full returned response and inspect the storage problem |

`automatic` is false for every continuation. Storage failure returns the full
known outcome and `retentionError`, preserving its status; it never reruns an
operation or turns a known Completed result into Unknown. Per-tool journals
remain separate from the optional compact batch receipt.

Inspect `status`, `results`, each `expectation`, and `failure`/`stoppedAt` when
present. Earlier steps may have changed the project. On Unknown, stop editing
and reconcile that specific action from retained evidence. A lost response is
not permission to resend a batch. Preserve the original attempt before a retest.

Reusable JSON describes intent; session-bound IDs and baseline expectations must
be rebound on every use. Keep procedures in source and runtime bindings/results
outside Git. Bots may use the existing [JSON-lines connection](computer-use-agent.md#reduce-trips-back-to-the-agent)
for sequential requests. Measure total elapsed time, request count, tool time,
between-request time and verified outcomes separately.

## Run an authored branching plan

Use a control plan when every possible action and target can be authored now.
The agent decides the intent and reviews the paths; Athanor chooses between the
declared paths from exact readback values. Each named phase runs through the
existing batch executor and every operation retains ordinary admission, deadline,
ownership, uncertainty and fresh input guards.

```sh
node desktop/session.mjs plan-check SESSION.json /absolute/control-plan.json
node desktop/session.mjs plan SESSION.json /absolute/control-plan.json --request-id KNOWN_ID --compact
```

The JSON-lines equivalent is `{"id":"unique-id","plan":{...},"compact":true}`.
`plan-check` validates all paths without app requests or writes and includes the
same planning suggestions as `batch-check`. A control plan is distinct from the
prepared-build plan used by `start --plan`.

```json
{
  "format": "athanor-agent-plan/v1",
  "start": "inspect-query",
  "maxDurationMs": 30000,
  "phases": [
    {
      "id": "inspect-query",
      "steps": [{"operation":"observe","params":{"selector":{"id":"CURRENT_SEARCH_ID"}},"expect":{"path":["matchCount"],"equals":1}}],
      "next": {"step":0,"path":["matches",0,"text"],"cases":[{"equals":"","phase":"type-query"},{"equals":"pattern_24","phase":null}]}
    },
    {
      "id": "type-query",
      "steps": [{"operation":"physical","params":{"command":"click","target":{"id":"CURRENT_SEARCH_ID"}}}],
      "next": null
    }
  ]
}
```

This short example illustrates routing only. Adapt the complete
[find-media recipe](../examples/sequences/find-media-plan.json) for a search:
bind the current search field, media view, known query and expected completion
status, and select Name mode during fixture preparation. An empty query enters
it; the exact requested query proceeds to the results checkpoint. Any other
query stops for review. Inspect the complete result model and bind the returned
row before a new insertion phase. Preserve the independent project baseline,
timeline assertions and post-insert/Undo captures.

`next` is another phase ID, `null` for a review checkpoint, or a branch object.
A branch names the final step in that phase, a property/index `path`, and 1–4
distinct `equals` values with their destination phase (or `null`). The source
must be a full read-only observe/find/model/model_value/call/native operation.
Missing fields, delta observations, partial pages and unknown values are Blocked.
Gates remain test assertions: Fail stops, rather than selecting another branch.
Unknown stops without recovery or replay. Rejected bindings return to the agent
for inspection, not another route through the plan.

Limits are eight reachable named phases, eight steps per phase, 32 declared
steps across all paths and 64 KiB of input. Cycles and unreachable phases are
rejected before input. `maxDurationMs` is 1–120000, default 120000. It is a
dispatch budget checked before every operation and continuation. A running
operation keeps its own timeout and returns before the budget stops further work;
the engine never races cancellation against an uncertain mutation.

## Recover a plan response

Choose `--request-id KNOWN_ID` before dispatch. JSON-lines plans use their request
`id`. Athanor writes intent before every action, retains the returned prefix and
writes a checksummed final receipt. A duplicate ID is rejected before dispatch,
including after Unknown. It is an inspection key, not an app-mutation retry key.

```sh
node desktop/session.mjs plan-inspect SESSION.json KNOWN_ID
```

The read-only JSON-lines equivalent is
`{"id":"inspect-1","operation":"plan-inspect","params":{"requestId":"KNOWN_ID"}}`.
Inspection returns completed phases, active action, returned prefix, bindings and
refresh reads. It verifies final receipt bytes and reports whether the saved
build/process/project identity still matches the current session. Historical
results remain inspectable after rebinding. Retained Running progress is shown
as Unsettled: it may still be active or interrupted. Inspect tool journals and reconcile possible effects. There is
no resume or automatic replay. Storage failure stops further work and returns
known results for retention.

## Compile a reusable recipe

The editable recipes in `examples/recipes/` cover media search, Add Video
Track, Inspector editing and Undo. A recipe declares typed parameters and uses
whole JSON values such as `{"$param":"timelineId"}`. Supported types are string,
number, integer, boolean, object and array. No script execution or string
interpolation is involved. Keep this run's values outside Git.

```sh
node desktop/session.mjs recipe-check SESSION.json RECIPE.json VALUES.json > /external/compiled.json
```

This returns `recipeHash`, `valuesHash`, the compiled `plan`, and all-path
parameter/schema validation without app requests or writes. Extract `plan` into
an external file, inspect it, then use `plan-check` and `plan` as above. The
JSON-lines connection also accepts `recipe-check` with `recipe` and `values`.
Add Video Track demonstrates exporting the uniquely observed button ID and
refreshing that selector before the click. Examples end at review checkpoints. Compare complete domain identity/state and
required pixels; their exploratory gates do not replace a frozen Pass contract.

## Carry an observed entity into a later phase

A plan may declare up to eight `bindings`. Each names a prior phase's gated
read-only step, a unique array and a string ID or nonnegative integer model
offset from its sole element:

```json
{"button":{"phase":"find","step":0,"uniquePath":["matches"],"path":["matches",0,"id"],"type":"string"}}
```

Use `{"$binding":"button"}` as the whole value of a parameter ID field, for
example `params.target.id`. Integer bindings are limited to model `offset`.
Every route must pass the binding source before using it. The validator checks
all paths with typed placeholders, then validates resolved parameters again
before the phase executes. Before each use it rereads the exact literal source,
requires its gate and a complete unique value, and compares with the retained
identity. Missing, partial, ambiguous, changed or wrong-type data blocks input.
Refreshes count toward the dispatch budget and remain in the receipt.

Ordinary ownership, uncertainty, deadline and fresh physical-target checks still
run on every input. Bindings do not reserve targets or supply geometry, input
text, commands or new-dialog decisions. Keep those as agent review checkpoints.
Automatic plan generation and semantic routing remain deferred.

An optional semantic decision source could rank compatible recipes or propose
an investigation route. TypeSafe Jev is a candidate for that role, rather than
the executor: its current interface evaluates text/JSON and returns typed
choices/probabilities, with no image input or plan generation. See
[TypeSafe's System One documentation](https://docs.typesafe.ai/concepts/system-one).
Use code for identity, permissions, exact assertions, completeness and dispatch.
Keep ambiguous semantic recommendations reviewable, include abstention and fall
back to the agent. Evaluate a provider on sanitized held-out cases before using
its recommendation for unattended routing. No Jev integration or provider
request is included in this slice.

## Choose plans where they remove a handoff

Use a recipe to combine known phases or carry a uniquely observed ID into a
later phase. A phase already sent as one batch does not become faster merely
because it is wrapped in a plan. Keep physical steps, independent assertions,
captures and review checkpoints when comparing approaches.

Read the selected build's result schema before writing an assertion. For
example, the qualified package's `timeline.create` returns a track `kind`,
while `timeline.inspect` identifies the inspected track through its `address`.
Require exactly one new video-track identity and preserve the original tracks,
clips and timeline settings. A count alone cannot distinguish adding the wrong
kind of track or disturbing existing content.

Count physical input from `native-input.jsonl` entries whose status is
`Dispatched`. The same journal also includes observations and screenshots. An
`Unknown` input receipt may represent dispatched events and needs separate reconciliation;
zero successful dispatches cannot establish that no input occurred.
After a scorer error, inspect the retained results and correct the scorer;
do not repeat a completed edit to obtain another receipt. Keep that correction
with the attempt. Exclude recovery intervals from matched speed claims.

Use the same visual review checkpoints in both timing lanes. Record request
execution and time between requests separately, and group tool durations into
physical input, state reads, waits and captures. Between-request time includes
agent reasoning, transport and orchestration; it is not a model-inference timer.
Keep run data and evidence in the external workspace.

## Compose recipes before dispatch

`workflow-check` is a small planner for an ordered list of authored recipes.
It validates every recipe against the selected build, namespaces phase and
binding IDs, and combines compatible parts into ordinary control plans. It
returns recipe/value hashes, phase origins, request counts and review stops;
it makes no app requests or writes. Use it from the CLI or JSON-lines connection:

```sh
node desktop/session.mjs workflow-check SESSION.json /external/workflow.json > /external/compiled-workflow.json
```

```json
{"id":"compile-workflow","operation":"workflow-check","params":{"workflow":{"format":"athanor-agent-workflow/v1","parts":[{"id":"identity","recipe":{},"values":{}},{"id":"edit","recipe":{},"values":{}}]}}}
```

Replace the empty recipe/value objects with the complete source recipe and this
session's typed values. There are no file includes or automatic downloads.
For example, compose `project-identity.json`, `add-video-track.json` and
`timeline-undo.json`. The identity prerequisite joins Add Track; Add Track's
review stop keeps Undo in a second plan. Review the complete added-track state
and screenshot before deciding to dispatch that second plan. The original
Add Track, search and Inspector examples keep their review boundaries.

A recipe can explicitly declare `continueAfter: ["terminal-phase-id"]`.
This is an authored decision that the next recipe is known and does not need
interpretation at that exit. Its last non-capture step must be a gated full
read-only observation; only captures may follow it. It does not certify that
the assertion is sufficient. Write the independent oracle appropriate to the
test. Geometry, newly opened dialogs, incomplete data and visual interpretation
remain review stops. Every undeclared exit defaults to review. If any possible
exit needs review, the planner does not attach another recipe to that part.

The result's `segments` contain separate `plan` objects and `reviewAfter`.
Extract and inspect one plan, then execute it once with the usual known request
ID. Never loop over all segments automatically. `recipeRequests`, `planRequests`
and `savedRequests` count potential dispatch requests, excluding validation,
setup and review. They are not timing predictions.

Before a joined continuation, the executor also rejects incomplete readbacks,
even if their supplied value gate matched. The generated `continuationRead`
index points to that gated read; following captures remain intact.

Each segment keeps the existing eight-phase, 32-step, eight-binding and 64 KiB
limits. If joining would exceed a limit, a new segment begins at a review stop.
Its dispatch budget is the smallest budget among its parts, so composition does
not extend an existing deadline. Bindings stay local to their recipe, are
namespaced and retain ordinary unique-source refreshes before input. Values
cannot refer to another part's bindings. Independent gates, captures, branches,
action IDs and literal target IDs remain intact. Fail, Blocked and Unknown stop
through the existing executor; there is no second executor or recovery loop.

Planning is deterministic composition of caller-selected recipes. Freeform
intent selection and semantic geometry routing remain agent work.

## Use the compact entry first

Read `agent-brief.json`, then use `tool SESSION.json task '{}'` to discover the
shipped recipes. `task '{"recipe":"add-video-track"}'` binds the existing
recipe from complete live project/timeline/control observations and retains a
reviewable plan, values and known request ID without input. Other recipes take
explicit `values`. This avoids reading every guide or rebuilding an existing
plan. Review the emitted plan and execute it once; every existing review and
uncertainty boundary remains. See the computer-use guide for compact single-tool
receipts and the narrow saved-Spell text-commit declaration.

`spell-input-edit` is a saved exposed string-input recipe. Supply its observed
instance/input IDs, focused-capable field and Inspector capture target, raw
baseline graph, replacement text and exact result path. It keeps the graph gate,
real click/select/type, declared saved-input commit, value gate, and capture in
one reviewed phase. It ends before Reset, Undo or a new run dialog. Missing
selected-build support blocks compilation; explicit values are required.


## Run a QA task with the least necessary interaction

Choose tools from the behavior under test. Use CLI state for exact project,
media, timing and graph questions; use Qt for control identity, enabled/focus
state and models. Use presented images for appearance and visual assertions.
Use physical input when the gesture is the tested behavior, or the application
has no suitable semantic operation. A frozen physical check keeps its required
route even when a direct operation would be faster.

Start with `agent-brief.json` and run `preflight` from the execution context that
will send commands. A prepared package does not establish process-inspection
permission for a different shell or agent. Repair a denied context before input.
Use the returned workspace-bound commands; do not reconstruct paths from memory.

Observe related controls in one `observe` selector bundle. With `details:true`,
that observation includes exposed model rows, selection and item rectangles.
Read `inspectionIncomplete`, `truncated` and model limits; page large models.
Targets carry their owning window, geometry and visible/click regions; the
observation carries process identity, generation and observation ID. Physical
points are local to the target widget. Model rectangles are local to the returned
viewport. These observations do not reserve targets; input still refreshes them.

For a checkbox and dependent field, compile `enable-checkbox` with two observed
selectors. It skips the click if already checked, otherwise physically clicks,
then waits for checked and enabled together before returning both controls from
the successful inspection. It cannot combine readiness from different moments.
It does not type, guess a dialog or infer a Pass. Use `timeline-undo-save` when the
procedure requires Undo followed by Save; `timeline-undo` retains its old behavior.

Compact phase replies include exact gate comparisons, bounded readback values,
per-category public-operation timings and capture references. `encoding:full`
means the value is returned intact. A `summary` has `completeResult:false` and
explicit omitted fields; retrieve only the omitted values needed from the full
checksummed receipt. A true gate proves its declared comparison, not an entire
functional test. Add Track's exploratory count gate still needs the independent
identity/preservation checks or the maintained frozen proof contract.

Review the existing `summary.evidence` image at each required checkpoint. A
report and a benchmark may reference that same artifact rather than request a
second screenshot. Preserve its process/generation, target, revision, capture
method and hash. Imported images and old frames cannot replace required fresh
proof captures. Revision metadata alone cannot establish current visual state:
playback, asynchronous jobs and outside input can change the screen. Refresh
when the next action depends on that change; fresh target guards always remain.

Batch a known action, readiness wait, exact readback and required capture until
the next decision. Stop at new IDs, geometry, dialogs or uncertain outcomes.
A rejected geometry binding returns its expected and observed target with
`dispatch:not_started` for that action. Earlier steps may already have changed
the project; keep their receipts. Unknown always requires reconciliation.

Measure public-operation time separately from agent request gaps. Qt bridge and
native-driver journals now include start/duration fields, nested inside public
operations. Do not add those nested measurements to the public total. Keep
readiness, discovery, execution, visual review and recovery visible in trials.

`media-search-state` sets the query through Qt, waits for the query text, result
view and expected completion label together, then returns that same observation's
field, result model/selection/geometry and status. Both recipes use `wait.conditions`
to eliminate the separate final inspection. Existing single-condition waits keep
their target-shaped reply. Bundled replies keep observation truncation flags;
they are readiness observations, not a functional-test verdict. Plan branching
and binding sources retain their existing supported-operation rules.
Use it for result-state checks or setup in an observed Name-mode search. It uses
no physical input or capture. Use `media-search` to test the physical entry path,
and capture separately when appearance is part of the requirement. Both recipes
still need exact expected-result and complete-model review; a status label alone
cannot prove the right asset was found.
