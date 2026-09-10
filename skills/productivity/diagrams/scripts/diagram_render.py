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
    "msedge",
)

# Installed browsers that put nothing on PATH. Bundles on macOS, the standard
# install locations on Windows.
CHROMIUM_PATHS = {
    "darwin": (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ),
    "win32": (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ),
}

# Where a Playwright install parks its own Chromium, per platform.
PLAYWRIGHT_GLOBS = (
    "chromium-*/chrome-linux/chrome",
    "chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chromium-*/chrome-win/chrome.exe",
)

# Pinned so a machine that renders a diagram today renders the same diagram
# the same way next year, and so npm can answer from its cache instead of
# resolving "latest" over the network on every run.
MERMAID_CLI = "@mermaid-js/mermaid-cli@11.17.0"

RENDER_TIMEOUT_S = 300

# Directories a font file can be installed into, per platform, for the machines
# that have no fontconfig to ask.
FONT_DIRS = {
    "darwin": ("/System/Library/Fonts", "/Library/Fonts", "~/Library/Fonts"),
    "win32": (r"C:\Windows\Fonts", "~/AppData/Local/Microsoft/Windows/Fonts"),
}


def find_chromium():
    """A Chromium the CLI can drive, or None to let Puppeteer find its own."""
    for name in CHROMIUM_CANDIDATES:
        found = shutil.which(name)
        if found:
            return found
    for candidate in CHROMIUM_PATHS.get(sys.platform, ()):
        if os.access(candidate, os.X_OK):
            return candidate
    cache = Path.home() / ".cache" / "ms-playwright"
    if cache.is_dir():
        for pattern in PLAYWRIGHT_GLOBS:
            for entry in sorted(cache.glob(pattern), reverse=True):
                if os.access(entry, os.X_OK):
                    return str(entry)
    return None


def _font_families():
    """Every font family name this machine can name, as best it can be asked."""
    try:
        listed = subprocess.run(["fc-list", ":lang=ar", "family"], capture_output=True, text=True,
                                timeout=20).stdout
        return {name.strip() for line in listed.splitlines() for name in line.split(",")}
    except (OSError, subprocess.SubprocessError):
        pass

    # No fontconfig: macOS and Windows. Match on the file name instead, which
    # is coarser but catches a font installed under its own family name.
    families = set()
    for directory in FONT_DIRS.get(sys.platform, ()):
        path = Path(directory).expanduser()
        if not path.is_dir():
            continue
        for entry in path.glob("*"):
            if entry.suffix.lower() in (".ttf", ".otf", ".ttc"):
                families.add(entry.stem.split("-")[0])
    return families


def installed_font(candidates=RTL_FONTS):
    """The first candidate this machine has, or None when it has none of them.

    None is the honest answer and the caller reports it: falling back to a name
    the machine does not have renders the diagram as empty boxes while the
    script still says it succeeded.
    """
    families = _font_families()
    for candidate in candidates:
        if candidate in families:
            return candidate
    return None


def mermaid_config(source: str, font: str = "") -> tuple:
    """Theme config for one diagram, and a warning when the font is missing.

    The font is the only thing decided here.
    """
    if font:
        return {"fontFamily": font, "themeVariables": {"fontFamily": font}}, ""

    if not RTL_RE.search(source):
        return {"fontFamily": LTR_FONT, "themeVariables": {"fontFamily": LTR_FONT}}, ""

    family = installed_font()
    if family:
        return {"fontFamily": family, "themeVariables": {"fontFamily": family}}, ""

    warning = ("No Arabic-capable font found, so the labels may render as empty boxes. "
               "Install one of: " + ", ".join(RTL_FONTS[:-1]) + ".")
    return {"fontFamily": RTL_FONTS[-1], "themeVariables": {"fontFamily": RTL_FONTS[-1]}}, warning


def render(source: str, outputs, theme: str, background: str, scale: int, width: int,
           font: str):
    """Run the Mermaid CLI once per requested format, in one browser session.

    Both formats come out of one CLI invocation: the tool takes repeated
    ``-o`` targets, and a second invocation would mean a second npx bootstrap
    and a second headless Chromium cold start for the same diagram.
    """
    if not shutil.which("npx"):
        raise RuntimeError(
            "npx was not found on PATH. Mermaid renders through its official CLI, "
            "so this needs Node.js installed (https://nodejs.org)."
        )

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

        config, warning = mermaid_config(source, font)
        config_path = work_dir / "config.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")

        for output in outputs:
            output.parent.mkdir(parents=True, exist_ok=True)
            args = [
                "npx", "--yes", "--prefer-offline", f"--package={MERMAID_CLI}", "mmdc",
                "-i", str(input_path), "-o", str(output),
                "-p", str(puppeteer_path), "-c", str(config_path),
                "-t", theme, "-b", background,
            ]
            if output.suffix.lower() == ".png":
                args += ["-s", str(scale)]
            if width:
                args += ["-w", str(width)]

            try:
                result = subprocess.run(args, capture_output=True, text=True,
                                        timeout=RENDER_TIMEOUT_S)
            except subprocess.TimeoutExpired as expired:
                raise RuntimeError(
                    f"Mermaid did not finish within {RENDER_TIMEOUT_S} seconds. The first run "
                    "downloads the CLI and a headless browser, which needs a network connection."
                ) from expired

            if result.returncode != 0 or not output.exists():
                detail = (result.stderr or result.stdout or "").strip()[-600:]
                hint = "" if binary else (
                    " No Chromium was found on this machine, so the CLI had to fetch its own; "
                    "installing Chromium or Google Chrome makes this step local and much faster."
                )
                raise RuntimeError(f"Mermaid failed to render: {detail}{hint}")

    return list(outputs), warning


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

    written, warning = render(source, wanted, args.theme, args.background, args.scale,
                              args.width, args.font)

    answer = {"ok": True, "outputs": [str(path) for path in written],
              "rtl": bool(RTL_RE.search(source))}
    if warning:
        answer["warning"] = warning
    print(json.dumps(answer, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - the CLI reports, it does not trace
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
