#!/bin/bash

# wiz_pr_rereview.sh — Re-run a Maestro PR review after the author pushed changes.
#
# Triggered when the original poster (or anyone) replies in the PR's Slack
# thread asking for another review (e.g. "re-review this"). The skill recovers
# the repo + PR for the thread and invokes this driver.
#
# Flow:
#   1. Locate the existing review worktree + autorun dir + Maestro agent.
#   2. `git pull --ff-only` in the worktree to pull the author's new commits.
#   3. If nothing changed -> post "no changes, make changes and ask again" and stop.
#   4. If changed:
#        - archive the previous round's review artifacts into
#          <autorun_dir>/review_<N>/   (N = the round being archived)
#        - uncheck every checkbox in development/code-review/*.md
#        - relaunch the Maestro auto-run against the playbooks
#        - set project Status to "AI Review 2" (capped; real round noted in Slack)
#        - post a threaded "second review started" ack
#        - launch wiz_pr_watch_finalize.sh detached (uploads new artifacts +
#          finalizes + @-mentions when the run completes)
#
# Like wiz_pr_review.sh, this SCRIPT posts all Slack output itself (monitored
# channel == output channel), so the agent can reply NO_REPLY.
#
# Usage:
#   wiz_pr_rereview.sh <repo> <pr_number> [agent_type] [thread_ts]
#
# Prints a one-line JSON summary to stdout (for logs / the agent).

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_pipeline.env"}'; exit 1; }
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source _wiz_slack.sh"}'; exit 1; }

dest_channel="${WIZ_ACTIVE_CHANNEL}"

# Files archived per round: the uploaded review artifacts plus the PR comment.
WIZ_ARCHIVE_FILES=("${WIZ_REVIEW_FILES[@]}" PR_COMMENT.md)

post_fail() {
    # post_fail <stage> <message> — report to active channel + emit JSON, exit 1
    local stage="$1" msg="$2" text
    text="❌ *PR re-review failed* for \`story-wizard/${repo:-?}\` PR #${pr_number:-?} at stage *${stage}*."$'\n'"\`\`\`"$'\n'"${msg}"$'\n'"\`\`\`"
    if wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "${thread_ts:-}" "$text" >/dev/null || true
    fi
    jq -nc --arg repo "${repo:-}" --arg pr "${pr_number:-}" --arg stage "$stage" --arg msg "$msg" \
        '{ok:false, repo:$repo, pr_number:$pr, stage:$stage, message:$msg}'
    exit 1
}

