# Athanor jobs and nightly scheduling

The controller owns a durable queue and one daily schedule. It calls the existing
worker's preparation and course runner; it does not need an open Codex chat.
A developer clone continues to work without this service or a Slack account.

## Set up a worker

Start from the clean, reviewed worker checkout and external profile described in
[Workers](workers.md). Keep its ordinary loopback service running in the runner
user's unlocked Aqua login session. The controller uses Node 24's SQLite support
and needs no npm dependencies.

From the command root, with `CONFIG` and `PROFILE` replaced by absolute external
file paths:

```sh
node scripts/controller.mjs init --config CONFIG --profile PROFILE
node scripts/controller.mjs submit --config CONFIG --file examples/controller/request.json
node scripts/controller.mjs status --config CONFIG
node scripts/controller.mjs status --config CONFIG --id REQUEST_ID
node scripts/controller.mjs brief --config CONFIG --id REQUEST_ID
node scripts/controller.mjs serve --config CONFIG
```

Edit the request before submission. Use a new `requestId` for a new attempt.
Repeating identical inputs retains the same job; changing inputs under that ID
is rejected. Build choices are `latest-nightly`, `tag` with an official release
tag in `value`, or `app` with the absolute selected bundle path in `value`.
Latest-nightly discovery requests fresh official release metadata. Missing,
ambiguous or unavailable newest packages produce a report; an older cached build
is never substituted. The selected asset, release notes, normalized course,
source/profile, preparation ID and run request ID are retained.

Unattended jobs reject explicit manual checkpoints before queue admission. Use
the ordinary interactive harness for a course that needs a person to resume it.

Selections use the ordinary course/check selection format, including maintained
or saved courses available in this worker's catalog. The queue freezes their
resolved membership when submitted. The prepared membership must match before
Start. Changing a course or worker source requires review and new attempts.

## Schedule and supervise

```sh
node scripts/controller.mjs schedule --config CONFIG --file examples/controller/schedule.json
node scripts/controller.mjs enable --config CONFIG
node scripts/controller.mjs pause --config CONFIG
node scripts/controller.mjs cancel --config CONFIG --id REQUEST_ID
node scripts/controller.mjs service --config CONFIG --out PLIST
```

Saving a schedule leaves it disabled. `enable` chooses its next future slot.
`pause` stops future scheduled admissions; it does not terminate active work.
`cancel` records an intent: preparation must settle, or the owned course runner
receives one normal stop request. A lost stop reply is reconciled through its
original run, never resent. An application assertion failure continues into
independent checks under the course's normal cleanup rules.

Foreground and background service courses attempt normal project shutdown first.
If an interrupted checkpoint or call lock prevents it, the executor terminates
only its recorded process after verifying the executable and process start time,
waits for closure, and records `cleanupRecovery`. Interrupted action receipts and
locks remain available for diagnosis. Cleanup failure stays Unknown; it never
authorizes replaying input or releasing another actor's lease. Verify the worker
has no active job or owned session before replacing its source.

`service` writes an Aqua LaunchAgent plist with the current executable and exact
checkout/config. It does not install, start or replace a service. An authorized
operator can bootstrap that specific plist in `gui/UID`, verify the label and
status, and retain rollback receipts. Keep the existing worker supervisor. Keep
the retired chat-based nightly paused; do not run two nightly dispatchers.

The supervised controller polls every ten seconds. SQLite retains jobs, append
only transitions, schedule slots and a process-bound progression lease. A second
live controller cannot advance the queue. Restart recovery queries the original
preparation/run identity. A missed schedule produces at most one catch-up rather
than a backlog, then advances to the next future daily slot. Daylight-saving
changes do not create two admissions on the same local day.

## Reports and delivery

State, reports and captures live in the worker's external workspace. Reports are
under `exports/athanor-job-REQUEST_ID/`; `status` returns their local service URL
and the detailed evidence report. A terminal job is not necessarily a QA Pass.
Read `outcome`, catalog results and functional assertion status separately.
Unexecuted legacy assertions remain Not Run, even when related checks pass.
Unknown source/response/evidence states remain visible for human or agent review.

### Investigation and agent handoff

New completed jobs with Fail, Blocked, Unknown or Not run catalog checks reuse
the original run's investigation, or record one creation intent before creating
it. The handoff verifies the run, build, package and source identities and exports
the existing evidence package and triage task. Several matching investigations,
changed identities or damaged evidence produce **Needs review**. The local job
report still completes; its QA outcome remains separate from handoff and delivery.
Jobs that never executed get repair guidance without a fictitious investigation.

Open **Agent brief and investigation** in the job report. The adjacent files are:

- `agent-brief.json`: frozen identities, catalog counts, independently recorded
  functional assertion counts, checks needing review, concise case conclusions and
  original evidence links. Full release notes stay in `report.json`; the compact
  identity retains their tags and a link. The legacy functional ledger is labeled
  separately from the selected catalog checks.
- `AGENT-PROMPT.txt`: the existing investigation triage task, or stage-specific
  repair instructions when no investigation is available.
- `investigation-task.json`, when Ready: the prompt's complete task context,
  observations and suggested groups. The evidence package also retains it in
  `tasks/triage.json`.
