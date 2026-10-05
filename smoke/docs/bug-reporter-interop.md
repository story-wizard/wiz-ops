# Bug Reporter interoperability

Athanor prepares the failed reproduction for a person to review. Wizard owns its reporting collectors, pending-report storage and delivery. Draft preparation and evidence collection are separate from submission.

## Local workflow

1. Triage a primary case as **App → Reproduce**. Link a focused diagnostic failure on the same build.
2. In the case’s **Bug draft** tab, review or edit the three fields and save the wording. Editing clears prior confirmation; a new repro retains older wording for explicit review. Choose **Prepare Bug Reporter parcel** in the investigation, or run:

   ```sh
   node scripts/smoke.mjs investigation reporter --id INVESTIGATION_ID --case CHECK_ID --server URL
   ```

3. Inspect the returned `handoff.json`, its issues, attachments and review state. The complete investigation package retains the original reports and evidence. Each parcel contains `report.json`, `diagnostics.json`, a retained failure-window `screenshot.png` when available, and bounded `logs.txt` when collected. The parcel chooses its screenshot and state from a verified before/after pair on the same PID and launch generation. Missing or oversized inputs keep the parcel in Needs work.
4. Once Wizard GUI work is authorized, use an owned foreground session on the parcel's exact build and retained reproduction project. The session CLI supports `resume SESSION.json` for a stopped session. Reusing the project is necessary to retain the failed state; do not replace it with a fresh unrelated project.
5. In a separate terminal while the session is active:

   ```sh
   node desktop/bug-reporter.mjs /absolute/SESSION.json /absolute/handoff.json
   ```

   The helper checks the attached plugin capability, process/project ownership and dialog fields. It opens Report Bug when needed, waits for the app's collection to finish, fills an empty editable draft, verifies all three values, and retains a prefill receipt. It preserves existing manual and frozen pending reports. A changed or lost response requires inspection; the helper does not replay it.
6. A person reviews the form, recorded repro and evidence, records confirmation in Athanor, and chooses submission.

The prefill helper never starts or resumes Wizard, clicks Submit, retries delivery, discards a report, or writes the app's pending-report store. Current GUI interoperability fills fields only. Historical Athanor attachments remain in the parcel until Wizard gains an app-owned import operation; the dialog's own captures and diagnostics are collected independently.

## Parcel contract

`format` is `athanor-bug-reporter-handoff/v1`. `contentHash` is SHA-256 of the JSON content excluding that field, using Athanor's `digest` convention.

- `source`: investigation ID and revision, check ID, focused run ID, definition hash, source package SHA-256/version, retained project path and report reference.
- `fields`: `summary`, `reproduction_steps`, `expected_result`.
- `attachments`: fixed relative filenames, roles, byte sizes and SHA-256 values. Captured files retain their original evidence references.
- `readyForPrefill`: sufficient focused failure evidence and inputs within the reporter limits.
- `readyForSubmission`: the above plus **Confirmed** human review. A consuming app must still require the person's actual submission action.
- `delivery`: always `not_submitted` in exported parcels.
- `review`, `issues`, `limits`: review snapshot, remaining collection work and payload bounds.

The parcel is a local draft. `report.json` uses the reporter's schema version 1 and field names, with a deterministic UUID per frozen case/attempt/draft identity. It has no submission timestamp. Diagnostic provenance identifies a retained Athanor reproduction rather than pretending these are freshly collected native reporter diagnostics. Evidence references in `diagnostics.json` are relative to the complete investigation package root. Its `collection` object identifies native reporter diagnostics, tracing and profiling that were not collected by this parcel.

Limits follow the inspected Wizard reporter: 256 characters for Summary, 256 KiB per JSON document, 1 MiB for logs, and 10 MiB for the payload. Athanor additionally bounds steps/expected text to 16,000 characters each. The local parcel is checksummed; it is not a signature or an authorization to upload it.

## App-owned CLI integration

The separate Wizard implementation should consume the same source and attachment identities and expose discoverable draft/capture/import/inspect operations through the existing command infrastructure. It should:

- Capture native app context on the owner thread, then format/save it on the report worker.
- Preserve historical repro attachments separately from fresh app diagnostics and screenshots.
- Reject package/project mismatches, escaped attachment paths, changed hashes, unsupported files and oversized inputs.
- Preserve existing user drafts/pending reports rather than overwriting them.
- Return stable report/draft IDs, collection errors, attachment digests and local delivery state for Athanor to link.
- Keep draft/import preparation separate from sending, with human review before submission and no replay of unknown delivery outcomes.

The inspected source is the October 2 App promotion checkout at `7678e35aab6933f187067bb09f674621351cd330`: `src/app/bug_report.{h,cpp}`, `src/ui/bug_report_dialog.cpp` and `src/app/bug_report_client.cpp`. The dialog's Submit action currently saves and sends together. Test the actual selected build's capabilities; that source inspection alone does not qualify runtime availability.

## Component verification

Harness regressions cover parcel identity/size/hash checks, missing evidence, primary-case gates, exact build/project admission, prefill readback and no-replay behavior. The native component probe uses Qt offscreen widgets, without Wizard:

```sh
clang++ -std=c++17 -fPIC desktop/native/bug-report-prefill-test.cpp -Idesktop/native \
  -o /absolute/external-output/prefill-probe $(pkg-config --cflags --libs Qt6Widgets)
QT_QPA_PLATFORM=offscreen /absolute/external-output/prefill-probe
```

The probe checks exact field writes, preservation of manual/pending drafts, limits and ambiguous controls, readback mismatch, and zero Submit clicks. Full selected-build GUI acceptance remains a separate authorized check.
