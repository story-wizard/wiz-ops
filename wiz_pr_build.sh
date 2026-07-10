#!/bin/bash

# wiz_pr_build.sh — Dispatch a tagged build of a PR via the wizard-release
# "Build and Release" workflow (build-release.yml), using the PR's branch as the
# appropriate *_ref and inferring the wizard-core branch from .github/wizard-core-ref.
#
# Modes:
#   --resolve-only : resolve the three refs + release_tag and print them as JSON.
#                    NO side effects (no tag delete, no dispatch, no Slack). The
#                    skill uses this to build the confirmation message it shows
#                    the user before committing.
#   --board-trigger: board-driven (Functional Review) build. There is no Slack
#                    trigger message and no human-crafted tag, so the driver
#                    AUTO-GENERATES the release_tag from the PR title, SELF-POSTS
#                    a Slack lifecycle root, and mirrors the kickoff ack (and any
#                    failure) to BOTH the Slack thread AND a PR comment. In this
#                    mode <release_tag> is omitted from the args.
#   (default)      : delete any existing release/tag for this build, dispatch the
#                    workflow, post a threaded ack, and launch the detached watcher.
#
# Ref routing:
#   - wizard PR     -> wizard_ref = PR branch;  wizard_core_ref = inferred;  wizard_ai_ref = develop
#   - wizard-ai PR  -> wizard_ai_ref = PR branch; wizard_core_ref = inferred; wizard_ref = develop
#   - wizard-core PR-> wizard_core_ref = PR branch; wizard_ref = develop; wizard_ai_ref = develop
# "inferred" = read .github/wizard-core-ref from the PR branch; if it is anything
# other than 'develop', use it; else 'develop'. (Only consulted for wizard / wizard-ai PRs.)
#
# Overrides (applied after routing, so the skill can honor user edits from the
# confirmation): --wizard-ref R  --wizard-core-ref R  --wizard-ai-ref R
#
# Usage:
#   wiz_pr_build.sh [--resolve-only] [--x86] [--force] \
#       [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] \
#       <repo> <pr_number> <release_tag> [thread_ts]
#   wiz_pr_build.sh --board-trigger [--x86] [--force] \
#       [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] \
#       <repo> <pr_number> [thread_ts]           # release_tag auto-generated
#
# <release_tag> is the full tag WITHOUT the leading 'v' (release.yml prepends it),
# e.g. "clip-scaling-policy-wizard-609" -> git tag "vclip-scaling-policy-wizard-609".
# The skill crafts the human-meaningful slug; this script treats it as opaque.
# In --board-trigger mode the script derives it from the PR title instead.
#
# Prints one JSON summary line to stdout.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wiz_pr_pipeline.env
source "${script_dir}/wiz_pr_pipeline.env" || { echo '{"ok":false,"stage":"config","message":"cannot source wiz_pr_pipeline.env"}'; exit 1; }
# shellcheck source=_wiz_slack.sh
source "${script_dir}/_wiz_slack.sh" || { echo '{"ok":false,"stage":"config","message":"cannot source _wiz_slack.sh"}'; exit 1; }

dest_channel="${WIZ_ACTIVE_CHANNEL}"
RELEASE_REPO="story-wizard/wizard-release"
BUILD_WORKFLOW="build-release.yml"

