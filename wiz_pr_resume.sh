#!/bin/bash
# wiz_pr_resume.sh — resume an interrupted canonical review without advancing
# its round, changing its head, archiving artifacts, or resetting playbooks.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_pipeline.env"}'; exit 1; }
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source _wiz_slack.sh"}'; exit 1; }
# shellcheck source=wiz_pr_review_state.sh
source "${script_dir}/wiz_pr_review_state.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_review_state.sh"}'; exit 1; }
# shellcheck source=_maestro_env.sh
source "${script_dir}/_maestro_env.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source _maestro_env.sh"}'; exit 1; }
export MAESTRO_USER_DATA="${MAESTRO_USER_DATA:-$HOME/Library/Application Support/maestro}"

repo="${1:-}"
pr_number="${2:-}"
thread_ts="${3:-}"
dest_channel="${WIZ_ACTIVE_CHANNEL}"
lock_dir=""
recovery_started=false
recovery_state=""
generation=""
review_round=""
review_attempt=""

release_lock() { wiz_review_launch_lock_release "$lock_dir"; }
handle_signal() {
    local code="$1"
    if [[ "$recovery_started" == true && "$review_round" =~ ^[0-9]+$ \
        && "$generation" =~ ^[0-9]+$ && -n "$recovery_state" ]]; then
        wiz_review_state_mark_status_if "$repo" "$pr_number" "$review_round" "$review_attempt" \
            "$generation" "$recovery_state" failed >/dev/null 2>&1 || true
    fi
    release_lock
    trap - EXIT INT TERM
    exit "$code"
}
trap release_lock EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

post_fail() {
    local stage="$1" msg="$2" text
    if [[ "$recovery_started" == "true" && "$review_round" =~ ^[0-9]+$ && -n "$review_attempt" \
        && "$generation" =~ ^[0-9]+$ && -n "$recovery_state" ]]; then
        wiz_review_state_mark_status_if "$repo" "$pr_number" "$review_round" "$review_attempt" \
            "$generation" "$recovery_state" failed >/dev/null 2>&1 || true
    fi
    text="❌ *Code-review resume failed* for \`story-wizard/${repo:-?}\` PR #${pr_number:-?} at stage *${stage}*."$'\n'"\`\`\`"$'\n'"${msg}"$'\n'"\`\`\`"
    wiz_slack_ready && wiz_slack_post "$dest_channel" "$thread_ts" "$text" >/dev/null 2>&1 || true
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg stage "$stage" --arg msg "$msg" \
        '{ok:false,repo:$repo,pr_number:$pr,stage:$stage,message:$msg}'
    exit 1
}

run_bounded() {
    local seconds="$1"
    shift
    python3 - "$seconds" "$@" <<'PY'
import subprocess, sys
try:
    proc = subprocess.run(
        sys.argv[2:], text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=int(sys.argv[1]), check=False,
    )
    sys.stdout.write(proc.stdout)
    raise SystemExit(proc.returncode)
except subprocess.TimeoutExpired as exc:
    if exc.stdout:
        data = exc.stdout if isinstance(exc.stdout, str) else exc.stdout.decode(errors="replace")
        sys.stdout.write(data)
    raise SystemExit(124)
PY
}

latest_error_pause() {
    local history="$MAESTRO_USER_DATA/history/${agent_id}.json"
    [[ -f "$history" ]] || return 1
    python3 - "$history" "$attempt_epoch" "$worktree_dir" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    minimum = int(sys.argv[2]) * 1000
    project = sys.argv[3]
    matches = []
    for entry in data.get("entries", []):
        summary = str(entry.get("summary", ""))
        timestamp = int(entry.get("timestamp", 0) or 0)
        if (timestamp >= minimum and entry.get("type") == "AUTO"
                and entry.get("success") is False
                and entry.get("projectPath") == project
                and "Auto Run error" in summary):
            matches.append((timestamp, summary))
    if not matches:
        raise SystemExit(1)
    timestamp, summary = max(matches)
    print(f"{timestamp}\x1f{summary.replace(chr(31), ' ')}")
except Exception:
    raise SystemExit(1)
PY
}

