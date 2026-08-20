#!/usr/bin/env python3
"""Regression tests for pre-setup draft confirmation in wiz_pr_review.sh."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

OPS = Path(__file__).resolve().parent
SCRIPT = OPS / "wiz_pr_review.sh"
HEAD = "a" * 40
THREAD = "1787186204.455809"


def write(path: Path, text: str, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IXUSR)


def fixture() -> tuple[Path, dict[str, str], Path]:
    root = Path(tempfile.mkdtemp(prefix="wiz-draft-gate-"))
    ops = root / "ops"
    bin_dir = root / "bin"
    events = root / "events"
    home = root / "home"
    for path in (ops, bin_dir, events, home):
        path.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SCRIPT, ops / "wiz_pr_review.sh")

    write(
        ops / "wiz_pr_pipeline.env",
        """WIZ_ACTIVE_CHANNEL=C_TEST
WIZ_DEFAULT_AGENT_TYPE=claude-code
WIZ_REVIEW_ALTERNATE_AGENTS=false
WIZ_REACT_INPROGRESS=hourglass_flowing_sand
WIZ_REACT_FAILED=x
WIZ_REACT_DONE=white_check_mark
""",
    )
    write(
        ops / "_wiz_slack.sh",
        f'''wiz_slack_ready() {{ return 0; }}
wiz_slack_post() {{ printf '%s\\t%s\\n' "$2" "$3" >> "{events / 'slack'}"; printf '1787000000.000001\\n'; }}
wiz_slack_react() {{ return 0; }}
wiz_slack_unreact() {{ return 0; }}
''',
    )
    write(
        ops / "wiz_pr_review_state.sh",
        f'''wiz_review_agent_for_round() {{ printf 'claude-code\\n'; }}
wiz_review_launch_lock_acquire() {{ d="{root / 'lock'}"; mkdir -p "$d"; printf '%s\\n' "$d"; }}
wiz_review_launch_lock_release() {{ return 0; }}
wiz_review_state_file() {{ printf '%s/wizard/tmp/wiz-pr-review-state/%s-%s.json\\n' "$HOME" "$1" "$2"; }}
wiz_review_state_record_launch() {{ mkdir -p "$(dirname "$(wiz_review_state_file "$1" "$2")")"; printf '{{"status":"launching"}}\\n' > "$(wiz_review_state_file "$1" "$2")"; }}
wiz_review_thread_state_snapshot() {{ return 0; }}
wiz_review_thread_state_write() {{ return 0; }}
wiz_review_thread_state_restore() {{ return 0; }}
wiz_review_state_record_watcher() {{ return 0; }}
''',
    )
    write(ops / "_maestro_env.sh", f'maestro_cli="{ops / "maestro-cli.js"}"\n')
    write(ops / "maestro-cli.js", "")
    write(ops / "maestro_id.sh", "#!/bin/bash\nexit 1\n", True)
    write(ops / "maestro_wt.sh", "#!/bin/bash\nexit 0\n", True)
    write(
        ops / "maestro_pr.sh",
        f'''#!/bin/bash
printf 'maestro_pr\\n' >> "{events / 'calls'}"
repo="$2"; pr="$3"; agent="$4"
name="${{repo}}-pr-${{pr}}-${{agent}}"
mkdir -p "$HOME/wizard/worktrees/${{repo}}/${{name}}"
mkdir -p "$HOME/wizard/worktrees/autorun/${{repo}}/${{name}}/development/code-review"
printf 'Agent ID : fixture-agent\\n'
''',
        True,
    )
    write(ops / "wiz_pr_set_status.sh", "#!/bin/bash\nprintf 'status set\\n'\n", True)
    write(ops / "wiz_pr_watch_finalize.sh", "#!/bin/bash\nexit 0\n", True)

    write(
        bin_dir / "gh",
        f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'gh'}"
if [[ "$1 $2" == "pr view" ]]; then
  if [[ -e "{root / 'ready'}" ]]; then draft=false; else draft=true; fi
  printf '{{"title":"Draft fixture","url":"https://github.com/story-wizard/wizard/pull/1","state":"OPEN","isDraft":%s,"author":{{"login":"aryan"}}}}\\n' "$draft"
  exit 0
fi
if [[ "$1 $2" == "pr ready" ]]; then
  : > "{root / 'ready'}"
  printf 'ready\\n'
  exit 0
fi
exit 1
''',
        True,
    )
    write(bin_dir / "git", f"#!/bin/bash\nprintf '{HEAD}\\n'\n", True)
    write(
        bin_dir / "node",
        f'''#!/bin/bash
printf 'node %s\\n' "$*" >> "{events / 'calls'}"
exit 0
''',
        True,
    )

    env = os.environ.copy()
    env.update({
        "HOME": str(home),
        "PATH": f"{bin_dir}:{env['PATH']}",
        "WIZ_SLACK_TOKEN": "fixture-token",
    })
    return root, env, events


def last_json(stdout: str) -> dict:
    for line in reversed(stdout.splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            pass
    raise AssertionError(f"no JSON output in {stdout!r}")


def test_draft_asks_before_any_setup() -> None:
    root, env, events = fixture()
    try:
        run = subprocess.run(
            [str(root / "ops/wiz_pr_review.sh"), "wizard", "1", THREAD],
            text=True,
            capture_output=True,
            env=env,
        )
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert out["ok"] is True
        assert out["action"] == "draft_confirmation_required"
        assert out["is_draft"] is True
        slack = (events / "slack").read_text()
        assert THREAD in slack
        assert "mark it Ready for review" in slack
        assert not (events / "calls").exists(), "setup or launch ran before confirmation"
        assert not (root / "home/wizard/tmp/wiz-pr-review-state/wizard-1.json").exists()
        assert not (root / "home/wizard/worktrees/wizard/wizard-pr-1-claude-code").exists()
    finally:
        shutil.rmtree(root)


def test_confirmed_ready_marks_ready_then_launches() -> None:
    root, env, events = fixture()
    try:
        run = subprocess.run(
            [str(root / "ops/wiz_pr_review.sh"), "--ready", "wizard", "1", THREAD],
            text=True,
            capture_output=True,
            env=env,
        )
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert out["ok"] is True
        assert out["action"] == "review"
        gh = (events / "gh").read_text().splitlines()
        assert any(line.startswith("pr ready 1 ") for line in gh), gh
        assert sum(line.startswith("pr view 1 ") for line in gh) >= 2, gh
        calls = (events / "calls").read_text()
        assert "maestro_pr" in calls
        assert "node" in calls
    finally:
        shutil.rmtree(root)


def test_board_trigger_cannot_mark_draft_ready() -> None:
    root, env, events = fixture()
    try:
        run = subprocess.run(
            [str(root / "ops/wiz_pr_review.sh"), "--board-trigger", "--ready", "wizard", "1"],
            text=True,
            capture_output=True,
            env=env,
        )
        assert run.returncode != 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert out["stage"] == "args"
        assert not (events / "gh").exists(), "board trigger must not mark a draft ready"
        assert not (events / "slack").exists(), "invalid board request must fail locally"
    finally:
        shutil.rmtree(root)


def main() -> None:
    test_draft_asks_before_any_setup()
    test_confirmed_ready_marks_ready_then_launches()
    test_board_trigger_cannot_mark_draft_ready()
    print("ALL DRAFT READY GATE TESTS PASSED")


if __name__ == "__main__":
    main()