- `triage-proposal.json`, when applicable: explicit recorded blockers grouped
  into a proposal. Missing build operations suggest Environment; a shared
  prerequisite remains Unresolved. Review the evidence and preview before applying.
- `handoff.html`: links to these files, the investigation and its evidence package.

The retained brief is a reporting-time snapshot. `brief --config CONFIG --id ID`
reads current job and delivery state without contacting Wizard, creating a task
or sending a message. `status --id` includes that brief and the complete record
and events. A damaged report remains visible as `reportReadError`; the retained
QA outcome and original IDs are preserved.

If a creation reply is lost, the controller lists original-run investigations
and adopts only a unique, identity-verified record. It never repeats that creation
intent. After resolving a handoff issue, explicitly reconcile it with:

```sh
node scripts/controller.mjs handoff --config CONFIG --id REQUEST_ID
```

This command takes the controller progression lease, checks the pinned worker,
and links/exports the current investigation task. It does not Start, reproduce,
triage, submit a bug or deliver a message. Read `brief` again for the updated
handoff; the original report and its snapshot stay intact. If the original
creation intent has no visible record, preserve it for inspection instead of
creating a replacement automatically.

An agent reviews the task context and evidence, returns a proposal, then uses
the existing investigation `proposal` preview. Reviewed application, diagnostic
repro execution and human bug confirmation remain separate steps described in
[Investigations](investigations.md). This slice prepares the handoff; it does not
launch an autonomous triage agent or change any original test result.

Initialization without `--route` selects local-only reports. To use unattended
Slack delivery, initialize a separate reviewed config with `--route ROUTE_JSON`.
The route must be Charles's exact Story Company one-to-one DM:

```json
{"workspace":"story-company","userId":"U0BDBFNU0G1","user":"U0BDBFNU0G1","type":"im","channelId":"VERIFIED_DM_ID"}
```

The dedicated bot's DM may differ from a human or connector DM. Provision its
`ATHANOR_SLACK_BOT_TOKEN` through the supervisor's protected environment. Never
put the token in the repository, config, plist, prompt or receipt. Slack requires
`chat:write` for posting and the appropriate DM read scope for verifying its
channel. The sender verifies its team and exact owner route before dispatch.
See Slack's [auth.test](https://docs.slack.dev/reference/methods/auth.test/),
[conversations.info](https://docs.slack.dev/reference/methods/conversations.info/)
and [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)
contracts when provisioning the bot. Enabling Slack mode requires verification.

An intent and Unknown receipt precede the single send. Confirmation retains the
exact timestamp and message URL. A lost response is Unknown and is never resent
automatically. Inspect the retained intent and Slack history before recording a
verified receipt with `runner/delivery.mjs`'s `recordDelivery`; preserve earlier
receipts. No evidence uploads, email or Jira publication occur. The message points
to reports retained on the testing Mac; shared hosting is a separate rollout.

## Recovery limits

Keep jobs pinned to their original profile/source. Changing a profile is not a
migration of pending work. Preserve the old checkout and inspect queued/active
jobs before replacing its service. Imported archives are safe, verified cache
inputs, but an interrupted import is marked Unknown for inspection rather than
silently starting a new preparation. Unknown app actions follow the harness's
normal reconciliation rules. Report corruption or unresolved run identities
retain a review state and their original records; a new job is a separate attempt.

Every `brief` includes `recovery`: the actual failed stage, recorded error,
read-only command argument arrays, the command root and an agent repair prompt.
CLI and controller-generated briefs resolve the known config, service address and
report directory. Direct helper consumers without runtime context retain `CONFIG`
and `URL` placeholders. Unexpected one-shot `tick` errors retain a source-bound
receipt in the external `controller-errors/` directory; the CLI prints its path.
Inspect that receipt and job status before another progression attempt. Pass argument arrays directly when scripting; quote each
argument when assembling a shell command. Import, preparation, Start, execution,
reporting and delivery have separate inspection paths. Unknown operations and
delivery intents are inspected, never blindly replayed. Recovery hints authorize
neither execution nor external publication.

The controller does not bypass a locked screen, desktop lease, permissions or
another agent's process. A busy worker waits until the job deadline; GUI readiness
still comes from real preparation and its existing process-bound qualification.
Tower monitoring, Mini enrollment, autonomous investigation execution and novel functional
course generation remain separate slices. This service supplies their durable
job/run identities without requiring them for ordinary developer testing.

New investigation handoffs also include `first-read.json`, linked from
`handoff.html`. Give this and AGENT-PROMPT.txt to the reviewer first; use the
larger task and checksum-bound evidence when needed. The first read names its
evidence package because its proof paths belong to that package, not the job
report directory. `scripts/review-cost.mjs` measures these packets and recorded
session intervals without launching Wizard; see docs/investigations.md.

## Nightly MVP extension

For the ordered evergreen/change stages, bounded agent adapter, archived fix verification, read-only publication and independent DM/channel routes, use [Nightly MVP](nightly-mvp.md). Existing single-course and legacy DM configurations remain supported. New configurations pin the planner, publication and destinations at admission. Deploy to a new source/configuration after review; preserve historical attempts.
