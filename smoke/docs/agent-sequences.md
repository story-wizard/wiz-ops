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

## Toward a branching planner

The next larger capability is an Athanor-owned engine that executes a reviewed
graph of phases. This is planned work. The current batch commands do not choose
branches or generate plans.

Start with named phases and deterministic branches on complete, typed readbacks.
For example, a verified setting can select an already authored change phase or
a preserve phase. Validate every possible branch against the selected schema
before any input. Keep the first version acyclic, with total action and time
budgets. Record each condition, selected branch, source observation and phase
receipt. Bind returned IDs to the current build, process, project and generation
and keep ordinary fresh input guards. Unexpected observations return to the
agent. A false test assertion or Unknown mutation never silently selects a
recovery branch.

The agent can propose a plan from the test intent, current context and reusable
recipes. The engine validates and executes the accepted plan. Frozen actions,
verifiers and captures remain owned by the check. Before automatic continuation,
prove both sides of every branch, missing/incomplete evidence, stale bindings,
budget exhaustion and interruption after a mutation. A lost response must be
recoverable from receipts without resending app input. Compare completion quality,
missed defects, elapsed time, returned bytes and agent requests on multiple
control families against the existing phase approach.

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
