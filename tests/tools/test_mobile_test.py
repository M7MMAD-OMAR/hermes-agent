"""Tests for the opt-in UI-test authoring path.

Two things are worth pinning. A host without Maestro must be told what to do rather than
failing obscurely, because that is the ordinary state: it is a 315 MB opt-in. And a
scaffolded flow must name ids that are really on the screen, since a flow written from
memory fails much later as "element not found" and reads as an app bug.
"""

from __future__ import annotations

import json

import pytest

from hermes_cli import tools_config_maestro as maestro
from tools import mobile_test as tool


# --- provisioning ---------------------------------------------------------------------


def test_a_host_without_java_is_told_that_and_not_told_to_download(monkeypatch):
    """Downloading 315 MB onto a host that cannot run it is the wrong first move."""
    monkeypatch.setattr(maestro, "java_version", lambda: None)
    monkeypatch.setattr(maestro, "maestro_command", lambda: None)
    assert maestro.install_maestro(verbose=False) is False


def test_an_old_java_is_named_with_its_version(monkeypatch, capsys):
    monkeypatch.setattr(maestro, "java_version", lambda: 11)
    monkeypatch.setattr(maestro, "maestro_command", lambda: None)
    assert maestro.install_maestro(verbose=False) is False
    assert "11" in capsys.readouterr().out


def test_an_install_the_user_made_is_used_and_not_replaced(monkeypatch):
    monkeypatch.setattr(maestro, "java_version", lambda: 17)
    monkeypatch.setattr(maestro, "maestro_command", lambda: "/usr/local/bin/maestro")
    assert maestro.install_maestro(verbose=False) is True


def test_an_unverifiable_download_is_refused(monkeypatch, tmp_path):
    """This unpacks an executable into the user's home, so a checksum that cannot be read
    is a refusal rather than a shrug."""
    monkeypatch.setattr(maestro, "java_version", lambda: 17)
    monkeypatch.setattr(maestro, "maestro_command", lambda: None)
    monkeypatch.setattr(maestro, "_expected_sha256", lambda *a, **kw: None)
    monkeypatch.setattr(maestro, "maestro_home", lambda: tmp_path / "maestro")
    assert maestro.install_maestro(verbose=False) is False
    assert not (tmp_path / "maestro" / "maestro.zip").exists()


def test_a_mismatched_archive_is_deleted_rather_than_unpacked(monkeypatch, tmp_path):
    root = tmp_path / "maestro"
    monkeypatch.setattr(maestro, "java_version", lambda: 17)
    monkeypatch.setattr(maestro, "maestro_command", lambda: None)
    monkeypatch.setattr(maestro, "maestro_home", lambda: root)
    monkeypatch.setattr(maestro, "_expected_sha256", lambda *a, **kw: "0" * 64)

    def fake_download(url, destination):
        root.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"not the real archive")

        return True

    monkeypatch.setattr(maestro, "_download", fake_download)
    assert maestro.install_maestro(verbose=False) is False
    assert not (root / "maestro.zip").exists()


def test_the_release_is_pinned_not_ranged():
    """A range lets a release land on a user with no review on our side."""
    assert maestro.MAESTRO_VERSION.startswith("cli-")
    assert maestro.MAESTRO_VERSION in maestro.MAESTRO_ARCHIVE_URL
    assert maestro.MAESTRO_VERSION in maestro.MAESTRO_CHECKSUMS_URL


def test_a_status_reads_the_host_without_downloading(monkeypatch):
    monkeypatch.setattr(maestro, "maestro_command", lambda: None)
    monkeypatch.setattr(maestro, "java_version", lambda: 17)
    status = maestro.maestro_status()
    assert status["java_ok"] is True and status["ready"] is False


# --- the tool -------------------------------------------------------------------------


def test_a_missing_maestro_says_which_command_installs_it(monkeypatch):
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: None)
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_status",
                        lambda: {"java": 17, "java_ok": True})
    result = tool.run_flow("anything.yaml")
    assert "hermes device maestro install" in result["hint"]


