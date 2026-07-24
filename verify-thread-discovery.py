#!/usr/bin/env python3
"""Side-effect-free fixtures for multi-PR Slack-thread discovery (issue #4).

Covers the exact-aware lookup in wiz_pr_review_state.sh
(wiz_review_find_thread_ts / wiz_review_find_thread_agent) and the board
poller's consolidation on that shared helper. Fixture records are written by
the PRODUCTION writer (wiz_review_thread_state_write), so the legacy top-level
pointer ends up naming the last-launched PR exactly as in production. No
external service (GitHub, Slack, Maestro) is touched.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
STATE_LIB = ROOT / "wiz_pr_review_state.sh"
HEAD = "a" * 40


def bash(state_dir: Path, script: str, *args: str) -> str:
    env = {**os.environ, "WIZ_PR_STATE_DIR": str(state_dir)}
    run = subprocess.run(
        ["bash", "-c", f'source "{STATE_LIB}" && {script}', "_", *args],
        text=True, capture_output=True, env=env, timeout=30)
    assert run.returncode == 0, f"{script}: rc={run.returncode} {run.stderr}"
    return run.stdout.strip()


def write_record(state_dir: Path, repo: str, pr: int, thread: str,
                 agent: str = "claude-code", round_no: int = 1) -> None:
    """Write an exact per-PR record via the production writer (also refreshes
    the legacy top-level pointer, mirroring a real launch)."""
    bash(state_dir,
         'wiz_review_thread_state_write "$1" "$2" "$3" "$4" "$5" '
         f'"r{round_no}-1-1-1" "{HEAD}" "agent-1" "wt-1" /tmp/wt /tmp/ar',
         repo, str(pr), thread, agent, str(round_no))


def write_legacy_only(state_dir: Path, repo: str, pr: int, thread: str,
                      agent: str = "claude-code") -> None:
    """Pre-migration record: ONLY a top-level <thread_ts>.json, no thread dir."""
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / f"{thread}.json").write_text(
        '{"schema":1,"repo":"%s","pr_number":"%d","thread_ts":"%s",'
        '"agent_type":"%s","review_round":1,"attempt_id":"r1-1-1-1",'
        '"head_sha":"%s","agent_id":"agent-1","worktree_name":"wt-1",'
        '"worktree_dir":"/tmp/wt","autorun_dir":"/tmp/ar"}\n'
        % (repo, pr, thread, agent, HEAD))


def find_ts(state_dir: Path, repo: str, pr: int) -> str:
    return bash(state_dir, 'wiz_review_find_thread_ts "$1" "$2"', repo, str(pr))


def find_agent(state_dir: Path, repo: str, pr: int) -> str:
    return bash(state_dir, 'wiz_review_find_thread_agent "$1" "$2"', repo, str(pr))


def fixture() -> Path:
    root = Path(tempfile.mkdtemp(prefix="wiz-discovery-fixture-"))
    (root / "state").mkdir()
    return root


def test_multi_pr_thread_legacy_pointer_cannot_hide_exact_record() -> None:
    """Issue #4 core case: thread T hosts PR 1 (claude-code) and PR 2 (codex).
    The second launch rewrote the legacy top-level pointer to PR 2. Discovery
    for PR 1 must still find T via its exact record — before the fix it found
    nothing (and the poller would post a duplicate Slack root)."""
    root = fixture()
    try:
        state = root / "state"
        write_record(state, "wiz", 1, "111.222", agent="claude-code")
        write_record(state, "wiz", 2, "111.222", agent="codex")
        # Production invariant: legacy pointer now names PR 2.
        legacy = (state / "111.222.json").read_text()
        assert '"pr_number":"2"' in legacy, legacy

        assert find_ts(state, "wiz", 1) == "111.222"
        assert find_ts(state, "wiz", 2) == "111.222"
        # Exact record also wins for the agent: legacy says codex, PR 1 ran claude-code.
        assert find_agent(state, "wiz", 1) == "claude-code"
        assert find_agent(state, "wiz", 2) == "codex"
    finally:
        shutil.rmtree(root)


def test_legacy_only_thread_still_discovered() -> None:
    """Pre-migration threads have no exact records; the legacy fallback must
    keep working unchanged."""
    root = fixture()
    try:
        state = root / "state"
        write_legacy_only(state, "wiz", 3, "333.444", agent="codex")
        assert find_ts(state, "wiz", 3) == "333.444"
        assert find_agent(state, "wiz", 3) == "codex"
    finally:
        shutil.rmtree(root)


def test_latest_thread_wins_among_exact_records() -> None:
    """A PR reviewed in two threads over time resolves to the latest thread —
    the historical single-tier semantics, preserved within the exact tier."""
    root = fixture()
    try:
        state = root / "state"
        write_record(state, "wiz", 4, "100.000", agent="claude-code")
        write_record(state, "wiz", 4, "200.000", agent="codex")
        assert find_ts(state, "wiz", 4) == "200.000"
        assert find_agent(state, "wiz", 4) == "codex"
    finally:
        shutil.rmtree(root)


def test_no_records_returns_empty() -> None:
    root = fixture()
    try:
        state = root / "state"
        write_record(state, "wiz", 1, "111.222")
        assert find_ts(state, "wiz", 99) == ""
        assert find_agent(state, "wiz", 99) == ""
    finally:
        shutil.rmtree(root)


def test_mismatched_exact_record_content_is_ignored() -> None:
    """A file NAMED repo-pr.json whose content names a different repo/PR must
    not be trusted (hand-edited/corrupt state); discovery falls through."""
    root = fixture()
    try:
        state = root / "state"
        (state / "555.666").mkdir(parents=True)
        (state / "555.666" / "wiz-5.json").write_text(
            '{"schema":1,"repo":"other","pr_number":"6","thread_ts":"555.666",'
            '"agent_type":"codex"}\n')
        assert find_ts(state, "wiz", 5) == ""
        assert find_agent(state, "wiz", 5) == ""
        # And the impostor content is not surfaced for its claimed repo/PR either.
        assert find_ts(state, "other", 6) == ""
    finally:
        shutil.rmtree(root)


def test_exact_record_with_missing_thread_ts_is_skipped() -> None:
    """A corrupt exact record without thread_ts yields no discovery result,
    never a fabricated one."""
    root = fixture()
    try:
        state = root / "state"
        (state / "777.888").mkdir(parents=True)
        (state / "777.888" / "wiz-7.json").write_text(
            '{"schema":1,"repo":"wiz","pr_number":"7","agent_type":"codex"}\n')
        assert find_ts(state, "wiz", 7) == ""
    finally:
        shutil.rmtree(root)


def test_poller_uses_shared_exact_aware_helper() -> None:
    """Static consolidation guard: wiz_pr_poll_board.sh must not re-grow an
    inline legacy-only discovery loop; both thread lookups go through
    wiz_review_find_thread_ts."""
    poll = (ROOT / "wiz_pr_poll_board.sh").read_text()
    assert 'for sf in "$state_dir"/*.json' not in poll, \
        "inline legacy-only discovery loop reappeared in wiz_pr_poll_board.sh"
    assert poll.count("wiz_review_find_thread_ts") >= 2, \
        "expected both poller thread lookups to use wiz_review_find_thread_ts"


if __name__ == "__main__":
    test_multi_pr_thread_legacy_pointer_cannot_hide_exact_record()
    test_legacy_only_thread_still_discovered()
    test_latest_thread_wins_among_exact_records()
    test_no_records_returns_empty()
    test_mismatched_exact_record_content_is_ignored()
    test_exact_record_with_missing_thread_ts_is_skipped()
    test_poller_uses_shared_exact_aware_helper()
    print("THREAD DISCOVERY FIXTURES PASSED")
