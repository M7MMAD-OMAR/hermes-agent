"""Keep delivered media alive after the directory it was written to is cleaned.

A `MEDIA:` path in a reply is the moment the system says "this is a result for
the user". Nothing used to happen at that moment, so the file's survival was
whatever its birthplace happened to guarantee, and two common birthplaces
guarantee the opposite:

* `$HERMES_HOME/cache/images/`, where `agent/image_gen_provider.py` writes every
  generated image. That directory exists to cache INBOUND platform images whose
  source URLs expire, and `gateway/run.py::_housekeeping_media_caches` prunes it
  hourly at `max_age_hours=24`. A generated result was therefore deleted about a
  day after it was produced.
* `/tmp`, which is tmpfs on many Linux installs, so anything a shell tool writes
  there is destroyed at the next reboot.

Measured on one real install before this existed: of 687 delivered media paths,
655 were already gone, 584 of them from `cache/images`.

So the file is preserved here, into `$HERMES_HOME/artifacts/<session>/`, and the
reply is rewritten to point at the preserved copy before the transcript row is
written. Preserving at the DELIVERY seam rather than at each generator is what
makes it source-agnostic: the audio a shell `ffmpeg` call produced in `/tmp` is
kept by the same code that keeps a generated image.

A hard link is tried first, so preserving a file on the same filesystem costs no
bytes and no time while still surviving the original's deletion. `/tmp` is a
different filesystem, so those fall back to a real copy.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# Total size the store is allowed to reach before the oldest artifacts are
# dropped. Capped rather than unbounded on purpose: this lives under the user's
# home on whatever filesystem that is, and an unbounded store would eventually
# be its own incident. Age is deliberately NOT a criterion, since "old" is
# exactly the property of the results this exists to protect.
DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024

_UNSORTED = "unsorted"
_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._-]+")


def artifacts_dir() -> Path:
    """`$HERMES_HOME/artifacts`, created on demand."""
    from hermes_constants import get_hermes_dir

    path = get_hermes_dir("artifacts", "artifacts")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_segment(value: str) -> str:
    """One path segment from an arbitrary session key: no separators, no dots-only."""
    cleaned = _SAFE_SEGMENT_RE.sub("_", (value or "").strip()).strip("._")
    return cleaned[:120] or _UNSORTED


def _same_file(a: Path, b: Path) -> bool:
    """Already the same bytes, by the cheap proxies. Used to make preserving the
    same path twice a no-op rather than a second numbered copy."""
    try:
        sa, sb = a.stat(), b.stat()
    except OSError:
        return False
    return sa.st_size == sb.st_size and int(sa.st_mtime) == int(sb.st_mtime)


def _destination(source: Path, session_dir: Path) -> Optional[Path]:
    """Where `source` should land, or None when it is already preserved there.

    A name collision between two different files is resolved with a numeric
    suffix rather than an overwrite: two turns can each deliver `chart.png`, and
    the older one is still a result the user may scroll back to.
    """
    candidate = session_dir / source.name
    index = 0
    while candidate.exists():
        if _same_file(source, candidate):
            return None
        index += 1
        candidate = session_dir / f"{source.stem}_{index}{source.suffix}"
    return candidate


def preserve_media_file(path: str, *, session_key: str = "") -> Optional[str]:
    """Preserve one delivered file; return the durable path, or None to leave it alone.

    None means "nothing to do": the path is not a local file, has already been
    preserved, or could not be read. Callers keep the original path in that case,
    because a reply that still points at a live file is better than one pointing
    at a copy that was never made.
    """
    try:
        source = Path(os.path.expanduser(path)).resolve()
    except (OSError, RuntimeError, ValueError):
        return None

    if not source.is_file():
        return None

    store = artifacts_dir()

    # Idempotent: a re-delivered artifact must not be copied into itself.
    try:
        if source.is_relative_to(store):
            return None
    except (AttributeError, ValueError):
        pass

    session_dir = store / _safe_segment(session_key)

    try:
        session_dir.mkdir(parents=True, exist_ok=True)
        destination = _destination(source, session_dir)
        if destination is None:
            return None
        try:
            os.link(source, destination)
        except OSError:
            # Different filesystem (the /tmp case) or a filesystem without hard
            # links: a real copy is the point of this function, not a failure.
            shutil.copy2(source, destination)
    except OSError as exc:
        logger.warning("Could not preserve delivered media %s: %s", path, exc)
        return None

    return str(destination)


def _media_paths(response: str) -> Iterable[str]:
    """Delivered paths in a reply, via the one canonical extractor.

    Lazy import: this module is reached on every finished turn, most of which
    deliver nothing, and the platform layer is expensive to import.
    """
    from gateway.platforms.base import BasePlatformAdapter

    seen: set[str] = set()
    for extracted, _is_voice in BasePlatformAdapter.extract_media(response)[0]:
        if extracted not in seen:
            seen.add(extracted)
            yield extracted


def preserve_response_media(response: str, *, session_key: str = "") -> str:
    """Preserve every file a reply delivers and repoint the reply at the copies.

    Runs before the transcript row is persisted, so the stored row carries paths
    that still resolve months later. A reply that delivers nothing is returned
    unchanged without touching the disk.
    """
    if not response or "MEDIA:" not in response:
        return response

    rewritten = response
    # Longest first: one delivered path can be a prefix of another (`clip.mp4`
    # and `clip.mp4.bak`), and replacing the shorter one first would corrupt the
    # longer one into a path that never existed.
    for original in sorted(_media_paths(response), key=len, reverse=True):
        preserved = preserve_media_file(original, session_key=session_key)
        if preserved and preserved != original:
            rewritten = rewritten.replace(original, preserved)
    return rewritten


def prune_artifacts(max_bytes: int = DEFAULT_MAX_BYTES) -> int:
    """Drop the oldest artifacts until the store fits in `max_bytes`; return the count.

    Oldest-first by mtime, and only ever when over the cap, so a quiet install
    never loses anything. Returns 0 when the store is absent or already fits.
    """
    store = artifacts_dir()
    files: list[tuple[float, int, Path]] = []
    for path in store.rglob("*"):
        try:
            if path.is_file():
                stat = path.stat()
                files.append((stat.st_mtime, stat.st_size, path))
        except OSError:
            continue

    total = sum(size for _, size, _ in files)
    if total <= max_bytes:
        return 0

    removed = 0
    for _, size, path in sorted(files):
        if total <= max_bytes:
            break
        try:
            path.unlink()
        except OSError:
            continue
        total -= size
        removed += 1
    return removed
