"""Android SDK detection, license gate, provisioning and doctor checks for the mobile
device platform, for `hermes tools` and `hermes device install`.

Structure mirrors `tools_config_cua.py` deliberately: detect first, never download
implicitly, hold one install lock with stale-holder recovery, and end on a doctor
self-test. Three things are specific to Android and have no cua-driver precedent:

1. Google's Android SDK Terms of Service must be accepted before any download. There
   is no silent acceptance path here; `install_android_tools` refuses without it.
2. `cmdline-tools/latest/bin/android` is a 4.9 MiB launcher stub that downloads an
   87 MiB CLI on first invocation, writing progress only to a tty. Run once, here,
   with our own reporting, never lazily inside an agent tool call.
3. Reading a device's view hierarchy installs an instrumentation APK on the device.
   That is a durable change to the user's hardware, so it is disclosed and removable.

`ANDROID_USER_HOME` stays shared, pointed at the user's real `~/.android`. Isolating
it per session would hide the user's own AVDs and re-download the CLI every session.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from hermes_cli.cli_output import (
    print_info as _print_info, print_success as _print_success, print_warning as _print_warning)
from hermes_cli.tools_config_cua import _fail, _print_output_tail, _run_text

logger = logging.getLogger("hermes_cli.tools_config")

# The click-through EULA `sdkmanager --licenses` accepts interactively. Hermes shows it once.
ANDROID_SDK_TERMS_URL = "https://developer.android.com/studio/terms"
# Air-gapped and proxy-restricted installs point the launcher stub at an internal mirror.
ANDROID_CLI_DOWNLOAD_URL_ENV = "ANDROID_CLI_DOWNLOAD_URL"
# The instrumentation APK `android layout` installs on the device on its first call.
LAYOUT_INSTRUMENTATION_PACKAGE = "com.android.cli.interact.instrumentation"
# First `android` invocation downloads 87 MiB with no output on a non-tty. Two 20s probes and a
# 120s probe all returned zero bytes and looked like a hang, so the ceiling is generous.
_CLI_WARM_TIMEOUT = 600
# Matches the cua installer's own stale-lock window, so a live install is never yanked.
_ANDROID_LOCK_STALE_AFTER = 600
_ADB_TIMEOUT = 30

_INSTALL_CMD = "hermes device install"


def _first_line(raw: str, *, limit: int = 120) -> str:
    """First non-empty line, bounded: a mirrored CLI may print a banner ahead of its version."""
    return next((line.strip()[:limit] for line in (raw or "").splitlines() if line.strip()), "")


def _last_sentence(raw: str, *, limit: int = 200) -> str:
    """Last line that reads as a sentence.

    `emulator -accel-check` frames its verdict between bare marker tokens, printing
    "accel:", a status number, the human sentence, then "accel" again. Taking the last
    non-empty line yields "accel"; requiring a space lands on the sentence.
    """
    lines = [line.strip() for line in (raw or "").splitlines() if " " in line.strip()]
    return lines[-1][:limit] if lines else ""


def android_user_home() -> Path:
    """Where AVD definitions, userdata images and the downloaded CLI live.

    Shared on purpose. A per-session value makes `emulator -list-avds` report zero AVDs
    and re-downloads the 87 MiB CLI into every session's private tree.
    """
    return Path(os.environ.get("ANDROID_USER_HOME", "").strip() or str(Path.home() / ".android"))


def _platform_default_sdk_root() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Android" / "sdk"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or str(Path.home())) / "Android" / "Sdk"
    return Path.home() / "Android" / "Sdk"


def android_sdk_root() -> Optional[Path]:
    """Resolve the SDK the same order `@expo/cli`'s `assertSdkRoot()` does: `ANDROID_HOME`,
    then the deprecated `ANDROID_SDK_ROOT`, then the platform default. Returns None when
    none of them exists, which is Tier 0's "nothing installed" answer and costs 0 bytes."""
    for candidate in (os.environ.get("ANDROID_HOME", "").strip(),
                      os.environ.get("ANDROID_SDK_ROOT", "").strip()):
        if candidate and Path(candidate).is_dir():
            return Path(candidate)
    default = _platform_default_sdk_root()
    return default if default.is_dir() else None


def _sdk_tool(*relative: str) -> Optional[str]:
    """An executable inside the resolved SDK, or None. `.exe` suffix is tried on Windows."""
    root = android_sdk_root()
    if root is None:
        return None
    path = root.joinpath(*relative)
    for candidate in ((path, path.with_suffix(".exe")) if sys.platform == "win32" else (path,)):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def adb_command() -> Optional[str]:
    """The SDK's own adb wins over PATH: a distro adb can be a different protocol version
    than the platform-tools the emulator was built against."""
    return _sdk_tool("platform-tools", "adb") or shutil.which("adb")


