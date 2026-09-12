"""Tests for the mobile device backend's contract with `handle_computer_use`.

What is pinned here is what a wrong answer makes expensive or silent:

* The overlay guard. React Native's error overlay eats taps while `input tap` still
  exits 0, so a successful transport must not be reported as a successful action.
* Addressing. A stale index must error rather than act on whatever moved into the
  slot, and an ambiguous testID must error rather than pick one.
* Device selection. Two attached devices is an error, not a coin flip.

Device I/O is stubbed at the module seam the backend actually reads through, so these
run on a host with no SDK and no device.
"""

from __future__ import annotations

import json

import pytest

from tools.computer_use import device_backend, device_backend_screen as screen
from tools.computer_use.backend import UIElement
from tools.computer_use.device_backend_input import error_overlay, press_keys
from tools.computer_use.device_backend_screen import DeviceError


def _item(**overrides):
    item = {"class": "android.widget.Button", "resource-id": "", "text": "", "content-desc": "",
            "interactions": ["CLICK"], "bounds": "[0,0][100,50]", "center": "[50,25]"}
    item.update(overrides)
    return item


def _dump(monkeypatch, items):
    monkeypatch.setattr(screen, "_run", lambda argv, **kw: json.dumps(items))


def test_bounds_become_origin_and_size(monkeypatch):
    """The device reports corners; the ABC's UIElement carries x, y, w, h."""
    _dump(monkeypatch, [_item(bounds="[10,20][110,70]")])
    assert screen.read_elements("android")[0].bounds == (10, 20, 100, 50)


def test_the_instrumentation_server_is_never_a_target(monkeypatch):
    """Its own views are in every dump and are noise in all of them."""
    _dump(monkeypatch, [_item(**{"resource-id": "com.android.cli.interact.instrumentation:id/x"}),
                        _item(text="Sign in")])
    elements = screen.read_elements("android")
    assert [e.label for e in elements] == ["Sign in"]
    assert elements[0].index == 1


def test_indices_are_one_based_for_the_model(monkeypatch):
    _dump(monkeypatch, [_item(text="a"), _item(text="b"), _item(text="c")])
    assert [e.index for e in screen.read_elements("android")] == [1, 2, 3]


def test_a_stale_token_refuses_instead_of_resolving_elsewhere(monkeypatch):
    _dump(monkeypatch, [_item(text="Save")])
    elements = screen.read_elements("android")
    with pytest.raises(DeviceError, match="no longer the one"):
        screen.resolve(elements, element=1, token="0000000000000000")


def test_an_index_past_the_end_says_to_capture_again(monkeypatch):
    _dump(monkeypatch, [_item(text="Save")])
    with pytest.raises(DeviceError, match="(?i)capture again"):
        screen.resolve(screen.read_elements("android"), element=4)


def test_an_ambiguous_test_id_refuses_to_pick(monkeypatch):
    _dump(monkeypatch, [_item(**{"resource-id": "app:id/row"}),
                        _item(**{"resource-id": "app:id/row"})])
    with pytest.raises(DeviceError, match="matches 2"):
        screen.resolve(screen.read_elements("android"), test_id="row")


def test_a_missing_test_id_lists_what_is_on_screen(monkeypatch):
    _dump(monkeypatch, [_item(**{"resource-id": "app:id/submit"})])
    with pytest.raises(DeviceError, match="submit"):
        screen.resolve(screen.read_elements("android"), test_id="cancel")


def test_an_empty_dump_names_the_instrumentation_server(monkeypatch):
    """`android layout` exits 0 and prints nothing when its server is cold, which reads as
    an empty screen. The message has to point at the real cause."""
    monkeypatch.setattr(screen, "_run", lambda argv, **kw: "")
    monkeypatch.setattr(screen.time, "sleep", lambda seconds: None)
    with pytest.raises(DeviceError, match="instrumentation"):
        screen.read_elements("android")


def _overlay_elements():
    return [UIElement(index=1, role="Button", label="Dismiss",
                      attributes={"content_desc": "Dismiss", "text": ""}),
            UIElement(index=2, role="Button", label="Minimize",
                      attributes={"content_desc": "Minimize", "text": ""}),
            UIElement(index=3, role="TextView", label="Log 1 of 2",
                      attributes={"content_desc": "", "text": "Log 1 of 2"}),
            UIElement(index=4, role="TextView", label="TypeError",
                      attributes={"content_desc": "", "text": "TypeError: x is not a function"})]