def test_a_missing_jdk_is_reported_before_the_download_is_suggested(monkeypatch):
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: None)
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_status",
                        lambda: {"java": None, "java_ok": False})
    assert "Java" in tool.run_flow("anything.yaml")["error"]


def test_a_flow_that_is_not_there_is_named(monkeypatch, tmp_path):
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    assert "no flow file" in tool.run_flow(str(tmp_path / "absent.yaml"))["error"]


def test_a_flow_runs_against_the_session_device(monkeypatch, tmp_path):
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    seen = {}
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb", "-s", "phone-b"], "phone-b, leased"))

    class _Result:
        returncode, stdout, stderr = 0, "Flow passed", ""

    def fake_run(argv, **kwargs):
        seen["argv"] = argv
        return _Result()

    monkeypatch.setattr(tool.subprocess, "run", fake_run)
    result = tool.run_flow(str(flow), session_id="s")
    assert seen["argv"][:3] == ["maestro", "--device", "phone-b"]
    assert result["passed"] is True


def test_a_failing_flow_keeps_the_tail_where_the_verdicts_are(monkeypatch, tmp_path):
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb"], "a device"))

    class _Result:
        returncode, stdout, stderr = 1, "x" * 20000 + "ASSERTION FAILED", ""

    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _Result())
    result = tool.run_flow(str(flow))
    assert result["passed"] is False
    assert result["output"].endswith("ASSERTION FAILED")
    assert result["truncated"] is True


def test_a_scaffold_names_the_ids_that_are_really_on_screen(monkeypatch, tmp_path):
    """A flow written from memory names ids the app does not have."""
    from tools.computer_use.backend import CaptureResult, UIElement
    capture = CaptureResult(mode="ax", width=1, height=1, app="com.demo/.MainActivity",
                            elements=[UIElement(index=1, role="Button", label="Go",
                                                attributes={"test_id": "home.go"}),
                                      UIElement(index=2, role="Text", label="x",
                                                attributes={"test_id": ""})])

    class _Backend:
        def capture(self, **kwargs):
            return capture

    monkeypatch.setattr("tools.computer_use.tool._get_backend",
                        lambda session_id="", surface="": _Backend())
    out = tool.scaffold(str(tmp_path / "flow.yaml"), session_id="s")
    text = (tmp_path / "flow.yaml").read_text(encoding="utf-8")
    assert out["appId"] == "com.demo"
    assert "appId: com.demo" in text
    assert 'id: "home.go"' in text
    assert out["ids_on_screen"] == ["home.go"]


def test_a_scaffold_with_no_app_in_front_refuses(monkeypatch, tmp_path):
    from tools.computer_use.backend import CaptureResult

    class _Backend:
        def capture(self, **kwargs):
            return CaptureResult(mode="ax", width=1, height=1, app="", elements=[])

    monkeypatch.setattr("tools.computer_use.tool._get_backend",
                        lambda session_id="", surface="": _Backend())
    assert "no app" in tool.scaffold(str(tmp_path / "flow.yaml"))["error"]


def test_an_unknown_action_is_named():
    assert "explode" in json.loads(tool.mobile_test("explode"))["error"]


def test_run_without_a_flow_says_what_is_missing():
    assert "flow" in json.loads(tool.mobile_test("run"))["error"]


def test_a_stalled_download_fails_rather_than_hanging(monkeypatch, tmp_path):
    """`urlretrieve` takes no timeout, so a connection that stops answering mid-transfer
    sits there forever with no output. Observed: 272 MB of 315 arrived and it hung."""
    class _Stalled:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, _size):
            raise TimeoutError("the connection stopped answering")

    monkeypatch.setattr(maestro.urllib.request, "urlopen", lambda url, timeout=None: _Stalled())
    assert maestro._download("https://example.test/x.zip", tmp_path / "x.zip") is False


def test_a_partial_download_is_not_left_behind(monkeypatch, tmp_path):
    """A half-written archive would fail its checksum next run, which reads as a corrupt
    release rather than as an interrupted download."""
    root = tmp_path / "maestro"
    monkeypatch.setattr(maestro, "java_version", lambda: 17)
    monkeypatch.setattr(maestro, "maestro_command", lambda: None)
    monkeypatch.setattr(maestro, "maestro_home", lambda: root)
    monkeypatch.setattr(maestro, "_expected_sha256", lambda *a, **kw: "0" * 64)
    monkeypatch.setattr(maestro, "_download", lambda url, destination: False)
    assert maestro.install_maestro(verbose=False) is False
    assert not (root / "maestro.zip").exists()


