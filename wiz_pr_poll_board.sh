#!/bin/bash

# wiz_pr_poll_board.sh — Board-driven AI-review trigger (GitHub Projects v2).
#
# Carol's model: kick off a review by SETTING a board status, not by typing in
# Slack. A human sets a PR's Status on org project #1 ("Wizard Development") to
# WIZ_QUEUE_STATUS ("Queue AI Review"); this poller (run on a ~60s cron) picks it
# up, validates eligibility, and — ONLY for eligible open/ready PRs — advances
# the status to "AI Review 1" and launches the review via the existing drivers
# in --board-trigger mode (which self-post a Slack lifecycle root). This is
# ADDITIVE: the Slack-link and threaded-re-review triggers keep working.
#
# Per-PR gate (ordering matters — never park a non-launching PR in AI Review 1):
#   1. PR merged/closed       -> comment + status -> WIZ_BOARD_CLOSED_STATUS (Done)
#   2. PR open + draft        -> comment + status -> WIZ_BOARD_CLEAR_STATUS  (Backlog)
#   2.5 status == WIZ_BUILD_STATUS ("Functional Review") -> auto-dispatch a
#        tagged build (wiz_pr_build.sh --board-trigger). Status is NOT advanced;
#        a per-PR head-SHA CLAIM (WIZ_BUILD_CLAIM_DIR) makes it fire once per
#        commit, auto-rebuilding when new commits land. Ack + result go to BOTH
#        the Slack review thread AND a PR comment.
#   3. PR open + ready, no existing review  -> flip AI Review 1, fresh review
#   4. PR open + ready, existing review:
#        - new commits -> driver advances to AI Review 2 (normal re-review)
#        - no new commits -> comment + RESTORE the true prior round (AI Review N)
#
# Invariant: WIZ_QUEUE_STATUS only ever advances to "AI Review N" when a review
# actually launches. Every other outcome routes to a meaningful resting state,
# so an item is never re-processed on the next tick.
#
# Cheap pre-scan gate: query projectV2.updatedAt first; skip the (more expensive)
# item scan when the project hasn't changed since the last tick. (updatedAt bumps
# on ANY project change, so we occasionally scan and find nothing — still skips
# the scan on the majority of idle ticks.)
#
# Output: human-readable log to stdout (cron delivery is 'local'/silent — the
# DRIVERS post to Slack; this poller only writes the PR comments + status). A
# trailing JSON summary line is emitted for logs.
#
# Usage:
#   wiz_pr_poll_board.sh [--dry-run] [--force]
#     --dry-run : scan + classify, but take NO actions (no status writes, no
#                 comments, no driver launches). Prints what it WOULD do. Safe.
#     --force   : ignore the updatedAt pre-scan gate and always scan.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_pipeline.env"}'; exit 1; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

dry_run=false
force=false
for a in "$@"; do
    case "$a" in
        --dry-run) dry_run=true ;;
        --force)   force=true ;;
        *) echo "{\"ok\":false,\"stage\":\"args\",\"message\":\"unknown arg: ${a}\"}"; exit 1 ;;
    esac
done

command -v gh >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"gh not found"}'; exit 1; }
command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }

# ---- repo validity (space-separated WIZ_VALID_REPOS -> membership test) ----
is_valid_repo() {
    local r="$1" v
    for v in $WIZ_VALID_REPOS; do [[ "$v" == "$r" ]] && return 0; done
    return 1
}

# ---- lock (prevent overlapping ticks; steal a stale lock) ----
acquire_lock() {
    local lock="$WIZ_POLL_LOCK"
    if mkdir "$lock" 2>/dev/null; then
        echo $$ > "${lock}/pid" 2>/dev/null || true
        return 0
    fi
    # Lock exists — steal it if older than the stale threshold.
    local age now mtime
    now=$(date +%s)
    mtime=$(stat -f %m "$lock" 2>/dev/null || echo "$now")
    age=$(( now - mtime ))
    if (( age > WIZ_POLL_STALE_LOCK_SECS )); then
        log "stealing stale lock (age ${age}s > ${WIZ_POLL_STALE_LOCK_SECS}s)"
        rm -rf "$lock" 2>/dev/null
        if mkdir "$lock" 2>/dev/null; then echo $$ > "${lock}/pid" 2>/dev/null || true; return 0; fi
    fi
    return 1
}
release_lock() { rm -rf "$WIZ_POLL_LOCK" 2>/dev/null || true; }

