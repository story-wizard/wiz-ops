#!/usr/bin/env python3
"""Regression tests for selecting wizard-release's BlackSmith workflow branch."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time

OPS = Path(__file__).resolve().parent
BLACKSMITH_REF = "blacksmith-migration-5992002"
DEFAULT_REF = "main"


def write(path: Path, text: str, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    if executable:
        path.chmod(path.stat().st_mode | stat.S_IXUSR)


def last_json(stdout: str) -> dict:
    for line in reversed(stdout.splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            pass
    raise AssertionError(f"no JSON output in {stdout!r}")


def driver_fixture() -> tuple[Path, dict[str, str], Path]:
    root = Path(tempfile.mkdtemp(prefix="wiz-blacksmith-driver-"))
    ops = root / "ops"
    bindir = root / "bin"
    events = root / "events"
    home = root / "home"
    for path in (ops, bindir, events, home):
        path.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OPS / "wiz_pr_build.sh", ops / "wiz_pr_build.sh")
    write(
        ops / "wiz_pr_pipeline.env",
        """WIZ_ACTIVE_CHANNEL=C_TEST
WIZ_BUILD_STATUS=Functional Review
WIZ_BUILD_POLL=0
WIZ_BUILD_MAX_WAIT=1
WIZ_BUILD_FIND_TRIES=1
""",
    )
    write(
        ops / "_wiz_slack.sh",
        f'''wiz_slack_ready() {{ return 0; }}
wiz_slack_post() {{ printf '%s\\t%s\\n' "$2" "$3" >> "{events / 'slack'}"; printf '1787000000.000001\\n'; }}
''',
    )
    write(
        ops / "wiz_pr_freshness.sh",
        "#!/bin/bash\nprintf '%s\\n' '{\"any_behind\":false,\"any_behind_conflict\":false,\"refs\":[]}'\n",
        True,
    )
    write(
        ops / "wiz_pr_build_watch.sh",
        f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'watcher'}"
''',
        True,
    )
    write(
        bindir / "gh",
        f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'gh'}"
if [[ "$1 $2" == "pr view" ]]; then
  printf '%s\\n' '{{"headRefName":"feature/core","title":"Fixture build"}}'
  exit 0
fi
if [[ "$1 $2" == "release view" ]]; then exit 1; fi
if [[ "$1 $2" == "workflow run" ]]; then exit 0; fi
if [[ "$1 $2" == "pr comment" ]]; then exit 0; fi
exit 0
''',
        True,
    )
    env = os.environ.copy()
    env.update({
        "HOME": str(home),
        "PATH": f"{bindir}:{env['PATH']}",
        "WIZ_SLACK_TOKEN": "fixture",
    })
    return root, env, events


def run_driver(*args: str) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    root, env, events = driver_fixture()
    run = subprocess.run(
        [str(root / "ops/wiz_pr_build.sh"), *args],
        text=True,
        capture_output=True,
        env=env,
    )
    return run, root, events


def test_resolve_reports_default_workflow_ref() -> None:
    run, root, _ = run_driver("--resolve-only", "wizard-core", "7", "fixture-core-7")
    try:
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert out["workflow_ref"] == DEFAULT_REF
        assert out["blacksmith"] is False
    finally:
        shutil.rmtree(root)


def test_resolve_reports_blacksmith_workflow_ref() -> None:
    run, root, _ = run_driver(
        "--resolve-only", "--blacksmith", "wizard-core", "7", "fixture-core-7"
    )
    try:
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert out["workflow_ref"] == BLACKSMITH_REF
        assert out["blacksmith"] is True
    finally:
        shutil.rmtree(root)


def test_blacksmith_dispatch_pins_workflow_branch_and_watcher() -> None:
    run, root, events = run_driver(
        "--blacksmith", "wizard-core", "7", "fixture-core-7", "1787000000.123456"
    )
    try:
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert out["workflow_ref"] == BLACKSMITH_REF
        assert out["blacksmith"] is True
        gh_lines = (events / "gh").read_text().splitlines()
        dispatch = next(x for x in gh_lines if x.startswith("workflow run "))
        assert f"--ref {BLACKSMITH_REF}" in dispatch, dispatch
        for _ in range(20):
            if (events / "watcher").exists():
                break
            time.sleep(0.05)
        watcher = (events / "watcher").read_text()
        assert watcher.rstrip().endswith(f"false {BLACKSMITH_REF}"), watcher
        slack = (events / "slack").read_text()
        assert f"wizard-release workflow: `{BLACKSMITH_REF}`" in slack
    finally:
        shutil.rmtree(root)


def watcher_fixture() -> tuple[Path, dict[str, str], Path]:
    root = Path(tempfile.mkdtemp(prefix="wiz-blacksmith-watcher-"))
    ops = root / "ops"
    bindir = root / "bin"
    events = root / "events"
    for path in (ops, bindir, events):
        path.mkdir(parents=True, exist_ok=True)
    shutil.copy2(OPS / "wiz_pr_build_watch.sh", ops / "wiz_pr_build_watch.sh")
    write(
        ops / "wiz_pr_pipeline.env",
        """WIZ_ACTIVE_CHANNEL=C_TEST
WIZ_BUILD_POLL=0
WIZ_BUILD_MAX_WAIT=1
WIZ_BUILD_FIND_TRIES=1
""",
    )
    write(
        ops / "_wiz_slack.sh",
        f'''wiz_slack_ready() {{ return 0; }}
wiz_slack_post() {{ printf '%s\\n' "$3" >> "{events / 'slack'}"; }}
wiz_slack_thread_author() {{ return 1; }}
wiz_slack_reviewer_mentions() {{ return 1; }}
''',
    )
    write(
        bindir / "gh",
        f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'gh'}"
if [[ "$1 $2" == "run list" ]]; then
  if [[ "$*" == *'.headBranch == "{BLACKSMITH_REF}"'* ]]; then printf '222\\n'; else printf '111\\n'; fi
  exit 0
fi
if [[ "$1 $2" == "run view" ]]; then printf 'completed success\\n'; exit 0; fi
if [[ "$1 $2" == "release view" ]]; then exit 0; fi
exit 0
''',
        True,
    )
    env = os.environ.copy()
    env.update({
        "PATH": f"{bindir}:{env['PATH']}",
        "WIZ_SLACK_TOKEN": "fixture",
    })
    return root, env, events


def test_watcher_matches_dispatched_workflow_branch() -> None:
    root, env, events = watcher_fixture()
    try:
        run = subprocess.run(
            [
                str(root / "ops/wiz_pr_build_watch.sh"),
                "wizard-core",
                "7",
                "vfixture-core-7",
                "https://example.test/release",
                "2026-08-21T00:00:00Z",
                "1787000000.123456",
                "false",
                BLACKSMITH_REF,
            ],
            text=True,
            capture_output=True,
            env=env,
        )
        assert run.returncode == 0, run.stderr + run.stdout
        gh_lines = (events / "gh").read_text().splitlines()
        run_list = next(x for x in gh_lines if x.startswith("run list "))
        assert "headBranch" in run_list
        assert BLACKSMITH_REF in run_list
        assert "Tracking run 222" in run.stdout
    finally:
        shutil.rmtree(root)


def main() -> None:
    test_resolve_reports_default_workflow_ref()
    test_resolve_reports_blacksmith_workflow_ref()
    test_blacksmith_dispatch_pins_workflow_branch_and_watcher()
    test_watcher_matches_dispatched_workflow_branch()
    print("ALL BLACKSMITH BUILD TESTS PASSED")


if __name__ == "__main__":
    main()
