# Repair Athanor for a new build or feature

Start with the error, the selected build and the intended checks. A preparation failure means no tests have started. A failure inside a run is an observed test result; preserve that run and its evidence.

Within an authorized test task, diagnose and repair harness setup locally, qualify the shared fix, then rerun affected checks after known cleanup. Choose routine workspace and tool settings yourself. Keep the selected package and test expectations fixed; source adoption on a managed worker, system changes, new paid calls and external publication stay within their separately authorized scope.

## Recover the run

A blocker starts recovery work; it does not end the task. Investigate the cause, repair the shared harness problem in isolation, qualify the exact repair, and rerun affected checks after known cleanup. Continue independent checks while recovering. Ask to apply a tested fix to the installed harness only after its patch and results are ready; keep production unchanged until approved. Preserve every original outcome and App failure. Reconcile uncertain input before further action; never replay it. If access, ownership, credentials or another external prerequisite prevents progress, retain the exact required action and continue work that does not depend on it. Success means executing the intended checks with valid assertions, not removing blockers by weakening them.

A full-registry difference remains a review finding. The prepared plan also freezes per-operation admission against reviewed request, response and error contracts, including shared desktop setup. Qualified independent checks can run; missing APIs remain N/A and changed unqualified contracts remain Blocked. Both packaged and desktop dispatch enforce the frozen admission. Read the retained schema review to repair each remaining contract and prepare a new attempt.

## Inspect the build

Use the existing service URL with `smoke.mjs setup`, `builds` and `context`. Identify the exact local app, tag or asset and package hash. Read the packaged CLI schema without starting Wizard:

```sh
"/absolute/path/to/Wizard.app/Contents/MacOS/wiz-cli" project --schema --no-spawn
```

Use the shared `readCliSchema` in `runner/cli-schema.mjs` for harness code. It requests the full registry and supports the older operation-scoped entry point only when root discovery is unsupported. A single-operation fragment, malformed response, permission failure or timeout is not a qualified registry.

Retain that JSON and your comparison outside Git. Compare it with `runner/contracts/installed-schema.json`, including requests, responses, required fields, enums and referenced definitions. Ignore object key order when comparing. Compute structured schema identities with the existing `digest` helper in `runner/files.mjs`; hashing the JSON file's bytes produces a different identity.

The selected package and instrumented desktop tools are separate inputs. A desktop schema failure needs comparison with `runner/contracts/desktop-schema.json` and qualification of the paired runtime. A packaged qualification cannot approve a different desktop CLI or Cocoa plugin.

## Choose the repair

- Preparation automatically accepts conservative structural extensions of the baseline or a retained reviewed contract: object-key reordering, new operations (and their new result/error definitions), request enums that retain every old value, and optional properties on closed objects without pattern properties. These do not require a per-build hash patch. The prepared plan records `schemaCompatibility`, the reviewed anchor and the accepted differences; readiness still pins the selected build's exact schema hash.
- Required-field, existing response/error, type, default, description, constraint, composition and reference changes still need review. Descriptions can change time-clock or default semantics, as the October 6 contract demonstrates. Adding a named property to an open object may constrain formerly allowed input, so that also needs review. Failure names the differing paths and retains a complete comparison receipt under the external workspace's `schema-reviews` directory.
- If an existing reviewed schema matches, inspect the source/service version and configured tool paths. Refresh the source service or install the matching bundle.
- For a compatible, reviewed change, add its exact structured hash and comparison basis to `runner/contracts/packaged-schema-qualifications.json`. Tie it to the existing baseline hash. Keep unreviewed changes blocked. Do not replace the baseline merely to make preparation green.
- If parameters, responses or behavior changed, trace the affected checks and shared adapters. Update their requests and independent assertions, then add a regression that rejects the old incorrect behavior. Preserve each test's stable ID where its purpose is unchanged.
- For a new feature or user path, add a candidate check with fixture needs, readable steps, expected outcomes and evidence requirements. The testing lead accepts it before it enters canonical or accepted courses. Saving a custom course does not accept new tests.
- If the app itself is defective, retain the failure and reproduction context. A repair to Athanor must not disguise an app failure or reduce the assertion to make it pass.

