#!/bin/bash

# wiz_pr_review.sh — Driver for the Slack-triggered PR review pipeline.
#
# Parses repo + PR (caller extracts them from a GitHub PR link), then:
#   1. Runs maestro_pr.sh to set up worktree + Maestro agent + autorun.
#   2. On success: sets project Status to "AI Review 1", posts a threaded
#      start-ack to WIZ_ACTIVE_CHANNEL, and launches the detached watcher
#      (which posts artifacts + finalize when the review completes).
#   3. On failure: posts a failure report to WIZ_ACTIVE_CHANNEL.
#
# The SCRIPT posts all Slack output itself (monitored channel == output
# channel), so the agent does not need to post anything and can reply NO_REPLY.
#
# Usage:
#   wiz_pr_review.sh [--ready] <repo> <pr_number> <thread_ts>
#   wiz_pr_review.sh [--ready] <repo> <pr_number> <agent_type> <thread_ts>
#   wiz_pr_review.sh --board-trigger <repo> <pr_number> [agent_type]
#
# --ready: used only after the human requester explicitly confirms that a draft
#   PR should be marked Ready for review. The driver marks it ready, verifies the
#   transition, and then launches the fresh review.
#
# --board-trigger: invoked by wiz_pr_poll_board.sh (GitHub board status change,
#   not a Slack message). There is no triggering Slack message to thread under,
#   so the driver SELF-POSTS a root announcement to the active channel and uses
#   that message's ts as the lifecycle thread for all subsequent posts. In this
#   mode no trailing thread_ts is expected (any given one is ignored).
#
# Also prints a one-line JSON summary to stdout (for logs / the agent).

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_pipeline.env"}'; exit 1; }
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source _wiz_slack.sh"}'; exit 1; }
# shellcheck source=wiz_pr_review_state.sh
source "${script_dir}/wiz_pr_review_state.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_review_state.sh"}'; exit 1; }

dest_channel="${WIZ_ACTIVE_CHANNEL}"

# React on the triggering message: helper guards on empty thread_ts/token.
react_set() {
    # react_set <emoji_name> — add a reaction to the trigger message (best-effort)
    [[ -n "${thread_ts:-}" ]] && wiz_slack_ready \
        && wiz_slack_react "$dest_channel" "$thread_ts" "$1" >/dev/null 2>&1 || true
}
react_swap() {
    # react_swap <from_emoji> <to_emoji>
    [[ -n "${thread_ts:-}" ]] && wiz_slack_ready || return 0
    wiz_slack_unreact "$dest_channel" "$thread_ts" "$1" >/dev/null 2>&1 || true
    wiz_slack_react   "$dest_channel" "$thread_ts" "$2" >/dev/null 2>&1 || true
}

post_fail() {
    # post_fail <stage> <message> — report to active channel + emit JSON, exit 1
    local stage="$1" msg="$2" text
    # If this invocation created fresh setup but has not entered the uncertain
    # launch window, remove it so the next attempt cannot collide.
    if command -v fresh_cleanup_prelaunch >/dev/null 2>&1 \
        && [[ "${fresh_setup_maybe:-false}" == "true" && "${fresh_launch_maybe:-false}" != "true" ]]; then
        fresh_cleanup_prelaunch
    fi
    # Swap the in-progress reaction (if any) to the failed marker.
    react_swap "${WIZ_REACT_INPROGRESS}" "${WIZ_REACT_FAILED}"
    text="❌ *PR review setup failed* for \`story-wizard/${repo:-?}\` PR #${pr_number:-?} at stage *${stage}*."$'\n'"\`\`\`"$'\n'"${msg}"$'\n'"\`\`\`"
    if wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "${thread_ts:-}" "$text" >/dev/null || true
    fi
    jq -nc --arg repo "${repo:-}" --arg pr "${pr_number:-}" --arg stage "$stage" --arg msg "$msg" \
        '{ok:false, repo:$repo, pr_number:$pr, stage:$stage, message:$msg}'
    exit 1
}

[[ $# -ge 1 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_review.sh [--board-trigger] [--ready] <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }

# Optional leading flags. Keep parsing compatible with macOS Bash 3.2.
board_trigger=false
mark_ready=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --board-trigger) board_trigger=true; shift ;;
        --ready) mark_ready=true; shift ;;
        *) break ;;
    esac
