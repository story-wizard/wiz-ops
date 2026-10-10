# Packaged macOS regression course

`macos-regression` revision 2 contains twelve candidates. It leaves `smoke-full`
revision 10 and the accepted-only course unchanged. Each candidate uses an
isolated Fresh project because extra windows and transcript fixtures alter the
state the next check would otherwise inherit.

| Check | Action | Independent evidence |
| --- | --- | --- |
| D-MAC-RESUME | Physical Space starts, pauses and resumes after a stopped seek. | Advancing/held transport, exact frame 48, visible timecode and fresh presented Preview pixels. |
| D-MAC-WINDOW-ORDER | Open floating Timeline and Preview panels, focus a sibling, physically click the owner. | Native key window, window numbers, stacking order, normal levels and absence of native parent attachment. |
| D-MAC-FLOAT-TIMELINE | Physically focus the new floating timeline and send C. | Its Cut mode, the original panel's unchanged Select mode, native focus and unchanged clips. |
| D-MAC-FLOAT-PREVIEW | Send physical Space in the new floating Preview. | Separate packaged Preview signal counters: focused +1, original +0. |
| D-AGENT-TAIL | Append deterministic local responses, then one more at the tail. | Exact row-count change, spacing, follow intent and bounded scroll-position samples. |
| D-AGENT-SELECTORS | Hover each selector through Qt input for 500 ms. | Real Qt Quick accessible descriptions, hovered state and tooltip visibility. |
| D-AGENT-HEADER | Set a local active-event fixture; check active controls at 280 points, hide Cancel, then widen to 600 points. | Title room, active control geometry, events visibility and restoration of controller options. |
| D-AGENT-IMAGE | Append a project-relative square image; size its body 400 → 120 → 400. | Actual QTextDocument image formats, rounded image resource/alpha, 200 → 120 → 200 sizing and presented image. |
| D-AGENT-SCROLL-AWAY | Simulate a source-regression gesture away from the tail, append, then resume follow. | Held history position, disabled follow intent, exact row-count change and explicit return to the tail. |
| D-AGENT-GESTURE-ANCHOR | Append a taller response during a source-regression tail gesture. | Same materialized row identity and viewport offset, then tail catch-up after release. |
| D-AGENT-CUSTOM-MODEL | Physically open the custom-model popup in a 280-point panel. | Exact visible label, truncation state, popup bounds, close and original-option restoration. |
| D-AGENT-PIPELINE-CONFIG | Request known model/effort choices during a dedicated suppressed launch. | Independent pipeline model/effort, unchanged pipeline identity and no active worker. |

## Run a subset

From the `smoke/` command root, save a selection outside Git:

```json
{
  "courseIds": ["macos-regression"],
  "subsetIds": ["D-MAC-FLOAT-TIMELINE", "D-AGENT-IMAGE"]
}
```

Use `scripts/smoke.mjs prepare --app /path/to/Wizard.app --file SELECTION.json`
against the configured local service. Inspect the returned preparation ID until
Ready, then start its plan hash once with `run --plan-hash HASH --operator NAME
--request-id ID`. Keep request, package, source, schema, adapter, course and fixture
identities in the retained report. Reconcile an uncertain request instead of
resending it. Preparation qualification and candidate execution are separate.

## Reusable adapter access

- `native workspace-inspect`: bounded semantic Qt Quick items, controller options,
  real accessibility/tooltip properties and inline document/image resources. The
  view must belong to the observed panel's native window and match its container
  geometry. It bypasses macOS AX traversal.
- `native workspace-append`: bounded local fixture responses, prefixed event
  identity and the reviewed packaged ChatHistory append API. It does not submit
  user input to Oz or start a provider.
- `native workspace-hover`: model/effort selectors only, using Qt-injected hover.
- `native workspace-header`: begin/hide-cancel/end an owned local header fixture; it retains
  original options and Cancel state for restoration. The active event is synthetic.
- `native workspace-scroll`: bounded begin/offset/end/resume phases on the owned
  transcript. This injects the source test's Qt gesture lifecycle and is separate
  from physical wheel/drag delivery.
- `native workspace-inspect` with `anchorIndex`: read the materialized row's identity
  and viewport offset. Selector observations also include bounded popup labels,
  truncation and geometry.
- `native workspace-model-fixture`: begin/end the exact source custom-model fixture,
  closing its popup and restoring the original options.
- `native workspace-pipeline-inspect` and `workspace-request-selection`: see
  [pipeline checks](pipeline-automation.md) for the versioned application contract,
  launch suppression and independent readback.
- `native workspace-image-width`: bounded fixture document width and the actual
  packaged image-sizing method.
- `native add-floating-panel`: Timeline or Preview through the owned MainWindow's
  public API. Physical focus/shortcut actions remain separate from setup.
- `physical click` with `preserveWindowOrder: true`: skip the usual pre-click
  activation only when testing native focus/stacking. The real click still passes
  process/window identity, geometry, pointer-hit and foreground ownership guards.
  Keyboard, typing and dragging reject this option. Ordinary clicks keep their
  existing activation behavior.

These typed seams reject unavailable symbols and ambiguous surfaces. Review the
selected package's actual public signatures before changing a mapping; do not
guess private object layout or add arbitrary application evaluation. Unknown
mutations stop further input. An ordinary assertion failure still allows the
next independent candidate to run in its own project.

## Source coverage and remaining work

`scope/macos-source-assertions.json` inventories methods from the pinned native
window, App/Core playback and five Agent Workspace exception sources. A related
path is a partial overlap, not a replacement for all assertions inside a method.
The pinned PR sources differ from the qualification nightly.

Revision 1 remains available with its original eight members. Revision 2 adds the
four candidates above. Their packaged qualification is separate from the earlier
cohort's retained results. Unsupported pipeline-hook packages remain Blocked.
The source inventory records the added partial routes without promoting them to
acceptance.

Physical transcript wheel/drag delivery, other model labels and popup sizes,
provider-lock/reopened-panel propagation, window deactivation/hidden/replacement/
multiscreen lifecycles and private audio/decoder fault injection remain separate
work. Failed and blocked attempts keep their original verdicts.
