#!/usr/bin/env python3
"""Focused regression tests for clean PR-review playbook refreshes."""

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

OPS = Path(__file__).resolve().parent
REFRESH = OPS / "wiz_pr_playbooks.sh"
VERIFY_TESTS_FIXTURE = OPS / "testdata/4_VERIFY_TESTS.upstream.md"


def run_refresh(source: Path, dest: Path, backup: Optional[Path] = None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["WIZ_PLAYBOOKS_SOURCE"] = str(source)
    args = [
        "/bin/bash",
        str(REFRESH),
        "refresh",
        str(dest),
        "wizard",
        "1085",
    ]
    if backup is not None:
        args.append(str(backup))
    return subprocess.run(
        args,
        text=True,
        capture_output=True,
        env=env,
    )


def fixture() -> tuple[tempfile.TemporaryDirectory[str], Path, Path]:
    tmp = tempfile.TemporaryDirectory(prefix="wiz-playbooks-")
    root = Path(tmp.name)
    source = root / "source"
    dest = root / "wizard-pr-1085-claude-code" / "development" / "code-review"
    source.mkdir(parents=True)
    dest.mkdir(parents=True)
    (source / "1_ANALYZE_CHANGES.md").write_text(
        "# Review\n"
        "**Pull Request**: https://github.com/USER/PROJECT/pull/XXXX\n"
        "NOTE: *(Update the URL above before running this playbook)*\n"
        "- [ ] inspect\n"
        "- [ ] sentinel https://github.com/USER/PROJECT/pull/XXXX\n"
        "Agent={{AGENT_NAME}} Path={{AGENT_PATH}} Date={{DATE}} Run={{AUTORUN_FOLDER}}\n"
    )
    for name in ("2_REVIEW_CODE.md", "3_CHECK_SECURITY.md", "5_SUMMARIZE.md"):
        (source / name).write_text(f"# {name}\n- [ ] review\n")
    (source / "4_VERIFY_TESTS.md").write_text(VERIFY_TESTS_FIXTURE.read_text())
    return tmp, source, dest


def test_refresh_replaces_expanded_notes_with_pristine_templates() -> None:
    tmp, source, dest = fixture()
    try:
        (dest / "1_ANALYZE_CHANGES.md").write_text(
            "# Review\n- [x] inspect\n\n"
            "## Re-verification pass\n"
            "Hundreds of lines of stale prior-round task notes.\n"
        )
        (dest / "STALE.md").write_text("must disappear\n")
        run = run_refresh(source, dest)
        assert run.returncode == 0, run.stdout + run.stderr
        text = (dest / "1_ANALYZE_CHANGES.md").read_text()
        assert "Re-verification pass" not in text
        assert "stale prior-round" not in text
        assert "- [x]" not in text
        assert text.count("- [ ]") == 2
        assert not (dest / "STALE.md").exists()
    finally:
        tmp.cleanup()


def test_refresh_configures_only_displayed_pr_url_and_runtime_placeholders() -> None:
    tmp, source, dest = fixture()
    try:
        run = run_refresh(source, dest)
        assert run.returncode == 0, run.stdout + run.stderr
        text = (dest / "1_ANALYZE_CHANGES.md").read_text()
        assert "**Pull Request**: https://github.com/story-wizard/wizard/pull/1085" in text
        assert "sentinel https://github.com/USER/PROJECT/pull/XXXX" in text
        assert "NOTE: *(Configured automatically by maestro_pr.sh)*" in text
        assert "Agent=wizard-pr-1085-claude-code" in text
        expected_path = Path.home() / "wizard/worktrees/wizard/wizard-pr-1085-claude-code"
        assert f"Path={expected_path}" in text
        assert f"Date={__import__('datetime').date.today().isoformat()}" in text
        assert f"Run={dest.parent.parent}" in text
    finally:
        tmp.cleanup()


def test_failed_source_validation_preserves_existing_playbooks() -> None:
    tmp, source, dest = fixture()
    try:
        (source / "1_ANALYZE_CHANGES.md").unlink()
        original = "# Existing\n- [ ] keep me\n"
        (dest / "existing.md").write_text(original)
        run = run_refresh(source, dest)
        assert run.returncode != 0
        assert (dest / "existing.md").read_text() == original
    finally:
        tmp.cleanup()


def test_retained_backup_supports_outer_prelaunch_rollback() -> None:
    tmp, source, dest = fixture()
    try:
        original = "# Expanded attempt\n- [x] done\nPrior task notes.\n"
        (dest / "1_ANALYZE_CHANGES.md").write_text(original)
        backup = dest.parent / "history" / "playbooks"
        run = run_refresh(source, dest, backup)
        assert run.returncode == 0, run.stdout + run.stderr
        assert backup.joinpath("1_ANALYZE_CHANGES.md").read_text() == original
        assert "Prior task notes" not in dest.joinpath("1_ANALYZE_CHANGES.md").read_text()

        import shutil
        shutil.rmtree(dest)
        backup.rename(dest)
        assert dest.joinpath("1_ANALYZE_CHANGES.md").read_text() == original
        assert not backup.exists()
    finally:
        tmp.cleanup()


def test_refresh_replaces_local_test_execution_with_existing_ci_review() -> None:
    tmp, source, dest = fixture()
    try:
        run = run_refresh(source, dest)
        assert run.returncode == 0, run.stdout + run.stderr
        text = (dest / "4_VERIFY_TESTS.md").read_text()
        assert "### Task 5: Review Existing CI Evidence" in text
        assert "Do not build, run, rerun, or execute local test suites" in text
        assert "absence of local test execution is not a coverage gap or blocker" in text
        assert "## Existing CI Evidence" in text
        assert "### Task 5: Run Tests (if possible)" not in text
        assert "**Execute test suite**" not in text
        assert "## Test Execution Results" not in text
    finally:
        tmp.cleanup()


def test_refresh_rejects_additional_local_test_execution_instruction() -> None:
    tmp, source, dest = fixture()
    try:
        playbook = source / "4_VERIFY_TESTS.md"
        playbook.write_text(
            playbook.read_text()
            + "\n- [ ] **Run CTest too**: Execute `ctest --test-dir build`.\n"
        )
        existing = "# Existing attempt\n- [x] preserve me\n"
        (dest / "existing.md").write_text(existing)
        run = run_refresh(source, dest)
        assert run.returncode != 0
        assert "unexpected upstream 4_VERIFY_TESTS.md SHA-256" in run.stderr
        assert (dest / "existing.md").read_text() == existing
    finally:
        tmp.cleanup()


def test_refresh_rejects_duplicate_upstream_execution_block() -> None:
    tmp, source, dest = fixture()
    try:
        playbook = source / "4_VERIFY_TESTS.md"
        text = playbook.read_text()
        task = text[text.index("### Task 5:"):text.index("## Test Execution Results")]
        playbook.write_text(text + "\n" + task)
        existing = "# Existing attempt\n- [x] preserve me\n"
        (dest / "existing.md").write_text(existing)
        run = run_refresh(source, dest)
        assert run.returncode != 0
        assert "unexpected upstream 4_VERIFY_TESTS.md SHA-256" in run.stderr
        assert (dest / "existing.md").read_text() == existing
    finally:
        tmp.cleanup()


if __name__ == "__main__":
    test_refresh_replaces_expanded_notes_with_pristine_templates()
    test_refresh_configures_only_displayed_pr_url_and_runtime_placeholders()
    test_failed_source_validation_preserves_existing_playbooks()
    test_retained_backup_supports_outer_prelaunch_rollback()
    test_refresh_replaces_local_test_execution_with_existing_ci_review()
    test_refresh_rejects_additional_local_test_execution_instruction()
    test_refresh_rejects_duplicate_upstream_execution_block()
    print("ALL PLAYBOOK REFRESH TESTS PASSED")
