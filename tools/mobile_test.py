"""`mobile_test`: UI tests as a portable artifact, not as a transcript.

The device surface can already tap and type, and a agent driving it proves a flow works
once, in this conversation. A test is a different deliverable: a file that runs again
next week, in CI, on a machine with no Hermes on it. That is the one thing this adds,
and it is why it is worth a separate 315 MB dependency rather than another action on the
device surface.

Maestro's flows are YAML over `id` and `text` accessibility selectors, which is the same
addressing the device backend uses, so a testID that works for a tap works in a flow.
`scaffold` leans on that: it reads the screen through the backend and writes a flow
skeleton naming the ids that are really there, rather than the ones someone remembered.

Opt-in, and it says so when it is not installed rather than failing obscurely: Maestro
needs a JVM and a third of a gigabyte, and nobody should pay that to tap a button.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from tools.registry import registry

logger = logging.getLogger("tools.mobile_test")

DEFAULT_TIMEOUT = 900
_MAX_OUTPUT = 8000


def _install_hint() -> Dict[str, Any]:
    from hermes_cli.tools_config_maestro import MIN_JAVA_VERSION, maestro_status
    status = maestro_status()
    if not status["java_ok"]:
        return {"error": f"Maestro needs Java {MIN_JAVA_VERSION} or newer; this host has "
                         f"{status['java'] or 'none'}.",
                "hint": "Install a JDK, then run `hermes device maestro install`."}
    return {"error": "Maestro is not installed.",
            "hint": "Run `hermes device maestro install`. It is about 315 MB, which is why "
                    "it is not part of the ordinary device install."}


def run_flow(flow: str, *, session_id: str = "", timeout: int = DEFAULT_TIMEOUT,
             env: Dict[str, str] | None = None) -> Dict[str, Any]:
    """Run one flow file against this session's device."""
    from hermes_cli.tools_config_maestro import maestro_command
    from tools.computer_use.device_adb import session_adb

    binary = maestro_command()
    if not binary:
        return _install_hint()
    path = Path(flow).expanduser()
    if not path.is_file():
        return {"error": f"no flow file at {path}"}
    adb, note = session_adb(session_id)
    if not adb:
        return {"error": f"nothing to test against: {note}"}
    serial = adb[adb.index("-s") + 1] if "-s" in adb else ""

    released = _release_ui_automation(adb)
    argv = [binary]
    if serial:
        argv += ["--device", serial]
    argv += ["test", str(path)]
    for key, value in (env or {}).items():
        argv += ["-e", f"{key}={value}"]
    try:
        result = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"error": f"the flow did not finish within {timeout}s", "flow": str(path)}
    except OSError as e:
        return {"error": f"maestro could not be started: {e}"}
    output = (result.stdout or "") + (result.stderr or "")
    artifacts = _artifacts_dir(output)
    contended = _UI_AUTOMATION_TIMEOUT in output
    return {
        "flow": str(path),
        "device": note,
        "passed": result.returncode == 0,
        "exit_code": result.returncode,
        # Maestro prints its per-step verdicts, which is the part anyone reads on a
        # failure, so the tail is kept rather than the head.
        "output": output[-_MAX_OUTPUT:],
        "truncated": len(output) > _MAX_OUTPUT,
        # Screenshots and a UI hierarchy dump of the moment it failed. Named as a field
        # rather than left inside the prose, because it is the next thing to look at and
        # nobody should have to parse a paragraph to find a path.
        **({"artifacts": artifacts} if artifacts else {}),
        **({"released_reader": True} if released else {}),
        **({"hint": _CONTENTION_HINT} if contended else {}),
    }


#: Maestro's own words when its driver cannot start. They name a timeout, which is the
#: symptom; the cause is almost always the connection below.
_UI_AUTOMATION_TIMEOUT = "driver did not start up in time"
_CONTENTION_HINT = (
    "Maestro's driver could not start. Android allows exactly one UiAutomation "
    "connection at a time, and the screen reader behind `computer_use` holds one. "
    "This run tried to release it first; if something took it back in between, stop "
    "reading the screen and run the flow again.")


def _release_ui_automation(adb: List[str]) -> bool:
    """Hand the device's single UiAutomation connection to Maestro.

    Android permits exactly one at a time, and the Android CLI's instrumentation server,
    which every screen read starts, holds it. Maestro's driver then dies with
    `UiAutomationService ... already registered!` and reports, at the surface, only that
    its driver "did not start up in time", which points at nothing. Releasing it here
    costs nothing: the next screen read brings the server back by itself, which the
    backend already expects because a cold server is its ordinary first call.
    """
    try:
        from hermes_cli.tools_config_android import LAYOUT_INSTRUMENTATION_PACKAGE
        return subprocess.run([*adb, "shell", "am", "force-stop", LAYOUT_INSTRUMENTATION_PACKAGE],
                              capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.SubprocessError, ImportError) as e:
        logger.debug("could not release the screen reader before the flow: %s", e)
        return False


