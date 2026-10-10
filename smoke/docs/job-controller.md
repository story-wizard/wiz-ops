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

The controller does not bypass a locked screen, desktop lease, permissions or
another agent's process. A busy worker waits until the job deadline; GUI readiness
still comes from real preparation and its existing process-bound qualification.
Tower monitoring, Mini enrollment, autonomous investigation and novel functional
course generation remain separate slices. This service supplies their durable
job/run identities without requiring them for ordinary developer testing.