[[ -n "$repo" && "$pr_number" =~ ^[0-9]+$ && -n "$thread_ts" ]] \
    || post_fail args "usage: wiz_pr_resume.sh <repo> <pr_number> <thread_ts>"
command -v jq >/dev/null 2>&1 || post_fail deps "jq not found"
command -v gh >/dev/null 2>&1 || post_fail deps "gh CLI not found"
command -v git >/dev/null 2>&1 || post_fail deps "git not found"
resume_command_timeout="${WIZ_WATCH_RESUME_COMMAND_TIMEOUT:-30}"
[[ "$resume_command_timeout" =~ ^[0-9]+$ && "$resume_command_timeout" -gt 0 ]] \
    || post_fail config "WIZ_WATCH_RESUME_COMMAND_TIMEOUT must be a positive integer"

lock_dir="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" 2>/dev/null || true)"
if [[ -z "$lock_dir" ]]; then
    jq -nc --arg repo "$repo" --arg pr "$pr_number" \
        '{ok:true,action:"busy",repo:$repo,pr_number:$pr,message:"another review action owns this PR"}'
    exit 0
fi

pr_meta="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title,url,state,isDraft,headRefOid 2>&1)" \
    || post_fail pr_lookup "could not read PR metadata: ${pr_meta}"
pr_title="$(printf '%s' "$pr_meta" | jq -r '.title // empty')"
pr_url="$(printf '%s' "$pr_meta" | jq -r '.url // empty')"
live_head="$(printf '%s' "$pr_meta" | jq -r '.headRefOid // empty')"
[[ "$(printf '%s' "$pr_meta" | jq -r '.state // empty')" == OPEN ]] || post_fail pr_lookup "PR is not open"
[[ "$(printf '%s' "$pr_meta" | jq -r 'if has("isDraft") then .isDraft else true end')" == false ]] || post_fail pr_lookup "PR is a draft"
[[ -n "$live_head" ]] || post_fail pr_lookup "PR head is missing"

me="$(gh api user --jq .login 2>/dev/null)"
[[ "$me" == "${WIZ_GH_ACCOUNT}" ]] || post_fail identity "GitHub identity is ${me:-unavailable}, expected ${WIZ_GH_ACCOUNT}"

state_file="$(wiz_review_state_file "$repo" "$pr_number")"
[[ -s "$state_file" ]] || post_fail state "canonical review state is missing"
review_round="$(jq -r '.round // 0' "$state_file")"
review_attempt="$(jq -r '.attempt_id // empty' "$state_file")"
canonical_head="$(jq -r '.head_sha // empty' "$state_file")"
canonical_status="$(jq -r '.status // empty' "$state_file")"
agent_type="$(jq -r '.active_agent_type // empty' "$state_file")"
agent_id="$(jq -r --arg a "$agent_type" '.agents[$a].agent_id // empty' "$state_file")"
worktree_dir="$(jq -r --arg a "$agent_type" '.agents[$a].worktree_dir // empty' "$state_file")"
autorun_dir="$(jq -r --arg a "$agent_type" '.agents[$a].autorun_dir // empty' "$state_file")"
watcher_pid="$(jq -r '.watcher_pid // empty' "$state_file")"
canonical_generation="$(jq -r '.recovery_generation // 0' "$state_file")"
[[ "$canonical_generation" =~ ^[0-9]+$ ]] || post_fail state "canonical recovery generation is malformed"
[[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 && -n "$review_attempt" ]] \
    || post_fail state "canonical round/attempt is malformed"
attempt_epoch="$(printf '%s' "$review_attempt" | awk -F- '{print $2}')"
[[ "$attempt_epoch" =~ ^[0-9]+$ ]] || post_fail state "attempt timestamp is malformed"
case "$canonical_status" in
    failed|running|launching|legacy_running) ;;
    completed) ;;
    *) post_fail state "canonical status '${canonical_status:-missing}' is not resumable" ;;
