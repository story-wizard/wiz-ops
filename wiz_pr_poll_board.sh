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
#        a per-PR build claim tracks the last built head; the first build is
#        automatic, while newer commits ask the author in Slack before rebuilding.
#        Ack + result go to BOTH the Slack review thread AND a PR comment.
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
# shellcheck source=_wiz_slack.sh
# Needed by the approval sweep, which posts the "Ready to Merge" notice itself
# (unlike the build path, which delegates Slack posting to wiz_pr_build.sh).
source "${script_dir}/_wiz_slack.sh" 2>/dev/null || true
# shellcheck source=wiz_pr_review_state.sh
source "${script_dir}/wiz_pr_review_state.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_review_state.sh"}'; exit 1; }

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

# ---- owner-token lock (prevent overlapping ticks; recover dead stale owner) ----
poll_lock_handle=""
acquire_lock() {
    poll_lock_handle="$(wiz_owner_lock_acquire "$WIZ_POLL_LOCK" "$WIZ_POLL_STALE_LOCK_SECS" 1)"
}
release_lock() { wiz_owner_lock_release "$poll_lock_handle"; }

# ---- approval sweep: approved PRs in a human review stage -> Ready to Merge ----
# Runs EVERY tick, independent of the updatedAt skip-gate below, because an
# approval happens on the PR (not the board) and does NOT bump projectV2.updatedAt.
# For each OPEN PR whose Status is one of WIZ_APPROVE_SOURCE_STATUSES, advance to
# WIZ_APPROVED_STATUS iff it has >=1 APPROVED review from a non-bot author and no
# standing CHANGES_REQUESTED, then notify the author (existing Slack thread, else
# a fresh root). The status flip is the idempotency claim. Sets n_approved.
n_approved=0
approval_sweep() {
    local dry="$1" repo pr_number

    for repo in $WIZ_VALID_REPOS; do
        local rj
        rj="$(gh api graphql -f query='
query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN, first:100){
      nodes{
        number
        author{ login }
        latestReviews(first:50){ nodes{ author{ login } state } }
        projectItems(first:10){
          nodes{
            project{ number }
            fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue { name } }
          }
        }
      }
    }
  }
}' -F owner="$WIZ_PROJECT_ORG" -F name="$repo" 2>/dev/null)"
        [[ -n "$rj" ]] || continue
        printf '%s' "$rj" | grep -q 'INSUFFICIENT_SCOPES\|"errors"' && continue

        # Emit "pr<TAB>author<TAB>status<TAB>approver_logins" for PRs that are
        # (a) in a source status on our project, (b) have >=1 non-bot APPROVED
        # review, (c) have NO standing CHANGES_REQUESTED. approver_logins is the
        # comma-joined set of non-bot authors whose CURRENT review is APPROVED —
        # this is who to credit, NOT the union of all reviewers/requested.
        local approved
        approved="$(printf '%s' "$rj" | jq -r \
            --argjson pnum "$WIZ_PROJECT_NUMBER" --arg srcs "$WIZ_APPROVE_SOURCE_STATUSES" '
          ($srcs | split("|")) as $srclist
          | .data.repository.pullRequests.nodes[]?
          | . as $pr
          | ([ .projectItems.nodes[]?
               | select(.project.number == $pnum and .fieldValueByName != null
                        and (.fieldValueByName.name as $s | $srclist | index($s)))
               | .fieldValueByName.name ] | first) as $status
          | select($status != null)
          | ([ .latestReviews.nodes[]? | select(.author.login != "wiz-maestro") ]) as $human
          | ([ $human[] | select(.state == "APPROVED") | .author.login ] | unique) as $approvers
          | (($approvers | length) > 0) as $has_appr
          | (any($human[]; .state == "CHANGES_REQUESTED")) as $has_block
          | select($has_appr and ($has_block | not))
          | [ ($pr.number|tostring), ($pr.author.login // ""), $status, ($approvers | join(",")) ] | @tsv
        ' 2>/dev/null)"
        [[ -n "$approved" ]] || continue

        while IFS=$'\t' read -r pr_number author status approver_logins; do
            [[ -n "$pr_number" ]] || continue
            if [[ "$dry" == "true" ]]; then
                log "PR ${repo}#${pr_number}: APPROVED in '${status}' by [${approver_logins}] -> [dry-run] would set '${WIZ_APPROVED_STATUS}' + notify author '${author}'."
                n_approved=$((n_approved + 1))
                continue
            fi
            log "PR ${repo}#${pr_number}: APPROVED in '${status}' by [${approver_logins}] -> ${WIZ_APPROVED_STATUS}; notifying."
            if "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$WIZ_APPROVED_STATUS" >/dev/null 2>&1; then
                approval_notify "$repo" "$pr_number" "$author" "$status" "$approver_logins"
                n_approved=$((n_approved + 1))
            else
                log "  approval: failed to set status -> ${WIZ_APPROVED_STATUS} (will retry next tick)."
            fi
        done <<< "$approved"
    done
}

# Post the "approved -> Ready to Merge" notice: into the existing Slack review
# thread if one is recorded, else a fresh root in the active channel. @-mentions
# the PR author (resolved via wiz_gh_to_slack) and names the ACTUAL approver(s).
approval_notify() {
    local repo="$1" pr_number="$2" author_login="$3" from_status="$4" approver_logins="$5"
    command -v wiz_slack_ready >/dev/null 2>&1 && wiz_slack_ready || { log "  approval: Slack not ready; status advanced, no notice."; return 0; }

    local pr_url="https://github.com/story-wizard/${repo}/pull/${pr_number}"
    local pr_title
    pr_title="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title --jq '.title' 2>/dev/null)"
    [[ -n "$pr_title" ]] || pr_title="PR #${pr_number}"

    # Recover the existing review thread (same lookup the build path uses).
    local thread_ts="" state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    if [[ -d "$state_dir" ]]; then
        thread_ts="$(
            for sf in "$state_dir"/*.json; do
                [[ -f "$sf" ]] || continue
                jq -r --arg repo "$repo" --arg pr "$pr_number" '
                  select(.repo == $repo and ((.pr_number|tostring) == $pr)) | .thread_ts // empty' "$sf" 2>/dev/null
            done | grep -E '.' | sort -n | tail -1
        )"
    fi

    local author_sid author_mention=""
    author_sid="$(wiz_gh_to_slack "$author_login" 2>/dev/null)"
    [[ -n "$author_sid" ]] && author_mention="<@${author_sid}> "

    # Name the ACTUAL approvers (from latestReviews==APPROVED, passed in), NOT the
    # full reviewer/requested-reviewer union. Resolve each login -> Slack mention;
    # dedupe; skip the author (self-approval is impossible but be safe) and any
    # unmapped/bot login (empty from wiz_gh_to_slack).
    local approvers="" seen=" " login sid
    local _oldifs="$IFS"; IFS=','
    for login in $approver_logins; do
        IFS="$_oldifs"
        [[ -n "$login" ]] || continue
        sid="$(wiz_gh_to_slack "$login" 2>/dev/null)"
        if [[ -n "$sid" ]]; then
            [[ "$seen" == *" ${sid} "* ]] && continue
            seen+="${sid} "
            approvers+="<@${sid}> "
        else
            # Unmapped login: fall back to the raw GitHub handle so credit is not lost.
            approvers+="${login} "
        fi
        IFS=','
    done
    IFS="$_oldifs"
    approvers="${approvers% }"

    local msg="✅ ${author_mention}*${pr_title}* (<${pr_url}>) has been **approved** and moved to *${WIZ_APPROVED_STATUS}* (from *${from_status}*)."
    [[ -n "$approvers" ]] && msg+=$'\n'"Approved by: ${approvers}"

    if [[ -n "$thread_ts" ]]; then
        wiz_slack_post "$WIZ_ACTIVE_CHANNEL" "$thread_ts" "$msg" >/dev/null 2>&1 || true
        log "  approval: notified in existing thread ${thread_ts}."
    else
        wiz_slack_post "$WIZ_ACTIVE_CHANNEL" "" "$msg" >/dev/null 2>&1 || true
        log "  approval: notified via new root (no existing thread)."
    fi
}

if [[ "$dry_run" == "false" ]]; then
    if ! acquire_lock; then
        log "another tick holds the lock; exiting."
        echo '{"ok":true,"action":"skipped_locked"}'
        exit 0
    fi
    trap release_lock EXIT
fi

# ---- approval sweep runs EVERY tick (before the updatedAt skip-gate) ----
# An approval is an off-board event that doesn't bump projectV2.updatedAt, so it
# must not be gated by the cheap skip below. Cheap enough (~1 call/repo).
approval_sweep "$dry_run"

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
        log "project unchanged since ${last_seen}; skipping board-status scan (approval sweep already ran)."
        jq -nc --argjson approved "$n_approved" '{ok:true, action:"skipped_unchanged", approved:$approved}'
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

n_total=0; n_started=0; n_rereview=0; n_nochange=0; n_draft=0; n_closed=0; n_skipped=0; n_build=0; n_build_skip=0; n_build_ask=0
defer_seen=false

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
            if ! "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$WIZ_BOARD_CLOSED_STATUS" >/dev/null 2>&1; then
                defer_seen=true
                log "  failed to clear closed PR status; retry checkpoint deferred."
            fi
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
            if ! "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$WIZ_BOARD_CLEAR_STATUS" >/dev/null 2>&1; then
                defer_seen=true
                log "  failed to clear draft PR status; retry checkpoint deferred."
            fi
            continue
        fi

        # --- gate 2.5: Functional Review -> tagged build (first auto; rebuilds ask) ---
        # A human moving a PR to WIZ_BUILD_STATUS wants an installable build to
        # test. Unlike the AI-review path we do NOT advance the status (the PR
        # stays in Functional Review), so idempotency comes from a per-PR CLAIM
        # keyed on the last successfully built head SHA:
        #   - no claim yet             -> auto-dispatch once (first FR build)
        #   - claim matches head       -> already built this commit; skip
        #   - claim behind head        -> NEW commits: do NOT auto-rebuild.
        #     Ask the PR author in the Slack review thread whether they want a
        #     new build; record asked_sha so we only ask once per new head.
        #     Author replies with a normal build trigger (bucket D: "tagged
        #     build" / "yes, rebuild" / "build it") to actually dispatch.
        # Ack + result go to BOTH Slack and a PR comment (wiz_pr_build.sh).
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
            asked_sha=""
            if [[ -f "$claim_file" ]]; then
                claimed_sha="$(jq -r '.head_sha // empty' "$claim_file" 2>/dev/null)"
                asked_sha="$(jq -r '.asked_sha // empty' "$claim_file" 2>/dev/null)"
            fi

            if [[ -n "$head_sha" && "$head_sha" == "$claimed_sha" ]]; then
                log "  build: already built head ${head_sha:0:8} — skipping (no new commits)."
                n_build_skip=$((n_build_skip + 1))
                continue
            fi

            # Recover the existing review's Slack root ts so asks/builds thread
            # under the SAME conversation (Carol's model).
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

            # --- rebuild path: claim exists for an older head -> ASK, don't auto-build ---
            if [[ -n "$claimed_sha" ]]; then
                if [[ -n "$head_sha" && "$head_sha" == "$asked_sha" ]]; then
                    log "  build: already asked about head ${head_sha:0:8} (last built ${claimed_sha:0:8}) — waiting for author."
                    n_build_skip=$((n_build_skip + 1))
                    continue
                fi
                if [[ "$dry_run" == "true" ]]; then
                    log "  [dry-run] Functional Review -> would ASK author about rebuild for head ${head_sha:0:8} (last built ${claimed_sha:0:8})."
                    n_build_ask=$((n_build_ask + 1))
                    continue
                fi
                # Resolve author + post the ask (threaded when possible).
                pr_author_login="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json author --jq '.author.login // empty' 2>/dev/null)"
                pr_title_b="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json title --jq '.title // empty' 2>/dev/null)"
                [[ -n "$pr_title_b" ]] || pr_title_b="PR #${pr_number}"
                pr_url_b="https://github.com/story-wizard/${repo}/pull/${pr_number}"
                author_mention=""
                if [[ -n "$pr_author_login" ]] && command -v wiz_gh_to_slack >/dev/null 2>&1; then
                    author_sid="$(wiz_gh_to_slack "$pr_author_login" 2>/dev/null)"
                    [[ -n "$author_sid" ]] && author_mention="<@${author_sid}> "
                fi
                ask_msg="🔄 ${author_mention}New commits landed on *${pr_title_b}* (<${pr_url_b}>) since the last tagged build."
                ask_msg+=$'\n'"Last built: \`${claimed_sha:0:8}\` → now: \`${head_sha:0:8}\`."
                ask_msg+=$'\n'"Want a **new installable build** of this head?"
                ask_msg+=$'\n'"Reply here with *yes, rebuild* / *tagged build* / *build it* and I'll generate one. (Say *no* / ignore to keep the existing build.)"
                ask_posted=false
                if command -v wiz_slack_ready >/dev/null 2>&1 && wiz_slack_ready; then
                    if [[ -n "$build_thread_ts" ]]; then
                        if wiz_slack_post "$WIZ_ACTIVE_CHANNEL" "$build_thread_ts" "$ask_msg" >/dev/null 2>&1; then
                            ask_posted=true
                            log "  build: asked author about rebuild head ${head_sha:0:8} in thread ${build_thread_ts}."
                        fi
                    else
                        if wiz_slack_post "$WIZ_ACTIVE_CHANNEL" "" "$ask_msg" >/dev/null 2>&1; then
                            ask_posted=true
                            log "  build: asked author about rebuild head ${head_sha:0:8} via new root (no review thread)."
                        fi
                    fi
                fi
                if [[ "$ask_posted" != "true" ]]; then
                    n_build_skip=$((n_build_skip + 1))
                    defer_seen=true
                    log "  build: could not deliver rebuild question for head ${head_sha:0:8}; not recording asked_sha, retrying next tick."
                    continue
                fi
                # Record asked_sha only after successful delivery. Keep head_sha
                # as the last successfully *built* SHA.
                prev_built_at="$(jq -r '.built_at // empty' "$claim_file" 2>/dev/null)"
                if ! mkdir -p "$claim_dir" 2>/dev/null \
                    || ! jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg sha "$claimed_sha" \
                        --arg asked "$head_sha" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                        --arg built_at "$prev_built_at" \
                        '{repo:$repo, pr_number:$pr, head_sha:$sha,
                          built_at:(if $built_at=="" then null else $built_at end),
                          asked_sha:$asked, asked_at:$at}' \
                        > "$claim_file" 2>/dev/null; then
                    n_build_skip=$((n_build_skip + 1)); defer_seen=true
                    log "  build: question delivered but asked_sha claim write failed; retry checkpoint deferred."
                    continue
                fi
                n_build_ask=$((n_build_ask + 1))
                continue
            fi

            # --- first build: no claim yet -> auto-dispatch ---
            if [[ "$dry_run" == "true" ]]; then
                log "  [dry-run] Functional Review -> would dispatch FIRST tagged build for head ${head_sha:0:8}."
                n_build=$((n_build + 1))
                continue
            fi

            # Dispatch. The driver refuses a develop-conflicting build (freshness
            # gate) and posts that refusal to Slack + PR itself, so we don't
            # pre-check here. Record the claim ONLY on a successful dispatch so a
            # failed/refused first build is retried next tick.
            if "${script_dir}/wiz_pr_build.sh" --board-trigger "$repo" "$pr_number" "$build_thread_ts" >/dev/null 2>&1; then
                mkdir -p "$claim_dir" 2>/dev/null || true
                jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg sha "$head_sha" \
                    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                    '{repo:$repo, pr_number:$pr, head_sha:$sha, built_at:$at, asked_sha:null, asked_at:null}' \
                    > "$claim_file" 2>/dev/null || true
                n_build=$((n_build + 1))
                log "  build: dispatched FIRST build for head ${head_sha:0:8}; claim recorded."
            else
                n_build_skip=$((n_build_skip + 1))
                defer_seen=true
                log "  build: driver returned non-zero (it posts its own failure/refusal); no claim recorded — will retry next tick."
            fi
            continue
        fi

        # --- open + ready: decide fresh vs re-review across BOTH parity agents ---
        existing_review=false
        for review_wt in "${HOME}/wizard/worktrees/${repo}/${repo}-pr-${pr_number}-"*; do
            [[ -d "$review_wt" ]] && { existing_review=true; break; }
        done

        if [[ "$existing_review" == "true" ]]; then
            # Canonical state carries the real round across separate Claude/Codex
            # autorun dirs. Bootstrap legacy Claude-only PRs on the first real run.
            review_sf="$(wiz_review_state_file "$repo" "$pr_number")"
            if [[ -s "$review_sf" ]]; then
                prev_round="$(jq -r '.round // 1' "$review_sf")"
                orig_thread_ts="$(jq -r '.thread_ts // empty' "$review_sf")"
            elif [[ "$dry_run" == "true" ]]; then
                # Dry-run promises no writes: infer the legacy round in memory.
                prev_round=1
                legacy_ar="${HOME}/wizard/worktrees/autorun/${repo}/${repo}-pr-${pr_number}-${WIZ_DEFAULT_AGENT_TYPE}"
                while [[ -d "${legacy_ar}/review_${prev_round}" ]]; do prev_round=$((prev_round + 1)); done
                orig_thread_ts="$(wiz_review_find_thread_ts "$repo" "$pr_number")"
            else
                review_sf="$(wiz_review_state_bootstrap "$repo" "$pr_number")"
                prev_round="$(jq -r '.round // 1' "$review_sf")"
                orig_thread_ts="$(jq -r '.thread_ts // empty' "$review_sf")"
            fi
            restore_status="AI Review 1"; [[ "$prev_round" -ge 2 ]] && restore_status="AI Review 2"
            next_round=$((prev_round + 1))
            next_agent="$WIZ_DEFAULT_AGENT_TYPE"
            [[ "${WIZ_REVIEW_ALTERNATE_AGENTS:-false}" == "true" ]] \
                && next_agent="$(wiz_review_agent_for_round "$next_round")"

            if [[ "$dry_run" == "true" ]]; then
                log "  [dry-run] existing review (round ${prev_round}) -> would launch round ${next_round} with ${next_agent}; restore-on-no-change=${restore_status}; orig_thread=${orig_thread_ts:-<none>}"
                n_rereview=$((n_rereview + 1))
                continue
            fi

            out="$("${script_dir}/wiz_pr_rereview.sh" --board-trigger "$repo" "$pr_number" "$next_agent" "$orig_thread_ts" 2>&1)"
            action="$(echo "$out" | tail -1 | jq -r '.action // empty' 2>/dev/null)"
            if [[ "$action" == "no_changes" ]]; then
                n_nochange=$((n_nochange + 1))
                log "  re-review: no new commits — restoring status to ${restore_status}."
                gh pr comment "$pr_number" --repo "story-wizard/${repo}" \
                    --body "🤖 No new commits since the last AI review, so there's nothing to re-review. Push your changes and set the status to *${WIZ_QUEUE_STATUS}* again. Board status restored to *${restore_status}*." >/dev/null 2>&1 || true
                if ! "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$restore_status" >/dev/null 2>&1; then
                    defer_seen=true
                    log "  no-change status restore failed; retry checkpoint deferred."
                fi
            elif [[ "$action" == "busy" ]]; then
                n_skipped=$((n_skipped + 1))
                defer_seen=true
                log "  re-review: another launch is already preparing; leaving queue status for the next tick."
            elif [[ "$action" == "rereview" ]]; then
                n_rereview=$((n_rereview + 1))
                launched_agent="$(echo "$out" | tail -1 | jq -r '.agent_type // "unknown"' 2>/dev/null)"
                launched_round="$(echo "$out" | tail -1 | jq -r '.review_round // "?"' 2>/dev/null)"
                log "  re-review round ${launched_round} launched with ${launched_agent} (driver set AI Review 2)."
            else
                n_skipped=$((n_skipped + 1))
                log "  re-review launch failed (action=${action:-unknown}) — restoring status to ${restore_status} to avoid a retry storm."
                if ! "${script_dir}/wiz_pr_set_status.sh" "$repo" "$pr_number" "$restore_status" >/dev/null 2>&1; then
                    defer_seen=true
                    log "  failed-launch status restore failed; retry checkpoint deferred."
                fi
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
        agent_type="$WIZ_DEFAULT_AGENT_TYPE"
        [[ "${WIZ_REVIEW_ALTERNATE_AGENTS:-false}" == "true" ]] \
            && agent_type="$(wiz_review_agent_for_round 1)"
        fresh_out="$("${script_dir}/wiz_pr_review.sh" --board-trigger "$repo" "$pr_number" "$agent_type" 2>&1)"
        fresh_rc=$?
        fresh_action="$(printf '%s\n' "$fresh_out" | tail -1 | jq -r '.action // empty' 2>/dev/null)"
        if [[ $fresh_rc -eq 0 && "$fresh_action" == "review" ]]; then
            n_started=$((n_started + 1)); log "  fresh review launched."
        elif [[ $fresh_rc -eq 0 && "$fresh_action" == "busy" ]]; then
            n_skipped=$((n_skipped + 1)); defer_seen=true
            log "  fresh review: another launch is already preparing; leaving queue status for the next tick."
        else
            n_skipped=$((n_skipped + 1)); defer_seen=true
            log "  fresh review driver returned non-zero or no launch (it posts its own failure)."
        fi
    done <<< "$queued"
fi

# ---- record the project updatedAt we just processed (skip-gate for next tick) ----
if [[ "$dry_run" == "false" && "$defer_seen" != "true" && -n "$proj_updated" ]]; then
    jq -nc --arg u "$proj_updated" '{updatedAt:$u}' > "$WIZ_POLL_SEEN" 2>/dev/null || true
fi

jq -nc \
    --argjson total "$n_total" --argjson started "$n_started" \
    --argjson rereview "$n_rereview" --argjson nochange "$n_nochange" \
    --argjson draft "$n_draft" --argjson closed "$n_closed" --argjson skipped "$n_skipped" \
    --argjson build "$n_build" --argjson build_skip "$n_build_skip" \
    --argjson build_ask "$n_build_ask" \
    --argjson approved "$n_approved" \
    --argjson dry "$([[ "$dry_run" == "true" ]] && echo true || echo false)" \
    '{ok:true, action:"scanned", dry_run:$dry, queued_total:$total,
      started:$started, rereview:$rereview, no_changes:$nochange,
      draft:$draft, closed:$closed, skipped:$skipped,
      build:$build, build_skip:$build_skip, build_ask:$build_ask, approved:$approved}'
