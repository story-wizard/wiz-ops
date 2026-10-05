# Athanor investigation update, October 4, 2026

The investigation workspace now brings the case brief, retained evidence, attempts and editable bug draft into one panel. The case list can be searched and filtered by the next stage of work.

## Case review

Select a case to see its expected and observed behavior, functional steps and Ops used. Evidence opens inline, including before/after screenshots and declared video or audio. Choose an attempt to inspect the original observation or a later repro. The Attempts tab shows outcome and definition changes alongside diagnostic collection.

Classification, duplicate grouping and resolution remain recorded decisions. Identical observations suggest cases to compare; they do not automatically group them. Original test outcomes stay intact.

## Agent handoffs

Choose a triage, repair, repro or review task. Athanor produces a scoped prompt and JSON context; exported investigations include all four in `tasks/`. Returned triage proposals can be previewed before application. Preview checks the revision, case IDs, classification and duplicate groups without changing the investigation.

The CLI supports the same task, proposal, evidence and draft actions. Read [the investigation guide](investigations.md) for commands and JSON examples.

## Focused repro

Investigation-managed preparation records the selected app, diagnostic selection and admission IDs before setup begins. The page shows retained progress and a repair prompt on setup failure. Ready plans are checked against the exact build and diagnostic course before Start. Normal runs and investigation runs share execution guards.

An admitted repro is linked when it finishes and the investigation is inspected or polled. A lost response can recover the original request and run; it does not create a second attempt. Uncertain app mutations still require inspection. Close a settled, unstarted selection when the planned cases have changed.

## Drafts and packaging

Summary, Reproduction steps and Expected result are editable. Saving wording or linking another attempt clears prior confirmation. Earlier wording remains available for review but is not silently reused for a new attempt. The reporter field limits include the appended run context.

Bug Reporter parcels keep the edited fields and checksummed evidence. Confirmation rechecks retained repro hashes, and parcel screenshots come from a qualified before/after process pair. Human review and actual submission remain separate. Evidence delivery and app-owned attachment import still need selected-build acceptance.

Source snapshots now include the Bug Reporter module required by investigations. A regression check starts the frozen source service and checks its investigation endpoints and browser assets without launching Wizard.
