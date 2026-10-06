# Test Wizard with your agent

Athanor prepares the selected Wizard build and a disposable project, then gives your agent three ways to work: application calls, Qt controls, and physical mouse/keyboard input. Use application calls to set up a fixture and inspect its state. Use physical input for the gesture being tested.

## Start here

Read this guide for exploratory app control. For an existing course, use [agent courses](agent-courses.md). After a failure, use [investigations](investigations.md). For build compatibility or test edits, use [build repair](build-repair.md) and [test authoring](test-evidence.md).

The session's `agent-context.json` is your working reference: it lists current operations, physical keys, frozen checks, toolkit Pass contracts and the deadline. A scripted course uses its own authored assertions. Exploration can retain observations and diagnostics; an interactive toolkit Pass requires one of the listed contracts.

## Open a test session

Start Athanor from the command root (`smoke/` in a checkout, `workspace/` in a bundle) with `npm run open -- --no-open`. Use its printed URL for the plan command:

```sh
node scripts/smoke.mjs plan --app /path/to/Wizard.app --checks D-CLI-01 --out /tmp/agent-plan.json --server URL
node desktop/session.mjs start --plan /tmp/agent-plan.json
```

If you use a separate workspace, export `SMOKE_DATA_DIR=/absolute/external/workspace` and keep that same environment for the service and every session/tool command. Keep the second command running. It prints a Ready receipt with the session file and `agent-context.json`. Give those paths to your agent. The context contains the selected package identity, project and media identities, adapter capabilities, available checks, expected outcomes, and tool instructions. Each session starts with a fresh Golden Project fixture. The Ready receipt and context report the 30-minute deadline. Export your report and stop before it expires; expiry terminates the owned app. A new session gets a new deadline and does not inherit proof from the earlier attempt.

The course catalog and `list` expose accepted checks plus the physical candidates included in the maintained `smoke-full` qualification course. Unlinked `P-TRACK-ADD` remains available only in an owned session's context. Prepare the `D-CLI-01` desktop connection plan above, then use `begin` with the candidate ID from `agent-context.json`. Starting that session prepares the fixture; it does not execute the plan's checks.

Preparation attaches an external adapter to a byte-identical disposable copy of the build. The session holds a shared foreground lease across Athanor workspaces. A competing session receives a Blocked response. The operating system releases the lease when the launcher ends; an uncertain orphan app still needs inspection and cleanup.

## Use the toolkit

Every command below returns JSON. Replace `SESSION.json` with the Ready receipt's absolute session path:

```sh
node desktop/session.mjs tool SESSION.json preflight '{}'
node desktop/session.mjs tool SESSION.json observe '{"selector":{"class":"MainWindow"}}'
node desktop/session.mjs tool SESSION.json find '{"selector":{"name":"panelChromeAction","text":"+ Video","enabled":true}}'
node desktop/session.mjs tool SESSION.json physical '{"command":"click","target":{"name":"panelChromeAction","text":"+ Video","enabled":true},"title":"Click Add Video Track"}'
```

`preflight` reports physical input and screen-capture permissions, the verified PID, visible windows, the foremost WindowServer window, the actual Qt/AppKit key window, and the focused control. It does not change permissions. If access is missing, let the user handle the macOS prompt and rerun preflight.

Selectors match exactly by default. Use `contains:true` for substring matching. Available fields include `id`, `class`, `name`, `text`, `tooltip`, `accessibleName`, `accessibleDescription`, `title`, `window`, `parent`, `enabled`, `active`, `focused`, `editableText`, and `keyWindow`. `kind:"actions"` queries QAction entries, including checked state. Find and physical input require exactly one match. Narrow ambiguous matches using the observed window, parent, or control name. `observe` and `find` accept `scope:"OBSERVED_WIDGET_ID"` to inspect its subtree and ancestors; scoped absence says nothing about the rest of the app.

