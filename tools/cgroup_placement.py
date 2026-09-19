"""Where a Hermes child process lives in the cgroup tree (Linux, systemd user session).

A process inherits its parent's cgroup, so everything a Hermes backend spawns for
an agent (a terminal command, an LSP server, an MCP server, a headless browser,
and whatever those start: a VM, a dev server, a test suite) lands in the same
cgroup as the desktop's Electron main process. The kernel then accounts for
them as one unit: memory pressure caused by an 8 GB guest is answered by
swapping the window's own pages out, and the window stops answering the
compositor. Measured 19 September 2026: 82 seconds unresponsive, no crash.

The fix is placement, not limits. ``hermes-ui.slice`` holds the desktop tree
and is protected; ``hermes-tools.slice`` holds agent work and is bounded. Both
are user units in ``~/.config/systemd/user``. This module moves children into
the tools slice at spawn time:

* ``tools_argv(argv)`` wraps a command so the child moves *itself* before
  ``exec``: ``/bin/sh -c 'printf %s "$$" > cgroup.procs; exec "$@"'``. One
  extra exec, no D-Bus round trip, no journal line per command, and the
  child's pid is the pid the caller sees, so process tracking and
  ``killpg`` are unchanged.
* ``place_pids(pids)`` moves already-running children (the MCP SDK spawns its
  own subprocess, so there is no argv to wrap).

Children go into one transient scope per Hermes process,
``hermes-tools-<pid>.scope``, created lazily by ``systemd-run`` around a
``tail --pid=<our pid>`` holder that exits when we do; the scope collects
itself once it is empty. Writing a pid into ``cgroup.procs`` is allowed
because the whole ``user@<uid>.service`` subtree is delegated to the user.

Everything degrades to "leave the child where it is": no systemd, no user bus,
a supervised gateway (which keeps its own ``MemoryMax`` scopes, see
``process_registry``), or ``HERMES_CGROUP_PLACEMENT=0``.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import threading
import time
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

_IS_LINUX = platform.system() == "Linux"

CGROUP_ROOT = Path("/sys/fs/cgroup")
UI_SLICE = "hermes-ui.slice"
TOOLS_SLICE = "hermes-tools.slice"

# The hop: move this pid into the cgroup named by $0, then become the command.
# A failed write (cgroup gone, not writable) is silent and the command still
# runs, in the parent's cgroup, which is exactly what happened before this module.
_HOP_SCRIPT = 'printf %s "$$" >"$0" 2>/dev/null; exec "$@"'

_SCOPE_SETTLE_SECONDS = 3.0
_SCOPE_RETRY_SECONDS = 60.0

_lock = threading.Lock()
_scope_cgroup: Optional[Path] = None
_scope_failed_at = 0.0
_holder: Optional[subprocess.Popen] = None


def cgroup_of(pid: int) -> Optional[Path]:
    """Absolute cgroup v2 directory of *pid*, or None when it cannot be read."""
    try:
        for line in Path(f"/proc/{pid}/cgroup").read_text(encoding="utf-8").splitlines():
            if line.startswith("0::"):
                return CGROUP_ROOT / line[3:].strip().lstrip("/")
    except OSError:
        return None
    return None


def unit_of(cgroup: Path) -> str:
    """The systemd unit a cgroup directory belongs to (its last path component)."""
    return cgroup.name


def hop_argv(argv: Sequence[str], cgroup: Path) -> List[str]:
    """*argv* wrapped so the child enters *cgroup* before exec. Pure."""
    return ["/bin/sh", "-c", _HOP_SCRIPT, str(cgroup / "cgroup.procs"), *argv]


def move_pids(pids: Iterable[int], cgroup: Path) -> List[int]:
    """Write each pid into ``cgroup/cgroup.procs``; returns the pids that moved."""
    moved: List[int] = []
    procs = cgroup / "cgroup.procs"
    for pid in pids:
        try:
            with open(procs, "w", encoding="ascii") as handle:
                handle.write(str(int(pid)))
            moved.append(int(pid))
        except (OSError, ValueError) as exc:
            # ESRCH: exited between snapshot and move. EINVAL/EACCES: not ours to move.
            logger.debug("cgroup move of pid %s into %s skipped: %s", pid, cgroup, exc)
    return moved


def placement_enabled() -> bool:
    """Linux, not opted out, and not the supervised gateway (it has its own scheme)."""
    if not _IS_LINUX or os.environ.get("HERMES_CGROUP_PLACEMENT", "").strip() == "0":
        return False
    try:
        from tools.process_registry import _is_supervised_gateway_process
        return not _is_supervised_gateway_process()
    except Exception:
        return True


def _control_group(unit: str, env: dict) -> Optional[Path]:
    """The cgroup directory systemd reports for a user unit, once it exists."""
    try:
        result = subprocess.run(
            ["systemctl", "--user", "show", "--value", "-p", "ControlGroup", unit],
            capture_output=True, text=True, timeout=3, env=env, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    value = (result.stdout or "").strip()
    if result.returncode != 0 or not value.startswith("/"):
        return None
    path = CGROUP_ROOT / value.lstrip("/")
    return path if path.is_dir() else None


def _start_scope() -> Optional[Path]:
    """Create ``hermes-tools-<pid>.scope`` around a holder that lives as long as we do."""
    global _holder
    from tools.process_registry import _systemd_run_user_scope_available, systemd_user_bus_env

    if not _systemd_run_user_scope_available():
        return None
    import shutil

    systemd_run = shutil.which("systemd-run")
    tail = shutil.which("tail")
    if systemd_run is None or tail is None:
        return None
    unit = f"hermes-tools-{os.getpid()}"
    env = systemd_user_bus_env()
    argv = [
        systemd_run, "--user", "--scope", "--quiet", "--collect",
        f"--slice={TOOLS_SLICE}", f"--unit={unit}",
        "--", tail, f"--pid={os.getpid()}", "-s", "5", "-f", "/dev/null",
    ]
    try:
        # Its own session: shutdown paths killpg our group, and the holder must
        # outlive that by a few seconds so late children still have a home.
        _holder = subprocess.Popen(
            argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True, close_fds=True, env=env,
        )
    except OSError as exc:
        logger.debug("could not start %s: %s", unit, exc)
        return None
    deadline = time.monotonic() + _SCOPE_SETTLE_SECONDS
    while time.monotonic() < deadline:
        cgroup = _control_group(f"{unit}.scope", env)
        if cgroup is not None:
            return cgroup
        if _holder.poll() is not None:
            break
        time.sleep(0.1)
    logger.debug("%s did not appear within %.0fs", unit, _SCOPE_SETTLE_SECONDS)
    return None


def tools_cgroup() -> Optional[Path]:
    """This process's tools scope directory, created on first use; None when unavailable."""
    global _scope_cgroup, _scope_failed_at
    if not placement_enabled():
        return None
    with _lock:
        if _scope_cgroup is not None and _scope_cgroup.is_dir():
            return _scope_cgroup
        _scope_cgroup = None
        if time.monotonic() - _scope_failed_at < _SCOPE_RETRY_SECONDS:
            return None
        try:
            _scope_cgroup = _start_scope()
        except Exception as exc:
            logger.debug("tools scope unavailable: %s", exc)
            _scope_cgroup = None
        if _scope_cgroup is None:
            _scope_failed_at = time.monotonic()
        return _scope_cgroup


def tools_argv(argv: Sequence[str]) -> List[str]:
    """*argv* wrapped to run inside the tools slice, or unchanged when that is not possible."""
    cgroup = tools_cgroup()
    return hop_argv(argv, cgroup) if cgroup is not None else list(argv)


def place_pids(pids: Iterable[int]) -> List[int]:
    """Move already-running children into the tools slice; returns what moved."""
    cgroup = tools_cgroup()
    return move_pids(pids, cgroup) if cgroup is not None else []


def reset_for_tests() -> None:
    """Forget the cached scope so a test can drive the creation path again."""
    global _scope_cgroup, _scope_failed_at, _holder
    with _lock:
        _scope_cgroup = None
        _scope_failed_at = 0.0
        _holder = None
