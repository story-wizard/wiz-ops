# V1 scope proposal

The source inventory in [v1-candidate.json](../scope/v1-candidate.json) records 143 candidate definitions: 57 packaged engine, 77 foreground desktop and nine background service checks. It remains **Proposed**, with no full-scope approver or approval time. The separate accepted registry permits reuse of 137 definitions in custom courses; it does not assert passing execution.

All 137 original checklist rows remain visible: 77 have mapped counterparts, 32 have none, 24 NAS rows are deferred and four are undefined placeholders. The existing Partial label is an inventory disposition, not an assertion that every mapped criterion is incomplete or fully satisfied. Consult the original criterion and the specific executable assertions.

Fresh is the empty starting project. Each check constructs the synthetic media and state it needs. Story-user and Large remain future versioned inputs; their absence does not remove credit for a completed Fresh criterion. NAS remains deferred.

The desktop/service target is an instrumented runtime and is distinct from packaged-engine evidence. Release qualification, second-machine execution, human handoff, remote build integration and shared publication each require their own retained evidence.

## Review and integrity

`npm run scope:check` compares course revisions, ordered IDs, fixture-recipe hashes, original row identities and mappings. It does not launch Wizard or promote tests to acceptance. A changed definition must be reviewed before its accepted hash is updated.

During the Ops import, source checklist files moved to `catalog/` and historical workbook outcomes/notes/comparisons were removed. The checkpoint hash was updated for that explicit source-only transformation; original row IDs, criteria, check definitions, acceptance membership and fixture recipes were preserved. Historical run reports remain outside Git.

## Before V1 acceptance

Review scope and required variants, qualify the intended package/runtime, retain meaningful wrong-result and interruption evidence, demonstrate save/relaunch and a human checkpoint, establish team-accessible reports, and have another developer repeat the workflow. Optional build integration must not make CI wait for a person. No delivery gate in the manifest is waived by this import.

For any time-saving comparison, record actual preparation, execution, hands-on testing and investigation time. The original workbook does not supply an elapsed-time baseline.
