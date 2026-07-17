#!/bin/bash

# wiz_pr_watch_finalize.sh — Wait for a Maestro PR review to finish, then post
# the review artifacts to Slack and send the finalize prompt to the agent.
#
# Launched DETACHED by wiz_pr_review.sh (it blocks for minutes).
#
# Usage:
#   wiz_pr_watch_finalize.sh <repo> <pr_number> <agent_id> <autorun_dir> \
#                            <pr_title> <pr_url> <thread_ts> [agent_type] [round]
#
# Posts everything to WIZ_ACTIVE_CHANNEL (the channel the pipeline monitors),
# threaded under <thread_ts>. Monitored channel == output channel, so output
# can never leak elsewhere.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { echo "[$(date '+%H:%M:%S')] $*"; }
failure_reason="watcher exited before verified finalization"
finalized=false
terminal_lock=""
recoverable_head_drift=false
confirmed_head_drift=false
observed_live_head=""
die() { failure_reason="$*"; echo "Error: $*" >&2; exit 1; }
run_bounded() {
    local seconds="$1"
    shift
    python3 - "$seconds" "$@" <<'PY'
import subprocess, sys
try:
    proc = subprocess.run(sys.argv[2:], text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=int(sys.argv[1]), check=False)
    sys.stdout.write(proc.stdout)
    raise SystemExit(proc.returncode)
except subprocess.TimeoutExpired as exc:
    if exc.stdout:
        data = exc.stdout if isinstance(exc.stdout, str) else exc.stdout.decode(errors="replace")
        sys.stdout.write(data)
    raise SystemExit(124)
PY
}