def test_the_error_overlay_is_recognised_by_its_controls():
    """It carries no resource-id anywhere, so its own buttons are the only handle."""
    assert "TypeError" in (error_overlay(_overlay_elements()) or "")


def test_an_ordinary_screen_is_not_an_overlay():
    plain = [UIElement(index=1, role="Button", label="Dismiss",
                       attributes={"content_desc": "Dismiss", "text": ""})]
    assert error_overlay(plain) is None


def test_a_swallowed_tap_is_not_reported_as_confirmed(monkeypatch):
    """The tap exits 0 and changes nothing. `ok` stays True because the transport worked;
    the verdict the model reads is `effect`."""
    backend = device_backend.AndroidDeviceBackend()
    backend._adb, backend._cli = ["adb"], "android"
    backend._elements = [UIElement(index=1, role="Button", label="Go",
                                   attributes={"center": [50, 25]})]
    monkeypatch.setattr(device_backend, "tap", lambda adb, x, y: None)
    monkeypatch.setattr(device_backend, "read_elements",
                        lambda cli, serial: _overlay_elements())
    result = backend.click(element=1)
    assert result.ok is True
    assert result.effect == "suspected_noop"
    assert result.verified is False
    assert "TypeError" in result.message


def test_a_clean_tap_is_confirmed(monkeypatch):
    backend = device_backend.AndroidDeviceBackend()
    backend._adb, backend._cli = ["adb"], "android"
    backend._elements = [UIElement(index=1, role="Button", label="Go",
                                   attributes={"center": [50, 25]})]
    monkeypatch.setattr(device_backend, "tap", lambda adb, x, y: None)
    monkeypatch.setattr(device_backend, "read_elements", lambda cli, serial: [])
    result = backend.click(element=1)
    assert (result.ok, result.effect, result.verified) == (True, "confirmed", True)


def test_two_attached_devices_is_an_error_not_a_guess():
    with pytest.raises(RuntimeError, match="ANDROID_SERIAL"):
        device_backend._sole_device_serial([{"serial": "a", "state": "device"},
                                            {"serial": "b", "state": "device"}])


def test_an_unauthorised_device_says_what_to_do_on_the_phone():
    with pytest.raises(RuntimeError, match="USB debugging prompt"):
        device_backend._sole_device_serial([{"serial": "a", "state": "unauthorized"}])


def test_no_device_is_a_clear_refusal():
    with pytest.raises(RuntimeError, match="No Android device"):
        device_backend._sole_device_serial([])


def test_non_ascii_text_is_refused_rather_than_mangled(monkeypatch):
    """`input text` has no Unicode path; sending it anyway drops characters silently."""
    from tools.computer_use.device_backend_input import type_text
    with pytest.raises(DeviceError, match="non-ASCII"):
        type_text(["adb"], "مرحبا")


def test_key_names_map_onto_android_keycodes(monkeypatch):
    sent = []
    monkeypatch.setattr("tools.computer_use.device_backend_input.run_input",
                        lambda adb, args, **kw: sent.append(args))
    assert press_keys(["adb"], "return") == "KEYCODE_ENTER"
    assert press_keys(["adb"], "ctrl+a") == "KEYCODE_CTRL_LEFT KEYCODE_A"
    assert sent[0][0] == "keyevent" and sent[1][0] == "keycombination"


def test_an_unknown_modifier_is_named(monkeypatch):
    with pytest.raises(DeviceError, match="hyper"):
        press_keys(["adb"], "hyper+a")


def test_the_android_backend_is_selectable(monkeypatch):
    from tools.computer_use import tool
    monkeypatch.setenv("HERMES_COMPUTER_USE_BACKEND", "android")
    assert isinstance(tool._new_backend("standard"), device_backend.AndroidDeviceBackend)


# --- the tool surface --------------------------------------------------------------


