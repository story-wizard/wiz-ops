# wiz-ops

Operational scripts and tooling for the [story-wizard](https://github.com/story-wizard) repositories.

## Overview

This repo collects convenience scripts that support day-to-day development workflows across the Wizard ecosystem — starting with PR review automation.

## Requirements

- [`gh`](https://cli.github.com/) — GitHub CLI, authenticated
- [`jq`](https://stedolan.github.io/jq/)
- [`node`](https://nodejs.org/) (for the Maestro CLI)
- The [Maestro](https://github.com/ksylvan/Maestro) CLI — either the installed app at `/Applications/Maestro.app` or a local `preview` worktree (see [Maestro CLI resolution](#maestro-cli-resolution) below)
- Code Review playbooks — preferably checked out locally at `~/src/Maestro-Playbooks/Development/Code-Review`, otherwise fetched from GitHub automatically (see [Code Review playbook source](#code-review-playbook-source) below)
- The `~/wizard/<repo>` checkouts that worktrees are derived from (worktrees land in `~/wizard/worktrees/<repo>/`)

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
