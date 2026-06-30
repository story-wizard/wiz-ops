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
#   wiz_pr_review.sh [--board-trigger] <repo> <pr_number> [agent_type] [thread_ts]
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

[[ $# -ge 1 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_review.sh [--board-trigger] <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }

# Optional leading --board-trigger flag (board poller invocation).
board_trigger=false
if [[ "$1" == "--board-trigger" ]]; then
    board_trigger=true
    shift
fi

[[ $# -ge 2 && $# -le 4 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_review.sh [--board-trigger] <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }

repo="$1"
pr_number="$2"
agent_type="${3:-$WIZ_DEFAULT_AGENT_TYPE}"
thread_ts="${4:-}"

command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
[[ "$pr_number" =~ ^[0-9]+$ ]] || post_fail "args" "PR number must be numeric, got '${pr_number}'"

# ---- fetch PR title + url (also validates existence) ----
pr_meta=$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title,url,state,isDraft 2>&1) \
    || post_fail "pr_lookup" "PR #${pr_number} not found in story-wizard/${repo}: ${pr_meta}"
pr_title=$(echo "$pr_meta" | jq -r '.title')
pr_url=$(echo "$pr_meta" | jq -r '.url')

# ---- board-trigger: self-post the lifecycle root and thread under it ----
# There is no Slack trigger message in board mode, so create one. Its ts becomes
# the thread_ts the rest of the driver (acks, watcher, artifacts) posts under.
if [[ "$board_trigger" == "true" ]]; then
    if wiz_slack_ready; then
        root_msg="🤖 AI code review queued for *${pr_title}* (<${pr_url}>) — triggered from the project board. Setting up the Maestro agent…"
        root_ts="$(wiz_slack_post "$dest_channel" "" "$root_msg" 2>/dev/null)"
        [[ -n "$root_ts" ]] && thread_ts="$root_ts"
    fi
fi

# ---- 1. run maestro_pr.sh ----
run_log="$(mktemp -t wiz_pr_review.XXXXXX)"
trap 'rm -f "$run_log"' EXIT
"${script_dir}/maestro_pr.sh" "$repo" "$pr_number" "$agent_type" >"$run_log" 2>&1
rc=$?
[[ $rc -eq 0 ]] || post_fail "maestro_pr" "maestro_pr.sh exited ${rc}. Last output:"$'\n'"$(tail -25 "$run_log")"

# ---- derive agent id + autorun dir ----
worktree_name="${repo}-pr-${pr_number}-${agent_type}"
autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"
agent_id="$(grep -E 'Agent ID' "$run_log" | tail -1 | sed -E 's/.*Agent ID[[:space:]]*:[[:space:]]*//' | tr -d '[:space:]')"
[[ -n "$agent_id" ]] || agent_id="$("${script_dir}/maestro_id.sh" "$worktree_name" 2>/dev/null | tr -d '[:space:]')"
[[ -n "$agent_id" ]] || post_fail "agent_id" "could not determine Maestro agent id (worktree ${worktree_name})"

# ---- persist thread -> PR state so a later "re-review" reply can recover it ----
# A re-review request arrives as a threaded reply with NO PR link, so it cannot
# re-parse repo/pr from its own text. We key a small JSON record by the Slack
# thread (the triggering message's ts, which becomes the thread parent for all
# pipeline posts). wiz_pr_rereview.sh reads it back. Best-effort: never fail the
# review if the state write doesn't work.
if [[ -n "${thread_ts:-}" ]]; then
    state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    mkdir -p "$state_dir" 2>/dev/null \
        && jq -nc \
            --arg repo "$repo" --arg pr "$pr_number" --arg agent "$agent_type" \
            --arg wt "$worktree_name" --arg autorun "$autorun_dir" \
            --arg agent_id "$agent_id" --arg thread "$thread_ts" \
            '{repo:$repo, pr_number:$pr, agent_type:$agent, worktree_name:$wt,
              autorun_dir:$autorun, agent_id:$agent_id, thread_ts:$thread}' \
            > "${state_dir}/${thread_ts}.json" 2>/dev/null \
        || true
fi

# ---- in-progress reaction on the trigger message ----
react_set "${WIZ_REACT_INPROGRESS}"

# ---- 2. set project status to "AI Review 1" ----
status_set=true
status_msg=""
if ! status_msg=$("${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "AI Review 1" 2>&1); then
    status_set=false
fi

# ---- 3. launch detached watcher ----
log_dir="${HOME}/wizard/tmp/wiz-pr-logs"; mkdir -p "$log_dir"
watch_log="${log_dir}/${worktree_name}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_watch_finalize.sh" \
    "$repo" "$pr_number" "$agent_id" "$autorun_dir" "$pr_title" "$pr_url" "$thread_ts" \
    >"$watch_log" 2>&1 &
watcher_pid=$!
disown "$watcher_pid" 2>/dev/null || true

# ---- 4. post the start-ack (threaded) ----
ack="🤖 Started AI code review for *${pr_title}* (<${pr_url}>) — Maestro agent \`${agent_id}\` is running."
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
    --arg agent "$agent_id" --arg autorun "$autorun_dir" \
    --argjson status_set "$status_set" --arg status_msg "$status_msg" \
    --arg pid "$watcher_pid" --arg wlog "$watch_log" --arg ch "$dest_channel" \
    '{ok:true, repo:$repo, pr_number:$pr, pr_title:$title, pr_url:$url,
      agent_id:$agent, autorun_dir:$autorun, status_set:$status_set,
      status_message:$status_msg, watcher_pid:$pid, watcher_log:$wlog,
      posted_to:$ch}'