done

if [[ "$board_trigger" == "true" && "$mark_ready" == "true" ]]; then
    echo '{"ok":false,"stage":"args","message":"--ready requires an explicit human-triggered Slack thread"}'
    exit 1
fi

[[ $# -ge 2 && $# -le 4 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_review.sh [--board-trigger] [--ready] <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }

repo="$1"
pr_number="$2"
agent_arg="${3:-}"
thread_ts="${4:-}"

# For a human-triggered review, the natural three-argument form is
#   <repo> <pr> <trigger-message-ts>
# Treat a Slack timestamp in argv[3] as the thread, not as an agent type. The
# previous positional ambiguity silently discarded the thread after parity
# selected the real agent, causing every lifecycle post to escape to channel
# root. Keep the four-argument explicit-agent form for callers that need it.
if [[ "$board_trigger" != "true" && $# -eq 3 \
    && "$agent_arg" =~ ^[0-9]+\.[0-9]+$ ]]; then
    thread_ts="$agent_arg"
    agent_arg=""
fi
agent_type="${agent_arg:-$WIZ_DEFAULT_AGENT_TYPE}"

# Human-triggered reviews must never post lifecycle messages at channel root.
# Fail locally, before PR lookup or post_fail(), when routing is absent or
# malformed. Board-triggered reviews intentionally create their own root.
if [[ "$board_trigger" != "true" \
    && ! "$thread_ts" =~ ^[0-9]+\.[0-9]+$ ]]; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" \
        '{ok:false,repo:$repo,pr_number:$pr,stage:"args",message:"human-triggered review requires the Slack trigger message ts"}'
    exit 1
fi

# Crucible round 1 is always assigned by parity when alternation is enabled.
# Explicit agent arguments remain supported when the feature toggle is off.
review_round=1
if [[ "${WIZ_REVIEW_ALTERNATE_AGENTS:-false}" == "true" ]]; then
    agent_type="$(wiz_review_agent_for_round "$review_round")"
fi

command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
[[ "$pr_number" =~ ^[0-9]+$ ]] || post_fail "args" "PR number must be numeric, got '${pr_number}'"

# Fresh and re-review share one stale-recoverable launch lock per PR. Acquire it
# before PR lookup or a board-triggered Slack root so concurrent triggers cannot
# create duplicate announcements, worktrees, agents, or canonical state.
fresh_lock_dir=""
run_log=""
fresh_exit_cleanup() {
    [[ -n "$run_log" ]] && rm -f "$run_log"
    [[ -n "${thread_state_backup:-}" && -d "${thread_state_backup:-}" ]] && rm -rf "$thread_state_backup"
    wiz_review_launch_lock_release "$fresh_lock_dir"
}
trap fresh_exit_cleanup EXIT
if ! fresh_lock_dir="$(wiz_review_launch_lock_acquire "$repo" "$pr_number")"; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" \
        '{ok:true,action:"busy",repo:$repo,pr_number:$pr,message:"another review launch is already preparing"}'
    exit 0
fi

# ---- fetch PR title + url (also validates existence) ----
pr_meta=$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title,url,state,isDraft,author 2>&1) \
    || post_fail "pr_lookup" "PR #${pr_number} not found in story-wizard/${repo}: ${pr_meta}"
pr_title=$(echo "$pr_meta" | jq -r '.title')
pr_url=$(echo "$pr_meta" | jq -r '.url')
pr_author_login=$(echo "$pr_meta" | jq -r '.author.login // empty')
pr_state=$(echo "$pr_meta" | jq -r '.state // empty')
pr_is_draft=$(echo "$pr_meta" | jq -r 'if has("isDraft") then .isDraft else true end')
[[ "$pr_state" == "OPEN" ]] || post_fail "pr_lookup" "PR #${pr_number} is not open"

# Draft eligibility must be decided before board roots, canonical state,
# worktrees, Maestro agents, or Auto Run directories are created. A human can
# opt in to the state transition with --ready after explicitly confirming in
# the lifecycle thread.
if [[ "$pr_is_draft" == "true" && "$mark_ready" != "true" ]]; then
    if [[ "$board_trigger" == "true" ]]; then
        jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg title "$pr_title" --arg url "$pr_url" \
            '{ok:true,action:"draft_skipped",repo:$repo,pr_number:$pr,pr_title:$title,pr_url:$url,is_draft:true}'
        exit 0
    fi
    draft_prompt="⚠️ *${pr_title}* (<${pr_url}>) is still in draft mode. Would you like me to mark it Ready for review and launch the AI code review?"
    if wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "$thread_ts" "$draft_prompt" >/dev/null || true
    fi
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg title "$pr_title" --arg url "$pr_url" \
        '{ok:true,action:"draft_confirmation_required",repo:$repo,pr_number:$pr,pr_title:$title,pr_url:$url,is_draft:true}'
    exit 0
fi

if [[ "$pr_is_draft" == "true" && "$mark_ready" == "true" ]]; then
    ready_out=$(gh pr ready "$pr_number" --repo "story-wizard/${repo}" 2>&1) \
        || post_fail "mark_ready" "could not mark PR #${pr_number} Ready for review: ${ready_out}"
    pr_meta=$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title,url,state,isDraft,author 2>&1) \
        || post_fail "pr_lookup" "could not verify Ready-for-review transition for PR #${pr_number}: ${pr_meta}"
    pr_title=$(echo "$pr_meta" | jq -r '.title')
    pr_url=$(echo "$pr_meta" | jq -r '.url')
    pr_author_login=$(echo "$pr_meta" | jq -r '.author.login // empty')
    [[ "$(echo "$pr_meta" | jq -r '.state // empty')" == "OPEN" ]] \
        || post_fail "mark_ready" "PR #${pr_number} is no longer open after Ready-for-review transition"
    [[ "$(echo "$pr_meta" | jq -r 'if has("isDraft") then .isDraft else true end')" == "false" ]] \
        || post_fail "mark_ready" "PR #${pr_number} is still a draft after gh pr ready"