esac
[[ -n "$agent_type" && -n "$agent_id" && -d "$worktree_dir" && -d "$autorun_dir" ]] \
    || post_fail state "canonical agent/worktree/autorun metadata is incomplete"
[[ "$canonical_head" == "$live_head" ]] \
    || post_fail stale_head "canonical head ${canonical_head:-missing} does not match live PR head ${live_head}"
worktree_head="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)"
[[ "$worktree_head" == "$canonical_head" ]] \
    || post_fail stale_head "worktree head ${worktree_head:-missing} does not match canonical head ${canonical_head}"

reviews_json="$(gh api "repos/story-wizard/${repo}/pulls/${pr_number}/reviews" --paginate --slurp 2>&1)" \
    || post_fail review_lookup "could not inspect existing PR reviews: ${reviews_json}"
unauthorized_approval="$(printf '%s' "$reviews_json" | jq -r --arg user "$WIZ_GH_ACCOUNT" --arg head "$canonical_head" \
    '[add[]? | select(.user.login==$user and .commit_id==$head and .state=="APPROVED")] | length' 2>/dev/null)"
[[ "$unauthorized_approval" == 0 ]] \
    || post_fail review_safety "found an unauthorized AI approval at the exact review head"
existing_review_id="$(printf '%s' "$reviews_json" | jq -r --arg user "$WIZ_GH_ACCOUNT" --arg head "$canonical_head" \
    --argjson attempt_epoch "$attempt_epoch" \
    '[add[]? | select(.user.login==$user and .commit_id==$head) |
      select(.state=="COMMENTED" or .state=="CHANGES_REQUESTED") |
      select(((.submitted_at | fromdateiso8601?) // 0) >= $attempt_epoch) | .id] | last // empty' 2>/dev/null)"
if [[ -n "$existing_review_id" ]]; then
    reconcile_live_head="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json headRefOid --jq '.headRefOid' 2>/dev/null)"
    [[ "$reconcile_live_head" == "$canonical_head" ]] \
        || post_fail stale_head "live PR head changed before existing-review reconciliation"
    wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" \
        final_review "$canonical_generation" \
        || post_fail state "could not reconcile the existing exact-head review phase"
    wiz_review_state_mark_status "$repo" "$pr_number" "$review_round" completed "$review_attempt" "$canonical_generation" \
        || post_fail state "could not reconcile the existing exact-head review"
    post_reconcile_head="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json headRefOid --jq '.headRefOid' 2>/dev/null)"
    if [[ "$post_reconcile_head" != "$canonical_head" ]]; then
        wiz_review_state_mark_status_if "$repo" "$pr_number" "$review_round" "$review_attempt" \
            "$canonical_generation" completed failed >/dev/null 2>&1 || true
        post_fail stale_head "live PR head changed during existing-review reconciliation"
    fi
    if [[ "$canonical_status" != completed ]]; then
        ack="✅ AI code review #${review_round} was already posted at the current PR head; canonical state is reconciled."
        wiz_slack_post "$dest_channel" "$thread_ts" "$ack" >/dev/null 2>&1 || true
    fi
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg review_id "$existing_review_id" \
        '{ok:true,action:"already_completed",repo:$repo,pr_number:$pr,review_id:$review_id}'
    exit 0
fi
[[ "$canonical_status" != completed ]] \
    || post_fail state "canonical review is completed but has no exact-head review to reconcile"

if [[ "$watcher_pid" =~ ^[0-9]+$ ]]; then
    watcher_cmd="$(ps -p "$watcher_pid" -o command= 2>/dev/null || true)"
    if [[ "$watcher_cmd" == *"wiz_pr_watch_finalize.sh ${repo} ${pr_number} ${agent_id}"* ]]; then
        jq -nc --arg repo "$repo" --arg pr "$pr_number" \
            '{ok:true,action:"already_running",repo:$repo,pr_number:$pr,message:"the code review is already running"}'
        exit 0
    fi
fi

agent_json="$(run_bounded "$resume_command_timeout" node "$maestro_cli" show agent --json "$agent_id" 2>/dev/null)"
[[ "$(printf '%s' "$agent_json" | jq -r '.id // empty')" == "$agent_id" \
   && "$(printf '%s' "$agent_json" | jq -r '.cwd // empty')" == "$worktree_dir" \
   && "$(printf '%s' "$agent_json" | jq -r '.autoRunFolderPath // empty')" == "$autorun_dir" \
   && "$(printf '%s' "$agent_json" | jq -r '.toolType // empty')" == "$agent_type" ]] \
    || post_fail agent "Maestro agent metadata does not match canonical state"

auto_run_already_active=false
if "${script_dir}/maestro_watch.sh" --is-running "$agent_id" "$agent_type" "$worktree_dir" "$autorun_dir" "${WIZ_WATCH_GRACE:-60}"; then
    auto_run_already_active=true
fi

error_record="$(latest_error_pause 2>/dev/null || true)"
error_ms="${error_record%%$'\x1f'*}"
handled_error_ms="$(jq -r '.auto_resume_last_error_ms // 0' "$state_file" 2>/dev/null)"
[[ "$handled_error_ms" =~ ^[0-9]+$ ]] || post_fail state "handled Auto Run error marker is malformed"
progress="$("${script_dir}/wiz_pr_progress.sh" --json --autorun "$autorun_dir" 2>/dev/null || true)"
done_n="$(printf '%s' "$progress" | jq -r '.overall_done // 0' 2>/dev/null)"
total_n="$(printf '%s' "$progress" | jq -r '.overall_total // 0' 2>/dev/null)"
missing_artifacts="$(printf '%s' "$progress" | jq -r '.artifacts_missing | length' 2>/dev/null)"
[[ "$done_n" =~ ^[0-9]+$ && "$total_n" =~ ^[0-9]+$ && "$total_n" -gt 0 \
   && "$missing_artifacts" =~ ^[0-9]+$ ]] \
    || post_fail classify "could not read persistent Auto Run playbook progress"
if [[ "$auto_run_already_active" == true ]]; then
    resume_mode=attach
    result_action=reattached_watcher
    manual_error_marker="$handled_error_ms"
elif [[ "$error_ms" =~ ^[0-9]+$ && "$error_ms" -gt "$handled_error_ms" ]]; then
    resume_mode=paused
    result_action=resumed_auto_run
    manual_error_marker="$error_ms"
elif [[ "$done_n" -lt "$total_n" ]]; then
    resume_mode=playbooks
    result_action=resumed_playbooks
    manual_error_marker="$handled_error_ms"
elif [[ "$done_n" -eq "$total_n" && "$missing_artifacts" -eq 0 ]]; then
    resume_mode=finalization
    result_action=resumed_finalization
    manual_error_marker="$handled_error_ms"
else
    post_fail classify "all playbook tasks are checked but required review artifacts are missing"
fi

new_deadline=$(( $(date +%s) + ${WIZ_WATCH_MAX_SECONDS:-14400} ))
generation="$(wiz_review_state_begin_manual_resume "$repo" "$pr_number" "$review_round" "$review_attempt" \
    "$new_deadline" "$canonical_status" "$manual_error_marker" 2>/dev/null)"
[[ "$generation" =~ ^[0-9]+$ ]] || post_fail state "could not claim a new manual recovery generation"
recovery_started=true
recovery_state=launching

if [[ "$resume_mode" == attach ]]; then
    resume_out="Maestro Auto Run already active; attaching finalizer only"
    resume_rc=0
elif [[ "$resume_mode" == paused ]]; then
    resume_out="$(run_bounded "$resume_command_timeout" node "$maestro_cli" resume-auto-run --agent "$agent_id" --json 2>&1)"; resume_rc=$?
elif [[ "$resume_mode" == playbooks ]]; then
    playbook_dir="${autorun_dir}/development/code-review"
    shopt -s nullglob
    playbooks=("${playbook_dir}"/[0-9]*.md)
    shopt -u nullglob
    [[ ${#playbooks[@]} -gt 0 ]] || post_fail classify "no persistent code-review playbooks were found"
    resume_out="$(run_bounded "$resume_command_timeout" node "$maestro_cli" auto-run -a "$agent_id" "${playbooks[@]}" --launch 2>&1)"; resume_rc=$?
else
    resume_out="finalization only"
    resume_rc=0
fi
[[ $resume_rc -eq 0 ]] || post_fail maestro_resume "Maestro resume failed (rc=${resume_rc}): ${resume_out}"

log_dir="${HOME}/wizard/tmp/wiz-pr-logs"
mkdir -p "$log_dir" || post_fail watcher "could not create watcher log directory"
watch_log="${log_dir}/${repo}-pr-${pr_number}-${agent_type}-resume-g${generation}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_watch_finalize.sh" \
    "$repo" "$pr_number" "$agent_id" "$autorun_dir" "$pr_title" "$pr_url" "$thread_ts" \
    "$agent_type" "$review_round" "$review_attempt" "$generation" >"$watch_log" 2>&1 &
watcher_pid=$!
disown "$watcher_pid" 2>/dev/null || true
if ! wiz_review_state_activate_manual_watcher "$repo" "$pr_number" "$review_round" "$review_attempt" \
    "$generation" "$watcher_pid" "$watch_log"; then
    terminal_after_resume="$(jq -r '.status // empty' "$state_file" 2>/dev/null)"
    case "$terminal_after_resume" in
        completed)
            recovery_started=false
            release_lock; lock_dir=""
            ack="✅ Resumed AI code review #${review_round} completed before watcher registration; canonical completion is preserved."
            wiz_slack_post "$dest_channel" "$thread_ts" "$ack" >/dev/null 2>&1 || true
            jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg attempt "$review_attempt" \
                --argjson round "$review_round" --argjson generation "$generation" \
                '{ok:true,action:"completed",repo:$repo,pr_number:$pr,round:$round,attempt_id:$attempt,recovery_generation:$generation}'
            exit 0
            ;;
        failed)
            recovery_started=false
            release_lock; lock_dir=""
            jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg attempt "$review_attempt" \
                --argjson round "$review_round" --argjson generation "$generation" \
                '{ok:false,action:"failed",repo:$repo,pr_number:$pr,round:$round,attempt_id:$attempt,recovery_generation:$generation,
                  message:"the resumed finalizer ended in canonical failed state before watcher registration"}'
            exit 1
            ;;
        *)
            kill "$watcher_pid" >/dev/null 2>&1 || true
            wait "$watcher_pid" 2>/dev/null || true
            post_fail watcher "could not atomically activate the resumed finalizer"
            ;;
    esac
fi
recovery_state=running
# Keep the launch lock through the acknowledgement. Finalizer terminal
# transitions wait for this owner, preventing stale ordering.

if [[ "$resume_mode" == attach ]]; then
    ack="👀 Re-attached the finalizer for AI code review #${review_round}; the Maestro Auto Run was already active (${done_n}/${total_n} tasks complete)."
elif [[ "$resume_mode" == finalization ]]; then
    ack="▶️ Resumed finalization for AI code review #${review_round}; all ${total_n} playbook tasks were already complete."
else
    ack="▶️ Resumed AI code review #${review_round} with *${agent_type}* from its existing playbook state (${done_n}/${total_n} tasks complete)."
fi
wiz_slack_post "$dest_channel" "$thread_ts" "$ack" >/dev/null 2>&1 || true

jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg action "$result_action" \
    --arg attempt "$review_attempt" --argjson round "$review_round" --argjson generation "$generation" \
    --argjson watcher_pid "$watcher_pid" \
    '{ok:true,action:$action,repo:$repo,pr_number:$pr,round:$round,attempt_id:$attempt,recovery_generation:$generation,watcher_pid:$watcher_pid}'
