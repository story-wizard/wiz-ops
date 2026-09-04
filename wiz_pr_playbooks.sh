#!/bin/bash
# wiz_pr_playbooks.sh — atomically install pristine Maestro Code Review templates.
set -uo pipefail

PLAYBOOKS_SOURCE="${WIZ_PLAYBOOKS_SOURCE:-${HOME}/src/Maestro-Playbooks/Development/Code-Review}"
PLAYBOOKS_GH_REPO="${WIZ_PLAYBOOKS_GH_REPO:-RunMaestro/Maestro-Playbooks}"
PLAYBOOKS_GH_REF="${WIZ_PLAYBOOKS_GH_REF:-main}"
PLAYBOOKS_GH_PATH="${WIZ_PLAYBOOKS_GH_PATH:-Development/Code-Review}"

fail() { echo "Error: $*" >&2; exit 1; }

apply_test_review_policy() {
    local playbook="$1"
    python3 - "$playbook" <<'PY'
import hashlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
expected_sha256 = "05ffed3387690d4ae0367401b9f004fb58d26fcc4334d63a09a04006ea1097e7"
actual_sha256 = hashlib.sha256(text.encode()).hexdigest()
if actual_sha256 != expected_sha256:
    raise SystemExit(
        f"unexpected upstream 4_VERIFY_TESTS.md SHA-256 in {path}: "
        f"expected {expected_sha256}, got {actual_sha256}"
    )
old_task = """### Task 5: Run Tests (if possible)

- [ ] **Execute test suite**: If test runner is available:
  ```bash
  npm test  # or equivalent
  ```
  Note any failures or warnings.
"""
new_task = """### Task 5: Review Existing CI Evidence (do not run tests locally)

- [ ] **Inspect existing CI evidence**: Review read-only PR check status and existing CI logs/results when available.
  - Do not build, run, rerun, or execute local test suites as part of the Crucible review.
  - Do not invoke project test runners, compilers, build systems, or CI workflows.
  - CI execution remains the responsibility of the developer workflow and feature-branch CI.
  - Record the observed CI status, or state that it was unavailable or not inspected.
  - The absence of local test execution is not a coverage gap or blocker.
"""
old_report = """## Test Execution Results
[If tests were run, note results here]"""
new_report = """## Existing CI Evidence
[Record existing PR/branch CI status if available. Do not run tests locally.]"""

if text.count(old_task) != 1:
    raise SystemExit(f"expected exactly one upstream local-test task in {path}")
if text.count(old_report) != 1:
    raise SystemExit(f"expected exactly one upstream test-results section in {path}")
text = text.replace(old_task, new_task, 1).replace(old_report, new_report, 1)
path.write_text(text)
PY
}

