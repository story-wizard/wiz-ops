#!/bin/bash

# maestro_watch.sh — Watch a Maestro Auto Run agent until it is FULLY done.
#
# Why this exists: Maestro's `session list` / `show agent` report the agent as
# idle during an Auto Run, because each iteration runs as a *detached headless*
# `claude --print` process rather than a tracked desktop session. This watcher
# follows that process by agent ID. Since Auto Run exits after every task and
# relaunches for the next one, we only declare "fully done" once the process has
# stayed gone for grace_seconds with no new iteration spawning.
#
# Usage: maestro_watch.sh <agent_id> [grace_seconds] [poll_seconds] [agent_type] [start_timeout] [max_seconds] [autorun_dir] [worktree_dir]

set -uo pipefail   # intentionally NO -e: pgrep returning non-zero is normal

usage() {
    cat <<EOF
Usage: $(basename "$0") <agent_id> [grace_seconds] [poll_seconds]

Watch a Maestro Auto Run agent until it is fully done.

Arguments:
    agent_id        The UUID of the Maestro agent to watch
    grace_seconds   How long the process must stay gone before "done" (default 60)
    poll_seconds    Polling interval (default 5)

Options:
  -h, --help        Show this help message and exit

Env overrides (see _maestro_env.sh and .env.example):
    MAESTRO_USER_DATA   Maestro data dir
    MAESTRO_CLI_JS      Path to maestro-cli.js (MAESTRO_JS still honored)

Examples:
  $(basename "$0") 14fcd1d2-19ee-482b-8e4a-b521aca9a7e6
  $(basename "$0") 14fcd1d2-19ee-482b-8e4a-b521aca9a7e6 120 10
EOF
}

die() {
    echo "Error: $*" >&2
    exit 1
}

# ---------- argument parsing ----------

