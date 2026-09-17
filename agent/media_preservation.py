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

The rewrite used to have a second-order effect the delivery seam had to absorb:
the rewritten assistant message was what the model read back on the next turn, so
the store path became the shape a delivery had in its own context, and it named
the NEXT result by the path it expected to be preserved to rather than the path
it actually wrote. Nothing existed there, nothing was copied, and the reply
shipped a card for a file that never existed. Measured in one real conversation:
three of five delivered results, a Word document among them, reached the user as
dead cards for exactly this reason.

That is now prevented at the source: the rewrite is persist-and-display only, and
the row keeps the bytes the model wrote in an `api_content` sidecar for replay
(`agent/turn_finalizer.py::_stamp_media_replay_sidecar`). `_recover_source` stays
as the heal for the sessions that already carry store paths in their history, and
for a reply that names a nonexistent path for any other reason: a delivered path
that does not exist is not given up on, it is looked for by name in the
directories the conversation's own history says it has delivered from.

Those directories are read off the history rather than accumulated in memory,
because the population this heal exists for reaches it only through a RESUMED
conversation, which is a fresh gateway process. Anything remembered in process
memory is empty exactly when it is needed.

Not unconditional: compaction rewrites the rows the paths were read from, so a
compacted conversation can reach the seam with its older deliveries summarised
away and no candidate directories left. That is the same rewrite that drops the
replay sidecar, so the heal is thinnest exactly where it is most wanted. It is
still strictly more than the nothing a fresh process used to have.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from glob import escape as glob_escape
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
    same path twice a repoint to the existing copy rather than a second numbered
    copy."""
    try:
        sa, sb = a.stat(), b.stat()
    except OSError:
        return False
    return sa.st_size == sb.st_size and int(sa.st_mtime) == int(sb.st_mtime)


def _numbered_name(stem: str, suffix: str, index: object) -> str:
    """The name `_destination` gives a file whose name is already taken.

    The one encoding of that rule: `_has_numbered_siblings` recognises these
    names by passing a glob wildcard as the index, so changing the shape here
    cannot leave the recogniser quietly matching nothing.
    """
    return f"{stem}_{index}{suffix}"


def _destination(source: Path, session_dir: Path) -> Path:
    """Where `source` should land, or the copy that already holds its bytes.

    A name collision between two different files is resolved with a numeric
    suffix rather than an overwrite: two turns can each deliver `chart.png`, and
    the older one is still a result the user may scroll back to.

    Returning the existing copy rather than nothing is what makes a RE-delivery
    durable. A file delivered twice while its original is still live used to be
    answered with "already preserved, leave the reply alone", so the second card
    kept pointing into `/tmp` and died at the next reboot even though a durable
    copy of it was sitting in the store the whole time.
    """
    candidate = session_dir / source.name
    index = 0
    while candidate.exists():
        if _same_file(source, candidate):
            return candidate
        index += 1
        candidate = session_dir / _numbered_name(source.stem, source.suffix, index)
    return candidate


def _history_source_dirs(agent_history, store: Path, key: str) -> list[str]:
    """The directories this conversation has delivered files from, read off its history.

    `gateway.run._collect_history_media_paths` is the one extractor for "every
    path this conversation has already delivered", assistant `MEDIA:` rows and
    tool rows alike, through the same `extract_media` used here. The parent of
    each entry is the directory that delivery came from, which is exactly the
    set `_recover_source` searches.

    Reading it beats remembering it: a history carrying store paths comes back
    only through a resumed conversation, and a dict filled in as files are
    preserved is empty in that fresh process.

    Filtered, because a history path is a wider thing than a preserved source
    was. A URL's parent is a plausible-looking relative path, a bare filename's
    parent is the cwd, and neither is a place this conversation wrote anything.
    Fails open to no candidates: losing the heal costs one dead card, losing the
    turn costs the reply.
    """
    if not agent_history:
        return []
    try:
        from gateway.run import _collect_history_media_paths  # lazy: gateway.run imports us

        delivered = _collect_history_media_paths(agent_history)
    except Exception:
        logger.debug("Could not read delivered media paths from history", exc_info=True)
        return []

    session_dir = store / key
    dirs: list[str] = []
    for entry in delivered:
        if not entry or "://" in entry:
            continue
        expanded = os.path.expanduser(entry)
        if not os.path.isabs(expanded):
            continue
        try:
            parent = Path(expanded).resolve().parent
            if parent == session_dir or not parent.is_dir():
                continue
        except (OSError, RuntimeError, ValueError):
            continue
        candidate = str(parent)
        if candidate not in dirs:
            dirs.append(candidate)
    return dirs


def _recover_source(
    delivered: str, requested: Path, key: str, store: Path, source_dirs: Iterable[str]
) -> Optional[Path]:
    """The real file behind a delivered path that does not exist, or None.

    A reply can name a file by the path it *would* be preserved to rather than
    the path it was written to. Preservation used to cause that itself, by
    rewriting the assistant message the model then read back, so after the first
    preserved delivery the store path was the shape of a delivery in its own
    context and it wrote the next one that way for a file that was never copied
    anywhere. The rewrite no longer reaches the model (see the module docstring),
    but a history written before that fix still carries store paths, and a reply
    can name a path that does not exist for other reasons too.

    So a missing path is searched for by name: first in the session's own store
    directory (an earlier turn may have preserved it already), then in
    `source_dirs`, the directories this conversation's history says it delivered
    from, which is where a reply that invented a store path was really writing.
    Among those, the most recently written file of that name wins: when two of
    them hold the name, the most recent delivery is the one the reply is talking
    about. The store copy is still tried first regardless of mtime, since a
    newer file outside the store is the non-durable one of the two.
    """
    name = requested.name

    # A URL's last segment is a name like any other, and matching it against a
    # real file of that name would deliver something nobody produced. Read off
    # the delivered string: `requested` has been through `resolve()`, which
    # collapses `https://host/x` into a plausible-looking relative path.
    if not name or "://" in delivered:
        return None

    preserved = store / key / name
    try:
        # Two different files of this name were preserved for this session, so
        # the name alone no longer identifies one of them. Handing back a guess
        # would put somebody else's result on the card, which is worse than the
        # dead card this is trying to avoid, so fall through to the sources.
        if preserved.is_file() and not _has_numbered_siblings(preserved):
            return preserved.resolve()
    except OSError:
        pass

    newest: Optional[tuple[float, Path]] = None
    for root in source_dirs:
        candidate = Path(root) / name
        try:
            if not candidate.is_file():
                continue
            mtime = candidate.stat().st_mtime
        except OSError:
            continue
        if newest is None or mtime > newest[0]:
            newest = (mtime, candidate)
    return newest[1].resolve() if newest else None


def _has_numbered_siblings(candidate: Path) -> bool:
    """True when `_destination` had to number a second file of this name."""
    try:
        return any(candidate.parent.glob(_numbered_name(glob_escape(candidate.stem), candidate.suffix, "[0-9]*")))
    except OSError:
        return False


def _is_in_store(candidate: Path, store: Path) -> bool:
    """True when `candidate` already lives under the artifact store."""
    try:
        return candidate.is_relative_to(store)
    except (AttributeError, ValueError):
        return False


def preserve_media_file(
    path: str, *, session_key: str = "", source_dirs: Iterable[str] = ()
) -> Optional[str]:
    """Preserve one delivered file; return the durable path, or None to leave it alone.

    None means "nothing to do": the path is not a local file and could not be
    recovered, or it is already the durable copy. Callers keep the original path
    in that case, because a reply that still points at a live file is better than
    one pointing at a copy that was never made.

    `source_dirs` is where a path that does not exist is looked for; see
    `_history_source_dirs`. Empty is a valid answer, and means a missing path is
    only ever recovered from the session's own store directory.
    """
    try:
        requested = Path(os.path.expanduser(path)).resolve()
    except (OSError, RuntimeError, ValueError):
        return None

    # Resolved once and threaded through: every helper below needs it, and each
    # call re-runs a legacy-layout scan and an mkdir.
    store = artifacts_dir()
    key = _safe_segment(session_key)
    source = requested

    if not source.is_file():
        recovered = _recover_source(path, requested, key, store, source_dirs)
        if recovered is None:
            return None
        logger.info("Delivered media %s does not exist; using %s", path, recovered)
        source = recovered

    # A file that is already in the store is durable as it stands. Say so only
    # when the reply named some other path, so that a delivery pointing at a
    # copy that was never made is repointed at the one that exists.
    if _is_in_store(source, store):
        return str(source) if source != requested else None

    session_dir = store / key

    try:
        session_dir.mkdir(parents=True, exist_ok=True)
        destination = _destination(source, session_dir)
        if not destination.exists():
            try:
                os.link(source, destination)
            except OSError:
                # Different filesystem (the /tmp case) or a filesystem without
                # hard links: a real copy is the point of this function, not a
                # failure.
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


def preserve_response_media(
    response: str, *, session_key: str = "", agent_history=None
) -> str:
    """Preserve every file a reply delivers and repoint the reply at the copies.

    Runs before the transcript row is persisted, so the stored row carries paths
    that still resolve months later. A reply that delivers nothing is returned
    unchanged without touching the disk.

    `agent_history` is the conversation this reply ends, and is what a delivered
    path that does not exist is recovered through (`_history_source_dirs`).
    Scanned once here rather than per path, and only for a reply that delivers
    something.

    The reply itself is scanned alongside it, because one reply can deliver both
    a real path and an invented one, and the streaming loop has not always
    appended the assistant row to the history yet. The invented path's parent is
    the store's own session directory, which `_history_source_dirs` drops, so
    this adds only the directories this reply really wrote to.
    """
    if not response or "MEDIA:" not in response:
        return response

    store = artifacts_dir()
    source_dirs = _history_source_dirs(
        [*(agent_history or []), {"role": "assistant", "content": response}],
        store,
        _safe_segment(session_key),
    )

    rewritten = response
    # Longest first: one delivered path can be a prefix of another (`clip.mp4`
    # and `clip.mp4.bak`), and replacing the shorter one first would corrupt the
    # longer one into a path that never existed.
    for original in sorted(_media_paths(response), key=len, reverse=True):
        preserved = preserve_media_file(original, session_key=session_key, source_dirs=source_dirs)
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
