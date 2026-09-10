"""The in-app browser's photograph, on its way to the model."""

import base64
import json

import pytest

from tools.preview_look import decode_data_url, look_result, save_look
import tools.drive_preview_tool as drive


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


def data_url(raw: bytes = PNG, media_type: str = "image/png") -> str:
    return f"data:{media_type};base64," + base64.b64encode(raw).decode()


def test_decodes_only_a_base64_image_url():
    assert decode_data_url(data_url()) == ("image/png", PNG)
    assert decode_data_url(data_url(media_type="image/jpeg")) == ("image/jpeg", PNG)
    assert decode_data_url("https://example.test/a.png") is None
    assert decode_data_url("data:image/png,raw-not-base64") is None
    assert decode_data_url("data:text/plain;base64,aGk=") is None
    assert decode_data_url("data:image/tiff;base64,aGk=") is None
    assert decode_data_url(None) is None


def test_saves_the_photograph_under_a_suffix_matching_its_type(tmp_path, monkeypatch):
    # A JPEG written as `.png` is announced to the provider as a PNG, and the
    # turn dies on an HTTP 400 naming neither the file nor the tool.
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)

    media_type, path = save_look(data_url())

    assert (media_type, path.suffix, path.parent) == ("image/png", ".png", tmp_path)
    assert path.read_bytes() == PNG

    jpeg_type, jpeg_path = save_look(data_url(media_type="image/jpeg"))

    assert (jpeg_type, jpeg_path.suffix) == ("image/jpeg", ".jpg")


def test_an_answer_without_an_image_stays_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    result = look_result({"success": True, "acted": "look"})

    assert result["success"] is False
    assert "image" in result["error"] or "readable" in result["error"]


def test_a_provider_without_vision_still_gets_the_path(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    monkeypatch.setattr("tools.vision_tools._should_use_native_vision_fast_path", lambda: False)
    result = look_result({"acted": "look", "image": data_url(media_type="image/jpeg"),
                          "url": "https://example.test/"})

    assert result["url"] == "https://example.test/"
    assert result["screenshot_path"].endswith(".jpg")
    # The desktop renders a MEDIA marker as an inline picture for the reader.
    assert "MEDIA:" in result["note"]


def test_look_reaches_the_vision_path_through_the_tool(tmp_path, monkeypatch):
    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    monkeypatch.setattr("tools.vision_tools._should_use_native_vision_fast_path", lambda: False)
    answer = json.dumps({"acted": "look", "image": data_url(media_type="image/jpeg"), "success": True})
    result = drive.drive_preview_tool(action="look", callback=lambda _payload: answer)

    assert result["screenshot_path"].endswith(".jpg")


def test_look_is_an_action_the_tool_accepts():
    assert "look" in drive.ACTIONS
    assert "look" in drive.ACT_PREVIEW_SCHEMA["parameters"]["properties"]["action"]["enum"]


def test_the_tool_still_refuses_outside_the_desktop():
    assert "desktop app" in drive.drive_preview_tool(action="look")


def test_the_media_type_reaches_the_vision_embed(tmp_path, monkeypatch):
    """The embed must declare what the bytes actually are."""
    seen = {}

    monkeypatch.setattr("tools.preview_look.screenshots_dir", lambda: tmp_path)
    monkeypatch.setattr("tools.vision_tools._should_use_native_vision_fast_path", lambda: True)

    def fake_resize(path, mime_type=None, **_kwargs):
        seen["mime_type"] = mime_type

        return f"data:{mime_type};base64,AAAA"

    monkeypatch.setattr("tools.vision_tools._resize_image_for_vision", fake_resize)
    monkeypatch.setattr("tools.vision_tools._build_native_vision_tool_result",
                        lambda **kwargs: {"meta": {}, "content": kwargs["image_data_url"]})

    look_result({"acted": "look", "image": data_url(media_type="image/jpeg")})

    assert seen["mime_type"] == "image/jpeg"