[[ $# -ge 7 && $# -le 11 ]] || die "Usage: $(basename "$0") <repo> <pr_number> <agent_id> <autorun_dir> <pr_title> <pr_url> <thread_ts> [agent_type] [round] [attempt_id] [recovery_generation]"
repo="$1"; pr_number="$2"; agent_id="$3"; autorun_dir="$4"
pr_title="$5"; pr_url="$6"; thread_ts="$7"
agent_type="${8:-}"
review_round="${9:-0}"
review_attempt="${10:-}"
review_generation="${11:-0}"
[[ "$review_generation" =~ ^[0-9]+$ ]] || die "recovery generation must be numeric"
round_label=""
[[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 ]] && round_label=" #${review_round}"
agent_label=""
[[ -n "$agent_type" ]] && agent_label=" with ${agent_type}"

# ---- canonical state first (failure trap must work without env/Slack) ----
# shellcheck source=wiz_pr_review_state.sh
source "${script_dir}/wiz_pr_review_state.sh" || die "Cannot source wiz_pr_review_state.sh"

watcher_exit() {
    local rc=$? current_state_file transitioned failure_lock fail_msg
    [[ "$finalized" == "true" ]] && return 0
    # A stale watcher for an older round must neither alter current state nor
    # post a misleading failure into the live Slack thread.
    current_state_file="$(wiz_review_state_file "$repo" "$pr_number")"
    transitioned=false
    failure_lock="$terminal_lock"
    if [[ -z "$failure_lock" ]]; then
        failure_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" \
            "${WIZ_FINALIZER_LOCK_WAIT_TRIES:-1200}" 2>/dev/null || true)"
    fi
    [[ -n "$failure_lock" ]] || return "$rc"
    if [[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 && -s "$current_state_file" ]]; then
        # Claim the failure transition atomically. If the attempt/generation is
        # stale—or a fast child already reached completed—do not emit any
        # failure side effects for the successor/terminal state.
        if wiz_review_state_mark_status_if "$repo" "$pr_number" "$review_round" "$review_attempt" \
            "$review_generation" running failed; then
            transitioned=true
        elif wiz_review_state_mark_status_if "$repo" "$pr_number" "$review_round" "$review_attempt" \
            "$review_generation" launching failed; then
            transitioned=true
        elif wiz_review_state_mark_status_if "$repo" "$pr_number" "$review_round" "$review_attempt" \
            "$review_generation" completed failed; then
            transitioned=true
        fi
    fi
    if [[ "$transitioned" != true ]]; then
        wiz_review_launch_lock_release "$failure_lock"
        terminal_lock=""
        return "$rc"
    fi
    if [[ "$recoverable_head_drift" == true ]] && finalization_is_pristine && queue_retry_is_pending; then
        log "Head drift has a queued replacement; canonical attempt failed without a Slack failure notification."
    elif command -v wiz_slack_ready >/dev/null 2>&1 && wiz_slack_ready; then
        fail_msg="❌ AI review${round_label}${agent_type:+ by *${agent_type}*} for *${pr_title}* (<${pr_url}>) failed before a verified GitHub review was submitted."
        fail_msg+=$'\n'"Reason: ${failure_reason}"
        wiz_slack_post "${WIZ_ACTIVE_CHANNEL}" "$thread_ts" "$fail_msg" >/dev/null 2>&1 || true
        if [[ -n "$thread_ts" ]]; then
            wiz_slack_unreact "${WIZ_ACTIVE_CHANNEL}" "$thread_ts" "${WIZ_REACT_INPROGRESS}" >/dev/null 2>&1 || true
            wiz_slack_react "${WIZ_ACTIVE_CHANNEL}" "$thread_ts" "${WIZ_REACT_FAILED}" >/dev/null 2>&1 || true
        fi
    fi
    wiz_review_launch_lock_release "$failure_lock"
    terminal_lock=""
    return "$rc"
}
trap watcher_exit EXIT
trap 'recoverable_head_drift=false; confirmed_head_drift=false; failure_reason="watcher interrupted"; exit 130' INT
trap 'recoverable_head_drift=false; confirmed_head_drift=false; failure_reason="watcher terminated"; exit 143' TERM

# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || die "Cannot source wiz_pr_pipeline.env"
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh" || die "Cannot source _wiz_slack.sh"
wiz_slack_ready || die "SLACK_BOT_TOKEN not available to the watcher"
# shellcheck source=_maestro_env.sh
source "${script_dir}/_maestro_env.sh" || die "Cannot source _maestro_env.sh"
export MAESTRO_USER_DATA="${MAESTRO_USER_DATA:-$HOME/Library/Application Support/maestro}"

ensure_current_attempt() {
    local sf
    sf="$(wiz_review_state_file "$repo" "$pr_number")"
    [[ -s "$sf" ]] || return 1
    [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" == "$review_round" ]] || return 1
    [[ -z "$review_attempt" || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" == "$review_attempt" ]] || return 1
    [[ "$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)" == "$review_generation" ]]
}
stop_if_stale() {
    if ! ensure_current_attempt; then
        finalized=true
        log "Stale watcher attempt; exiting without side effects."
        exit 0
    fi
}
stop_if_stale
expected_head="$(jq -r '.head_sha // empty' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
[[ -n "$expected_head" ]] || die "canonical expected head is missing"
ensure_live_head_matches() {
    local live
    confirmed_head_drift=false
    observed_live_head=""
    command -v gh >/dev/null 2>&1 || return 2
    live="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json headRefOid --jq '.headRefOid' 2>/dev/null)" || return 2
    [[ -n "$live" ]] || return 2
    observed_live_head="$live"
    if [[ "$live" == "$expected_head" ]]; then
        return 0
    fi
    confirmed_head_drift=true
    return 1
}
queue_retry_is_pending() {
    local status_json status
    [[ -x "${script_dir}/wiz_pr_get_status.sh" ]] || return 1
    status_json="$("${script_dir}/wiz_pr_get_status.sh" "$repo" "$pr_number" --json 2>/dev/null)" || return 1
    status="$(printf '%s' "$status_json" | jq -r '.status // empty' 2>/dev/null)"
    [[ "$status" == "${WIZ_QUEUE_STATUS:-Queue AI Review}" ]]
}
finalization_is_pristine() {
    local sf
    sf="$(wiz_review_state_file "$repo" "$pr_number")"
    [[ -s "$sf" ]] || return 1
    [[ "$(jq -r '(.finalization_phases // {}) | length' "$sf" 2>/dev/null)" == 0 ]]
}
head_drift_die() {
    if [[ "$confirmed_head_drift" == true ]]; then
        recoverable_head_drift=true
        die "$1"
    fi
    recoverable_head_drift=false
    die "could not verify the live PR head during exact-head validation"
}

dest_channel="${WIZ_ACTIVE_CHANNEL}"
dest_thread="${thread_ts}"
log "Will post review artifacts to ${dest_channel}${dest_thread:+ (thread ${dest_thread})}"

# ---- 1. wait for the review to finish ----
known_worktree_dir="$(jq -r --arg a "$agent_type" '.agents[$a].worktree_dir // empty' \
    "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
log "Watching Maestro agent ${agent_id}${agent_type:+ (${agent_type})} until Auto Run is fully idle..."

latest_autorun_error() {
    local hist="$MAESTRO_USER_DATA/history/${agent_id}.json"
    local min_ms="$1"
    local expected_project="$2"
    [[ -f "$hist" ]] || return 1
    python3 - "$hist" "$min_ms" "$expected_project" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    minimum = int(sys.argv[2])
    expected_project = sys.argv[3]
    matches = []
    for entry in data.get("entries", []):
        summary = str(entry.get("summary", ""))
        timestamp = int(entry.get("timestamp", 0) or 0)
        if (timestamp >= minimum
                and entry.get("type") == "AUTO"
                and entry.get("success") is False
                and entry.get("projectPath") == expected_project
                and "Auto Run error" in summary):
            detail = str(entry.get("fullResponse", "")).replace("\n", " ").replace("\x1f", " ")
            matches.append((timestamp, summary.replace("\x1f", " "), detail))
    if not matches:
        raise SystemExit(1)
    timestamp, summary, detail = max(matches)
    print(f"{timestamp}\x1f{summary}\x1f{detail[:500]}")
except Exception:
    raise SystemExit(1)
PY
}

attempt_epoch="$(printf '%s' "$review_attempt" | awk -F- '{print $2}')"
[[ "$attempt_epoch" =~ ^[0-9]+$ ]] || attempt_epoch="$(date +%s)"
minimum_error_ms=$((attempt_epoch * 1000))
resume_count="$(jq -r '.auto_resume_count // 0' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
last_error_ms="$(jq -r '.auto_resume_last_error_ms // 0' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
[[ "$resume_count" =~ ^[0-9]+$ ]] || die "canonical auto-resume count is malformed"
[[ "$last_error_ms" =~ ^[0-9]+$ ]] || die "canonical auto-resume error marker is malformed"
auto_resume_max="${WIZ_WATCH_AUTO_RESUME_MAX:-2}"
auto_resume_backoff="${WIZ_WATCH_AUTO_RESUME_BACKOFF:-15}"
resume_command_timeout="${WIZ_WATCH_RESUME_COMMAND_TIMEOUT:-30}"
final_review_verify_timeout="${WIZ_FINAL_REVIEW_VERIFY_TIMEOUT:-300}"
final_review_verify_poll="${WIZ_FINAL_REVIEW_VERIFY_POLL:-2}"
[[ "$auto_resume_max" =~ ^[0-9]+$ ]] || die "WIZ_WATCH_AUTO_RESUME_MAX must be numeric"
[[ "$auto_resume_backoff" =~ ^[0-9]+$ ]] || die "WIZ_WATCH_AUTO_RESUME_BACKOFF must be numeric"
[[ "$resume_command_timeout" =~ ^[0-9]+$ && "$resume_command_timeout" -gt 0 ]] \
    || die "WIZ_WATCH_RESUME_COMMAND_TIMEOUT must be a positive integer"
[[ "$final_review_verify_timeout" =~ ^[0-9]+$ && "$final_review_verify_timeout" -gt 0 ]] \
    || die "WIZ_FINAL_REVIEW_VERIFY_TIMEOUT must be a positive integer"
[[ "$final_review_verify_poll" =~ ^[0-9]+$ && "$final_review_verify_poll" -gt 0 ]] \
    || die "WIZ_FINAL_REVIEW_VERIFY_POLL must be a positive integer"
watch_deadline_epoch="$(wiz_review_state_ensure_watch_deadline "$repo" "$pr_number" "$review_round" "$review_attempt" "$WIZ_WATCH_MAX_SECONDS" "$review_generation" 2>/dev/null)"
[[ "$watch_deadline_epoch" =~ ^[0-9]+$ ]] || die "could not establish the durable attempt watch deadline"

while true; do
    remaining=$(( watch_deadline_epoch - $(date +%s) ))
    (( remaining > 0 )) || die "review exceeded the ${WIZ_WATCH_MAX_SECONDS}s overall watch deadline after ${resume_count} automatic resume(s)"

    "${script_dir}/maestro_watch.sh" "$agent_id" "${WIZ_WATCH_GRACE}" "${WIZ_WATCH_POLL}" "$agent_type" \
        "${WIZ_WATCH_START_TIMEOUT}" "$remaining" "$autorun_dir" "$known_worktree_dir"
    watch_rc=$?
    [[ "$watch_rc" -eq 0 ]] && break

    stop_if_stale
    [[ "$watch_rc" -eq 75 ]] \
        || die "maestro_watch.sh failed with rc=${watch_rc} after ${resume_count} automatic resume(s)"

    error_record="$(latest_autorun_error "$minimum_error_ms" "$known_worktree_dir" 2>/dev/null || true)"
    error_ms=""; error_summary=""; error_detail=""
    IFS=$'\x1f' read -r error_ms error_summary error_detail <<< "$error_record"
    if [[ ! "$error_ms" =~ ^[0-9]+$ || "$error_ms" -le "$last_error_ms" ]]; then
        die "Auto Run became idle incomplete without a new explicit Maestro error pause after ${resume_count} automatic resume(s)"
    fi
    if (( resume_count >= auto_resume_max )); then
        die "Auto Run failed repeatedly after ${resume_count} automatic resume(s): ${error_summary}${error_detail:+ — ${error_detail}}"
    fi

    remaining=$(( watch_deadline_epoch - $(date +%s) ))
    (( remaining > auto_resume_backoff )) \
        || die "review exceeded the ${WIZ_WATCH_MAX_SECONDS}s overall watch deadline before automatic-resume backoff"
    (( auto_resume_backoff > 0 )) && sleep "$auto_resume_backoff"
    remaining=$(( watch_deadline_epoch - $(date +%s) ))
    (( remaining > 0 )) \
        || die "review exceeded the ${WIZ_WATCH_MAX_SECONDS}s overall watch deadline before automatic resume"

    resume_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" "${WIZ_FINALIZER_LOCK_WAIT_TRIES:-1200}" 2>/dev/null || true)"
    [[ -n "$resume_lock" ]] || die "could not acquire the per-PR launch lock for automatic resume"
    if ! ensure_current_attempt; then
        wiz_review_launch_lock_release "$resume_lock"
        finalized=true
        log "Attempt became stale before automatic resume; exiting without side effects."
        exit 0
    fi
    # Re-read under the launch lock. This prevents an old watcher from acting on
    # an error record after a successor attempt has claimed the PR.
    error_record="$(latest_autorun_error "$minimum_error_ms" "$known_worktree_dir" 2>/dev/null || true)"
    locked_error_ms="${error_record%%$'\x1f'*}"
    if [[ "$locked_error_ms" != "$error_ms" ]]; then
        wiz_review_launch_lock_release "$resume_lock"
        die "Auto Run error state changed while acquiring the resume lock"
    fi

    persisted_resume_count="$(jq -r '.auto_resume_count // 0' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
    if [[ ! "$persisted_resume_count" =~ ^[0-9]+$ || "$persisted_resume_count" -ge "$auto_resume_max" ]]; then
        wiz_review_launch_lock_release "$resume_lock"
        die "Auto Run failed repeatedly after ${persisted_resume_count:-unknown} automatic resume(s): ${error_summary}"
    fi
    resume_count="$(wiz_review_state_record_auto_resume "$repo" "$pr_number" "$review_round" "$review_attempt" "$error_ms" "$review_generation" 2>/dev/null)"
    if [[ ! "$resume_count" =~ ^[0-9]+$ ]]; then
        wiz_review_launch_lock_release "$resume_lock"
        die "could not durably claim the automatic Auto Run resume"
    fi
    last_error_ms="$error_ms"
    log "Auto Run paused on error; automatic resume ${resume_count}/${auto_resume_max}: ${error_summary}"
    (( remaining < resume_command_timeout )) && command_timeout="$remaining" || command_timeout="$resume_command_timeout"
    resume_out="$(python3 - "$maestro_cli" "$agent_id" "$command_timeout" <<'PY'
import subprocess, sys
try:
    proc = subprocess.run(
        ["node", sys.argv[1], "resume-auto-run", "--agent", sys.argv[2], "--json"],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        timeout=int(sys.argv[3]), check=False)
    sys.stdout.write(proc.stdout)
    raise SystemExit(proc.returncode)
except subprocess.TimeoutExpired as exc:
    if exc.stdout:
        sys.stdout.write(exc.stdout if isinstance(exc.stdout, str) else exc.stdout.decode(errors="replace"))
    raise SystemExit(124)
PY
)"
    resume_rc=$?
    wiz_review_launch_lock_release "$resume_lock"
    [[ "$resume_rc" -eq 0 ]] \
        || die "Maestro refused automatic resume ${resume_count}/${auto_resume_max} (rc=${resume_rc}): ${resume_out}"
    log "Maestro accepted automatic resume ${resume_count}/${auto_resume_max}; monitoring continues immediately"
done
stop_if_stale
command -v gh >/dev/null 2>&1 || die "gh CLI not found for exact-head publication checks"
me="$(gh api user --jq '.login' 2>/dev/null)"
[[ -n "$me" ]] || die "cannot determine authenticated GitHub identity"
[[ "$me" == "${WIZ_GH_ACCOUNT}" ]] || die "GitHub identity is ${me}, expected ${WIZ_GH_ACCOUNT}"

# ---- 2. collect + upload review files ----
present=()
missing=()
for f in "${WIZ_REVIEW_FILES[@]}"; do
    path="${autorun_dir}/${f}"
    if [[ -f "$path" ]]; then present+=("$path"); else missing+=("$f"); fi
done
[[ ${#missing[@]} -eq 0 ]] || die "required review artifacts missing: ${missing[*]}"

artifact_intro="*AI review${round_label} artifacts ready${agent_label}:* <${pr_url}|${pr_title}>"$'\n'"Final GitHub review verification is still in progress."
slack_phase="$(jq -c '.finalization_phases.slack_artifacts // null' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
slack_phase_status="$(printf '%s' "$slack_phase" | jq -r 'if type=="string" then "posted" else .status // empty end' 2>/dev/null)"
if [[ "$slack_phase_status" == "posted" ]]; then
    log "Skipping Slack artifact upload; canonical posted phase already exists"
elif [[ "$slack_phase_status" == "claimed" ]]; then
    die "Slack artifact upload has an uncertain prior claim; refusing a duplicate upload"
else
    artifact_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" "${WIZ_FINALIZER_LOCK_WAIT_TRIES:-1200}" 2>/dev/null || true)"
    [[ -n "$artifact_lock" ]] || die "could not acquire per-PR lock for Slack artifact upload"
    if ! ensure_current_attempt; then
        wiz_review_launch_lock_release "$artifact_lock"
        finalized=true
        log "Attempt became stale before Slack artifact upload; exiting without side effects."
        exit 0
    fi
    if ! ensure_live_head_matches; then
        wiz_review_launch_lock_release "$artifact_lock"
        head_drift_die "live PR head changed before Slack artifact publication; refusing stale artifacts"
    fi
    wiz_review_state_claim_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" slack_artifacts "$review_generation" \
        || { wiz_review_launch_lock_release "$artifact_lock"; die "could not durably claim Slack artifact upload"; }
    if wiz_slack_upload "$dest_channel" "$dest_thread" "$artifact_intro" "${present[@]}"; then
        log "Uploaded ${#present[@]} review file(s) to ${dest_channel}"
        wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" slack_artifacts "$review_generation" \
            || { wiz_review_launch_lock_release "$artifact_lock"; die "Slack artifacts uploaded but posted phase recording failed"; }
        wiz_review_launch_lock_release "$artifact_lock"
    else
        upload_rc=$?
        wiz_review_launch_lock_release "$artifact_lock"
        die "Slack review-artifact upload failed or is uncertain (rc=${upload_rc}); claim retained to prevent duplicate upload"
    fi
fi

# ---- 2b. attach the review artifacts to the PR as a GitHub comment ----
# Single comment with each artifact in a collapsible <details> block so the PR
# conversation stays readable. GitHub caps a comment at 65536 chars, so each
# artifact is truncated to a safe budget with a pointer to the Slack thread for
# the full text. Best-effort: never fail the pipeline on a gh hiccup.
github_phase="$(jq -c '.finalization_phases.github_artifacts // null' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
github_phase_status="$(printf '%s' "$github_phase" | jq -r 'if type=="string" then "posted" else .status // empty end' 2>/dev/null)"
if [[ "$github_phase_status" == "posted" ]]; then
    log "Skipping GitHub artifact comment; canonical posted phase already exists"
elif [[ "$github_phase_status" == "claimed" ]]; then
    log "WARNING: GitHub artifact comment has an uncertain prior claim; refusing a duplicate comment"
elif [[ ${#present[@]} -gt 0 ]] && command -v gh >/dev/null 2>&1; then
    github_artifact_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" "${WIZ_FINALIZER_LOCK_WAIT_TRIES:-1200}" 2>/dev/null || true)"
    [[ -n "$github_artifact_lock" ]] || die "could not acquire per-PR lock for GitHub artifact comment"
    if ! ensure_current_attempt; then
        wiz_review_launch_lock_release "$github_artifact_lock"
        finalized=true
        log "Attempt became stale before GitHub artifact comment; exiting without side effects."
        exit 0
    fi
    if ! ensure_live_head_matches; then
        wiz_review_launch_lock_release "$github_artifact_lock"
        head_drift_die "live PR head changed before GitHub artifact publication; refusing stale artifacts"
    fi
    wiz_review_state_claim_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" github_artifacts "$review_generation" \
        || { wiz_review_launch_lock_release "$github_artifact_lock"; die "could not durably claim GitHub artifact comment"; }
    gh_body_file="$(mktemp -t wiz_pr_ghcomment.XXXXXX)"
    # Per-artifact char budget keeps the whole comment well under GitHub's 65536
    # limit even with 5 artifacts + the <details> wrappers.
    per_artifact_max=11000
    {
        printf '## 🤖 AI Code Review Artifacts\n\n'
        printf 'Automated review for this PR. Each section is collapsible. Full untruncated artifacts are in the Slack review thread.\n'
        for path in "${present[@]}"; do
            name="$(basename "$path")"
            label="${name%.md}"
            printf '\n<details>\n<summary><b>%s</b></summary>\n\n' "$label"
            bytes="$(wc -c < "$path" | tr -d ' ')"
            if [[ "$bytes" -gt "$per_artifact_max" ]]; then
                head -c "$per_artifact_max" "$path"
                printf '\n\n_… truncated (%s of %s bytes shown) — see the full %s in the Slack review thread._\n' \
                    "$per_artifact_max" "$bytes" "$name"
            else
                cat "$path"
            fi
            printf '\n\n</details>\n'
        done
        if [[ ${#missing[@]} -gt 0 ]]; then
            printf '\n_Note: these artifacts were not produced: %s_\n' "${missing[*]}"
        fi
    } > "$gh_body_file"
    if gh pr comment "$pr_number" --repo "story-wizard/${repo}" --body-file "$gh_body_file" >/dev/null 2>&1; then
        log "Posted review artifacts as a GitHub PR comment on story-wizard/${repo}#${pr_number}"
        wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" github_artifacts "$review_generation" \
            || { wiz_review_launch_lock_release "$github_artifact_lock"; die "GitHub artifacts posted but posted phase recording failed"; }
    else
        log "WARNING: gh pr comment failed for story-wizard/${repo}#${pr_number}"
    fi
    rm -f "$gh_body_file"
    wiz_review_launch_lock_release "$github_artifact_lock"
elif [[ ${#present[@]} -gt 0 ]]; then
    log "WARNING: gh CLI not found; skipped GitHub PR comment"
fi

# ---- 3. idempotently send finalize prompt and verify an exact-head review ----
stop_if_stale
[[ -f "$WIZ_FINALIZE_PROMPT" ]] || die "finalize prompt not found at ${WIZ_FINALIZE_PROMPT}"

# The final-review phase is a durable send-once fence. A claimed phase is
# intentionally never resent: the prior send may have reached the agent even if
# its caller crashed. We only poll for its exact-head result.
final_review_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" "${WIZ_FINALIZER_LOCK_WAIT_TRIES:-1200}" 2>/dev/null || true)"
[[ -n "$final_review_lock" ]] || die "could not acquire per-PR lock for final review"
if ! ensure_current_attempt; then
    wiz_review_launch_lock_release "$final_review_lock"
    finalized=true
    log "Attempt became stale before final review; exiting without side effects."
    exit 0
fi
final_phase="$(jq -c '.finalization_phases.final_review // null' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
final_phase_status="$(printf '%s' "$final_phase" | jq -r 'if type=="string" then "posted" else .status // empty end' 2>/dev/null)"
reviews_json="$(gh api "repos/story-wizard/${repo}/pulls/${pr_number}/reviews" --paginate --slurp 2>/dev/null \
    | jq -c 'add' 2>/dev/null)" || { wiz_review_launch_lock_release "$final_review_lock"; die "cannot inspect existing GitHub reviews"; }
if ! ensure_live_head_matches; then
    wiz_review_launch_lock_release "$final_review_lock"
    head_drift_die "live PR head changed before final-review reconciliation/send; refusing stale finalization"
fi
new_review="$(printf '%s' "$reviews_json" | jq -c --arg me "$me" --arg head "$expected_head" --argjson since "$attempt_epoch" '
  [.[] | select(.user.login==$me and .commit_id==$head) |
   select(.state=="COMMENTED" or .state=="CHANGES_REQUESTED" or .state=="APPROVED") |
   select(((.submitted_at | fromdateiso8601?) // 0) >= $since)] | last // empty
' 2>/dev/null)"
finalize_rc=0
if [[ -n "$new_review" ]]; then
    log "An exact-head review for this attempt already exists; skipping finalize send"
    [[ "$final_phase_status" == posted ]] || \
        wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" final_review "$review_generation" \
        || { wiz_review_launch_lock_release "$final_review_lock"; die "could not reconcile final-review phase"; }
elif [[ "$final_phase_status" == posted ]]; then
    wiz_review_launch_lock_release "$final_review_lock"
    die "final-review phase is posted but its exact-head review is missing"
elif [[ "$final_phase_status" == claimed ]]; then
    log "Final-review send has an uncertain prior claim; polling without resending"
else
    wiz_review_state_claim_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" final_review "$review_generation" \
        || { wiz_review_launch_lock_release "$final_review_lock"; die "could not durably claim final-review send"; }
    final_phase_status=claimed
    log "Sending finalize prompt to agent ${agent_id}"
    finalize_out="$(run_bounded "$resume_command_timeout" node "$maestro_cli" send "$agent_id" "$(cat "$WIZ_FINALIZE_PROMPT")" 2>&1)"
    finalize_rc=$?
    log "Finalize agent response received (${#finalize_out} chars, rc=${finalize_rc})"
fi
wiz_review_launch_lock_release "$final_review_lock"

# A bounded finalize send can time out while the underlying agent continues and
# submits asynchronously. Keep polling the durably claimed phase without ever
# resending. Completion still requires this attempt's exact analyzed head;
# APPROVED remains forbidden below.
final_review_verify_deadline=$(( $(date +%s) + final_review_verify_timeout ))
while :; do
    [[ -n "$new_review" ]] && break
    reviews_json="$(gh api "repos/story-wizard/${repo}/pulls/${pr_number}/reviews" --paginate --slurp 2>/dev/null \
        | jq -c 'add' 2>/dev/null || true)"
    new_review="$(printf '%s' "$reviews_json" | jq -c --arg me "$me" --arg head "$expected_head" --argjson since "$attempt_epoch" '
      [.[] | select(.user.login==$me and .commit_id==$head) |
       select(.state=="COMMENTED" or .state=="CHANGES_REQUESTED" or .state=="APPROVED") |
       select(((.submitted_at | fromdateiso8601?) // 0) >= $since)] | last // empty
    ' 2>/dev/null)"
    [[ -n "$new_review" ]] && break
    final_review_verify_remaining=$(( final_review_verify_deadline - $(date +%s) ))
    (( final_review_verify_remaining > 0 )) || break
    final_review_verify_sleep="$final_review_verify_poll"
    (( final_review_verify_sleep > final_review_verify_remaining )) \
        && final_review_verify_sleep="$final_review_verify_remaining"
    sleep "$final_review_verify_sleep"
done
if [[ -z "$new_review" ]]; then
    if [[ "$final_phase_status" == claimed ]]; then
        die "prior final-review send remains uncertain and no exact-head review appeared; refusing a duplicate send"
    elif [[ $finalize_rc -eq 0 ]]; then
        die "finalize returned successfully but no exact-head ${me} GitHub review appeared"
    else
        die "maestro-cli finalize failed (rc=${finalize_rc}) and no exact-head ${me} GitHub review appeared"
    fi
fi
review_id="$(printf '%s' "$new_review" | jq -r '.id // empty')"
review_state="$(printf '%s' "$new_review" | jq -r '.state // empty')"
review_commit="$(printf '%s' "$new_review" | jq -r '.commit_id // empty')"
review_url="$(printf '%s' "$new_review" | jq -r '.html_url // empty')"
expected_head="$(jq -r '.head_sha // empty' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
if [[ "$review_state" == "APPROVED" ]]; then
    if [[ -n "$review_id" ]] && gh api --method PUT \
        "repos/story-wizard/${repo}/pulls/${pr_number}/reviews/${review_id}/dismissals" \
        -f message="Unauthorized AI approval; AI reviews must remain COMMENT/CHANGES_REQUESTED only." \
        -f event="DISMISS" >/dev/null 2>&1; then
        die "safety violation: AI submitted APPROVED; review ${review_id} was immediately dismissed"
    fi
    die "CRITICAL safety violation: AI submitted APPROVED review ${review_id:-unknown} and automatic dismissal failed"
fi
[[ "$review_state" == "COMMENTED" || "$review_state" == "CHANGES_REQUESTED" ]] \
    || die "unexpected GitHub review state: ${review_state:-missing}"
[[ -n "$expected_head" && "$review_commit" == "$expected_head" ]] \
    || die "GitHub review commit ${review_commit:-missing} does not match reviewed head ${expected_head:-missing}"
log "Verified GitHub review ${review_url:-id $(printf '%s' "$new_review" | jq -r .id)} (${review_state})"
stop_if_stale
if ! ensure_live_head_matches; then
    head_drift_die "live PR head ${observed_live_head:-unknown} advanced after review of ${expected_head}; refusing stale completion"
fi

# Hold the per-PR lock across canonical completion and its terminal Slack
# message/reaction so a successor cannot begin startup between them.
terminal_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" \
    "${WIZ_FINALIZER_LOCK_WAIT_TRIES:-1200}" 2>/dev/null || true)"
[[ -n "$terminal_lock" ]] || die "could not acquire per-PR terminal completion lock"
stop_if_stale
ensure_live_head_matches || head_drift_die "PR head changed before locked terminal completion"

# Never auto-dismiss an older CHANGES_REQUESTED review. GitHub pushes cannot be
# serialized by the local lock, so automatic dismissal could unblock a newly
# advanced, unreviewed head. A verified COMMENTED review remains advisory and
# any prior human/blocking state stays intact for explicit human action.

final_phase_status="$(jq -r '.finalization_phases.final_review.status // empty' "$(wiz_review_state_file "$repo" "$pr_number")" 2>/dev/null)"
if [[ "$final_phase_status" != posted ]]; then
    wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" final_review "$review_generation" \
        || die "verified review exists but final-review phase could not be marked posted"
fi

# Commit canonical completion before any human-facing completion announcement.
# If this locked attempt update fails, the EXIT trap marks failure instead of
# publishing contradictory success.
if [[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 ]]; then
    wiz_review_state_mark_status "$repo" "$pr_number" "$review_round" "completed" "$review_attempt" "$review_generation" \
        || die "could not mark canonical review state completed"
fi
# Close the check→write window: validate the remote head again after the
# canonical completion write and before any success announcement. A push racing
# the write causes EXIT to CAS completed→failed under the same terminal lock.
if ! ensure_live_head_matches; then
    head_drift_die "PR head advanced to ${observed_live_head:-unknown} during completion of ${expected_head}; reverting completion"
fi
finalized=true

# ---- 4. final confirmation, @-mentioning the original poster ----
mention=""
author_id="$(wiz_slack_thread_author "$dest_channel" "$dest_thread" 2>/dev/null)"
# Skip the mention if the parent was deleted (author resolves to Slackbot) or unknown.
if [[ -n "$author_id" && "$author_id" != "USLACKBOT" ]]; then
    mention="<@${author_id}> "
fi
confirm="✅ ${mention}AI review${round_label}${agent_type:+ by *${agent_type}*} for *${pr_title}* (<${pr_url}>) has been posted."
[[ -n "$review_url" ]] && confirm+=$'\n'"Review: <${review_url}>"
wiz_slack_post "$dest_channel" "$dest_thread" "$confirm" >/dev/null \
    && log "Posted final confirmation${author_id:+ (mentioned ${author_id})}" \
    || log "WARNING: failed to post final confirmation"

# ---- 5. swap the in-progress reaction to done on the trigger message ----
if [[ -n "$dest_thread" ]] && wiz_slack_ready; then
    wiz_slack_unreact "$dest_channel" "$dest_thread" "${WIZ_REACT_INPROGRESS}" >/dev/null 2>&1 || true
    wiz_slack_react   "$dest_channel" "$dest_thread" "${WIZ_REACT_DONE}"       >/dev/null 2>&1 || true
fi

wiz_review_launch_lock_release "$terminal_lock"
terminal_lock=""
log "Pipeline finalize verified for ${repo} PR #${pr_number}."
