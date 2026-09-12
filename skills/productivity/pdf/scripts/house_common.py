#!/usr/bin/env python3
"""Find the house-style module from a sibling office skill.

A copy of this file lives in each office skill's ``scripts/`` directory.
The skills are installed independently, so a shared import would break
whichever one was installed alone; a twenty line locator that degrades to
``None`` does not. When it returns ``None`` the create scripts build
exactly what they built before the design system existed.

    house = load_house_style()
    theme = house.theme_from_spec(spec) if house else None
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def hermes_home() -> Path:
    """Hermes home, honouring ``HERMES_HOME``.

    Mirrors ``hermes_constants.get_hermes_home()`` without importing it,
    the same way ``google-workspace/scripts/_hermes_home.py`` does. A skill
    is installed on its own, so it cannot import from the agent tree. It can
    still read the variable the agent sets, and it must: hardcoding
    ``~/.hermes`` means a Hermes installed anywhere else silently finds no
    design system and quietly produces unthemed documents.
    """
    val = os.environ.get("HERMES_HOME", "").strip()
    return Path(val) if val else Path.home() / ".hermes"


def house_style_paths() -> list[Path]:
    here = Path(__file__).resolve().parent
    return [
        here,                                          # inside house-style
        here.parents[1] / "house-style" / "scripts",   # sibling skill
        hermes_home() / "skills" / "productivity" / "house-style"
        / "scripts",                                   # installed bundle
    ]


def load_house_style():
    """Import house_style if it is reachable, else return None."""
    for candidate in house_style_paths():
        if (candidate / "house_style.py").exists():
            if str(candidate) not in sys.path:
                sys.path.insert(0, str(candidate))
            try:
                import house_style  # noqa: PLC0415
            except ImportError:
                return None
            return house_style
    return None
