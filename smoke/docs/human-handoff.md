# Desktop smoke and human investigation

Open the local dashboard at http://127.0.0.1:4317 and choose **Desktop & handoff**.

## Workflow

1. Select the failed desktop run. Its original observation and evidence stay unchanged.
2. Choose **Prepare human check** on Split, Trim, Add Tracks, or Search. The runner copies that run's frozen GUI, paired CLI and patched Qt plugin, verifies their hashes, builds a fresh synthetic GP, and opens it before the suspect action. This is fixture reconstruction, not replay of every preceding course step.
3. Read the functional brief. The prepared project, process, endpoint and timeline are recorded in `parcel.json`. A `runbook.json` includes a read-only paired-CLI command.
4. Perform the named gesture yourself. **Capture diagnostics** retains the visible Qt controls, timeline readback, a window image, and the last 32 KB of each application log. Captures are separate directories, so earlier evidence remains available. Window captures may omit Metal preview pixels.
5. For a hang or slow operation, explicitly choose **Sample CPU (5 s)**. It samples only the verified owned application PID. GPU tracing and system-wide profiling are not implemented.
6. Record your name, finding and observation. Choose Confirmed defect, Could not reproduce, Setup blocked, or Needs investigation. This creates a new linked observation, never a replacement automated pass.
7. Review/edit the local bug-report draft. Each saved draft version and human finding is retained. No issue is published or log uploaded.
8. **Finish setup** saves and stops the owned app. A setup also expires after 30 minutes. **Prepare fresh setup** creates another disposable reproduction; it does not revive an expired endpoint.

The generated Oz prompt names the exact project/PID/endpoint and asks Oz to guide the person, inspect the result and summarize evidence. It explicitly keeps the tested gesture with the person. Oz is not automatically launched or configured; the current smoke build reports its agent model as unavailable. The parcel is ready for an Oz session with the appropriate access, while the CLI/native adapter performs setup and capture today.

Automatic course resumption after human sign-off is not implemented. An explicit checkpoint and policy for accepting/rejecting a finding are needed before enabling that behavior. A failure may belong to the app, test harness, fixture or environment; a handoff must not assume which one it is.

## Evidence boundary

Human observations, diagnostic captures, profiling receipts and bug drafts are written under the configured external workspace. They never overwrite the source automated observation. The retained report and session identify the app, CLI, Qt plugin and project used for preparation.

A successful setup is not human acceptance. Keep application defects, harness failures and environmental limitations distinct. Automatic resumption after signoff and live Oz routing require separate acceptance work.