post_fail() {
    local stage="$1" msg="$2" text
    text="❌ *Tagged build failed* for \`story-wizard/${repo:-?}\` PR #${pr_number:-?} at stage *${stage}*."$'\n'"\`\`\`"$'\n'"${msg}"$'\n'"\`\`\`"
    # Only post to Slack in real (non --resolve-only) mode.
    if [[ "${resolve_only:-false}" != "true" ]] && wiz_slack_ready; then
        wiz_slack_post "$dest_channel" "${thread_ts:-}" "$text" >/dev/null || true
    fi
    # Board-driven builds ALSO surface the failure as a PR comment (the reviewer
    # who set the board status may not be watching Slack). Best-effort.
    if [[ "${board_trigger:-false}" == "true" && "${resolve_only:-false}" != "true" && -n "${repo:-}" && -n "${pr_number:-}" ]]; then
        gh pr comment "$pr_number" --repo "story-wizard/${repo}" \
            --body "🤖 Tagged build **failed** at stage \`${stage}\`."$'\n'"\`\`\`"$'\n'"${msg}"$'\n'"\`\`\`" >/dev/null 2>&1 || true
    fi
    jq -nc --arg repo "${repo:-}" --arg pr "${pr_number:-}" --arg stage "$stage" --arg msg "$msg" \
        '{ok:false, repo:$repo, pr_number:$pr, stage:$stage, message:$msg}'
    exit 1
}

# ---- parse flags + positionals ----
resolve_only=false
build_x86=false
force=false
board_trigger=false
ov_wizard=""; ov_core=""; ov_ai=""
args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --resolve-only) resolve_only=true; shift ;;
        --x86) build_x86=true; shift ;;
        --force) force=true; shift ;;
        --board-trigger) board_trigger=true; shift ;;
        --wizard-ref) ov_wizard="${2:-}"; shift 2 ;;
        --wizard-core-ref) ov_core="${2:-}"; shift 2 ;;
        --wizard-ai-ref) ov_ai="${2:-}"; shift 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
set -- "${args[@]}"

if [[ "$board_trigger" == "true" ]]; then
    # Board mode: <repo> <pr_number> [thread_ts] — release_tag is auto-generated.
    [[ $# -ge 2 && $# -le 3 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_build.sh --board-trigger [--x86] [--force] [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] <repo> <pr_number> [thread_ts]"}'; exit 1; }
    repo="$1"; pr_number="$2"; release_tag=""; thread_ts="${3:-}"
else
    [[ $# -ge 3 && $# -le 4 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_build.sh [--resolve-only] [--x86] [--force] [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] <repo> <pr_number> <release_tag> [thread_ts]"}'; exit 1; }
    repo="$1"; pr_number="$2"; release_tag="$3"; thread_ts="${4:-}"
fi

command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
command -v gh >/dev/null 2>&1 || post_fail "deps" "gh not found"
[[ "$pr_number" =~ ^[0-9]+$ ]] || post_fail "args" "PR number must be numeric, got '${pr_number}'"
case "$repo" in
    wizard|wizard-ai|wizard-core) : ;;
    wizard-release|wizard-spec) post_fail "args" "repo '${repo}' cannot drive a wizard app build" ;;
    *) post_fail "args" "invalid repo '${repo}'" ;;
esac
# ---- look up the PR head branch (+ title, needed for a board-generated tag) ----
pr_meta="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json headRefName,title 2>&1)" \
    || post_fail "pr_lookup" "PR #${pr_number} not found in story-wizard/${repo}: ${pr_meta}"
pr_branch="$(printf '%s' "$pr_meta" | jq -r '.headRefName // empty' 2>/dev/null)"
pr_title="$(printf '%s' "$pr_meta" | jq -r '.title // empty' 2>/dev/null)"
[[ -n "$pr_branch" && "$pr_branch" != "null" ]] || post_fail "pr_lookup" "could not determine head branch for PR #${pr_number}"

# ---- board mode: auto-generate the release_tag from the PR title ----
# Slug = lowercase title, non-alphanumerics -> '-', collapsed/trimmed, capped to
# a sane length, then suffixed with -<repo>-<pr> (matching the skill's manual
# convention). Falls back to a plain repo-pr slug if the title yields nothing.
if [[ "$board_trigger" == "true" ]]; then
    slug="$(printf '%s' "$pr_title" \
        | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
        | cut -c1-40 | sed -E 's/-+$//')"
    [[ -n "$slug" ]] && release_tag="${slug}-${repo}-${pr_number}" || release_tag="${repo}-${pr_number}"
fi

