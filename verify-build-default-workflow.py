#!/usr/bin/env python3
"""Regression tests for the single default wizard-release workflow path."""

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
REMOVED_MODE = "black" + "smith"


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


def fixture() -> tuple[Path, dict[str, str], Path]:
    root = Path(tempfile.mkdtemp(prefix="wiz-default-workflow-"))
    ops = root / "ops"
    bindir = root / "bin"
    events = root / "events"
    home = root / "home"
    for path in (ops, bindir, events, home):
        path.mkdir(parents=True, exist_ok=True)
    for name in ("wiz_pr_build.sh", "wiz_pr_build_watch.sh"):
        shutil.copy2(OPS / name, ops / name)
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
    root, env, events = fixture()
    run = subprocess.run(
        [str(root / "ops/wiz_pr_build.sh"), *args],
        text=True,
        capture_output=True,
        env=env,
    )
    return run, root, events


def test_special_mode_is_removed_from_product_files() -> None:
    for name in ("wiz_pr_build.sh", "wiz_pr_build_watch.sh", "README.md"):
        assert REMOVED_MODE not in (OPS / name).read_text().lower(), name
    assert not (OPS / ("verify-" + REMOVED_MODE + "-build.py")).exists()


def test_resolve_uses_only_normal_source_ref_contract() -> None:
    run, root, _ = run_driver("--resolve-only", "wizard-core", "7", "fixture-core-7")
    try:
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert "workflow_ref" not in out
        assert REMOVED_MODE not in out
        assert out["wizard_core_ref"] == "feature/core"
    finally:
        shutil.rmtree(root)


def test_dispatch_uses_default_workflow_and_legacy_watcher_contract() -> None:
    run, root, events = run_driver(
        "wizard-core", "7", "fixture-core-7", "1787000000.123456"
    )
    try:
        assert run.returncode == 0, run.stderr + run.stdout
        out = last_json(run.stdout)
        assert "workflow_ref" not in out
        assert REMOVED_MODE not in out
        dispatch = next(
            x for x in (events / "gh").read_text().splitlines()
            if x.startswith("workflow run ")
        )
        assert "--ref" not in dispatch, dispatch
        for _ in range(20):
            if (events / "watcher").exists():
                break
            time.sleep(0.05)
        watcher_args = (events / "watcher").read_text().strip().split()
        assert len(watcher_args) == 7, watcher_args
        assert watcher_args[-1] == "false"
    finally:
        shutil.rmtree(root)


def test_removed_option_is_rejected() -> None:
    flag = "--" + REMOVED_MODE
    run, root, _ = run_driver(
        flag, "wizard-core", "7", "fixture-core-7", "1787000000.123456"
    )
    try:
        assert run.returncode != 0
    finally:
        shutil.rmtree(root)


def main() -> None:
    test_special_mode_is_removed_from_product_files()
    test_resolve_uses_only_normal_source_ref_contract()
    test_dispatch_uses_default_workflow_and_legacy_watcher_contract()
    test_removed_option_is_rejected()
    print("ALL DEFAULT BUILD WORKFLOW TESTS PASSED")


if __name__ == "__main__":
    main()