if [[ "$dry_run" == "false" ]]; then
    if ! acquire_lock; then
        log "another tick holds the lock; exiting."
        echo '{"ok":true,"action":"skipped_locked"}'
        exit 0
    fi
    trap release_lock EXIT
fi

# ---- cheap pre-scan gate: project updatedAt ----
# IMPORTANT: this is a fail-OPEN gate. We only skip the scan when the query
# returns a real ISO-8601 timestamp that matches the last-seen value. If the
# query errors (e.g. the gh token lost `read:project` scope, network blip), it
# does NOT return a timestamp — and we must NOT treat that as "unchanged" and
# skip, or the poller goes silently blind (this happened: an INSUFFICIENT_SCOPES
# error blob was byte-identical every tick, so the gate skipped forever and no
# PR got reviewed). On any non-timestamp result we log it and fall through to
# the scan, which will surface the real error loudly.
proj_updated_raw="$(gh api graphql -f query='
query($org:String!,$num:Int!){
  organization(login:$org){ projectV2(number:$num){ updatedAt } }
}' -F org="$WIZ_PROJECT_ORG" -F num="$WIZ_PROJECT_NUMBER" \
  --jq '.data.organization.projectV2.updatedAt' 2>/dev/null)"

# Accept only a plausible ISO-8601 timestamp (e.g. 2026-07-01T18:20:21Z).
proj_updated=""
if [[ "$proj_updated_raw" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    proj_updated="$proj_updated_raw"
elif [[ -n "$proj_updated_raw" ]]; then
    log "WARNING: projectV2.updatedAt query did not return a timestamp (token scope / API error?) — NOT skipping; proceeding to scan. raw: $(printf '%s' "$proj_updated_raw" | head -c 200)"
fi

if [[ "$force" == "false" && -n "$proj_updated" && -f "$WIZ_POLL_SEEN" ]]; then
    last_seen="$(jq -r '.updatedAt // empty' "$WIZ_POLL_SEEN" 2>/dev/null)"
    if [[ -n "$last_seen" && "$last_seen" == "$proj_updated" ]]; then
        log "project unchanged since ${last_seen}; skipping scan."
        echo '{"ok":true,"action":"skipped_unchanged"}'
        exit 0
    fi
fi

# ---- scan: OPEN PRs per repo whose project Status == WIZ_QUEUE_STATUS ----
# The board has ~1900 items, so paginating the whole project every tick is far
# too heavy. Instead we enumerate OPEN PRs per repo (dozens, not thousands) and
# read each PR's inline project-status, keeping only those queued on project
# #WIZ_PROJECT_NUMBER. Cost scales with open-PR count (~1 call/repo, sub-second).
#
# Trade-off: a PR that was queued and then CLOSED/MERGED before this tick won't
# appear in an open-PR scan, so it can linger in "${WIZ_QUEUE_STATUS}" on the
# board. That's harmless (no review runs on a closed PR) and a human can clear
# it; gate 1 below still handles the race where a PR closes mid-tick.
queued=""
scan_error=""
for repo in $WIZ_VALID_REPOS; do
    repo_json="$(gh api graphql -f query='
query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN, first:100){
      nodes{
        number isDraft headRefOid
        projectItems(first:10){
          nodes{
            project{ number }
            fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
          }
        }
      }
    }
  }
}' -F owner="$WIZ_PROJECT_ORG" -F name="$repo" 2>&1)"
    [[ -n "$repo_json" ]] || continue
    # Detect a hard API/scope error (e.g. token lost read:project). Without this
    # the jq path-miss on an error blob silently yields "no PRs" — a false
    # negative that leaves queued PRs unreviewed. Fail LOUDLY instead.
    if printf '%s' "$repo_json" | grep -q 'INSUFFICIENT_SCOPES\|"errors"'; then
        scan_error="$(printf '%s' "$repo_json" | head -c 300)"
        log "ERROR: board scan for ${repo} failed (API/scope error). raw: ${scan_error}"
        break
    fi
    # Emit "repo<TAB>number<TAB>OPEN<TAB>isDraft<TAB>matched_status<TAB>head_sha"
    # for PRs whose project Status is EITHER the AI-review queue status OR the
    # tagged-build status. matched_status tells the loop which path to take.
    repo_queued="$(echo "$repo_json" | jq -r \
        --arg q "$WIZ_QUEUE_STATUS" --arg b "$WIZ_BUILD_STATUS" --arg repo "$repo" --argjson pnum "$WIZ_PROJECT_NUMBER" '
      .data.repository.pullRequests.nodes[]?
      | . as $pr
      | ([ .projectItems.nodes[]?
           | select(.project.number == $pnum and .fieldValueByName != null
                    and (.fieldValueByName.name == $q or .fieldValueByName.name == $b))
           | .fieldValueByName.name ] | first) as $matched
      | select($matched != null)
      | [ $repo, ($pr.number|tostring), "OPEN", ($pr.isDraft|tostring), $matched, ($pr.headRefOid // "") ] | @tsv
    ' 2>/dev/null)"
    [[ -n "$repo_queued" ]] && queued+="${repo_queued}"$'\n'
done
queued="$(printf '%s' "$queued" | sed '/^$/d' | sort -u)"

# If the scan hit a hard API/scope error, do NOT report a misleading success or
# a false "no PRs". Emit an error summary and exit non-zero so the failure is
# visible (cron alerts on non-zero exit even with local delivery).
if [[ -n "$scan_error" ]]; then
    jq -nc --arg err "$scan_error" \
        '{ok:false, action:"scan_error", message:"board scan failed — check gh token read:project scope / active account", detail:$err}'
    exit 1
fi

n_total=0; n_started=0; n_rereview=0; n_nochange=0; n_draft=0; n_closed=0; n_skipped=0; n_build=0; n_build_skip=0

if [[ -z "$queued" ]]; then
    log "no PRs in '${WIZ_QUEUE_STATUS}' or '${WIZ_BUILD_STATUS}'."
else
    while IFS=$'\t' read -r repo pr_number state is_draft matched_status head_sha; do
        [[ -n "$repo" && -n "$pr_number" ]] || continue
        n_total=$((n_total + 1))

        if ! is_valid_repo "$repo"; then
            log "PR ${repo}#${pr_number}: repo not in valid set — skipping (left in queue)."
            n_skipped=$((n_skipped + 1))
            continue
        fi

        log "PR ${repo}#${pr_number}: state=${state} draft=${is_draft} status='${matched_status}'"

        # --- gate 1: not open (merged/closed) -> Done ---
        if [[ "$state" != "OPEN" ]]; then
            n_closed=$((n_closed + 1))
            state_lc="$(echo "$state" | tr '[:upper:]' '[:lower:]')"
            if [[ "$dry_run" == "true" ]]; then
                log "  [dry-run] would comment 'not open' + set status -> ${WIZ_BOARD_CLOSED_STATUS}"
                continue
            fi
            gh pr comment "$pr_number" --repo "story-wizard/${repo}" \
                --body "🤖 This PR is **${state_lc}**, so the AI code review was not started. Board status cleared to *${WIZ_BOARD_CLOSED_STATUS}*." >/dev/null 2>&1 || true
            "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$WIZ_BOARD_CLOSED_STATUS" >/dev/null 2>&1 || true
            continue
        fi

        # --- gate 2: open + draft -> Backlog ---
        if [[ "$is_draft" == "true" ]]; then
            n_draft=$((n_draft + 1))
            if [[ "$dry_run" == "true" ]]; then
                log "  [dry-run] would comment 'draft' + set status -> ${WIZ_BOARD_CLEAR_STATUS}"
                continue
            fi
            gh pr comment "$pr_number" --repo "story-wizard/${repo}" \
                --body "🤖 This PR is in **draft** mode, so nothing was started for status *${matched_status}*. Please switch it to *Ready for review* and set the status again. Board status cleared to *${WIZ_BOARD_CLEAR_STATUS}*." >/dev/null 2>&1 || true
            "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$WIZ_BOARD_CLEAR_STATUS" >/dev/null 2>&1 || true
            continue
        fi

        # --- gate 2.5: Functional Review -> auto-dispatch a tagged build ---
        # A human moving a PR to WIZ_BUILD_STATUS wants an installable build to
        # test. Unlike the AI-review path we do NOT advance the status (the PR
        # stays in Functional Review), so idempotency comes from a per-PR CLAIM
        # keyed on the branch head SHA: build once per commit, auto-rebuild when
        # new commits land, never every tick. Ack + result go to BOTH the Slack
        # review thread (recovered, or a fresh root) AND a PR comment (handled by
        # wiz_pr_build.sh --board-trigger + the watcher).
        if [[ "$matched_status" == "$WIZ_BUILD_STATUS" ]]; then
            # wizard-release / wizard-spec PRs cannot drive an app build.
            case "$repo" in
                wizard|wizard-ai|wizard-core) : ;;
                *)
                    log "  build: repo '${repo}' cannot drive an app build — skipping (left in ${WIZ_BUILD_STATUS})."
                    n_build_skip=$((n_build_skip + 1))
                    continue
                    ;;
            esac

            claim_dir="${WIZ_BUILD_CLAIM_DIR:-${HOME}/wizard/tmp/wiz-pr-build-claims}"
            claim_file="${claim_dir}/${repo}-${pr_number}.json"
            claimed_sha=""
            [[ -f "$claim_file" ]] && claimed_sha="$(jq -r '.head_sha // empty' "$claim_file" 2>/dev/null)"

            if [[ -n "$head_sha" && "$head_sha" == "$claimed_sha" ]]; then
                log "  build: already built head ${head_sha:0:8} — skipping (no new commits)."
                n_build_skip=$((n_build_skip + 1))
                continue
            fi

            if [[ "$dry_run" == "true" ]]; then
                log "  [dry-run] Functional Review -> would dispatch tagged build for head ${head_sha:0:8} (prev claim ${claimed_sha:0:8})."
                n_build=$((n_build + 1))
                continue
            fi

            # Recover the existing review's Slack root ts so the build ack threads
            # under the SAME conversation (Carol's model). Empty -> the driver
            # self-posts a fresh root. (Same lookup the re-review path uses.)
            build_thread_ts=""
            state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
            if [[ -d "$state_dir" ]]; then
                build_thread_ts="$(
                    for sf in "$state_dir"/*.json; do
                        [[ -f "$sf" ]] || continue
                        jq -r --arg repo "$repo" --arg pr "$pr_number" '
                          select(.repo == $repo and ((.pr_number|tostring) == $pr))
                          | .thread_ts // empty' "$sf" 2>/dev/null
                    done | grep -E '.' | sort -n | tail -1
                )"
            fi

            # Dispatch. The driver refuses a develop-conflicting build (freshness
            # gate) and posts that refusal to Slack + PR itself, so we don't
            # pre-check here. Record the claim ONLY on a successful dispatch so a
            # failed/refused build is retried next tick (and a fixed conflict
            # re-dispatches once the SHA changes).
            if "${script_dir}/wiz_pr_build.sh" --board-trigger "$repo" "$pr_number" "$build_thread_ts" >/dev/null 2>&1; then
                mkdir -p "$claim_dir" 2>/dev/null || true
                jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg sha "$head_sha" \
                    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                    '{repo:$repo, pr_number:$pr, head_sha:$sha, built_at:$at}' \
                    > "$claim_file" 2>/dev/null || true
                n_build=$((n_build + 1))
                log "  build: dispatched for head ${head_sha:0:8}; claim recorded."
            else
                n_build_skip=$((n_build_skip + 1))
                log "  build: driver returned non-zero (it posts its own failure/refusal); no claim recorded — will retry next tick."
            fi
            continue
        fi

        # --- open + ready: decide fresh vs re-review by existing review state ---
        agent_type="$WIZ_DEFAULT_AGENT_TYPE"
        worktree_name="${repo}-pr-${pr_number}-${agent_type}"
        worktree_dir="${HOME}/wizard/worktrees/${repo}/${worktree_name}"

        if [[ -d "$worktree_dir" ]]; then
            # --- gate 4: existing review -> re-review path ---
            # Determine the TRUE prior round so a no-changes result can restore it.
            # Round = count of existing review_<N> archive dirs + 1 (matches the
            # re-review driver's own accounting); cap the restore label at
            # "AI Review 2" (the board only has 1 and 2).
            autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"
            prev_round=1
            while [[ -d "${autorun_dir}/review_${prev_round}" ]]; do prev_round=$((prev_round + 1)); done
            restore_status="AI Review 1"; [[ "$prev_round" -ge 2 ]] && restore_status="AI Review 2"

            # Recover the ORIGINAL review's Slack root ts so this re-review threads
            # under it instead of starting a new root (Carol's request). The state
            # dir has one JSON per thread keyed by the review-1 root ts, each
            # carrying {repo, pr_number, thread_ts}. Pick the newest record matching
            # this repo/PR. Empty if none -> driver self-posts a fresh root.
            orig_thread_ts=""
            state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
            if [[ -d "$state_dir" ]]; then
                orig_thread_ts="$(
                    for sf in "$state_dir"/*.json; do
                        [[ -f "$sf" ]] || continue
                        jq -r --arg repo "$repo" --arg pr "$pr_number" '
                          select(.repo == $repo and ((.pr_number|tostring) == $pr))
                          | .thread_ts // empty' "$sf" 2>/dev/null
                    done | grep -E '.' | sort -n | tail -1
                )"
            fi

            if [[ "$dry_run" == "true" ]]; then
                log "  [dry-run] existing review (round ${prev_round}) -> would re-review; restore-on-no-change=${restore_status}; orig_thread=${orig_thread_ts:-<none>}"
                n_rereview=$((n_rereview + 1))
                continue
            fi

            out="$("${script_dir}/wiz_pr_rereview.sh" --board-trigger "$repo" "$pr_number" "$agent_type" "$orig_thread_ts" 2>&1)"
            action="$(echo "$out" | tail -1 | jq -r '.action // empty' 2>/dev/null)"
            if [[ "$action" == "no_changes" ]]; then
                n_nochange=$((n_nochange + 1))
                log "  re-review: no new commits — restoring status to ${restore_status}."
                gh pr comment "$pr_number" --repo "story-wizard/${repo}" \
                    --body "🤖 No new commits since the last AI review, so there's nothing to re-review. Push your changes and set the status to *${WIZ_QUEUE_STATUS}* again. Board status restored to *${restore_status}*." >/dev/null 2>&1 || true
                "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$restore_status" >/dev/null 2>&1 || true
            else
                n_rereview=$((n_rereview + 1))
                log "  re-review launched (driver set AI Review 2)."
            fi
            continue
        fi

        # --- gate 3: open + ready + no existing review -> fresh review ---
        if [[ "$dry_run" == "true" ]]; then
            log "  [dry-run] no existing review -> would flip AI Review 1 + fresh review."
            n_started=$((n_started + 1))
            continue
        fi
        # The driver itself sets status to "AI Review 1" (the atomic claim) and
        # self-posts the Slack root. We do NOT pre-flip here so a launch failure
        # leaves the driver's own failure handling (and status) authoritative.
        "${script_dir}/wiz_pr_review.sh" --board-trigger "$repo" "$pr_number" "$agent_type" >/dev/null 2>&1 \
            && { n_started=$((n_started + 1)); log "  fresh review launched."; } \
            || log "  fresh review driver returned non-zero (it posts its own failure)."
    done <<< "$queued"
fi

# ---- record the project updatedAt we just processed (skip-gate for next tick) ----
if [[ "$dry_run" == "false" && -n "$proj_updated" ]]; then
    jq -nc --arg u "$proj_updated" '{updatedAt:$u}' > "$WIZ_POLL_SEEN" 2>/dev/null || true
fi

jq -nc \
    --argjson total "$n_total" --argjson started "$n_started" \
    --argjson rereview "$n_rereview" --argjson nochange "$n_nochange" \
    --argjson draft "$n_draft" --argjson closed "$n_closed" --argjson skipped "$n_skipped" \
    --argjson build "$n_build" --argjson build_skip "$n_build_skip" \
    --argjson dry "$([[ "$dry_run" == "true" ]] && echo true || echo false)" \
    '{ok:true, action:"scanned", dry_run:$dry, queued_total:$total,
      started:$started, rereview:$rereview, no_changes:$nochange,
      draft:$draft, closed:$closed, skipped:$skipped,
      build:$build, build_skip:$build_skip}'