## Verify and deliver

Run `npm test` and `npm run scope:check` from `smoke/`. For a regression, demonstrate failure with the old behavior and success with the repair where practical. Prepare the actual selected package again. Check the added prerequisites and frozen package, schema, fixture and source identities.

Run affected checks within the user's authorized scope before relying on a changed behavioral mapping. Foreground checks control the desktop. Preserve Fail, Blocked and Unknown; never retry an uncertain mutation just because its response was lost.

Keep changes in the source checkout. Preserve old plans, reports and installed versions. Follow `docs/maintaining-harness.md` to build a new versioned bundle after committing. Return the cause, schema differences, source changes, checks executed, evidence and remaining work. Jira writes, merging, publication and messages require their own user request.

## Retain and export a repair

Use `scripts/repair.mjs` from `smoke/` to keep one external record for a blocker family and prepare a local PR preview. The family is the repository plus a behavior contract ID and version, such as `embedded-editor-focus` version `1`. Check names, dates and error wording are occurrences, not family identities.

```sh
node scripts/repair.mjs record --data-dir /external/repair-workspace --input /external/reviewed-input.json
node scripts/repair.mjs list --data-dir /external/repair-workspace --investigation INVESTIGATION_ID
node scripts/repair.mjs export --data-dir /external/repair-workspace --id REPAIR_ID --repo /absolute/source-checkout --out /external/new-preview
```

Investigation repair tasks and their first-read packets include these entry points. Use the existing task file and original case/report; the record verifies its retained report hash and keeps the original verdict. For a campaign that never entered an investigation, use `campaignReport` instead of `taskFile`. This accepts the campaign summary's `jobId` and `checks` without inventing an investigation admission. Label demonstration occurrences with `syntheticControl: true`; a later passing qualification is a follow-up, not another blocked run.

The reviewed input has these fields:

| Field | Meaning |
| --- | --- |
| `requestId`, `revision` | Stable ingestion request and current record revision; new families start at zero. Repeating the same request is idempotent; conflicting contents are rejected. |
| `repository`, `contract` | Repository name and `{id, version}` for the behavior family. |
| `classification` | `{kind, reason, evidence}`. Kind stays Harness, App, Environment or Unresolved and must agree with an investigation task when supplied. Evidence links remain private. |
| `taskFile` or `campaignReport`, `caseId`, `reportSha256` | Exact original occurrence and the SHA-256 of its report bytes. |
| `source` | Reviewed `base`, `head`, `canonicalMain`, `branch`, `reviewedPaths`, `patchSha256`, `reviewedPatch` and `reviewer`. Only Harness repairs in `story-wizard/wiz-ops` can export source. |
| `public` | Explicitly authored plain text: `title`, `problem`, `change`, `validation`, `remaining`. No evidence paths, credentials, raw commands or automatic observation excerpts. |
| `dependencies` | Repository, optional head, patch SHA-256 and PR number; optional private `evidence` is omitted from export. |
| `proofs` | Kind, exact head/patch SHA-256, status and private evidence reference. Native Pass requires positive executed tests and zero failures/skips. Packaged Pass also requires the exact `packageHash`. |
| `legacyRecord` | Optional path to the earlier local v1 dry-run receipt. Its source must match; any uncertain publication remains uncertain. |

For an occurrence-only update, omitted source, public copy and dependencies retain their reviewed values. Explicit null clears source/public copy. Report hashes bind the original run/check identity; different bytes under that identity require projection reconciliation, not another counted occurrence. A new head keeps earlier proof as history; qualification for the new head is pending until new evidence arrives. Moving the same reviewed patch file or correcting its reviewer note preserves the PR identity. Proof for a native fixture that skipped does not satisfy required native qualification.

