# Prepare and run a media procedure

Use `task` to prepare the authored `media-insert-undo` procedure. It searches for
one declared media asset in Name mode, physically drags it onto V1 at zero, keeps timeline
settings if the exact empty-timeline format dialog appears, verifies insertion,
then physically undoes the edit and verifies restoration. Captures are retained
before editing, after search, at the optional dialog, after insertion and after Undo.

## Prepare

Start an exploratory session from the selected build. Open an empty, unlocked
V1/A1 timeline in the standard split layout: video above audio, one timeline panel
visible. Declare expectations from the fixture or functional script before input.
Select Name search during fixture setup; preparation and execution verify it.
The current procedure supports one whole video clip with a declared positive
duration; it expects no trim, retiming, audio placement or new tracks.

```json
{
  "recipe": "media-insert-undo",
  "values": {
    "timelineId": "OBSERVED_TIMELINE_ID",
    "query": "motion_25",
    "expectedName": "motion_25.mp4",
    "expectedStatus": "1 match in 1 clip",
    "assetId": "FIXTURE_ASSET_ID",
    "durationSeconds": 8
  }
}
```

Pass that object to `tool SESSION.json task JSON`. Preparation overlaps independent
Window Server, Qt and CLI reads, resolves targets, checks empty-timeline geometry,
validates every path and retains the plan. Its `timing.preparationMs` includes
discovery, compilation and retention. It performs no application input and does
not reserve targets. A subsecond preflight is a measurement goal, not a timeout
that should hide slow or incomplete observations.

Review the returned plan once, then use its `run` command and retained request ID.
The compact result exposes each phase's observations and capture paths in
`summary.phases[].summary`; `evidence` there points to the original retained images.
The persistent JSON-lines connection can send the reviewed plan object with that
ID to avoid restarting Node. After a lost reply, use the returned `inspect` command;
never resend a plan or an uncertain application mutation.

## How discovery and input work

- `query {"question":"media-search"}` returns the field, status, names, selection
  and result-model geometry from one fresh Qt observation.
- `observe` and `wait` accept `within`, an exact ancestor selector such as
  `{"class":"MediaPanel"}`. Snapshot-local parent edges restrict the answer to
  that widget subtree. Multiple matching ancestors are Blocked. No graph database
  or cross-session widget cache is involved.
- `wait.conditions` can require exact `modelNames`, field text and status in the
  same observation. A partial model cannot satisfy the names condition.
- `geometry` accepts `trackIndex` and `timeSeconds` instead of `clipId` to locate
  an empty track. It uses the selected package's exported painter functions and
  rejects absent tracks and offscreen points.
- Physical drag accepts `itemText` on an observed model view and
  `toTimelinePoint` on an observed canvas. The harness resolves the unique current
  row, its viewport and the destination at dispatch. This remains real OS pointer
  input; it does not insert through the CLI or synthetic Qt drop events.

The track index belongs to the specified video or audio canvas, not the combined
CLI track list. The authored procedure uses index zero on its qualified video
canvas. Other layouts need a separately reviewed binding rather than a guessed
destination.

## Branches and evidence

`query {"question":"format-dialog"}` recognises both exact explanatory labels and
the two enabled buttons of the known empty-timeline dialog. Its reviewed plan
captures that dialog, refreshes its bindings and physically chooses **Keep Timeline
Settings**. Unknown dialogs, changed labels, extra buttons and popups stop the plan.

The `media-insertion` query is a narrow, independent CLI oracle: it checks the
expected asset, source/timeline ranges, unchanged track identities/settings and
absence of unrelated clips or links. Undo must restore the original timeline,
tracks, links and multicam catalogs. The agent still reviews retained images for
visual requirements. Recipe completion is exploratory evidence; it does not
promote a canonical check to Pass.

Prepare the whole known procedure before waiting on search or ingest; no agent
turn is needed to assemble the next known step while the application works. Keep
desktop actions sequential. Parallelize independent read-only transports or
offline compilation, not competing mouse/keyboard actions, CLI calls sharing the
same mailbox, or Qt calls sharing its bridge mailbox. Keep operation journals and
evidence writes ordered. Parallel readbacks are not an atomic state snapshot.

For unfamiliar functionality, use the same pattern: declared fixture and expected
outcomes, scoped observations, reviewed short phases, independent state checks,
captures and a stop at unexpected state. Do not invent a route through an
unobserved UI or skip the gesture the functional script asks to test.
