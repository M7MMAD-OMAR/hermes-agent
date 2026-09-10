"""The parts of the renderer that do not need a browser."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import diagram_render as dr


def test_rtl_detection_drives_the_font_choice(monkeypatch):
    monkeypatch.setattr(dr, "installed_font", lambda *_a, **_k: "Cairo")

    arabic, arabic_warning = dr.mermaid_config("flowchart TD\n  A[استلام الطلب] --> B[جدولة]")
    latin, latin_warning = dr.mermaid_config("flowchart TD\n  A[Receive] --> B[Schedule]")

    assert arabic["fontFamily"] == "Cairo"
    assert arabic["themeVariables"]["fontFamily"] == "Cairo"
    assert not arabic_warning
    # A Latin diagram keeps the default stack rather than an Arabic face.
    assert "Cairo" not in latin["fontFamily"]
    assert not latin_warning


def test_an_explicit_font_wins_over_detection(monkeypatch):
    monkeypatch.setattr(dr, "installed_font", lambda *_a, **_k: "Cairo")

    assert dr.mermaid_config("A[نص]", font="Amiri")[0]["fontFamily"] == "Amiri"


def test_a_machine_with_no_arabic_font_says_so(monkeypatch):
    monkeypatch.setattr(dr, "installed_font", lambda *_a, **_k: None)

    config, warning = dr.mermaid_config("A[نص عربي]")

    # The diagram still renders; what changes is that the caller is told the
    # labels may come out as empty boxes rather than being left to discover it.
    assert config["fontFamily"]
    assert "empty boxes" in warning


def test_installed_font_picks_the_first_family_present(monkeypatch):
    class Result:
        stdout = "Amiri,Amiri Quran\nCairo\n"

    monkeypatch.setattr(dr.subprocess, "run", lambda *_a, **_k: Result())

    assert dr.installed_font(("Noto Naskh Arabic", "Cairo", "Amiri")) == "Cairo"


def test_installed_font_reads_the_font_directories_without_fontconfig(monkeypatch, tmp_path):
    def explode(*_args, **_kwargs):
        raise OSError("no fc-list")

    (tmp_path / "Cairo-Regular.ttf").write_bytes(b"")
    monkeypatch.setattr(dr.subprocess, "run", explode)
    monkeypatch.setattr(dr, "FONT_DIRS", {sys.platform: (str(tmp_path),)})

    assert dr.installed_font(("Cairo", "Amiri")) == "Cairo"


def test_installed_font_reports_nothing_when_the_machine_has_none(monkeypatch):
    def explode(*_args, **_kwargs):
        raise OSError("no fc-list")

    monkeypatch.setattr(dr.subprocess, "run", explode)
    monkeypatch.setattr(dr, "FONT_DIRS", {})

    assert dr.installed_font(("Cairo", "Amiri")) is None


def test_chromium_lookup_prefers_a_binary_on_path(monkeypatch):
    monkeypatch.setattr(dr.shutil, "which", lambda name: "/usr/bin/chromium" if name == "chromium" else None)

    assert dr.find_chromium() == "/usr/bin/chromium"


def test_chromium_lookup_finds_an_app_bundle_off_path(monkeypatch):
    monkeypatch.setattr(dr.shutil, "which", lambda _name: None)
    monkeypatch.setattr(dr, "CHROMIUM_PATHS", {sys.platform: ("/Applications/Chromium.app/x",)})
    monkeypatch.setattr(dr.os, "access", lambda path, _mode: path == "/Applications/Chromium.app/x")

    assert dr.find_chromium() == "/Applications/Chromium.app/x"


def test_rendering_without_node_says_which_tool_is_missing(monkeypatch):
    monkeypatch.setattr(dr.shutil, "which", lambda _name: None)

    with pytest.raises(RuntimeError, match="Node.js"):
        dr.render("flowchart TD; A-->B", [Path("out.png")], "default", "white", 2, 0, "")


def test_the_cli_refuses_both_a_file_and_inline_code(capsys):
    with pytest.raises(SystemExit):
        dr.main(["flow.mmd", "out.png", "--code", "flowchart TD; A-->B"])


def test_a_failed_render_reports_instead_of_tracing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(dr, "render", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("Mermaid failed: boom")))
    source = tmp_path / "d.mmd"
    source.write_text("flowchart TD\n A-->B", encoding="utf-8")

    with pytest.raises(RuntimeError):
        dr.main([str(source), str(tmp_path / "out.png")])
