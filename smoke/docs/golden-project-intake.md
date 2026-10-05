# Supplied Golden Projects

A Golden Project can arrive as a `.wiz` directory with external media links. Start by learning what is there. Keep the supplied project unchanged and retain the inventory outside Git.

## Intake available now

The CLI reads saved project metadata without launching Wizard or accessing referenced media. It records project format, entry timeline, asset IDs, media root declarations, source references, recorded codecs, durations, stream flags, frame rates, resolution, color space and timeline IDs. Missing values remain unknown. It makes no codec allowlist: an unfamiliar codec stays in the inventory for qualification against the selected Wizard build.

```sh
node scripts/smoke.mjs golden inspect \
  --path /absolute/path/Representative.wiz \
  --out /absolute/external/workspace/golden-inventory.json

node scripts/smoke.mjs golden roles \
  --file /absolute/external/workspace/golden-inventory.json \
  --requirements examples/golden-roles.json \
  --out /absolute/external/workspace/golden-role-candidates.json
```

These commands work without the local service. Output files must be new files outside Git and outside the supplied project. A downloaded archive must first be extracted into a local directory; intake does not unpack or execute its contents. Metadata directory/file symlinks are rejected. Intake has a 16 MiB per-file / 64 MiB total metadata budget and 20,000 record ceiling, and checks retained bytes and directory membership again before returning.

The inventory hashes the selected saved metadata, not every dependency of the project. It reads `project.json`, the asset registry when present, `assets/clips/*.json`, the timeline index when present and `timelines/*/timeline.otio`. Registry-only assets remain in the inventory with missing technical metadata. Saved timeline structure counts help distinguish empty starting timelines from populated cuts. Documents, effects, Spells, generated media, caches, history and other project files still need discovery during full checkpoint qualification. A consistent metadata read is not an application-owned checkpoint of a running project.

Older metadata may have frame counts and only a decimal frame rate. Intake labels the resulting duration as an estimate and retains that decimal rate separately; it never invents an exact rational rate. Duration-role matches based on that estimate still require a source probe before execution.

Source media availability and hashes remain **Unchecked**. Recorded technical properties are discovery hints. An inaccessible NAS reference must not cause an automatic mount, recursive search or replacement with a similarly named file. Root mappings and local media verification will be explicit steps when a real project is supplied.

## How tests will use it

Tests ask for semantic roles rather than filenames: a short video with audio, a long video, an audio-only source, a still, or a particular codec. `golden roles` returns all matching recorded candidates; it does not choose one, mutate a project or authorize execution. Unknown durations cannot satisfy a duration requirement. Empty matches stay visible so an agent can explain which input is missing.

Long and short are test requirements, not global buckets. A trimming test might need two seconds of usable source; a sustained-playback test might need twenty minutes. Keep duration and frame-rate information explicit, including variable-rate/timing uncertainty during live qualification. Small evidence windows can sample a long clip without copying or exporting hours of media.

| Stage | What to retain |
| --- | --- |
| Discover | This metadata inventory, original references, unknown fields and unhandled project sections. |
| Verify inputs | Approved root mappings, actual media byte hashes, independent probes and source availability. Preserve two distinct assets even if their bytes match. |
| Freeze | Owner save/settle receipt, application-owned checkpoint manifest and dependency closure. A closed-project copy recipe is an alternative only after its required files and exclusions are reviewed. |
| Bind | Chosen asset/timeline IDs per role, usable source ranges, expected initial state and why the asset meets each requirement. |
| Prepare | A disposable run copy from the frozen checkpoint. Relink only that copy; retain mappings. Existing runner ownership/build guards still apply. |
| Execute | Candidate test definition, selected build, tested gesture/operation, independent assertion and declared evidence. |
| Report | Fixture/checkpoint identity, selected role bindings and ranges, before/after observations, output hashes and Pass/Fail/Blocked/Unknown. |

Keep fixture identity in run plans, source snapshots, captures, investigations and repro handoffs. A changed source/checkpoint, role binding or expected reference needs a new frozen plan. Repro uses the original manifest and bindings; if they are unavailable, record the gap instead of switching assets.

## Expectations and new checks

Our current tests use exact synthetic patterns, timing and transcript anchors. Those assertions remain useful. They cannot be reused unchanged on arbitrary media just by replacing the pack.

1. Reuse the existing setup/action/assertion/evidence/cleanup helpers.
2. Declare the populated-project assumptions and role requirements.
3. Confirm roles from actual sources and observable project state.
4. Define the oracle before performing the tested action: an independently decoded reference, invariant, reviewed transcript phrase, reference frame/time range or approved audio sample.
5. Compare outputs at known source/timeline times, not guessed pixels or filenames. Require an audio capture for audible behavior; a timeline state alone cannot establish it.
6. Keep evidence bounded: representative before/after frames, short playback recordings, exact JSON state and diagnostic logs. Original media stays local unless separately approved for sharing.
7. Add the adapted check as a candidate, qualify it on the designated build and obtain lead acceptance before canonical membership changes.

Useful first candidates are populated-project open/reopen, missing-link detection and relink on a disposable copy, mixed-codec decode, playback near the beginning/middle/end of a long clip, source-range edits, audio routing, still/image sequences, variable-rate timing and color interpretation. Each needs an explicit assertion and evidence contract; a file appearing in the bin is not decode/playback acceptance.

## Current execution boundary and next slice

Intake and role-candidate discovery are implemented. The maintained course still runs on **Fresh**; Story-user and Large remain unavailable to execution. Selecting either still fails before app mutation. No automatic import, cloning, relink, probe, ingest or golden-course execution is performed by intake.

When the supplied project arrives, the next slice is to inspect all supported project sections, verify approved local media roots, expose/consume the application-owned saved-project checkpoint capability, and qualify one populated-project open/reopen check. Then bind and adapt test families incrementally. We can retain the synthetic checks alongside representative-media checks and see which each covers.
