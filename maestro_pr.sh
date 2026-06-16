#!/bin/bash

# maestro_pr.sh — Set up a PR review worktree with Maestro autorun playbooks.
#
# Usage: maestro_pr.sh [--no-run] [--draft-ok] <repo> <pr_number> [agent_type]
#
# Delegates worktree, autorun-dir, and agent creation to ./maestro_wt.sh,
# then layers in the PR-specific bits: playbook copy, PR-URL substitution,
# `gh pr checkout`, and the auto-run launch.

VALID_REPOS=(wizard wizard-ai wizard-core wizard-release wizard-spec)
VALID_AGENT_TYPES=(claude-code codex opencode)
PLAYBOOKS_SOURCE="${HOME}/src/Maestro-Playbooks/Development/Code-Review"

# GitHub fallback for the Code Review playbooks, used when PLAYBOOKS_SOURCE is
# not checked out locally. Mirrors:
#   https://github.com/RunMaestro/Maestro-Playbooks/tree/main/Development/Code-Review
PLAYBOOKS_GH_REPO="RunMaestro/Maestro-Playbooks"
PLAYBOOKS_GH_REF="main"
PLAYBOOKS_GH_PATH="Development/Code-Review"

script_dir="$(cd "$(dirname "$0")" && pwd)"
MAESTRO_WT="${script_dir}/maestro_wt.sh"

# Resolve maestro_cli (and MAESTRO_USER_DATA when appropriate); sources .env.
# shellcheck source=_maestro_env.sh
source "${script_dir}/_maestro_env.sh"

format_options() {
    local formatted=""
    local option

    for option in "$@"; do
        if [[ -n "$formatted" ]]; then
            formatted+=", "
        fi
        formatted+="$option"
    done

    printf '%s' "$formatted"
}

usage() {
    cat <<EOF
Usage: $(basename "$0") [--no-run] [--draft-ok] <repo> <pr_number> [agent_type]

Set up a PR review worktree with Maestro autorun playbooks.

Arguments:
    repo        Repository name. Valid options: $(format_options "${VALID_REPOS[@]}")
    pr_number   Pull request number (numeric)
    agent_type  Optional Maestro agent type.
                Valid options: $(format_options "${VALID_AGENT_TYPES[@]}"). Default: claude-code

Options:
  -h, --help    Show this help message and exit
  --no-run      Set up the agent but skip the final auto-run launch
  --draft-ok    Allow reviewing draft PRs (skip the draft check)

Examples:
  $(basename "$0") wizard-core 209
  $(basename "$0") wizard 42
  $(basename "$0") wizard-ai 101 codex
  $(basename "$0") --no-run wizard-core 209
  $(basename "$0") --draft-ok wizard-core 209
EOF
}

die() {
    echo "Error: $*" >&2
    exit 1
}

# Download all Code Review playbook *.md files from GitHub into $1.
# Used when the local PLAYBOOKS_SOURCE checkout is unavailable.
fetch_playbooks_from_github() {
    local dest="$1"
    local listing name url

    echo "Local playbooks not found; fetching from github.com/${PLAYBOOKS_GH_REPO} (${PLAYBOOKS_GH_PATH})..." >&2

    # List directory contents via the GitHub API: "<name>\t<download_url>" per .md file.
    listing=$(gh api "repos/${PLAYBOOKS_GH_REPO}/contents/${PLAYBOOKS_GH_PATH}?ref=${PLAYBOOKS_GH_REF}" \
        --jq '.[] | select(.type == "file" and (.name | endswith(".md"))) | "\(.name)\t\(.download_url)"' 2>&1) \
        || die "Failed to list playbooks from GitHub:\n${listing}"

    [[ -n "$listing" ]] || die "No playbook .md files found at ${PLAYBOOKS_GH_REPO}/${PLAYBOOKS_GH_PATH}"

    while IFS=$'\t' read -r name url; do
        [[ -n "$name" && -n "$url" ]] || continue
        gh api "$url" > "${dest}/${name}" \
            || die "Failed to download playbook '${name}' from GitHub"
    done <<< "$listing"
}

# ---------- argument parsing ----------

if [[ $# -eq 0 || "$1" == "-h" || "$1" == "--help" ]]; then
    usage
    exit 0
fi

# Parse optional flags before positional arguments
no_run=false
draft_ok=false
args=()
for arg in "$@"; do
    case "$arg" in
        --no-run)   no_run=true ;;
        --draft-ok) draft_ok=true ;;
        *) args+=("$arg") ;;
    esac
done
set -- "${args[@]}"

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "Error: Expected 2 or 3 arguments, got $#." >&2
    usage >&2
    exit 1
fi

repo="$1"
pr_number="$2"
agent_type="${3:-claude-code}"

# Validate repo name (also checked by maestro_wt.sh, but we need it here for the PR fetch)
repo_valid=false
for valid_repo in "${VALID_REPOS[@]}"; do
    if [[ "$repo" == "$valid_repo" ]]; then
        repo_valid=true
        break
    fi
done

if [[ "$repo_valid" != "true" ]]; then
    valid_options=$(format_options "${VALID_REPOS[@]}")
    die "Invalid repo '${repo}'. Valid options: ${valid_options}"
fi

# Validate PR number is numeric
[[ "$pr_number" =~ ^[0-9]+$ ]] || die "PR number must be numeric, got '${pr_number}'"

# Validate agent type up front so a typo doesn't waste a gh call
agent_type_valid=false
for valid_agent_type in "${VALID_AGENT_TYPES[@]}"; do
    if [[ "$agent_type" == "$valid_agent_type" ]]; then
        agent_type_valid=true
        break
    fi