gh_api_to_file_retry() {
    local output="$1"; shift
    local attempts="${WIZ_PLAYBOOK_FETCH_ATTEMPTS:-3}"
    local delay="${WIZ_PLAYBOOK_FETCH_RETRY_DELAY:-1}"
    local attempt=1 tmp="${output}.download.$$"
    [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || { echo "Error: invalid WIZ_PLAYBOOK_FETCH_ATTEMPTS '${attempts}'" >&2; return 1; }
    [[ "$delay" =~ ^[0-9]+$ ]] || { echo "Error: invalid WIZ_PLAYBOOK_FETCH_RETRY_DELAY '${delay}'" >&2; return 1; }
    while (( attempt <= attempts )); do
        rm -f "$tmp"
        if gh api "$@" > "$tmp"; then
            mv "$tmp" "$output" || { rm -f "$tmp"; return 1; }
            return 0
        fi
        rm -f "$tmp"
        if (( attempt < attempts )); then
            echo "Warning: GitHub playbook fetch attempt ${attempt}/${attempts} failed; retrying..." >&2
            sleep "$delay"
        fi
        attempt=$((attempt + 1))
    done
    return 1
}

fetch_playbooks_from_github() {
    local dest="$1" commit listing name commit_file listing_file
    command -v gh >/dev/null 2>&1 || { echo "Error: gh is required to fetch Maestro playbooks" >&2; return 1; }
    echo "Local playbooks not found; fetching from github.com/${PLAYBOOKS_GH_REPO} (${PLAYBOOKS_GH_PATH})..." >&2
    commit_file="${dest}/.source-commit"
    if ! gh_api_to_file_retry "$commit_file" \
        "repos/${PLAYBOOKS_GH_REPO}/commits/${PLAYBOOKS_GH_REF}" --jq .sha; then
        echo "Error: Failed to resolve ${PLAYBOOKS_GH_REF} to an immutable commit" >&2
        return 1
    fi
    commit="$(< "$commit_file")"; rm -f "$commit_file"
    [[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
        || { echo "Error: GitHub returned an invalid playbook commit: ${commit}" >&2; return 1; }
    listing_file="${dest}/.source-listing"
    if ! gh_api_to_file_retry "$listing_file" \
        "repos/${PLAYBOOKS_GH_REPO}/contents/${PLAYBOOKS_GH_PATH}?ref=${commit}" \
        --jq '.[] | select(.type == "file" and (.name | endswith(".md"))) | .name'; then
        echo "Error: Failed to list playbooks from GitHub" >&2
        return 1
    fi
    listing="$(< "$listing_file")"; rm -f "$listing_file"
    [[ -n "$listing" ]] \
        || { echo "Error: No playbook .md files found at ${PLAYBOOKS_GH_REPO}/${PLAYBOOKS_GH_PATH}" >&2; return 1; }
    while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        if ! gh_api_to_file_retry "${dest}/${name}" \
            "repos/${PLAYBOOKS_GH_REPO}/contents/${PLAYBOOKS_GH_PATH}/${name}?ref=${commit}" \
            -H 'Accept: application/vnd.github.raw+json'; then
            echo "Error: Failed to download playbook '${name}' from GitHub after ${WIZ_PLAYBOOK_FETCH_ATTEMPTS:-3} attempt(s)" >&2
            return 1
        fi
    done <<< "$listing"
}

validate_playbooks() {
    local dest="$1" required
    for required in 1_ANALYZE_CHANGES.md 2_REVIEW_CODE.md 3_CHECK_SECURITY.md 4_VERIFY_TESTS.md 5_SUMMARIZE.md; do
        [[ -s "$dest/$required" ]] || fail "Playbooks missing required ${required} after setup"
    done
}

configure_playbooks() {
    local dest="$1" repo="$2" pr_number="$3" agent_name agent_path autorun_folder current_date pb
    agent_name="$(basename "$(dirname "$(dirname "$dest")")")"
    agent_path="${HOME}/wizard/worktrees/${repo}/${agent_name}"
    autorun_folder="$(cd "$(dirname "$(dirname "$dest")")" && pwd)"
    current_date="$(date +%Y-%m-%d)"
    for pb in "$dest"/*.md; do
        WIZ_AGENT_NAME="$agent_name" WIZ_AGENT_PATH="$agent_path" WIZ_AUTORUN_FOLDER="$autorun_folder" WIZ_CURRENT_DATE="$current_date" \
        perl -pi -e 's/\{\{AGENT_NAME\}\}/$ENV{WIZ_AGENT_NAME}/g; s/\{\{AGENT_PATH\}\}/$ENV{WIZ_AGENT_PATH}/g; s/\{\{AUTORUN_FOLDER\}\}/$ENV{WIZ_AUTORUN_FOLDER}/g; s/\{\{DATE\}\}/$ENV{WIZ_CURRENT_DATE}/g;' "$pb" \
            || fail "Failed to substitute runtime values in ${pb}"
    done
    WIZ_PR_URL="https://github.com/story-wizard/${repo}/pull/${pr_number}" perl -pi -e '
        if (/^\*\*Pull Request\*\*:/) { s@https://github\.com/USER/PROJECT/pull/XXXX@$ENV{WIZ_PR_URL}@; }
    ' "$dest/1_ANALYZE_CHANGES.md" || fail "Failed to update PR URL in 1_ANALYZE_CHANGES.md"
    perl -pi -e 's@^NOTE: \*\(Update the URL above before running this playbook\)\*$@NOTE: *(Configured automatically by maestro_pr.sh)*@' \
        "$dest/1_ANALYZE_CHANGES.md" || fail "Failed to update PR configuration note"
}

refresh_playbooks() {
    local dest="$1" repo="$2" pr_number="$3" retained_backup="${4:-}" parent stage backup=""
    [[ "$repo" =~ ^[A-Za-z0-9._-]+$ ]] || fail "invalid repository name"
    [[ "$pr_number" =~ ^[0-9]+$ ]] || fail "invalid PR number"
    parent="$(dirname "$dest")"; mkdir -p "$parent" || fail "Cannot create playbook parent ${parent}"
    stage="$(mktemp -d "${parent}/.code-review.stage.XXXXXX")" || fail "Cannot create playbook staging directory"
    if compgen -G "${PLAYBOOKS_SOURCE}/"'*.md' >/dev/null; then
        cp "${PLAYBOOKS_SOURCE}/"*.md "$stage/" || { rm -rf "$stage"; fail "Failed to copy playbooks"; }
    else
        if ! fetch_playbooks_from_github "$stage"; then rm -rf "$stage"; exit 1; fi
    fi
    rm -f "$stage/README.md"
    validate_playbooks "$stage" || { rm -rf "$stage"; exit 1; }
    apply_test_review_policy "$stage/4_VERIFY_TESTS.md" \
        || { rm -rf "$stage"; fail "Failed to apply Wizard test-review policy"; }
    configure_playbooks "$stage" "$repo" "$pr_number" || { rm -rf "$stage"; exit 1; }
    if [[ -e "$dest" ]]; then
        backup="${retained_backup:-${parent}/.code-review.previous.$$}"
        [[ ! -e "$backup" ]] || { rm -rf "$stage"; fail "Playbook backup already exists at ${backup}"; }
        mkdir -p "$(dirname "$backup")" || { rm -rf "$stage"; fail "Cannot create playbook backup parent"; }
        mv "$dest" "$backup" || { rm -rf "$stage"; fail "Cannot stage existing playbooks for replacement"; }
    fi
    if ! mv "$stage" "$dest"; then
        [[ -n "$backup" && -e "$backup" ]] && mv "$backup" "$dest" 2>/dev/null || true
        rm -rf "$stage"; fail "Cannot install pristine playbooks"
    fi
    if [[ -z "$retained_backup" && -n "$backup" && -e "$backup" ]]; then rm -rf "$backup"; fi
    return 0
}

case "${1:-}" in
    refresh)
        [[ $# -eq 4 || $# -eq 5 ]] || fail "Usage: $(basename "$0") refresh <destination> <repo> <pr_number> [retained_backup]"
        refresh_playbooks "$2" "$3" "$4" "${5:-}" ;;
    *) fail "Usage: $(basename "$0") refresh <destination> <repo> <pr_number> [retained_backup]" ;;
esac
