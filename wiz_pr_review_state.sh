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

_wiz_review_thread_state_dir_default="${HOME}/wizard/tmp/wiz-pr-state"

wiz_review_thread_state_dir() {
    printf '%s' "${WIZ_PR_STATE_DIR:-${_wiz_review_thread_state_dir_default}}"
}

wiz_review_thread_state_file() {
    printf '%s/%s.json' "$(wiz_review_thread_state_dir)" "$1"
}

wiz_review_thread_attempt_dir() {
    printf '%s/%s' "$(wiz_review_thread_state_dir)" "$1"
}

wiz_review_thread_attempt_file() {
    printf '%s/%s-%s.json' "$(wiz_review_thread_attempt_dir "$3")" "$1" "$2"
}

# Persist the Slack-thread routing record for exactly one review attempt. Keep
# one record per repo/PR beneath the thread so multi-PR review threads cannot
# overwrite each other; the legacy top-level file remains a best-effort
# backstop for older read paths.
wiz_review_thread_state_write() {
    local repo="$1" pr="$2" thread="$3" agent="$4" round="$5" attempt="$6" head="$7"
    local agent_id="$8" worktree_name="$9" worktree_dir="${10}" autorun_dir="${11}"
    local dir attempt_dir attempt_file attempt_tmp legacy_tmp rc
    [[ -n "$repo" && "$pr" =~ ^[0-9]+$ && -n "$thread" && -n "$agent" \
        && "$round" =~ ^[0-9]+$ && -n "$attempt" && -n "$head" \
        && -n "$agent_id" && -n "$worktree_name" && -n "$worktree_dir" \
        && -n "$autorun_dir" ]] || return 1
    dir="$(wiz_review_thread_state_dir)"
    attempt_dir="$(wiz_review_thread_attempt_dir "$thread")"
    mkdir -p "$attempt_dir" || return 1
    attempt_file="$(wiz_review_thread_attempt_file "$repo" "$pr" "$thread")"
    attempt_tmp="${attempt_dir}/.${repo}-${pr}.$$.tmp"
    legacy_tmp="${dir}/.${thread}.$$.tmp"
    rc=0
    jq -nc \
        --arg repo "$repo" --arg pr "$pr" --arg thread "$thread" \
        --arg agent "$agent" --argjson round "$round" --arg attempt "$attempt" \
        --arg head "$head" --arg id "$agent_id" --arg wt "$worktree_name" \
        --arg wt_dir "$worktree_dir" --arg autorun "$autorun_dir" \
        '{schema:1,repo:$repo,pr_number:$pr,thread_ts:$thread,agent_type:$agent,
          review_round:$round,attempt_id:$attempt,head_sha:$head,agent_id:$id,
          worktree_name:$wt,worktree_dir:$wt_dir,autorun_dir:$autorun}' \
        > "$attempt_tmp" && mv "$attempt_tmp" "$attempt_file" || rc=$?
    if [[ $rc -eq 0 ]]; then
        cp "$attempt_file" "$legacy_tmp" \
            && mv "$legacy_tmp" "$(wiz_review_thread_state_file "$thread")" || rc=$?
    fi
    rm -f "$attempt_tmp" "$legacy_tmp" 2>/dev/null || true
    return "$rc"
}

# Snapshot/restore the two routing paths affected by a launch. The exact
# per-PR record is protected by the per-PR launch lock. The legacy top-level
# backstop is shared by multi-PR threads, so restore it only while it still
# points at this repo/PR; never clobber a newer record for another PR.
wiz_review_thread_state_snapshot() {
    local repo="$1" pr="$2" thread="$3" backup_dir="$4"
    local exact_file legacy_file
    [[ -n "$repo" && "$pr" =~ ^[0-9]+$ && -n "$thread" && -n "$backup_dir" ]] || return 1
    mkdir -p "$backup_dir" || return 1
    exact_file="$(wiz_review_thread_attempt_file "$repo" "$pr" "$thread")"
    legacy_file="$(wiz_review_thread_state_file "$thread")"
    if [[ -e "$exact_file" ]]; then
        cp "$exact_file" "$backup_dir/exact.json" || return 1
    else
        : > "$backup_dir/exact.absent" || return 1
    fi
    if [[ -e "$legacy_file" ]]; then
        cp "$legacy_file" "$backup_dir/legacy.json" || return 1
    else
        : > "$backup_dir/legacy.absent" || return 1
    fi
}