def emulator_command() -> Optional[str]:
    """The classic emulator binary. Launch stays here rather than on `android emulator start`,
    whose headless behaviour is unverified, and a window on the user's desktop is a hard no."""
    return _sdk_tool("emulator", "emulator") or shutil.which("emulator")


def android_cli_command() -> Optional[str]:
    """The `android` entry point, which on a fresh SDK is the launcher stub, not the CLI."""
    return shutil.which("android") or _sdk_tool("cmdline-tools", "latest", "bin", "android")


def android_cli_downloaded() -> bool:
    """Whether the launcher stub has already fetched the real CLI."""
    binary = android_user_home() / "bin" / "android-cli"
    return binary.is_file() or binary.with_suffix(".exe").is_file()


def _android_state_dir() -> Path:
    from hermes_constants import get_hermes_home
    return get_hermes_home() / "android"


def _license_marker() -> Path:
    return _android_state_dir() / "sdk-license-accepted.json"


def license_accepted() -> bool:
    """Whether this Hermes home has recorded an acceptance of Google's SDK terms."""
    try:
        return bool(json.loads(_license_marker().read_text(encoding="utf-8")).get("accepted_at"))
    except (OSError, ValueError):
        return False


def record_license_acceptance(*, principal: str = "") -> None:
    """Record that the user accepted the terms. Callers must have actually shown them; the
    confirmation dialog belongs to the caller, not to this function."""
    marker = _license_marker()
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({"accepted_at": time.time(), "terms_url": ANDROID_SDK_TERMS_URL,
                                  "principal": principal}, indent=2), encoding="utf-8")


def kvm_status() -> Dict[str, object]:
    """Hardware acceleration readiness. `emulator -accel-check` is the real probe and needs no
    boot; `/dev/kvm` inspection is the fallback that explains *why* when it fails, because the
    common first-run outcome is a fixable group membership, not missing hardware."""
    state: Dict[str, object] = {"accelerated": False, "detail": "", "fix": ""}
    if sys.platform != "linux":
        state["detail"] = f"not checked on {sys.platform}"
        return state
    emulator = emulator_command()
    if emulator:
        try:
            result = _run_text([emulator, "-accel-check"], timeout=30)
            state["accelerated"] = result.returncode == 0
            state["detail"] = _last_sentence(result.stdout or result.stderr)
            if state["accelerated"]:
                return state
        except (OSError, subprocess.SubprocessError) as e:
            state["detail"] = f"emulator -accel-check failed: {e}"
    kvm = Path("/dev/kvm")
    if not kvm.exists():
        state["detail"] = state["detail"] or "/dev/kvm is absent"
        state["fix"] = "Enable virtualisation (VT-x / AMD-V) in firmware, or run without acceleration."
        return state
    if os.access(kvm, os.R_OK | os.W_OK):
        state["accelerated"] = True
        state["detail"] = "/dev/kvm is readable and writable"
        return state
    state["detail"] = "/dev/kvm exists but this user cannot open it"
    state["fix"] = "sudo usermod -aG kvm $USER, then log out and back in (one time)."
    return state


