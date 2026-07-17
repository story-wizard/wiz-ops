#!/bin/bash
# wiz_pr_rereview.sh — launch the next numbered Maestro PR review.
# Odd rounds use Claude Code and even rounds use Codex when the crucible toggle
# is enabled. Each agent owns a persistent worktree/autorun directory; round
# metadata and artifact history are canonical per PR.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_pipeline.env"}'; exit 1; }
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source _wiz_slack.sh"}'; exit 1; }
# shellcheck source=wiz_pr_review_state.sh
source "${script_dir}/wiz_pr_review_state.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_review_state.sh"}'; exit 1; }

dest_channel="${WIZ_ACTIVE_CHANNEL}"
WIZ_ARCHIVE_FILES=("${WIZ_REVIEW_FILES[@]}" PR_COMMENT.md)
lock_dir=""
rollback_state=""
agent_launched=false
archive_stage=""
archive_installed_dir=""
archive_source=""
orphan_stage=""
orphan_installed_dir=""
orphan_source=""

rollback_archive_transaction() {
    local dir="" failed=0 collision_dir=""
    if [[ -n "$archive_stage" && -d "$archive_stage" ]]; then
        dir="$archive_stage"
    elif [[ -n "$archive_installed_dir" && -d "$archive_installed_dir" ]]; then
        dir="$archive_installed_dir"
    fi
    [[ -n "$dir" && -n "$archive_source" ]] || return 0
    for f in "${WIZ_ARCHIVE_FILES[@]}"; do
        [[ -f "$dir/$f" ]] || continue
        if [[ -e "$archive_source/$f" ]]; then
            [[ -n "$collision_dir" ]] || collision_dir="${history_root:-$(dirname "$dir")}/rollback_collision_$(date -u +%Y%m%d-%H%M%S)_$$"
            mkdir -p "$collision_dir" 2>/dev/null || { failed=1; continue; }
            mv "$dir/$f" "$collision_dir/$f" 2>/dev/null || failed=1
        else
            mv "$dir/$f" "$archive_source/$f" 2>/dev/null || failed=1
        fi
    done
    [[ $failed -eq 0 ]] && rm -f "$dir/ROUND.json" 2>/dev/null || true
    rmdir "$dir" 2>/dev/null || true
    return "$failed"
}

rollback_orphan_transaction() {
    local dir="" failed=0
    if [[ -n "$orphan_stage" && -d "$orphan_stage" ]]; then
        dir="$orphan_stage"
    elif [[ -n "$orphan_installed_dir" && -d "$orphan_installed_dir" ]]; then
        dir="$orphan_installed_dir"
    fi
    [[ -n "$dir" && -n "$orphan_source" ]] || return 0
    for f in "${WIZ_ARCHIVE_FILES[@]}"; do
        [[ -f "$dir/$f" ]] || continue
        if [[ -e "$orphan_source/$f" ]]; then
            failed=1
        else
            mv "$dir/$f" "$orphan_source/$f" 2>/dev/null || failed=1
        fi
    done
    rmdir "$dir" 2>/dev/null || true
    return "$failed"
}

release_lock() {
    wiz_review_launch_lock_release "$lock_dir"
}
handle_signal() {
    local code="$1"
    # Restore prior state only while Maestro is known not to have launched.
    # After launch, fail-closed state is safer than permitting a duplicate run.
    if [[ "$agent_launched" == "false" && -n "$rollback_state" && -f "$rollback_state" && -n "${state_file:-}" ]]; then
        mv "$rollback_state" "$state_file" 2>/dev/null || true
    fi
    if [[ "$agent_launched" == "false" ]]; then
        rollback_orphan_transaction || true
        rollback_archive_transaction || true
    fi
    release_lock
    exit "$code"
}
trap release_lock EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