Observe returns at most 20 matches by default, with a configurable limit up to 100. It reports the full match count and truncation. Add `details:true` for media rows, graph nodes/ports, tab rectangles or menu entries. The Qt adapter currently inspects at most 64 model rows, 128 selectable scene items and 256 scene labels; `inspectionIncomplete` flags incomplete model, scene or menu observations even when the selector returns no matches. Each returned widget also exposes its truncation flags. Older adapters conservatively flag a scene that reaches its cap. Narrow or refresh observations before concluding that an item is absent.

Use `model` to page a visible model view beyond those first 64 rows:

```sh
node desktop/session.mjs tool SESSION.json model '{"target":"OBSERVED_MEDIA_VIEW","offset":0,"limit":64}'
```

Follow `nextOffset` until it is null. Each page contains its total immediate row count under the view root, absolute row indices, current viewport geometry and visibility, plus column headers. It returns up to six displayed columns and does not recursively traverse child rows. Version 7 returns a model-identity, revision and root cursor. Supply it to subsequent pages; a row-data change invalidates it even when the row count stays the same. Restart inspection after rejection. Use `reveal` for an offscreen row during setup, then refresh geometry. `model_value` reads an observed column/Qt role or retains its image. Validate build-specific role meanings against independent application identities before relying on them. Timeline observations include up to 1024 sorted `clipIds` when the package exports its public getter. `clipIdsTruncated` distinguishes a complete set from a capped one. An unavailable getter leaves identities absent; use application readback rather than guessing.

Physical input supports `click`, `drag`, `key`, `type`, `scroll`, and `screenshot`. Points are local to the observed widget in macOS points. A click defaults to its center. A drag accepts `toTarget`, `toX`, and `toY`; `xRatio`, `yRatio`, `toXRatio`, and `toYRatio` can address fractions of the current widget. Geometry is checked again before dispatch. The native driver verifies the actual Unix PID, start time, native window frame and pointer ownership.

```sh
node desktop/session.mjs tool SESSION.json physical '{"command":"drag","target":{"id":"OBSERVED_VIEWPORT"},"x":100,"y":50,"toX":180,"toY":90,"durationMs":1000,"title":"Drag the clip right"}'
node desktop/session.mjs tool SESSION.json physical '{"command":"key","target":{"class":"TimelineWidget"},"key":"cmd+z","title":"Undo the edit"}'
node desktop/session.mjs tool SESSION.json wait '{"selector":{"title":"Export"},"condition":"exists","timeoutMs":5000}'
```

Wait supports `exists`, `absent`, `enabled`, `value`, `text`, `checked`, `focused`, `keyWindow` and `geometry`. Supply `expected` for value/text/checked. It polls read-only observations with a maximum timeout of 60 seconds. An incomplete inspection cannot establish absence; narrow `scope` or page the relevant model. Geometry needs one enabled, visible target with finite dimensions and no unrelated Qt modal/popup. It defaults to 250 ms of unchanged geometry. Use `stableForMs` from 0–2000, within `timeoutMs`, for a quiet interval on any condition. A late response cannot satisfy an expired wait. The quiet interval compares the returned observation, so scope it to the state that matters.

```sh
node desktop/session.mjs tool SESSION.json wait '{"selector":{"id":"OBSERVED_FLOATING_WINDOW"},"condition":"geometry","stableForMs":250,"timeoutMs":5000}'
node desktop/session.mjs tool SESSION.json wait '{"selector":{"id":"OBSERVED_FIELD"},"condition":"focused"}'
node desktop/session.mjs tool SESSION.json wait '{"selector":{"id":"OBSERVED_NATIVE_PANEL"},"condition":"keyWindow"}'
```

A successful wait does not reserve a target or grant keyboard focus. Input still refreshes geometry, process identity and key-window ownership before dispatch. Available physical keys and adapter operations are listed in the context. Editing keys include J/K/L, I/O, B/V, arrows, digits, F1–F12, Home/End, Page Up/Down, comma/period nudges and forward delete. Chords use names such as `shift+right`, `cmd+1`, `period` and `f2`. Key codes identify physical keys; Unicode text uses `type`. The same ownership and focus checks apply to every chord.