def test_a_failure_names_the_artifacts_directory_as_a_field(monkeypatch, tmp_path):
    """Screenshots and a hierarchy dump of the failing moment are the next thing to look
    at, and nobody should have to parse a paragraph to find the path."""
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb"], "a device"))

    class _Result:
        returncode = 1
        stdout = ('Assert that "Count: 99" is visible... FAILED\n\n'
                  "==== Debug output (logs & screenshots) ====\n\n"
                  "/home/someone/.maestro/tests/2026-09-13_034202\n")
        stderr = ""

    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _Result())
    result = tool.run_flow(str(flow))
    assert result["artifacts"] == "/home/someone/.maestro/tests/2026-09-13_034202"


def test_a_passing_run_carries_no_artifacts_field(monkeypatch, tmp_path):
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb"], "a device"))

    class _Result:
        returncode, stdout, stderr = 0, "Flow passed", ""

    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _Result())
    assert "artifacts" not in tool.run_flow(str(flow))


def test_a_flow_takes_the_ui_automation_connection_before_it_runs(monkeypatch, tmp_path):
    """Android permits exactly one UiAutomation connection, and the screen reader behind
    `computer_use` holds it. Maestro's driver then dies and reports only that it "did not
    start up in time", which points at nothing."""
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    calls = []
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb", "-s", "p"], "p, leased"))

    class _Result:
        returncode, stdout, stderr = 0, "Flow passed", ""

    def fake_run(argv, **kwargs):
        calls.append(argv)
        return _Result()

    monkeypatch.setattr(tool.subprocess, "run", fake_run)
    result = tool.run_flow(str(flow))
    assert calls[0][1:] == ["-s", "p", "shell", "am", "force-stop",
                            "com.android.cli.interact.instrumentation"]
    assert calls[1][0] == "maestro"
    assert result["released_reader"] is True


def test_a_driver_timeout_names_the_connection_rather_than_the_symptom(monkeypatch, tmp_path):
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb"], "a device"))

    class _Result:
        returncode = 1
        stdout = "Maestro Android driver did not start up in time on emulator [ x ]"
        stderr = ""

    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _Result())
    assert "UiAutomation" in tool.run_flow(str(flow))["hint"]


def test_a_healthy_run_carries_no_contention_hint(monkeypatch, tmp_path):
    flow = tmp_path / "flow.yaml"
    flow.write_text("appId: com.x\n", encoding="utf-8")
    monkeypatch.setattr("hermes_cli.tools_config_maestro.maestro_command", lambda: "maestro")
    monkeypatch.setattr("tools.computer_use.device_adb.session_adb",
                        lambda session_id: (["adb"], "a device"))

    class _Result:
        returncode, stdout, stderr = 0, "Flow passed", ""

    monkeypatch.setattr(tool.subprocess, "run", lambda argv, **kw: _Result())
    assert "hint" not in tool.run_flow(str(flow))


def test_a_scaffold_reads_the_phone_and_never_this_machine(monkeypatch, tmp_path):
    """A device tool that takes the install's default surface reads the desktop on a
    desktop-default install, and writes the ids on this screen into a flow for a phone."""
    from tools.computer_use.backend import CaptureResult, UIElement
    asked = {}

    class _Backend:
        def capture(self, **kwargs):
            return CaptureResult(mode="ax", width=1, height=1, app="com.demo/.Main",
                                 elements=[UIElement(index=1, role="Button", label="Go",
                                                     attributes={"test_id": "home.go"})])

    def fake_get_backend(session_id="", surface=""):
        asked["surface"] = surface

        return _Backend()

    monkeypatch.setattr("tools.computer_use.tool._get_backend", fake_get_backend)
    tool.scaffold(str(tmp_path / "flow.yaml"), session_id="s")
    assert asked["surface"] == "device"