fi

# ---- board-trigger: self-post the lifecycle root and thread under it ----
# There is no Slack trigger message in board mode, so create one. Its ts becomes
# the thread_ts the rest of the driver (acks, watcher, artifacts) posts under.
# @-mention the PR author on this root so they get a Slack notification that a
# board-triggered review of their PR has started (a human-triggered review
# already threads under the human's own message, so this only applies to the
# board path where nobody typed in Slack).
if [[ "$board_trigger" == "true" ]]; then
    if wiz_slack_ready; then
        author_mention=""
        if [[ -n "$pr_author_login" ]] && command -v wiz_gh_to_slack >/dev/null 2>&1; then
            author_sid="$(wiz_gh_to_slack "$pr_author_login" 2>/dev/null)"
            [[ -n "$author_sid" ]] && author_mention="<@${author_sid}> "
        fi
        root_msg="🤖 ${author_mention}AI code review queued for *${pr_title}* (<${pr_url}>) — triggered from the project board. Setting up the Maestro agent…"
        root_ts="$(wiz_slack_post "$dest_channel" "" "$root_msg" 2>/dev/null)"
        [[ -n "$root_ts" ]] && thread_ts="$root_ts"
    fi
fi

# ---- 1. prepare worktree/agent/playbooks WITHOUT launching ----
worktree_name="${repo}-pr-${pr_number}-${agent_type}"
worktree_dir="${HOME}/wizard/worktrees/${repo}/${worktree_name}"
autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"
state_file="$(wiz_review_state_file "$repo" "$pr_number")"
run_log="$(mktemp -t wiz_pr_review.XXXXXX)"
thread_state_backup=""
fresh_setup_maybe=false
fresh_launch_maybe=false

fresh_cleanup_prelaunch() {
    rm -f "$state_file"
    if [[ -n "$thread_state_backup" ]]; then
        wiz_review_thread_state_restore "$repo" "$pr_number" "$thread_ts" "$thread_state_backup" >/dev/null 2>&1 || true
    fi
    "${script_dir}/maestro_wt.sh" --delete --force "$repo" "pr-${pr_number}" "$agent_type" >/dev/null 2>&1 || true
}
fresh_handle_signal() {
    local code="$1"
    # Before entering the side-effecting launch command, setup is known safe to
    # remove. Once launch outcome is uncertain, retain launching state fail-closed.
    if [[ "$fresh_setup_maybe" == "true" && "$fresh_launch_maybe" != "true" ]]; then
        fresh_cleanup_prelaunch
    fi
    exit "$code"
}
trap 'fresh_handle_signal 130' INT
trap 'fresh_handle_signal 143' TERM