# release_tag must be a valid-ish git tag fragment (no spaces / weird chars)
[[ "$release_tag" =~ ^[A-Za-z0-9._-]+$ ]] || post_fail "args" "release_tag '${release_tag}' has invalid characters (use letters, digits, . _ -)"

# ---- infer the wizard-core branch from .github/wizard-core-ref on the PR branch ----
# Only meaningful for wizard / wizard-ai PRs (wizard-core PRs ARE the core branch).
infer_core_ref() {
    local src_repo="$1" branch="$2" val
    val="$(gh api "repos/story-wizard/${src_repo}/contents/.github/wizard-core-ref?ref=${branch}" \
        --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | tr -d '[:space:]')"
    [[ -n "$val" ]] && printf '%s' "$val" || printf 'develop'
}

# ---- route refs by repo ----
wizard_ref="develop"; wizard_core_ref="develop"; wizard_ai_ref="develop"
case "$repo" in
    wizard)
        wizard_ref="$pr_branch"
        wizard_core_ref="$(infer_core_ref wizard "$pr_branch")"
        ;;
    wizard-ai)
        wizard_ai_ref="$pr_branch"
        wizard_core_ref="$(infer_core_ref wizard-ai "$pr_branch")"
        ;;
    wizard-core)
        wizard_core_ref="$pr_branch"
        ;;
esac

# ---- apply explicit overrides (user edits from the confirmation) ----
[[ -n "$ov_wizard" ]] && wizard_ref="$ov_wizard"
[[ -n "$ov_core"   ]] && wizard_core_ref="$ov_core"
[[ -n "$ov_ai"     ]] && wizard_ai_ref="$ov_ai"

git_tag="v${release_tag}"
release_url="https://github.com/${RELEASE_REPO}/releases/tag/${git_tag}"

# ---- freshness gate: are the resolved refs up-to-date with develop? ----
# HARD backstop. Step 1.5 of the skill asks the agent to run wiz_pr_freshness.sh
# and surface staleness in the confirmation — but a stale/long-running session
# can carry an old copy of the skill that lacks that step (exactly how PR #751,
# CONFLICTING against develop, still got dispatched). So the driver itself
# re-checks and REFUSES to dispatch a build whose branch would conflict with
# develop, unless --force is given. This gate lives in code, not prose, so no
# session can skip it. Best-effort: if the check errors, we log and proceed
# (never block a build on the checker breaking).
freshness_json='{}'
freshness_conflict=false
freshness_conflict_refs=""
if [[ -x "${script_dir}/wiz_pr_freshness.sh" ]]; then
    freshness_json="$("${script_dir}/wiz_pr_freshness.sh" check \
        --wizard-ref "$wizard_ref" --wizard-core-ref "$wizard_core_ref" --wizard-ai-ref "$wizard_ai_ref" 2>/dev/null)"
    # Guard: if the checker produced nothing parseable, fall back to {} so the
    # resolve-only emit's --argjson never breaks and the build is not blocked.
    printf '%s' "$freshness_json" | jq -e . >/dev/null 2>&1 || freshness_json='{}'
    if printf '%s' "$freshness_json" | jq -e '.any_behind_conflict == true' >/dev/null 2>&1; then
        freshness_conflict=true
        freshness_conflict_refs="$(printf '%s' "$freshness_json" \
            | jq -r '[.refs[] | select(.status=="behind_conflict")
                     | "\(.repo)@\(.ref) (behind \(.behind); conflicts: \(.conflicts|join(", ")))"] | join("; ")' 2>/dev/null)"
    fi
fi

