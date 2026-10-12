# Investigate a course locally

Athanor keeps the first run, each repro and the human review together. Open **Results → Investigate**, then choose the investigation from the navigation.

## Work through the cases

The left table shows each case's first outcome and next stage. Search by test name, ID, classification or reason; use the stage filters to find cases needing triage, repro or human review. Selecting a row updates one detail panel.

- **Brief:** expected and observed behavior, functional steps, classification, grouping and Ops used. Classify as Harness, Environment, App or Unresolved and record the supporting evidence. Resolved records a decision with its reason; it never changes the first result.
- **Evidence:** choose an attempt, inspect its before/after screenshots and declared image, video or audio evidence, then open state and logs when needed. Capture failures remain visible. Evidence requests check the case, attempt, retained path, bytes and hash.
- **Attempts:** compare the original and later outcomes, expectation, definition identity and diagnostic collection. A passing repro needs review before resolving the case. An Unknown attempt needs inspection before another mutation.
- **Bug draft:** edit Summary, Reproduction steps and Expected result. Save wording separately from evidence, prepare a Bug Reporter parcel, and record a person's review. Draft edits or a new attempt clear previous confirmation. Earlier wording is retained when its attempt changes; review and save it against the new attempt before confirming.

Grouping is an evidence-supported hypothesis. Same-observation hints do not establish a shared root cause. Duplicate cycles and targets outside the investigation are rejected. A block describes setup or capability until evidence establishes an app defect.

## Start with the recorded conclusion

New report cases expose `conclusion`: the expected/observed comparison, first
stopped phase, last completed phase, and work that was not reached. Authored
assertions include their exact values and a link to the checksum-bound proof.
Read this before opening the full journal or a saved project. The Brief and
Evidence tabs, portable reviewer and agent task show the same recorded facts.
Older cases retain their original method/actions; missing values are not filled
in from a later source version.

An agent should return the likely cause with run/check and evidence citations,
what remains untested, and the next useful inspection or focused repro. Keep a
cause hypothesis separate from the recorded facts. A first run with complete
investigation captures still needs a separate linked diagnostic repro and human
review before bug submission. Original diagnostic profiles are read from their
frozen selection, including older records that omitted the explicit profile.

New desktop checks close their action scope when a known result settles. Driver
cleanup and reopening stay in the raw journals without inheriting that check.
Untouched phases can then appear as `Not run`, while a declared reopen phase that
fails its fixture prerequisite remains `Blocked`. Unknown input and unbound
mutations remain explicit. Earlier exports keep the scope information that was
actually recorded; source repairs do not rewrite their phase history.

## Agent triage and repairs

Open **Work with an agent**. Choose triage, repair, repro or review; prepare the selected case's handoff and copy its prompt plus JSON context. Export the investigation when the agent needs a portable evidence package. `tasks/` contains all four prompts and context packets.

Triage tasks also include `triageHints`: proposed groups from exact recorded
missing-operation or shared-prerequisite blockers, with original run/check IDs,
observations and evidence report links. Other failures receive no inferred cause.
Existing classifications, resolved cases and reviewed groups are excluded from
these suggestions. A shared blocker is a grouping hypothesis, not proof of an
identical application defect. The optional `triage-proposal.json` in the portable
package is ready for evidence review and the existing proposal preview; it is
never applied by task generation or export. Reload after any investigation revision
change before reviewing or applying a proposal.