def _artifacts_dir(output: str) -> str:
    """The debug directory Maestro reports after a run, or empty when it named none."""
    lines = [line.strip() for line in (output or "").splitlines()]
    for index, line in enumerate(lines):
        if line.startswith("==== Debug output"):
            return next((later for later in lines[index + 1:] if later.startswith("/")), "")
    return ""


def scaffold(path: str, *, session_id: str = "") -> Dict[str, Any]:
    """Write a starter flow naming the ids that are on the screen right now.

    A flow written from memory names ids the app does not have, and the failure arrives
    much later as "element not found". Reading them first is most of the value here.
    """
    from tools.computer_use.tool import _get_backend
    try:
        # Named explicitly. This is a device tool, and the surface a call gets otherwise
        # is the install's default, which is the desktop: a scaffold would then list the
        # ids on this machine's screen and write them into a flow meant for a phone.
        backend = _get_backend(session_id=session_id, surface="device")
        capture = backend.capture(mode="ax")
    except Exception as e:
        return {"error": f"could not read the screen: {e}"}
    app = (capture.app or "").split("/", 1)[0]
    ids = [element.attributes.get("test_id") for element in capture.elements
           if element.attributes.get("test_id")]
    if not app:
        return {"error": "no app is in the foreground to write a flow for"}
    destination = Path(path).expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(_flow_text(app, ids), encoding="utf-8")
    return {"path": str(destination), "appId": app, "ids_on_screen": ids,
            "note": "A skeleton, not a test: it launches the app and asserts the first id "
                    "is visible. Add the steps that matter, then run it."}


def _flow_text(app: str, ids: List[str]) -> str:
    """The YAML. Written by hand rather than through a serializer so the comments, which
    are most of what makes a skeleton useful, survive."""
    listed = "\n".join(f"#   {name}" for name in ids[:40]) or "#   (none on this screen)"
    first = ids[0] if ids else "replace.me"
    return (
        f"# Maestro flow for {app}, scaffolded from the screen that was open.\n"
        f"# Run it with: mobile_test(action=\"run\", flow=\"this file\")\n"
        f"# or, with no Hermes at all: maestro test <this file>\n"
        "#\n"
        "# Ids that were on screen when this was written:\n"
        f"{listed}\n"
        "\n"
        f"appId: {app}\n"
        "---\n"
        "- launchApp:\n"
        "    clearState: false\n"
        f"- assertVisible:\n"
        f"    id: \"{first}\"\n"
        "# - tapOn:\n"
        "#     id: \"some.button\"\n"
        "# - assertVisible:\n"
        "#     text: \"what should have happened\"\n"
    )


def mobile_test(action: str = "run", *, session_id: str = "", flow: str = "", path: str = "",
                timeout: int = DEFAULT_TIMEOUT) -> str:
    if action == "status":
        from hermes_cli.tools_config_maestro import maestro_status
        return json.dumps(maestro_status(), indent=2)
    if action == "scaffold":
        if not path:
            return json.dumps({"error": "scaffold needs a `path` to write to"})
        return json.dumps(scaffold(path, session_id=session_id), indent=2)
    if action == "run":
        if not flow:
            return json.dumps({"error": "run needs a `flow` file"})
        return json.dumps(run_flow(flow, session_id=session_id, timeout=timeout), indent=2)
    return json.dumps({"error": f"unknown action {action!r}; use run, scaffold or status"})


MOBILE_TEST_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["run", "scaffold", "status"],
            "description": (
                "`run` executes a Maestro flow file against this session's device. "
                "`scaffold` writes a starter flow naming the ids on screen right now. "
                "`status` reports whether Maestro and a JDK are present."
            ),
        },
        "flow": {"type": "string", "description": "For `run`: the .yaml flow file."},
        "path": {"type": "string", "description": "For `scaffold`: where to write the flow."},
        "timeout": {
            "type": "integer",
            "description": f"Seconds to allow a flow. Default {DEFAULT_TIMEOUT}.",
        },
    },
    "required": ["action"],
    "additionalProperties": False,
}


def _mobile_test_check() -> bool:
    """Reachability, not opt-in: the tool explains how to install Maestro, so it has to
    be callable on a host that has a device and has not installed it yet."""
    try:
        from hermes_cli.tools_config_android import android_tools_ready
        return android_tools_ready()
    except Exception:
        return False


registry.register(
    name="mobile_test",
    toolset="device",
    schema=MOBILE_TEST_SCHEMA,
    handler=lambda args, **kw: mobile_test(
        action=str(args.get("action") or "run"),
        session_id=str(kw.get("session_id") or ""),
        flow=str(args.get("flow") or ""),
        path=str(args.get("path") or ""),
        timeout=int(args.get("timeout") or DEFAULT_TIMEOUT),
    ),
    check_fn=_mobile_test_check,
    emoji="🧪",
)