The context also lists the selected build's application operations and the verification allowlist. Use `schema '{"operation":"timeline.inspect"}'` to retrieve one operation's parameter, result and error schemas. Use `evidence '{"file":"/absolute/session/file.json","title":"Measured state"}'` to retain existing JSON, or add `kind:"image"` for a PNG. Imported observations appear in the report but cannot satisfy the current capture or verification required for Pass.

## Text, scrolling and timeline targets

Physically click the intended editable field before `type`. The toolkit verifies that the same normal, enabled text field has focus; secure and read-only fields are refused. Text uses native Unicode keyboard events, up to 4096 UTF-16 units, without changing the clipboard. Scroll uses native pointer/wheel events at a verified visible point; positive deltas scroll down/right, with a 2000-pixel limit per axis. Verify the resulting text or scrollbar state afterward.

```sh
node desktop/session.mjs tool SESSION.json physical '{"command":"click","target":{"class":"QLineEdit","name":"OBSERVED_FIELD","editableText":true}}'
node desktop/session.mjs tool SESSION.json physical '{"command":"type","target":{"class":"QLineEdit","name":"OBSERVED_FIELD","focused":true},"text":"Athanor — ✨"}'
node desktop/session.mjs tool SESSION.json physical '{"command":"scroll","target":{"id":"OBSERVED_VIEWPORT"},"deltaY":300}'
node desktop/session.mjs tool SESSION.json geometry '{"target":{"id":"OBSERVED_TIMELINE"},"clipId":"OBSERVED_CLIP_ID","part":"right-edge"}'
```

`geometry` calls the selected package's exported `TimelineWidget::clipRectFor` function. It returns the clip rectangle, visible intersection and a point for `body`, `left-edge`, or `right-edge`. Physical click/drag accepts the same `clipId` and `part`; the rectangle is checked again before dispatch. An offscreen edge requires scrolling and a new observation. This route requires the packaged function and a matching Qt adapter; preparation/capabilities report availability. It uses the current app geometry instead of assuming a zoom level. Read clip identities from `timeline.inspect` first.

For keyboard actions, use preflight's key-window/focused-control information. If another owned window receives keys, physically click the intended control and observe focus again. A lost or covered target stays Blocked or Unknown; it is never bypassed or replayed.

The instrumented route uses a fresh AppKit key-window observation rather than WindowServer stacking order: a floating panel can sit above the actual key window. The driver checks that observation's age and the owned process before dispatch. Keep the desktop available while a gesture runs; the session lease excludes other Athanor sessions, not a person using the keyboard.

After input, the driver checks that the verified process remains frontmost. Editable clicks and typing also check the exact field and its key window. A lost focus result is Unknown: inspect it before continuing, and do not replay the input. Receipts include these observations.

## Dialog coverage

The adapter inspects controls in the owned Qt process, including Wizard's Qt export dialog, and owned AppKit file panels bound to their actual native window IDs. The native Import Files path has local qualification on the selected October 2 package. Other native sheets, permission prompts and outside applications need their own qualification. Retain the observations when a surface is unsupported.

## Capture displayed evidence

`capture` with `kind:"presented"` (the default) captures the target’s visible region from a fresh ScreenCaptureKit compositor stream. `kind:"window"` captures its whole native window; `kind:"widget"` records the Qt widget raster. Presented/window capture accepts only a complete frame whose display tick is newer than the request, and rechecks the owned process and window geometry before saving. Each image’s evidence metadata retains the capture source, frame timing and native receipt.

Keep the window fully visible on one display. If the window moved, spans displays or no fresh complete frame arrives within four seconds, inspect and capture again. Capture dispatches no edits. Use the independent state assertions to check the behavior shown in the image. Raw Qt `snapshot-presented` remains the adapter’s original one-shot route; use the toolkit capture for the streamed source and timing metadata.

## Record a check with evidence

