#!/bin/bash

# wiz_pr_mode.sh — Switch the Wiz PR-review pipeline between test and prod.
#
# Usage: wiz_pr_mode.sh [test|prod|status]
#
# A single switch keeps two things in lockstep so output can never leak into
# the wrong channel:
#   1. wiz_pr_pipeline.env  -> WIZ_TEST_MODE + WIZ_ACTIVE_CHANNEL
#        (the channel the SCRIPTS post all output to)
#   2. Hermes Slack config  -> which channel the gateway MONITORS for PR links
#        (slack.free_response_channels, channel_prompts, channel_skill_bindings)
#
#   test -> monitor + post to #wiz-bot           (home/ops)  C0BCCTG5F0R
#   prod -> monitor + post to #wiz-pull-requests (PR chan)   C0APAGTP97F
#
# After switching you MUST restart the gateway (from a shell OUTSIDE the
# gateway process) for the monitored-channel change to take effect:
#     hermes gateway restart

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${script_dir}/wiz_pr_pipeline.env"
SKILL_NAME="wiz-pr-review-pipeline"
HERMES="${WIZ_HERMES_BIN:-hermes}"

die() { echo "Error: $*" >&2; exit 1; }

# Pull stable channel ids from the env file so they live in one place.
HOME_CH="$(grep -E '^WIZ_HOME_CHANNEL=' "$ENV_FILE" | head -1 | cut -d'"' -f2)"
PR_CH="$(grep -E '^WIZ_PR_CHANNEL='   "$ENV_FILE" | head -1 | cut -d'"' -f2)"
[[ -n "$HOME_CH" && -n "$PR_CH" ]] || die "Could not read channel IDs from ${ENV_FILE}"

usage() { echo "Usage: $(basename "$0") [test|prod|status]"; }

action="${1:-status}"

show_status() {
    local m c
    m="$(grep -E '^WIZ_TEST_MODE='      "$ENV_FILE" | head -1 | cut -d= -f2)"
    c="$(grep -E '^WIZ_ACTIVE_CHANNEL=' "$ENV_FILE" | head -1 | cut -d'"' -f2)"
    echo "Pipeline mode : $([[ "$m" == "true" ]] && echo TEST || echo PROD)"
    echo "Active channel: ${c}  $([[ "$c" == "$HOME_CH" ]] && echo '(#wiz-bot)' || echo '(#wiz-pull-requests)')"
    local cfg_path
    cfg_path="$("$HERMES" config path 2>/dev/null)"; [[ -f "$cfg_path" ]] || cfg_path="${HOME}/.hermes/config.yaml"
    echo "Gateway free_response_channels (slack):"
    grep -A3 '^slack:' "$cfg_path" 2>/dev/null | sed -n 's/^  free_response_channels:/   /p' | head -1
}

case "$action" in
    status) show_status; exit 0 ;;
    test) test_mode=true;  active_ch="$HOME_CH" ;;
    prod) test_mode=false; active_ch="$PR_CH"  ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
esac

# ---- 1. update the env file (scripts' output channel) ----
# Portable in-place edit without relying on sed -i flavor differences.
tmp="$(mktemp)"
while IFS= read -r line; do
    case "$line" in
        WIZ_TEST_MODE=*)      echo "WIZ_TEST_MODE=${test_mode}" ;;
        WIZ_ACTIVE_CHANNEL=*) echo "WIZ_ACTIVE_CHANNEL=\"${active_ch}\"" ;;
        *)                    echo "$line" ;;
    esac
done < "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"

# ---- 2. update the gateway monitored channel ----
read -r -d '' prompt <<EOF || true
This is the Wizard PR-review trigger channel, shared by the whole team. Messages are prefixed with the sender name in brackets, e.g. [kayvan] or [aryan].

AUTHORIZATION (enforce strictly):
- If the message is from [kayvan]: you may act normally (run the pipeline on a PR link, or respond to a direct request).
- If the message is from ANYONE ELSE: you may ONLY start a PR review. You must NOT answer questions, hold conversations, run commands, or take any other action for non-Kayvan users. If their message does not contain a GitHub PR link, reply with exactly NO_REPLY.

PIPELINE TRIGGER: A message qualifies only if it contains a GitHub pull-request link of the form https://github.com/story-wizard/<repo>/pull/<number> (repo one of wizard, wizard-ai, wizard-core, wizard-link, wizard-release, wizard-spec). When a qualifying link is present (from anyone), load and follow the ${SKILL_NAME} skill to kick off the Maestro code review, then reply with exactly NO_REPLY (the skill's scripts post all Slack output themselves).

In ALL cases, after doing the work (or if no action is warranted), your final reply must be exactly NO_REPLY so nothing from you appears in the channel.
EOF

"$HERMES" config set slack.free_response_channels "$active_ch" >/dev/null \
    || die "failed to set slack.free_response_channels"
"$HERMES" config set "slack.channel_prompts.${active_ch}" "$prompt" >/dev/null \
    || die "failed to set channel prompt"

# Rebuild channel_skill_bindings as a proper YAML list (config set stores it as
# a string, which the resolver ignores). Use the Hermes venv python + ruamel.
py="$(dirname "$(command -v "$HERMES")")/python3"
[[ -x "$py" ]] || py="python3"
inactive_ch="$([[ "$active_ch" == "$HOME_CH" ]] && echo "$PR_CH" || echo "$HOME_CH")"
WIZ_ACTIVE_CH="$active_ch" WIZ_INACTIVE_CH="$inactive_ch" WIZ_SKILL="$SKILL_NAME" WIZ_HERMES="$HERMES" "$py" - <<'PYEOF'
import os
from ruamel.yaml import YAML
import subprocess
cfg = subprocess.run([os.environ.get("WIZ_HERMES","hermes"),"config","path"],capture_output=True,text=True).stdout.strip() \
      or os.path.expanduser("~/.hermes/config.yaml")
yaml = YAML(); yaml.preserve_quotes = True
with open(cfg) as f: data = yaml.load(f)
ch = os.environ["WIZ_ACTIVE_CH"]; sk = os.environ["WIZ_SKILL"]
inactive = os.environ["WIZ_INACTIVE_CH"]
data.setdefault("slack", {})
# Active channel is the ONLY one bound + prompted; prune the inactive one so a
# previous mode's prompt/binding can't linger and confuse the gateway.
data["slack"]["channel_skill_bindings"] = [{"id": ch, "skill": sk}]
cp = data["slack"].get("channel_prompts")
if isinstance(cp, dict) and inactive in cp:
    del cp[inactive]
with open(cfg,"w") as f: yaml.dump(data, f)
print(f"channel_skill_bindings -> [{ch} :: {sk}]; pruned prompt for {inactive}")
PYEOF

echo
echo "Switched pipeline to: $([[ "$test_mode" == "true" ]] && echo TEST || echo PROD)"
show_status
echo
echo ">>> Restart the gateway from a separate shell for the monitored-channel"
echo ">>> change to take effect:   hermes gateway restart"