done

if [[ "$agent_type_valid" != "true" ]]; then
    valid_options=$(format_options "${VALID_AGENT_TYPES[@]}")
    die "Invalid agent type '${agent_type}'. Valid options: ${valid_options}"
fi

# ---------- validate PR ----------

echo "Validating PR #${pr_number} in story-wizard/${repo}..."

pr_json=$(gh pr view "$pr_number" \
    --repo "story-wizard/${repo}" \
    --json state,isDraft,headRefName 2>&1) \
    || die "PR #${pr_number} not found in story-wizard/${repo}:\n${pr_json}"

pr_state=$(echo "$pr_json" | jq -r '.state')
pr_is_draft=$(echo "$pr_json" | jq -r '.isDraft')
pr_head_ref=$(echo "$pr_json" | jq -r '.headRefName')
[[ -n "$pr_head_ref" && "$pr_head_ref" != "null" ]] \
    || die "Could not determine head branch for PR #${pr_number}"

[[ "$pr_state" == "OPEN" ]] \
    || die "PR #${pr_number} is not open (state: ${pr_state})"
if [[ "$draft_ok" == "false" ]]; then
    [[ "$pr_is_draft" == "false" ]] \
        || die "PR #${pr_number} is a draft (use --draft-ok to allow)"
fi

if [[ "$pr_is_draft" == "true" ]]; then
    echo "PR #${pr_number} validated: open (draft, --draft-ok set)."
else
    echo "PR #${pr_number} validated: open, not a draft."
fi

# ---------- delegate worktree + agent creation to maestro_wt.sh ----------

[[ -x "$MAESTRO_WT" ]] || die "maestro_wt.sh not found or not executable at ${MAESTRO_WT}"

worktree_label="pr-${pr_number}"
nudge_message="Do not make any changes this is only a review task."
agent_json="/tmp/maestro_pr_agent$$.json"
trap 'rm -f "${agent_json}"' EXIT INT TERM

"${MAESTRO_WT}" \
    --nudge "${nudge_message}" \
    --json-out "${agent_json}" \
    "${repo}" "${worktree_label}" "${agent_type}" \
    || die "maestro_wt.sh failed"

worktree_name="${repo}-${worktree_label}-${agent_type}"
worktree_dir="${HOME}/wizard/worktrees/${repo}/${worktree_name}"
autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"

agent_id=$(jq -r .agentId "${agent_json}") \
    || die "Failed to extract agentId from ${agent_json}"
[[ -n "$agent_id" && "$agent_id" != "null" ]] || die "agentId missing in ${agent_json}"

# ---------- set up playbooks ----------

playbook_dest="${autorun_dir}/development/code-review"

printf "\n%s\n" "Setting up Code Review playbooks in ${playbook_dest}..."
mkdir -p "${playbook_dest}" || die "Cannot create ${playbook_dest}"

# Prefer the local checkout; fall back to fetching the playbooks from GitHub.
if compgen -G "${PLAYBOOKS_SOURCE}/"'*.md' > /dev/null; then
    cp "${PLAYBOOKS_SOURCE}/"*.md "${playbook_dest}/" || die "Failed to copy playbooks"
else
    fetch_playbooks_from_github "${playbook_dest}"
fi

rm -f "${playbook_dest}/README.md"

[[ -f "${playbook_dest}/1_ANALYZE_CHANGES.md" ]] \
    || die "Playbooks missing 1_ANALYZE_CHANGES.md after setup"

# Substitute the placeholder PR URL in the analyze-changes document
perl -pi -e \
    's@https://github\.com/USER/PROJECT/pull/XXXX@https://github.com/story-wizard/'"${repo}"'/pull/'"${pr_number}"'@g' \
    "${playbook_dest}/1_ANALYZE_CHANGES.md" \
    || die "Failed to update PR URL in 1_ANALYZE_CHANGES.md"

echo "Playbooks configured."

# ---------- checkout PR in worktree ----------

# Check the PR out into a uniquely-named review branch instead of the PR's real
# head branch. This avoids "fatal: '<head>' is already checked out" when the
# author already has the head branch checked out in another clone/worktree.
# gh still sets the new branch's upstream to the PR head ref, so a plain
# `git pull` in the review worktree fast-forwards the author's new commits.
review_branch="${pr_head_ref}-review-$(date +%Y%m%d-%H%M%S)"

printf "\n%s" "Checking out PR #${pr_number} as '${review_branch}' in worktree at ${worktree_dir}..."
pushd "${worktree_dir}" || die "Cannot cd to ${worktree_dir}"
gh pr checkout "$pr_number" --branch "$review_branch" \
    || { popd || exit ; die "gh pr checkout failed"; }
popd || exit

printf "\n%s\n" "PR review setup done!"
echo "  Worktree : ${worktree_dir}"
echo "  Branch   : ${review_branch} (tracks ${pr_head_ref}; 'git pull' to update)"
echo "  Playbooks: ${playbook_dest}"
echo "  Agent ID : ${agent_id}"

# --------- Trigger the auto-run ----------

if [[ "$no_run" == "true" ]]; then
    printf "\n%s\n" "--no-run specified: skipping auto-run launch."
    echo "  To launch manually: node ${maestro_cli} auto-run -a ${agent_id} ${playbook_dest}/* --launch"
else
    sleep 5
    node "${maestro_cli}" auto-run -a "${agent_id}" "${playbook_dest}"/* --launch
fi
