# Human checkpoints

A course can end with `playback-persistence-v1`: prepare a small synthetic project, leave the editor ready for a tester, retain their observation, then verify that desktop Save and process restart preserves the prepared timelines. This is the first WIZ-511 continuation slice, with local reporting for WIZ-512 and agent context for WIZ-510/515.

## Run it

Start the local service in your external `SMOKE_DATA_DIR`. Use the explicit instrumented runtime described in [agent courses](agent-courses.md).

```sh
node scripts/smoke.mjs course save --file examples/playback-checkpoint.json
node scripts/smoke.mjs plan --app /Applications/Wizard.app --course playback-checkpoint --runtime /path/to/runtime.json --out /tmp/checkpoint-plan.json
node scripts/smoke.mjs run --plan /tmp/checkpoint-plan.json --operator "Developer name" --request-id playback-pilot-001 --wait
node scripts/smoke.mjs checkpoints
node scripts/smoke.mjs checkpoint --run RUN_ID
```

Alternatively, add `--checkpoint playback-persistence-v1` to a plan selecting accepted checks. The plan freezes the checkpoint instructions and adds the desktop-runtime prerequisite. The current checkpoint runs after the automated checks, in its own Fresh project; it does not restore a failing check's exact project or interleave human steps between individual checks.

At the pause, the CLI returns exit 4, `complete: false` and `needsHuman: true`. Open **Runs → the run** in the local dashboard. It contains the test steps, **Open prepared project**, **Capture diagnostics**, the observation form and **Continue verification**. The original automated results remain read-only. A paused course reserves this workspace's runner until continued or ended.

## The actual human check

The prepared Golden project has Main and Secondary timelines. Main includes known video and synthetic audio. Play the first four seconds, listen and observe, then stop. Record what happened, Pass/Fail/Blocked and actual hands-on seconds. Keep timeline structure unchanged: this checkpoint tests playback judgment and persistence, not arbitrary edits. It does not measure calibrated audiovisual latency.

An agent may read the retained parcel and Oz prompt, explain the steps and transcribe the tester's finding. It must attribute that finding to the tester and use `recordedVia: "agent-transcription"`. A script cannot invent a human Pass. Local attribution is a declaration, not authenticated multi-user identity.

For CLI recording, create a request file using the current checkpoint revision:

```json
{
  "revision": 1,
  "requestId": "tester-observation-001",
  "operator": "Actual tester name",
  "outcome": "Blocked",
  "note": "Replace this with the tester's actual observation.",
  "handsOnSeconds": 0,
  "recordedVia": "agent-transcription"
}
```

Do not submit that example as a finding. Supply the real values, then run:

```sh
node scripts/smoke.mjs checkpoint --run RUN_ID --action observe --file /tmp/observation.json
```

Observation history is append-only. Any human Fail keeps the course failed even if subsequent structural verification passes. Blocked cannot continue until the tester records a real Pass or Fail. Recording a finding does not itself transfer app control.

## Continue or investigate

Read the checkpoint again. Create an action file with its current `revision` and a unique, stable `requestId`:

```json
{"revision": 2, "requestId": "continue-playback-001"}
```

```sh
node scripts/smoke.mjs checkpoint --run RUN_ID --action resume --file /tmp/continue.json
node scripts/smoke.mjs wait --run RUN_ID
node scripts/smoke.mjs report --run RUN_ID
```

Continue only after the tester has finished: it transfers control, pauses playback, checks both timelines against their baseline, saves and quits, reopens the same project in a new process, checks again, captures evidence and stops the owned app. It never replays the completed automated course. The adapter invokes the native Save action, waits for the saved revision, then stops the owned process with SIGTERM. This does not exercise the File → Quit menu or an unsaved-changes dialog; those need separate checks.

The same request shape supports `open`, `capture` and `cancel`. Open focuses the owned project or reopens its saved state if its process exited. Capture collects a bounded snapshot. Cancel saves/stops a verified owned session and ends the checkpoint without claiming verification. A changed project/process binding blocks action rather than targeting another editor. An interrupted action is never replayed automatically; inspect its evidence before ending the checkpoint or starting a fresh run.

Reuse a request ID only to recover the same request after a lost response. The service returns the retained outcome without repeating the action; a changed body with that ID is rejected. Revisions reject stale competing requests. A waiting checkpoint survives service restart. Restart the service with the same source and external workspace, then query `checkpoints`; no setup is rerun. Changed source, package, runtime or fixtures block continuation.

## Evidence and limits

SQLite retains checkpoint state and observation history; `checkpoint.json` mirrors it in the run directory. The run retains the frozen instructions, project/session identity, baseline, operations, agent parcel, Oz prompt, before/after state and control snapshots, screenshots and bounded app logs. Reports show automated results, human findings and continuation separately. Waiting reports are explicitly snapshots of an incomplete course.

Logs have basic key/token masking, not a guarantee of safe external sharing. Everything stays in the external local workspace. Continuous polling, performance profiling, bug publication, remote assignment, arbitrary step ordering and multi-user permissions are deferred. Story-user, Large and NAS remain future fixtures.

The instrumented desktop runtime is recorded separately from the selected packaged engine. This checkpoint does not qualify the shipping GUI or approve the whole Logan checklist. A portable kit containing a checkpoint pauses too; its temporary service then exits. Restart its retained workspace service with the kit's external data directory to continue locally. Second-machine execution still needs separate qualification.
