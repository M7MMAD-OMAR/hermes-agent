"""The backend closes cache/dictionary descriptors the Electron host leaked into it, nothing else."""
from __future__ import annotations

import os
import sys

import pytest

from hermes_cli.web_server import close_inherited_host_files

pytestmark = pytest.mark.skipif(sys.platform == "win32" or not os.path.isdir("/proc/self/fd"), reason="/proc only")


def _fd_open(fd: int) -> bool:
    try:
        os.fstat(fd)
        return True
    except OSError:
        return False


def test_closes_only_host_cache_files(tmp_path):
    host = tmp_path / "Hermes"
    (host / "GPUCache").mkdir(parents=True)
    (host / "Dictionaries").mkdir()
    own = tmp_path / "Hermes" / "state.db"
    leaked_cache = os.open(str(host / "GPUCache" / "data_0"), os.O_CREAT | os.O_RDWR)
    leaked_dict = os.open(str(host / "Dictionaries" / "en-US.bdic"), os.O_CREAT | os.O_RDWR)
    kept = os.open(str(own), os.O_CREAT | os.O_RDWR)
    r, w = os.pipe()
    try:
        assert close_inherited_host_files() == 2
        assert not _fd_open(leaked_cache)
        assert not _fd_open(leaked_dict)
        # The backend's own file and its pipes are untouched.
        assert _fd_open(kept) and _fd_open(r) and _fd_open(w)
    finally:
        for fd in (kept, r, w):
            if _fd_open(fd):
                os.close(fd)


def test_is_a_no_op_with_nothing_leaked():
    assert close_inherited_host_files() == 0


def test_serve_starts_after_closing_inherited_cache(tmp_path):
    from hermes_cli.web_server import _run_serve

    cache = tmp_path / "Hermes" / "GPUCache"
    cache.mkdir(parents=True)
    fd = os.open(str(cache / "data_0"), os.O_CREAT | os.O_RDWR)
    original = os.fstat(fd)
    started = []

    async def serve():
        if _fd_open(fd):
            assert os.fstat(fd).st_ino != original.st_ino
        started.append(True)

    try:
        _run_serve(serve, None, "127.0.0.1", 0)
        assert started == [True]
    finally:
        if _fd_open(fd):
            os.close(fd)