post_fail() {
    local stage="$1" msg="$2" text
    if [[ "$agent_launched" == "false" ]]; then
        if [[ -n "$rollback_state" && -f "$rollback_state" && -n "${state_file:-}" ]]; then
            mv "$rollback_state" "$state_file" 2>/dev/null || true
        fi
        rollback_orphan_transaction || true
        rollback_archive_transaction || true
    fi
    text="❌ *PR re-review failed* for \`story-wizard/${repo:-?}\` PR #${pr_number:-?} at stage *${stage}*."$'\n'"\`\`\`"$'\n'"${msg}"$'\n'"\`\`\`"
    if wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "${thread_ts:-}" "$text" >/dev/null || true
    fi
    jq -nc --arg repo "${repo:-}" --arg pr "${pr_number:-}" --arg stage "$stage" --arg msg "$msg" \
        '{ok:false,repo:$repo,pr_number:$pr,stage:$stage,message:$msg}'
    exit 1
}

[[ $# -ge 1 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_rereview.sh [--board-trigger] <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }
board_trigger=false
if [[ "$1" == "--board-trigger" ]]; then board_trigger=true; shift; fi
[[ $# -ge 2 && $# -le 4 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_rereview.sh [--board-trigger] <repo> <pr_number> [agent_type] [thread_ts]"}'; exit 1; }

repo="$1"; pr_number="$2"; requested_agent="${3:-}"; thread_ts="${4:-}"
command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
command -v git >/dev/null 2>&1 || post_fail "deps" "git not found"
[[ "$pr_number" =~ ^[0-9]+$ ]] || post_fail "args" "PR number must be numeric, got '${pr_number}'"

# One shared launch decision per PR at a time (fresh and re-review use the same lock).
if ! lock_dir="$(wiz_review_launch_lock_acquire "$repo" "$pr_number")"; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" \
        '{ok:true,action:"busy",repo:$repo,pr_number:$pr,message:"another review launch is already preparing"}'
    exit 0
fi

pr_meta=$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title,url,state,isDraft,headRefOid 2>&1) \
    || post_fail "pr_lookup" "PR #${pr_number} not found in story-wizard/${repo}: ${pr_meta}"
pr_title="$(echo "$pr_meta" | jq -r '.title')"
pr_url="$(echo "$pr_meta" | jq -r '.url')"
current_head="$(echo "$pr_meta" | jq -r '.headRefOid // empty')"
[[ "$(echo "$pr_meta" | jq -r '.state')" == "OPEN" ]] || post_fail "pr_lookup" "PR is not open"
[[ "$(echo "$pr_meta" | jq -r '.isDraft')" == "false" ]] || post_fail "pr_lookup" "PR is a draft"
[[ -n "$current_head" ]] || post_fail "pr_lookup" "could not determine PR head SHA"

state_file="$(wiz_review_state_bootstrap "$repo" "$pr_number")" || post_fail "state" "could not load canonical review state"
current_round="$(jq -r '.round // 0' "$state_file")"
last_head="$(jq -r '.head_sha // empty' "$state_file")"
current_status="$(jq -r '.status // "completed"' "$state_file")"
active_agent="$(jq -r '.active_agent_type // empty' "$state_file")"
active_autorun="$(jq -r --arg a "$active_agent" '.agents[$a].autorun_dir // empty' "$state_file")"
active_agent_id="$(jq -r --arg a "$active_agent" '.agents[$a].agent_id // empty' "$state_file")"
active_worktree="$(jq -r --arg a "$active_agent" '.agents[$a].worktree_dir // empty' "$state_file")"
watcher_pid="$(jq -r '.watcher_pid // empty' "$state_file")"
current_attempt="$(jq -r '.attempt_id // empty' "$state_file")"
current_generation="$(jq -r '.recovery_generation // 0' "$state_file")"
[[ "$current_round" =~ ^[0-9]+$ && "$current_round" -ge 1 ]] \
    || post_fail "state" "no prior AI review is recorded for this PR"
[[ -n "$thread_ts" ]] || thread_ts="$(jq -r '.thread_ts // empty' "$state_file")"

# Reconcile a review launched before canonical state existed. Its old watcher
# cannot mark state complete; once its summary exists and its finalize watcher
# has exited, it is safe to treat that legacy round as completed.
if [[ "$current_status" == "legacy_running" ]]; then
    legacy_watcher_running=false
    if [[ -n "$active_agent_id" ]] && ps -Ao command= \
        | grep -F "wiz_pr_watch_finalize.sh ${repo} ${pr_number} ${active_agent_id}" \
        | grep -v grep >/dev/null 2>&1; then
        legacy_watcher_running=true
    fi
    if [[ -s "${active_autorun}/REVIEW_SUMMARY.md" && "$legacy_watcher_running" == "false" ]]; then
        wiz_review_state_mark_status "$repo" "$pr_number" "$current_round" "completed" || true
        current_status="completed"
    fi
fi

# Recover a terminally dead finalizer that could not run its EXIT trap (SIGKILL,
# host restart). Never permit overlap while the underlying agent still runs.
idle_verified=false
if [[ "$current_status" == "running" || "$current_status" == "launching" ]]; then
    expected_watcher="wiz_pr_watch_finalize.sh ${repo} ${pr_number} ${active_agent_id}"
    watcher_alive=false
    if [[ "$watcher_pid" =~ ^[0-9]+$ ]]; then
        watcher_cmd="$(ps -p "$watcher_pid" -o command= 2>/dev/null || true)"
        [[ "$watcher_cmd" == *"$expected_watcher"* ]] && watcher_alive=true
    elif ps -Ao command= | grep -F "$expected_watcher" | grep -v grep >/dev/null 2>&1; then
        watcher_alive=true
    fi
    if [[ "$watcher_alive" != "true" ]]; then
        if [[ -n "$active_agent_id" ]] && "${script_dir}/maestro_watch.sh" --is-running \
            "$active_agent_id" "$active_agent" "$active_worktree" "$active_autorun" "${WIZ_WATCH_GRACE:-60}"; then
            : # agent is still active; remain busy until a later retry observes it idle
        else
            if wiz_review_state_mark_status_if "$repo" "$pr_number" "$current_round" "$current_attempt" \
                "$current_generation" "$current_status" failed; then
                current_status="failed"
                idle_verified=true
            else
                # A concurrent watcher transition won; reload instead of
                # regressing completed or a newer recovery generation.
                current_status="$(jq -r '.status // empty' "$state_file" 2>/dev/null)"
            fi
        fi
    fi
fi

# A failed attempt normally means the watcher proved the agent idle, but verify
# liveness again before a same-round retry (manual repair or crash recovery may
# have set failed while Maestro was between iterations).
if [[ "$current_status" == "failed" && "$idle_verified" != "true" && -n "$active_agent_id" ]] \
    && "${script_dir}/maestro_watch.sh" --is-running "$active_agent_id" "$active_agent" "$active_worktree" "$active_autorun" "${WIZ_WATCH_GRACE:-60}"; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --argjson round "$current_round" --arg agent "$active_agent" \
        '{ok:true,action:"busy",repo:$repo,pr_number:$pr,review_round:$round,agent_type:$agent,
          message:"failed attempt still has a live/respawning agent; retry deferred"}'
    exit 0
fi

# Never overlap two rounds for one PR. The current watcher changes this to
# completed only after artifact upload/finalization; a stale watcher cannot
# overwrite a newer round because state updates are round-guarded.
if [[ "$current_status" == "running" || "$current_status" == "legacy_running" || "$current_status" == "launching" ]]; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --argjson round "$current_round" \
        --arg agent "$active_agent" \
        '{ok:true,action:"busy",repo:$repo,pr_number:$pr,review_round:$round,
          agent_type:$agent,message:"the current review round is still running/finalizing"}'
    exit 0
fi

# Board mode normally receives the original root from the poller. Recover it
# from canonical state, and only create a new root if all routing state is gone.
if [[ "$board_trigger" == "true" ]] && wiz_slack_ready && [[ -z "$thread_ts" ]]; then
    root_msg="🔁 Re-review queued for *${pr_title}* (<${pr_url}>) — triggered from the project board. Checking for new commits…"
    root_ts="$(wiz_slack_post "$dest_channel" "" "$root_msg" 2>/dev/null)"
    [[ -n "$root_ts" ]] && thread_ts="$root_ts"
fi

if [[ "$current_status" == "completed" && "$last_head" == "$current_head" ]]; then
    msg="There are no changes in the branch. Please make your changes and ask again."
    if [[ "$board_trigger" != "true" ]] && wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "${thread_ts:-}" "$msg" >/dev/null || true
    fi
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg sha "$current_head" --argjson round "$current_round" \
        '{ok:true,action:"no_changes",repo:$repo,pr_number:$pr,review_round:$round,head:$sha}'
    exit 0
fi

retry_failed=false
if [[ "$current_status" == "failed" ]]; then
    # A failed round never consumes its number. Retry the same parity/head (or a
    # newer pushed head) after preserving partial artifacts separately.
    next_round="$current_round"
    retry_failed=true
else
    next_round=$((current_round + 1))
fi
if [[ "${WIZ_REVIEW_ALTERNATE_AGENTS:-false}" == "true" ]]; then
    agent_type="$(wiz_review_agent_for_round "$next_round")"
else
    agent_type="${requested_agent:-${active_agent:-$WIZ_DEFAULT_AGENT_TYPE}}"
fi
worktree_name="${repo}-pr-${pr_number}-${agent_type}"
worktree_dir="${HOME}/wizard/worktrees/${repo}/${worktree_name}"
autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"
playbook_dir="${autorun_dir}/development/code-review"

# Ensure the selected parity agent exists. First use of Codex creates its own
# independent worktree, playbooks, autorun directory, and Maestro agent.
created_agent=false
if [[ ! -d "$worktree_dir" ]]; then
    setup_log="$(mktemp -t wiz_pr_rereview_setup.XXXXXX)"
    if ! "${script_dir}/maestro_pr.sh" --no-run "$repo" "$pr_number" "$agent_type" >"$setup_log" 2>&1; then
        setup_tail="$(tail -25 "$setup_log")"; rm -f "$setup_log"
        post_fail "agent_setup" "could not create ${agent_type} review agent:"$'\n'"${setup_tail}"
    fi
    agent_id="$(grep -E 'Agent ID' "$setup_log" | tail -1 | sed -E 's/.*Agent ID[[:space:]]*:[[:space:]]*//' | tr -d '[:space:]')"
    rm -f "$setup_log"
    created_agent=true
else
    agent_id="$("${script_dir}/maestro_id.sh" "$worktree_name" 2>/dev/null | tr -d '[:space:]')"
fi
[[ -n "$agent_id" ]] || post_fail "agent_id" "could not find Maestro agent named '${worktree_name}'"
[[ -d "$playbook_dir" ]] || post_fail "playbooks" "playbook dir not found at ${playbook_dir}"

# Existing parity worktrees must synchronize to the exact GitHub pull ref.
# Do not trust @{upstream}: gh pr checkout --branch may leave it tracking the
# generated review branch, which is frozen after the PR receives new commits.
if [[ "$created_agent" != "true" ]]; then
    if ! wiz_review_sync_worktree_to_pr_head "$repo" "$pr_number" "$worktree_dir" "$current_head"; then
        synced_head="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)"
        post_fail "git_sync" "could not synchronize ${agent_type} worktree from the exact PR pull ref; worktree remains at ${synced_head:-unknown}, expected PR head ${current_head}"
    fi
fi
synced_head="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)"
[[ "$synced_head" == "$current_head" ]] \
    || post_fail "git_sync" "selected worktree is at ${synced_head:-unknown}, expected PR head ${current_head}"

dismissed_reviews=0

# Stage the previous active agent's artifacts transactionally. Nothing becomes
# shared history until canonical launch state is durable; any pre-launch error or
# signal restores every staged artifact to its original autorun root.
history_root="$(wiz_review_history_dir "$repo" "$pr_number")"
mkdir -p "$history_root" || post_fail "archive" "cannot create ${history_root}"
archive_source="$active_autorun"
[[ -n "$archive_source" ]] || post_fail "archive" "canonical active autorun directory is missing"
archive_stage="${history_root}/.stage_review_${current_round}_$(date -u +%Y%m%d-%H%M%S)_$$"
mkdir "$archive_stage" || post_fail "archive" "cannot create transactional archive stage"
archived=()
for f in "${WIZ_ARCHIVE_FILES[@]}"; do
    src="${archive_source}/${f}"
    [[ -f "$src" ]] || continue
    mv "$src" "$archive_stage/$f" \
        || post_fail "archive" "failed to stage ${src}; previously staged artifacts were restored"
    archived+=("$f")
done
if [[ "$retry_failed" != "true" ]]; then
    jq -nc --argjson round "$current_round" --arg agent "$active_agent" --arg head "$last_head" \
        --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{review_round:$round,agent_type:$agent,head_sha:$head,archived_at:$at}' \
        > "$archive_stage/ROUND.json" || post_fail "archive" "cannot stage round manifest"
fi

# Persist the next round BEFORE installing history or invoking Maestro.
rollback_state="${state_file}.prelaunch"
cp "$state_file" "$rollback_state" || post_fail "state" "could not create pre-launch state rollback"
attempt_id="r${next_round}-$(date +%s)-$$-${RANDOM}"
if ! wiz_review_state_record_launch "$repo" "$pr_number" "$next_round" "$agent_type" \
    "$current_head" "$thread_ts" "$agent_id" "$worktree_name" "$worktree_dir" "$autorun_dir" "launching" "$attempt_id"; then
    post_fail "state" "could not persist pre-launch canonical state"
fi

# Install the complete staged directory with one same-filesystem rename. Existing
# round history is never overwritten; a collision becomes a unique retry dir.
if [[ "$retry_failed" == "true" ]]; then
    archive_dir="${history_root}/failed_review_${current_round}_$(date -u +%Y%m%d-%H%M%S)_$$"
else
    archive_dir="${history_root}/review_${current_round}"
    if [[ -e "$archive_dir" ]]; then
        archive_parent="$archive_dir"
        mkdir -p "$archive_parent" || post_fail "archive" "cannot access existing round history"
        archive_dir="${archive_parent}/retry_$(date -u +%Y%m%d-%H%M%S)_$$"
    fi
fi
mv "$archive_stage" "$archive_dir" || post_fail "archive" "cannot atomically install staged review history"
archive_installed_dir="$archive_dir"
archive_stage=""

# Preserve any unexpected inactive-target root outputs instead of deleting them.
# In the normal alternating flow the target's prior outputs were already moved
# when that agent ceased being active; leftovers indicate interrupted/legacy
# state and must be retained for diagnosis.
orphan_source="$autorun_dir"
for f in "${WIZ_ARCHIVE_FILES[@]}"; do
    stale_src="${autorun_dir}/${f}"
    [[ -f "$stale_src" ]] || continue
    if [[ "$autorun_dir" == "$active_autorun" ]]; then
        post_fail "archive" "active artifact ${stale_src} remained after transactional archival"
    fi
    if [[ -z "$orphan_stage" ]]; then
        orphan_stage="${history_root}/.stage_orphan_${agent_type}_$(date -u +%Y%m%d-%H%M%S)_$$"
        mkdir "$orphan_stage" || post_fail "archive" "cannot stage stale target artifacts"
    fi
    mv "$stale_src" "$orphan_stage/$f" \
        || post_fail "archive" "failed to stage stale target artifact ${stale_src}"
done
if [[ -n "$orphan_stage" ]]; then
    stale_target_dir="${history_root}/orphaned_${agent_type}_$(date -u +%Y%m%d-%H%M%S)_$$"
    mv "$orphan_stage" "$stale_target_dir" \
        || post_fail "archive" "cannot atomically install stale target artifacts"
    orphan_installed_dir="$stale_target_dir"
    orphan_stage=""
fi
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

# Launch selected Maestro agent. From this point until synchronous failure is
# reported, launch outcome is uncertain; signal handling must leave canonical
# state fail-closed rather than restoring a state that permits overlap.
# shellcheck source=_maestro_env.sh
source "${script_dir}/_maestro_env.sh" || post_fail "maestro_env" "cannot source _maestro_env.sh"
agent_launched=maybe
launch_out="$(node "$maestro_cli" auto-run -a "$agent_id" "${playbook_dir}"/* --launch 2>&1)"; launch_rc=$?
launch_warning=""
if [[ $launch_rc -ne 0 ]]; then
    # The CLI may report nonzero after spawning the asynchronous Auto Run. Keep
    # canonical state fail-closed and start the watcher; it will prove completion
    # or transition this exact attempt to failed after its bounded start timeout.
    launch_warning="${agent_type} launch returned rc=${launch_rc}; treating outcome as uncertain: $(printf '%s' "$launch_out" | tail -3 | tr '\n' ' ')"
fi
agent_launched=true

# Start the watcher immediately after a successful launch. If the subsequent
# running-state write fails, the watcher still owns finalization and can mark
# this exact round completed; canonical state remains fail-closed at launching.
log_dir="${HOME}/wizard/tmp/wiz-pr-logs"; mkdir -p "$log_dir"
watch_log="${log_dir}/${worktree_name}-rereview${next_round}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_watch_finalize.sh" \
    "$repo" "$pr_number" "$agent_id" "$autorun_dir" "$pr_title" "$pr_url" "$thread_ts" \
    "$agent_type" "$next_round" "$attempt_id" >"$watch_log" 2>&1 &
watcher_pid=$!; disown "$watcher_pid" 2>/dev/null || true
watcher_state_set=true
state_running_set=true
fast_terminal_status=""
if wiz_review_state_record_watcher "$repo" "$pr_number" "$next_round" "$watcher_pid" "$watch_log" "$attempt_id" 0; then
    rm -f "$rollback_state"
else
    terminal_after_launch="$(jq -r '.status // empty' "$state_file" 2>/dev/null)"
    case "$terminal_after_launch" in
        completed) rm -f "$rollback_state"; fast_terminal_status=completed ;;
        failed) rm -f "$rollback_state"; fast_terminal_status=failed ;;
        *) watcher_state_set=false; state_running_set=false ;;
    esac
