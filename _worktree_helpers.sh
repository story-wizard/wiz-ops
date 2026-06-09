#!/usr/bin/env bash
# _worktree_helpers.sh — Git worktree helpers used by the maestro_*.sh scripts.
#
# Source (do NOT execute) this from the maestro_*.sh scripts. It is a
# self-contained, bash-compatible port of the worktree functions that used to
# live in ~/.zshrc.d/80-git-worktrees.zsh, so the scripts no longer depend on a
# user's shell dotfiles being present (or being zsh).
#
# Provides:
#   make_worktree_here <worktree-name>     Create ../worktrees/<repo>/<name>
#   make_autorun_dirs                      Create matching autorun dirs
#   cleanup_work_tree_here <name> [--force] Remove a worktree (+ optional autorun)
#
# All three must be run from inside the target git repository.

# Create a new git worktree in ../worktrees/<repo-name>/<worktree-name>.
make_worktree_here() {
    if [[ $# -ne 1 ]]; then
        echo "Usage: make_worktree_here <worktree-name>" >&2
        echo "Creates a new git worktree for the current branch in ../worktrees/<repo-name>/<worktree-name>" >&2
        return 1
    fi

    local magic_configs=(".vercel" ".neon")
    local repo_dir base_branch_name worktree_name
    worktree_name="$1"
    base_branch_name=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    repo_dir=$(git rev-parse --show-toplevel 2>/dev/null)

    if [[ -z "$repo_dir" ]]; then
        echo "Error: Not inside a git repository." >&2
        return 1
    fi

    local git_common_dir
    git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
    if [[ "$git_common_dir" != ".git" ]]; then
        repo_dir="${git_common_dir%/.git}"
    fi

    local worktrees_dir
    worktrees_dir="${repo_dir}/../worktrees/$(basename "$repo_dir")"
    mkdir -p "$worktrees_dir"

    if ! git worktree add "${worktrees_dir}/${worktree_name}"; then
        echo "Error: Failed to create worktree for branch '$base_branch_name'." >&2
        return 1
    fi

    # symlink all .env* files (best-effort, never overwrite)
    local env_path env_file
    for env_path in "${repo_dir}"/.env*; do
        [[ -e "$env_path" ]] || continue   # no matches: glob stays literal
        env_file="$(basename "$env_path")"
        ln -s "${repo_dir}/${env_file}" "${worktrees_dir}/${worktree_name}/${env_file}" 2>/dev/null || :
    done
    local config
    for config in "${magic_configs[@]}"; do
        if [[ -e "${repo_dir}/${config}" ]]; then
            ln -s "${repo_dir}/${config}" "${worktrees_dir}/${worktree_name}/${config}"
        fi
    done

    echo "Created new worktree at ${worktrees_dir}/${worktree_name} based on branch '$base_branch_name'."
    git worktree list
}

# Create the autorun directory mirror for every worktree of this repo.
make_autorun_dirs() {
    if [[ $# -ne 0 ]]; then
        echo "Usage: make_autorun_dirs" >&2
        echo "Sync the autorun directories for all git worktrees of the current repository." >&2
        return 1
    fi

    local repo_dir
    repo_dir=$(git rev-parse --show-toplevel 2>/dev/null)
    local config_items=(.markdownlint.json .vscode cspell.json)
    local maestro_playbooks_repo="${HOME}/src/Maestro-Playbooks"

    if [[ -z "$repo_dir" ]]; then
        echo "Error: Not inside a git repository." >&2
        return 1
    fi

    local worktree_path autorun_dir
    for worktree_path in $(git worktree list --porcelain | grep '^worktree ' | awk '{print $2}'); do
        autorun_dir="${worktree_path/worktrees\//worktrees/autorun/}"
        if [[ ! -d "$autorun_dir" ]]; then
            mkdir -p "$autorun_dir"
            echo "Created autorun directory: $autorun_dir"
        fi
    done

    local config_item
    for config_item in "${config_items[@]}"; do
        if [[ -e "${maestro_playbooks_repo}/${config_item}" ]]; then
            ln -sf "${maestro_playbooks_repo}/${config_item}" ../worktrees/autorun/
        fi
    done
}

# Remove a git worktree (and optionally its autorun directory).
# Prompts before removing the autorun directory.
cleanup_work_tree_here() {
    if [[ $# -lt 1 || $# -gt 2 ]]; then
        echo "Usage: cleanup_work_tree_here <worktree-name> [--force]" >&2
        echo "Removes the specified git worktree and prunes it from the main repository." >&2
        return 1
    fi

    local worktree_name="$1"
    local force_remove="${2:-}"

    local repo_dir
    repo_dir=$(git rev-parse --show-toplevel 2>/dev/null)

    if [[ -z "$repo_dir" ]]; then
        echo "Error: Not inside a git repository." >&2
        return 1
    fi

    local num_of_worktrees
    num_of_worktrees=$(git worktree list | wc -l)
    if [[ $num_of_worktrees -le 1 ]]; then
        echo "Error: Cannot remove the last remaining worktree." >&2
        return 1
    fi

    local top_worktree git_common_dir
    top_worktree=$(git worktree list --porcelain | grep '^worktree ' | head -n1 | awk '{print $2}')
    git_common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
    if [[ "$git_common_dir" != ".git" ]]; then
        repo_dir="${git_common_dir%/.git}"
    fi

    local worktrees_dir
    worktrees_dir="${repo_dir}/../worktrees/$(basename "$repo_dir")"
    if [[ ! -d "${worktrees_dir}/${worktree_name}" ]]; then
        echo "Error: Worktree '${worktree_name}' does not exist." >&2
        return 1
    fi

    local worktree_path="${worktrees_dir}/${worktree_name}"
    local remove_args=(worktree remove "${worktree_path}")
    [[ -n "$force_remove" ]] && remove_args+=("$force_remove")
    if ! git "${remove_args[@]}"; then
        echo "Error: Failed to remove worktree '${worktree_name}'." >&2
        return 1
    fi
    git worktree prune
    echo "Removed worktree '${worktree_name}' and pruned from repository."

    cd "$top_worktree" || return 1
    echo "Current directory changed to top-level worktree: $top_worktree"
    git worktree list

    local autorun_dir="${worktree_path/worktrees\//worktrees/autorun/}"
    if [[ -d "$autorun_dir" ]]; then
        echo -n "Should we remove autorun directory: $autorun_dir? (y/n) [n] "
        local answer
        read -r answer
        if [[ "$answer" != "y" ]]; then
            echo "Skipping removal of autorun directory."
            return 0
        fi
        rm -rf "$autorun_dir"
        echo "Removed autorun directory: $autorun_dir"
    fi
}