if [[ $# -ge 1 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
    usage
    exit 0
fi

status_only=false
if [[ "${1:-}" == "--is-running" ]]; then
    status_only=true
    agent="${2:-}"
    agent_type="${3:-}"
    fallback_cwd="${4:-}"
    fallback_autorun="${5:-}"
    status_idle_grace="${6:-60}"
    grace=0; poll=1; start_timeout=0; max_seconds=1
else
    agent="${1:-}"
    grace="${2:-60}"
    poll="${3:-5}"
    agent_type="${4:-}"
    start_timeout="${5:-300}"
    max_seconds="${6:-7200}"
    fallback_autorun="${7:-}"
    fallback_cwd="${8:-}"
fi
fallback_autorun="${fallback_autorun:-}"
fallback_cwd="${fallback_cwd:-}"

if [[ -z "$agent" ]]; then
    echo "Error: agent_id is required." >&2
    usage >&2
    exit 1
fi

[[ "$grace" =~ ^[0-9]+$ ]] || die "grace_seconds must be numeric, got '${grace}'"
[[ "$poll" =~ ^[0-9]+$ ]] || die "poll_seconds must be numeric, got '${poll}'"
[[ "$start_timeout" =~ ^[0-9]+$ ]] || die "start_timeout must be numeric, got '${start_timeout}'"
[[ "$max_seconds" =~ ^[0-9]+$ ]] || die "max_seconds must be numeric, got '${max_seconds}'"
if [[ "$status_only" == "true" ]]; then
    [[ "$status_idle_grace" =~ ^[0-9]+$ ]] || die "status idle grace must be numeric"
fi

# ---------- resolve Maestro CLI ----------

# maestro_dev_cli is a shell alias, which is NOT available inside scripts, so we
# invoke the real binary directly. The shared helper resolves the CLI path and
# sources any sibling .env. Honor the legacy MAESTRO_JS as an alias for
# MAESTRO_CLI_JS so existing environments keep working.
: "${MAESTRO_CLI_JS:=${MAESTRO_JS:-}}"
[[ -n "$MAESTRO_CLI_JS" ]] && export MAESTRO_CLI_JS

_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_maestro_env.sh
source "${_script_dir}/_maestro_env.sh" || die "Cannot source _maestro_env.sh"

# This watcher reads the history file straight off disk, so it always needs a
# user-data dir. When the installed app is used the helper leaves
# MAESTRO_USER_DATA unset, so fall back to the app's default location.
export MAESTRO_USER_DATA="${MAESTRO_USER_DATA:-$HOME/Library/Application Support/maestro}"
cli=(node "$maestro_cli")

hist="$MAESTRO_USER_DATA/history/${agent}.json"

# Resolve type + cwd from Maestro so completion detection works for both
# Claude Code and Codex. The optional fourth arg is a fallback for older CLI
# output, not the source of truth.
watch_started="$(date +%s)"
agent_json=""
for _meta_try in 1 2 3 4 5; do
    _meta_remaining=$(( max_seconds - ($(date +%s) - watch_started) ))
    (( _meta_remaining > 0 )) || break
    (( _meta_remaining < 3 )) && _meta_timeout="$_meta_remaining" || _meta_timeout=3
    agent_json="$(python3 - "$maestro_cli" "$agent" "$_meta_timeout" <<'PY'
import subprocess, sys
try:
    proc = subprocess.run(
        ["node", sys.argv[1], "show", "agent", "--json", sys.argv[2]],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=int(sys.argv[3]), check=False)
    if proc.returncode == 0:
        sys.stdout.write(proc.stdout)
except subprocess.TimeoutExpired:
    pass
PY
)"
    printf '%s' "$agent_json" | jq -e 'type=="object"' >/dev/null 2>&1 && break
    agent_json=""
    _meta_remaining=$(( max_seconds - ($(date +%s) - watch_started) ))
    (( _meta_remaining > 0 )) && sleep 1
done
name="$(printf '%s' "$agent_json" | jq -r '.name // empty' 2>/dev/null)"
resolved_type="$(printf '%s' "$agent_json" | jq -r '.toolType // empty' 2>/dev/null)"
agent_cwd="$(printf '%s' "$agent_json" | jq -r '.cwd // empty' 2>/dev/null)"
autorun_dir="$(printf '%s' "$agent_json" | jq -r '.autoRunFolderPath // empty' 2>/dev/null)"
[[ -n "$agent_cwd" ]] || agent_cwd="$fallback_cwd"
[[ -n "$autorun_dir" ]] || autorun_dir="$fallback_autorun"
[[ -n "$resolved_type" ]] && agent_type="$resolved_type"
[[ -z "$name" ]] && name="$agent"

# ---------- helpers ----------

ts() { date '+%H:%M:%S'; }
pids() {
    case "$agent_type" in
        claude-code|"")
            pgrep -f "claude --print.*$agent" 2>/dev/null
            ;;
        codex)
            # Maestro launches: codex -C <unique-worktree> exec ... . Codex's
            # session id is not the Maestro agent id, so cwd is the stable key.
            [[ -n "$agent_cwd" ]] || return 0
            ps -Ao pid=,command= | awk -v cwd="$agent_cwd" '
                index($0,"awk -v cwd=")==0 && index($0,"maestro_watch.sh")==0 &&
                index($0,"codex") && index($0,"exec") && index($0,cwd) {print $1}'
            ;;
        *)
            # Best-effort fallback for future Maestro agent types.
            [[ -n "$agent_cwd" ]] || return 0
            ps -Ao pid=,command= | awk -v cwd="$agent_cwd" 'index($0,cwd) {print $1}'
            ;;
    esac
}

if [[ "$status_only" == "true" ]]; then
    # Use the same continuous-idle grace as normal completion. Auto Run processes
    # disappear between iterations; one instantaneous/five-second sample is not
    # proof of idleness and could permit an overlapping retry.
    status_started="$(date +%s)"
    while true; do
        [[ -n "$(pids | head -1)" ]] && exit 0
        (( $(date +%s) - status_started >= status_idle_grace )) && exit 1
        sleep 2
    done
fi

# Count completed-task entries in the agent history file (best-effort).
hist_count() {
    [[ -f "$hist" ]] || { echo 0; return; }
    python3 -c 'import sys,json
try:
    d=json.load(open(sys.argv[1]))
    print(len(d.get("entries",[])) if isinstance(d,dict) else 0)
except Exception:
    print(0)' "$hist" 2>/dev/null || echo 0
}

