#!/bin/bash
# wiz_pr_review_state.sh — canonical per-PR state for alternating review agents.
# Source this file from pipeline drivers. All functions are Bash 3.2 compatible.

_wiz_review_state_dir_default="${HOME}/wizard/tmp/wiz-pr-review-state"
_wiz_review_history_root_default="${HOME}/wizard/worktrees/autorun-history"

wiz_review_state_dir() {
    printf '%s' "${WIZ_REVIEW_STATE_DIR:-${_wiz_review_state_dir_default}}"
}

wiz_review_state_file() {
    printf '%s/%s-%s.json' "$(wiz_review_state_dir)" "$1" "$2"
}

wiz_review_history_dir() {
    printf '%s/%s/%s-pr-%s' "${WIZ_REVIEW_HISTORY_ROOT:-${_wiz_review_history_root_default}}" "$1" "$1" "$2"
}

wiz_review_state_lock_dir() {
    printf '%s/.%s-%s.state-lock' "$(wiz_review_state_dir)" "$1" "$2"
}

# Atomic PID lockfiles via macOS shlock(1). shlock uses link(2), validates an
# existing owner's PID, and replaces only a lock whose owner is dead. Release
# rechecks the PID, so an old owner can never remove a successor's lock (ABA).
wiz_owner_lock_acquire() {
    local lock="$1" _stale_secs="$2" max_tries="${3:-1}" tries
    : "$_stale_secs"  # shlock recovers by dead PID rather than age
    (( max_tries < 2 )) && max_tries=2  # first probe validates/ages a dead lock
    command -v shlock >/dev/null 2>&1 || return 1
    mkdir -p "$(dirname "$lock")" || return 1
    tries=0
    while ! shlock -f "$lock" -p "$$" >/dev/null 2>&1; do
        tries=$((tries + 1))
        (( tries < max_tries )) || return 1
        if (( max_tries == 2 )); then sleep 1; else sleep 0.1; fi
    done
    printf '%s\x1f%s' "$lock" "$$"
}

wiz_owner_lock_release() {
    local handle="${1:-}" lock handle_pid owner_pid
    [[ -n "$handle" ]] || return 0
    lock="${handle%%$'\x1f'*}"
    handle_pid="${handle#*$'\x1f'}"
    [[ "$lock" != "$handle" ]] || return 1
    owner_pid="$(awk 'NR==1{print $1}' "$lock" 2>/dev/null || true)"
    [[ "$owner_pid" == "$handle_pid" && "$handle_pid" == "$$" ]] || return 0
    rm -f "$lock" 2>/dev/null || true
}

wiz_review_state_lock_acquire() {
    local repo="$1" pr="$2" lock
    lock="$(wiz_review_state_lock_dir "$repo" "$pr")"
    mkdir -p "$(wiz_review_state_dir)" || return 1
    wiz_owner_lock_acquire "$lock" "${WIZ_REVIEW_STATE_LOCK_STALE_SECS:-60}" 100
}

wiz_review_state_lock_release() {
    wiz_owner_lock_release "${1:-}"
}

wiz_review_launch_lock_acquire() {
    local repo="$1" pr="$2" lock
    lock="$(wiz_review_state_dir)/.${repo}-${pr}.lock"
    mkdir -p "$(wiz_review_state_dir)" || return 1
    wiz_owner_lock_acquire "$lock" "${WIZ_REVIEW_LAUNCH_LOCK_STALE_SECS:-900}" 1
}

wiz_review_launch_lock_release() {
    wiz_owner_lock_release "${1:-}"
}

wiz_review_agent_for_round() {
    local round="$1"
    if (( round % 2 == 1 )); then
        printf '%s' "${WIZ_REVIEW_ODD_AGENT:-claude-code}"
    else
        printf '%s' "${WIZ_REVIEW_EVEN_AGENT:-codex}"
    fi
}

