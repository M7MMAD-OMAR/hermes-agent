#!/usr/bin/env python3
"""Render a Mermaid diagram to SVG and PNG.

Mermaid needs a real browser to lay text out, so this drives the official CLI
through the Chromium already on the machine, headless, with a throwaway
profile. It exists because a diagram belongs in the deliverable: a rendered
PNG drops straight into a Word document or a slide, and the SVG stays sharp at
any size for anything that can take it.

    diagram_render.py flow.mmd out/flow.png --also-svg
    diagram_render.py --code "flowchart TD; A-->B" out/flow.svg

Right-to-left text is the reason for the font handling: Mermaid's default font
stack has no Arabic face, so an Arabic diagram renders as boxes unless one is
named. When the source contains RTL letters an installed Arabic face is
selected automatically.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Arabic, Persian, Urdu and Hebrew letters.
RTL_RE = re.compile("[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]")

# In preference order; the first one fontconfig knows about wins.
RTL_FONTS = ("Cairo", "IBM Plex Sans Arabic", "Noto Naskh Arabic", "Amiri", "Almarai", "Arial")
LTR_FONT = "Inter, Helvetica, Arial, sans-serif"

CHROMIUM_CANDIDATES = (
    "chromium-browser", "chromium", "google-chrome", "google-chrome-stable", "chrome",
)

RENDER_TIMEOUT_S = 300


def find_chromium():
    """A Chromium the CLI can drive, or None to let Puppeteer find its own."""
    for name in CHROMIUM_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    cache = Path.home() / ".cache" / "ms-playwright"
    if cache.is_dir():
        for entry in sorted(cache.glob("chromium-*/chrome-linux/chrome"), reverse=True):
            if os.access(entry, os.X_OK):
                return str(entry)
    return None


def installed_font(candidates=RTL_FONTS):
    """The first candidate fontconfig reports, or the last one as a fallback."""
    try:
        listed = subprocess.run(["fc-list", ":lang=ar", "family"], capture_output=True, text=True,
                                timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return candidates[-1]
    families = {name.strip() for line in listed.splitlines() for name in line.split(",")}
    for candidate in candidates:
        if candidate in families:
            return candidate
    return candidates[-1]


def mermaid_config(source: str, font: str = "") -> dict:
    """Theme config for one diagram. The font is the only thing decided here."""
    family = font or (installed_font() if RTL_RE.search(source) else LTR_FONT)

    return {"fontFamily": family, "themeVariables": {"fontFamily": family}}


def render(source: str, outputs, theme: str, background: str, scale: int, width: int,
           font: str):
    """Run the Mermaid CLI once per requested format, in one browser session.

    Both formats come out of one CLI invocation: the tool takes repeated
    ``-o`` targets, and a second invocation would mean a second npx bootstrap
    and a second headless Chromium cold start for the same diagram.
    """
    binary = find_chromium()
    with tempfile.TemporaryDirectory(prefix="mermaid-") as work:
        work_dir = Path(work)
        input_path = work_dir / "diagram.mmd"
        input_path.write_text(source, encoding="utf-8")

        puppeteer = {"args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if binary:
            puppeteer["executablePath"] = binary
        puppeteer_path = work_dir / "puppeteer.json"
        puppeteer_path.write_text(json.dumps(puppeteer), encoding="utf-8")

        config_path = work_dir / "config.json"
        config_path.write_text(json.dumps(mermaid_config(source, font)), encoding="utf-8")

        for output in outputs:
            output.parent.mkdir(parents=True, exist_ok=True)
            args = [
                "npx", "--yes", "--package=@mermaid-js/mermaid-cli", "mmdc",
                "-i", str(input_path), "-o", str(output),
                "-p", str(puppeteer_path), "-c", str(config_path),
                "-t", theme, "-b", background,
            ]
            if output.suffix.lower() == ".png":
                args += ["-s", str(scale)]
            if width:
                args += ["-w", str(width)]

            result = subprocess.run(args, capture_output=True, text=True, timeout=RENDER_TIMEOUT_S)
            if result.returncode != 0 or not output.exists():
                detail = (result.stderr or result.stdout or "").strip()[-600:]
                raise RuntimeError(f"Mermaid failed to render: {detail}")

    return list(outputs)


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Render a Mermaid diagram to SVG or PNG.")
    parser.add_argument("source", nargs="?", help="path to a .mmd file (omit with --code)")
    parser.add_argument("output", help="output .svg or .png path")
    parser.add_argument("--code", help="diagram text, instead of a source file")
    parser.add_argument("--theme", default="default",
                        choices=("default", "neutral", "dark", "forest", "base"))
    parser.add_argument("--background", default="transparent",
                        help="'transparent', 'white', or a hex colour")
    parser.add_argument("--scale", type=int, default=2, help="PNG pixel density (default 2)")
    parser.add_argument("--width", type=int, default=0, help="render width in px (0 = natural)")
    parser.add_argument("--font", default="", help="font family; auto-selected for RTL text")
    parser.add_argument("--also-svg", action="store_true", help="write the SVG beside a PNG")
    parser.add_argument("--also-png", action="store_true", help="write the PNG beside an SVG")
    args = parser.parse_args(argv)

    if bool(args.source) == bool(args.code):
        parser.error("give either a source file or --code, not both")
    source = args.code if args.code else Path(args.source).read_text(encoding="utf-8")

    output = Path(args.output)
    wanted = [output]
    if args.also_svg and output.suffix.lower() != ".svg":
        wanted.append(output.with_suffix(".svg"))
    if args.also_png and output.suffix.lower() != ".png":
        wanted.append(output.with_suffix(".png"))

    written = render(source, wanted, args.theme, args.background, args.scale, args.width, args.font)

    print(json.dumps({"ok": True, "outputs": [str(path) for path in written],
                      "rtl": bool(RTL_RE.search(source))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the CLI reports, it does not trace
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
