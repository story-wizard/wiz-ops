#!/bin/bash

# wiz_pr_freshness.sh — Check (and optionally update) whether the branches a
# tagged build will use are up-to-date with the `develop` baseline, BEFORE the
# build is dispatched.
#
# A build resolves three refs (wizard_ref / wizard_core_ref / wizard_ai_ref),
# each either a feature/PR branch or `develop`. A feature branch that is *behind*
# origin/develop bakes stale code into the build. This script reports, per ref:
#   baseline        — the ref IS `develop` (nothing to check; CI builds its tip)
#   up_to_date      — branch contains every develop commit (behind = 0)
#   behind_clean    — branch is behind develop AND a merge would apply cleanly
#   behind_conflict — branch is behind develop AND a merge would conflict
#   unknown         — no local clone, or origin/<ref> not found (e.g. fork PR)
#
# Two actions:
#   check   — read-only. Fetches origin, computes status, prints a JSON array.
#             (A `git fetch` updates remote-tracking refs only; no working-tree
#             or branch mutation — safe to run anytime.)
#   update  — for every ref whose status is `behind_clean`, merge origin/develop
#             into it and push, using a throwaway detached worktree so the user's
#             checkout is never touched. Skips up_to_date / behind_conflict /
#             unknown / baseline refs. Prints a JSON array of per-ref outcomes.
#
# Usage:
#   wiz_pr_freshness.sh check  [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R]
#   wiz_pr_freshness.sh update [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R]
#
# Refs default to `develop` when a flag is omitted. Pass the SAME refs
# wiz_pr_build.sh --resolve-only resolved, so the check matches what will build.
#
# macOS bash 3.2 compatible: no associative arrays, no `declare -g`.

set -uo pipefail

CLONE_ROOT="${WIZ_CLONE_ROOT:-${HOME}/wizard}"
BASELINE="develop"

command -v jq  >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"jq not found"}'; exit 1; }
command -v git >/dev/null 2>&1 || { echo '{"ok":false,"stage":"deps","message":"git not found"}'; exit 1; }

# ---- parse action + ref flags ----
[[ $# -ge 1 ]] || { echo '{"ok":false,"stage":"args","message":"usage: wiz_pr_freshness.sh check|update [--wizard-ref R] [--wizard-core-ref R] [--wizard-ai-ref R]"}'; exit 1; }
action="$1"; shift
case "$action" in
    check|update) : ;;
    *) echo "{\"ok\":false,\"stage\":\"args\",\"message\":\"unknown action '${action}' (want check|update)\"}"; exit 1 ;;
esac

wizard_ref="$BASELINE"; wizard_core_ref="$BASELINE"; wizard_ai_ref="$BASELINE"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --wizard-ref)      wizard_ref="${2:-}";      shift 2 ;;
        --wizard-core-ref) wizard_core_ref="${2:-}"; shift 2 ;;
        --wizard-ai-ref)   wizard_ai_ref="${2:-}";   shift 2 ;;
        *) echo "{\"ok\":false,\"stage\":\"args\",\"message\":\"unexpected arg '$1'\"}"; exit 1 ;;
    esac
done

clone_dir_for() { printf '%s/%s' "$CLONE_ROOT" "$1"; }

# Field separator for status_of output. Must be NON-whitespace: `read` with a
# whitespace IFS (tab/space) collapses consecutive delimiters and drops empty
# fields, which would misalign an empty `conflicts` into `note`. \x1f (unit
# separator) never appears in git output, so empty fields survive intact.
SEP=$'\x1f'

