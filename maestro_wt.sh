#!/bin/bash

# maestro_wt.sh — Set up (or tear down) a named worktree for a Maestro agent.
#
# Usage: maestro_wt.sh <repo> <worktree_name> [agent_type]
#        maestro_wt.sh --delete [--force] <repo> <worktree_name> [agent_type]

VALID_REPOS=(wizard wizard-ai wizard-core wizard-link wizard-release wizard-spec Qt-Advanced-Docking-System)
VALID_AGENT_TYPES=(claude-code codex opencode)

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
Usage: $(basename "$0") [--nudge MSG] [--json-out PATH] <repo> <worktree_name> [agent_type]
       $(basename "$0") --delete [--force] <repo> <worktree_name> [agent_type]

Set up (or tear down) a named worktree for use with a Maestro agent.

Arguments:
    repo            Repository name. Valid options: $(format_options "${VALID_REPOS[@]}")
    worktree_name   The name of the worktree (will be part of the final name)
    agent_type      Optional Maestro agent type.
                    Valid options: $(format_options "${VALID_AGENT_TYPES[@]}"). Default: claude-code

Options:
  -h, --help        Show this help message and exit
  --nudge MSG       Pass MSG as the nudge message when creating the agent
  --json-out PATH   Write the create-agent JSON response to PATH (caller-managed).
                    Without this flag the JSON is written to a temp file that is
                    removed on exit.
  --delete          Tear down the worktree and its Maestro agent instead of
                    creating them. Removes the git worktree (prompting whether to
                    also delete the autorun directory) then removes the agent.
                    Mutually exclusive with --nudge / --json-out.
  --force           Only with --delete: skip the confirmation prompt and force
                    removal of the worktree even if it has uncommitted changes.
                    Also removes the autorun directory without prompting.

Examples:
  $(basename "$0") wizard-core my-feature
  $(basename "$0") wizard refactor-auth
  $(basename "$0") wizard-ai experiment codex
  $(basename "$0") --nudge "review only" --json-out /tmp/a.json wizard-core pr-209
  $(basename "$0") --delete wizard-core my-feature
  $(basename "$0") --delete --force wizard-ai experiment codex
EOF
}

die() {
    echo "Error: $*" >&2
    exit 1
}

# ---------- resolve Maestro CLI ----------

_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_maestro_env.sh
source "${_script_dir}/_maestro_env.sh" || die "Cannot source _maestro_env.sh"

# ---------- argument parsing ----------