Read the frozen check’s `proof` contract in `agent-context.json`. Toolkit contracts cover `D-CLI-01`, `P-TRACK-ADD`, trim, bin drop/overwrite, Render Graph move/pan, wire and clipboard, plus missing-term search, the 100-clip timeline clipboard and 50-step history. Include the desired `D-SEARCH-EMPTY`, `D-CLIPBOARD-LARGE` or `D-HISTORY-50` IDs in your plan so their definitions enter the session context. Read each frozen contract for its required action IDs, checkpoints and captures. Spellbook gestures and continuous curve sampling use authored scripted assertions; they cannot obtain an arbitrary toolkit Pass. Other checks remain available for exploration and diagnostic recording; a new toolkit Pass requires a reviewed machine-checkable contract. Scripted course execution remains separate.

For the observation-only connection check:

```sh
node desktop/session.mjs tool SESSION.json begin '{"id":"D-CLI-01"}'
node desktop/session.mjs tool SESSION.json verify '{"assertion":"connection"}'
node desktop/session.mjs tool SESSION.json capture '{"assertion":"connection","target":{"class":"MainWindow"}}'
node desktop/session.mjs tool SESSION.json record '{"status":"Pass","note":"The owned endpoint, project and visible editor agree."}'
node desktop/session.mjs tool SESSION.json report '{}'
```

`verify` with a declared assertion runs the maintained verifier. The connection verifier checks the owned endpoint PID, exact fixture name, nonempty CLI bundle revision, visible project window and panel startup errors. Arbitrary `expect` comparisons remain useful observations but cannot qualify Pass.

For the physical checks, prepare and open the declared fixture, then verify `baseline` using an unfiltered `timeline.inspect` and the observed video timeline `target`. It freezes the timeline, viewport, original tracks and clip identity. Add Track needs an empty two-track timeline. Trim needs the four-second Fresh plate clip with exact timing.

```sh
node desktop/session.mjs tool SESSION.json verify '{"assertion":"baseline","target":"OBSERVED_VIDEO_VIEW","read":{"operation":"timeline.inspect","params":{"timeline_id":"OBSERVED_TIMELINE"}}}'
node desktop/session.mjs tool SESSION.json physical '{"actionId":"add","command":"click","target":{"name":"panelChromeAction","text":"+ Video","enabled":true}}'
node desktop/session.mjs tool SESSION.json physical '{"actionId":"save","command":"key","key":"cmd+s","target":{"class":"TimelineWidget"}}'
node desktop/session.mjs tool SESSION.json verify '{"assertion":"changed","read":{"operation":"timeline.inspect","params":{"timeline_id":"OBSERVED_TIMELINE"}}}'
node desktop/session.mjs tool SESSION.json capture '{"assertion":"changed","target":{"class":"TimelineWidget"}}'
```

Follow the contract’s remaining actions: `undo`, and for Add Track, `restore-save`. Then verify and capture `restored` before recording Pass. Trim’s tested action is `trim`, a physical drag with the frozen `clipId` and `part:"right-edge"`. Use `geometry` to choose current visible endpoints.

Receipts identify the declared action and resolved target. A click on another control does not qualify a trim. Physical requirements cannot be changed to hybrid. Action IDs select a frozen contract; they do not grant permission to send a different command. CLI/Qt remain useful for setup before baseline. A raw or unqualified mutation after baseline invalidates the attempt.

Each required checkpoint pairs a successful independent verification with an explicit capture at the same revision. Capture must occur after verification. Imported images, physical screenshots and automatic failure screenshots remain diagnostics. Declared later actions such as Undo can follow a captured changed-state checkpoint; they need their own restoration proof. An unrelated edit or a mutation between verification and capture prevents Pass.

For the 100-clip timeline clipboard contract, bind the prepared empty destination with `fixture.destinationTimelineId` at source baseline. After Copy, follow `destination-click` and the physical double-click `destination-open` on the same frozen media row. Verify the `destination` checkpoint using the destination timeline read and its newly observed video canvas `target`, then capture it. That binds the new canvas before `destination-focus` and Paste. The verifier requires an open destination tab, an unchanged empty timeline and complete displayed clip identities. Paste, Undo and Redo must use that bound canvas and destination timeline; the source remains independently checked.