# ---- resolve-only: emit the resolved plan (+ freshness) and stop (no side effects) ----
if [[ "$resolve_only" == "true" ]]; then
    jq -nc \
        --arg repo "$repo" --arg pr "$pr_number" --arg branch "$pr_branch" \
        --arg tag "$release_tag" --arg gtag "$git_tag" \
        --arg wr "$wizard_ref" --arg wcr "$wizard_core_ref" --arg war "$wizard_ai_ref" \
        --argjson x86 "$build_x86" --arg url "$release_url" \
        --argjson fresh "${freshness_json:-null}" \
        '{ok:true, mode:"resolve", repo:$repo, pr_number:$pr, pr_branch:$branch,
          release_tag:$tag, git_tag:$gtag, wizard_ref:$wr, wizard_core_ref:$wcr,
          wizard_ai_ref:$war, build_x86_64:$x86, release_url:$url, freshness:$fresh}'
    exit 0
fi

# ---- HARD block: refuse a conflicting build unless explicitly forced ----
if [[ "$freshness_conflict" == "true" && "$force" != "true" ]]; then
    post_fail "freshness" "Refusing to build: branch conflicts with develop and must be reconciled first — ${freshness_conflict_refs}. The author needs to merge/rebase develop into the branch and resolve the conflicts, then re-request the build. (Override with --force to build the stale branch anyway.)"
fi

# ---- board-trigger: self-post the Slack lifecycle root and thread under it ----
# No Slack trigger message exists in board mode, so create one (mirrors
# wiz_pr_review.sh). Its ts becomes the thread_ts the ack/watcher post under. If
# the poller already recovered an existing review thread and passed it as
# thread_ts, we thread under THAT instead of opening a new root (Carol's model:
# continue the same thread). We also drop a kickoff comment on the PR itself.
if [[ "$board_trigger" == "true" ]]; then
    if [[ -z "$thread_ts" ]] && wiz_slack_ready; then
        root_msg="🛠️ Tagged build starting for *${pr_title}* (<https://github.com/story-wizard/${repo}/pull/${pr_number}>) — triggered from the project board (*${WIZ_BUILD_STATUS}*)."
        root_ts="$(wiz_slack_post "$dest_channel" "" "$root_msg" 2>/dev/null)"
        [[ -n "$root_ts" ]] && thread_ts="$root_ts"
    fi
fi

# ---- delete any existing release/tag for this build (no --clobber on tagged path) ----
existing="deleted_none"
if gh release view "$git_tag" --repo "$RELEASE_REPO" >/dev/null 2>&1; then
    if gh release delete "$git_tag" --repo "$RELEASE_REPO" --cleanup-tag --yes >/dev/null 2>&1; then
        existing="deleted_existing"
    else
        post_fail "delete_existing" "an existing release/tag '${git_tag}' is present but could not be deleted"
    fi
fi

# ---- dispatch the workflow ----
dispatch_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
disp_out="$(gh workflow run "$BUILD_WORKFLOW" --repo "$RELEASE_REPO" \
    -f "release_tag=${release_tag}" \
    -f "wizard_ref=${wizard_ref}" \
    -f "wizard_core_ref=${wizard_core_ref}" \
    -f "wizard_ai_ref=${wizard_ai_ref}" \
    -f "build_x86_64=${build_x86}" 2>&1)"
disp_rc=$?
[[ $disp_rc -eq 0 ]] || post_fail "dispatch" "gh workflow run failed (rc=${disp_rc}): ${disp_out}"

# ---- launch the detached watcher ----
# 7th arg tells the watcher this is a board-driven build, so it mirrors the
# finished-build result (release link + install command) to a PR comment too.
log_dir="${HOME}/wizard/tmp/wiz-pr-logs"; mkdir -p "$log_dir"
watch_log="${log_dir}/build-${repo}-pr-${pr_number}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_build_watch.sh" \
    "$repo" "$pr_number" "$git_tag" "$release_url" "$dispatch_at" "$thread_ts" "$board_trigger" \
    >"$watch_log" 2>&1 &
watcher_pid=$!
disown "$watcher_pid" 2>/dev/null || true