wiz_review_find_thread_ts() {
    local repo="$1" pr="$2" state_dir sf
    state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    [[ -d "$state_dir" ]] || return 0
    for sf in "$state_dir"/*.json; do
        [[ -f "$sf" ]] || continue
        jq -r --arg repo "$repo" --arg pr "$pr" '
          select(.repo == $repo and ((.pr_number|tostring) == $pr))
          | .thread_ts // empty' "$sf" 2>/dev/null
    done | grep -E '.' | sort -n | tail -1
}

wiz_review_find_thread_agent() {
    local repo="$1" pr="$2" state_dir sf
    state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    [[ -d "$state_dir" ]] || return 0
    for sf in "$state_dir"/*.json; do
        [[ -f "$sf" ]] || continue
        jq -r --arg repo "$repo" --arg pr "$pr" '
          select(.repo == $repo and ((.pr_number|tostring) == $pr))
          | [(.thread_ts // ""),(.agent_type // "")] | @tsv' "$sf" 2>/dev/null
    done | grep -E '.' | sort -n | tail -1 | cut -f2
}

wiz_review_state_bootstrap() {
    # Create canonical state from a legacy single-agent review if needed.
    # Safe and idempotent; prints the state-file path.
    local repo="$1" pr="$2" sf round max_archive n d active_agent active_wt active_ar
    local head status thread agent_id wt ar agent_json tmp preferred_agent history_root active_id
    local legacy_watcher_running state_lock rc
    sf="$(wiz_review_state_file "$repo" "$pr")"
    if [[ -e "$sf" ]]; then
        if [[ -s "$sf" ]] && jq -e . "$sf" >/dev/null 2>&1; then
            printf '%s\n' "$sf"
            return 0
        fi
        echo "ERROR: malformed canonical review state at ${sf}; refusing automatic replacement" >&2
        return 1
    fi

    mkdir -p "$(dirname "$sf")" || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    # Another process may have created state while this process waited.
    if [[ -e "$sf" ]]; then
        if [[ -s "$sf" ]] && jq -e . "$sf" >/dev/null 2>&1; then
            wiz_review_state_lock_release "$state_lock"
            printf '%s\n' "$sf"
            return 0
        fi
        wiz_review_state_lock_release "$state_lock"
        echo "ERROR: malformed canonical review state at ${sf}; refusing automatic replacement" >&2
        return 1
    fi
    round=0; max_archive=0; active_agent=""; active_wt=""; active_ar=""; head=""
    agent_json='{}'
    preferred_agent="$(wiz_review_find_thread_agent "$repo" "$pr")"

    for agent in claude-code codex; do
        wt="${HOME}/wizard/worktrees/${repo}/${repo}-pr-${pr}-${agent}"
        ar="${HOME}/wizard/worktrees/autorun/${repo}/${repo}-pr-${pr}-${agent}"
        if [[ -d "$wt" ]]; then
            agent_id=""
            if [[ -x "${script_dir:-}/maestro_id.sh" ]]; then
                agent_id="$("${script_dir}/maestro_id.sh" "${repo}-pr-${pr}-${agent}" 2>/dev/null | tr -d '[:space:]')"
            fi
            agent_json="$(jq -nc --argjson old "$agent_json" --arg a "$agent" --arg id "$agent_id" \
                --arg wt "${repo}-pr-${pr}-${agent}" --arg dir "$wt" --arg ar "$ar" \
                '$old + {($a):{agent_id:$id,worktree_name:$wt,worktree_dir:$dir,autorun_dir:$ar}}')"
            # The newest Slack routing record knows which agent was active. If
            # unavailable, prefer the agent with the newest root summary.
            if [[ "$agent" == "$preferred_agent" ]]; then
                active_agent="$agent"; active_wt="$wt"; active_ar="$ar"
            elif [[ -z "$active_agent" ]]; then
                active_agent="$agent"; active_wt="$wt"; active_ar="$ar"
            elif [[ -z "$preferred_agent" && -f "$ar/REVIEW_SUMMARY.md" && "$ar/REVIEW_SUMMARY.md" -nt "$active_ar/REVIEW_SUMMARY.md" ]]; then
                active_agent="$agent"; active_wt="$wt"; active_ar="$ar"
            fi
            for d in "$ar"/review_*; do
                [[ -d "$d" ]] || continue
                n="${d##*/review_}"
                [[ "$n" =~ ^[0-9]+$ ]] && (( n > max_archive )) && max_archive="$n"
            done
        fi
    done

    # Include canonical cross-agent history when rebuilding after accidental
    # state-file loss. Legacy archives above remain supported for migration.
    history_root="$(wiz_review_history_dir "$repo" "$pr")"
    for d in "$history_root"/review_*; do
        [[ -d "$d" ]] || continue
        n="${d##*/review_}"
        [[ "$n" =~ ^[0-9]+$ ]] && (( n > max_archive )) && max_archive="$n"
    done

    if [[ -n "$active_agent" ]]; then
        round=$((max_archive + 1))
        head="$(git -C "$active_wt" rev-parse HEAD 2>/dev/null || true)"
    fi
    status="completed"
    # A pre-crucible in-flight review has no new watcher capable of updating
    # canonical state. Mark it distinctly so the re-review driver can reconcile
    # it once the legacy watcher exits and REVIEW_SUMMARY.md appears.
    legacy_watcher_running=false
    active_id="$(printf '%s' "$agent_json" | jq -r --arg a "$active_agent" '.[$a].agent_id // empty' 2>/dev/null)"
    if [[ -n "$active_id" ]] && ps -Ao command= \
        | grep -F "wiz_pr_watch_finalize.sh ${repo} ${pr} ${active_id}" \
        | grep -v grep >/dev/null 2>&1; then
        legacy_watcher_running=true
    fi
    if [[ "$round" -gt 0 ]] && { [[ ! -s "$active_ar/REVIEW_SUMMARY.md" ]] || [[ "$legacy_watcher_running" == "true" ]]; }; then
        status="legacy_running"
    fi
    [[ "$round" -eq 0 ]] && status="none"
    thread="$(wiz_review_find_thread_ts "$repo" "$pr")"

    tmp="${sf}.tmp.$$"
    rc=0
    jq -nc --arg repo "$repo" --argjson pr "$pr" --argjson round "$round" \
        --arg head "$head" --arg status "$status" --arg active "$active_agent" \
        --arg thread "$thread" --argjson agents "$agent_json" \
        '{schema:1,repo:$repo,pr_number:$pr,round:$round,head_sha:$head,status:$status,
          active_agent_type:(if $active=="" then null else $active end),
          thread_ts:(if $thread=="" then null else $thread end),agents:$agents,
          updated_at:(now|todate)}' > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    [[ $rc -eq 0 ]] || return "$rc"
    printf '%s\n' "$sf"
}

