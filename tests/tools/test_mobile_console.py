"""Tests for the device console.

The thing worth pinning is the verdict, not the plumbing. Which channel carries the
app's console is invisible in the target metadata and depends on how the app was
started, and getting the verdict wrong sends someone to debug a live channel that is
dead. In particular `Log.entryAdded` must never count as evidence that the engine
delivers console over CDP: Metro's proxy injects its own notices on that event even
when the engine delivers nothing.
"""

from __future__ import annotations

import json
import time

import pytest

from tools import mobile_console as tool
from tools.mobile_console_cdp import (
    ConsoleRecord, MetroUnavailable, discover_target, supports_multiple_debuggers, translate)
from tools.mobile_console_logcat import _parse, logcat_argv


# --- translating what the app says ---------------------------------------------------


def test_a_console_call_keeps_its_arguments_and_frames():
    record = translate({"method": "Runtime.consoleAPICalled", "params": {
        "type": "error", "args": [{"type": "string", "value": "boom"}, {"value": 42}],
        "stackTrace": {"callFrames": [
            {"functionName": "onPress", "url": "app/crash.tsx", "lineNumber": 13,
             "columnNumber": 20}]}}})
    assert record.message == "boom 42"
    assert record.level == 3
    assert (record.source, record.line) == ("app/crash.tsx", 13)
    assert record.stack[0].startswith("onPress at app/crash.tsx:13")


def test_an_unhandled_rejection_arrives_as_a_warning_not_an_error():
    """React Native routes rejections through console.warn, so an error-only filter on
    this channel silently drops them."""
    record = translate({"method": "Runtime.consoleAPICalled",
                        "params": {"type": "warn", "args": [{"value": "unhandled"}]}})
    assert record.level == 2


def test_an_object_argument_survives_as_text():
    record = translate({"method": "Runtime.consoleAPICalled", "params": {
        "type": "log", "args": [{"type": "object", "description": "Object {a: 1}"}]}})
    assert record.message == "Object {a: 1}"


def test_a_failed_request_is_an_error_and_a_slow_one_is_not():
    failed = translate({"method": "Network.loadingFailed",
                        "params": {"requestId": "7", "errorText": "net::ERR_FAILED"}})
    assert (failed.level, failed.kind) == (3, "network")
    assert failed.extra["request_id"] == "7"
    ok = translate({"method": "Network.responseReceived",
                    "params": {"requestId": "8", "response": {"status": 200, "url": "u"}}})
    assert ok.level == 0


def test_a_4xx_response_is_an_error():
    record = translate({"method": "Network.responseReceived", "params": {
        "requestId": "9", "response": {"status": 404, "url": "https://example.test/x"}}})
    assert record.level == 3
    assert "404" in record.message


def test_an_event_we_do_not_carry_is_dropped():
    assert translate({"method": "Debugger.scriptParsed", "params": {}}) is None


def test_multiple_debuggers_is_read_not_assumed():
    """Hardcoding exclusivity locks a developer out of their own DevTools window."""
    assert supports_multiple_debuggers(
        {"reactNative": {"capabilities": {"supportsMultipleDebuggers": True}}}) is True
    assert supports_multiple_debuggers({}) is False


# --- logcat --------------------------------------------------------------------------


def test_a_logcat_line_becomes_a_record():
    record = _parse("09-12 16:00:00.000  1234  1234 E ReactNativeJS: it broke", None)
    assert (record.level, record.kind, record.channel) == (3, "logcat", "logcat")
    assert record.message == "it broke"
    assert record.extra["tag"] == "ReactNativeJS"


def test_a_continuation_line_folds_into_its_predecessor():
    """A structured object arrives as N separately tagged lines."""
    first = _parse("09-12 16:00:00.000  1 1 I ReactNativeJS: {", None)
    folded = _parse("09-12 16:00:00.001  1 1 I ReactNativeJS:   \"a\": 1", first)
    assert folded is None
    assert first.message == '{\n  "a": 1'


def test_a_line_that_is_not_a_log_line_is_ignored():
    assert _parse("--------- beginning of main", None) is None


