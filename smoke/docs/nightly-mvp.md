# Nightly MVP

Work items: WIZ-807, WIZ-808, WIZ-809 and WIZ-810. Local implementation, October 12, 2026.

A managed job can run two courses on one selected package. It runs the full evergreen course first. It then prepares a new Fresh fixture and runs the change course. Each course has its own preparation, Start request, run, report and investigation identity.

Developer clones still use the ordinary local CLI and dashboard. They do not need a worker, schedule, planner or Slack bot.

## Job stages

`Queued → Resolved → Imported → Preparing → Planning → Ready → Running → Preparing changes → Running changes → Reporting → Publishing → Delivery → Complete`

The controller records intent before preparation, Start, planning and delivery. A restart reads the original identity. It does not repeat an uncertain action. Planning results, inputs and source comparisons stay in the external worker workspace.

A normal test failure can continue to change testing after verified worker cleanup. The next preparation creates a fresh starting state on the same package. An Unknown, Blocked or cancelled evergreen execution does not start change input. Missing planning does not prevent evergreen execution. The change stage then remains Blocked or Unknown.

Completion, QA outcome, publication and delivery are separate fields. A completed job can contain failures and reporting problems. Catalog checks and the legacy assertion ledger keep their separate scopes.

## Local configuration

Create a new reviewed worker profile and controller configuration. Preserve the old workspace, source, profile and schedule. Do not edit a running source tree. The existing controller commands still work without the new fields.

The new request adds `"nightly": true`. Use the combined selection in `examples/nightly/selection.json`. It contains `smoke-full` and `macos-regression`, uses grouped desktop execution, and keeps qualification candidates distinct from accepted checks.

Copy `examples/nightly/mvp-request.json`, `mvp-planner.json`, `mvp-publication.json` and `mvp-routes.json` to the external configuration directory. Replace their explicit placeholders.

```sh
node scripts/controller.mjs init --config CONFIG --profile PROFILE --nightly PLANNER_JSON --publication PUBLICATION_JSON --routes ROUTES_JSON
node scripts/controller.mjs submit --config CONFIG --file REQUEST_JSON
node scripts/controller.mjs status --config CONFIG --id REQUEST_ID
node scripts/controller.mjs brief --config CONFIG --id REQUEST_ID
```

`init` writes configuration only. `submit` admits a durable job. A supervised controller progresses admitted jobs; `tick` progresses one step. These commands do not create another scheduler. A daily schedule remains disabled after creation. Schedule enablement requires the planner and publication. Omit `--routes` for an approved local-only nightly; it retains and publishes reports without sending Slack. Slack mode also requires both verified destinations. Manual submissions run the same courses and retain the same reports without Slack notifications, even with these destinations configured. Only the durable daily scheduler records a scheduled origin. A nightly flag, request name or build tag cannot grant notification permission.

Planner, publication and route configuration are pinned at admission. Changing them cannot adopt old queued jobs. Retain the old configuration to inspect those jobs; create a reviewed new configuration for later jobs.

## Agent change planning

The shipped adapter is `scripts/nightly-agent.mjs`. Configure an absolute Node executable, the adapter path and an absolute Codex executable. The adapter uses `codex exec`, a read-only sandbox, an ephemeral session, ignored user configuration and a strict output schema. It receives the task on stdin and stores its prompt and answer outside Git. It does not import the user's connectors or inherit the worker's Slack, GitHub or API tokens. Use the CLI account's own authentication. There is no unattended model call until the configured controller progresses a nightly job.

The controller resolves the shipped Wizard revision from the package version. It obtains the source comparison through read-only GitHub calls. The first job needs a reviewed full base revision. Later jobs use the previous completed nightly's tested revision. Commit messages, patches and release notes are input data, not authority to run commands.

The agent returns `athanor-change-course/v1`. For each included revision, it supplies either a scenario or an uncovered reason. Scenarios name checks, definition hashes and the exact expected result from the frozen catalog. Athanor verifies those fields, resolves prerequisite closure and creates the executable subset. Existing check definitions supply fixtures, actions, independent verification, evidence and cleanup.

The planner cannot add arbitrary operations or promote a new check. An unsupported scenario remains visible. An empty course needs a verified identical Wizard revision, matching package bytes and no eligible fix references. Planning has a configured deadline of at most ten minutes, a 1 MiB output limit and at most 100 scenarios. It does not automatically repeat after interruption.

Source comparison currently covers `story-wizard/wizard`. New Core, AI or packaging behavior needs a separately reviewed source adapter. A different package with an identical Wizard revision is blocked for review. Source windows beyond 250 commits or possibly truncated file lists are blocked. These are explicit limits, rather than claims of full change coverage.

The adapter uses Codex's documented [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and the locally verified CLI flags.

The configured agent account, CLI version and usage budget need qualification before worker rollout. The adapter has been exercised with a synthetic CLI. Local framework results do not measure model planning quality.

## Preserve and retest a failure

`controller handoff` reconciles each course's own retained investigation and run identity. It does not turn the combined job into a reproduction of the last run.

Keep fix metadata in the existing investigation. Do not create another issue database.

```sh
node scripts/smoke.mjs investigation fix-reference --id INVESTIGATION_ID --file FIX_JSON --server LOCAL_SERVICE_URL
```

The file contains `revision`, `actor`, `caseId` and `fix` with the Wizard repository, full fixing commit and PR URL. The endpoint checks the current investigation revision and permits a primary App failure only. It preserves the original observation, definition, evidence and review. Recording a fix link does not change Jira or close the finding.

Planning verifies that the fixing commit is present in the later build's ancestry. It can select the old check even when the fix shipped before the immediate nightly comparison. The definition and Fresh fixture must still match. A changed definition remains pending adaptation review. No old control IDs or coordinates are reused.