The preview directory contains exactly `repair.patch`, `PR-PREVIEW.md` and `manifest.json`. The manifest binds the exact base/head/tree, reviewed source paths, patch and preview byte hashes, dependency identity, recorded qualification gates and publication state. The command requires a clean reviewed checkout with the approved Ops remote and exact reviewed patch bytes. It rejects App paths, unapproved changes, symlinks, path escapes and changed existing export contents. Repeating an identical export reuses it. Records and outputs belong outside Git; no complete investigation, attachment directory or raw report is copied.

This command only records and exports locally. Publication Unknown or Conflict remains a reconciliation gate. A later `prReceipt` may link a retained read-only GitHub PR response only when its repository, branch and head agree exactly; a matching identity still grants no write or retry. Record and export never publish. Review the public preview and source patch before authorizing the separate publisher described below.

## Create an approved draft PR

Use the requesting developer's own GitHub identity. The manual local broker validates an actor-bound reviewed request before retrieving that developer's explicitly selected credential. It keeps credentials on the developer's Mac and passes them privately to the fixed Ops publisher. The shared MBP worker receives no personal credential.

Read [manual publication setup and qualification](repair-publication.md) for the installed files, policy, approval envelope, proof receipts, one-shot command and recovery behavior. CI and packaged checks may remain Pending in a draft. Executed framework and scope proof are required; desktop changes also need native proof with no skips. Source must be one reviewed publication commit directly on the approved remote base.

Record/export remains preview-only. The separate publisher checks exact source/PR bytes, serializes each repair family and retains intent before push/create. It rechecks current PR state and the approved developer's author ID/login on creation and reuse. An uncertain outcome never authorizes repeating a mutation. Later-head PR updates, automatic merge and worker adoption are outside this slice.

Existing GitHub App grants remain supported for their separately qualified path. The per-developer broker does not require an App, mint an installation token, or claim the developer's existing credential is restricted to Ops. Ops write enforcement comes from the fixed transport and reviewed request. The current manual host separation does not sandbox an unrestricted agent running as that same local developer.

## Reviewed nightly: 2026.10.06-2a8b246

This nightly is qualified by structured schema hash
`285748db89d4172a33dfd5c5b1f4478681326fd4d2f3d20e70f6e6a249f5b1bb`
against the unchanged installed baseline. Its 165 operations include four additions
and seven changed definitions. The official macOS ZIP hash is
`4799444a12626eaef598e39ade2b8010030cc2c8625c58265eba51343617b32b`.

| Contract change | Existing course use and verification |
|---|---|
| Exact keyframe time objects and clip-left-edge clocks | No current course calls the three changed keyframe operations. Future checks must use the documented clock and verify exact timing independently. |
| Timeline search scope; no predicate/limit for that scope | Existing CLI checks use project, assets and bin scopes. They assert exact asset IDs, exhaustive completion, scope exclusions and transcript timestamps. Keep these assertions. |
| Camera RAW category default | A-IN-05 uses ordinary MOV and explicit still category; it asserts encoding, provenance and the ingested transform. RAW defaults need a separate fixture/check. |
| Eighth preview resolution | Current checks do not call render.set_render_mode. Existing quality controls retain their own UI checks. |
| Time-remap, freeze-frame and graph analysis additions | Current courses do not invoke these new operations; their presence does not add test coverage. |

The reviewed contract retains only the eleven changed/added operation definitions
from the shipped CLI and reconstructs the exact reviewed hash with the baseline.
The qualification's `operationsFile` points to these retained definitions so later
compatible extensions can inherit the review. Its reconstructed hash must match
the qualification; merely naming a file cannot approve a different contract.
It also checks that removed operations, changed required fields, narrowed search
scopes, altered keyframe time objects, removed resolution values and a mismatched
baseline remain blocked. Preparation and application test outcomes are retained
separately in the external workspace. An older failed preparation stays failed;
update the source and prepare again as a new attempt.

