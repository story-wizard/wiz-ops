#!/bin/bash

# wiz_pr_progress.sh — Deterministic progress probe for an in-flight (or done)
# Maestro PR code review. Parses the checkbox state of the Code-Review playbook
# files in {AUTORUN}/development/code-review/ and prints a quick summary —
# safe to run WHILE the auto-run is still going (read-only, no side effects).
#
# Usage:
#   wiz_pr_progress.sh <repo> <pr_number> [agent_type]
#   wiz_pr_progress.sh --autorun <autorun_dir>
#   wiz_pr_progress.sh --json   <repo> <pr_number> [agent_type]
#
#   repo        One of: wizard wizard-ai wizard-core wizard-release wizard-spec
#   agent_type  Optional (default from wiz_pr_pipeline.env, usually claude-code)
#   --json      Emit a machine-readable JSON summary instead of the text report.
#
# Completion model: each playbook doc contains "- [ ]" / "- [x]" checklist
# items grouped under "### Task N:" headings. The auto-run checks items off in
# place, so counting [x] vs [ ] per phase is an accurate progress signal.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Pull defaults (agent type) from the shared env if present; non-fatal if not.
# shellcheck source=wiz_pr_pipeline.env
[[ -f "${script_dir}/wiz_pr_pipeline.env" ]] && source "${script_dir}/wiz_pr_pipeline.env" 2>/dev/null || true
DEFAULT_AGENT="${WIZ_DEFAULT_AGENT_TYPE:-claude-code}"
ARTIFACTS=(REVIEW_SCOPE.md CODE_ISSUES.md SECURITY_ISSUES.md TEST_GAPS.md REVIEW_SUMMARY.md)

die() { echo "Error: $*" >&2; exit 1; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [--json] <repo> <pr_number> [agent_type]
       $(basename "$0") [--json] --autorun <autorun_dir>
EOF
}

json_mode=false
autorun_dir=""
args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)    json_mode=true; shift ;;
        --autorun) autorun_dir="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *)         args+=("$1"); shift ;;
    esac
done
set -- "${args[@]+"${args[@]}"}"

