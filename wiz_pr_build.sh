#!/bin/bash

# wiz_pr_build.sh — Dispatch a tagged build of a PR via the wizard-release
# "Build and Release" workflow (build-release.yml), using the PR's branch as the
# appropriate *_ref and inferring the wizard-core branch from .github/wizard-core-ref.
#
# Two modes:
#   --resolve-only : resolve the three refs + release_tag and print them as JSON.
#                    NO side effects (no tag delete, no dispatch, no Slack). The
#                    skill uses this to build the confirmation message it shows
#                    the user before committing.
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
#   wiz_pr_build.sh [--resolve-only] [--x86] \
#       [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] \
#       <repo> <pr_number> <release_tag> [thread_ts]
#
# <release_tag> is the full tag WITHOUT the leading 'v' (release.yml prepends it),
# e.g. "clip-scaling-policy-wizard-609" -> git tag "vclip-scaling-policy-wizard-609".
# The skill crafts the human-meaningful slug; this script treats it as opaque.
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
    jq -nc --arg repo "${repo:-}" --arg pr "${pr_number:-}" --arg stage "$stage" --arg msg "$msg" \
        '{ok:false, repo:$repo, pr_number:$pr, stage:$stage, message:$msg}'
    exit 1
}

# ---- parse flags + positionals ----
resolve_only=false
build_x86=false
ov_wizard=""; ov_core=""; ov_ai=""
args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --resolve-only) resolve_only=true; shift ;;
        --x86) build_x86=true; shift ;;
        --wizard-ref) ov_wizard="${2:-}"; shift 2 ;;
        --wizard-core-ref) ov_core="${2:-}"; shift 2 ;;
        --wizard-ai-ref) ov_ai="${2:-}"; shift 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
set -- "${args[@]}"

[[ $# -ge 3 && $# -le 4 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_build.sh [--resolve-only] [--x86] [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R] <repo> <pr_number> <release_tag> [thread_ts]"}'; exit 1; }
repo="$1"; pr_number="$2"; release_tag="$3"; thread_ts="${4:-}"

command -v jq >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
command -v gh >/dev/null 2>&1 || post_fail "deps" "gh not found"
[[ "$pr_number" =~ ^[0-9]+$ ]] || post_fail "args" "PR number must be numeric, got '${pr_number}'"
case "$repo" in
    wizard|wizard-ai|wizard-core) : ;;
    wizard-release|wizard-spec) post_fail "args" "repo '${repo}' cannot drive a wizard app build" ;;
    *) post_fail "args" "invalid repo '${repo}'" ;;
esac
# release_tag must be a valid-ish git tag fragment (no spaces / weird chars)
[[ "$release_tag" =~ ^[A-Za-z0-9._-]+$ ]] || post_fail "args" "release_tag '${release_tag}' has invalid characters (use letters, digits, . _ -)"

# ---- look up the PR head branch ----
pr_branch="$(gh pr view "$pr_number" --repo "story-wizard/${repo}" --json headRefName --jq '.headRefName' 2>&1)" \
    || post_fail "pr_lookup" "PR #${pr_number} not found in story-wizard/${repo}: ${pr_branch}"
[[ -n "$pr_branch" && "$pr_branch" != "null" ]] || post_fail "pr_lookup" "could not determine head branch for PR #${pr_number}"

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

# ---- resolve-only: emit the resolved plan and stop (no side effects) ----
if [[ "$resolve_only" == "true" ]]; then
    jq -nc \
        --arg repo "$repo" --arg pr "$pr_number" --arg branch "$pr_branch" \
        --arg tag "$release_tag" --arg gtag "$git_tag" \
        --arg wr "$wizard_ref" --arg wcr "$wizard_core_ref" --arg war "$wizard_ai_ref" \
        --argjson x86 "$build_x86" --arg url "$release_url" \
        '{ok:true, mode:"resolve", repo:$repo, pr_number:$pr, pr_branch:$branch,
          release_tag:$tag, git_tag:$gtag, wizard_ref:$wr, wizard_core_ref:$wcr,
          wizard_ai_ref:$war, build_x86_64:$x86, release_url:$url}'
    exit 0
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
log_dir="${HOME}/wizard/tmp/wiz-pr-logs"; mkdir -p "$log_dir"
watch_log="${log_dir}/build-${repo}-pr-${pr_number}-$(date +%Y%m%d-%H%M%S).log"
nohup "${script_dir}/wiz_pr_build_watch.sh" \
    "$repo" "$pr_number" "$git_tag" "$release_url" "$dispatch_at" "$thread_ts" \
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

# ---- summary JSON ----
jq -nc \
    --arg repo "$repo" --arg pr "$pr_number" --arg branch "$pr_branch" \
    --arg tag "$release_tag" --arg gtag "$git_tag" \
    --arg wr "$wizard_ref" --arg wcr "$wizard_core_ref" --arg war "$wizard_ai_ref" \
    --argjson x86 "$build_x86" --arg existing "$existing" \
    --arg pid "$watcher_pid" --arg wlog "$watch_log" --arg url "$release_url" --arg ch "$dest_channel" \
    '{ok:true, mode:"dispatch", repo:$repo, pr_number:$pr, pr_branch:$branch,
      release_tag:$tag, git_tag:$gtag, wizard_ref:$wr, wizard_core_ref:$wcr,
      wizard_ai_ref:$war, build_x86_64:$x86, prior_release:$existing,
      watcher_pid:$pid, watcher_log:$wlog, release_url:$url, posted_to:$ch}'