wiz_review_thread_state_restore() {
    local repo="$1" pr="$2" thread="$3" backup_dir="$4"
    local exact_file legacy_file tmp current_repo current_pr
    [[ -n "$repo" && "$pr" =~ ^[0-9]+$ && -n "$thread" && -d "$backup_dir" ]] || return 1
    exact_file="$(wiz_review_thread_attempt_file "$repo" "$pr" "$thread")"
    legacy_file="$(wiz_review_thread_state_file "$thread")"
    if [[ -f "$backup_dir/exact.json" ]]; then
        mkdir -p "$(dirname "$exact_file")" || return 1
        tmp="$(dirname "$exact_file")/.restore-${repo}-${pr}.$$.tmp"
        cp "$backup_dir/exact.json" "$tmp" && mv "$tmp" "$exact_file" || { rm -f "$tmp"; return 1; }
    elif [[ -f "$backup_dir/exact.absent" ]]; then
        rm -f "$exact_file" 2>/dev/null || return 1
        rmdir "$(dirname "$exact_file")" 2>/dev/null || true
    fi
    current_repo=""
    current_pr=""
    if [[ -s "$legacy_file" ]]; then
        current_repo="$(jq -r '.repo // empty' "$legacy_file" 2>/dev/null)"
        current_pr="$(jq -r '.pr_number // empty' "$legacy_file" 2>/dev/null)"
    fi
    # Another review may have claimed the shared legacy pointer after this
    # launch wrote it. Leave that newer record alone.
    if [[ -s "$legacy_file" && ( "$current_repo" != "$repo" || "$current_pr" != "$pr" ) ]]; then
        return 0
    fi
    if [[ -f "$backup_dir/legacy.json" ]]; then
        tmp="$(dirname "$legacy_file")/.restore-${thread}.$$.tmp"
        cp "$backup_dir/legacy.json" "$tmp" && mv "$tmp" "$legacy_file" || { rm -f "$tmp"; return 1; }
    elif [[ -f "$backup_dir/legacy.absent" ]]; then
        rm -f "$legacy_file" 2>/dev/null || return 1
    fi
}

