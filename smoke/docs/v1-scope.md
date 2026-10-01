# V1 scope proposal

The source inventory in [v1-candidate.json](../scope/v1-candidate.json) records 143 candidate definitions: 57 packaged engine, 78 foreground desktop and eight background service checks. It remains **Proposed**, with no full-scope approver or approval time. The separate accepted registry permits reuse of 137 definitions in custom courses; it does not assert passing execution.

All 137 original checklist rows remain visible: 77 have mapped counterparts, 32 have none, 24 NAS rows are deferred and four are undefined placeholders. The existing Partial label is an inventory disposition, not an assertion that every mapped criterion is incomplete or fully satisfied. Consult the original criterion and the specific executable assertions.

Fresh is the empty starting project. Each check constructs the synthetic media and state it needs. Story-user and Large remain future versioned inputs; their absence does not remove credit for a completed Fresh criterion. NAS remains deferred.

## Proposed first required course

Use the existing [accepted-automated course](../examples/accepted-automated.json) as the proposed Fresh-only V1 execution scope. It contains all 137 accepted definitions linked to Logan's checklist. Keep failed and blocked checks in that course. A green subset is useful developer feedback, but cannot stand in for the full course.

| Required lane | Checks | What its evidence establishes |
|---|---:|---|
| Packaged engine | 57 | The explicitly selected package executes the operations and produces the asserted project, media and output state. |
| Background services | 7 | The retained instrumented app and its workers satisfy the selected service contracts. |
| Foreground desktop | 73 | The retained instrumented app responds to the authored interaction and state checks. |

This is a proposal for required membership, not a new approval record. The broader 143-definition inventory remains unchanged: five unlinked team additions and the provisional idle-CPU check remain candidates outside this proposed course. Existing acceptance applies to check definitions, not to runtime results or the complete V1 delivery scope.

Fresh requires versioned synthetic fixture recipes, media hashes, the expected timeline/project state for each check, and disposable output projects. Missing or changed inputs must block execution. Story-user and Large need separately versioned fixture manifests, an agreed set of representative media and expected states before becoming selectable; silently substituting Fresh is not allowed.

For this slice, defer human handoff, shared hosting/publication, remote build dispatch, NAS and the two unavailable project variants. Keep their delivery gates open. Human judgments such as playback quality and calibrated colour agreement remain unqualified even when related automated assertions pass.

## Acceptance evidence for the first delivery

Retain the selected package/runtime identities, source snapshot, frozen course, fixture identities, per-check observations and a readable local report outside Git. Require:

- A real Fresh course through the imported runner and CLI, with project/media/output readback.
- Rejection of stale plans and altered fixtures before app operations.
- An interrupted mutation recorded as Unknown, later checks Blocked, no automatic replay, and verified cleanup of owned engine, ingest and desktop processes where exercised.
- Focused wrong-result checks that prove assertions reject incorrect successful responses, bad renders and failed ingest. These are runner regression evidence; they do not replace a real app course.
- A complete required-course run on the intended runtime, with every failure or blocker resolved or explicitly reviewed. Mixed packaged and instrumented builds must retain both identities and cannot claim single-package release qualification.

The desktop adapter explicitly binds GUI search to the worker in the selected preparation package; reports retain both the instrumented app and preparation-package identities. Unset-rate export now uses an app-created empty project and therefore runs in the foreground desktop lane. Its check ID and accepted expected result are unchanged; acceptance metadata records the corrected target. Populated unset-rate export remains unqualified. The combined preview check verifies Inspector state and Undo but remains Blocked pending a supported node and defined preview interaction. Blur thumbnails from an internal render path are not evidence of a live-preview contract. Playback-loop and Spell-tab duplication still need supported controls. Preserve failing or blocked outcomes until the original criterion is exercised.

The desktop/service target is an instrumented runtime and is distinct from packaged-engine evidence. Release qualification, second-machine execution, human handoff, remote build integration and shared publication each require their own retained evidence.

## Review and integrity

`npm run scope:check` compares course revisions, ordered IDs, fixture-recipe hashes, original row identities and mappings. It does not launch Wizard or promote tests to acceptance. A changed definition must be reviewed before its accepted hash is updated.

During the Ops import, source checklist files moved to `catalog/` and historical workbook outcomes/notes/comparisons were removed. The checkpoint hash was updated for that explicit source-only transformation; original row IDs, criteria, check definitions, acceptance membership and fixture recipes were preserved. Historical run reports remain outside Git.

## Before V1 acceptance

Review scope and required variants, qualify the intended package/runtime, retain meaningful wrong-result and interruption evidence, demonstrate save/relaunch and a human checkpoint, establish team-accessible reports, and have another developer repeat the workflow. Optional build integration must not make CI wait for a person. No delivery gate in the manifest is waived by this import.

For any time-saving comparison, record actual preparation, execution, hands-on testing and investigation time. The original workbook does not supply an elapsed-time baseline.
