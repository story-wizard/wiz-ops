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
contract. There is no rollback, target reservation or variable substitution.
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
node desktop/session.mjs plan SESSION.json /absolute/control-plan.json --compact
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

The plan records its parameters, build/process identity, completed phase results,
branch values and selected path. `progress` is written before each phase and
after its result/decision; the final `receipt.path` is checksummed. Compact replies
keep phase summaries and evidence references; full results remain in the receipt.
On interruption, inspect the active phase in progress and the ordinary per-tool
journals. Progress does not mean every input in that phase finished. A request ID
still provides correlation only. Never resend a lost plan or replay its prefix.
Storage failure stops further phases and returns the known results for retention.

No variable substitution, automatic target rebinding or plan generation is
included. End at a review checkpoint when an ID, geometry, modal or decision
needs fresh interpretation. Compare authored plans with agent-directed batches
on several control families before expanding unattended execution.

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
