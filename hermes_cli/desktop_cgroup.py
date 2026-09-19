"""Keep the launched desktop tree inside the launcher's transient scope.

``hermes desktop`` starts Electron under ``systemd-run --scope`` in
``hermes-ui.slice`` (see ``_desktop_slice_prefix``). Chromium then creates a
scope of its own, ``app-org.chromium.Chromium-<pid>.scope`` under ``app.slice``,
and moves the browser process into it, so everything that process spawns
afterwards (the profile backends, and until tools/cgroup_placement.py every tool
child) inherits a cgroup with none of the slice's protection. Observed on
19 September 2026: the zygotes stayed in hermes.slice, the main process and both
QEMU guests it had indirectly started did not.

This watcher runs beside the launch: it finds the browser process under the
``systemd-run`` child, and whenever its cgroup is not the launcher's scope, moves
every process of that foreign cgroup back. Writing pids into ``cgroup.procs`` is
allowed because the ``user@<uid>.service`` subtree is delegated to the user.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable, List, Optional

from tools.cgroup_placement import CGROUP_ROOT, cgroup_of, move_pids

WATCH_SECONDS = 120.0
WATCH_INTERVAL_SECONDS = 2.0


def _children(pid: int) -> List[int]:
    try:
        text = Path(f"/proc/{pid}/task/{pid}/children").read_text(encoding="ascii")
    except OSError:
        return []
    return [int(token) for token in text.split()]


def _scope_cgroup(unit: str) -> Optional[Path]:
    """The cgroup directory of the launcher's scope, once systemd has created it."""
    import subprocess

    from tools.process_registry import systemd_user_bus_env

    try:
        result = subprocess.run(
            ["systemctl", "--user", "show", "--value", "-p", "ControlGroup", f"{unit}.scope"],
            capture_output=True, text=True, timeout=3, check=False, env=systemd_user_bus_env(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    value = (result.stdout or "").strip()
    if result.returncode != 0 or not value.startswith("/"):
        return None
    path = CGROUP_ROOT / value.lstrip("/")
    return path if path.is_dir() else None


def _cgroup_pids(cgroup: Path) -> List[int]:
    try:
        return [int(token) for token in (cgroup / "cgroup.procs").read_text(encoding="ascii").split()]
    except (OSError, ValueError):
        return []


def rehome_once(launch_pid: int, unit: str, log: Callable[[str], None]) -> Optional[bool]:
    """One pass: True when the tree is home, False when it was moved, None when not ready."""
    home = _scope_cgroup(unit)
    if home is None:
        return None
    browsers = _children(launch_pid)
    if not browsers:
        return None
    foreign = {cg for cg in (cgroup_of(pid) for pid in browsers) if cg is not None and cg != home}
    if not foreign:
        return True
    for cgroup in foreign:
        moved = move_pids(_cgroup_pids(cgroup), home)
        log(f"→ Moved {len(moved)} desktop process(es) from {cgroup.name} back into {home.name}")
    return False


def watch_desktop_scope(launch_pid: int, unit: str, *, log: Callable[[str], None] = print,
                        seconds: float = WATCH_SECONDS, interval: float = WATCH_INTERVAL_SECONDS) -> threading.Thread:
    """Watch the launched tree for a while and keep it in the launcher's scope. Daemon thread."""

    def run() -> None:
        started = time.monotonic()
        settled = 0
        while time.monotonic() - started < seconds:
            try:
                state = rehome_once(launch_pid, unit, log)
            except Exception as exc:  # never let the watcher take the launcher down
                log(f"⚠ Desktop scope watcher stopped: {exc}")
                return
            # Chromium creates its scope once, right at startup. Two clean passes
            # after the first 20 seconds mean the tree is where it belongs.
            settled = settled + 1 if state is True else 0
            if settled >= 2 and time.monotonic() - started > 20:
                return
            time.sleep(interval)

    thread = threading.Thread(target=run, name="hermes-desktop-scope", daemon=True)
    thread.start()
    return thread
