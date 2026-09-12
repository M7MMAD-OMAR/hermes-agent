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
