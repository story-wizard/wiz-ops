#!/bin/bash

# wiz_pr_get_status.sh — Read a PR's current Status on the org
# "Wizard Development" project (org: story-wizard, project #1).
#
# READ-ONLY. Never mutates anything. Safe to run anytime.
#
# Usage: wiz_pr_get_status.sh <repo> <pr_number> [--json]
#
#   repo         One of: wizard wizard-ai wizard-core wizard-release wizard-spec
#   pr_number    Numeric PR number
#   --json       Emit a machine-readable JSON line instead of plain text
#
# Output (text mode, the default):
#   - prints the exact Status option name (e.g. "AI Review 2") on stdout, OR
#   - prints the literal "(none)" if the PR is on the board with no Status set,
#     or is not on the board at all.
#   Exit code is 0 whenever the PR was found in the repo (status resolved or
#   not); non-zero only on hard errors (bad args, PR not found, API failure).
#
# Output (--json mode):
#   {"ok":true,"repo":"...","pr":N,"on_board":true|false,
#    "status":"AI Review 2"|null}
#
# Requires: gh (authenticated, with 'project' scope), jq.

set -uo pipefail

ORG="story-wizard"
PROJECT_NUMBER=1
VALID_REPOS=(wizard wizard-ai wizard-core wizard-release wizard-spec)

emit_json=false
die() {
  if [[ "$emit_json" == true ]]; then
    # shellcheck disable=SC2016
    jq -nc --arg err "$*" '{ok:false, error:$err}' >&2
  fi
  echo "Error: $*" >&2
  exit 1
}

args=()
for a in "$@"; do
  case "$a" in
    --json) emit_json=true ;;
    *) args+=("$a") ;;
  esac
done
set -- "${args[@]}"

[[ $# -eq 2 ]] || die "Usage: $(basename "$0") <repo> <pr_number> [--json]"

repo="$1"
pr_number="$2"

repo_ok=false
for r in "${VALID_REPOS[@]}"; do [[ "$repo" == "$r" ]] && repo_ok=true && break; done
[[ "$repo_ok" == true ]] || die "Invalid repo '${repo}'. Valid: ${VALID_REPOS[*]}"
[[ "$pr_number" =~ ^[0-9]+$ ]] || die "PR number must be numeric, got '${pr_number}'"

command -v gh >/dev/null 2>&1 || die "gh CLI not found"
command -v jq >/dev/null 2>&1 || die "jq not found"

# ---- Resolve project id (to filter the PR's project items to the right board) ----
proj_json=$(gh api graphql -f org="$ORG" -F number="$PROJECT_NUMBER" -f query='
query($org:String!, $number:Int!) {
  organization(login:$org) {
    projectV2(number:$number) { id }
  }
}' 2>&1) || die "Failed to query project:\n${proj_json}"

project_id=$(echo "$proj_json" | jq -r '.data.organization.projectV2.id')
[[ -n "$project_id" && "$project_id" != "null" ]] || die "Could not resolve project id"

# ---- Find the PR and its Status value on this board ----
# fieldValueByName("Status") returns the single-select option name (or null).
item_json=$(gh api graphql -f owner="$ORG" -f name="$repo" -F pr="$pr_number" -f query='
query($owner:String!, $name:String!, $pr:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$pr) {
      id
      projectItems(first:20) {
        nodes {
          project { id }
          fieldValueByName(name:"Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
        }
      }
    }
  }
}' 2>&1) || die "Failed to query PR project items:\n${item_json}"

pr_node_id=$(echo "$item_json" | jq -r '.data.repository.pullRequest.id')
[[ -n "$pr_node_id" && "$pr_node_id" != "null" ]] || die "PR #${pr_number} not found in ${ORG}/${repo}"

# Is the PR on project #1 at all?
on_board=$(echo "$item_json" | jq -r --arg pid "$project_id" \
  '[.data.repository.pullRequest.projectItems.nodes[] | select(.project.id == $pid)] | length')

if [[ "$on_board" == "0" ]]; then
  if [[ "$emit_json" == true ]]; then
    jq -nc --arg repo "$repo" --argjson pr "$pr_number" \
      '{ok:true, repo:$repo, pr:$pr, on_board:false, status:null}'
  else
    echo "(none)"
  fi
  exit 0
fi

# Status name for the item on project #1 (null -> no status set)
status_name=$(echo "$item_json" | jq -r --arg pid "$project_id" \
  '.data.repository.pullRequest.projectItems.nodes[]
   | select(.project.id == $pid)
   | .fieldValueByName.name // empty' | head -n1)

if [[ "$emit_json" == true ]]; then
  if [[ -z "$status_name" ]]; then
    jq -nc --arg repo "$repo" --argjson pr "$pr_number" \
      '{ok:true, repo:$repo, pr:$pr, on_board:true, status:null}'
  else
    jq -nc --arg repo "$repo" --argjson pr "$pr_number" --arg s "$status_name" \
      '{ok:true, repo:$repo, pr:$pr, on_board:true, status:$s}'
  fi
else
  if [[ -z "$status_name" ]]; then
    echo "(none)"
  else
    echo "$status_name"
  fi
fi
exit 0
