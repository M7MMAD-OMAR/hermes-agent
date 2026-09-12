"""Maestro provisioning: the opt-in UI-test authoring path for the device platform.

Separate from the rest of the device tooling on purpose, because its cost is different
in kind. Driving a device needs platform-tools, about 22 MB. Maestro is a 315 MB JVM
application and needs a JDK 17 or newer on the host. Nobody should pay that to tap a
button; they should pay it when they want a test flow that runs in CI without Hermes,
which is the one thing Maestro gives that the device backend does not.

The download is a pinned GitHub release verified against its published checksum, not a
script piped into a shell. `cua-driver`'s installer is the precedent for the latter and
it is the right shape for a tool that ships its own installer; Maestro publishes a plain
zip and a `checksums_sha256.txt` beside it, so there is a better option here and taking
it costs nothing.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from hermes_cli.cli_output import print_info as _print_info, print_success as _print_success
from hermes_cli.tools_config_cua import _fail

logger = logging.getLogger("hermes_cli.tools_config")

#: Pinned, like every other dependency here. A range would let a release land on a user
#: without a review on our side; see the dependency policy in AGENTS.md.
MAESTRO_VERSION = "cli-2.10.0"
_RELEASE_BASE = f"https://github.com/mobile-dev-inc/Maestro/releases/download/{MAESTRO_VERSION}"
MAESTRO_ARCHIVE_URL = f"{_RELEASE_BASE}/maestro.zip"
MAESTRO_CHECKSUMS_URL = f"{_RELEASE_BASE}/checksums_sha256.txt"
#: Per-read, not for the whole transfer: a 315 MB file over a slow link is fine, a
#: connection that stops answering is not.
_CHUNK_TIMEOUT = 120
_CHECKSUM_TIMEOUT = 60
MIN_JAVA_VERSION = 17


def maestro_home() -> Path:
    """Where Hermes installs Maestro. Not `~/.maestro`: that is where Maestro's own
    installer puts it, and overwriting a user's existing install is not ours to do."""
    from hermes_constants import get_hermes_home
    return get_hermes_home() / "maestro"


def maestro_command() -> Optional[str]:
    """The `maestro` binary: the user's own install first, then ours.

    Theirs wins because if they installed it deliberately, that is the version their
    flows and their CI are written against.
    """
    found = shutil.which("maestro")
    if found:
        return found
    for candidate in (maestro_home() / "maestro" / "bin" / "maestro",
                      Path.home() / ".maestro" / "bin" / "maestro"):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def java_version() -> Optional[int]:
    """The host's major Java version, or None when there is no java at all."""
    java = shutil.which("java")
    if not java:
        return None
    try:
        output = subprocess.run([java, "-version"], capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    text = (output.stderr or output.stdout or "")
    for token in text.split('"'):
        head = token.split(".")[0].strip()
        if head.isdigit():
            return int(head)
    return None


def maestro_status() -> dict:
    """What a caller needs to decide whether flows can run here. Downloads nothing."""
    binary, java = maestro_command(), java_version()
    return {
        "maestro": binary or "",
        "version": _maestro_version(binary) if binary else "",
        "java": java,
        "java_ok": bool(java and java >= MIN_JAVA_VERSION),
        "install_root": str(maestro_home()),
        "ready": bool(binary and java and java >= MIN_JAVA_VERSION),
    }


def _maestro_version(binary: str) -> str:
    try:
        result = subprocess.run([binary, "--version"], capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.SubprocessError):
        return ""
    return (result.stdout or result.stderr or "").strip().splitlines()[:1][0] if (
        result.stdout or result.stderr).strip() else ""


def _expected_sha256(archive_name: str = "maestro.zip") -> Optional[str]:
    """The published digest for this release's archive, or None when it cannot be read.

    A download that cannot be checked is refused rather than installed hopefully: this
    unpacks an executable into the user's home.
    """
    try:
        with urllib.request.urlopen(MAESTRO_CHECKSUMS_URL, timeout=_CHECKSUM_TIMEOUT) as response:  # noqa: S310
            body = response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as e:
        logger.debug("maestro checksum fetch failed: %s", e)
        return None
    for line in body.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip("*") == archive_name:
            return parts[0].lower()
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _download(url: str, destination: Path) -> bool:
    """Stream a release to disk with a read timeout on every chunk.

    `urlretrieve` takes no timeout at all, so a connection that stalls mid-transfer hangs
    forever with no output. Observed: 272 MB of 315 arrived and the call then sat there.
    A socket timeout turns that into an error a caller can act on.
    """
    try:
        with urllib.request.urlopen(url, timeout=_CHUNK_TIMEOUT) as response:  # noqa: S310
            with open(destination, "wb") as handle:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        return True
                    handle.write(chunk)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        logger.debug("maestro download failed: %s", e)
        return False


def install_maestro(*, verbose: bool = True) -> bool:
    """Download, verify and unpack the pinned Maestro release. True when it can run."""
    if sys.platform == "win32":
        return _fail("Maestro's CLI archive is a shell launcher and does not run on Windows.",
                     "Use WSL, or the device surface's own actions instead of flows.")
    java = java_version()
    if not java:
        return _fail("Maestro needs a Java runtime and none was found.",
                     f"Install JDK {MIN_JAVA_VERSION} or newer, then re-run.")
    if java < MIN_JAVA_VERSION:
        return _fail(f"Maestro needs Java {MIN_JAVA_VERSION} or newer; this host has {java}.")
    if maestro_command():
        if verbose:
            _print_success(f"    Maestro is already installed at {maestro_command()}.")
        return True

    expected = _expected_sha256()
    if not expected:
        return _fail("Maestro's published checksum could not be read, so the download "
                     "cannot be verified.",
                     "Check the network, or install Maestro yourself from "
                     "https://maestro.dev and Hermes will use it.")
    root = maestro_home()
    root.mkdir(parents=True, exist_ok=True)
    archive = root / "maestro.zip"
    if verbose:
        _print_info(f"    Downloading Maestro {MAESTRO_VERSION} (about 315 MB).")
    if not _download(MAESTRO_ARCHIVE_URL, archive):
        archive.unlink(missing_ok=True)
        return _fail("Maestro could not be downloaded.",
                     "Check the network, or install Maestro yourself from "
                     "https://maestro.dev and Hermes will use it.")

    actual = _sha256(archive)
    if actual != expected:
        archive.unlink(missing_ok=True)
        return _fail("Maestro's archive did not match its published checksum, so it was "
                     "deleted rather than installed.",
                     f"expected {expected}, got {actual}")
    try:
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(root)
    except (zipfile.BadZipFile, OSError) as e:
        return _fail(f"Maestro's archive could not be unpacked: {e}")
    finally:
        archive.unlink(missing_ok=True)

    binary = root / "maestro" / "bin" / "maestro"
    if not binary.is_file():
        return _fail(f"Maestro unpacked but {binary} is not there.")
    binary.chmod(binary.stat().st_mode | 0o111)
    if verbose:
        _print_success(f"    Maestro ready at {binary}.")
    return True


def remove_maestro() -> bool:
    """Delete Hermes's own copy. Never touches an install the user made themselves."""
    root = maestro_home()
    if not root.is_dir():
        return False
    shutil.rmtree(root, ignore_errors=True)
    return not root.exists()
