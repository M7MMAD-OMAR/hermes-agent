"""The in-app browser's photograph, on its way to the model."""

import base64
import json

import pytest

from tools.preview_look import decode_data_url, look_result, save_look
import tools.drive_preview_tool as drive


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def data_url(raw: bytes = PNG) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode()


def test_decodes_only_a_base64_image_url():
    assert decode_data_url(data_url()) == PNG
    assert decode_data_url("https://example.test/a.png") is None
    assert decode_data_url("data:image/png,raw-not-base64") is None
    assert decode_data_url("data:text/plain;base64,aGk=") is None
    assert decode_data_url(None) is None


def test_saves_the_photograph_into_the_screenshot_cache(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    path = save_look(data_url())

    assert path is not None
    assert path.parent == tmp_path
    assert path.read_bytes() == PNG


def test_an_answer_without_an_image_stays_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    result = look_result({"success": True, "acted": "look"})

    assert result["success"] is False
    assert "image" in result["error"] or "readable" in result["error"]


def test_a_provider_without_vision_still_gets_the_path(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    monkeypatch.setattr("tools.vision_tools._should_use_native_vision_fast_path", lambda: False)
    result = look_result({"acted": "look", "image": data_url(), "url": "https://example.test/"})

    assert result["url"] == "https://example.test/"
    assert result["screenshot_path"].endswith(".png")
    # The desktop renders a MEDIA marker as an inline picture for the reader.
    assert "MEDIA:" in result["note"]


def test_look_reaches_the_vision_path_through_the_tool(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    monkeypatch.setattr("tools.vision_tools._should_use_native_vision_fast_path", lambda: False)
    answer = json.dumps({"acted": "look", "image": data_url(), "success": True})
    result = drive.drive_preview_tool(action="look", callback=lambda _payload: answer)

    assert result["screenshot_path"].endswith(".png")


def test_look_is_an_action_the_tool_accepts():
    assert "look" in drive.ACTIONS
    assert "look" in drive.ACT_PREVIEW_SCHEMA["parameters"]["properties"]["action"]["enum"]


def test_the_tool_still_refuses_outside_the_desktop():
    assert "desktop app" in drive.drive_preview_tool(action="look")