# Synchronize an isolated persistent review worktree to the exact GitHub PR head.
# Do not trust @{upstream}: gh pr checkout --branch may point it at the generated
# review branch, which remains frozen after later PR pushes. Fetching the pull ref
# also handles force-pushes and fork-backed PRs without touching a developer tree.
# Optional fifth argument injects a fetch URL for deterministic fixtures.
wiz_review_sync_worktree_to_pr_head() {
    local repo="$1" pr="$2" worktree_dir="$3" expected_head="$4"
    local fetch_url="${5:-git@github.com:story-wizard/${repo}.git}"
    local fetched_head actual_head

    [[ -n "$repo" && "$pr" =~ ^[0-9]+$ && -d "$worktree_dir" \
        && "$expected_head" =~ ^[0-9a-f]{40}$ ]] || return 1

    git -C "$worktree_dir" fetch --no-tags "$fetch_url" "refs/pull/${pr}/head" \
        >/dev/null 2>&1 || return 1
    fetched_head="$(git -C "$worktree_dir" rev-parse FETCH_HEAD 2>/dev/null)" || return 1
    [[ "$fetched_head" == "$expected_head" ]] || return 2

    git -C "$worktree_dir" reset --hard "$fetched_head" >/dev/null 2>&1 || return 1
    actual_head="$(git -C "$worktree_dir" rev-parse HEAD 2>/dev/null)" || return 1
    [[ "$actual_head" == "$expected_head" ]]
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
    local repo="$1" pr="$2" max_tries="${3:-2}" lock
    lock="$(wiz_review_state_dir)/.${repo}-${pr}.lock"
    mkdir -p "$(wiz_review_state_dir)" || return 1
    wiz_owner_lock_acquire "$lock" "${WIZ_REVIEW_LAUNCH_LOCK_STALE_SECS:-900}" "$max_tries"
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

# Thread discovery prefers exact per-PR records (<thread_ts>/<repo>-<pr>.json):
# in a multi-PR Slack thread the legacy top-level pointer is rewritten by every
# launch, so the last-launched PR would be the only one discoverable. Matching
# exact records by repo AND pr number first means a legacy pointer for PR B can
# never hide PR A's thread. Legacy top-level files remain the fallback for
# pre-migration threads. Within each tier the latest thread_ts wins (the
# historical single-thread semantics for repeated reviews).
wiz_review_find_thread_ts() {
    local repo="$1" pr="$2" state_dir sf exact
    state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    [[ -d "$state_dir" ]] || return 0
    exact="$(
        for sf in "$state_dir"/*/"${repo}-${pr}.json"; do
            [[ -f "$sf" ]] || continue
            jq -r --arg repo "$repo" --arg pr "$pr" '
              select(.repo == $repo and ((.pr_number|tostring) == $pr))
              | .thread_ts // empty' "$sf" 2>/dev/null
        done | grep -E '.' | sort -n | tail -1
    )"
    if [[ -n "$exact" ]]; then
        printf '%s\n' "$exact"
        return 0
    fi
    for sf in "$state_dir"/*.json; do
        [[ -f "$sf" ]] || continue
        jq -r --arg repo "$repo" --arg pr "$pr" '
          select(.repo == $repo and ((.pr_number|tostring) == $pr))
          | .thread_ts // empty' "$sf" 2>/dev/null
    done | grep -E '.' | sort -n | tail -1
}

wiz_review_find_thread_agent() {
    local repo="$1" pr="$2" state_dir sf exact
    state_dir="${WIZ_PR_STATE_DIR:-${HOME}/wizard/tmp/wiz-pr-state}"
    [[ -d "$state_dir" ]] || return 0
    exact="$(
        for sf in "$state_dir"/*/"${repo}-${pr}.json"; do
            [[ -f "$sf" ]] || continue
            jq -r --arg repo "$repo" --arg pr "$pr" '
              select(.repo == $repo and ((.pr_number|tostring) == $pr))
              | [(.thread_ts // ""),(.agent_type // "")] | @tsv' "$sf" 2>/dev/null
        done | grep -E '.' | sort -n | tail -1
    )"
    if [[ -n "$exact" ]]; then
        printf '%s' "$exact" | cut -f2
        return 0
    fi
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
       .manual_resume_count=0 | .recovery_generation=0 |
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
    local expected_generation="${6:-}" sf state_lock tmp current_round current_attempt current_generation last_error rc count
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" && "$error_ms" =~ ^[0-9]+$ ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current_round="$(jq -r '.round // 0' "$sf" 2>/dev/null)"
    current_attempt="$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)"
    current_generation="$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)"
    last_error="$(jq -r '.auto_resume_last_error_ms // 0' "$sf" 2>/dev/null)"
    if [[ "$current_round" != "$expected_round" || "$current_attempt" != "$expected_attempt" \
        || ! "$last_error" =~ ^[0-9]+$ || "$error_ms" -le "$last_error" \
        || ( -n "$expected_generation" && "$current_generation" != "$expected_generation" ) ]]; then
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

wiz_review_state_begin_manual_resume() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" deadline="$5" expected_status="$6"
    local error_marker="${7:-0}"
    local sf state_lock tmp rc generation
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" && "$deadline" =~ ^[0-9]+$ && "$error_marker" =~ ^[0-9]+$ ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" \
        || "$(jq -r '.status // empty' "$sf" 2>/dev/null)" != "$expected_status" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --argjson deadline "$deadline" --argjson error_marker "$error_marker" '
      .manual_resume_count=((.manual_resume_count // 0) + 1) |
      .recovery_generation=((.recovery_generation // 0) + 1) |
      .auto_resume_count=0 | .auto_resume_last_error_ms=$error_marker |
      .watch_deadline_epoch=$deadline | .status="launching" |
      # Manual recovery never repeats artifact side effects whose prior claim is
      # uncertain. Treat artifact claims as publication-complete. Preserve an
      # uncertain final-review claim permanently: the prior prompt may still
      # submit later, so recovery may reconcile but must never resend it.
      .finalization_phases=(.finalization_phases // {}) |
      .finalization_phases.slack_artifacts=(
        if .finalization_phases.slack_artifacts.status=="claimed"
        then {status:"posted",recovered_from_uncertain_claim:true,at:(now|todate)}
        else .finalization_phases.slack_artifacts end) |
      .finalization_phases.github_artifacts=(
        if .finalization_phases.github_artifacts.status=="claimed"
        then {status:"posted",recovered_from_uncertain_claim:true,at:(now|todate)}
        else .finalization_phases.github_artifacts end) |
      .watcher_pid=null | .watcher_log=null |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    generation="$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)"
    wiz_review_state_lock_release "$state_lock"
    [[ $rc -eq 0 && "$generation" =~ ^[0-9]+$ ]] || return 1
    printf '%s\n' "$generation"
}

wiz_review_state_ensure_watch_deadline() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" max_seconds="$5"
    local expected_generation="${6:-}" sf state_lock tmp rc deadline current_generation
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" && "$max_seconds" =~ ^[0-9]+$ ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current_generation="$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)"
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" \
        || ( -n "$expected_generation" && "$current_generation" != "$expected_generation" ) ]]; then
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
    local expected_generation="${6:-}" sf state_lock tmp rc existing current_generation
    [[ "$phase" =~ ^[a-z_]+$ ]] || return 1
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current_generation="$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)"
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" \
        || ( -n "$expected_generation" && "$current_generation" != "$expected_generation" ) ]]; then
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
    local expected_generation="${6:-}" sf state_lock tmp rc current_generation
    [[ "$phase" =~ ^[a-z_]+$ ]] || return 1
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current_generation="$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)"
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" \
        || ( -n "$expected_generation" && "$current_generation" != "$expected_generation" ) ]]; then
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
    local expected_generation="${7:-0}"
    [[ -n "$expected_attempt" ]] || return 1
    # PID recording and launching→running are one CAS operation, preventing a
    # fast terminal watcher from being regressed to running by its parent.
    wiz_review_state_activate_manual_watcher "$repo" "$pr" "$expected_round" "$expected_attempt" \
        "$expected_generation" "$pid" "$watcher_log"
}

wiz_review_state_activate_manual_watcher() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" expected_generation="$5"
    local pid="$6" watcher_log="$7" sf state_lock tmp rc
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" && "$pid" =~ ^[0-9]+$ ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" \
        || "$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)" != "$expected_generation" \
        || "$(jq -r '.status // empty' "$sf" 2>/dev/null)" != launching ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --arg pid "$pid" --arg log "$watcher_log" '
      .status="running" | .watcher_pid=($pid|tonumber) |
      .watcher_log=(if $log=="" then null else $log end) |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_mark_status_if() {
    local repo="$1" pr="$2" expected_round="$3" expected_attempt="$4" expected_generation="$5"
    local expected_status="$6" new_status="$7" sf state_lock tmp rc
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$expected_round" \
        || "$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)" != "$expected_attempt" \
        || "$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)" != "$expected_generation" \
        || "$(jq -r '.status // empty' "$sf" 2>/dev/null)" != "$expected_status" ]]; then
        wiz_review_state_lock_release "$state_lock"
        return 2
    fi
    tmp="${sf}.tmp.$$"; rc=0
    jq --arg s "$new_status" '
      .status=$s |
      if ($s=="completed" or $s=="failed") then .watcher_pid=null else . end |
      .updated_at=(now|todate)' "$sf" > "$tmp" && mv "$tmp" "$sf" || rc=$?
    wiz_review_state_lock_release "$state_lock"
    return "$rc"
}

wiz_review_state_mark_status() {
    local repo="$1" pr="$2" round="$3" status="$4" expected_attempt="${5:-}" expected_generation="${6:-}"
    local sf tmp state_lock rc current_attempt current_generation
    sf="$(wiz_review_state_file "$repo" "$pr")"
    [[ -s "$sf" ]] || return 1
    state_lock="$(wiz_review_state_lock_acquire "$repo" "$pr")" || return 1
    current_attempt="$(jq -r '.attempt_id // empty' "$sf" 2>/dev/null)"
    current_generation="$(jq -r '.recovery_generation // 0' "$sf" 2>/dev/null)"
    # Round, attempt, and optional recovery generation are compared under the
    # same state lock as the atomic replacement.
    if [[ "$(jq -r '.round // 0' "$sf" 2>/dev/null)" != "$round" \
        || ( -n "$expected_attempt" && "$current_attempt" != "$expected_attempt" ) \
        || ( -n "$expected_generation" && "$current_generation" != "$expected_generation" ) ]]; then
        wiz_review_state_lock_release "$state_lock"
        [[ -n "$expected_attempt" || -n "$expected_generation" ]] && return 2
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