## Attempts, errors and recovery

An attempt has one terminal verdict. Repeating the same status and note returns its existing receipt. A different verdict is rejected. Close an open attempt before beginning another; retests receive new IDs. After closure, observations and diagnostics remain available, but further edits need a new attempt. Reports preserve all attempts, execution modes, actions, proof references, evidence and uncertainty resolutions. A passing retest keeps the earlier failure visible.

Tool errors return `status`, stable `code`, `origin`, `nextActions`, diagnostics and retained evidence. Correct parameter errors before retrying; no action was dispatched. Failed declared product assertions are Fail. Harness or setup errors are Blocked. A lost mutation response remains Unknown and is never replayed.

Resolve uncertainty by referencing its action ID and a current definition-owned verification:

1. Inspect the state and the error’s recovery actions.
2. Verify `resolve-unchanged` or `resolve-completed` using the frozen timeline’s `timeline.inspect`, or the frozen clip’s `graph.get_clip_graph` for graph checks. The former compares the last verified state; the latter checks the declared action’s expected outcome. If there is no suitable bound outcome, retain Unknown and stop.
3. Call `resolve` with `actionId`, the returned verification `file`, and a nonempty `note`.
4. Close the attempt as Unknown or Blocked as appropriate, then begin a new retest. Resolution never manufactures a successful physical receipt or rewrites a closed verdict.

Toolkit edits, Begin, Verify, Capture, Resolve and Record share one session action lock. Raw session `call`/`native` use the toolkit boundary when tracking is active. Direct shared-adapter mutations also take the lock and invalidate proof when unqualified. Observations and waits can sample a held gesture. Wait for an in-progress command’s receipt; there is no force-unlock route.

Attach-only sessions support inspection. A prepared owned fixture and frozen proof contract are required for toolkit Pass. Reattachment invalidates prior proof through a new generation; close the old attempt and begin a fresh one. Historical sessions and reports stay readable but are not retroactively contract-qualified.

The local toolkit protects supported Athanor routes. Outside applications and direct requests to Wizard are outside its attempt journal. Keep the desktop available and review unexpected app state. Stop is serialized operational cleanup outside the closed attempt. It terminates only the session’s owned app and preserves an uncertain autosaved fixture.

## Give this to another agent

> Read smoke/AGENTS.md and smoke/docs/computer-use-agent.md. Prepare the Wizard build I selected, start an owned session, and read its agent-context.json. Check physical readiness. Use CLI/Qt calls for setup and physical input for the action under test. Resolve targets from current observations, verify the expected behavior independently, capture the result, and record the outcome. Export the report and stop your session. Preserve failed and uncertain attempts.


## Run the default checklist course

Use `plan --course smoke-full` and `run --plan FILE --wait` through `scripts/smoke.mjs`, with the service URL. The default mixes accepted engine/service/desktop checks and explicit physical qualification candidates. User-created courses still require accepted definitions. Physical requests, receipts, streamed captures and graph/timeline readbacks are retained in the same run report. Keep the Mac unlocked; an awake hold does not unlock a screen. See `docs/agent-courses.md` for composition and exclusions.

## Timed evidence and current geometry

Use scoped `observe`/`find` to inspect one panel. Traverse large models with their revision cursor, reveal the required row, and inspect geometry again before input. Key-sequence recorders expose `keySequenceCapture`; click the parent recorder to assign a shortcut. Its child text field is a display of that binding. Native file-panel observations can guide physical Go to Folder entry with Cmd+Shift+G.

Use `recording` for a bounded playback sample window; see [agent tools](agent-tools.md). It collects fresh compositor frames, transport and owned-process resources without recording a verdict. A tracked attempt retains its images, manifest and sampled MP4 in the exported report. Transport queries remain available as read-only observations after an uncertain edit. Use `resize-window` or `floatPanel` during setup when a panel clips its controls, and `activatePanel` to restore the intended dock before binding its canvas. Never send coordinates outside a control's observed visible region.