def test_logcat_is_never_asked_for_the_last_n_lines():
    """`-t N` is applied before the tag filter on this adb, so combining them returns the
    last N lines of the whole buffer filtered to, usually, nothing."""
    argv = logcat_argv(["adb"], ["ReactNativeJS"])
    assert "-t" not in argv
    assert argv[-2:] == ["-s", "ReactNativeJS:V"]


# --- the verdict ---------------------------------------------------------------------


def _attachment(records=()):
    attachment = tool._Attachment(host="127.0.0.1", port=8081, adb=[], tags=("ReactNativeJS",))
    for record in records:
        attachment._append(record)
    return attachment


def _console(message="hi"):
    return ConsoleRecord(ts=time.time(), level=0, kind="console", message=message)


def _log_entry():
    return ConsoleRecord(ts=time.time(), level=0, kind="log-entry", message="proxy notice")


def test_a_log_entry_is_not_evidence_that_cdp_console_works():
    """Metro's proxy injects notices on Log.entryAdded even when the engine delivers
    nothing, so counting them reports a live channel on a dead one."""
    assert _attachment([_log_entry()]).cdp_console_live is False


def test_a_console_event_is_evidence():
    assert _attachment([_console()]).cdp_console_live is True


def test_a_silent_cdp_channel_is_named_as_the_expo_go_shape():
    attachment = _attachment([_log_entry()])
    attachment.target = {"title": "Hermes"}
    assert "Expo Go" in tool._channel_note(attachment)


def test_a_live_cdp_channel_says_the_frames_are_real():
    attachment = _attachment([_console()])
    attachment.target = {"title": "Hermes"}
    assert "stack frames are real" in tool._channel_note(attachment)


def test_a_missing_metro_is_reported_rather_than_looking_like_silence():
    attachment = _attachment()
    attachment.cdp_error = "no Metro inspector on 127.0.0.1:8081"
    assert "no Metro inspector" in tool._channel_note(attachment)


def test_the_network_domain_says_which_react_native_version_it_needs():
    attachment = _attachment()
    attachment.target = {"title": "Hermes"}
    attachment.domains = {"Network": False}
    assert "0.83" in tool._network_note(attachment)


# --- reading -------------------------------------------------------------------------


def test_a_read_returns_only_what_is_new_since_the_last_one():
    attachment = _attachment([_console("first")])
    assert [r.message for r in attachment.drain(since_last_read=True)] == ["first"]
    assert attachment.drain(since_last_read=True) == []
    attachment._append(_console("second"))
    assert [r.message for r in attachment.drain(since_last_read=True)] == ["second"]


def test_asking_for_everything_ignores_the_cursor():
    attachment = _attachment([_console("first")])
    attachment.drain(since_last_read=True)
    assert len(attachment.drain(since_last_read=False)) == 1


def test_eviction_is_counted_rather_than_silently_shifting_the_cursor():
    """Without the cursor adjustment an eviction makes the next read skip a live record."""
    attachment = _attachment()
    attachment.records = __import__("collections").deque(maxlen=2)
    for message in ("a", "b", "c"):
        attachment._append(_console(message))
    assert attachment.dropped == 1
    assert [r.message for r in attachment.drain(since_last_read=True)] == ["b", "c"]


def test_clear_resets_both_the_buffer_and_the_cursor():
    attachment = _attachment([_console()])
    assert attachment.clear() == 1
    assert attachment.dropped == 0
    assert attachment.drain(since_last_read=True) == []


# --- the tool surface -----------------------------------------------------------------


def test_an_unknown_action_is_named(monkeypatch):
    monkeypatch.setattr(tool, "_attachment", lambda *a, **kw: _attachment())
    payload = json.loads(tool.mobile_console("explode", session_id="s"))
    assert "explode" in payload["error"]


def test_stopping_a_session_that_never_attached_is_not_an_error():
    assert json.loads(tool.mobile_console("stop", session_id="never"))["detached"] is False


def test_a_level_filter_drops_the_quieter_records(monkeypatch):
    attachment = _attachment([_console("chatter"),
                              ConsoleRecord(ts=time.time(), level=3, kind="console",
                                            message="broke")])
    monkeypatch.setattr(tool, "_attachment", lambda *a, **kw: attachment)
    payload = json.loads(tool.mobile_console("read", session_id="s", level="error", wait=0))
    assert [r["message"] for r in payload["records"]] == ["broke"]


