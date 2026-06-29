#!/bin/bash

# wiz_pr_build_watch.sh — Wait for a dispatched wizard-release build to finish,
# then post the release link (or failure) to the PR's Slack thread.
#
# Launched DETACHED by wiz_pr_build.sh. `gh workflow run` returns no run id, so
# we locate the run by taking the newest build-release.yml workflow_dispatch run
# created at/after the dispatch timestamp, then poll it to completion.
#
# Usage:
#   wiz_pr_build_watch.sh <repo> <pr_number> <git_tag> <release_url> <dispatch_at_iso> <thread_ts>

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { echo "[$(date '+%H:%M:%S')] $*"; }
die() { echo "Error: $*" >&2; exit 1; }

[[ $# -eq 6 ]] || die "Usage: $(basename "$0") <repo> <pr_number> <git_tag> <release_url> <dispatch_at_iso> <thread_ts>"
repo="$1"; pr_number="$2"; git_tag="$3"; release_url="$4"; dispatch_at="$5"; thread_ts="$6"

# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || die "cannot source wiz_pr_pipeline.env"
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh"        || die "cannot source _wiz_slack.sh"
wiz_slack_ready || die "SLACK_BOT_TOKEN not available to the build watcher"

dest_channel="${WIZ_ACTIVE_CHANNEL}"
RELEASE_REPO="story-wizard/wizard-release"
BUILD_WORKFLOW="build-release.yml"

# Tunables (fall back to sane defaults if not in the env file).
poll="${WIZ_BUILD_POLL:-30}"            # seconds between polls
max_wait="${WIZ_BUILD_MAX_WAIT:-2400}"  # give up after ~40 min
find_tries="${WIZ_BUILD_FIND_TRIES:-10}"

post() { wiz_slack_post "$dest_channel" "$thread_ts" "$1" >/dev/null 2>&1 || true; }

# ---- 1. find the dispatched run id ----
# Newest workflow_dispatch run created at/after dispatch_at. Retry a few times:
# the run can take a few seconds to register after `gh workflow run`.
run_id=""
for ((i=1; i<=find_tries; i++)); do
    run_id="$(gh run list --repo "$RELEASE_REPO" --workflow "$BUILD_WORKFLOW" \
        --event workflow_dispatch --limit 15 \
        --json databaseId,createdAt \
        --jq "[.[] | select(.createdAt >= \"${dispatch_at}\")] | sort_by(.createdAt) | .[0].databaseId // empty" 2>/dev/null)"
    [[ -n "$run_id" ]] && break
    sleep 6
done

if [[ -z "$run_id" ]]; then
    log "Could not locate the dispatched run after ${find_tries} tries; posting best-effort notice."
    post "⚠️ Build for PR #${pr_number} (\`${git_tag}\`) was dispatched, but I couldn't latch onto the run to track it. Check <https://github.com/${RELEASE_REPO}/actions/workflows/${BUILD_WORKFLOW}|the Actions tab>."
    exit 0
fi

run_url="https://github.com/${RELEASE_REPO}/actions/runs/${run_id}"
log "Tracking run ${run_id} for ${repo} PR #${pr_number} -> ${git_tag} (${run_url})"

# ---- 2. poll to completion ----
elapsed=0
status="" ; conclusion=""
while (( elapsed < max_wait )); do
    read -r status conclusion < <(gh run view "$run_id" --repo "$RELEASE_REPO" \
        --json status,conclusion --jq '"\(.status) \(.conclusion // "")"' 2>/dev/null)
    [[ "$status" == "completed" ]] && break
    sleep "$poll"; elapsed=$((elapsed + poll))
done

# ---- 3. post the result ----
if [[ "$status" != "completed" ]]; then
    log "Timed out after ${elapsed}s (status=${status})."
    post "⏱️ Build for PR #${pr_number} (\`${git_tag}\`) is still running after $((max_wait/60)) min. Track it: <${run_url}>"
    exit 0
fi

author_id="$(wiz_slack_thread_author "$dest_channel" "$thread_ts" 2>/dev/null)"
mention=""; [[ -n "$author_id" ]] && mention="<@${author_id}> "

# Also @-mention the human reviewers who reviewed this PR (mapped github->slack
# via WIZ_GH_SLACK_MAP), excluding the thread author so they're not pinged twice.
reviewers="$(wiz_slack_reviewer_mentions "$repo" "$pr_number" "$author_id" 2>/dev/null)"
rev_suffix=""; [[ -n "$reviewers" ]] && rev_suffix=$'\n'"Reviewers: ${reviewers}"

if [[ "$conclusion" == "success" ]]; then
    # Confirm the release actually exists before linking to it.
    if gh release view "$git_tag" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
        post "✅ ${mention}Tagged build for PR #${pr_number} is ready: *${git_tag}*"$'\n'"Release: <${release_url}>${rev_suffix}"
    else
        post "✅ ${mention}Build run for PR #${pr_number} (\`${git_tag}\`) finished successfully, but I couldn't confirm the release page yet — it should appear shortly at <${release_url}> (<${run_url}|run log>).${rev_suffix}"
    fi
    log "Done: success."
else
    post "❌ ${mention}Tagged build for PR #${pr_number} (\`${git_tag}\`) failed (${conclusion}). Logs: <${run_url}>${rev_suffix}"
    log "Done: ${conclusion}."
fi
