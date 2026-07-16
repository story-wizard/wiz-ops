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
die() { failure_reason="$*"; echo "Error: $*" >&2; exit 1; }

[[ $# -ge 7 && $# -le 10 ]] || die "Usage: $(basename "$0") <repo> <pr_number> <agent_id> <autorun_dir> <pr_title> <pr_url> <thread_ts> [agent_type] [round] [attempt_id]"
repo="$1"; pr_number="$2"; agent_id="$3"; autorun_dir="$4"
pr_title="$5"; pr_url="$6"; thread_ts="$7"
agent_type="${8:-}"
review_round="${9:-0}"
review_attempt="${10:-}"
round_label=""
[[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 ]] && round_label=" #${review_round}"
agent_label=""
[[ -n "$agent_type" ]] && agent_label=" with ${agent_type}"

# ---- canonical state first (failure trap must work without env/Slack) ----
# shellcheck source=wiz_pr_review_state.sh
source "${script_dir}/wiz_pr_review_state.sh" || die "Cannot source wiz_pr_review_state.sh"

watcher_exit() {
    local rc=$?
    [[ "$finalized" == "true" ]] && return 0
    # A stale watcher for an older round must neither alter current state nor
    # post a misleading failure into the live Slack thread.
    current_state_file="$(wiz_review_state_file "$repo" "$pr_number")"
    if [[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 && -s "$current_state_file" ]] \
        && { [[ "$(jq -r '.round // 0' "$current_state_file" 2>/dev/null)" != "$review_round" ]] \
          || { [[ -n "$review_attempt" ]] && [[ "$(jq -r '.attempt_id // empty' "$current_state_file" 2>/dev/null)" != "$review_attempt" ]]; }; }; then
        return "$rc"
    fi
    if [[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 ]]; then
        wiz_review_state_mark_status "$repo" "$pr_number" "$review_round" "failed" "$review_attempt" \
            || echo "WARNING: could not mark canonical review state failed" >&2
    fi
    if command -v wiz_slack_ready >/dev/null 2>&1 && wiz_slack_ready; then
        fail_msg="❌ AI review${round_label}${agent_type:+ by *${agent_type}*} for *${pr_title}* (<${pr_url}>) failed before a verified GitHub review was submitted."
        fail_msg+=$'\n'"Reason: ${failure_reason}"
        wiz_slack_post "${WIZ_ACTIVE_CHANNEL}" "$thread_ts" "$fail_msg" >/dev/null 2>&1 || true
        if [[ -n "$thread_ts" ]]; then
            wiz_slack_unreact "${WIZ_ACTIVE_CHANNEL}" "$thread_ts" "${WIZ_REACT_INPROGRESS}" >/dev/null 2>&1 || true
            wiz_slack_react "${WIZ_ACTIVE_CHANNEL}" "$thread_ts" "${WIZ_REACT_FAILED}" >/dev/null 2>&1 || true
        fi
    fi
    return "$rc"
}
trap watcher_exit EXIT
trap 'failure_reason="watcher interrupted"; exit 130' INT
trap 'failure_reason="watcher terminated"; exit 143' TERM

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
    [[ -z "$review_attempt" || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" == "$review_attempt" ]]
}
stop_if_stale() {
    if ! ensure_current_attempt; then
        finalized=true
        log "Stale watcher attempt; exiting without side effects."
        exit 0
    fi
}
stop_if_stale

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
[[ "$auto_resume_max" =~ ^[0-9]+$ ]] || die "WIZ_WATCH_AUTO_RESUME_MAX must be numeric"
[[ "$auto_resume_backoff" =~ ^[0-9]+$ ]] || die "WIZ_WATCH_AUTO_RESUME_BACKOFF must be numeric"
[[ "$resume_command_timeout" =~ ^[0-9]+$ && "$resume_command_timeout" -gt 0 ]] \
    || die "WIZ_WATCH_RESUME_COMMAND_TIMEOUT must be a positive integer"
watch_deadline_epoch="$(wiz_review_state_ensure_watch_deadline "$repo" "$pr_number" "$review_round" "$review_attempt" "$WIZ_WATCH_MAX_SECONDS" 2>/dev/null)"
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

    resume_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" 2>/dev/null || true)"
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
    resume_count="$(wiz_review_state_record_auto_resume "$repo" "$pr_number" "$review_round" "$review_attempt" "$error_ms" 2>/dev/null)"
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
    artifact_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" 2>/dev/null || true)"
    [[ -n "$artifact_lock" ]] || die "could not acquire per-PR lock for Slack artifact upload"
    if ! ensure_current_attempt; then
        wiz_review_launch_lock_release "$artifact_lock"
        finalized=true
        log "Attempt became stale before Slack artifact upload; exiting without side effects."
        exit 0
    fi
    wiz_review_state_claim_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" slack_artifacts \
        || { wiz_review_launch_lock_release "$artifact_lock"; die "could not durably claim Slack artifact upload"; }
    if wiz_slack_upload "$dest_channel" "$dest_thread" "$artifact_intro" "${present[@]}"; then
        log "Uploaded ${#present[@]} review file(s) to ${dest_channel}"
        wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" slack_artifacts \
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
    github_artifact_lock="$(wiz_review_launch_lock_acquire "$repo" "$pr_number" 2>/dev/null || true)"
    [[ -n "$github_artifact_lock" ]] || die "could not acquire per-PR lock for GitHub artifact comment"
    if ! ensure_current_attempt; then
        wiz_review_launch_lock_release "$github_artifact_lock"
        finalized=true
        log "Attempt became stale before GitHub artifact comment; exiting without side effects."
        exit 0
    fi
    wiz_review_state_claim_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" github_artifacts \
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
        wiz_review_state_mark_finalization_phase "$repo" "$pr_number" "$review_round" "$review_attempt" github_artifacts \
            || { wiz_review_launch_lock_release "$github_artifact_lock"; die "GitHub artifacts posted but posted phase recording failed"; }
    else
        log "WARNING: gh pr comment failed for story-wizard/${repo}#${pr_number}"
    fi
    rm -f "$gh_body_file"
    wiz_review_launch_lock_release "$github_artifact_lock"
elif [[ ${#present[@]} -gt 0 ]]; then
    log "WARNING: gh CLI not found; skipped GitHub PR comment"
fi

# ---- 3. send finalize prompt and verify a NEW GitHub review ----
stop_if_stale
command -v gh >/dev/null 2>&1 || die "gh CLI not found for final review verification"
me="$(gh api user --jq '.login' 2>/dev/null)"
[[ -n "$me" ]] || die "cannot determine authenticated GitHub identity"
[[ "$me" == "${WIZ_GH_ACCOUNT}" ]] || die "GitHub identity is ${me}, expected ${WIZ_GH_ACCOUNT}"
before_ids="$(gh api "repos/story-wizard/${repo}/pulls/${pr_number}/reviews" --paginate --slurp 2>/dev/null \
    | jq -c --arg me "$me" '[add[] | select(.user.login==$me) | .id]')" \
    || die "cannot snapshot existing GitHub reviews"
[[ -f "$WIZ_FINALIZE_PROMPT" ]] || die "finalize prompt not found at ${WIZ_FINALIZE_PROMPT}"

log "Sending finalize prompt to agent ${agent_id}"
finalize_out="$(node "$maestro_cli" send "$agent_id" "$(cat "$WIZ_FINALIZE_PROMPT")" 2>&1)"
finalize_rc=$?
log "Finalize agent response received (${#finalize_out} chars, rc=${finalize_rc})"

# GitHub may take a moment to expose the submitted review. Completion requires
# a new bot review on the exact head that was analyzed; APPROVED is forbidden.
new_review=""
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    reviews_json="$(gh api "repos/story-wizard/${repo}/pulls/${pr_number}/reviews" --paginate --slurp 2>/dev/null \
        | jq -c 'add' 2>/dev/null || true)"
    new_review="$(printf '%s' "$reviews_json" | jq -c --arg me "$me" --argjson before "$before_ids" '
      [.[] | select(.user.login==$me) | select(.id as $id | ($before | index($id) | not))] | last // empty
    ' 2>/dev/null)"
    [[ -n "$new_review" ]] && break
    sleep 2
done
if [[ -z "$new_review" ]]; then
    if [[ $finalize_rc -eq 0 ]]; then
        die "finalize returned successfully but no new ${me} GitHub review appeared"
    else
        die "maestro-cli finalize failed (rc=${finalize_rc}) and no new ${me} GitHub review appeared"
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

# Commit canonical completion before any human-facing completion announcement.
# If this locked attempt update fails, the EXIT trap marks failure instead of
# publishing contradictory success.
if [[ "$review_round" =~ ^[0-9]+$ && "$review_round" -gt 0 ]]; then
    wiz_review_state_mark_status "$repo" "$pr_number" "$review_round" "completed" "$review_attempt" \
        || die "could not mark canonical review state completed"
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

log "Pipeline finalize verified for ${repo} PR #${pr_number}."