fi
# Keep the shared launch lock through parent-side GitHub, routing, board, and
# Slack startup effects. Finalizer terminal transitions wait for this owner.

# Prior blocking AI reviews are never auto-dismissed. A local lock cannot
# serialize GitHub pushes, so retaining the block is the only fail-closed choice;
# a human may dismiss it after inspecting the verified replacement review.

# Keep the Slack thread routing backstop aligned with the active round.
if [[ -n "$thread_ts" ]]; then
    state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    mkdir -p "$state_dir" 2>/dev/null && jq -nc \
        --arg repo "$repo" --arg pr "$pr_number" --arg agent "$agent_type" \
        --arg wt "$worktree_name" --arg autorun "$autorun_dir" --arg agent_id "$agent_id" \
        --arg thread "$thread_ts" --argjson round "$next_round" \
        '{repo:$repo,pr_number:$pr,agent_type:$agent,worktree_name:$wt,
          autorun_dir:$autorun,agent_id:$agent_id,thread_ts:$thread,review_round:$round}' \
        > "${state_dir}/${thread_ts}.json" 2>/dev/null || true
fi

# The child already emitted the authoritative terminal lifecycle message. Do not
# overwrite it with board/status/start side effects from this parent.
if [[ -n "$fast_terminal_status" ]]; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg status "$fast_terminal_status" \
        --argjson round "$next_round" --arg head "$current_head" \
        '{ok:($status=="completed"),action:$status,repo:$repo,pr_number:$pr,review_round:$round,head:$head}'
    [[ "$fast_terminal_status" == completed ]] && exit 0
    exit 1