# ---- read-only status for one (repo, ref) ----
# Echoes: "<status><SEP><behind><SEP><conflicts_csv><SEP><note>"
status_of() {
    local repo="$1" ref="$2" dir behind conflicts
    dir="$(clone_dir_for "$repo")"

    if [[ -z "$ref" || "$ref" == "$BASELINE" ]]; then
        printf 'baseline%s0%s%s' "$SEP" "$SEP" "$SEP"; return 0
    fi
    if [[ ! -d "${dir}/.git" ]]; then
        printf 'unknown%s0%s%sno local clone at %s' "$SEP" "$SEP" "$SEP" "$dir"; return 0
    fi

    # Refresh remote-tracking refs (baseline + the branch). Best-effort: a fork
    # PR branch won't exist on origin, so fall back to fetching baseline alone.
    if ! git -C "$dir" fetch --quiet origin "$BASELINE" "$ref" 2>/dev/null; then
        git -C "$dir" fetch --quiet origin "$BASELINE" 2>/dev/null || true
    fi

    if ! git -C "$dir" rev-parse --verify --quiet "origin/${ref}^{commit}" >/dev/null 2>&1; then
        printf 'unknown%s0%s%sorigin/%s not found (fork branch?)' "$SEP" "$SEP" "$SEP" "$ref"; return 0
    fi

    behind="$(git -C "$dir" rev-list --count "origin/${ref}..origin/${BASELINE}" 2>/dev/null)"
    [[ "$behind" =~ ^[0-9]+$ ]] || behind=0
    if [[ "$behind" -eq 0 ]]; then
        printf 'up_to_date%s0%s%s' "$SEP" "$SEP" "$SEP"; return 0
    fi

    # Behind — would merging develop in apply cleanly? merge-tree: rc0 clean, rc1 conflict.
    if git -C "$dir" merge-tree --write-tree "origin/${ref}" "origin/${BASELINE}" >/dev/null 2>&1; then
        printf 'behind_clean%s%s%s%s' "$SEP" "$behind" "$SEP" "$SEP"
    else
        conflicts="$(git -C "$dir" merge-tree --write-tree "origin/${ref}" "origin/${BASELINE}" 2>/dev/null \
            | sed -n 's/^CONFLICT.*[Mm]erge conflict in //p' | paste -sd, -)"
        printf 'behind_conflict%s%s%s%s%s' "$SEP" "$behind" "$SEP" "$conflicts" "$SEP"
    fi
}

# ---- perform the update for one behind_clean (repo, ref): merge develop, push ----
# Echoes an outcome token: updated | push_failed | merge_conflict | worktree_failed | skipped
update_ref() {
    local repo="$1" ref="$2" dir tmpwt out="skipped"
    dir="$(clone_dir_for "$repo")"

    git -C "$dir" fetch --quiet origin "$BASELINE" "$ref" 2>/dev/null || true

    tmpwt="$(mktemp -d "${TMPDIR:-/tmp}/wiz-fresh-XXXXXX")" || { printf 'worktree_failed'; return 0; }
    if ! git -C "$dir" worktree add --quiet --detach "$tmpwt" "origin/${ref}" 2>/dev/null; then
        rm -rf "$tmpwt"; printf 'worktree_failed'; return 0
    fi

    if git -C "$tmpwt" merge --no-edit "origin/${BASELINE}" >/dev/null 2>&1; then
        if git -C "$tmpwt" push --quiet origin "HEAD:${ref}" 2>/dev/null; then
            out="updated"
        else
            out="push_failed"
        fi
    else
        git -C "$tmpwt" merge --abort >/dev/null 2>&1 || true
        out="merge_conflict"
    fi

    git -C "$dir" worktree remove --force "$tmpwt" >/dev/null 2>&1 || rm -rf "$tmpwt"
    printf '%s' "$out"
}

# ---- iterate the three (repo, ref) pairs ----
repos="wizard wizard-core wizard-ai"
entries=()
any_behind_clean=false
any_behind_conflict=false
any_behind=false

for repo in $repos; do
    case "$repo" in
        wizard)      ref="$wizard_ref" ;;
        wizard-core) ref="$wizard_core_ref" ;;
        wizard-ai)   ref="$wizard_ai_ref" ;;
    esac

    IFS="$SEP" read -r status behind conflicts note <<EOF
$(status_of "$repo" "$ref")
EOF
    [[ -n "${status:-}" ]] || status="unknown"
    [[ "${behind:-}" =~ ^[0-9]+$ ]] || behind=0

    case "$status" in
        behind_clean)    any_behind=true; any_behind_clean=true ;;
        behind_conflict) any_behind=true; any_behind_conflict=true ;;
    esac

    outcome=""
    if [[ "$action" == "update" && "$status" == "behind_clean" ]]; then
        outcome="$(update_ref "$repo" "$ref")"
    fi

    entries+=("$(jq -nc \
        --arg repo "$repo" --arg ref "$ref" --arg status "$status" \
        --argjson behind "$behind" --arg conflicts "${conflicts:-}" \
        --arg note "${note:-}" --arg outcome "$outcome" \
        '{repo:$repo, ref:$ref, status:$status, behind:$behind,
          conflicts:(if $conflicts=="" then [] else ($conflicts|split(",")) end),
          note:$note, outcome:$outcome}')")
done

printf '%s\n' "${entries[@]}" | jq -s \
    --arg action "$action" \
    --argjson any_behind "$any_behind" \
    --argjson any_behind_clean "$any_behind_clean" \
    --argjson any_behind_conflict "$any_behind_conflict" \
    '{ok:true, action:$action, any_behind:$any_behind,
      any_behind_clean:$any_behind_clean, any_behind_conflict:$any_behind_conflict,
      refs:.}'