wiz_review_state_record_launch() {
    local repo="$1" pr="$2" round="$3" agent="$4" head="$5" thread="$6"
    local agent_id="$7" worktree_name="$8" worktree_dir="$9" autorun_dir="${10}"
    local launch_status="${11:-running}" attempt_id="${12:-}" sf tmp state_lock rc watch_deadline
    [[ -n "$attempt_id" ]] || attempt_id="r${round}-$(date +%s)-$$-${RANDOM}"
    watch_deadline=$(( $(date +%s) + ${WIZ_WATCH_MAX_SECONDS:-14400} ))
    sf="$(wiz_review_state_bootstrap "$repo" "$pr")" || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    tmp="${sf}.tmp.$$"
    rc=0
    jq --argjson round "$round" --arg agent "$agent" --arg head "$head" --arg thread "$thread" \
       --arg id "$agent_id" --arg wt "$worktree_name" --arg dir "$worktree_dir" --arg ar "$autorun_dir" \
       --arg status "$launch_status" --arg attempt "$attempt_id" --argjson deadline "$watch_deadline" '
       .round=$round | .head_sha=$head | .status=$status | .active_agent_type=$agent |
       .attempt_id=$attempt |
       .auto_resume_count=0 | .auto_resume_last_error_ms=0 |
       .watch_deadline_epoch=$deadline | .finalization_phases={} |
       .thread_ts=(if $thread=="" then .thread_ts else $thread end) |
       .watcher_pid=null | .watcher_log=null |
       .agents[$agent]={agent_id:$id,worktree_name:$wt,worktree_dir:$dir,autorun_dir:$ar} |
       .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_record_auto_resume() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" error_ms="$5"
    local sf state_lock tmp current_round current_attempt last_error rc count
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" && "$error_ms" =~ ^[0-9]+$ ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current_round="$(jq -r '.round // 0' "$sf" 2>/dev/null)"
    current_attempt="$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)"
    last_error="$(jq -r '.auto_resume_last_error_ms // 0' "$sf" 2>/dev/null)"
    if [[ "$current_round" != "$expected_round" || "$current_attempt" != "$expected_attempt" \
        || ! "$last_error" =~ ^[0-9]+$ || "$error_ms" -le "$last_error" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --argjson error_ms "$error_ms" '
      .auto_resume_count=((.auto_resume_count // 0) + 1) |
      .auto_resume_last_error_ms=$error_ms |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    count="$(jq -r '.auto_resume_count // 0' "$sf" 2>/dev/null)"
    wiz_review_state_lock_release "$state_lock"
    [[ $rc -eq 0 && "$count" =~ ^[0-9]+$ ]] || return 1
    printf '%s\n' "$count"
}

wiz_review_state_ensure_watch_deadline() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" max_seconds="$5"
    local sf state_lock tmp rc deadline
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" && "$max_seconds" =~ ^[0-9]+$ ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    deadline="$(jq -r '.watch_deadline_epoch // 0' "$sf" 2>/dev/null)"
    if [[ ! "$deadline" =~ ^[0-9]+$ || "$deadline" -le 0 ]]; then
        deadline=$(( $(date +%s) + max_seconds ))
        tmp="${sf}.tmp.$$"; rc=0
        jq --argjson deadline "$deadline" '.watch_deadline_epoch=$deadline | .updated_at=(now|todate)' \
            "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
        [[ $rc -eq 0 ]] || { wiz_review_state_lock_release "$state_lock"; return "$rc"; }
    fi
    wiz_review_state_lock_release "$state_lock"
    printf '%s\n' "$deadline"
}

wiz_review_state_claim_finalization_phase() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" phase="$5"
    local sf state_lock tmp rc existing
    [[ "$phase" =~ ^[a-z_]+$ ]] || return 1
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    existing="$(jq -r --arg phase "$phase" '.finalization_phases[$phase] // empty' "$sf" 2>/dev/null)"
    if [[ -n "$existing" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 3
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --arg phase "$phase" '
      .finalization_phases=(.finalization_phases // {}) |
      .finalization_phases[$phase]={status:"claimed",at:(now|todate)} |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_mark_finalization_phase() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" phase="$5"
    local sf state_lock tmp rc
    [[ "$phase" =~ ^[a-z_]+$ ]] || return 1
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --arg phase "$phase" '
      .finalization_phases=(.finalization_phases // {}) |
      .finalization_phases[$phase]={status:"posted",at:(now|todate)} |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_record_watcher() {
    local repo="$1" pr="$2" expected_round="$3" pid="$4" watcher_log="${5:-}" expected_attempt="${6:-}"
    local sf state_lock tmp current current_attempt rc
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current="$(jq -r '.round // 0' "$sf" 2>/dev/null)"
    current_attempt="$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)"
    if [[ "$current" != "$expected_round" || ( -n "$expected_attempt" && "$current_attempt" != "$expected_attempt" ) ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 1
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --arg pid "$pid" --arg log "$watcher_log" '
      .watcher_pid=($pid|tonumber) | .watcher_log=(if $log=="" then null else $log end) |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_mark_status() {
    local repo="$1" pr="$2" round="$3" status="$4" expected_attempt="${5:-}" sf tmp state_lock rc
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    # The round check and replacement happen under the same state lock, so a
    # stale watcher cannot race a newer launch between read and atomic rename.
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$round" ]] \
        || { [[ -n "$expected_attempt" ]] && [[ "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" ]]; }; then
        wiz_review_state_lock_release "$state_lock"
        [[ -n "$expected_attempt" ]] && return 2
        return 0
    fi
    tmp="${sf}.tmp.$$"
    rc=0
    jq --arg s "$status" '
      .status=$s |
      if ($s=="completed" or $s=="failed") then .watcher_pid=null else . end |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_get() {
    local repo="$1" pr="$2" expr="$3" sf
    sf="$(wiz_review_state_bootstrap "$repo" "$pr")" || return 1
    jq -r "$expr" "$sf"
}