fi

status_set=true; status_msg=""
target_board_status="AI Review 2"
[[ "$next_round" -le 1 ]] && target_board_status="AI Review 1"
if ! status_msg=$("${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$target_board_status" 2>&1); then status_set=false; fi

ack="🔁 *AI review #${next_round}* started with *${agent_type}* for *${pr_title}* (<${pr_url}>) — new head \`${current_head:0:7}\`."
if [[ "$retry_failed" == "true" ]]; then
    ack+=$'\n'"Retrying failed review #${current_round}; partial artifacts preserved under \`$(basename "$archive_dir")/\`."
else
    ack+=$'\n'"Review #${current_round} artifacts archived to the shared \`review_${current_round}/\` history."
fi
[[ "$created_agent" == "true" ]] && ack+=$'\n'"Created the dedicated *${agent_type}* Maestro agent and worktree."
[[ "$dismissed_reviews" -gt 0 ]] && ack+=$'\n'"Dismissed our prior *Request Changes* review (superseded by the new commits)."
[[ "$state_running_set" != "true" ]] && ack+=$'\n'"⚠️ Canonical state remains *launching*; watcher is running and will mark this round completed or failed. Pre-launch rollback retained."
[[ "$watcher_state_set" != "true" ]] && ack+=$'\n'"⚠️ Watcher PID could not be recorded; automatic abrupt-death recovery is unavailable for this round."
[[ -n "$launch_warning" ]] && ack+=$'\n'"⚠️ ${launch_warning}; bounded watcher verification is authoritative."
if [[ "$status_set" == "true" ]]; then
    ack+=" Project status set to *${target_board_status}*."
