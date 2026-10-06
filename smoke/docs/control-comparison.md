# Control harness baseline

Use the matched comparison to check improvements to the agent tools. It covers
Add Video Track with Undo, right-edge trim with Undo/Redo, and a
positive/missing/restored filename search. Both actors get the same packaged
build, synthetic media, native input transport and safety guards.

## Keep the original

The first baseline is `athanor-control-comparison-2026-10-03`. Keep its exported
folder outside Git. It includes the protocol, build and source hashes, both
rounds of logs, screenshots, independent checkpoint observations and scores.
The maintained protocol pins that export and its file manifest by hash.

From `smoke/`, or `workspace/` in a bundle:

```sh
node scripts/control-comparison.mjs verify-baseline /absolute/baseline/export
node scripts/control-comparison.mjs protocol
```

Verification reads every retained file. It does not launch Wizard or rewrite
the baseline. Put each subsequent attempt in a new external directory.

## Repeat it

1. Prepare the selected build and start an owned session using
   [computer-use testing](computer-use-agent.md). Use a fresh disposable app copy
   per round and record package, CLI, adapter, driver and source hashes.
2. Alternate order: Bare then Athanor in round 1; Athanor then Bare in round 2.
   Prepare a separate equivalent timeline before each task.
3. Give both actors the same task and 180-second task budget. Measure common
   setup, launch and independent scoring separately from actor time.
4. Bare receives screenshots, native window metadata and physical input only.
   Athanor can also read Qt controls and application state. Tested edits stay
   physical in both lanes. Seal scorer observations from Bare until both lanes
   finish the round.
5. Retain action durations, arguments, responses/errors, displayed captures,
   actor verdicts and independent checkpoint state. Stop after an Unknown
   mutation, inspect it and retain it. Never replay it automatically.

Prepare the common fixture:

```sh
node scripts/control-comparison.mjs fixture SESSION.json trim athanor 2 /absolute/new-attempt
```

The directory must be new and outside Git. Setup creates a unique timeline,
resets window size and zoom, chooses the pointer tool and Name search mode,
verifies displayed clip identities, checks the trim edge is visible and puts
keyboard focus on the timeline. `fixture.json` belongs to the orchestrator and
scorer. Do not give its Qt geometry or hidden baseline to Bare.

`desktop/control-comparison.mjs` exports `prepareControlFixture` and
`scoreControlTask` for custom drivers. Setup does not execute the tested edit.
Use `agentTool`, `physicalInput`, native screenshots and readbacks in your
driver or agent workflow.

The original trim comparison saved after the drag and before Undo. Preserve
that sequence for baseline comparisons. Canonical `P-TL-TRIM` does not insert
that save; investigate those variants separately. Redo is Blocked when Undo
did not restore the exact baseline.

Score a retained task JSON with `task`, `baseline`, `finished: true` and ordered
`checkpoints`. Each checkpoint has a `phase` and `observation.timeline` containing
the complete `timeline.inspect` response. Search also needs
`observation.search: {query, status, names, complete}` from the independently
observed field, status and complete results model. `protocol` lists the phases.
Missing, duplicate or reordered phases cannot receive Pass.

```sh
node scripts/control-comparison.mjs score /absolute/task.json
```

The v2 recipe makes starting focus explicit and checks timeline identity,
metadata and track preservation. Record that version when comparing with v1.
Original round-1 trim timing had unmatched zoom and stays excluded from speed
comparisons. Compare verdicts and evidence first. Record tool durations, observation bytes
and rejected actions alongside elapsed time. Use this small local pilot
to guide development; repeat with other tasks and actors to broaden the result.

## October 5 control latency trial

The local hybrid comparison used source `bdf135a` before and `31d0f72` after,
on the same `2026.10.02-39f5d60` package pinned above. Both lanes used CLI/Qt
observations, physical gestures, independent outcome checks and compositor
captures. This compared harness versions, not hybrid versus bare computer use.
Two rounds reversed lane order and used fresh disposable projects.

| Workflow | Before mean | After mean | Reduction | Tool requests per attempt |
| --- | ---: | ---: | ---: | --- |
| Add Track, Save and Undo | 10.51 s | 7.27 s | 31% | 8 → 2 |
| Positive, missing, restored and cleared search | 37.73 s | 23.88 s | 37% | 28 → 4 |

All eight workflow attempts passed their outcome checks. Two deliberately false
readback gates stopped queued input with unchanged timeline state. Median
physical click/key/type costs fell by 24%/45%/43% across 10/24/6 actions per
lane. The native process helper now waits for exit notification instead of
polling; every identity check still runs. Use the short sequences and persistent
connection described in [computer-use guidance](computer-use-agent.md).

These are small scripted samples; preparation, fixture setup, scoring and model
reasoning pauses are outside timing. They do not measure the previously observed
20-second interactive agent gap. Track reduction varied from 19% to 42% between
rounds. Search capture scopes match within each pair: timeline in round one,
whole editor in round two. The first search cleanup was reassessed from its
unchanged observations after correcting the trial driver's mistaken requirement
for a status label in unfiltered mode; the original error remains retained.
Raw results, scripts, screenshots and cleanup receipts stay outside Git.