## Reduce trips back to the agent

Read [Plan agent sequences](agent-sequences.md) for phase boundaries, editable
JSON examples and the read-only `batch-check` command. Plan known steps before
dispatch, then review the complete outcome at each meaningful checkpoint.

Use `node desktop/session.mjs batch SESSION.json /absolute/steps.json` for a
short, already understood sequence. The file is an array of 1–8 ordinary tool
requests, at most 64 KiB. Each step retains its own admission checks and receipt.
Selectors are resolved again before each gesture. The sequence stops on the
first error or false `expect`; it does not roll back completed edits. Review
the returned `results`, `stoppedAt` and `failure` before continuing.

For example, after observing the exact search field on the selected build:

```json
[
  {"operation":"physical","params":{"command":"click","target":{"class":"MediaSearchField","editableText":true}}},
  {"operation":"physical","params":{"command":"key","target":{"class":"MediaSearchField","focused":true},"key":"cmd+a"}},
  {"operation":"physical","params":{"command":"type","target":{"class":"MediaSearchField","focused":true},"text":"plate"}},
  {"operation":"wait","params":{"selector":{"class":"MediaSearchField"},"condition":"text","expected":"plate"}},
  {"operation":"observe","params":{"selectors":[{"class":"MediaSearchField"},{"name":"mediaSearchStatus"}],"details":true}}
]
```

Use an `expect` gate on a readback before a dependent edit, such as
`{"operation":"call","params":{"operation":"project.get_name"},"expect":{"path":["name"],"equals":"THE_OBSERVED_PROJECT_NAME"}}`.
Expectations reuse the toolkit's `path`, `equals`, `notEquals`, `length` and
`includes` comparisons. They stop the sequence; they do not qualify a toolkit
Pass. Keep the frozen definition's verification and capture checkpoints.
Sequences do not reserve targets or exclude other commands between steps.
Use a separate agent decision when an outcome needs interpretation.

For a bot or a persistent agent runtime, keep
`node desktop/session.mjs tools SESSION.json` running. Send one JSON request
per stdin line and read one JSON reply from stdout:

```json
{"id":"observe-1","operation":"observe","params":{"selector":{"class":"MainWindow"}}}
{"id":"search-1","steps":[{"operation":"physical","params":{"command":"click","target":{"class":"MediaSearchField","editableText":true}}},{"operation":"observe","params":{"selector":{"class":"MediaSearchField"}}}]}
```

Requests run sequentially. Each line is limited to 64 KiB; errors include their
original status, code and evidence. Request IDs correlate replies; they are
not idempotency keys. Never resend a mutation after a lost response. Closing
the connection leaves the existing session lifecycle unchanged; explicitly
stop the owned session when finished. The connection does not extend its
deadline. `agent-context.json` advertises this protocol and only application
read operations supported by the selected build.

Measure agent round trips, total elapsed time and actual tool execution
separately. Batching removes pauses between known steps; a persistent process
also avoids repeatedly starting Node. Neither changes model inference time.
The native driver still inspects process identity on every check; its
event-driven process wait removes polling delay without caching ownership.

## Compare control improvements

Use the [control harness baseline](control-comparison.md) to preserve and verify
the original matched comparison, prepare equivalent fixtures, and score new
attempts. `observe` now returns an `observationId`; repeat the same query with
`since` for an adaptive response. Check `encoding`: `full` contains current
`matches`; `delta` contains `changes` and requires the earlier selection for
unchanged controls. The smaller representation is returned. Use
`selectors: [{...}, {...}]` for 1–8 related queries from a single inspection;
selectors combine with OR and matching controls appear once. Full snapshots
stay local, and these observations remain diagnostic rather than Pass evidence.
Native key aliases are listed in the session context. Direct `physicalInput`
and the toolkit reject unsupported fields before dispatch; drag duration is
`durationMs`. A binding rejection is Blocked; an uncertain dispatched edit
remains Unknown and must not be replayed.