def test_a_kind_filter_selects_channels(monkeypatch):
    attachment = _attachment([_console("log line"),
                              ConsoleRecord(ts=time.time(), level=0, kind="network",
                                            message="--> GET /x")])
    monkeypatch.setattr(tool, "_attachment", lambda *a, **kw: attachment)
    payload = json.loads(tool.mobile_console("read", session_id="s", kind="network", wait=0))
    assert [r["kind"] for r in payload["records"]] == ["network"]


def test_metro_being_down_names_the_adb_reverse_step(monkeypatch):
    """A device that is not the host cannot reach Metro without it, and the failure
    otherwise reads as 'no app running'."""
    with pytest.raises(MetroUnavailable, match="adb reverse"):
        discover_target(port=1, host="127.0.0.1")


def test_network_enable_answering_ok_is_not_evidence_of_traffic():
    """Measured on RN 0.86: an app that completed nine requests produced no Network event
    while Network.enable reported success. Saying "enabled" sends someone to look for
    traffic that was never going to be reported."""
    attachment = _attachment()
    attachment.target = {"title": "Hermes"}
    attachment.domains = {"Network": True}
    note = tool._network_note(attachment)
    assert "no request event" in note
    assert note != "live"


def test_an_actual_request_event_makes_the_network_channel_live():
    attachment = _attachment([ConsoleRecord(ts=time.time(), level=0, kind="network",
                                            message="--> GET /x")])
    attachment.target = {"title": "Hermes"}
    attachment.domains = {"Network": True}
    assert tool._network_note(attachment) == "live"


def test_a_logcat_echo_of_a_cdp_console_line_is_dropped():
    """Both channels carry the same call, so a plain merge reports every line twice."""
    attachment = _attachment([_console("hello")])
    attachment._append(ConsoleRecord(ts=time.time(), level=0, kind="logcat", channel="logcat",
                                     message="hello", extra={"tag": "ReactNativeJS"}))
    assert attachment.suppressed == 1
    assert len(attachment.records) == 1


def test_a_native_logcat_tag_is_never_dropped():
    """CDP does not carry AndroidRuntime at all, so suppressing it would lose the crash."""
    attachment = _attachment([_console("hello")])
    attachment._append(ConsoleRecord(ts=time.time(), level=3, kind="logcat", channel="logcat",
                                     message="FATAL EXCEPTION", extra={"tag": "AndroidRuntime"}))
    assert attachment.suppressed == 0
    assert len(attachment.records) == 2


def test_nothing_is_suppressed_before_cdp_proves_itself():
    """In Expo Go the CDP console never fires, and dropping logcat there would leave
    nothing at all."""
    attachment = _attachment()
    attachment._append(ConsoleRecord(ts=time.time(), level=0, kind="logcat", channel="logcat",
                                     message="only channel", extra={"tag": "ReactNativeJS"}))
    assert attachment.suppressed == 0
    assert len(attachment.records) == 1


def test_a_bundle_url_is_shortened_to_what_a_reader_uses():
    """Every frame carries the same ~300 character bundle URL, which buries the function
    name and the line number."""
    from tools.mobile_console_cdp import tidy_url
    long_url = ("http://127.0.0.1:8081/node_modules/expo-router/entry.bundle//&platform="
                "android&dev=true&transform.engine=hermes")
    assert tidy_url(long_url) == "expo-router/entry.bundle"
    assert tidy_url("app/crash.tsx") == "app/crash.tsx"
    assert tidy_url("") == ""


def test_a_stringified_error_loses_its_bundle_urls_too():
    """RN stringifies an Error with its whole stack into the console.error argument, so
    the frames arrive as message text. One render error is otherwise several thousand
    characters of the same repeated URL."""
    record = translate({"method": "Runtime.consoleAPICalled", "params": {
        "type": "error", "args": [{"value":
            "Error: boom\n    at Child (http://10.0.2.2:8081/node_modules/expo-router/"
            "entry.bundle//&platform=android&dev=true&minify=false:157643:22)"}]}})
    assert "platform=android" not in record.message
    assert "expo-router/entry.bundle:157643:22" in record.message
    assert record.message.startswith("Error: boom")


