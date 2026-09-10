"""The parts of the renderer that do not need a browser."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import diagram_render as dr


def test_rtl_detection_drives_the_font_choice(monkeypatch):
    monkeypatch.setattr(dr, "installed_font", lambda *_a, **_k: "Cairo")

    arabic = dr.mermaid_config("flowchart TD\n  A[استلام الطلب] --> B[جدولة]")
    latin = dr.mermaid_config("flowchart TD\n  A[Receive] --> B[Schedule]")

    assert arabic["fontFamily"] == "Cairo"
    assert arabic["themeVariables"]["fontFamily"] == "Cairo"
    # A Latin diagram keeps the default stack rather than an Arabic face.
    assert "Cairo" not in latin["fontFamily"]


def test_an_explicit_font_wins_over_detection(monkeypatch):
    monkeypatch.setattr(dr, "installed_font", lambda *_a, **_k: "Cairo")

    assert dr.mermaid_config("A[نص]", font="Amiri")["fontFamily"] == "Amiri"


def test_installed_font_picks_the_first_family_present(monkeypatch):
    class Result:
        stdout = "Amiri,Amiri Quran\nCairo\n"

    monkeypatch.setattr(dr.subprocess, "run", lambda *_a, **_k: Result())

    assert dr.installed_font(("Noto Naskh Arabic", "Cairo", "Amiri")) == "Cairo"


def test_installed_font_falls_back_when_fontconfig_is_absent(monkeypatch):
    def explode(*_args, **_kwargs):
        raise OSError("no fc-list")

    monkeypatch.setattr(dr.subprocess, "run", explode)

    assert dr.installed_font(("Cairo", "Arial")) == "Arial"


def test_chromium_lookup_prefers_a_binary_on_path(monkeypatch):
    monkeypatch.setattr(dr.shutil, "which", lambda name: "/usr/bin/chromium" if name == "chromium" else None)

    assert dr.find_chromium() == "/usr/bin/chromium"


def test_the_cli_refuses_both_a_file_and_inline_code(capsys):
    with pytest.raises(SystemExit):
        dr.main(["flow.mmd", "out.png", "--code", "flowchart TD; A-->B"])


def test_a_failed_render_reports_instead_of_tracing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(dr, "render", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("Mermaid failed: boom")))
    source = tmp_path / "d.mmd"
    source.write_text("flowchart TD\n A-->B", encoding="utf-8")

    with pytest.raises(RuntimeError):
        dr.main([str(source), str(tmp_path / "out.png")])