if [[ $# -eq 0 || "$1" == "-h" || "$1" == "--help" ]]; then
    usage
    exit 0
fi

nudge_message=""
json_out=""
delete_mode=false
force=false
positional=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --nudge)
            [[ $# -ge 2 ]] || die "--nudge requires an argument"
            nudge_message="$2"
            shift 2
            ;;
        --json-out)
            [[ $# -ge 2 ]] || die "--json-out requires an argument"
            json_out="$2"
            shift 2
            ;;
        --delete)
            delete_mode=true
            shift
            ;;
        --force)
            force=true
            shift
            ;;
        --)
            shift
            while [[ $# -gt 0 ]]; do
                positional+=("$1")
                shift
            done
            ;;
        -*)
            die "Unknown option: $1"
            ;;
        *)
            positional+=("$1")
            shift
            ;;
    esac
done

set -- "${positional[@]}"

# --delete is exclusive to the normal create flow.
if [[ "$delete_mode" == "true" ]]; then
    [[ -z "$nudge_message" ]] || die "--nudge cannot be combined with --delete"
    [[ -z "$json_out" ]] || die "--json-out cannot be combined with --delete"
elif [[ "$force" == "true" ]]; then
    die "--force is only valid with --delete"
fi

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "Error: Expected 2 or 3 positional arguments, got $#." >&2
    usage >&2
    exit 1
fi

repo="$1"
wt_name="$2"
agent_type="${3:-claude-code}"
# Track whether the caller explicitly supplied an agent type (vs. the default),
# so full-name normalization below can safely adopt the suffix's agent type.
agent_type_explicit=false
[[ $# -ge 3 ]] && agent_type_explicit=true

# Validate repo name
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

# Accept the FULL composed worktree name (what Maestro displays for the agent /
# worktree dir, e.g. "wizard-core-pr-574-claude-code") in place of the bare
# middle segment ("pr-574"). Without this, passing the full name would re-wrap
# it into "<repo>-<full>-<agent_type>", doubling the prefix and suffix.
#
# Only normalize when the name unambiguously looks composed: it starts with
# "<repo>-" AND ends with "-<valid_agent_type>". That dual guard avoids
# mangling a legitimate bare name that merely happens to start with the repo.
if [[ "$wt_name" == "${repo}-"* ]]; then
    matched_agent_type=""
    for valid_agent_type in "${VALID_AGENT_TYPES[@]}"; do
        if [[ "$wt_name" == *"-${valid_agent_type}" ]]; then
            matched_agent_type="$valid_agent_type"
            break
        fi
    done

    if [[ -n "$matched_agent_type" ]]; then
        normalized="${wt_name#"${repo}-"}"
        normalized="${normalized%"-${matched_agent_type}"}"

        # Adopt the agent type from the suffix unless one was given explicitly.
        if [[ "$agent_type_explicit" != "true" ]]; then
            agent_type="$matched_agent_type"
        fi

        echo "Note: '${wt_name}' looks like a full worktree name; interpreting as" >&2
        echo "      repo='${repo}', name='${normalized}', agent_type='${agent_type}'." >&2
        wt_name="$normalized"
    fi
fi

# Validate worktree name
[[ -n "$wt_name" ]] || die "worktree_name cannot be empty"
[[ "$wt_name" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die "worktree_name must contain only letters, digits, '.', '_', or '-' (got '${wt_name}')"

# Validate agent type
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

# ---------- source helper functions ----------

# shellcheck source=_worktree_helpers.sh
source "${_script_dir}/_worktree_helpers.sh" || die "Cannot source _worktree_helpers.sh"

worktree_name="${repo}-${wt_name}-${agent_type}"
agent_name="${worktree_name}"
worktree_dir="${HOME}/wizard/worktrees/${repo}/${worktree_name}"
autorun_dir="${HOME}/wizard/worktrees/autorun/${repo}/${worktree_name}"

# ---------- delete flow (mutually exclusive with create) ----------

if [[ "$delete_mode" == "true" ]]; then
    echo "About to tear down:"
    echo "  Worktree : ${worktree_dir}"
    echo "  Agent    : ${agent_name}"

    if [[ "$force" != "true" ]]; then
        printf "Proceed? (y/n) [n] "
        read -r confirm
        [[ "$confirm" == "y" ]] || die "Aborted."
    fi

    printf "\n%s\n" "Changing to ~/wizard/${repo}..."
    cd "${HOME}/wizard/${repo}" || die "Cannot cd to ${HOME}/wizard/${repo}"

    # cleanup_work_tree_here removes the worktree and prompts about the autorun dir.
    # --force is passed through to `git worktree remove` for dirty worktrees and
    # also skips the autorun-dir prompt, deleting it outright.
    if [[ "$force" == "true" ]]; then
        cleanup_work_tree_here "${worktree_name}" --force \
            || echo "Warning: worktree cleanup did not complete; continuing to agent removal." >&2
    else
        cleanup_work_tree_here "${worktree_name}" \
            || echo "Warning: worktree cleanup did not complete; continuing to agent removal." >&2
    fi

    # Remove the Maestro agent (reuse maestro_id.sh for the name -> UUID lookup).
    printf "\n%s\n" "Removing Maestro agent '${agent_name}'..."
    if agent_id=$("${_script_dir}/maestro_id.sh" "${agent_name}" 2>/dev/null) && [[ -n "$agent_id" ]]; then
        if node "${maestro_cli}" remove-agent "${agent_id}"; then
            echo "Removed agent '${agent_name}' (${agent_id})."
        else
            die "Failed to remove agent '${agent_name}' (${agent_id})."
        fi
    else
        echo "No unique agent named '${agent_name}' found — skipping agent removal."
    fi

    printf "\n%s\n" "Teardown complete."
    exit 0
fi

# ---------- create worktree ----------

printf "\n%s" "Changing to ~/wizard/${repo}..."
cd "${HOME}/wizard/${repo}" || die "Cannot cd to ${HOME}/wizard/${repo}"

echo "Creating worktree '${worktree_name}'..."
make_worktree_here "${worktree_name}" || die "make_worktree_here failed"

printf "\n%s" "Creating autorun directories..."
# shellcheck disable=SC2119  # make_autorun_dirs takes no args by design
make_autorun_dirs || die "make_autorun_dirs failed"

printf "\n%s" "Worktree and auto-run setup done!"
echo "  Worktree : ${worktree_dir}"
echo "  Autorun  : ${autorun_dir}"

# --------- create Maestro agent ----------

if [[ -n "$json_out" ]]; then
    out_path="$json_out"
else
    out_path="/tmp/maestro_agent$$.json"
    trap 'rm -f "${out_path}"' EXIT INT TERM
fi

create_args=(create-agent -d "${worktree_dir}" -t "${agent_type}")
if [[ -n "$nudge_message" ]]; then
    create_args+=(--nudge "${nudge_message}")
fi
create_args+=(--auto-run-folder "${autorun_dir}" "${agent_name}" --json)

node "${maestro_cli}" "${create_args[@]}" > "${out_path}"

cat "${out_path}"

printf "\n%s" "Agent Created!"
jq . "${out_path}"