def _adb_lines(args: List[str], *, timeout: int = _ADB_TIMEOUT) -> List[str]:
    """Run adb and return its stdout lines, or an empty list. Never calls `kill-server`:
    that tears down the server shared by every client on this host, not just ours."""
    adb = adb_command()
    if not adb:
        return []
    try:
        result = _run_text([adb, *args], timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug("adb %s failed: %s", " ".join(args), e)
        return []
    return (result.stdout or "").strip().splitlines() if result.returncode == 0 else []


def attached_devices() -> List[Dict[str, str]]:
    """Devices adb can see right now, as `{serial, state, model}`. Tier 2's whole story:
    a physical device costs nothing beyond platform-tools."""
    devices = []
    for line in _adb_lines(["devices", "-l"]):
        if not line.strip() or line.startswith("List of devices"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        props = dict(p.split(":", 1) for p in parts[2:] if ":" in p)
        devices.append({"serial": parts[0], "state": parts[1],
                        "model": props.get("model", ""), "device": props.get("device", "")})
    return devices


def available_avds() -> List[str]:
    emulator = emulator_command()
    if not emulator:
        return []
    try:
        result = _run_text([emulator, "-list-avds"], timeout=30)
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]


def _devices_with_leases() -> List[Dict[str, str]]:
    """Attached devices, each annotated with the session holding it, when one does.

    Best effort: a broker that cannot be imported must not break a status report whose
    whole job is to work on a host where something is missing.
    """
    devices = attached_devices()
    try:
        from gateway.device_control_broker import get_device_control_broker
        broker = get_device_control_broker()
    except Exception:
        return devices
    for device in devices:
        record = broker.holder(device["serial"]) or {}
        holder = record.get("session_id") or record.get("principal_id") or record.get("pid")
        if holder:
            device["leased_by"] = str(holder)
    return devices


def android_tools_status() -> Dict[str, object]:
    """Tier 0: everything the doctor and the setup wizard need, without downloading a byte."""
    root = android_sdk_root()
    adb, emulator, cli = adb_command(), emulator_command(), android_cli_command()
    status: Dict[str, object] = {
        "sdk_root": str(root) if root else "",
        "android_user_home": str(android_user_home()),
        "adb": adb or "",
        "emulator": emulator or "",
        "android_cli": cli or "",
        "android_cli_downloaded": android_cli_downloaded(),
        "license_accepted": license_accepted(),
        "kvm": kvm_status(),
        "avds": available_avds(),
        "devices": _devices_with_leases(),
    }
    status["ready"] = bool(adb and cli and status["android_cli_downloaded"])
    return status


def android_tools_ready() -> bool:
    """Whether a device backend can start right now. Deliberately does not require an AVD or an
    attached device: having no device is a runtime condition, not a broken install."""
    return bool(android_tools_status()["ready"])


def _install_lock_dir() -> Path:
    return _android_state_dir() / ".install.lock.d"


def _clear_stale_install_lock() -> None:
    """Remove a lock whose holder is provably gone. Same shape as the cua installer's recovery:
    a pid that still answers signal 0 means a concurrent install owns it and we wait."""
    lock_dir = _install_lock_dir()
    if not lock_dir.is_dir():
        return
    try:
        holder = int((lock_dir / "pid").read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        holder = None
    if holder is not None:
        try:
            os.kill(holder, 0)
            return
        except ProcessLookupError:
            pass
        except (PermissionError, OSError):
            return
    else:
        try:
            if time.time() - lock_dir.stat().st_mtime < _ANDROID_LOCK_STALE_AFTER:
                return
        except OSError:
            return
    shutil.rmtree(lock_dir, ignore_errors=True)
    logger.info("Cleared stale Android install lock at %s", lock_dir)


def _acquire_install_lock() -> bool:
    """True when this process now owns the lock. `mkdir` is the atomic primitive."""
    _clear_stale_install_lock()
    lock_dir = _install_lock_dir()
    try:
        lock_dir.parent.mkdir(parents=True, exist_ok=True)
        lock_dir.mkdir()
    except FileExistsError:
        return False
    except OSError as e:
        logger.debug("android install lock could not be created: %s", e)
        return False
    (lock_dir / "pid").write_text(str(os.getpid()), encoding="utf-8")
    return True


def _release_install_lock() -> None:
    shutil.rmtree(_install_lock_dir(), ignore_errors=True)


def warm_android_cli(*, verbose: bool = True) -> bool:
    """Make the launcher stub download the real CLI, once, with our own progress reporting.

    Left to itself this happens inside whatever call first needs it, silently, for minutes.
    `ANDROID_CLI_DOWNLOAD_URL` is honoured for mirrors, so an air-gapped install has a lever.
    """
    cli = android_cli_command()
    if not cli:
        return _fail("The Android CLI was not found.",
                     "Install the SDK command-line tools, or set ANDROID_HOME to an existing SDK.")
    if android_cli_downloaded():
        return True
    if verbose:
        mirror = os.environ.get(ANDROID_CLI_DOWNLOAD_URL_ENV, "").strip()
        _print_info("    Downloading the Android CLI (about 87 MiB) on first use"
                    + (f" from {mirror}." if mirror else "."))
    try:
        result = _run_text([cli, "--version"], timeout=_CLI_WARM_TIMEOUT)
    except subprocess.TimeoutExpired:
        return _fail(f"The Android CLI download did not finish within {_CLI_WARM_TIMEOUT}s.",
                     "Check the network, or set ANDROID_CLI_DOWNLOAD_URL to an internal mirror.")
    except OSError as e:
        return _fail(f"The Android CLI could not be started: {e}")
    if result.returncode != 0 or not android_cli_downloaded():
        _print_output_tail(result)
        return _fail("The Android CLI did not install itself.",
                     f"Run {cli} --version by hand to see its output on a terminal.")
    if verbose:
        _print_success(f"    Android CLI ready ({_first_line(result.stdout) or 'installed'}).")
    return True


def install_android_tools(*, accept_license: bool = False, verbose: bool = True) -> bool:
    """Provision what a device backend needs, refusing to download before the terms are accepted.

    Returns True when the host can drive a device afterwards. Does not create an AVD and does
    not install a system image: those are a size decision the device panel asks about
    separately, and a host with a physical device (Tier 2) needs neither.
    """
    if accept_license and not license_accepted():
        record_license_acceptance()
    if not license_accepted():
        return _fail("Google's Android SDK Terms of Service have not been accepted yet.",
                     f"Read them at {ANDROID_SDK_TERMS_URL},",
                     f"then run {_INSTALL_CMD} --accept-license to record your acceptance.")
    if android_sdk_root() is None:
        return _fail("No Android SDK was found.",
                     "Checked ANDROID_HOME, ANDROID_SDK_ROOT and "
                     f"{_platform_default_sdk_root()}.",
                     "Install the SDK command-line tools and set ANDROID_HOME, then re-run.")
    if not _acquire_install_lock():
        return _fail("Another Android install is already running in this Hermes home.",
                     "Wait for it to finish, then re-run.", warn=False)
    try:
        if not warm_android_cli(verbose=verbose):
            return False
        if adb_command() is None:
            return _fail("platform-tools (adb) is missing from the SDK.",
                         "Install it with: android sdk install platform-tools")
        kvm = kvm_status()
        if verbose and not kvm["accelerated"]:
            _print_warning(f"    Emulator acceleration is unavailable: {kvm['detail']}")
            if kvm["fix"]:
                _print_info(f"    {kvm['fix']}")
            _print_info("    A physical device over adb needs no acceleration.")
    finally:
        _release_install_lock()
    if verbose:
        _print_success("Android device support is ready.")
    return True


def pair_wireless(address: str, code: str) -> Dict[str, object]:
    """Pair with a device over the network, using the code the device is showing.

    Android 11 and newer. The code is generated by the device and displayed on its
    screen, so Hermes cannot know it or fetch it: the only honest flow is to ask the
    person to read it off the phone. Pairing is a one-time trust exchange; connecting
    afterwards is what has to happen again each session.
    """
    adb = adb_command()
    if not adb:
        return {"ok": False, "error": "adb is not installed"}
    if not code.strip().isdigit() or len(code.strip()) != 6:
        return {"ok": False, "error": "the pairing code is the six digits the device is "
                                      "showing under Wireless debugging, Pair device with "
                                      "pairing code"}
    try:
        result = _run_text([adb, "pair", address, code.strip()], timeout=60)
    except (OSError, subprocess.SubprocessError) as e:
        return {"ok": False, "error": f"pairing failed: {e}"}
    output = (result.stdout or result.stderr or "").strip()
    return {"ok": "Successfully paired" in output, "output": output[:300],
            "next": "Now connect to the device's own debugging port, which is a different "
                    "port from the pairing one: hermes device connect <ip>:<port>"}


def connect_wireless(address: str) -> Dict[str, object]:
    """Attach to an already-paired device. Needed once per session, unlike pairing."""
    adb = adb_command()
    if not adb:
        return {"ok": False, "error": "adb is not installed"}
    try:
        result = _run_text([adb, "connect", address], timeout=60)
    except (OSError, subprocess.SubprocessError) as e:
        return {"ok": False, "error": f"connect failed: {e}"}
    output = (result.stdout or result.stderr or "").strip()
    # adb reports a refused connection on stdout with exit status 0, so the text is the
    # only verdict there is.
    return {"ok": "connected to" in output.lower() and "cannot" not in output.lower(),
            "output": output[:300]}


def layout_instrumentation_installed(serial: str = "") -> bool:
    """Whether the CLI's instrumentation server is on the device.

    Reading a screen installs it. It is why reads work without `adb root`, and it is a durable
    change to hardware the user owns, so every surface that can install it must be able to say
    that it is there and remove it.
    """
    target = ["-s", serial] if serial else []
    lines = _adb_lines([*target, "shell", "pm", "list", "packages", LAYOUT_INSTRUMENTATION_PACKAGE])
    return any(LAYOUT_INSTRUMENTATION_PACKAGE in line for line in lines)


def remove_layout_instrumentation(serial: str = "") -> bool:
    """Uninstall the instrumentation server. The next screen read reinstalls it."""
    adb = adb_command()
    if not adb:
        return False
    target = ["-s", serial] if serial else []
    try:
        result = _run_text([adb, *target, "shell", "pm", "uninstall",
                            LAYOUT_INSTRUMENTATION_PACKAGE], timeout=_ADB_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug("instrumentation uninstall failed: %s", e)
        return False
    return result.returncode == 0 and "Success" in (result.stdout or "")
