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

import sys
from pathlib import Path


def house_style_paths() -> list[Path]:
    here = Path(__file__).resolve().parent
    return [
        here,                                          # inside house-style
        here.parents[1] / "house-style" / "scripts",   # sibling skill
        Path.home() / ".hermes" / "skills" / "productivity" / "house-style"
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