else
    ack+=$'\n'"⚠️ Could not set project status: ${status_msg}"
fi
ack+=" Updated artifacts will be posted here when it finishes."
if wiz_slack_ready; then wiz_slack_post "$dest_channel" "${thread_ts:-}" "$ack" >/dev/null || true; fi

jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg title "$pr_title" --arg url "$pr_url" \
    --arg agent "$agent_id" --arg agent_type "$agent_type" --arg autorun "$autorun_dir" \
    --arg before "$last_head" --arg after "$current_head" --argjson round "$next_round" \
    --arg archive "$archive_dir" --argjson nfiles "${#archived[@]}" \
    --argjson nunchecked "$unchecked_files" --argjson dismissed "$dismissed_reviews" \
    --argjson created "$created_agent" --argjson status_set "$status_set" --arg status_msg "$status_msg" \
    --argjson state_running_set "$state_running_set" \
    --arg pid "$watcher_pid" --arg wlog "$watch_log" --arg ch "$dest_channel" \
    '{ok:true,action:"rereview",repo:$repo,pr_number:$pr,pr_title:$title,pr_url:$url,
      agent_id:$agent,agent_type:$agent_type,autorun_dir:$autorun,review_round:$round,
      head_before:$before,head_after:$after,archived_to:$archive,archived_files:$nfiles,
      unchecked_files:$nunchecked,dismissed_request_changes:$dismissed,created_agent:$created,
      status_set:$status_set,status_message:$status_msg,state_running_set:$state_running_set,
      watcher_pid:$pid,watcher_log:$wlog,posted_to:$ch}'