# --- native crashes and ANRs ---------------------------------------------------------


def test_the_crash_watcher_reads_both_buffers_from_now():
    """A crash from an hour ago is not a notification, so the tail starts at the present."""
    from tools.mobile_console_crash import watch_command
    command = watch_command(["adb", "-s", "emulator-5554"])
    assert "-b crash" in command and "-b events" in command
    assert "-T 1" in command


def test_a_line_is_classified_so_the_notice_can_name_the_class():
    from tools.mobile_console_crash import classify
    assert classify("E AndroidRuntime: FATAL EXCEPTION: main") == "native crash"
    assert classify("I am_anr: [0,1234,com.x,0,Input dispatching timed out]") == "ANR"
    assert classify("E ActivityManager: ANR in com.x") == "ANR"


def test_exit_info_is_parsed_field_by_field():
    """`subreason` is absent on some exits, and an optional group in the middle of one
    non-greedy pattern silently never matches."""
    from tools.mobile_console_crash import parse_exit_info
    raw = """
        ApplicationExitInfo #0:
          timestamp=2026-09-12 18:40:56.847 pid=5137 realUid=10219 user=0
          process=com.x reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0
          importance=100 pss=0.00 rss=0.00 description=stop com.x due to from pid 5418 state=empty trace=null
        ApplicationExitInfo #1:
          timestamp=2026-09-12 18:38:23.949 pid=4877 realUid=10219 user=0
          process=com.x reason=6 (CRASH) status=0
          importance=100 description=crash state=empty trace=null
    """
    entries = parse_exit_info(raw)
    assert [e["pid"] for e in entries] == [5137, 4877]
    assert entries[0]["subreason"] == "21 (FORCE STOP)"
    assert "subreason" not in entries[1]
    assert (entries[0]["crashed"], entries[1]["crashed"]) == (False, True)


def test_every_exit_records_that_it_carries_no_trace():
    """Measured on API 36: trace is null on every entry, including real crashes. Recording
    it verbatim keeps the next reader from planning around a trace body that is not there."""
    from tools.mobile_console_crash import parse_exit_info
    raw = ("ApplicationExitInfo #0:\n timestamp=2026-09-12 18:40:56.847 pid=1 "
           "reason=6 (CRASH) description=x state=empty trace=null\n")
    assert parse_exit_info(raw)[0]["trace"] == "null"


def test_an_anr_exit_reason_counts_as_a_crash():
    from tools.mobile_console_crash import _is_crash
    assert _is_crash("6 (ANR)") is True
    assert _is_crash("10 (USER REQUESTED)") is False


def test_expo_go_runs_the_bundle_in_its_own_process():
    """Package-scoped filtering in Expo Go otherwise watches a process that does not exist
    and reports zero errors for a real session."""
    from tools.mobile_console_crash import EXPO_GO_PACKAGE
    assert EXPO_GO_PACKAGE == "host.exp.exponent"


def test_a_watch_without_a_device_says_which_reason(monkeypatch):
    """"nothing to watch" on its own sends someone to check a cable that is fine."""
    attachment = _attachment()
    attachment.adb, attachment.device_note = [], "several devices are attached (a, b)"
    assert "several devices" in tool._start_crash_watch(attachment, "s")["error"]


def test_exits_without_a_package_refuses_rather_than_reporting_none(monkeypatch):
    """An empty package name queries nothing and looks exactly like a healthy app."""
    attachment = _attachment()
    monkeypatch.setattr(tool, "_attachment", lambda *a, **kw: attachment)
    monkeypatch.setattr(tool, "resolve_package", lambda adb, package="": None)
    assert "no package" in json.loads(tool.mobile_console("exits", session_id="s"))["error"]


# --- which device --------------------------------------------------------------------


def test_the_leased_device_wins_over_whatever_is_attached(monkeypatch):
    """A session leased to phone-b was reading phone-a's logs."""
    from tools.computer_use import device_adb
    monkeypatch.setattr("hermes_cli.tools_config_android.adb_command", lambda: "adb")
    monkeypatch.setattr("hermes_cli.tools_config_android.attached_devices",
                        lambda: [{"serial": "phone-a", "state": "device"},
                                 {"serial": "phone-b", "state": "device"}])
    monkeypatch.setattr(device_adb, "_leased_serial", lambda session_id: "phone-b")
    argv, note = device_adb.session_adb("planner")
    assert argv == ["adb", "-s", "phone-b"]
    assert "leased" in note


