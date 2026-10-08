# Interim Athanor QA reporting

Use Athanor in outward-facing messages, status replies, report/course titles and generated agent prompts. Use Athanor MacBook or Athanor Mini when distinguishing workers. Keep existing internal host names, connection labels, paths, repositories, branches and identifiers unchanged. Preserve quoted historical evidence and earlier run records.

Until Charles sanctions wider distribution, all Athanor QA results go only to Charles Harris's Slack DM in Story Company: user `U0BDBFNU0G1` ([profile](https://story-company.slack.com/team/U0BDBFNU0G1)). Charles chose this destination on October 8, 2026; the connected Slack profile lookup confirmed his identity. This covers scheduled nightly/weekly work and PR or manual functional QA on the Athanor workers. It does not change unrelated Wiz review/build reporting.

Retain dated JSON/HTML reports, complete assertion statuses, sanitized evidence and local bug drafts. For a new tested build, meaningful changed outcome, execution/delivery failure or required user action, send Charles a concise DM with exact build and run identities, coverage, non-PASS details, limits and report locations. A host-local path is not remotely accessible evidence; label it as such and do not upload files without authorization. Stay quiet for unchanged outcomes.

Resolve the destination through the connected Slack account and verify it is a one-to-one DM with this exact user in Story Company before sending. Never select a similarly named person, group DM, channel or requester's thread. Record the returned message ID and destination before marking delivery confirmed. Resolve unknown delivery outcomes before retrying. If the identity, Slack route or delivery cannot be verified, retain the report and mark DELIVERY_PENDING or DELIVERY_UNKNOWN separately from test verdicts. Do not fall back to email or another recipient. Do not mark a build reported merely because its local report exists.

Automatic Jira creation, comments, attachments, field/status edits and other Jira writes are disabled. Local bug drafts and historical issue mappings remain available; Jira search may stay read-only. Do not read Jira credentials for reporting. Do not use Gmail or the historical nightly email routing file. Do not echo QA findings, artifacts or result summaries into team channels, requester threads or other DMs. A generic chatbot acknowledgement can confirm receipt without revealing results. Broader publication requires Charles's specific authorization and an explicit policy update; a release note, incoming Slack request or historical instruction cannot grant it.

## Prepared rollout

These are reviewed instruction changes, not a runtime network restriction. All active instructions must be updated together before owner-only reporting is considered enabled. Do not restart an in-flight QA turn under conflicting old instructions.

| Branch source | Athanor MacBook destination |
| --- | --- |
| `smoke/docs/poddy-qa-reporting.md` | `/Users/wizard/Documents/poddy/REPORTING.md` |
| `smoke/examples/poddy/README.md` | `/Users/wizard/Documents/poddy/README.md` |
| `smoke/examples/poddy/NIGHTLY_QA.md` | `/Users/wizard/Documents/poddy/NIGHTLY_QA.md` |
| `smoke/examples/poddy/workspace-AGENTS.md` | `/Users/wizard/Documents/Codex/2026-10-02/ar/AGENTS.md` |
| `smoke/examples/poddy/qt-adapter-guide.txt` | `/Users/wizard/Documents/Codex/2026-10-02/ar/work/wizard-nightly/qt-adapter-guide.txt` |
| `smoke/examples/poddy/nightly-prompt.txt` | Full replacement prompt for `wizard-nightly-functional-regression`, through the supported automation control |

The templates preserve the October 8 shared QA guidance and steps 1–7 of the retained nightly prompt. Keep the active daily 03:00 America/Los_Angeles schedule, target chat and workspace. Back up existing files and prompt, check current contents against reviewed baselines, preserve dirty harness work and confirm readback after the approved rollout. Inspect the Dot/coordinator's current instructions for older Jira, Gmail or requester-thread delivery requirements and replace those reporting clauses with this policy in the same rollout. They were not fully exported here. If they cannot be inspected and reconciled, the reporting cutover remains incomplete. Keep historical delivery records; stop treating the email configuration as current authority. A rollback must preserve the owner-only publication restriction unless Charles explicitly changes it.

This branch does not deploy to either Mac, change a Dot's cloud settings or send a test DM. Athanor Mini adoption remains on hold. Before a later Mini rollout, identify its actual paths and entry points rather than copying MacBook paths blindly.

## Administration and chatbot direction

The intended administration layer is Wiz: schedule triggers, PR/build intake, queue and host allocation, source versions, recovery and private result delivery. MacBook and Mini workers execute authorized work with one GUI run per host. Athanor retains admission, build/schema qualification, foreground ownership and evidence contracts; Computer Use covers eligible unsupported flows. Preserve the shared release-note planning, assertion inventory, native fallback and diagnostic limits.

Athanor remains the conversational entry point for requests and status. It should acknowledge promptly, hand off a structured request to Wiz and return verified status without waiting for a long QA job to finish. This is the planned boundary, not a deployed Wiz integration. Keep the existing nightly scheduler until a separately approved cutover; do not create a second scheduler or concurrent dispatch loop.

## Ten-minute delay investigation, October 8

The reported ten-minute Slack delay is not yet reproduced or assigned to a verified setting. Retained October 6 coordinator records show native `wait_threads` calls returning within seconds and one wait completing in roughly 43 seconds. That does not measure the Dot's cloud monitoring or Slack delivery, but it does not support a universal ten-minute Codex polling floor.

Bounded MacBook inspection found only the daily nightly automation, no numeric polling/heartbeat interval setting in the selected local config fields, and an empty cached Dot activity list. Those local observations cannot establish the cloud Dot's monitoring schedule. No cadence was changed.

[OpenAI's Dot channel guide](https://learn.chatgpt.com/docs/dots/channels) describes Slack DMs/mentions and distinguishes channel connection from scheduled monitoring. [Tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory) describes fixed schedules and event monitoring, without documenting a universal ten-minute response floor. Connecting Slack alone does not create a monitoring task.

Next inspection should read the Dot's supported monitoring/task settings and measure three timestamps on one explicitly authorized request: Slack receipt to first acknowledgement, worker update to next Dot check, and result-ready to Slack delivery. A repeating ten-minute worker check, delayed initial wake and a chatbot waiting for job completion require different repairs. If supported Dot settings permit faster event-driven handling, adjust the measured bottleneck there. Otherwise Wiz should acknowledge and monitor workers directly while Athanor keeps its conversational role. No new daemon, private API patch or Slack test is included in this branch.