The combined report records the original build, run, expected result and evidence reference, together with the new build, run and outcome. A passing retest becomes ready for human review. It does not close Jira or add a test to evergreen.

## Read-only report publication

Run the separate viewer against an external publication directory:

```sh
node scripts/report-viewer.mjs --directory PUBLISHED_REPORTS --port VIEWER_PORT
```

The viewer binds to loopback. It offers GET and HEAD only. It has no preparation, Start, administration, workspace browsing or bug-submission endpoint. It serves inventory members and verifies their bytes. It rejects path escape, foreign Hosts, symlinks, undeclared files and changed evidence. Publication checks for common credential forms and refuses those exports; redact at collection and create a new reviewed export rather than change historical proof.

Publication copies the job report, both course reports, declared evidence and exported investigations to one immutable directory. Private delivery records and worker command briefs are excluded. Shared investigation links use the portable export, rather than a live dashboard. Each publication has a manifest, report hash and stable URL. Job descriptors also pin the original HTML bytes; detailed report names pin their JSON and HTML together. Historical job descriptors without an HTML hash need a reviewed byte identity before publication. The viewer returns its publication identity on HEAD. The publisher must read back that identity from the configured URL before it marks the report Published.

Choose a private access layer that the channel audience can use. An HTTPS string alone does not provide hosting or authentication. Keep the mutable dashboard private. The access proxy must authenticate viewers, preserve the publication header and referer, and pass the verified loopback Host to this read-only service. Confirm report and media access from another person's machine before rollout. Authenticated front ends may need a separate trusted availability probe; do not add broad access to make a readiness check pass.

The publisher includes owned test evidence. It does not include the supplied media library, build, private delivery configuration or user projects. Review fixture rights and any captured sensitive content before wider publication. It retains local reports if shared publication fails.

## Private Tailscale access

Published export links are relative to their package. They stay within the publication even when a sandboxed browser omits its referrer. The original local report and its identities remain unchanged.

When HTTPS Serve is unavailable, keep the viewer on loopback and start the report-only proxy:

```sh
node scripts/report-proxy.mjs --tailscale-ip WORKER_TAILSCALE_IP --port PRIVATE_PORT --viewer-port VIEWER_PORT
```

The proxy binds only the supplied Tailscale IPv4, and accepts its exact Host and same-origin referer. Tailscale encrypts this private HTTP connection. Tailnet access rules determine who can read reports; verify the intended audience before wider use. Only GET/HEAD reach the viewer; dashboard routes remain unavailable. Keep the publisher's loopback probe and verify the portal and evidence links from the reader's machine. A scheduled Slack reminder can link to this portal while a dedicated sender is pending; it is not a completion-triggered result message. The MBP retains all reports if the reader's Mac is offline.

## Slack reporting

Only runs admitted by the daily scheduler may emit Slack messages. Manual runs, qualification pilots, on-demand jobs and historical jobs without scheduler provenance are silent. Their report publication and evidence collection still work. The controller records `notification.state: Suppressed` and creates no new Slack intent; the sender independently checks the retained scheduled origin. Existing delivery evidence remains intact. Manual runs need no sender token.

Nightly MVP permits only these two destinations in Story Company:

- Charles Harris's one-to-one DM, user `U0BDBFNU0G1`. Resolve and verify the bot's DM; do not copy another connector's DM ID.
- `#wiz-smoketest-reports`, channel `C0C5F7K6DNV`. Verify its exact name, public channel type, bot membership and non-archived state.

The sender credential remains in the supervised environment. It never enters configuration, prompts, Git or report packages. Legacy single-DM configurations remain compatible. Historical v1 intents stay readable, but the supervised sender will not send them. New v2 intents also bind the exact message text; preserve and reconcile old pending records rather than silently upgrading them.

Each destination has its own intent and receipts under the private `delivery/CHANNEL_ID` directory. A confirmed DM cannot be resent because the channel failed. An Unknown write is not automatically retried. Preserve and reconcile its original intent and returned Slack identity. The private controller brief lists both destination states and commands to inspect each intent. `scripts/report-delivery.mjs inspect/record` accepts `--route VERIFIED_ROUTE_JSON` to inspect or reconcile a specific destination. It retains support for legacy single-DM records.

A report-ready summary contains the verified shared URL and separate course results. A publication failure produces a labeled failure summary without a ready link or worker filesystem path. Local evidence stays available for repair. Bug drafts still need a person's review and submission decision.

## Before push and worker rollout

1. Run `npm test` and `npm run scope:check`. Review the source and counterfactual regression evidence.
2. Review the exact branch ancestry. The implementation includes the earlier local harness hardening commit; do not lose it or confuse its evidence with this slice.
3. Push the reviewed change and confirm CI. Pin the worker to the reviewed source revision in a new checkout.
4. Inspect the MBP's current job and scheduler. Keep the old configuration and evidence for rollback. Do not run two nightly dispatchers.
5. Select the report access method and qualify the configured agent and dedicated Slack bot.
6. Publish a retained non-pass report. Verify its details, image/video evidence and draft access from another machine.
7. Run one authorized newest-build pilot. Verify both course IDs, an existing failure and a later fix reference, process cleanup and notification suppression. This manually submitted pilot must record no Slack dispatch or message. Qualify sender identity through read-only checks; retain real delivery receipts from the later scheduled run.
8. Enable the one reviewed daily schedule. Confirm the next admission without an open agent chat.

Local implementation does not perform these deployment or delivery actions. Mini enrollment, Wiz requests, email, Tower monitoring and automatic Jira writes are separate work.