def test_several_free_devices_refuse_rather_than_picking_one(monkeypatch):
    """Reading a log needs no lease. Guessing which phone the reader meant is different."""
    from tools.computer_use import device_adb
    monkeypatch.setattr("hermes_cli.tools_config_android.adb_command", lambda: "adb")
    monkeypatch.setattr("hermes_cli.tools_config_android.attached_devices",
                        lambda: [{"serial": "phone-a", "state": "device"},
                                 {"serial": "phone-b", "state": "device"}])
    monkeypatch.setattr(device_adb, "_leased_serial", lambda session_id: None)
    argv, note = device_adb.session_adb("reader")
    assert argv == []
    assert "phone-a" in note and "ANDROID_SERIAL" in note


def test_one_attached_device_needs_no_lease_to_read(monkeypatch):
    from tools.computer_use import device_adb
    monkeypatch.setattr("hermes_cli.tools_config_android.adb_command", lambda: "adb")
    monkeypatch.setattr("hermes_cli.tools_config_android.attached_devices",
                        lambda: [{"serial": "phone-a", "state": "device"}])
    monkeypatch.setattr(device_adb, "_leased_serial", lambda session_id: None)
    assert device_adb.session_adb("reader")[0] == ["adb", "-s", "phone-a"]


def test_an_env_pin_is_honoured_when_nothing_is_leased(monkeypatch):
    from tools.computer_use import device_adb
    monkeypatch.setattr("hermes_cli.tools_config_android.adb_command", lambda: "adb")
    monkeypatch.setattr(device_adb, "_leased_serial", lambda session_id: None)
    monkeypatch.setenv("ANDROID_SERIAL", "192.168.1.7:5555")
    assert device_adb.session_adb("reader")[0] == ["adb", "-s", "192.168.1.7:5555"]


def test_no_device_at_all_is_named(monkeypatch):
    from tools.computer_use import device_adb
    monkeypatch.setattr("hermes_cli.tools_config_android.adb_command", lambda: "adb")
    monkeypatch.setattr("hermes_cli.tools_config_android.attached_devices", lambda: [])
    monkeypatch.setattr(device_adb, "_leased_serial", lambda session_id: None)
    monkeypatch.delenv("ANDROID_SERIAL", raising=False)
    assert device_adb.session_adb("reader") == ([], "no device is attached")


def test_the_broker_finds_a_serial_by_session(tmp_path, monkeypatch):
    from gateway.device_control_broker import DeviceControlBroker, DeviceControlScope
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    broker = DeviceControlBroker()
    try:
        broker.acquire(DeviceControlScope(serial="phone-b", session_id="planner"))
        assert broker.serial_for_session("planner") == "phone-b"
        assert broker.serial_for_session("someone-else") is None
        assert broker.serial_for_session("") is None
    finally:
        broker.reset()


def test_the_attachment_follows_a_lease_taken_after_it(monkeypatch):
    """A session commonly reads the console before it leases a device, and the lease can
    land on a different phone than the one resolved first."""
    resolved = {"adb": ["adb", "-s", "phone-a"], "note": "phone-a, the only device attached"}
    monkeypatch.setattr(tool, "_device_adb", lambda sid: (resolved["adb"], resolved["note"]))
    monkeypatch.setattr(tool._Attachment, "start", lambda self: None)
    monkeypatch.setattr(tool._Attachment, "live", property(lambda self: True))
    first = tool._attachment("s", host="127.0.0.1", port=8081, tags=("ReactNativeJS",))
    assert tool._attachment("s", host="127.0.0.1", port=8081, tags=("ReactNativeJS",)) is first
    resolved.update(adb=["adb", "-s", "phone-b"], note="phone-b, leased by this session")
    second = tool._attachment("s", host="127.0.0.1", port=8081, tags=("ReactNativeJS",))
    assert second is not first
    assert second.adb == ["adb", "-s", "phone-b"]
    tool.release_mobile_console_session("s")