# Never let fresh-review failure cleanup delete a pre-existing review.
if [[ -e "$worktree_dir" || -s "$state_file" ]] \
    || "${script_dir}/maestro_id.sh" "$worktree_name" >/dev/null 2>&1; then
    post_fail "existing_review" "worktree, agent, or canonical state already exists for ${worktree_name}; use re-review"
fi

fresh_setup_maybe=true
"${script_dir}/maestro_pr.sh" --no-run "$repo" "$pr_number" "$agent_type" >"$run_log" 2>&1
rc=$?
if [[ $rc -ne 0 ]]; then
    fresh_cleanup_prelaunch
    post_fail "maestro_pr" "maestro_pr.sh exited ${rc}. Last output:"$'\n'"$(tail -25 "$run_log")"
fi

# ---- derive agent id + autorun dir ----
agent_id="$(grep -E 'Agent ID' "$run_log" | tail -1 | sed -E 's/.*Agent ID[[:space:]]*:[[:space:]]*//' | tr -d '[:space:]')"
[[ -n "$agent_id" ]] || agent_id="$("${script_dir}/maestro_id.sh" "$worktree_name" 2>/dev/null | tr -d '[:space:]')"
[[ -n "$agent_id" ]] || post_fail "agent_id" "could not determine Maestro agent id (worktree ${worktree_name})"
review_head="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)"
[[ -n "$review_head" ]] || post_fail "git" "could not determine review HEAD in ${worktree_dir}"

# Resolve Maestro CLI before committing canonical launch state.
# shellcheck source=_maestro_env.sh
source "${script_dir}/_maestro_env.sh" || post_fail "maestro_env" "cannot source _maestro_env.sh"

# Canonical PR-level state must exist BEFORE launch. This makes state failure
# fail closed: no untracked Auto Run can start. Each launch has a unique attempt
# id so a failed-attempt watcher cannot affect a same-round retry.
attempt_id="r${review_round}-$(date +%s)-$$-${RANDOM}"
if ! wiz_review_state_record_launch "$repo" "$pr_number" "$review_round" "$agent_type" \
    "$review_head" "$thread_ts" "$agent_id" "$worktree_name" "$worktree_dir" "$autorun_dir" "launching" "$attempt_id"; then
    "${script_dir}/maestro_wt.sh" --delete --force "$repo" "pr-${pr_number}" "$agent_type" >/dev/null 2>&1 || true
    rm -f "$state_file"
    post_fail "state" "could not initialize canonical review state; prepared agent was removed"
fi
if [[ -n "$thread_ts" ]]; then
    thread_state_backup="$(mktemp -d -t wiz-thread-state.XXXXXX)" \
        || post_fail "state_routing" "could not create Slack thread state rollback snapshot"
    wiz_review_thread_state_snapshot "$repo" "$pr_number" "$thread_ts" "$thread_state_backup" \
        || post_fail "state_routing" "could not snapshot Slack thread state"
    wiz_review_thread_state_write "$repo" "$pr_number" "$thread_ts" "$agent_type" \
        "$review_round" "$attempt_id" "$review_head" "$agent_id" "$worktree_name" \
        "$worktree_dir" "$autorun_dir" \
        || post_fail "state_routing" "could not persist attempt-aware Slack thread state"
fi

playbook_dir="${autorun_dir}/development/code-review"
fresh_launch_maybe=true
launch_out="$(node "$maestro_cli" auto-run -a "$agent_id" "${playbook_dir}"/* --launch 2>&1)"; launch_rc=$?
launch_warning=""
if [[ $launch_rc -ne 0 ]]; then
    # Async launch may have escaped despite a nonzero CLI status. Keep setup and
    # canonical state, then let the bounded watcher prove completion or failure.
    launch_warning="${agent_type} launch returned rc=${launch_rc}; treating outcome as uncertain: $(printf '%s' "$launch_out" | tail -3 | tr '\n' ' ')"
fi

