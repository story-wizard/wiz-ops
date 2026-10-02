# Test Wizard with your agent

Athanor prepares the selected Wizard build and a disposable project, then gives your agent three ways to work: application calls, Qt controls, and physical mouse/keyboard input. Use application calls to set up a fixture and inspect its state. Use physical input for the gesture being tested.

## Open a test session

Start Athanor from the command root (`smoke/` in a checkout, `workspace/` in a bundle) with `npm run open -- --no-open`. Use its printed URL for the plan command:

```sh
node scripts/smoke.mjs plan --app /path/to/Wizard.app --checks D-CLI-01 --out /tmp/agent-plan.json --server URL
node desktop/session.mjs start --plan /tmp/agent-plan.json
```

If you use a separate workspace, export `SMOKE_DATA_DIR=/absolute/external/workspace` and keep that same environment for the service and every session/tool command. Keep the second command running. It prints a Ready receipt with the session file and `agent-context.json`. Give those paths to your agent. The context contains the selected package identity, project and media identities, adapter capabilities, available checks, expected outcomes, and tool instructions. Each session starts with a fresh Golden Project fixture.

The course catalog and `list` command expose normal course definitions. Physical qualification candidates such as `P-TRACK-ADD` are supplied by the owned session's context, not by that catalog. Prepare the `D-CLI-01` desktop connection plan above, then use `begin` with the candidate ID from `agent-context.json`. Starting that session prepares the fixture; it does not execute the plan's checks.

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

Selectors match exactly by default. Use `contains:true` for substring matching. Available fields are `id`, `class`, `name`, `text`, `tooltip`, `title`, `window`, `parent`, `enabled`, `active`, `focused`, `editableText`, and `keyWindow`. `kind:"actions"` queries QAction entries. Find and physical input require exactly one match. Narrow ambiguous matches using the observed window, parent, or control name.

Observe returns at most 20 matches by default, with a configurable limit up to 100. It reports the full match count and truncation. Add `details:true` for media rows, graph nodes/ports, tab rectangles or menu entries. The Qt adapter currently inspects at most 64 model rows, 128 selectable scene items and 256 scene labels; inspect the truncation fields before choosing a target.

Physical input supports `click`, `drag`, `key`, `type`, `scroll`, and `screenshot`. Points are local to the observed widget in macOS points. A click defaults to its center. A drag accepts `toTarget`, `toX`, and `toY`; `xRatio`, `yRatio`, `toXRatio`, and `toYRatio` can address fractions of the current widget. Geometry is checked again before dispatch. The native driver verifies the actual Unix PID, start time, native window frame and pointer ownership.

```sh
node desktop/session.mjs tool SESSION.json physical '{"command":"drag","target":{"id":"OBSERVED_VIEWPORT"},"x":100,"y":50,"toX":180,"toY":90,"durationMs":1000,"title":"Drag the clip right"}'
node desktop/session.mjs tool SESSION.json physical '{"command":"key","target":{"class":"TimelineWidget"},"key":"cmd+z","title":"Undo the edit"}'
node desktop/session.mjs tool SESSION.json wait '{"selector":{"title":"Export"},"condition":"exists","timeoutMs":5000}'
```

Wait supports `exists`, `absent`, `enabled`, `value`, `text`, and `checked`. Supply `expected` for the last three. It polls observations locally, with a maximum timeout of 60 seconds. It dispatches no edits. Available physical keys and adapter operations are listed in the context.

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

## Record a check with evidence

Begin a check listed in the context before executing it. Give actions a short `title` explaining their purpose. Existing application and native escape hatches remain available through toolkit `call` and `native`.

```sh
node desktop/session.mjs tool SESSION.json begin '{"id":"D-CLI-01"}'
node desktop/session.mjs tool SESSION.json call '{"operation":"project.get_name","params":{}}'
node desktop/session.mjs tool SESSION.json verify '{"read":{"operation":"project.get_name","params":{}},"expect":{"path":["name"],"equals":"EXPECTED_PROJECT_NAME"},"title":"Verify the opened project name"}'
node desktop/session.mjs tool SESSION.json capture '{"target":{"class":"MainWindow"},"title":"The selected project open in Wizard"}'
node desktop/session.mjs tool SESSION.json record '{"status":"Pass","note":"The selected app opened the expected fixture project."}'
node desktop/session.mjs tool SESSION.json report '{}'
node desktop/session.mjs stop SESSION.json
```

Choose verification criteria that establish the test's expected outcome. `verify` accepts a declared read-only application operation or an exact UI selector. Expectations use a property/index path plus `equals`, `notEquals`, `length`, or `includes`. A missing path fails. For adding a track, verify the new track's identity, type and contents; the project-name example only tests connection.

Pass requires both a successful independent verification and a captured result for the current check attempt, GUI generation and last toolkit/shared-adapter mutation. Physical candidate checks also require an actual dispatched physical-input receipt. Use `mode:"physical"` in Begin to require that route for another check. A later edit invalidates earlier verification. A repeated check starts a new attempt and cannot inherit its previous verdict. The agent chooses assertions that establish the check's expected behavior and reviews its visual result.

Capture defaults to displayed native-window pixels, including GPU preview content. `kind:"widget"` collects a Qt widget raster; `kind:"window"` captures the owned native window. Keep the source labels in the report. Captures and failures retain their images and diagnostics outside Git.

Record Fail, Blocked or Unknown with the observed reason. An Unknown edit is not replayed. Inspect the UI and application state, verify what actually happened, then use `resolve` with an explanation before further edits. Stop preserves an uncertain session's autosaved fixture and terminates only its owned app.

Report exports the existing Athanor interactive table and detail drawer, with actions, evidence and selected-build identity. It returns an absolute file path and a URL relative to the workspace service. It creates a new immutable export directory for each request. Agent session reports are local qualification evidence; they do not change canonical test acceptance or replace earlier course results.

Toolkit edits, Begin, Verify, Capture, Resolve and Record run one at a time. Observations and waits can sample a held gesture. Wait for the original receipt when another command is in progress. Raw `call`/`native` escape hatches require the same serial discipline. If a command crashes and leaves `agent-action.lock`, inspect its process and the current app state before removing that session-local lock; never remove a live command's lock. Reports freeze a recorded attempt's evidence and actions at its verdict; later investigation appears in a new attempt.

Pass `stepId` from the check specification to label a toolkit action's place in the walkthrough. A step with recorded actions and no lifecycle receipt appears as Observed. Explicit script step outcomes take precedence, and a started step without a terminal receipt remains Unknown.

## Give this to another agent

> Read smoke/AGENTS.md and smoke/docs/computer-use-agent.md. Prepare the Wizard build I selected, start an owned session, and read its agent-context.json. Check physical readiness. Use CLI/Qt calls for setup and physical input for the action under test. Resolve targets from current observations, verify the expected behavior independently, capture the result, and record the outcome. Export the report and stop your session. Preserve failed and uncertain attempts.