# ---- post the threaded ack ----
ack="🛠️ *Tagged build dispatched* for *story-wizard/${repo}* PR #${pr_number} → tag \`${git_tag}\`."
ack+=$'\n'"• wizard: \`${wizard_ref}\`  • wizard-core: \`${wizard_core_ref}\`  • wizard-ai: \`${wizard_ai_ref}\`"
[[ "$build_x86" == "true" ]] && ack+=$'\n'"• also building x86_64 (Rosetta)"
[[ "$existing" == "deleted_existing" ]] && ack+=$'\n'"_(replaced an existing build with the same tag)_"
ack+=$'\n'"Build takes ~10–13 min; I'll post the release link here when it's done. <https://github.com/${RELEASE_REPO}/actions/workflows/${BUILD_WORKFLOW}|Watch the run>"
if wiz_slack_ready; then
    wiz_slack_post "$dest_channel" "${thread_ts:-}" "$ack" >/dev/null || true
fi

# ---- board-trigger: mirror the kickoff ack to a PR comment ----
# The reviewer who set the board status may not be in Slack. GitHub markdown, not
# Slack mrkdwn, so use ** ** / backticks and a plain link.
if [[ "$board_trigger" == "true" ]]; then
    pr_ack="🛠️ **Tagged build dispatched** for \`story-wizard/${repo}\` PR #${pr_number} → tag \`${git_tag}\`."$'\n'
    pr_ack+="- wizard: \`${wizard_ref}\`  •  wizard-core: \`${wizard_core_ref}\`  •  wizard-ai: \`${wizard_ai_ref}\`"$'\n'
    [[ "$build_x86" == "true" ]] && pr_ack+="- also building x86_64 (Rosetta)"$'\n'
    pr_ack+="Build takes ~10–13 min; I'll add the release link + install command here when it's done. [Watch the run](https://github.com/${RELEASE_REPO}/actions/workflows/${BUILD_WORKFLOW})."
    gh pr comment "$pr_number" --repo "story-wizard/${repo}" --body "$pr_ack" >/dev/null 2>&1 || true
fi

# ---- update Functional Review build claim (board or Slack-triggered rebuild) ----
# The poller keys rebuild-asks on last built head_sha / asked_sha. Any successful
# dispatch (including an author "yes, rebuild" via bucket D) should record the
# current PR head as built and clear a pending ask so we don't re-prompt.
claim_dir="${WIZ_BUILD_CLAIM_DIR:-${HOME}/wizard/tmp/wiz-pr-build-claims}"
claim_file="${claim_dir}/${repo}-${pr_number}.json"
head_now="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json headRefOid --jq '.headRefOid // empty' 2>/dev/null)"
if [[ -n "$head_now" ]]; then
    mkdir -p "$claim_dir" 2>/dev/null || true
    jq -nc --arg repo "$repo" --arg pr "$pr_number" --arg sha "$head_now" \
        --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{repo:$repo, pr_number:$pr, head_sha:$sha, built_at:$at, asked_sha:null, asked_at:null}' \
        > "$claim_file" 2>/dev/null || true
fi

# ---- summary JSON ----
jq -nc \
    --arg repo "$repo" --arg pr "$pr_number" --arg branch "$pr_branch" \
    --arg tag "$release_tag" --arg gtag "$git_tag" \
    --arg wr "$wizard_ref" --arg wcr "$wizard_core_ref" --arg war "$wizard_ai_ref" \
    --argjson x86 "$build_x86" --arg existing "$existing" \
    --argjson board "$board_trigger" \
    --arg pid "$watcher_pid" --arg wlog "$watch_log" --arg url "$release_url" --arg ch "$dest_channel" \
    '{ok:true, mode:"dispatch", repo:$repo, pr_number:$pr, pr_branch:$branch,
      release_tag:$tag, git_tag:$gtag, wizard_ref:$wr, wizard_core_ref:$wcr,
      wizard_ai_ref:$war, build_x86_64:$x86, prior_release:$existing, board_trigger:$board,
      watcher_pid:$pid, watcher_log:$wlog, release_url:$url, posted_to:$ch}'