# Watch immediately after launch. Even if the running-state update fails, this
# watcher can finish/finalize the exact round and mark it completed.
log_dir="${HOME}/wizard/tmp/wiz-pr-logs"; mkdir -p "$log_dir"
watch_log="${log_dir}/${worktree_name}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_watch_finalize.sh" \
    "$repo" "$pr_number" "$agent_id" "$autorun_dir" "$pr_title" "$pr_url" "$thread_ts" \
    "$agent_type" "$review_round" "$attempt_id" >"$watch_log" 2>&1 &
watcher_pid=$!
disown "$watcher_pid" 2>/dev/null || true

watcher_state_set=true
state_running_set=true
fast_terminal_status=""
if ! wiz_review_state_record_watcher "$repo" "$pr_number" "$review_round" "$watcher_pid" "$watch_log" "$attempt_id" 0; then
    terminal_after_launch="$(jq -r '.status // empty' "$state_file" 2>/dev/null)"
    case "$terminal_after_launch" in
        completed|failed) fast_terminal_status="$terminal_after_launch" ;; # child won the CAS
        *) watcher_state_set=false; state_running_set=false ;;
    esac
fi
# Keep the shared launch lock through parent-side routing, board, and Slack
# startup effects. The finalizer uses a bounded long-wait acquisition before
# any terminal transition or publication.

# Thread routing was initialized before Maestro launch; a fast terminal child
# must remain the only source of terminal side effects.

# A terminal child already emitted authoritative completion/failure side effects.
# Never follow them with a stale in-progress reaction, board transition, or
# "started" acknowledgement.
if [[ -n "$fast_terminal_status" ]]; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg status "$fast_terminal_status" \
        --argjson round "$review_round" --arg head "$review_head" \
        '{ok:($status=="completed"),action:$status,repo:$repo,pr_number:$pr,review_round:$round,head:$head}'
    [[ "$fast_terminal_status" == completed ]] && exit 0
    exit 1
fi

# ---- in-progress reaction on the trigger message ----
react_set "${WIZ_REACT_INPROGRESS}"

# ---- 2. set project status to "AI Review 1" ----
status_set=true
status_msg=""
if ! status_msg=$("${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "AI Review 1" 2>&1); then
    status_set=false
fi

# ---- 4. post the start-ack (threaded) ----
ack="🤖 Started AI code review #${review_round} with *${agent_type}* for *${pr_title}* (<${pr_url}>) — Maestro agent \`${agent_id}\` is running."
[[ "$state_running_set" != "true" ]] && ack+=$'\n'"⚠️ Canonical state remains *launching*; watcher will mark it completed or failed."
[[ "$watcher_state_set" != "true" ]] && ack+=$'\n'"⚠️ Watcher PID could not be recorded; automatic abrupt-death recovery is unavailable for this round."
[[ -n "$launch_warning" ]] && ack+=$'\n'"⚠️ ${launch_warning}; bounded watcher verification is authoritative."
if [[ "$status_set" == "true" ]]; then
    ack+=" Project status set to *AI Review 1*."
else
    ack+=$'\n'"⚠️ Could not set project status: ${status_msg}"
fi
ack+=" Review artifacts will be posted here when it finishes."
if wiz_slack_ready; then
    wiz_slack_post "$dest_channel" "${thread_ts:-}" "$ack" >/dev/null || true
fi

# ---- 5. emit summary JSON ----
jq -nc \
    --arg repo "$repo" --arg pr "$pr_number" \
    --arg title "$pr_title" --arg url "$pr_url" \
    --arg agent "$agent_id" --arg agent_type "$agent_type" --arg autorun "$autorun_dir" \
    --argjson round "$review_round" --arg head "$review_head" \
    --argjson status_set "$status_set" --arg status_msg "$status_msg" --argjson state_running_set "$state_running_set" \
    --arg pid "$watcher_pid" --arg wlog "$watch_log" --arg ch "$dest_channel" \
    '{ok:true, action:"review", repo:$repo, pr_number:$pr, pr_title:$title, pr_url:$url,
      agent_id:$agent, agent_type:$agent_type, review_round:$round, head:$head,
      autorun_dir:$autorun, status_set:$status_set, state_running_set:$state_running_set,
      status_message:$status_msg, watcher_pid:$pid, watcher_log:$wlog,
      posted_to:$ch}'