This historical review checked every existing operation. Current preparation
also checks each selected check's required operations, shared setup calls and
desktop dependencies against reviewed contracts, as described above.
Compatibility permits test execution; independent assertions still decide Pass.
A new application dialog, such as the fresh-project version warning, needs a
separate startup-flow repair and cannot be handled by schema comparison.

For a newly generated desktop Golden Project, `prepareDesktop` closes its
headless engine before recording the selected package's `CFBundleVersion` as
`wizard_version`. The October 8 shipped headless creator omits the stamp that
the GUI's ProjectManager supplies. This records the actual fixture creator;
it leaves `wiz_format_version`, timelines and media unchanged. The external
`fixture-version.json` receipt retains the selected package identity and
before/after manifest hashes. Existing differing or empty writer stamps,
redirected paths and other project names are blocked. Supplied projects and
older-format migration tests do not use this repair. Do not dismiss migration
dialogs or rewrite historical project stamps to make a check pass.

## Reviewed nightly: 2026.10.08-45854f6

The retained shipped schema has 166 operations and structured hash
`77462be3c4ea7d5efad8894a6b183d0bf26a56b592d90ecff9a0c36fabb82db3`.
Its results, errors and other top-level fields match the unchanged baseline.
Compared with the October 6 reviewed contract, it adds `media.add_assets`, adds
optional `media.sample_frames.keyframe_tolerance`, and changes four document
operation descriptions. No current runner or desktop check calls those two
media operations. Omitting keyframe tolerance still requests exact frames.

Document rename now moves the Markdown file and changes its project-relative
path and identity. `A-UI-04` chooses its assertions from the qualified rename
description: old contracts must preserve identity and path; the new contract
must move to the requested filename, remove the old file and use the new path
as identity. Both routes verify saved content after reopening, preserve the
imported document and source file, and delete only the selected imported copy.
The check retains `document-lifecycle.json` beside its owned project.
`D-DOCUMENT-EDIT` uses the create response's path and identity and never renames,
so its requests need no change.

Filesystem-backed component tests cover both contracts and reject stale IDs,
retained old files, lost contents and incorrect deletion. They validate the
harness assertions. Application behavior still needs a new preparation and
focused run on this exact package; this review does not turn the earlier 177
Blocked outcomes into Pass. Keep the separate desktop schema gate.

When transferring this repair to a checkout with local work, preserve its
existing October 7 qualification, startup/signature fixes and fixture files.
Merge the new qualification entry and retained operation definitions; do not
replace the destination qualification file wholesale. Prepare a new plan after
changing the runner, and retain the old source version and workspace for rollback.

## Reviewed nightly: 2026.10.09-01169c1

The shipped schema has 162 operations and structured hash
`1b4a4aebf4dda8fa7dea03bb74ebee28d5586feb3c186d6cfeefad147bc91055`.
Top-level fields, results and errors match the unchanged baseline. Compared with
October 8, it removes `generate.catalog`, `generate.image`, `generate.renderers`
and `generate.video`. `generate.graphics` now describes live authored source
folders and an optional separate `resources_path`.

The exact app source removes those dispatch entries. Existing relative source
and entry fields remain supported, but current MGFX fixtures require the retired
renderer-discovery operation. The adapter rejects it before dispatch and retains
Blocked for those checks. No provider call or guessed authoring profile replaces
it. Other checks can use this reviewed package; new MGFX fixture support remains
separate work.

Reviewed entries may retain `removedOperations` alongside their changed/added
operation definitions. Reconstruction must match the exact reviewed hash before
an anchor can qualify future compatible extensions. Unreviewed removals, further
semantic changes and missing existing operations still fail the gate. The
baseline, earlier qualifications and historical results remain intact.

## Copyable request

> Repair Athanor for this build or feature: [identity]. Intended course or checks: [selection]. Failure or missing behavior: [observation]. Read AGENTS.md and docs/build-repair.md. Inspect and compare the actual contract, update the mapping or affected checks as needed, validate the repair and retain the evidence. Preserve old results and the review gate for accepted tests.