def test_the_surface_comes_from_config_not_the_process_env(monkeypatch):
    """Client and backend can be different machines, so an env-keyed choice is invisible on
    every topology but a locally spawned one."""
    from tools.computer_use import tool
    monkeypatch.delenv("HERMES_COMPUTER_USE_BACKEND", raising=False)
    monkeypatch.setattr("hermes_cli.config.load_config",
                        lambda *a, **kw: {"computer_use": {"surface": "android"}})
    assert isinstance(tool._new_backend("standard"), device_backend.AndroidDeviceBackend)


def test_the_env_override_still_wins_for_tests(monkeypatch):
    from tools.computer_use import tool
    monkeypatch.setenv("HERMES_COMPUTER_USE_BACKEND", "noop")
    monkeypatch.setattr("hermes_cli.config.load_config",
                        lambda *a, **kw: {"computer_use": {"surface": "android"}})
    assert not isinstance(tool._new_backend("standard"), device_backend.AndroidDeviceBackend)


def test_a_test_id_reaches_a_backend_that_understands_one():
    from tools.computer_use import tool
    backend = device_backend.AndroidDeviceBackend()
    assert tool._target(backend, {"test_id": "home.counter.increment"}) == "home.counter.increment"


def test_a_test_id_is_refused_rather_than_coerced_into_an_index():
    """Coercing it would tap whatever sits at that index. A refusal is the honest answer."""
    from tools.computer_use import tool
    with pytest.raises(tool._TestIdsUnsupported):
        tool._target(tool._NoopBackend(), {"test_id": "home.counter.increment"})


def test_an_index_is_untouched_when_no_test_id_is_given():
    from tools.computer_use import tool
    assert tool._target(tool._NoopBackend(), {"element": 4}) == 4


def test_the_capture_payload_carries_the_test_id(monkeypatch):
    """Without this the model is told to prefer an address it can never see."""
    from tools.computer_use import tool
    element = UIElement(index=1, role="Button", label="Increment", bounds=(0, 0, 10, 10),
                        attributes={"test_id": "home.counter.increment"})
    assert tool._element_to_dict(element)["test_id"] == "home.counter.increment"
    assert "test_id=home.counter.increment" in tool._format_elements([element])[0]


def test_a_desktop_element_gains_no_test_id_key():
    from tools.computer_use import tool
    plain = UIElement(index=1, role="AXButton", label="Save", bounds=(0, 0, 10, 10))
    assert "test_id" not in tool._element_to_dict(plain)


def test_filtering_to_one_package_does_not_renumber_the_originals():
    """The filtered list is renumbered 1..n for the model; the capture it came from is not."""
    elements = [UIElement(index=1, role="Button", label="a", app="other", attributes={}),
                UIElement(index=2, role="Button", label="b", app="mine", attributes={})]
    filtered = device_backend._filter_to_package(elements, "mine")
    assert [e.index for e in filtered] == [1]
    assert [e.index for e in elements] == [1, 2]


def test_an_unreachable_device_is_not_blamed_on_cua_driver(monkeypatch):
    """A device session with no phone attached was being told to install cua-driver."""
    from tools.computer_use import tool
    monkeypatch.setenv("HERMES_COMPUTER_USE_BACKEND", "android")
    hint = tool._unavailable_hint()
    assert "hermes device install" in hint
    assert "cua-driver" not in hint


def test_a_desktop_session_still_gets_the_driver_hint(monkeypatch):
    from tools.computer_use import tool
    monkeypatch.setenv("HERMES_COMPUTER_USE_BACKEND", "cua")
    assert "cua-driver" in tool._unavailable_hint()


# --- the device lease ---------------------------------------------------------------


@pytest.fixture
def leases(tmp_path, monkeypatch):
    """Lease files in a directory of this test's own, and a clean process broker."""
    from gateway.device_control_broker import get_device_control_broker
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    broker = get_device_control_broker()
    broker.reset()
    yield broker
    broker.reset()


def _provisioned(monkeypatch, devices):
    monkeypatch.setattr("hermes_cli.tools_config_android.adb_command", lambda: "adb")
    monkeypatch.setattr("hermes_cli.tools_config_android.android_cli_command", lambda: "android")
    monkeypatch.setattr("hermes_cli.tools_config_android.attached_devices", lambda: devices)


