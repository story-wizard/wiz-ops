# V1 scope proposal

The source inventory in [v1-candidate.json](../scope/v1-candidate.json) records 165 definitions, including two exploratory physical definitions excluded from the 163-check runnable catalog. The runnable catalog contains 57 packaged engine, 98 foreground desktop and eight background service checks. It remains **Proposed**, with no full-scope approver or approval time. The separate accepted registry permits reuse of 137 definitions in custom courses; it does not assert passing execution.

All 137 original checklist rows remain visible: the runnable catalog maps to 82, 27 have no counterpart, 24 NAS rows are deferred and four are undefined placeholders. The existing Partial label is an inventory disposition, not an assertion that every mapped criterion is incomplete or fully satisfied. Consult the original criterion and the specific executable assertions.

Fresh is the empty starting project. Each check constructs the synthetic media and state it needs. Story-user and Large remain future versioned inputs; their absence does not remove credit for a completed Fresh criterion. NAS remains deferred.

## Accepted core and default mixed course

The fresh default is `smoke-full`: 157 checks, comprising 137 accepted definitions plus 20 maintained qualification candidates. Its lanes contain 57 engine, 93 desktop and seven service checks, including 13 physical paths. The accepted-only `automated-full` course remains available. Use the existing [accepted-automated course](../examples/accepted-automated.json) to compose the accepted core. It contains all 137 accepted definitions linked to Logan's checklist. Keep failed and blocked checks in that course. A green subset is useful developer feedback, but cannot stand in for the full course.

| Required lane | Checks | What its evidence establishes |
|---|---:|---|
| Packaged engine | 57 | The explicitly selected package executes the operations and produces the asserted project, media and output state. |
| Background services | 7 | The selected package and its workers satisfy the authored service assertions, with foreground input disabled. |
| Foreground desktop | 73 | The selected package, with externally attached tools, satisfies the authored interaction and state assertions. |

The maintained default adds physical paths, external reload, source-colour override, generated-graphic bin drop as candidates. Membership does not promote them into the accepted registry. Five unlinked team checks, idle CPU measurement and two exploratory physical definitions stay outside the default. Existing acceptance applies to exact definitions; runtime results and full delivery acceptance remain separately recorded.

Fresh requires versioned synthetic fixture recipes, media hashes, the expected timeline/project state for each check, and disposable output projects. Missing or changed inputs must block execution. Story-user and Large need separately versioned fixture manifests, an agreed set of representative media and expected states before becoming selectable; silently substituting Fresh is not allowed.

For this slice, defer human handoff, shared hosting/publication, remote build dispatch, NAS and the two unavailable project variants. Keep their delivery gates open. Human judgments such as playback quality and calibrated colour agreement remain unqualified even when related automated assertions pass.

## Acceptance evidence for the first delivery

Retain the selected package/runtime identities, source snapshot, frozen course, fixture identities, per-check observations and a readable local report outside Git. Require:

- A real Fresh course through the imported runner and CLI, with project/media/output readback.
- Rejection of stale plans and altered fixtures before app operations.
- An interrupted mutation recorded as Unknown, dependent checks Blocked, no automatic replay, and verified cleanup of owned engine, ingest and desktop processes where exercised.
- Focused wrong-result checks that prove assertions reject incorrect successful responses, bad renders and failed ingest. These are runner regression evidence; they do not replace a real app course.
- A complete required-course run on the intended runtime, with every failure or blocker resolved or explicitly reviewed. Selected-package and external-tool identities must both be retained. Never substitute a different instrumented app.

Desktop and service checks now attach to the selected package. Retain package, shipped CLI, adapter and native-driver hashes. Individual rows still have gaps: for example, warm live-grade sampling does not exercise a cold-cache first frame, source-colour override requires its actual control, and physical Spellbook fixtures require operations present in the chosen build. The report preserves missing capabilities and failed assertions.

Release qualification, second-machine execution, human handoff, remote build integration and shared publication each have their own retained evidence and delivery gates.

## Review and integrity

`npm run scope:check` compares course revisions, ordered IDs, fixture-recipe hashes, original row identities and mappings. It does not launch Wizard or promote tests to acceptance. A changed definition must be reviewed before its accepted hash is updated.

During the Ops import, source checklist files moved to `catalog/` and historical workbook outcomes/notes/comparisons were removed. The checkpoint hash was updated for that explicit source-only transformation; original row IDs, criteria, check definitions, acceptance membership and fixture recipes were preserved. Historical run reports remain outside Git.

## Before V1 acceptance

Review scope and required variants, qualify the intended package/runtime, retain meaningful wrong-result and interruption evidence, demonstrate save/relaunch and a human checkpoint, establish team-accessible reports, and have another developer repeat the workflow. Optional build integration must not make CI wait for a person. No delivery gate in the manifest is waived by this import.

For any time-saving comparison, record actual preparation, execution, hands-on testing and investigation time. The original workbook does not supply an elapsed-time baseline.
