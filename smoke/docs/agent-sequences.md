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

Inspect `status`, `results`, each `expectation`, and `failure`/`stoppedAt` when
present. Earlier steps may have changed the project. On Unknown, stop editing
and reconcile that specific action from retained evidence. A lost response is
not permission to resend a batch. Preserve the original attempt before a retest.

Reusable JSON describes intent; session-bound IDs and baseline expectations must
be rebound on every use. Keep procedures in source and runtime bindings/results
outside Git. Bots may use the existing [JSON-lines connection](computer-use-agent.md#reduce-trips-back-to-the-agent)
for sequential requests. Measure total elapsed time, request count, tool time,
between-request time and verified outcomes separately.