## Read only what changed

`observe` returns an `observationId` and `encoding`. Repeat the same query with
`since` to compare it with a retained snapshot. The tool returns whichever is
smaller: `encoding: "full"` with current `matches`, or `encoding: "delta"` with
`changes`. Full snapshots stay in the session's `observations/` directory, and
the tool journal retains each response. Read `encoding` before interpreting it.

```sh
node desktop/session.mjs tool SESSION.json observe '{"selector":{"class":"TimelineWidget"}}'
node desktop/session.mjs tool SESSION.json observe '{"selector":{"class":"TimelineWidget"},"since":"RETURNED_OBSERVATION_ID"}'
```

Use the newest ID for the next comparison; omit `since` for a full selection.
A changed query, package, process or generation rejects the comparison.
For a delta, `changes.completeSelection` says whether both selections were
complete. A full response reports current `truncated` and
`inspectionIncomplete` flags. `noLongerReturned` describes the query's output,
not confirmed deletion.
These diagnostics do not qualify Pass or replace fresh input guards.

Use a bundle of 1–8 nonempty `selectors` to read related controls from one Qt
inspection. The selectors combine with OR; each control appears once, and the
same overall match limit applies. Use either `selector` or `selectors`.

```sh
node desktop/session.mjs tool SESSION.json observe '{"selectors":[{"class":"MediaSearchField"},{"class":"QTreeView"},{"name":"mediaSearchStatus"}],"details":true,"limit":8}'
```

Repeat the identical bundle with its returned `observationId` as `since`.
A full response contains the current selection. A delta contains only changed
and added entries; retain the earlier selection if you need unchanged controls,
or omit `since` to request all current matches. `noLongerReturned` removes an ID
from that query's selection, not from the app. A UI delta does not include
timeline ranges or graph parameters unless the adapter exposes them; use the
appropriate CLI readback for those outcomes.

Direct JavaScript `physicalInput` and the agent tool reject unknown parameters
before dispatch. Drag duration is `durationMs`. A stale or mismatched geometry
binding is `Blocked` with `code: "input_binding_rejected"`; equal numeric
rectangles are accepted regardless of JSON key order. An uncertain dispatched
mutation remains `Unknown`, requiring inspection and resolution before editing.

Native input accepts `backspace`, `enter`, `esc`, `super` and `option`, translated
to `delete`, `return`, `escape`, `cmd` and `alt`. Context advertises these aliases.
Duplicate modifiers and unsupported keys stay rejected before dispatch.
For a frozen proof contract, use its declared action and chord exactly.

## Audit the wider app

Choose checks by the kind of control they exercise. Keep a small comparison
baseline, then qualify changes on other control families before adopting them.
A successful pointer action needs a separate check of what changed in Wizard.

| Control family | Exercise | Independent evidence |
| --- | --- | --- |
| Buttons and menus | Click, shortcuts, Undo | Exact track or setting change and restoration |
| Editable fields | Focus, type, replace, clear | Current text, complete result model and domain state |
| Timeline canvas | Select, trim, move, scroll | Clip identity, ranges, tracks and saved timeline |
| Graph canvas | Move, connect, pan | Node identity, connectivity and scene position |
| Inspector controls | Drag, type, reset | Parameter readback and rendered image |
| Playback | Seek, scrub, play, pause | Settled transport position and independently rendered frame |
| Audio controls | Fader, reset, mute, solo | Complete audio mix peak/RMS and restoration |
| File dialogs | Pick media, cancel, import | Selected file identity, asset registry and usable media |
| Project lifecycle | Save As, quit, reopen | Fresh-process project identity and unchanged original |
| Floating panels | Dock, move, resize, focus | Owned window geometry and preserved project state |
| Rejection and recovery | Ambiguous targets, stale bindings, bad fields | Blocked before dispatch, no native input and unchanged state |

For each family, record the selected package and tool hashes, fixture recipe,
setup, tested action, oracle, evidence, cleanup and unresolved limits. Label
physical input, Qt-driven UI actions and CLI operations separately. A Qt-driven
scrub qualifies that route; it does not establish native pointer coverage.
Use fresh owned projects for independent checks.

Keep the established baseline tasks unchanged. Put deliberate variants, such
as Save before Undo, in separate attempts. Use the same budgets and alternate
actor order for matched comparisons. Track rejected dispatches, observation
calls, returned bytes, input duration and exact verdicts. Exclude timing pairs
with unequal setup or recovery; retain their functional evidence.

Include a negative case for every new input binding. Rejection must be Blocked
before dispatch with unchanged app state and no new native input. Unknown after
dispatch is a different result: stop editing, inspect and resolve it without
replay. An incomplete model cannot establish absence. For a new agent-facing
readback, check both a changed selection and a large unchanged selection, and
verify that decoding full or delta responses preserves the same current state.

Prioritize missing evidence or access over more selectors for one task. Add an
adapter readback when an existing observation cannot distinguish the expected
outcome from a defect. Keep assertions in the check, and make the shared tool
return observable state. Re-run the affected families after a shared tool
change, then review acceptance separately from runtime qualification.
