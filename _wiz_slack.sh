#!/bin/bash
# _wiz_slack.sh — shared Slack helpers for the Wiz PR-review pipeline.
# Source (do NOT execute). Requires jq + curl. Reads the bot token from
# ~/.hermes/.env (SLACK_BOT_TOKEN). Sets WIZ_SLACK_TOKEN for the helpers.
#
# Functions:
#   wiz_slack_post  <channel> <thread_ts|""> <text>   -> echoes message ts
#   wiz_slack_upload <channel> <thread_ts|""> <intro> <file...> 

_wiz_hermes_env="${HERMES_HOME:-${HOME}/.hermes}/.env"
if [[ -f "$_wiz_hermes_env" ]]; then
    set -a; # shellcheck disable=SC1090
    source "$_wiz_hermes_env"; set +a
fi
WIZ_SLACK_TOKEN="${SLACK_BOT_TOKEN%%,*}"

wiz_slack_ready() { [[ -n "${WIZ_SLACK_TOKEN:-}" ]]; }

_wiz_slack_api() {
    local method="$1"; shift
    curl -sS -X POST "https://slack.com/api/${method}" \
        -H "Authorization: Bearer ${WIZ_SLACK_TOKEN}" "$@"
}

wiz_slack_post() {
    # wiz_slack_post <channel> <thread_ts|""> <text>
    local ch="$1" th="$2" text="$3" payload
    payload=$(jq -nc --arg ch "$ch" --arg txt "$text" --arg th "$th" \
        'if $th == "" then {channel:$ch, text:$txt} else {channel:$ch, text:$txt, thread_ts:$th} end')
    _wiz_slack_api chat.postMessage -H "Content-type: application/json; charset=utf-8" --data "$payload" \
        | jq -r '.ts // empty'
}

_wiz_slack_upload_one() {
    # _wiz_slack_upload_one <filepath>  -> echoes file_id on success
    local fp="$1" fname fsize up url fid
    fname="$(basename "$fp")"; fsize="$(wc -c < "$fp" | tr -d " ")"
    up=$(_wiz_slack_api files.getUploadURLExternal \
        --data-urlencode "filename=${fname}" --data-urlencode "length=${fsize}")
    [[ "$(echo "$up" | jq -r .ok)" == "true" ]] || return 1
    url="$(echo "$up" | jq -r .upload_url)"; fid="$(echo "$up" | jq -r .file_id)"
    curl -sS -X POST "$url" -F "filename=@${fp}" >/dev/null || return 1
    echo "$fid"
}

wiz_slack_upload() {
    # wiz_slack_upload <channel> <thread_ts|""> <intro> <file...>
    local ch="$1" th="$2" intro="$3"; shift 3
    local ids=() fp fid payload
    for fp in "$@"; do
        if fid="$(_wiz_slack_upload_one "$fp")"; then ids+=("$fid|$(basename "$fp")"); fi
    done
    [[ ${#ids[@]} -gt 0 ]] || return 2
    local files_json
    files_json=$(printf "%s\n" "${ids[@]}" | jq -R "split(\"|\") | {id: .[0], title: .[1]}" | jq -s .)
    payload=$(jq -nc --argjson files "$files_json" --arg ch "$ch" --arg txt "$intro" --arg th "$th" \
        'if $th == "" then {files:$files, channel_id:$ch, initial_comment:$txt}
         else {files:$files, channel_id:$ch, initial_comment:$txt, thread_ts:$th} end')
    _wiz_slack_api files.completeUploadExternal -H "Content-type: application/json; charset=utf-8" --data "$payload" \
        | jq -e '.ok == true' >/dev/null
}

wiz_slack_thread_author() {
    # wiz_slack_thread_author <channel> <thread_ts>  -> echoes the user id (U...)
    # of the thread-parent message's author, or nothing on failure.
    local ch="$1" th="$2"
    [[ -n "$ch" && -n "$th" ]] || return 1
    _wiz_slack_api conversations.replies \
        --data-urlencode "channel=${ch}" \
        --data-urlencode "ts=${th}" \
        --data-urlencode "limit=1" \
        | jq -r '.messages[0].user // empty'
}

wiz_slack_reviewer_mentions() {
    # wiz_slack_reviewer_mentions <repo> <pr_number> [exclude_slack_id]
    # Echoes a space-separated list of "<@SLACKID>" mentions for the HUMAN
    # reviewers who have submitted a review on the PR, resolved via
    # wiz_gh_to_slack (github-login -> slack-id) from wiz_pr_pipeline.env.
    # Bots and unmapped logins are skipped; an optional Slack id to exclude
    # (e.g. the thread author, already mentioned separately) avoids a double ping.
    local repo="$1" pr="$2" exclude="${3:-}"
    [[ -n "$repo" && -n "$pr" ]] || return 0
    command -v wiz_gh_to_slack >/dev/null 2>&1 || return 0

    local logins login sid seen=" " out=""
    # Distinct reviewer logins that actually submitted a review (not just requested).
    logins="$(gh api "repos/story-wizard/${repo}/pulls/${pr}/reviews" --paginate \
        --jq '[.[] | .user.login] | unique | .[]' 2>/dev/null)"
    [[ -n "$logins" ]] || return 0

    while IFS= read -r login; do
        [[ -n "$login" ]] || continue
        sid="$(wiz_gh_to_slack "$login")"
        [[ -n "$sid" ]] || continue                 # unmapped (or a bot) -> skip
        [[ -n "$exclude" && "$sid" == "$exclude" ]] && continue
        [[ "$seen" == *" ${sid} "* ]] && continue   # dedupe slack ids
        seen+="${sid} "
        out+="<@${sid}> "
    done <<< "$logins"

    printf '%s' "${out% }"
}

wiz_slack_react() {
    # wiz_slack_react <channel> <ts> <emoji_name>   (no colons)
    local ch="$1" ts="$2" name="$3"
    [[ -n "$ch" && -n "$ts" && -n "$name" ]] || return 1
    _wiz_slack_api reactions.add -H "Content-type: application/json; charset=utf-8" \
        --data "$(jq -nc --arg ch "$ch" --arg ts "$ts" --arg n "$name" \
            '{channel:$ch, timestamp:$ts, name:$n}')" \
        | jq -e '.ok == true or .error == "already_reacted"' >/dev/null
}

wiz_slack_unreact() {
    # wiz_slack_unreact <channel> <ts> <emoji_name>
    local ch="$1" ts="$2" name="$3"
    [[ -n "$ch" && -n "$ts" && -n "$name" ]] || return 1
    _wiz_slack_api reactions.remove -H "Content-type: application/json; charset=utf-8" \
        --data "$(jq -nc --arg ch "$ch" --arg ts "$ts" --arg n "$name" \
            '{channel:$ch, timestamp:$ts, name:$n}')" \
        | jq -e '.ok == true or .error == "no_reaction"' >/dev/null
}
