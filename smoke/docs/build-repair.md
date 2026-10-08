# Repair Athanor for a new build or feature

Start with the error, the selected build and the intended checks. A preparation failure means no tests have started. A failure inside a run is an observed test result; preserve that run and its evidence.

## Inspect the build

Use the existing service URL with `smoke.mjs setup`, `builds` and `context`. Identify the exact local app, tag or asset and package hash. Read the packaged CLI schema without starting Wizard:

```sh
"/absolute/path/to/Wizard.app/Contents/MacOS/wiz-cli" project create --schema --no-spawn
```

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

The policy checks every existing operation. Course-specific exclusions remain
deferred until declarations include shared setup calls and desktop dependencies;
the current desktop selection does not retain a complete operation list.
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

## Copyable request

> Repair Athanor for this build or feature: [identity]. Intended course or checks: [selection]. Failure or missing behavior: [observation]. Read AGENTS.md and docs/build-repair.md. Inspect and compare the actual contract, update the mapping or affected checks as needed, validate the repair and retain the evidence. Preserve old results and the review gate for accepted tests.