def test_starting_leases_the_device_and_stopping_gives_it_back(leases, monkeypatch):
    _provisioned(monkeypatch, [{"serial": "emulator-5554", "state": "device", "model": ""}])
    backend = device_backend.AndroidDeviceBackend(session_id="planner")
    backend.start()
    assert leases.holder("emulator-5554")["session_id"] == "planner"
    backend.stop()
    assert leases.holder("emulator-5554") is None


def test_stopping_twice_is_harmless(leases, monkeypatch):
    """`stop` runs from session release and from the atexit sweep, and either may win."""
    _provisioned(monkeypatch, [{"serial": "emulator-5554", "state": "device", "model": ""}])
    backend = device_backend.AndroidDeviceBackend(session_id="planner")
    backend.start()
    backend.stop()
    backend.stop()
    assert leases.holder("emulator-5554") is None


def test_a_second_session_cannot_start_on_a_leased_device(leases, monkeypatch):
    _provisioned(monkeypatch, [{"serial": "emulator-5554", "state": "device", "model": ""}])
    first = device_backend.AndroidDeviceBackend(session_id="planner")
    first.start()
    second = device_backend.AndroidDeviceBackend(session_id="builder")
    with pytest.raises(RuntimeError, match="already leased|held by another"):
        second.start()


def test_a_leased_device_is_skipped_rather_than_making_the_choice_ambiguous(leases, monkeypatch):
    """Two phones, one taken, is not ambiguity: it is one free device.

    The first session pins its own with ANDROID_SERIAL, which is what the ambiguity
    refusal tells a caller to do. The second then resolves without being told anything.
    """
    _provisioned(monkeypatch, [{"serial": "phone-a", "state": "device", "model": ""},
                               {"serial": "phone-b", "state": "device", "model": ""}])
    first = device_backend.AndroidDeviceBackend(session_id="planner", serial="phone-a")
    first.start()
    second = device_backend.AndroidDeviceBackend(session_id="builder")
    second.start()
    assert second._serial == "phone-b"


def test_two_free_devices_still_refuse_to_be_guessed_between(leases, monkeypatch):
    _provisioned(monkeypatch, [{"serial": "phone-a", "state": "device", "model": ""},
                               {"serial": "phone-b", "state": "device", "model": ""}])
    with pytest.raises(RuntimeError, match="ANDROID_SERIAL"):
        device_backend.AndroidDeviceBackend(session_id="planner").start()


def test_every_device_being_leased_says_that_rather_than_no_device(leases, monkeypatch):
    """'No Android device is attached' would send the user to check a cable that is fine."""
    _provisioned(monkeypatch, [{"serial": "phone-a", "state": "device", "model": ""}])
    device_backend.AndroidDeviceBackend(session_id="planner").start()
    with pytest.raises(RuntimeError, match="already leased by another"):
        device_backend.AndroidDeviceBackend(session_id="builder").start()


def test_a_failed_lease_leaves_no_scope_behind(leases, monkeypatch):
    """Otherwise `stop` would release a lease this backend never held."""
    _provisioned(monkeypatch, [{"serial": "emulator-5554", "state": "device", "model": ""}])
    device_backend.AndroidDeviceBackend(session_id="planner").start()
    second = device_backend.AndroidDeviceBackend(session_id="builder")
    with pytest.raises(RuntimeError):
        second.start()
    assert second._scope is None
    second.stop()
    assert leases.holder("emulator-5554")["session_id"] == "planner"


def test_releasing_a_session_reaches_the_backend_and_frees_the_device(leases, monkeypatch):
    """The lease is only as good as the teardown path that releases it."""
    from tools.computer_use import tool
    _provisioned(monkeypatch, [{"serial": "emulator-5554", "state": "device", "model": ""}])
    monkeypatch.setenv("HERMES_COMPUTER_USE_BACKEND", "android")
    tool.reset_backend_for_tests()
    try:
        backend = tool._get_backend(session_id="held")
        assert isinstance(backend, device_backend.AndroidDeviceBackend)
        assert leases.holder("emulator-5554")["session_id"] == "held"
        assert tool.release_computer_use_session("held") is True
        assert leases.holder("emulator-5554") is None
    finally:
        tool.reset_backend_for_tests()