[[ $# -ge 2 && $# -le 4 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_rereview.sh <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }

repo="$1"
pr_number="$2"
agent_type="${3:-$WIZ_DEFAULT_AGENT_TYPE}"
thread_ts="${4:-}"

command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
command -v git >/dev/null 2>&1 || post_fail "deps" "git not found"
[[ "$pr_number" =~ ^[0-9]+$ ]] || post_fail "args" "PR number must be numeric, got '${pr_number}'"

# ---- derive paths (same deterministic naming review 1 used) ----
worktree_name="${repo}-pr-${pr_number}-${agent_type}"
worktree_dir="${HOME}/wizard/worktrees/${repo}/${worktree_name}"
autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"
playbook_dir="${autorun_dir}/development/code-review"

[[ -d "$worktree_dir" ]] || post_fail "worktree" "review worktree not found at ${worktree_dir}. Was review 1 ever run for this PR/agent? (try posting the PR link again to start a fresh review)"
[[ -d "$playbook_dir" ]] || post_fail "playbooks" "playbook dir not found at ${playbook_dir}"

# ---- resolve the Maestro agent id ----
agent_id="$("${script_dir}/maestro_id.sh" "$worktree_name" 2>/dev/null | tr -d '[:space:]')"
[[ -n "$agent_id" ]] || post_fail "agent_id" "could not find Maestro agent named '${worktree_name}'"

# ---- PR title + url (for the watcher + posts) ----
pr_meta=$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title,url 2>&1) \
    || post_fail "pr_lookup" "PR #${pr_number} not found in story-wizard/${repo}: ${pr_meta}"
pr_title=$(echo "$pr_meta" | jq -r '.title')
pr_url=$(echo "$pr_meta" | jq -r '.url')

# ---- 1. pull the branch ----
before_sha="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)" \
    || post_fail "git" "cannot read HEAD in ${worktree_dir}"

pull_out="$(git -C "$worktree_dir" pull --ff-only 2>&1)"
pull_rc=$?
if [[ $pull_rc -ne 0 ]]; then
    # A non-fast-forward (e.g. the author force-pushed/rebased) is recoverable:
    # the review branch tracks the PR head, so hard-reset to the upstream.
    upstream="$(git -C "$worktree_dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
    if [[ -n "$upstream" ]] && git -C "$worktree_dir" fetch 2>/dev/null \
        && git -C "$worktree_dir" reset --hard "$upstream" >/dev/null 2>&1; then
        pull_out="(non-fast-forward; hard-reset review branch to ${upstream})"
    else
        post_fail "git_pull" "git pull failed and could not reset to upstream:"$'\n'"${pull_out}"
    fi
fi

after_sha="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)" \
    || post_fail "git" "cannot read HEAD after pull in ${worktree_dir}"

# ---- 2. no changes -> tell the author and stop ----
if [[ "$before_sha" == "$after_sha" ]]; then
    msg="There are no changes in the branch. Please make your changes and ask again."
    if wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "${thread_ts:-}" "$msg" >/dev/null || true
    fi
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg sha "$after_sha" \
        '{ok:true, action:"no_changes", repo:$repo, pr_number:$pr, head:$sha}'
    exit 0
fi

# ---- 3. changes present: archive previous round, uncheck, relaunch ----

# 3a. Dismiss our OWN stale REQUEST_CHANGES review, if any. A GitHub
# CHANGES_REQUESTED review is sticky: it keeps blocking the PR until the same
# reviewer dismisses it — posting a new COMMENT/REQUEST_CHANGES review does NOT
# clear it. So if round 1 requested changes and the author has now pushed fixes,
# the old block must be lifted or the PR stays "changes requested" even after a
# clean re-review. We only ever dismiss reviews authored by our own bot token
# (never another bot's, never a human's). Best-effort: never fail the re-review
# over a dismissal hiccup.
dismissed_reviews=0
me="$(gh api user --jq '.login' 2>/dev/null)"
if [[ -n "$me" ]]; then
    # GitHub treats only a reviewer's MOST RECENT review as effective. So we
    # dismiss our latest review only if it is itself a CHANGES_REQUESTED block
    # (an already-superseded older block needs no action; an already-DISMISSED
    # one returns empty). This yields at most one id.
    stale_id="$(gh api "repos/story-wizard/${repo}/pulls/${pr_number}/reviews" --paginate \
        --jq "[.[] | select(.user.login == \"${me}\")] | last | if .state == \"CHANGES_REQUESTED\" then .id else empty end" 2>/dev/null)"
    if [[ -n "$stale_id" ]]; then
        if gh api --method PUT \
            "repos/story-wizard/${repo}/pulls/${pr_number}/reviews/${stale_id}/dismissals" \
            -f message="Superseded by AI re-review after new commits — re-evaluating." \
            -f event="DISMISS" >/dev/null 2>&1; then
            dismissed_reviews=1
        fi
    fi
fi

# Determine the round being archived: count existing review_<N> dirs + 1.
prev_round=1
while [[ -d "${autorun_dir}/review_${prev_round}" ]]; do
    prev_round=$((prev_round + 1))
done
# This re-review produces round (prev_round + 1); we archive the current
# artifacts as review_<prev_round>.
this_review_round=$((prev_round + 1))
archive_dir="${autorun_dir}/review_${prev_round}"

mkdir -p "$archive_dir" || post_fail "archive" "cannot create ${archive_dir}"
archived=()
for f in "${WIZ_ARCHIVE_FILES[@]}"; do
    src="${autorun_dir}/${f}"
    if [[ -f "$src" ]]; then
        mv "$src" "${archive_dir}/" && archived+=("$f")
    fi
done

# Uncheck every checked box in the code-review playbooks so the auto-run reruns
# every task. Matches GitHub-style task list items: "- [x]" / "- [X]" -> "- [ ]",
# preserving leading indentation.
unchecked_files=0
shopt -s nullglob
for pb in "${playbook_dir}"/*.md; do
    if grep -qiE '^[[:space:]]*-[[:space:]]\[[xX]\]' "$pb"; then
        perl -pi -e 's/^(\s*-\s*)\[[xX]\]/${1}[ ]/' "$pb" \
            || post_fail "uncheck" "failed to uncheck boxes in ${pb}"
        unchecked_files=$((unchecked_files + 1))
    fi
done
shopt -u nullglob

# ---- 4. relaunch the Maestro auto-run ----
# shellcheck source=_maestro_env.sh
source "${script_dir}/_maestro_env.sh" || post_fail "maestro_env" "cannot source _maestro_env.sh"
launch_out="$(node "$maestro_cli" auto-run -a "$agent_id" "${playbook_dir}"/* --launch 2>&1)"
launch_rc=$?
[[ $launch_rc -eq 0 ]] || post_fail "auto_run" "auto-run relaunch failed (rc=${launch_rc}):"$'\n'"$(printf '%s' "$launch_out" | tail -15)"

# ---- 5. set project status (capped at "AI Review 2") ----
status_set=true
status_msg=""
if ! status_msg=$("${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "AI Review 2" 2>&1); then
    status_set=false
fi

# ---- 6. launch the detached watcher (reused as-is) ----
log_dir="${HOME}/wizard/tmp/wiz-pr-logs"; mkdir -p "$log_dir"
watch_log="${log_dir}/${worktree_name}-rereview${this_review_round}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_watch_finalize.sh" \
    "$repo" "$pr_number" "$agent_id" "$autorun_dir" "$pr_title" "$pr_url" "$thread_ts" \
    >"$watch_log" 2>&1 &
watcher_pid=$!
disown "$watcher_pid" 2>/dev/null || true

# ---- 7. post the "second review started" ack (threaded) ----
ack="🔁 *AI review #${this_review_round}* started for *${pr_title}* (<${pr_url}>) — pulled new changes (\`${before_sha:0:7}\` → \`${after_sha:0:7}\`) and re-running the full review."
ack+=$'\n'"Previous review artifacts archived to \`review_${prev_round}/\`."
[[ "$dismissed_reviews" -gt 0 ]] && ack+=$'\n'"Dismissed our prior *Request Changes* review (superseded by the new commits)."
if [[ "$status_set" == "true" ]]; then
    if [[ "$this_review_round" -eq 2 ]]; then
        ack+=" Project status set to *AI Review 2*."
    else
        ack+=" Project status set to *AI Review 2* (this is actually review round #${this_review_round})."
    fi
else
    ack+=$'\n'"⚠️ Could not set project status: ${status_msg}"
fi
ack+=" Updated artifacts will be posted here when it finishes."
if wiz_slack_ready; then
    wiz_slack_post "$dest_channel" "${thread_ts:-}" "$ack" >/dev/null || true
fi

# ---- 8. emit summary JSON ----
jq -nc \
    --arg repo "$repo" --arg pr "$pr_number" \
    --arg title "$pr_title" --arg url "$pr_url" \
    --arg agent "$agent_id" --arg autorun "$autorun_dir" \
    --arg before "$before_sha" --arg after "$after_sha" \
    --argjson round "$this_review_round" --arg archive "$archive_dir" \
    --argjson nfiles "${#archived[@]}" --argjson nunchecked "$unchecked_files" \
    --argjson dismissed "$dismissed_reviews" \
    --argjson status_set "$status_set" --arg status_msg "$status_msg" \
    --arg pid "$watcher_pid" --arg wlog "$watch_log" --arg ch "$dest_channel" \
    '{ok:true, action:"rereview", repo:$repo, pr_number:$pr, pr_title:$title,
      pr_url:$url, agent_id:$agent, autorun_dir:$autorun, review_round:$round,
      head_before:$before, head_after:$after, archived_to:$archive,
      archived_files:$nfiles, unchecked_files:$nunchecked,
      dismissed_request_changes:$dismissed,
      status_set:$status_set, status_message:$status_msg,
      watcher_pid:$pid, watcher_log:$wlog, posted_to:$ch}'
