#!/bin/bash

# wiz_pr_set_status.sh — Set a PR's Status on the org "Wizard Development"
# project (org: story-wizard, project #1) to a named single-select option.
#
# Usage: wiz_pr_set_status.sh <repo> <pr_number> "<status_name>"
#
#   repo         One of: wizard wizard-ai wizard-core wizard-link wizard-release wizard-spec
#   pr_number    Numeric PR number
#   status_name  Exact Status option name, e.g. "AI Review 1"
#
# Requires: gh (authenticated, with 'project' scope), jq.
#
# PRs in story-wizard are auto-added to project #1, so this script finds the
# existing project item for the PR and patches its Status field. If the PR is
# somehow not on the board yet, it adds it first.

set -uo pipefail

# Pin gh to the bot account (needs `project` scope for Projects v2). `gh` uses
# whatever account is active, which can silently flip to one without the scope
# and break every project mutation. Force GH_TOKEN to the bot identity's token
# so this works regardless of the active account. Only if not already set and
# the token is retrievable; harmless when invoked as a child of the poller
# (which already exported GH_TOKEN).
WIZ_GH_ACCOUNT="${WIZ_GH_ACCOUNT:-wiz-maestro}"
if [[ -z "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
    _wiz_tok="$(gh auth token --user "$WIZ_GH_ACCOUNT" 2>/dev/null)"
    [[ -n "$_wiz_tok" ]] && export GH_TOKEN="$_wiz_tok"
    unset _wiz_tok
fi

ORG="story-wizard"
PROJECT_NUMBER=1
# Cached static IDs for project #1 "Wizard Development" (resolved 2026-06).
# The script re-resolves them live, so these are documentation only:
#   project   PVT_kwDOD80ZKM4BRWNs
#   Status    PVTSSF_lADOD80ZKM4BRWNszg_M5nE
VALID_REPOS=(wizard wizard-ai wizard-core wizard-link wizard-release wizard-spec Qt-Advanced-Docking-System)

die() { echo "Error: $*" >&2; exit 1; }

[[ $# -eq 3 ]] || die "Usage: $(basename "$0") <repo> <pr_number> \"<status_name>\""

repo="$1"
pr_number="$2"
status_name="$3"

repo_ok=false
for r in "${VALID_REPOS[@]}"; do [[ "$repo" == "$r" ]] && repo_ok=true && break; done
[[ "$repo_ok" == true ]] || die "Invalid repo '${repo}'. Valid: ${VALID_REPOS[*]}"
[[ "$pr_number" =~ ^[0-9]+$ ]] || die "PR number must be numeric, got '${pr_number}'"

command -v gh >/dev/null 2>&1 || die "gh CLI not found"
command -v jq >/dev/null 2>&1 || die "jq not found"

# ---- Resolve project id, Status field id, and the target option id ----
proj_json=$(gh api graphql -f org="$ORG" -F number="$PROJECT_NUMBER" -f query='
query($org:String!, $number:Int!) {
  organization(login:$org) {
    projectV2(number:$number) {
      id
      field(name:"Status") {
        ... on ProjectV2SingleSelectField { id options { id name } }
      }
    }
  }
}' 2>&1) || die "Failed to query project:\n${proj_json}"

project_id=$(echo "$proj_json" | jq -r '.data.organization.projectV2.id')
status_field_id=$(echo "$proj_json" | jq -r '.data.organization.projectV2.field.id')
option_id=$(echo "$proj_json" | jq -r --arg n "$status_name" \
  '.data.organization.projectV2.field.options[] | select(.name == $n) | .id')

[[ -n "$project_id" && "$project_id" != "null" ]] || die "Could not resolve project id"
[[ -n "$status_field_id" && "$status_field_id" != "null" ]] || die "Could not resolve Status field id"
[[ -n "$option_id" && "$option_id" != "null" ]] || {
  valid=$(echo "$proj_json" | jq -r '.data.organization.projectV2.field.options[].name' | paste -sd', ' -)
  die "Status option '${status_name}' not found. Valid options: ${valid}"
}

# ---- Find the project item id for this PR (add it if missing) ----
item_json=$(gh api graphql -f owner="$ORG" -f name="$repo" -F pr="$pr_number" -f query='
query($owner:String!, $name:String!, $pr:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$pr) {
      id
      projectItems(first:20) {
        nodes { id project { id } }
      }
    }
  }
}' 2>&1) || die "Failed to query PR project items:\n${item_json}"

pr_node_id=$(echo "$item_json" | jq -r '.data.repository.pullRequest.id')
[[ -n "$pr_node_id" && "$pr_node_id" != "null" ]] || die "PR #${pr_number} not found in ${ORG}/${repo}"

item_id=$(echo "$item_json" | jq -r --arg pid "$project_id" \
  '.data.repository.pullRequest.projectItems.nodes[] | select(.project.id == $pid) | .id')

if [[ -z "$item_id" || "$item_id" == "null" ]]; then
  echo "PR not on project board yet; adding it..." >&2
  add_json=$(gh api graphql -f project="$project_id" -f content="$pr_node_id" -f query='
  mutation($project:ID!, $content:ID!) {
    addProjectV2ItemById(input:{projectId:$project, contentId:$content}) {
      item { id }
    }
  }' 2>&1) || die "Failed to add PR to project:\n${add_json}"
  item_id=$(echo "$add_json" | jq -r '.data.addProjectV2ItemById.item.id')
  [[ -n "$item_id" && "$item_id" != "null" ]] || die "Could not obtain project item id after add"
fi

# ---- Set the Status single-select value ----
upd_json=$(gh api graphql \
  -f project="$project_id" -f item="$item_id" -f field="$status_field_id" -f opt="$option_id" \
  -f query='
mutation($project:ID!, $item:ID!, $field:ID!, $opt:String!) {
  updateProjectV2ItemFieldValue(input:{
    projectId:$project, itemId:$item, fieldId:$field,
    value:{ singleSelectOptionId:$opt }
  }) {
    projectV2Item { id }
  }
}' 2>&1) || die "Failed to update Status:\n${upd_json}"

updated=$(echo "$upd_json" | jq -r '.data.updateProjectV2ItemFieldValue.projectV2Item.id')
[[ -n "$updated" && "$updated" != "null" ]] || die "Status update returned no item:\n${upd_json}"

echo "Set ${ORG}/${repo} PR #${pr_number} Status -> '${status_name}' (item ${updated})"
