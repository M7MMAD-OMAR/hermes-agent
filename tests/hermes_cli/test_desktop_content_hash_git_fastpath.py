"""Correctness tests for the git fast path in ``_desktop_build_needed()``.

``hermes desktop`` decides whether to rebuild by comparing a SHA-256 of every
byte under ``apps/desktop/`` (plus the root ``package.json`` /
``package-lock.json``) against a saved stamp — ``_compute_desktop_content_hash``,
measured at 131ms on this repo, run on EVERY launch regardless of whether a
rebuild is actually needed.

``_desktop_content_unchanged_via_git`` answers "did anything under those paths
change since the commit the saved hash was computed against" from git's own
index in two scoped subprocess calls (single-digit ms) instead of re-hashing
every file — but ONLY when it can prove the answer; every case it cannot
verify falls straight through to the real hash walk, so it can change how
FAST the check runs, never what it concludes.

These use a real temporary git repo rather than mocked subprocess calls: the
correctness here is fundamentally about real git plumbing (diff/status
against a specific commit, untracked files, working-tree edits), which a
mock of "what git would say" risks just re-asserting my own assumptions
instead of testing them.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    _git("init", "-q", cwd=root)
    _git("config", "user.email", "t@t", cwd=root)
    _git("config", "user.name", "t", cwd=root)

    (root / "apps" / "desktop" / "src").mkdir(parents=True)
    (root / "apps" / "desktop" / "src" / "app.ts").write_text("export const x = 1\n")
    (root / "package.json").write_text('{"name": "hermes"}\n')
    (root / "hermes_cli").mkdir()
    (root / "hermes_cli" / "models.py").write_text("# backend only\n")
    # A real checkout gitignores the build output the fast path's own dist/
    # marker lives under — without this, the integration test's dist/
    # directory reads as an untracked file and masks the fast path with a
    # correct-but-uninteresting fall-through (see the commit history for the
    # investigation), rather than testing the path this file is named for.
    (root / ".gitignore").write_text("apps/desktop/dist/\napps/desktop/release/\nnode_modules/\n")

    _git("add", "-A", cwd=root)
    _git("commit", "-q", "-m", "base", cwd=root)
    return root


def _head(repo: Path) -> str:
    return _git("rev-parse", "HEAD", cwd=repo).stdout.strip()


def _stamp(commit: str) -> dict:
    return {"contentHash": "irrelevant-for-the-fast-path-itself", "sourceMode": True, "gitCommit": commit}


class TestDesktopContentUnchangedViaGit:
    def test_matches_real_hash_when_nothing_changed(self, repo: Path):
        import hermes_cli.main as m

        real_hash_before = m._compute_desktop_content_hash(repo)
        assert m._desktop_content_unchanged_via_git(repo, _stamp(_head(repo))) is True
        # The fast path's "unchanged" verdict must agree with the ground truth
        # it's standing in for.
        assert m._compute_desktop_content_hash(repo) == real_hash_before

    def test_falls_through_on_missing_git_commit_field(self, repo: Path):
        import hermes_cli.main as m

        assert m._desktop_content_unchanged_via_git(repo, {"contentHash": "x", "sourceMode": True}) is False

    def test_falls_through_on_stale_saved_commit(self, repo: Path):
        import hermes_cli.main as m

        assert m._desktop_content_unchanged_via_git(repo, _stamp("0" * 40)) is False

    def test_falls_through_when_not_a_git_repo(self, tmp_path: Path):
        import hermes_cli.main as m

        bare = tmp_path / "not-a-repo"
        bare.mkdir()
        assert m._desktop_content_unchanged_via_git(bare, _stamp("0" * 40)) is False

    def test_falls_through_on_uncommitted_edit_to_tracked_desktop_file(self, repo: Path):
        import hermes_cli.main as m

        head = _head(repo)
        (repo / "apps" / "desktop" / "src" / "app.ts").write_text("export const x = 2\n")
        assert m._desktop_content_unchanged_via_git(repo, _stamp(head)) is False

    def test_falls_through_on_new_untracked_file_under_desktop(self, repo: Path):
        """git diff never sees untracked files — the separate status check
        is what catches this, and the real hash walk (which reads the
        filesystem, not the git index) would see it too."""
        import hermes_cli.main as m

        head = _head(repo)
        (repo / "apps" / "desktop" / "src" / "new.ts").write_text("export const y = 1\n")
        assert m._desktop_content_unchanged_via_git(repo, _stamp(head)) is False

    def test_falls_through_when_head_moved_even_if_desktop_untouched(self, repo: Path):
        """Conservative by design: only the exact commit the hash was
        computed against short-circuits. A later commit always re-hashes,
        even if it happened not to touch apps/desktop — correct, just not
        maximally optimal, which is the right trade for a check that must
        never be wrong."""
        import hermes_cli.main as m

        head = _head(repo)
        (repo / "hermes_cli" / "models.py").write_text("# a pure backend change\n")
        _git("add", "-A", cwd=repo)
        _git("commit", "-q", "-m", "backend only", cwd=repo)

        assert m._desktop_content_unchanged_via_git(repo, _stamp(head)) is False

    def test_ignores_a_change_outside_the_hashed_paths(self, repo: Path):
        """The reverse of the above at the SAME commit: an uncommitted edit
        to a file the hash walk never reads must not force a miss."""
        import hermes_cli.main as m

        head = _head(repo)
        (repo / "hermes_cli" / "models.py").write_text("# uncommitted, but outside apps/desktop\n")
        assert m._desktop_content_unchanged_via_git(repo, _stamp(head)) is True


class TestDesktopBuildNeededIntegration:
    """The fast path is wired into _desktop_build_needed as a pure
    optimization: any answer it gives must match what the function would
    have returned by hashing alone."""

    def test_up_to_date_desktop_skips_rebuild_via_fast_path(self, repo: Path, monkeypatch):
        import hermes_cli.main as m

        desktop_dir = repo / "apps" / "desktop"
        (desktop_dir / "dist").mkdir()
        (desktop_dir / "dist" / "index.html").write_text("<html></html>")
        monkeypatch.setattr(m, "_renderer_bundle_torn", lambda *_a, **_kw: False)

        m._write_desktop_build_stamp(repo, source_mode=True)
        stamp = m._desktop_stamp_path()
        assert __import__("json").loads(stamp.read_text()).get("gitCommit") == _head(repo)

        calls = {"n": 0}
        real_hash = m._compute_desktop_content_hash

        def counting_hash(*a, **kw):
            calls["n"] += 1
            return real_hash(*a, **kw)

        monkeypatch.setattr(m, "_compute_desktop_content_hash", counting_hash)

        needed = m._desktop_build_needed(desktop_dir, repo, source_mode=True)

        assert needed is False
        # The whole point: an up-to-date tree must not pay for the walk.
        assert calls["n"] == 0

    def test_a_real_desktop_change_still_triggers_rebuild(self, repo: Path, monkeypatch):
        import hermes_cli.main as m

        desktop_dir = repo / "apps" / "desktop"
        (desktop_dir / "dist").mkdir()
        (desktop_dir / "dist" / "index.html").write_text("<html></html>")
        monkeypatch.setattr(m, "_renderer_bundle_torn", lambda *_a, **_kw: False)

        m._write_desktop_build_stamp(repo, source_mode=True)
        (desktop_dir / "src" / "app.ts").write_text("export const x = 999\n")

        assert m._desktop_build_needed(desktop_dir, repo, source_mode=True) is True