Managed job reports link directly to this workflow. Use the controller's `brief`
for build/course identity, results, handoff state and recovery instructions; see
[Job controller](job-controller.md#investigation-and-agent-handoff). Developer
course runs still use Results → Investigate or the ordinary investigation CLI.

For triage, have the agent return a JSON proposal using the packet's `proposalTemplate`. Paste it or select the JSON file, then press **Preview proposed changes**. Preview validates case IDs, classifications, grouping and revision without saving. Inspect the before/after changes and reasoning, then apply reviewed changes. Reload and regenerate a proposal after a revision conflict.

Repairs belong in the current source checkout. Preserve frozen reports, explain the cause, provide the patch and verification, and identify the checks needing rerun. A task packet supplies context; execution is a separate user-authorized action.

## Prepare and run a focused repro

1. Mark primary cases **Reproduce**. The selection keeps qualification candidates within the maintained course without accepting them into the canon.
2. Open **Focused diagnostic repro**. Review the selected checks and added prerequisites. Choose the designated app; its package hash must match the first run.
3. Press **Prepare diagnostic repro**. The existing preparation pipeline attaches matching tools to the selected build, prepares fixtures and freezes the plan. This can launch Wizard for attachment verification, so obtain desktop availability before preparation.
4. Follow the retained preparation progress. A setup failure exposes the repair prompt. When Ready, press **Start focused repro**. Both normal and investigation runs use the same runner admission, frozen source/plan checks and desktop ownership guards.
5. The completed run links automatically when the investigation is inspected or its open page polls. Inspect the case's new attempt and evidence. Runs started elsewhere can be linked explicitly.
6. Review the bug drafts and evidence. A person records **Confirmed**, **Needs work** or **Rejected**, then submits through Wizard Report a Bug when appropriate.

Each preparation has a durable intent, preparation ID and start request ID. After a lost response, inspect the investigation before retrying. Repeating the original prepare request returns its retained attempt; repeating the original Start returns its admitted run. An unreadable/missing preparation admission is Unknown and is not silently replayed. An interrupted preparation retains its setup evidence and can be inspected before creating a new attempt. Close a settled unstarted selection when triage has changed; active or uncertain admissions cannot be discarded through that control.

The service reconciles retained records when inspected. It does not schedule autonomous reruns. App mutation uncertainty is distinct from recovering a service admission; never replay an Unknown editor operation.

## Agent commands

Run from `smoke/` in a checkout or `workspace/` in a bundle. Use the printed loopback URL for every command.

```sh
node scripts/smoke.mjs investigation create --run RUN_ID --actor "Your agent" --server URL
node scripts/smoke.mjs investigation show --id ID --server URL
node scripts/smoke.mjs investigation task --id ID --task triage --case CHECK_ID --server URL
node scripts/smoke.mjs investigation evidence --id ID --case CHECK_ID --server URL
node scripts/smoke.mjs investigation proposal --id ID --file /absolute/proposal.json --server URL
node scripts/smoke.mjs investigation triage --id ID --file /absolute/proposal.json --server URL
node scripts/smoke.mjs investigation selection --id ID --server URL
node scripts/smoke.mjs investigation prepare --id ID --revision REVISION --actor "Operator" --app /absolute/Wizard.app --request-id UNIQUE_ID --server URL
node scripts/smoke.mjs investigation show --id ID --server URL
node scripts/smoke.mjs investigation start --id ID --repro REPRO_ID --actor "Operator" --server URL
node scripts/smoke.mjs investigation show --id ID --server URL
node scripts/smoke.mjs investigation draft --id ID --file /absolute/draft.json --server URL
node scripts/smoke.mjs investigation review --id ID --file /absolute/review.json --server URL
node scripts/smoke.mjs investigation reporter --id ID --case CHECK_ID --server URL
node scripts/smoke.mjs investigation export --id ID --server URL
```

`investigations --run RUN_ID` finds existing investigations after a lost create response. `investigation close-repro --id ID --repro REPRO_ID --revision REVISION --actor NAME --server URL` closes a settled, unstarted preparation while retaining its history. `investigation link --id ID --run RUN_ID --revision REVISION --actor NAME --server URL` links a terminal run started outside the managed repro flow. Mutations are not retried automatically.

Proposal:

```json
{
  "revision": 1,
  "actor": "Your agent",
  "updates": [{
    "id": "D-BIN-DUPLICATE",
    "classification": "App",
    "disposition": "Reproduce",
    "reason": "Describe the behavior and cite the retained evidence.",
    "duplicateOf": null
  }],
  "log": "Actions taken, evidence inspected and remaining questions."
}
```

Draft edit:

```json
{
  "revision": 4,
  "actor": "Draft editor",
  "caseId": "D-BIN-DUPLICATE",
  "fields": {
    "summary": "Duplicated bin does not persist after reopening",
    "reproduction_steps": "1. Duplicate the retained bin\n2. Save and reopen\n3. Inspect the bin list",
    "expected_result": "The duplicate should remain after reopening."
  }
}
```

Human review:

```json
{"revision": 5, "actor": "Reviewer's name", "caseId": "D-BIN-DUPLICATE", "decision": "Confirmed", "note": "Observed the defect and reviewed its reproduction evidence."}
```

Recording Confirmed rechecks the retained reproduction file hashes. Changed or missing evidence must be repaired or recollected before review.

Confirmation requires an App primary case marked Reproduce, a linked failing diagnostic attempt, required evidence without gaps, current draft wording and fields that fit the reporter after adding run context. Preparing the bounded reporter parcel separately checks screenshot/project/attachment completeness. Confirmation alone does not establish attachment delivery.

## Diagnostic collection

The focused selection freezes `"diagnostics": "investigation"` with the plan. Desktop checks add before/after owned-window screenshots, widget/timeline state and bounded redacted stdout/stderr tails. Each capture records time, PID and launch generation. Qualification requires a same-process/generation pair with four case-owned attachments matching retained source paths and hashes. Identical files preserve source aliases when reports deduplicate bytes. Older associations remain viewable but cannot silently qualify missing proof.

Packaged checks retain their CLI receipts, state/output evidence and local process logs. Video, audio, profiling and app tracing require test-specific qualified collectors. The profile describes what it collects; it does not enable undocumented app settings. Collection failures retain the original verdict and remain available for review.

## Portable reports and Bug Reporter

An immutable export contains `index.html`, `review-data.json`, first and linked interactive reports, `investigation.json`, proposal template, `tasks/`, draft text/JSON, focused selection, curated agent guides and a SHA-256 inventory. Original evidence is verified before copying. App bytes, full projects and media stay in the external run workspace; use `kit --run RUN_ID` for a full repro kit.

The portable reviewer works without a service. Record edits and final review in the live investigation, then export again. The [Bug Reporter bridge](bug-reporter-interop.md) prepares bounded evidence parcels and supports draft-only field prefill through the attached Qt plugin. Native attachment import remains a separate app integration. A person reviews and submits; the local workflow keeps `delivery=not_submitted` and does not publish Jira issues or upload evidence.

## Next improvements from the MGFX validation

The October 11 focused run reproduced a Media Bin duplicate with distinct timeline
and clip IDs but a shared generation ID. The expected/actual comparison reached
the brief, report and portable task, with 80 verified package files. The check
stopped before editing the copy. This gives an agent a useful starting fact;
the responsible duplication code path still needs investigation.

These four slices are implemented in source. Framework and driver counterfactual
checks exercise the reporting behavior; new packaged GUI acceptance remains a
separate run.

| Slice | Current behavior |
| --- | --- |
| Timing and displayed output | D-EDIT-TRIM retains seconds, duration tolerance, source projection and neighbor state. D-SCOPES-VECTOR retains the selected tap, RGB difference threshold, measured source brightness and frame times. Both keep their existing independent oracle. |
| Dependent phases | Authored `requires` names earlier steps. Reports show the unmet phase and its recorded status, plus the original block observation. Unknown remains Unknown and unbound mutations remain unrecorded. This annotates evidence; it does not schedule or retry actions. |
| First read | Portable tasks include `tasks/TASK-first-read.json`. Managed job handoffs link `first-read.json` and its evidence package. These retain the assertion, decisive values, proof reference, stopped/unreached phases and unanswered question. Full source excerpts stay in the immutable proof and report. |
| Cost and overhead | `scripts/review-cost.mjs` compares packet bytes, approximate tokens, proof availability, reviewer receipts and execution intervals. Fresh desktop reports record runner-owned preparation, launch, reopen, close and cleanup durations; diagnostic events record collection duration. Historical missing timers remain gaps. |

The maintained full course is revision 13. D-EDIT-TRIM remains runnable as an
explicit qualification candidate; its historical acceptance is preserved. The
legacy TIME-01 and SCOPES-01 support mappings correctly require review after
these definition changes. Do not refresh their pins or promote acceptance just
to remove the warning.

## Measure the review path

Use the same package, check set, evidence and review brief for each lane. Start
with the retained full task in one lane and the first-read file in the other.
Do not tell the reviewers the expected diagnosis or let them repair anything.
Ask for the recorded failure, evidence citation, what was not exercised and the
next useful inspection. Evaluate correctness and unsupported claims against the
retained assertion and journal.

```sh
node scripts/review-cost.mjs BEFORE.json FIRST-READ.json DESKTOP-REPORT.json OPERATIONS.jsonl
```

Optional fifth input: a JSON array of review receipts. Each entry contains
`lane`, `startedAt`, `concludedAt`, `correctConclusion`, `files` (absolute files
actually read), and `unsupportedClaims` (evaluated statements). The tool returns
elapsed time and time to a correct conclusion separately; an incorrect answer
has no successful conclusion time. Reviewer correctness is an evaluated input,
not inferred from fast completion. Repeated file opens are counted, but byte
estimates use unique full files and exclude repeat/partial reads. Token estimates
use bytes divided by four; they are not billed token counts.

The same retained October 11 MGFX evidence needs 8,986 bytes in the full task
versus 2,606 bytes in the first read: about 71% less initial context, with the
same comparison and proof reference. This measures packet size, not reasoning
speed. The desktop stage took 113.234 seconds while the failing MGFX check's
boundary interval was 4.240 seconds; group setup and session overhead deserve
measurement before combining mutable fixtures. Older journals cannot separate
all launch, diagnostic and cleanup time. New timers fill that gap prospectively.

Agentic diagnosis, automatic Jira publication and a new planning engine remain
separate work. A confirmed bug still needs a linked diagnostic repro and human
review through the existing investigation and Bug Reporter flow.

## Fix-verification references

Use `smoke investigation fix-reference --id ID --file FILE` to retain a primary App failure’s fixing Wizard commit and PR, with the current investigation revision and actor. It preserves the original result, evidence and review. Nightly planning verifies revision inclusion and matching check definitions before selecting a later attempt. See [Nightly MVP](nightly-mvp.md). A passing later check needs human review and does not close Jira.