# ---- resolve the autorun dir ----
if [[ -z "$autorun_dir" ]]; then
    [[ $# -ge 2 ]] || { usage >&2; exit 1; }
    repo="$1"; pr_number="$2"; agent_type="${3:-$DEFAULT_AGENT}"
    [[ "$pr_number" =~ ^[0-9]+$ ]] || die "PR number must be numeric, got '${pr_number}'"
    worktree_name="${repo}-pr-${pr_number}-${agent_type}"
    autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"
fi
[[ -d "$autorun_dir" ]] || die "autorun dir not found: ${autorun_dir}"
cr_dir="${autorun_dir}/development/code-review"
[[ -d "$cr_dir" ]] || die "no code-review playbooks at: ${cr_dir}"

# ---- count checkboxes per phase file (sorted N_*.md) ----
shopt -s nullglob
phase_files=("$cr_dir"/[0-9]*.md)
shopt -u nullglob
[[ ${#phase_files[@]} -gt 0 ]] || die "no numbered playbook files in ${cr_dir}"

total_done=0
total_all=0
current_phase=""        # first phase that is started-but-incomplete
first_unstarted=""
# Arrays for text/json rendering
declare -a P_TITLE P_DONE P_TOTAL P_STATE

for f in "${phase_files[@]}"; do
    title="$(sed -n '1s/^#\{1,\} *//p' "$f")"
    [[ -z "$title" ]] && title="$(basename "$f" .md)"
    # Count checklist items, but IGNORE anything inside fenced code blocks
    # (```...```). The playbooks embed example markdown (e.g. a sample PR-comment
    # template with "- [ ] [First action]") inside fences; those are NOT real
    # tasks and must not inflate the count. Toggle fence state on lines starting
    # with ``` and only count checkboxes while outside a fence.
    counts="$(awk '
        /^[[:space:]]*```/ { infence = !infence; next }
        infence { next }
        /^[[:space:]]*-[[:space:]]*\[[xX]\]/      { d++ }
        /^[[:space:]]*-[[:space:]]*\[[[:space:]]\]/ { o++ }
        END { printf "%d %d", d+0, o+0 }
    ' "$f" 2>/dev/null)"
    done_n="${counts%% *}"; done_n="${done_n//[^0-9]/}"; done_n="${done_n:-0}"
    open_n="${counts##* }"; open_n="${open_n//[^0-9]/}"; open_n="${open_n:-0}"
    all_n=$(( done_n + open_n ))

    if   [[ $all_n -eq 0 ]];           then state="no-tasks"
    elif [[ $done_n -eq 0 ]];          then state="not-started"
    elif [[ $done_n -lt $all_n ]];     then state="in-progress"
    else                                    state="complete"
    fi

    P_TITLE+=("$title"); P_DONE+=("$done_n"); P_TOTAL+=("$all_n"); P_STATE+=("$state")
    total_done=$(( total_done + done_n ))
    total_all=$(( total_all + all_n ))
    [[ -z "$current_phase" && "$state" == "in-progress" ]] && current_phase="$title"
    [[ -z "$first_unstarted" && "$state" == "not-started" ]] && first_unstarted="$title"
done

# Overall % (guard divide-by-zero)
if [[ $total_all -gt 0 ]]; then pct=$(( total_done * 100 / total_all )); else pct=0; fi

# "Current" phase = first in-progress, else first not-started, else "finishing/done"
phase_label="$current_phase"
[[ -z "$phase_label" ]] && phase_label="$first_unstarted"
[[ -z "$phase_label" ]] && phase_label="(all phases complete)"

# ---- artifacts present ----
declare -a ART_PRESENT ART_MISSING
for a in "${ARTIFACTS[@]}"; do
    if [[ -s "${autorun_dir}/${a}" ]]; then ART_PRESENT+=("$a"); else ART_MISSING+=("$a"); fi
done

# Newest mtime in the tree = a rough "last activity" signal.
last_activity="$(find "$cr_dir" "$autorun_dir" -maxdepth 1 -name '*.md' -type f -print0 2>/dev/null \
    | xargs -0 stat -f '%m %Sm' -t '%H:%M:%S' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"

# ---- emit ----
if [[ "$json_mode" == "true" ]]; then
    phases_json="["
    for i in "${!P_TITLE[@]}"; do
        [[ $i -gt 0 ]] && phases_json+=","
        phases_json+="$(jq -nc --arg t "${P_TITLE[$i]}" --argjson d "${P_DONE[$i]}" \
            --argjson a "${P_TOTAL[$i]}" --arg s "${P_STATE[$i]}" \
            '{title:$t, done:$d, total:$a, state:$s}')"
    done
    phases_json+="]"
    # shellcheck disable=SC1010  # 'done' here is a jq --argjson field name, not the shell keyword
    jq -nc \
        --arg dir "$autorun_dir" --argjson done "$total_done" --argjson all "$total_all" \
        --argjson pct "$pct" --arg phase "$phase_label" --arg last "$last_activity" \
        --argjson phases "$phases_json" \
        --argjson present "$(printf '%s\n' "${ART_PRESENT[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')" \
        --argjson missing "$(printf '%s\n' "${ART_MISSING[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')" \
        '{autorun_dir:$dir, overall_done:$done, overall_total:$all, percent:$pct,
          current_phase:$phase, last_activity:$last, phases:$phases,
          artifacts_present:$present, artifacts_missing:$missing}'
    exit 0
fi

# Text report
bar_len=20
filled=$(( pct * bar_len / 100 ))
(( filled < 0 )) && filled=0
(( filled > bar_len )) && filled=$bar_len
empty=$(( bar_len - filled ))
# Build the bar without seq (seq 1 0 emits "1 0" -> stray chars). Use printf
# width-padding + tr: a width-N field of spaces, translated to the bar glyph.
hashes=""; dashes=""
(( filled > 0 )) && hashes="$(printf "%${filled}s" '' | tr ' ' '#')"
(( empty  > 0 )) && dashes="$(printf "%${empty}s"  '' | tr ' ' '-')"
bar="${hashes}${dashes}"

echo "PR Review progress — $(basename "$autorun_dir")"
echo "Overall: [${bar}] ${pct}%  (${total_done}/${total_all} tasks)"
echo "Current phase: ${phase_label}"
[[ -n "$last_activity" ]] && echo "Last file activity: ${last_activity}"
echo
for i in "${!P_TITLE[@]}"; do
    case "${P_STATE[$i]}" in
        complete)    mark="✅" ;;
        in-progress) mark="🔄" ;;
        not-started) mark="⏳" ;;
        *)           mark="—"  ;;
    esac
    printf "  %s  %-34s %s/%s\n" "$mark" "${P_TITLE[$i]}" "${P_DONE[$i]}" "${P_TOTAL[$i]}"
done
echo
echo "Artifacts written:"
if [[ ${#ART_PRESENT[@]} -gt 0 ]]; then
    for a in "${ART_PRESENT[@]}"; do echo "  ✓ $a"; done
fi
if [[ ${#ART_MISSING[@]} -gt 0 ]]; then
    for a in "${ART_MISSING[@]}"; do echo "  · $a (not yet)"; done
fi
