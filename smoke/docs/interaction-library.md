# Shared Wizard interaction library

The smoke course now uses a small JavaScript library to drive the **real packaged Wizard engine**. It is a useful foundation for scripts, agents and a future workflow runner. It uses application operations and retains their receipts; it does not edit project JSON to imitate application behavior.

## Current building blocks

| Helper | What it does |
|---|---|
| `PackagedEngine` | Starts an owned packaged headless process, verifies its endpoint PID, scopes calls to the run directory, passes observed revisions, and journals requests/responses. |
| `ProjectSession` | Creates a disposable project, imports fixtures using returned asset IDs, creates timelines, places and moves clips, and reads project state. `setup()` builds the known editorial baseline. |
| `ingestAssets` | Runs the packaged Python ingest client against that engine. Checks terminal job status, each asset operation and durable source hashes. Optional `speech: true` uses the prepared cached model offline. |
| `search` | Calls name or transcript search and requires complete, untruncated, ready and exhaustive results. Missing indexes cannot pass as empty results. |
| `reopen` | Checkpoints, closes and reopens the project through application operations. |
| `still`, `frame`, `reference`, `evidence` | Export real rendered frames at the timeline rate, independently decode source frames, and retain pixel measurements and files. `frame(c, label, index, timeline)` addresses an exact frame, including fractional-rate timelines. |
| `insertEffect` | Reads the clip graph, inserts a pass before the composite, and verifies the returned node identity and connections. |
| `placeMany` | Places up to 100 clips in one bounded operation and validates returned identities. Multi-clip moves supply an explicit anchor. |
| `cloneEffect` | Recreates a grade from its authored parameters through graph operations; the receiving clip owns its independent node. |
| `mixReport` | Runs the offline audio renderer, rejects incomplete/fallback results, verifies sample count and saves audio measurements. |

The entry point is `runner/interactions.mjs`; lower-level adapters live beside it. There are no additional package dependencies. The tests in `runner/cases.mjs`, `runner/render-checks.mjs` and `runner/extended-checks.mjs` are examples of composing these helpers.

```js
// Inside a course check, c is a ProjectSession bound to an owned run.
await c.setup();
const before = await still(c, 'before');
const {scope, node} = await insertEffect(c, 'gaussian_blur', {radius: 16});
const after = await still(c, 'after');
assert(pixelStats(after).edgeEnergy < pixelStats(before).edgeEnergy * .98,
  'Blur did not reduce edge contrast.');
await evidence(c, {before, after});
```

## Adding a check

1. Add a focused function that composes the shared helpers and verifies a user-visible effect or persisted state. A successful command response alone is not a pass.
2. Add a `runner/course.json` entry: stable ID, source checklist ID, scope, expected outcome, stage and required operations. Use a linked counterpart when only part of a manual path is covered.
3. Increment the course revision. Prepare again with `npm run smoke:prepare`; this pins the package, schema, fixtures, cached model, course and runner contents. Run `npm test` for runner/dashboard contracts.
4. Restart the local dashboard after changing runner code. Use **Check readiness → Run local course** to retain a frozen dashboard run with immutable automated results.
5. Inspect failures and their retained projects. Recipe fixes get a new run; old evidence stays unchanged.

Every course check gets its own project. Helpers use explicit identities, never a guessed current selection. A command timeout or ambiguous mutation records Unknown and stops dependent execution; mutations are not retried automatically. Run cancellation terminates only owned processes.

## Boundaries and useful shims

The CLI and HTTP ingest client are our current application adapters. Agents and scripts can use the same helpers. The separate local GUI adapter implements widget inspection, focus, clicks, row selection/double-click, key combinations, bounded drags, text/combo input, actions, window close, and clipboard preservation. Item selection can use an exact, unique first-column name instead of a row number; missing or ambiguous names are rejected. Use `desktop/adapter.mjs` with an owned session; see the desktop course (historical report retained outside Git). Resolve IDs from current observations and assert the resulting state; dispatch receipts do not establish behavior. A headless pass currently makes no claim about a visible panel, keyboard shortcut, dialog or real-time playback.

`desktop/generated-fixture.mjs` builds a network-disabled synthetic title through the real generation operation and places it on the fixture's explicit video track. `desktop/export-dialog.mjs` provides movie and Still at Playhead export through the actual dialog, retains its controls, and independently decodes the resulting file. The movie route lets Wizard prepare the authorized generation bindings required for MGFX export; scripts must not invent them. `desktop/check-compounds.mjs` composes these helpers with conversion, keyboard clipboard, child edits and undo.

Two details discovered in this package:

- Transcript indexing is video-only. The fixture pack contains both synthetic speech audio and the same speech in a tiny video. Audio transcription is tested; transcript search uses the video. Audio-only transcript search is an explicit follow-up.
- Connecting a newly added rectangle to a newly added Apply Matte node in the same batch is rejected. Creating both nodes, reading their durable IDs, then wiring them in one batch works. The smoke check measures the actual masked pixels and undo. This shim stays in the recipe; it does not change Wizard.

Recursive bin search is rejected by the installed endpoint. The course tests nested folder storage and direct child/parent scopes without claiming recursive search works. Visual/semantic search, Oz tool selection, Spellbook delivery and native plugin windows still need additional integration or fixtures. GUI reload and movie export have separate instrumented desktop evidence; this does not change headless coverage.

## Diagnostic selection

`node scripts/probe-cases.mjs A-TL-08-N A-PB-09-R` runs only named checks from the prepared course in an owned process. These diagnostic reports stay under `$SMOKE_DATA_DIR/runs/case-probe-*` and never create dashboard passing records. Use the full course for a frozen dashboard result.

The packaged ingest client excludes still images from its expanded input set. A registered PNG then fails placement with `unsafe_conformance` because it has no completed ingest record. The mixed-codec check therefore covers ProRes, H.264 and MXF; the PNG path remains an explicit adapter gap.

The desktop helpers `mediaItem`, `mediaMenu` and `openTimeline` resolve exact visible names, open real context menus, click observed action rectangles and verify the selected timeline. Missing or ambiguous names fail the check. Menu inspection and bin inspection are bounded (64 rows); flat GP track-header gestures assume the default layout. Expand geometry discovery when fixtures require different layouts. See timeline/bin checks (historical report retained outside Git).

The smoke-only native bridge also reads slider values, bounded rich-document text/HTML and selectable graphics-item rectangles/labels. `type-text` sends up to 1,024 printable ASCII characters through key events. The editor batches use these observations to select an actual graph node and verify bypass, or type a document mention; direct graph/document mutation is not used to imitate those gestures.

The revision-8 expansion adds owned-window Metal capture (`snapshot-presented`), slider groove/handle and tab geometry, native context menus, double-click, and the application's own model MIME/drop-event path. The latter is intentionally scoped to Qt drag/drop handling, not an OS pointer drag. Focus retries are bounded and idempotent; mutations are never replayed. Background sessions reject these input paths. See the playback, Spellbook, relink and curves expansion (historical report retained outside Git).
