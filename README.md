# wiz-ops

Operational scripts and tooling for the [story-wizard](https://github.com/story-wizard) repositories.

## Overview

This repo collects convenience scripts that support day-to-day development workflows across the Wizard ecosystem — starting with PR review automation.

The lower-level `maestro_*` scripts set up isolated worktrees and Maestro agents on demand. The `wiz_pr_*` scripts build a fully automated, Slack-triggered PR-review pipeline on top of them (see [Slack-triggered PR review pipeline](#slack-triggered-pr-review-pipeline)).

## Requirements

- [`gh`](https://cli.github.com/) — GitHub CLI, authenticated
- [`jq`](https://stedolan.github.io/jq/)
- [`node`](https://nodejs.org/) (for the Maestro CLI)
- The [Maestro](https://github.com/ksylvan/Maestro) CLI — either the installed app at `/Applications/Maestro.app` or a local `preview` worktree (see [Maestro CLI resolution](#maestro-cli-resolution) below)
- Code Review playbooks — preferably checked out locally at `~/src/Maestro-Playbooks/Development/Code-Review`, otherwise fetched from GitHub automatically (see [Code Review playbook source](#code-review-playbook-source) below)
- The `~/wizard/<repo>` checkouts that worktrees are derived from (worktrees land in `~/wizard/worktrees/<repo>/`)

For the [Slack-triggered PR review pipeline](#slack-triggered-pr-review-pipeline) only, you additionally need:

- [`curl`](https://curl.se/) — used by the Slack helpers
- A Slack bot token in `~/.hermes/.env` as `SLACK_BOT_TOKEN` (the bot must be a member of the monitored/output channel and have `chat:write` + `files:write` scopes)
- The [Hermes](https://github.com/ksylvan/hermes) gateway, configured to monitor the trigger channel and dispatch to the `wiz-pr-review-pipeline` skill (wired up automatically by [`wiz_pr_mode.sh`](#wiz_pr_modesh--switch-pipeline-between-test-and-prod))
- `gh` authenticated with the `project` scope (for setting PR project Status)

The git worktree helpers are bundled in [`_worktree_helpers.sh`](./_worktree_helpers.sh) and sourced by the scripts directly, so no shell-dotfile setup (e.g. `~/.zshrc.d/`) is required.

## Maestro CLI resolution

All scripts resolve the `maestro-cli.js` to run (and whether to override
`MAESTRO_USER_DATA`) through the shared helper [`_maestro_env.sh`](./_maestro_env.sh),
which they source on startup. Resolution order:

1. **`.env`** — if a `.env` file sits next to the scripts, it is sourced first.
   Use it to point at a checked-out rc/preview branch (see below).
2. **`MAESTRO_CLI_JS`** — if set (typically from `.env` or the environment), it
   wins, and `MAESTRO_USER_DATA` is honored as given.
3. **Installed app** — otherwise, if `/Applications/Maestro.app/Contents/Resources/maestro-cli.js`
   exists, that CLI is used and `MAESTRO_USER_DATA` is left **unset** so the app
   uses its own data directory.
4. **Dev fallback** — otherwise the scripts fall back to
   `~/src/worktrees/Maestro/preview/dist/cli/maestro-cli.js` with
   `MAESTRO_USER_DATA` pointed at `~/Library/Application Support/maestro-dev`.

### Running against a checked-out rc branch (developers)

When developing Maestro itself, you'll want the scripts to drive your
**checked-out rc/preview build and its dev data dir** instead of the installed
app. Copy the example file and adjust the paths to your worktree:

```zsh
cp .env.example .env
# then edit .env if your worktree lives somewhere else
```

The default `.env.example` contents:

```sh
export MAESTRO_USER_DATA="$HOME/Library/Application Support/maestro-dev"
export MAESTRO_CLI_JS="$HOME/src/worktrees/Maestro/preview/dist/cli/maestro-cli.js"
```

`.env` is git-ignored, so your local override never gets committed. Delete it
(or unset the variables) to switch back to the installed app.

## Scripts

### `maestro_pr.sh` — PR Review Setup

Sets up a full, isolated PR review environment for a given repo and PR number.

**Usage:**

```zsh
./maestro_pr.sh [--no-run] <repo> <pr_number> [agent_type]
```

**Arguments:**

| Argument | Description |
| --- | --- |
| `repo` | One of: `wizard`, `wizard-ai`, `wizard-core`, `wizard-release`, `wizard-spec` |
| `pr_number` | The PR number (numeric) |
| `agent_type` | Optional one of: `claude-code`, `codex`, `opencode`. Defaults to `claude-code` |

**Options:**

| Flag | Description |
| --- | --- |
| `--no-run` | Set up the agent and playbooks but skip the final auto-run launch (the script prints the manual launch command instead) |

**Examples:**

```zsh
./maestro_pr.sh wizard-core 209
./maestro_pr.sh wizard 42
./maestro_pr.sh wizard-ai 101 codex
./maestro_pr.sh --no-run wizard-core 209
```

**What it does:**

1. Validates the PR is open and not a draft
2. Delegates to [`maestro_wt.sh`](#maestro_wtsh--named-worktree--maestro-agent) to create the worktree (named `<repo>-pr-<pr_number>-<agent_type>`), set up the autorun directory, and create a Maestro agent with the "no changes" nudge
3. Copies Code Review playbooks into `~/wizard/worktrees/autorun/<repo>/<worktree>/development/code-review/` (see [Code Review playbook source](#code-review-playbook-source))
4. Patches the correct PR URL into `1_ANALYZE_CHANGES.md`
5. Checks out the PR branch in the worktree via `gh pr checkout`
6. Triggers the auto-run sequence against the playbooks (skipped with `--no-run`)

The agent is always nudged with: _"Do not make any changes this is only a review task."_
Worktree cleanup is left to the user after the review is complete.

#### Code Review playbook source

The playbooks are sourced in two ways, in order:

1. **Local checkout** — if `*.md` files exist under
   `~/src/Maestro-Playbooks/Development/Code-Review`, they are copied from there.
2. **GitHub fallback** — otherwise the script fetches them via `gh api` from
   [`RunMaestro/Maestro-Playbooks`](https://github.com/RunMaestro/Maestro-Playbooks/tree/main/Development/Code-Review)
   (the `main` branch). This uses your authenticated `gh`, so it also works for
   private access.

Either way, `README.md` is dropped and the PR URL is patched into
`1_ANALYZE_CHANGES.md`.

### `maestro_wt.sh` — Named Worktree + Maestro Agent

Sets up (or tears down) a named git worktree wired up to a Maestro agent —
without any PR-review or playbook scaffolding. Useful when you want an isolated
workspace for general feature work, experiments, or refactors driven by a
Maestro agent.

**Usage:**

```zsh
./maestro_wt.sh [--nudge MSG] [--json-out PATH] <repo> <worktree_name> [agent_type]
./maestro_wt.sh --delete [--force] <repo> <worktree_name> [agent_type]
```

**Arguments:**

| Argument | Description |
| --- | --- |
| `repo` | One of: `wizard`, `wizard-ai`, `wizard-core`, `wizard-release`, `wizard-spec` |
| `worktree_name` | Free-form label for the worktree. Allowed characters: letters, digits, `.`, `_`, `-` |
| `agent_type` | Optional one of: `claude-code`, `codex`, `opencode`. Defaults to `claude-code` |

The final worktree and agent are both named `<repo>-<worktree_name>-<agent_type>`.

**Options:**

| Flag | Description |
| --- | --- |
| `--nudge MSG` | Pass `MSG` as the nudge message when creating the agent. Without this flag, the agent is created with no nudge |
| `--json-out PATH` | Write the `create-agent` JSON response to `PATH` (caller-managed). Without this flag, the JSON is written to a temp file that is removed on exit. Primarily useful when invoking `maestro_wt.sh` from another script that needs the resulting `agentId` |
| `--delete` | Tear down the worktree and its Maestro agent instead of creating them. Mutually exclusive with `--nudge` / `--json-out` |
| `--force` | Only valid with `--delete`: skip the confirmation prompt and force-remove the worktree even if it has uncommitted changes |

**Examples:**

```zsh
./maestro_wt.sh wizard-core my-feature
./maestro_wt.sh wizard refactor-auth
./maestro_wt.sh wizard-ai experiment codex
./maestro_wt.sh --nudge "review only" --json-out /tmp/a.json wizard-core pr-209
./maestro_wt.sh --delete wizard-core my-feature
./maestro_wt.sh --delete --force wizard-ai experiment codex
```

**What it does (create):**

1. Creates a git worktree named `<repo>-<worktree_name>-<agent_type>` under `~/wizard/worktrees/<repo>/`
2. Creates the matching autorun directory under `~/wizard/worktrees/autorun/<repo>/<worktree>/`
3. Creates a Maestro agent scoped to the worktree using the selected `agent_type` (default: `claude-code`), pointed at the autorun directory

Unlike `maestro_pr.sh`, this script does **not** copy any playbooks, does not check
out a PR, and does not trigger an auto-run launch — the worktree starts on the
default branch and the agent has no nudge message. Drop your own playbooks into
the autorun directory if/when you want to run them.

**What it does (`--delete`):**

Reconstructs the same deterministic `<repo>-<worktree_name>-<agent_type>` name, then:

1. Prompts for confirmation (skipped with `--force`)
2. Removes the git worktree and prunes it (with `--force`, also removes a worktree with uncommitted changes)
3. Prompts whether to also delete the worktree's autorun directory
4. Looks up the agent by name (via `maestro_id.sh`) and removes it with `maestro-cli remove-agent`

The teardown is best-effort: if the worktree is already gone it still attempts to
remove the agent, and if no matching agent is found it skips that step — so a
half-cleaned state can be finished by re-running the command.

### `maestro_id.sh` — Agent UUID Lookup

Looks up a Maestro agent's UUID by its exact name. Useful for scripting or when you need the `agentId` to send messages via `maestro_dev_cli send`.

**Usage:**

```zsh
./maestro_id.sh <agent_name>
```

**Arguments:**

| Argument | Description |
| --- | --- |
| `agent_name` | The exact name of the Maestro agent |

**Options:**

| Flag | Description |
| --- | --- |
| `-h, --help` | Show help and exit |

**Examples:**

```zsh
./maestro_id.sh Wiz-Devel
./maestro_id.sh wizard-pr-345-claude-code
```

**What it does:**

Parses the output of `maestro_dev_cli list agents` and prints the UUID of the named agent to stdout. Exits non-zero if no agent matches or if multiple agents share the same name (prints a warning with all matching UUIDs in that case).

### `maestro_watch.sh` — Auto Run Completion Watcher

Watches a Maestro Auto Run agent and prints a running log until the run is
**fully** done, then fires a desktop toast notification.

This exists because `maestro_dev_cli session list` / `show agent` report the
agent as _idle_ during an Auto Run: each iteration runs as a detached headless
`claude --print` process rather than a tracked desktop session. The watcher
follows that process by agent ID instead. Since Auto Run exits after every task
and relaunches for the next one, "fully done" is only declared once the process
has stayed gone for the full grace window with no new iteration spawning.

**Usage:**

```zsh
./maestro_watch.sh <agent_id> [grace_seconds] [poll_seconds]
```

**Arguments:**

| Argument | Description |
| --- | --- |
| `agent_id` | The UUID of the Maestro agent to watch (e.g. from [`maestro_id.sh`](#maestro_idsh--agent-uuid-lookup)) |
| `grace_seconds` | How long the process must stay gone before declaring "done". Default: `60` |
| `poll_seconds` | Polling interval. Default: `5` |

**Options:**

| Flag | Description |
| --- | --- |
| `-h, --help` | Show help and exit |

**Examples:**

```zsh
./maestro_watch.sh 14fcd1d2-19ee-482b-8e4a-b521aca9a7e6
./maestro_watch.sh 14fcd1d2-19ee-482b-8e4a-b521aca9a7e6 120 10
./maestro_watch.sh "$(./maestro_id.sh wizard-pr-345-claude-code)"
```

**What it does:**

1. Resolves the Maestro CLI and data dir via [`_maestro_env.sh`](#maestro-cli-resolution); because it reads the agent history file directly off disk, it defaults `MAESTRO_USER_DATA` to the installed app's location when the helper leaves it unset
2. Polls every `poll_seconds` for the agent's `claude --print` process, logging each new iteration as it spawns
3. When the process disappears, opens a grace window of `grace_seconds`, watching for the next iteration to respawn
4. Once the grace window elapses with no respawn, declares the run done, reports the iteration count and number of completed tasks, and fires a `notify toast`

The watcher runs until the agent is fully done (or you interrupt it with `Ctrl-C`).

## Slack-triggered PR review pipeline

The `wiz_pr_*` scripts turn a GitHub PR link dropped into a Slack channel into a
fully automated Maestro code review, with all status updates and artifacts
posted back to the same Slack thread.

### Architecture

A [Hermes](https://github.com/ksylvan/hermes) gateway monitors a single Slack
channel. When a message contains a PR link of the form
`https://github.com/story-wizard/<repo>/pull/<number>`, the gateway loads the
`wiz-pr-review-pipeline` skill, which extracts the repo + PR number and invokes
[`wiz_pr_review.sh`](#wiz_pr_reviewsh--slack-pipeline-driver). From there the
scripts drive everything:

```
Slack PR link
   └─ Hermes gateway (wiz-pr-review-pipeline skill)
        └─ wiz_pr_review.sh
             ├─ maestro_pr.sh ............ worktree + agent + autorun
             ├─ wiz_pr_set_status.sh ..... Status -> "AI Review 1"
             ├─ posts threaded start-ack to Slack
             └─ wiz_pr_watch_finalize.sh (detached)
                  ├─ maestro_watch.sh ..... wait for the review to finish
                  ├─ uploads review artifacts to the thread
                  ├─ sends the finalize prompt to the agent
                  └─ posts the final confirmation (@-mentions the poster)
```

A **re-review** (the author pushed changes and asks for another pass in the
thread) follows a parallel path:

```
Slack thread reply: "re-review this"  (no PR link)
   └─ Hermes gateway (wiz-pr-review-pipeline skill)
        │  recovers repo+PR from session history / thread-state file
        └─ wiz_pr_rereview.sh
             ├─ fetch + verify the exact refs/pull/<PR>/head into the review worktree
             ├─ no new commits? -> post "no changes, ask again" and stop
             └─ new commits:
                  ├─ retain standing Request-Changes review for human handling
                  ├─ archive prior artifacts -> <autorun>/review_<N>/
                  ├─ uncheck all code-review playbook checkboxes
                  ├─ relaunch the Maestro auto-run
                  ├─ wiz_pr_set_status.sh .... Status -> "AI Review 2" (capped)
                  ├─ posts threaded "AI review #N started" ack
                  └─ wiz_pr_watch_finalize.sh (detached, reused as-is)
```

**The scripts post all Slack output themselves.** Because the monitored
(trigger) channel and the output channel are always the *same* channel, output
can never leak elsewhere — so the gateway agent itself just replies `NO_REPLY`.

### Test vs. prod, in one switch

The pipeline runs in one of two modes, controlled entirely by
[`wiz_pr_mode.sh`](#wiz_pr_modesh--switch-pipeline-between-test-and-prod):

| Mode | Monitored + output channel |
| --- | --- |
| `test` | `#wiz-bot` (home/ops) — `C0BCCTG5F0R` |
| `prod` | `#wiz-pull-requests` — `C0APAGTP97F` |

### `wiz_pr_pipeline.env` — shared config

Sourced by the pipeline scripts. **Not secret** (no tokens — the Slack bot token
is read from `~/.hermes/.env` at runtime). The mode/channel block at the top is
managed by `wiz_pr_mode.sh` and should not be hand-edited. Notable settings:

| Variable | Description |
| --- | --- |
| `WIZ_ACTIVE_CHANNEL` | The single channel the pipeline both monitors and posts to (managed by `wiz_pr_mode.sh`) |
| `WIZ_TEST_MODE` | `true` in test mode, `false` in prod (managed by `wiz_pr_mode.sh`) |
| `WIZ_HOME_CHANNEL` / `WIZ_PR_CHANNEL` | Stable channel IDs for `#wiz-bot` and `#wiz-pull-requests` |
| `WIZ_DEFAULT_AGENT_TYPE` | Maestro agent type when the Slack message doesn't specify one (default `claude-code`) |
| `WIZ_REVIEW_FILES` | Review artifacts uploaded to the thread when a review finishes |
| `WIZ_FINALIZE_PROMPT` | Path to the finalize prompt sent to the agent after the review completes |
| `WIZ_WATCH_GRACE` / `WIZ_WATCH_POLL` | `maestro_watch.sh` grace + poll seconds |
| `WIZ_PR_STATE_DIR` | Directory of `thread_ts → {repo,pr,agent}` state records, written on review 1 and read back by `wiz_pr_rereview.sh` so a re-review reply (no PR link) can recover its PR |

### `_wiz_slack.sh` — shared Slack helpers

Sourced (never executed) by the pipeline scripts. Reads `SLACK_BOT_TOKEN` from
`~/.hermes/.env` and exposes helpers for posting and uploading to Slack:

| Function | Description |
| --- | --- |
| `wiz_slack_ready` | True if a bot token is available |
| `wiz_slack_post <channel> <thread_ts\|""> <text>` | Post a (optionally threaded) message; echoes the message `ts` |
| `wiz_slack_upload <channel> <thread_ts\|""> <intro> <file...>` | Upload one or more files to the thread with an intro comment |
| `wiz_slack_thread_author <channel> <thread_ts>` | Echo the user id of the thread-parent author (used to @-mention the original poster) |

### `wiz_pr_mode.sh` — switch pipeline between test and prod

A single switch that keeps the scripts' output channel and the gateway's
monitored channel in lockstep, so output can never land in the wrong place.

**Usage:**

```zsh
./wiz_pr_mode.sh [test|prod|status]
```

| Argument | Description |
| --- | --- |
| `test` | Monitor + post to `#wiz-bot` (home/ops) |
| `prod` | Monitor + post to `#wiz-pull-requests` (the PR channel) |
| `status` | Print the current mode + monitored channel (default if no argument) |

**What it does:**

1. Updates `wiz_pr_pipeline.env` (`WIZ_TEST_MODE` + `WIZ_ACTIVE_CHANNEL`) — the channel the scripts post to
2. Updates the Hermes gateway config — `slack.free_response_channels`, the channel prompt, and `channel_skill_bindings` — to monitor the active channel and dispatch to the `wiz-pr-review-pipeline` skill, pruning the inactive channel's prompt/binding so a previous mode can't linger

> **After switching you must restart the gateway** from a shell *outside* the
> gateway process for the monitored-channel change to take effect:
>
> ```zsh
> hermes gateway restart
> ```

### `wiz_pr_review.sh` — Slack pipeline driver

The entry point invoked by the gateway skill once it has extracted the repo + PR
number from a PR link. Sets up the review, posts a start-ack, and launches the
detached watcher.

**Usage:**

```zsh
./wiz_pr_review.sh <repo> <pr_number> [agent_type] [thread_ts]
```

| Argument | Description |
| --- | --- |
| `repo` | One of: `wizard`, `wizard-ai`, `wizard-core`, `wizard-link`, `wizard-release`, `wizard-spec` |
| `pr_number` | The PR number (numeric) |
| `agent_type` | Optional agent type. Defaults to `WIZ_DEFAULT_AGENT_TYPE` (`claude-code`) |
| `thread_ts` | Optional Slack thread timestamp to post all output under |

**What it does:**

1. Looks up the PR title + URL via `gh` (also validating it exists)
2. Runs [`maestro_pr.sh`](#maestro_prsh--pr-review-setup) to create the worktree, Maestro agent, and autorun
3. On success: sets the project Status to **"AI Review 1"** via [`wiz_pr_set_status.sh`](#wiz_pr_set_statussh--set-pr-project-status), posts a threaded start-ack, and launches [`wiz_pr_watch_finalize.sh`](#wiz_pr_watch_finalizesh--watch-and-finalize) detached
4. On failure: posts a failure report (with the stage + tail of the log) to the channel

It always prints a one-line JSON summary to stdout (for logs / the agent),
whether it succeeds or fails.

### `wiz_pr_rereview.sh` — re-run a review after the author pushes changes

Invoked by the gateway skill when someone replies in an existing PR-review
thread asking for another review (e.g. "re-review this"). Pulls the branch and,
if there are new commits, re-runs the whole Maestro review in the **same**
worktree/agent, threading all output under the original review thread.

**Usage:**

```zsh
./wiz_pr_rereview.sh <repo> <pr_number> [agent_type] [thread_ts]
```

Same argument shape as [`wiz_pr_review.sh`](#wiz_pr_reviewsh--slack-pipeline-driver).
The skill recovers `repo`/`pr_number`/`agent_type` for the thread from the
session history or the `WIZ_PR_STATE_DIR` state file (a re-review reply carries
no PR link of its own).

**What it does:**

1. Locates the existing review worktree, autorun dir, and Maestro agent using
   the same deterministic `<repo>-pr-<pr_number>-<agent_type>` naming review 1
   used (fails clearly if no prior review exists for that PR/agent)
2. Fetches `refs/pull/<PR>/head` directly from `story-wizard/<repo>`, verifies
   that fetched SHA equals the API-derived PR head, and hard-resets only the
   isolated review worktree. This intentionally ignores the generated review
   branch's upstream, which `gh pr checkout --branch` may leave pointing at a
   frozen remote review branch. Force-pushes and fork-backed PRs are therefore
   synchronized to the exact reviewed commit or fail closed.
3. **If HEAD is unchanged** (no new commits): posts _"There are no changes in
   the branch. Please make your changes and ask again."_ to the thread and exits
   (`action:"no_changes"`). Nothing else happens — no archive, no relaunch.
4. **If there are new commits:**
   - Leaves any standing `CHANGES_REQUESTED` review in place. A local pipeline
     lock cannot serialize a concurrent GitHub push, so automatic dismissal
     could unblock a newly advanced, unreviewed head. A human may dismiss the
     old block after checking the current review/head.
   - Archives the previous round's artifacts (`WIZ_REVIEW_FILES` + `PR_COMMENT.md`)
     into `<autorun_dir>/review_<N>/`, where `N` is the round being archived
     (first re-review → `review_1`, next → `review_2`, …)
   - Unchecks every checkbox (`- [x]` → `- [ ]`) in the
     `development/code-review/*.md` playbooks so the auto-run reruns every task
   - Relaunches the Maestro auto-run against the playbooks
   - Sets project Status to **"AI Review 2"** (the board only has rounds 1 and
     2, so this is capped; for a 3rd+ review the real round number is stated in
     the Slack ack instead)
   - Posts a threaded "AI review #N started" ack noting the SHA change and the
     archive location
   - Launches [`wiz_pr_watch_finalize.sh`](#wiz_pr_watch_finalizesh--watch-and-finalize)
     detached — the **same** watcher review 1 uses, so the new artifacts are
     uploaded, the finalize prompt is sent, and the poster is @-mentioned when
     the rerun completes

Its watcher log lands in `~/wizard/tmp/wiz-pr-logs/<worktree>-rereviewN-<ts>.log`.
Like the other pipeline scripts, it posts all Slack output itself and prints one
JSON summary line to stdout.

### `wiz_pr_build.sh` — dispatch a tagged build of a PR's branch

Triggered when someone in a PR thread asks for a **tagged build** (e.g. "generate
a tagged build using this branch as the wizard app branch"). Dispatches the
wizard-release **Build and Release** workflow (`build-release.yml`) with the PR's
branch routed to the correct app ref.

**Usage:**

```zsh
./wiz_pr_build.sh [--resolve-only] [--x86] \
    [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] \
    <repo> <pr_number> <release_tag> [thread_ts]
```

`<release_tag>` is the tag WITHOUT the leading `v` (release.yml prepends it), e.g.
`clip-scaling-policy-wizard-609` → git tag `vclip-scaling-policy-wizard-609`. The
skill crafts the human-meaningful slug; the script treats it as opaque.

**Ref routing** (the PR branch goes to the matching app ref; the rest default to
`develop`):

| PR repo | `wizard_ref` | `wizard_core_ref` | `wizard_ai_ref` |
| --- | --- | --- | --- |
| `wizard` | PR branch | inferred¹ | `develop` |
| `wizard-ai` | `develop` | inferred¹ | PR branch |
| `wizard-core` | `develop` | PR branch | `develop` |
| `wizard-link` | `develop` | `develop` | `develop` |

¹ *inferred* = read `.github/wizard-core-ref` from the PR branch; if it's anything
other than `develop`, use that value (this is how a wizard/-ai PR pins a matching
wizard-core branch). `--wizard-ref` / `--wizard-core-ref` / `--wizard-ai-ref`
override any of these (used to honor a user's edits at the confirmation step).

**Modes:**

- `--resolve-only` — resolve the three refs + tag and print them as JSON. **No
  side effects** (no tag delete, no dispatch, no Slack). The skill uses this to
  build the confirmation message it shows the requester before committing.
- default — delete any existing release/tag with the same name (the tagged
  `gh release create` has no `--clobber`, so a rebuild would otherwise fail),
  dispatch `build-release.yml`, post a threaded ack, and launch the detached
  watcher.

`wizard-release` / `wizard-spec` PRs are rejected (they can't drive an app build). `wizard-link` PRs are build-eligible but all three refs default to `develop`.
Prints one JSON summary line to stdout.

### `wiz_pr_build_watch.sh` — watch a dispatched build and post the result

Launched **detached** by `wiz_pr_build.sh`. Because `gh workflow run` returns no
run id, it locates the run as the newest `build-release.yml` `workflow_dispatch`
run created at/after the dispatch timestamp, then polls it to completion and posts
to the thread:

1. **success** → posts the release link (`…/releases/tag/v<tag>`), @-mentioning the
   requester (after confirming the release page exists);
2. **failure** → posts the failing run URL;
3. **timeout** (default ~40 min) → posts a "still running" note with the run URL.

Tuning lives in `wiz_pr_pipeline.env`: `WIZ_BUILD_POLL`, `WIZ_BUILD_MAX_WAIT`,
`WIZ_BUILD_FIND_TRIES`.

### `wiz_pr_set_status.sh` — set PR project Status

Sets a PR's **Status** on the org "Wizard Development" project (org
`story-wizard`, project #1) to a named single-select option. Used by the
pipeline to mark a PR as "AI Review 1", but usable standalone.

**Usage:**

```zsh
./wiz_pr_set_status.sh <repo> <pr_number> "<status_name>"
```

| Argument | Description |
| --- | --- |
| `repo` | One of: `wizard`, `wizard-ai`, `wizard-core`, `wizard-link`, `wizard-release`, `wizard-spec` |
| `pr_number` | The PR number (numeric) |
| `status_name` | Exact Status option name, e.g. `"AI Review 1"` |

**What it does:**

1. Resolves the project id, Status field id, and target option id live via the GitHub GraphQL API (an invalid status name prints the valid options)
2. Finds the PR's existing project item (PRs in `story-wizard` are auto-added to project #1); adds it to the board first if it isn't there yet
3. Patches the item's Status single-select value

Requires `gh` authenticated with the `project` scope.

### `wiz_pr_watch_finalize.sh` — watch and finalize

Launched **detached** by `wiz_pr_review.sh` (it blocks for minutes). Waits for
the Maestro review to finish, then posts the artifacts and finalizes.

**Usage:**

```zsh
./wiz_pr_watch_finalize.sh <repo> <pr_number> <agent_id> <autorun_dir> <pr_title> <pr_url> <thread_ts>
```

**What it does:**

1. Watches the agent with [`maestro_watch.sh`](#maestro_watchsh--auto-run-completion-watcher) until the Auto Run is fully idle
2. Collects the `WIZ_REVIEW_FILES` artifacts from the autorun dir and uploads them to the thread (noting any missing ones; falls back to a text-only notice if none are present)
3. Sends the `WIZ_FINALIZE_PROMPT` to the Maestro agent (which creates the GitHub PR review), best-effort extracting the resulting review URL from the agent's response
4. Posts a final confirmation to the thread, @-mentioning the original poster

Its own progress log goes to `~/wizard/tmp/wiz-pr-logs/<worktree>-<timestamp>.log`
(the path is reported in `wiz_pr_review.sh`'s JSON summary as `watcher_log`).
