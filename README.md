# wiz-ops

Operational scripts and tooling for the [story-wizard](https://github.com/story-wizard) repositories.

## Overview

This repo collects convenience scripts that support day-to-day development workflows across the Wizard ecosystem — starting with PR review automation.

## Requirements

- [`gh`](https://cli.github.com/) — GitHub CLI, authenticated
- [`jq`](https://stedolan.github.io/jq/)
- [`node`](https://nodejs.org/) (for the Maestro CLI)
- A local clone of the [Maestro](https://github.com/ksylvan/Maestro) `preview` worktree at `~/src/worktrees/Maestro/preview`
- Code Review playbooks at `~/src/maestro-playbooks-custom/playbooks/Code_Review/`
- Worktree helper functions sourced from `~/.zshrc.d/80-git-worktrees.zsh`

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
3. Copies Code Review playbooks into `~/wizard/worktrees/autorun/<repo>/<worktree>/development/code-review/`
4. Patches the correct PR URL into `1_ANALYZE_CHANGES.md`
5. Checks out the PR branch in the worktree via `gh pr checkout`
6. Triggers the auto-run sequence against the playbooks (skipped with `--no-run`)

The agent is always nudged with: _"Do not make any changes this is only a review task."_
Worktree cleanup is left to the user after the review is complete.

### `maestro_wt.sh` — Named Worktree + Maestro Agent

Sets up a named git worktree wired up to a Maestro agent — without any PR-review
or playbook scaffolding. Useful when you want an isolated workspace for general
feature work, experiments, or refactors driven by a Maestro agent.

**Usage:**

```zsh
./maestro_wt.sh [--nudge MSG] [--json-out PATH] <repo> <worktree_name> [agent_type]
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

**Examples:**

```zsh
./maestro_wt.sh wizard-core my-feature
./maestro_wt.sh wizard refactor-auth
./maestro_wt.sh wizard-ai experiment codex
./maestro_wt.sh --nudge "review only" --json-out /tmp/a.json wizard-core pr-209
```

**What it does:**

1. Creates a git worktree named `<repo>-<worktree_name>-<agent_type>` under `~/wizard/worktrees/<repo>/`
2. Creates the matching autorun directory under `~/wizard/worktrees/autorun/<repo>/<worktree>/`
3. Creates a Maestro agent scoped to the worktree using the selected `agent_type` (default: `claude-code`), pointed at the autorun directory

Unlike `maestro_pr.sh`, this script does **not** copy any playbooks, does not check
out a PR, and does not trigger an auto-run launch — the worktree starts on the
default branch and the agent has no nudge message. Drop your own playbooks into
the autorun directory if/when you want to run them.

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
