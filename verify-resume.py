#!/usr/bin/env python3
"""Side-effect-free fixtures for wiz_pr_resume.sh.

Every external boundary (GitHub, Slack, Maestro, process inspection and finalizer)
is replaced inside a temporary fixture directory. No production path is sourced.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent


def executable(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(0o755)


def build_fixture(*, error_pause: bool = True, complete: bool = False,
                  live_head: str | None = None,
                  existing_review: bool = False,
                  review_state: str = "COMMENTED",
                  head_changes_on_reconcile: bool = False,
                  head_changes_after_reconcile_write: bool = False,
                  watcher_alive: bool = False,
                  node_hang: bool = False,
                  show_hang: bool = False,
                  fast_terminal: bool = False,
                  routing_missing: bool = False,
                  routing_legacy: bool = False,
                  routing_conflicting_legacy: bool = False,
                  routing_overrides: dict[str, object] | None = None) -> tuple[Path, dict[str, str], Path]:
    root = Path(tempfile.mkdtemp(prefix="wiz-resume-fixture-"))
    app = root / "app"
    app.mkdir()
    for name in ("wiz_pr_resume.sh", "wiz_pr_review_state.sh", "wiz_pr_pipeline.env",
                 "wiz_pr_progress.sh"):
        src = ROOT / name
        if not src.exists():
            raise AssertionError(f"candidate missing: {name}")
        shutil.copy2(src, app / name)
    if node_hang or show_hang:
        env_file = app / "wiz_pr_pipeline.env"
        env_file.write_text(env_file.read_text() + "\nWIZ_WATCH_RESUME_COMMAND_TIMEOUT=1\n")

    events = root / "events"
    events.mkdir()
    home = root / "home"
    state_dir = home / "wizard/tmp/wiz-pr-review-state"
    state_dir.mkdir(parents=True)
    wt = home / "worktree"
    autorun = home / "autorun"
    playbooks = autorun / "development/code-review"
    wt.mkdir(parents=True)
    playbooks.mkdir(parents=True)
    checks = "# Review\n- [x] completed\n- [x] remaining\n" if complete else \
        "# Review\n- [x] completed\n- [ ] remaining\n"
    (playbooks / "1_REVIEW.md").write_text(checks)
    artifacts = ("REVIEW_SCOPE.md", "CODE_ISSUES.md", "SECURITY_ISSUES.md",
                 "TEST_GAPS.md", "REVIEW_SUMMARY.md") if complete else ("REVIEW_SCOPE.md",)
    for artifact in artifacts:
        (autorun / artifact).write_text(artifact + "\n")

    head = "a" * 40
    attempt_epoch = int(time.time()) - 60
    attempt = f"r1-{attempt_epoch}-100-200"
    agent = "agent-fixture"
    state = {
        "version": 1,
        "repo": "fixture",
        "pr_number": 1,
        "round": 1,
        "head_sha": head,
        "status": "failed",
        "active_agent_type": "claude-code",
        "attempt_id": attempt,
        "thread_ts": "111.222",
        "watcher_pid": 4242 if watcher_alive else None,
        "auto_resume_count": 2,
        "auto_resume_last_error_ms": attempt_epoch * 1000 + 1000,
        "watch_deadline_epoch": int(time.time()) - 1,
        "finalization_phases": {},
        "agents": {
            "claude-code": {
                "agent_id": agent,
                "worktree_name": "fixture-pr-1-claude-code",
                "worktree_dir": str(wt),
                "autorun_dir": str(autorun),
            }
        },
    }
    state_file = state_dir / "fixture-1.json"
    state_file.write_text(json.dumps(state) + "\n")

    thread_state_dir = home / "wizard/tmp/wiz-pr-state"
    thread_state_dir.mkdir(parents=True)
    routing = {
        "schema": 1,
        "repo": "fixture",
        "pr_number": 1,
        "thread_ts": "111.222",
        "agent_type": "claude-code",
        "review_round": 1,
        "attempt_id": attempt,
        "head_sha": head,
        "agent_id": agent,
        "worktree_name": "fixture-pr-1-claude-code",
        "worktree_dir": str(wt),
        "autorun_dir": str(autorun),
    }
    if routing_legacy:
        routing = {
            "repo": "fixture",
            "pr_number": 1,
            "thread_ts": "111.222",
            "agent_type": "claude-code",
            "review_round": 1,
            "agent_id": agent,
            "worktree_name": "fixture-pr-1-claude-code",
            "autorun_dir": str(autorun),
        }
    if routing_overrides:
        routing.update(routing_overrides)
    if not routing_missing:
        legacy_routing = routing
        if routing_conflicting_legacy:
            legacy_routing = dict(routing)
            legacy_routing["agent_type"] = "codex"
            legacy_routing["agent_id"] = "legacy-other-agent"
        (thread_state_dir / "111.222.json").write_text(json.dumps(legacy_routing) + "\n")
        if not routing_legacy:
            attempt_dir = thread_state_dir / "111.222"
            attempt_dir.mkdir(parents=True)
            (attempt_dir / "fixture-1.json").write_text(json.dumps(routing) + "\n")

    history_dir = home / "maestro/history"
    history_dir.mkdir(parents=True)
    history_entries = [{
            "type": "AUTO",
            "timestamp": attempt_epoch * 1000 + 2000,
            "summary": "Auto Run error: transient fixture failure",
            "fullResponse": "server_error",
            "success": False,
            "projectPath": str(wt),
        }] if error_pause else []
    history = {"entries": history_entries}
    (history_dir / f"{agent}.json").write_text(json.dumps(history) + "\n")

    (app / "_wiz_slack.sh").write_text(f'''#!/bin/bash
wiz_slack_ready() {{ return 0; }}
wiz_slack_post() {{ printf '%s\\n' "$3" >> "{events / 'slack'}"; printf '999.1\\n'; }}
wiz_slack_react() {{ :; }}
wiz_slack_unreact() {{ :; }}
''')
    (app / "_maestro_env.sh").write_text('maestro_cli="/fixture/maestro-cli.js"\n')
    executable(app / "maestro_watch.sh", f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'watch'}"
[[ "${{1:-}}" == "--is-running" ]] && exit 1
exit 1
''')
    if fast_terminal:
        executable(app / "wiz_pr_watch_finalize.sh", f'''#!/bin/bash
source "{app / 'wiz_pr_review_state.sh'}"
printf '%s\\n' "$$" > "{events / 'finalizer-pid'}"
wiz_review_state_mark_status "$1" "$2" "$9" completed "${{10}}" "${{11}}"
touch "{events / 'terminal-done'}"
printf '%s\\n' "$*" >> "{events / 'finalizer'}"
''')
    else:
        executable(app / "wiz_pr_watch_finalize.sh", f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'finalizer'}"
exit 0
''')

    bindir = root / "bin"
    bindir.mkdir()
    if fast_terminal:
        executable(bindir / "nohup", f'''#!/bin/bash
touch "{events / 'spawn-phase'}"
exec /usr/bin/nohup "$@"
''')
        executable(bindir / "shlock", f'''#!/bin/bash
pid=""; want_pid=false
for arg in "$@"; do
  if [[ "$want_pid" == true ]]; then pid="$arg"; want_pid=false; fi
  [[ "$arg" == "-p" ]] && want_pid=true
done
if [[ "$*" == *"state-lock"* ]]; then
  j=0
  while [[ ! -f "{events / 'spawn-phase'}" && $j -lt 20 ]]; do sleep 0.01; j=$((j+1)); done
  if [[ -f "{events / 'spawn-phase'}" ]]; then
    i=0
    while [[ ! -f "{events / 'finalizer-pid'}" && $i -lt 500 ]]; do sleep 0.01; i=$((i+1)); done
    finalizer_pid="$(cat "{events / 'finalizer-pid'}" 2>/dev/null || true)"
    if [[ -n "$finalizer_pid" && "$pid" != "$finalizer_pid" ]]; then
      i=0
      while [[ ! -f "{events / 'terminal-done'}" && $i -lt 500 ]]; do sleep 0.01; i=$((i+1)); done
    fi
  fi
fi
exec /usr/bin/shlock "$@"
''')
    reported_head = live_head or head
    reconcile_head = ("b" * 40) if head_changes_on_reconcile else reported_head
    post_reconcile_head = ("c" * 40) if head_changes_after_reconcile_write else reconcile_head
    review_result = json.dumps([[{
        "id": 9001,
        "user": {"login": "wiz-maestro"},
        "commit_id": head,
        "state": review_state,
        "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(attempt_epoch + 5)),
    }]]) if existing_review else "[[]]"
    executable(bindir / "gh", f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'gh'}"
if [[ "$1 $2" == "pr view" ]]; then
  if [[ "$*" == *"--jq"* ]]; then
    count_file="{events / 'head-jq-count'}"
    count="$(cat "$count_file" 2>/dev/null || echo 0)"; count=$((count+1)); printf '%s' "$count" > "$count_file"
    if [[ $count -ge 2 ]]; then printf '%s\n' '{post_reconcile_head}'; else printf '%s\n' '{reconcile_head}'; fi
  else
    printf '%s\n' '{{"title":"Fixture PR","url":"https://github.com/story-wizard/fixture/pull/1","state":"OPEN","isDraft":false,"headRefOid":"{reported_head}"}}'
  fi
  exit 0
fi
if [[ "$1 $2" == "api user" ]]; then printf 'wiz-maestro\n'; exit 0; fi
if [[ "$1 $2" == "pr comment" ]]; then printf '%s\n' "$*" >> "{events / 'gh-comments'}"; exit 0; fi
if [[ "$*" == *"pulls/1/reviews"* ]]; then printf '%s\n' '{review_result}'; exit 0; fi
if [[ "$1" == "api" ]]; then printf '[]\\n'; exit 0; fi
exit 1
''')
    executable(bindir / "git", f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'git'}"
if [[ "$*" == *"rev-parse HEAD"* ]]; then printf '{head}\\n'; exit 0; fi
exit 1
''')
    if watcher_alive:
        executable(bindir / "ps", f'''#!/bin/bash
printf './wiz_pr_watch_finalize.sh fixture 1 {agent} {autorun} Fixture URL 111.222 claude-code 1 {attempt}\\n'
''')
    hang_command = "sleep 5; " if node_hang else ""
    show_hang_command = "sleep 5; " if show_hang else ""
    executable(bindir / "node", f'''#!/bin/bash
printf '%s\\n' "$*" >> "{events / 'node'}"
if [[ "$*" == *"show agent"* ]]; then
  {show_hang_command}printf '%s\\n' '{{"id":"{agent}","name":"fixture-pr-1-claude-code","cwd":"{wt}","autoRunFolderPath":"{autorun}","toolType":"claude-code"}}'
  exit 0
fi
if [[ "$*" == *"resume-auto-run"* ]]; then {hang_command}printf '{{"success":true}}\\n'; exit 0; fi
if [[ "$*" == *" auto-run "* ]]; then printf '{{"success":true}}\\n'; exit 0; fi
exit 1
''')

    env = {
        **os.environ,
        "HOME": str(home),
        "PATH": str(bindir) + os.pathsep + os.environ["PATH"],
        "MAESTRO_USER_DATA": str(home / "maestro"),
        "WIZ_REVIEW_STATE_DIR": str(state_dir),
        "WIZ_PR_STATE_DIR": str(thread_state_dir),
        "WIZ_ACTIVE_CHANNEL": "fixture-channel",
        "WIZ_WATCH_GRACE": "0",
        "WIZ_WATCH_POLL": "1",
        "WIZ_WATCH_MAX_SECONDS": "14400",
    }
    return root, env, state_file


def test_error_paused_resume_preserves_attempt_and_starts_finalizer() -> None:
    root, env, state_file = build_fixture()
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True,
            capture_output=True,
            env=env,
            timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_auto_run", result
        state = json.loads(state_file.read_text())
        assert state["attempt_id"].startswith("r1-"), state
        assert state["round"] == 1, state
        assert state["status"] == "running", state
        assert state["manual_resume_count"] == 1, state
        assert state["recovery_generation"] == 1, state
        assert state["auto_resume_count"] == 0, state
        history = json.loads(next((root / "home/maestro/history").glob("*.json")).read_text())
        assert state["auto_resume_last_error_ms"] == history["entries"][0]["timestamp"], state
        assert state["watch_deadline_epoch"] > int(time.time()), state
        node_events = (root / "events/node").read_text()
        assert "resume-auto-run" in node_events, node_events
        assert " auto-run " not in node_events, node_events
        finalizer_event = root / "events/finalizer"
        for _ in range(20):
            if finalizer_event.exists():
                break
            time.sleep(0.05)
        assert finalizer_event.exists(), "finalizer was not started"
    finally:
        shutil.rmtree(root)


def test_idle_partial_relaunches_same_playbooks() -> None:
    root, env, state_file = build_fixture(error_pause=False)
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_playbooks", result
        state = json.loads(state_file.read_text())
        assert state["attempt_id"].startswith("r1-"), state
        assert state["round"] == 1, state
        node_events = (root / "events/node").read_text()
        assert " auto-run -a agent-fixture " in node_events, node_events
        assert "resume-auto-run" not in node_events, node_events
    finally:
        shutil.rmtree(root)


def test_complete_playbooks_restart_finalization_only() -> None:
    root, env, state_file = build_fixture(error_pause=False, complete=True)
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_finalization", result
        node_events = (root / "events/node").read_text()
        assert "resume-auto-run" not in node_events, node_events
        assert " auto-run " not in node_events, node_events
        state = json.loads(state_file.read_text())
        assert state["status"] == "running", state
        assert state["attempt_id"].startswith("r1-"), state
    finally:
        shutil.rmtree(root)


def test_existing_exact_head_review_reconciles_without_reposting() -> None:
    root, env, state_file = build_fixture(
        error_pause=False, complete=True, existing_review=True,
    )
    try:
        state = json.loads(state_file.read_text())
        state["status"] = "completed"
        state_file.write_text(json.dumps(state) + "\n")
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "already_completed", result
        assert not (root / "events/finalizer").exists(), "duplicate finalizer started"
        node_event = root / "events/node"
        node_events = node_event.read_text() if node_event.exists() else ""
        assert "resume-auto-run" not in node_events, node_events
        assert " auto-run " not in node_events, node_events
        state = json.loads(state_file.read_text())
        assert state["status"] == "completed", state
        assert state["finalization_phases"]["final_review"]["status"] == "posted", state
        assert state.get("manual_resume_count") is None, state
        slack_event = root / "events/slack"
        assert not slack_event.exists(), "completed reconciliation posted a duplicate Slack acknowledgement"
    finally:
        shutil.rmtree(root)


def test_manual_generation_claim_rejects_status_race() -> None:
    root, env, state_file = build_fixture()
    try:
        state = json.loads(state_file.read_text())
        state["status"] = "completed"
        state_file.write_text(json.dumps(state) + "\n")
        deadline = int(time.time()) + 14400
        command = (
            f'source "{root / "app/wiz_pr_review_state.sh"}"; '
            f'wiz_review_state_begin_manual_resume fixture 1 1 "{state["attempt_id"]}" '
            f'{deadline} failed; rc=$?; echo rc=$rc; exit 0'
        )
        run = subprocess.run(
            ["bash", "-c", command], text=True, capture_output=True, env=env, timeout=30,
        )
        assert "rc=2" in run.stdout, run.stdout + run.stderr
        unchanged = json.loads(state_file.read_text())
        assert unchanged["status"] == "completed", unchanged
        assert unchanged.get("manual_resume_count") is None, unchanged
    finally:
        shutil.rmtree(root)


def test_live_head_drift_resumes_finalization_instead_of_failing() -> None:
    root, env, state_file = build_fixture(
        error_pause=False, complete=True, live_head="b" * 40,
    )
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_finalization", result
        state = json.loads(state_file.read_text())
        assert state["status"] == "running", state
        finalizer_event = root / "events/finalizer"
        for _ in range(20):
            if finalizer_event.exists():
                break
            time.sleep(0.05)
        assert finalizer_event.exists(), "drifted finalization was not resumed"
    finally:
        shutil.rmtree(root)


def test_live_watcher_returns_already_running_without_mutation() -> None:
    root, env, state_file = build_fixture(watcher_alive=True)
    try:
        before = state_file.read_text()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "already_running", result
        assert state_file.read_text() == before
        assert not (root / "events/node").exists()
        assert not (root / "events/finalizer").exists()
    finally:
        shutil.rmtree(root)


def test_thread_routing_agent_mismatch_fails_closed() -> None:
    root, env, state_file = build_fixture(routing_overrides={"agent_type": "codex"})
    try:
        before = state_file.read_text()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode != 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["stage"] == "state_routing", result
        assert "expects codex" in result["message"], result
        assert state_file.read_text() == before
        assert not (root / "events/node").exists()
        assert not (root / "events/finalizer").exists()
    finally:
        shutil.rmtree(root)


def test_thread_routing_attempt_mismatch_fails_closed() -> None:
    root, env, state_file = build_fixture(routing_overrides={"attempt_id": "r1-1-2-3"})
    try:
        before = state_file.read_text()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode != 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["stage"] == "state_routing", result
        assert "expects attempt" in result["message"], result
        assert state_file.read_text() == before
        assert not (root / "events/node").exists()
        assert not (root / "events/finalizer").exists()
    finally:
        shutil.rmtree(root)


def test_missing_thread_routing_fails_closed() -> None:
    root, env, state_file = build_fixture(routing_missing=True)
    try:
        before = state_file.read_text()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode != 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["stage"] == "state_routing", result
        assert "missing" in result["message"], result
        assert state_file.read_text() == before
        assert not (root / "events/node").exists()
        assert not (root / "events/finalizer").exists()
    finally:
        shutil.rmtree(root)


def test_exact_thread_record_wins_over_conflicting_legacy_pointer() -> None:
    root, env, state_file = build_fixture(
        error_pause=False, routing_conflicting_legacy=True,
    )
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_playbooks", result
        state = json.loads(state_file.read_text())
        assert state["status"] == "running", state
    finally:
        shutil.rmtree(root)


def test_legacy_thread_routing_matching_agent_still_resumes() -> None:
    root, env, state_file = build_fixture(error_pause=False, routing_legacy=True)
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_playbooks", result
        state = json.loads(state_file.read_text())
        assert state["status"] == "running", state
    finally:
        shutil.rmtree(root)


def test_legacy_thread_routing_agent_mismatch_fails_closed() -> None:
    root, env, state_file = build_fixture(
        routing_legacy=True, routing_overrides={"agent_type": "codex"},
    )
    try:
        before = state_file.read_text()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode != 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["stage"] == "state_routing", result
        assert state_file.read_text() == before
        assert not (root / "events/node").exists()
        assert not (root / "events/finalizer").exists()
    finally:
        shutil.rmtree(root)


def test_resume_command_timeout_fails_closed() -> None:
    root, env, state_file = build_fixture(node_hang=True)
    try:
        started = time.monotonic()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=10,
        )
        elapsed = time.monotonic() - started
        assert elapsed < 4, f"resume command was not bounded: {elapsed:.2f}s"
        assert run.returncode != 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["stage"] == "maestro_resume", result
        state = json.loads(state_file.read_text())
        assert state["status"] == "failed", state
        assert not (root / "events/finalizer").exists()
    finally:
        shutil.rmtree(root)


def test_show_agent_timeout_releases_without_claiming_generation() -> None:
    root, env, state_file = build_fixture(show_hang=True)
    try:
        before = state_file.read_text()
        started = time.monotonic()
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=10,
        )
        elapsed = time.monotonic() - started
        assert elapsed < 4, f"show agent was not bounded: {elapsed:.2f}s"
        assert run.returncode != 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["stage"] == "agent", result
        assert state_file.read_text() == before
    finally:
        shutil.rmtree(root)


def test_fast_terminal_child_cannot_be_regressed_to_running() -> None:
    root, env, state_file = build_fixture()
    try:
        state = json.loads(state_file.read_text())
        deadline = int(time.time()) + 14400
        command = (
            f'source "{root / "app/wiz_pr_review_state.sh"}"; '
            f'gen=$(wiz_review_state_begin_manual_resume fixture 1 1 "{state["attempt_id"]}" '
            f'{deadline} failed); '
            f'wiz_review_state_mark_status fixture 1 1 completed "{state["attempt_id"]}" "$gen"; '
            f'wiz_review_state_activate_manual_watcher fixture 1 1 "{state["attempt_id"]}" '
            f'"$gen" 4242 /tmp/watcher.log; rc=$?; echo rc=$rc; exit 0'
        )
        run = subprocess.run(
            ["bash", "-c", command], text=True, capture_output=True, env=env, timeout=30,
        )
        assert "rc=2" in run.stdout, run.stdout + run.stderr
        terminal_state = json.loads(state_file.read_text())
        assert terminal_state["status"] == "completed", terminal_state
        assert terminal_state["watcher_pid"] is None, terminal_state
    finally:
        shutil.rmtree(root)


def test_dismissed_exact_head_review_is_not_completion() -> None:
    root, env, state_file = build_fixture(
        error_pause=False, complete=True, existing_review=True, review_state="DISMISSED",
    )
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "resumed_finalization", result
        finalizer_event = root / "events/finalizer"
        for _ in range(20):
            if finalizer_event.exists():
                break
            time.sleep(0.05)
        assert finalizer_event.exists(), "finalizer was not restarted"
    finally:
        shutil.rmtree(root)


def test_head_drift_existing_review_reconciles_with_warning() -> None:
    root, env, state_file = build_fixture(
        error_pause=False, complete=True, existing_review=True, live_head="b" * 40,
    )
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "already_completed", result
        state = json.loads(state_file.read_text())
        assert state["status"] == "completed", state
        assert state["finalization_phases"]["final_review"]["status"] == "posted", state
        assert state["finalization_phases"]["head_drift_warning"]["status"] == "posted", state
        slack = (root / "events/slack").read_text()
        assert "Head drift warning" in slack, slack
        assert "Head drift: reviewed" in slack, slack
        assert (root / "events/gh-comments").exists(), "PR head-drift warning was not posted"
        assert not (root / "events/finalizer").exists(), "duplicate finalizer started"
    finally:
        shutil.rmtree(root)


def test_manual_resume_preserves_fast_terminal_child_result() -> None:
    root, env, state_file = build_fixture(
        error_pause=False, complete=True, fast_terminal=True,
    )
    try:
        run = subprocess.run(
            [str(root / "app/wiz_pr_resume.sh"), "fixture", "1", "111.222"],
            text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        result = json.loads(run.stdout.strip().splitlines()[-1])
        assert result["action"] == "completed", result
        state = json.loads(state_file.read_text())
        assert state["status"] == "completed", state
        assert state["watcher_pid"] is None, state
        slack = (root / "events/slack").read_text()
        assert "completed before watcher registration" in slack, slack
        assert "Resumed finalization" not in slack, slack
    finally:
        shutil.rmtree(root)


def test_manual_resume_reconciles_abandoned_publication_claims() -> None:
    root, env, state_file = build_fixture()
    try:
        state = json.loads(state_file.read_text())
        state["finalization_phases"] = {
            "slack_artifacts": {"status": "claimed"},
            "github_artifacts": {"status": "claimed"},
            "final_review": {"status": "claimed"},
        }
        state_file.write_text(json.dumps(state) + "\n")
        command = (
            f'source "{root / "app/wiz_pr_review_state.sh"}"; '
            f'wiz_review_state_begin_manual_resume fixture 1 1 "{state["attempt_id"]}" '
            f'"$(( $(date +%s) + 100 ))" failed 0 >/dev/null'
        )
        run = subprocess.run(
            ["bash", "-c", command], text=True, capture_output=True, env=env, timeout=30,
        )
        assert run.returncode == 0, run.stdout + run.stderr
        recovered = json.loads(state_file.read_text())
        phases = recovered["finalization_phases"]
        assert phases["slack_artifacts"]["status"] == "posted", phases
        assert phases["slack_artifacts"]["recovered_from_uncertain_claim"] is True, phases
        assert phases["github_artifacts"]["status"] == "posted", phases
        assert phases["final_review"]["status"] == "claimed", phases
    finally:
        shutil.rmtree(root)


def test_fresh_launch_watcher_registration_cannot_regress_terminal_state() -> None:
    root, env, state_file = build_fixture()
    try:
        state = json.loads(state_file.read_text())
        state["status"] = "launching"
        state_file.write_text(json.dumps(state) + "\n")
        command = (
            f'source "{root / "app/wiz_pr_review_state.sh"}"; '
            f'wiz_review_state_mark_status fixture 1 1 completed "{state["attempt_id"]}" 0; '
            f'wiz_review_state_record_watcher fixture 1 1 4242 /tmp/watcher.log '
            f'"{state["attempt_id"]}" 0; rc=$?; echo rc=$rc; exit 0'
        )
        run = subprocess.run(
            ["bash", "-c", command], text=True, capture_output=True, env=env, timeout=30,
        )
        assert "rc=2" in run.stdout, run.stdout + run.stderr
        terminal_state = json.loads(state_file.read_text())
        assert terminal_state["status"] == "completed", terminal_state
        assert terminal_state["watcher_pid"] is None, terminal_state
    finally:
        shutil.rmtree(root)


def test_old_recovery_generation_cannot_mutate_same_attempt() -> None:
    root, env, state_file = build_fixture()
    try:
        state = json.loads(state_file.read_text())
        state["recovery_generation"] = 1
        state_file.write_text(json.dumps(state) + "\n")
        command = (
            f'source "{root / "app/wiz_pr_review_state.sh"}"; '
            f'wiz_review_state_mark_status fixture 1 1 completed "{state["attempt_id"]}" 0; '
            f'rc1=$?; wiz_review_state_claim_finalization_phase fixture 1 1 '
            f'"{state["attempt_id"]}" final_review 0; rc2=$?; '
            f'echo rc1=$rc1 rc2=$rc2; exit 0'
        )
        run = subprocess.run(
            ["bash", "-c", command], text=True, capture_output=True, env=env, timeout=30,
        )
        assert "rc1=2 rc2=2" in run.stdout, run.stdout + run.stderr
        unchanged = json.loads(state_file.read_text())
        assert unchanged["status"] == "failed", unchanged
        assert unchanged["finalization_phases"] == {}, unchanged
    finally:
        shutil.rmtree(root)


def test_old_generation_real_finalizer_exits_before_side_effects() -> None:
    root, env, state_file = build_fixture()
    try:
        shutil.copy2(ROOT / "wiz_pr_watch_finalize.sh", root / "app/wiz_pr_watch_finalize.sh")
        (root / "app/wiz_pr_watch_finalize.sh").chmod(0o755)
        state = json.loads(state_file.read_text())
        state["recovery_generation"] = 1
        state_file.write_text(json.dumps(state) + "\n")
        agent = state["agents"]["claude-code"]
        run = subprocess.run([
            str(root / "app/wiz_pr_watch_finalize.sh"), "fixture", "1",
            agent["agent_id"], agent["autorun_dir"], "Fixture PR",
            "https://github.com/story-wizard/fixture/pull/1", "111.222",
            "claude-code", "1", state["attempt_id"], "0",
        ], text=True, capture_output=True, env=env, timeout=30)
        assert run.returncode == 0, run.stdout + run.stderr
        unchanged = json.loads(state_file.read_text())
        assert unchanged["status"] == "failed", unchanged
        assert unchanged["recovery_generation"] == 1, unchanged
        assert not (root / "events/slack").exists(), "stale finalizer posted to Slack"
    finally:
        shutil.rmtree(root)


if __name__ == "__main__":
    test_error_paused_resume_preserves_attempt_and_starts_finalizer()
    test_idle_partial_relaunches_same_playbooks()
    test_complete_playbooks_restart_finalization_only()
    test_existing_exact_head_review_reconciles_without_reposting()
    test_manual_generation_claim_rejects_status_race()
    test_live_head_drift_resumes_finalization_instead_of_failing()
    test_live_watcher_returns_already_running_without_mutation()
    test_thread_routing_agent_mismatch_fails_closed()
    test_thread_routing_attempt_mismatch_fails_closed()
    test_missing_thread_routing_fails_closed()
    test_exact_thread_record_wins_over_conflicting_legacy_pointer()
    test_legacy_thread_routing_matching_agent_still_resumes()
    test_legacy_thread_routing_agent_mismatch_fails_closed()
    test_resume_command_timeout_fails_closed()
    test_show_agent_timeout_releases_without_claiming_generation()
    test_fast_terminal_child_cannot_be_regressed_to_running()
    test_dismissed_exact_head_review_is_not_completion()
    test_head_drift_existing_review_reconciles_with_warning()
    test_manual_resume_preserves_fast_terminal_child_result()
    test_manual_resume_reconciles_abandoned_publication_claims()
    test_fresh_launch_watcher_registration_cannot_regress_terminal_state()
    test_old_recovery_generation_cannot_mutate_same_attempt()
    test_old_generation_real_finalizer_exits_before_side_effects()
    print("RESUME FIXTURES PASSED")