autorun_complete() {
    local playbook_dir
    local files
    [[ -n "$autorun_dir" && -s "$autorun_dir/REVIEW_SUMMARY.md" ]] || return 1
    playbook_dir="$autorun_dir/development/code-review"
    shopt -s nullglob
    files=("$playbook_dir"/*.md)
    shopt -u nullglob
    [[ ${#files[@]} -gt 0 ]] || return 1
    # Ignore checkbox examples inside fenced code blocks, matching progress.sh.
    awk '
      /^[[:space:]]*```/ { fenced = !fenced; next }
      !fenced && /^[[:space:]]*-[[:space:]]*\[[ xX]\]/ {
        total++
        if ($0 ~ /\[[[:space:]]\]/) open++
      }
      END { exit !(total > 0 && open == 0) }
    ' "${files[@]}"
}

# ---------- watch loop ----------

start_tasks="$(hist_count)"
iterations=0
seen_running=0
last_pid=""

watch_sleep() {
    local requested="$1" elapsed remaining sleep_for
    elapsed=$(( $(date +%s) - watch_started ))
    remaining=$(( max_seconds - elapsed ))
    (( remaining > 0 )) || die "watch timed out after ${elapsed}s"
    sleep_for="$requested"
    (( sleep_for > remaining )) && sleep_for="$remaining"
    sleep "$sleep_for"
    elapsed=$(( $(date +%s) - watch_started ))
    (( elapsed <= max_seconds )) || die "watch timed out after ${elapsed}s"
}

echo "[$(ts)] Watching '$name'"
echo "          agent : $agent"
echo "          type  : ${agent_type:-unknown}"
echo "          cwd   : ${agent_cwd:-unknown}"
echo "          grace : ${grace}s   poll: ${poll}s   completed tasks so far: $start_tasks"

while true; do
    now_epoch="$(date +%s)"
    elapsed=$((now_epoch - watch_started))
    (( elapsed <= max_seconds )) || die "watch timed out after ${elapsed}s"
    cur="$(pids | tr '\n' ' ' | sed 's/ *$//')"

    if [[ -n "$cur" ]]; then
        if [[ "$seen_running" -eq 0 || "$cur" != "$last_pid" ]]; then
            iterations=$((iterations + 1))
            echo "[$(ts)] > iteration #$iterations running (pid: $cur)"
        fi
        seen_running=1
        last_pid="$cur"
        watch_sleep "$poll"
        continue
    fi

    # No process right now. A very fast Auto Run may finish before this watcher
    # observes its process; completed playbooks + summary are an independent,
    # agent-neutral completion signal and enter the same idle grace window.
    if [[ "$seen_running" -eq 0 ]]; then
        if autorun_complete; then
            echo "[$(ts)] ... completed playbooks + summary already present; entering idle grace"
            seen_running=1
            continue
        fi
        if (( elapsed >= start_timeout )); then
            # A resumed iteration can fail before the first process poll. Return
            # the recoverable idle/incomplete code; the finalizer will resume
            # only if a new explicit Maestro error-pause record exists.
            echo "Error: no agent process or completed artifacts observed within ${start_timeout}s" >&2
            exit 75
        fi
        echo "[$(ts)] ... not started yet — waiting for first iteration"
        watch_sleep "$poll"
        continue
    fi

    # Seen it run, now gone -> grace countdown, watching for the next iteration.
    echo "[$(ts)] || no process — grace window ${grace}s (watching for next iteration)..."
    waited=0
    respawned=0
    grace_started="$(date +%s)"
    while (( waited < grace )); do
        grace_remaining=$(( grace - waited ))
        (( grace_remaining < poll )) && grace_sleep="$grace_remaining" || grace_sleep="$poll"
        watch_sleep "$grace_sleep"
        waited=$(( $(date +%s) - grace_started ))
        if [[ -n "$(pids)" ]]; then
            echo "[$(ts)] ~ next iteration spawned after ${waited}s — still going"
            respawned=1
            break
        fi
        echo "[$(ts)]    still gone ${waited}/${grace}s"
    done
    [[ "$respawned" -eq 1 ]] && continue

    # Grace fully elapsed with no respawn -> fully done only when the review
    # playbooks and required summary are actually complete. An agent crash that
    # merely became idle is a terminal watcher failure, not success.
    if ! autorun_complete; then
        # Exit 75 is intentionally distinct: the finalizer may inspect Maestro's
        # history and resume an explicit error-paused Auto Run. Other watcher
        # failures (startup timeout, overall timeout, metadata errors) remain
        # ordinary terminal failures and must not be blindly resumed.
        echo "Error: agent became idle but required playbooks/artifacts are incomplete" >&2
        exit 75
    fi
    end_tasks="$(hist_count)"
    delta=$((end_tasks - start_tasks))
    echo "[$(ts)] DONE — no new iteration for ${grace}s"
    echo "          iterations observed : $iterations"
    echo "          tasks completed     : $delta (total now $end_tasks)"
    "${cli[@]}" notify toast "Auto Run complete: $name" \
        "$iterations iteration(s), $delta task(s) done — idle ${grace}s" 2>/dev/null || true
    break
done
