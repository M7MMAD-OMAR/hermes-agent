"""On-demand source-folder health for project recovery surfaces."""
from __future__ import annotations

import os
import stat
from pathlib import Path


def folder_health(path: str) -> str:
    try:
        mode = os.stat(path).st_mode
    except FileNotFoundError:
        return "missing"
    except OSError:
        return "unavailable"
    return "available" if stat.S_ISDIR(mode) else "not_directory"


def replacement_candidates(path: str) -> list[str]:
    """Probe nearby parent renames, never guess from a whole-disk search."""
    source = Path(path)
    parent = source.parent.parent
    if parent == parent.parent or not source.name:
        return []
    candidates = []
    try:
        with os.scandir(parent) as entries:
            for index, entry in enumerate(entries):
                if index >= 64:
                    break
                candidate = os.path.join(entry.path, source.name)
                if candidate != path and folder_health(candidate) == "available":
                    candidates.append(candidate)
    except OSError:
        return []
    return sorted(candidates)


def project_with_health(project) -> dict:
    payload = project.to_dict()
    for folder in payload["folders"]:
        folder["health"] = folder_health(folder["path"])
        folder["suggested_paths"] = (
            replacement_candidates(folder["path"]) if folder["health"] == "missing" else [])
    return payload
