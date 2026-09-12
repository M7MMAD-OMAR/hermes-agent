"""`mobile_console`: what the app on the device said, and what it asked the network for.

Runs both channels and tells the caller which one is live, because which one works is
invisible in the target's metadata and depends on how the app was started. In a
development build `Runtime.consoleAPICalled` delivers every level with stack frames; in
Expo Go it never fires once and logcat is the only console there is. `Runtime.enable`
answering ok does not distinguish them: it means the inspector proxy accepted the
command, not that the engine implements the domain. Only whether anything arrived does.

The tool attaches once per Hermes session and keeps collecting in the background, so a
read after an action returns what that action caused rather than starting a fresh
listener that missed it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
from typing import Any, Dict, List, Optional, Sequence, Tuple

from tools.mobile_console_cdp import (
    DEFAULT_METRO_PORT, LEVEL_NAMES, ConsoleRecord, MetroUnavailable, discover_target,
    stream, supports_multiple_debuggers)
from tools.mobile_console_crash import (
    CRASH_PATTERNS, EXPO_GO_PACKAGE, exit_info, resolve_package, watch_command)
from tools.mobile_console_logcat import DEFAULT_TAG, clear_buffer, poll_forever
from tools.registry import registry

logger = logging.getLogger("tools.mobile_console")

#: Bounded so a session left attached for hours cannot grow without limit. Old records
#: are dropped rather than new ones refused: the recent past is what anyone reads.
_BUFFER_LIMIT = 5000
_DEFAULT_WAIT = 3.0
#: Gap between re-attach attempts. An app reload replaces the target within a second or
#: two, so this is short enough to catch one without polling Metro hard.
_RECONNECT_SECONDS = 2.0
_MAX_WAIT = 60.0
_DEFAULT_LIMIT = 100
_LEVEL_ORDER = {name: value for value, name in LEVEL_NAMES.items()}
#: Tags worth carrying beyond the JS one: these are where a native-side failure lands.
_DEFAULT_TAGS = (DEFAULT_TAG, "ReactNative", "AndroidRuntime")


class _Attachment:
    """One session's live view of one app: both channels, one buffer."""

    def __init__(self, *, host: str, port: int, adb: Sequence[str], tags: Sequence[str],
                 device_note: str = "") -> None:
        self.host, self.port, self.adb, self.tags = host, port, list(adb), list(tags)
        self.device_note = device_note
        self.records: deque = deque(maxlen=_BUFFER_LIMIT)
        self.domains: Dict[str, bool] = {}
        self.target: Dict[str, Any] = {}
        self.cdp_error = ""
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._cursor = 0          # records handed out already
        self._dropped = 0         # records the buffer evicted before anyone read them
        self._suppressed = 0      # logcat echoes of lines CDP already carried, better
        self._cdp_console_seen = False
        self._network_event_seen = False
        self._threads: List[threading.Thread] = []

    # --- lifecycle -------------------------------------------------------------------

    def start(self) -> None:
        """Attach both channels. Metro being absent is not fatal: logcat still works, and
        in Expo Go it is the only channel there was going to be."""
        self._spawn(self._run_cdp, "mobile-console-cdp")
        if self.adb:
            self._spawn(self._run_logcat, "mobile-console-logcat")

    def _spawn(self, target, name: str) -> None:
        thread = threading.Thread(target=target, name=name, daemon=True)
        thread.start()
        self._threads.append(thread)

    def stop(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=3.0)
        self._threads.clear()

    @property
    def live(self) -> bool:
        return any(thread.is_alive() for thread in self._threads)

    # --- channels --------------------------------------------------------------------

    def _run_cdp(self) -> None:
        """Attach, and re-attach when the target goes away.

        Reconnecting is not defensive padding here, it is the normal case: a React
        Native app reloads constantly during development, and every reload and every
        Metro restart replaces the target. A one-shot attach leaves the session silently
        on logcat for the rest of its life after the first reload, which reads as
        "CDP does not work on this app" and is not that.
        """
        while not self._stop.is_set():
            try:
                self.target = discover_target(self.port, self.host)
                self.cdp_error = ""
            except MetroUnavailable as e:
                self.target, self.cdp_error = {}, str(e)
                self._sleep(_RECONNECT_SECONDS)
                continue
            try:
                asyncio.run(stream(self.target, self.host, self.port, on_record=self._append,
                                   on_domains=self._set_domains, should_stop=self._stop.is_set))
            except Exception as e:  # the socket is remote; every failure here is the app's
                self.cdp_error = f"{type(e).__name__}: {e}"
                logger.debug("mobile console cdp channel ended: %s", e)
            self._sleep(_RECONNECT_SECONDS)

    def _sleep(self, seconds: float) -> None:
        """Wait, but notice a stop request while waiting."""
        self._stop.wait(seconds)

    def _run_logcat(self) -> None:
        try:
            poll_forever(self.adb, self.tags, on_record=self._append,
                         should_stop=self._stop.is_set)
        except Exception as e:
            logger.debug("mobile console logcat channel ended: %s", e)

    def _append(self, record: ConsoleRecord) -> None:
        with self._lock:
            if record.kind == "console":
                self._cdp_console_seen = True
            elif record.kind == "network":
                self._network_event_seen = True
            elif self._is_duplicate_of_cdp(record):
                # Both channels carry the same console call, so a plain merge reports
                # every line twice. CDP's copy is strictly better where it exists: real
                # arguments and real frames instead of one flattened string. The native
                # tags are never dropped, because CDP does not carry them at all.
                self._suppressed += 1
                return
            if len(self.records) == self.records.maxlen:
                # An eviction moves every index down by one, including the cursor's.
                self._cursor = max(0, self._cursor - 1)
                self._dropped += 1
            self.records.append(record)

    def _is_duplicate_of_cdp(self, record: ConsoleRecord) -> bool:
        return (self._cdp_console_seen and record.channel == "logcat"
                and record.extra.get("tag") == DEFAULT_TAG)

    def _set_domains(self, domains: Dict[str, bool]) -> None:
        self.domains = domains

    # --- reading ---------------------------------------------------------------------

    def drain(self, *, since_last_read: bool) -> List[ConsoleRecord]:
        with self._lock:
            records = list(self.records)[self._cursor:] if since_last_read else list(self.records)
            self._cursor = len(self.records)
            return records

    def clear(self) -> int:
        with self._lock:
            count = len(self.records)
            self.records.clear()
            self._cursor = self._dropped = self._suppressed = 0
        return count

    @property
    def dropped(self) -> int:
        return self._dropped

    @property
    def suppressed(self) -> int:
        return self._suppressed

    @property
    def network_live(self) -> bool:
        """Whether a request event has actually arrived, which is the only proof there is."""
        return self._network_event_seen

    @property
    def cdp_console_live(self) -> bool:
        """Whether the engine really delivers console over CDP.

        Only `Runtime.consoleAPICalled` counts. Metro's proxy injects its own notices on
        `Log.entryAdded` even when the engine delivers nothing, so counting that reports
        a live channel on a target where the channel is dead.
        """
        return self._cdp_console_seen


_attachments: Dict[str, _Attachment] = {}
_attachments_lock = threading.Lock()


def _device_adb(session_id: str) -> Tuple[List[str], str]:
    """The adb invocation for this session's device, and why that one."""
    try:
        from tools.computer_use.device_adb import session_adb
        return session_adb(session_id)
    except ImportError:
        return [], "device support is unavailable in this build"


def _attachment(session_id: str, *, host: str, port: int, tags: Sequence[str]) -> _Attachment:
    """This session's attachment, rebuilt when it is pointed at the wrong device.

    A session commonly reads the console before it leases a device, and the lease can
    land on a different phone than the one that was resolved first. With one device that
    is harmless; with two it is a session reading one phone's logs while driving another.
    """
    adb, device_note = _device_adb(session_id)
    with _attachments_lock:
        existing = _attachments.get(session_id)
        if existing is not None and existing.live and existing.adb == adb:
            # Same device, possibly for a new reason: a lease taken since the last call
            # routes to the same serial but is a better answer to "which device is this".
            existing.device_note = device_note
            return existing
        if existing is not None:
            existing.stop()
        attachment = _Attachment(host=host, port=port, adb=adb, tags=tags, device_note=device_note)
        _attachments[session_id] = attachment
    attachment.start()
    return attachment


def release_mobile_console_session(session_id: str) -> bool:
    """Detach one session's console. Idempotent; True iff something was attached."""
    with _attachments_lock:
        attachment = _attachments.pop(session_id, None)
    if attachment is None:
        return False
    attachment.stop()
    return True


def _matches(record: ConsoleRecord, min_level: int, kinds: Optional[set]) -> bool:
    return record.level >= min_level and (kinds is None or record.kind in kinds)


def _channel_note(attachment: _Attachment) -> str:
    """One line saying which channel these records came from, and why not the other one."""
    if attachment.cdp_console_live:
        return ("CDP console is live on this target, so arguments and stack frames are real. "
                "logcat's echo of the same JS console lines is dropped; its native tags are not.")
    if attachment.cdp_error:
        if not attachment.adb:
            return (f"No CDP channel ({attachment.cdp_error}) and no logcat either: "
                    f"{attachment.device_note}.")
        return (f"No CDP channel ({attachment.cdp_error}) Records are from logcat, which "
                "carries every level as flattened text.")
    if attachment.target:
        return ("Attached over CDP, but the engine has delivered no console event. This is "
                "what Expo Go looks like: its engine does not support debugging over CDP at "
                "all. Records are from logcat. A development build gets stack frames.")
    return "Records are from logcat."


def _start_crash_watch(attachment: "_Attachment", session_id: str) -> Dict[str, Any]:
    """Tail the crash and events buffers as a watched background process.

    Delivery rides the process registry's watch patterns rather than a channel of its
    own: that path already rate limits a chatty match, caps it over the session's life,
    and is what the CLI, the gateway and the TUI actually consume. A crash is exactly
    the "rare one-shot mid-process signal" those patterns are documented for.
    """
    if not attachment.adb:
        return {"error": f"nothing to watch: {attachment.device_note}"}
    from tools.terminal_tool_background import spawn_background_process
    from tools.environments.local import LocalEnvironment
    command = watch_command(attachment.adb)
    raw = spawn_background_process(
        command=command, env=LocalEnvironment(), env_type="local",
        effective_task_id=session_id or "device-crash-watch", task_id=session_id or None,
        session_key=session_id, workdir=None, cwd=os.getcwd(), effective_pty=False,
        notify_on_complete=False, watch_patterns=list(CRASH_PATTERNS),
        approval_note=None, pty_disabled_reason=None)
    result = json.loads(raw) if isinstance(raw, str) and raw.startswith("{") else {"raw": raw}
    result["watching"] = list(CRASH_PATTERNS)
    result["note"] = (
        "A native crash and an ANR now arrive as a notification. The ANR watcher will "
        "almost never fire for a React Native app: under Hermes the JS thread is not the "
        "Android UI thread, so the app can be frozen for the user while Android considers "
        "it healthy. This does not detect that.")
    return result


def mobile_console(action: str = "read", *, session_id: str = "", host: str = "127.0.0.1",
                   port: int = DEFAULT_METRO_PORT, level: str = "log", kind: str = "",
                   limit: int = _DEFAULT_LIMIT, wait: float = _DEFAULT_WAIT,
                   all_records: bool = False, tags: Optional[Sequence[str]] = None,
                   args_package: str = "") -> str:
    """Read, inspect or reset one session's view of the app's console."""
    tags = tuple(tags) if tags else _DEFAULT_TAGS
    if action == "stop":
        return json.dumps({"detached": release_mobile_console_session(session_id)})

    attachment = _attachment(session_id, host=host, port=port, tags=tags)

    if action == "status":
        # A status taken the instant after attaching reports no domains and no verdict,
        # because the enable round trips have not landed. Settle first.
        _wait_for_domains(attachment, min(wait, _MAX_WAIT))
        return json.dumps({
            "attached": attachment.live,
            "target": {key: attachment.target.get(key) for key in
                       ("title", "deviceName", "appId")} if attachment.target else None,
            "shares_with_other_debuggers": supports_multiple_debuggers(attachment.target)
            if attachment.target else None,
            "domains": attachment.domains,
            "cdp_console_live": attachment.cdp_console_live,
            "network_domain": _network_note(attachment),
            "buffered": len(attachment.records),
            "device": attachment.device_note,
            "note": _channel_note(attachment),
        }, indent=2)

    if action == "clear":
        # Both sides: our buffer, and what the device has kept, so the next read is new.
        return json.dumps({"cleared": attachment.clear(),
                           "device_buffer_cleared": clear_buffer(attachment.adb)
                           if attachment.adb else False})

    if action == "exits":
        package = resolve_package(attachment.adb, str(args_package or ""))
        if not package:
            return json.dumps({"error": f"no package to query ({attachment.device_note}): "
                                        "pass one, or open the app first"})
        return json.dumps(exit_info(attachment.adb, package), indent=2)

    if action == "watch":
        return json.dumps(_start_crash_watch(attachment, session_id), indent=2)

    if action != "read":
        return json.dumps({"error": f"unknown action {action!r}; use read, status, watch, "
                                    "exits, clear or stop"})

    # A first read has nothing yet because the attachment was created by this very call.
    if wait > 0:
        _wait_for_records(attachment, min(wait, _MAX_WAIT))
    min_level = _LEVEL_ORDER.get(level.lower(), 0)
    kinds = {k.strip() for k in kind.split(",") if k.strip()} or None
    records = [r for r in attachment.drain(since_last_read=not all_records)
               if _matches(r, min_level, kinds)]
    shown = records[-limit:] if limit > 0 else records
    return json.dumps({
        "records": [record.as_dict() for record in shown],
        "returned": len(shown),
        "omitted_by_limit": len(records) - len(shown),
        "dropped_before_read": attachment.dropped,
        "logcat_echoes_suppressed": attachment.suppressed,
        "note": _channel_note(attachment),
    }, indent=2)


def _network_note(attachment: _Attachment) -> str:
    """Why the network list is empty, when it is.

    `Network.enable` answering ok is not evidence, for the same reason `Runtime.enable`
    is not: it means the inspector proxy accepted the command, not that the app is
    instrumented. Measured on Expo SDK 57 / React Native 0.86 in a development build,
    an app that demonstrably completed nine requests produced no `Network.*` event at
    all while `Network.enable` reported success. So an empty network list means no data
    on this channel, and saying "enabled" would send someone to look for traffic that
    was never going to be reported.
    """
    if not attachment.target:
        return "unavailable without a CDP attachment"
    if attachment.domains.get("Network") is False:
        return "this target does not implement the Network domain; it needs React Native 0.83 or newer"
    if attachment.network_live:
        return "live"
    if attachment.domains.get("Network"):
        return ("accepted Network.enable but has delivered no request event. Requests the "
                "app makes may still not appear here; read the app's own logs instead of "
                "treating an empty list as no traffic")
    return "not yet negotiated"


def _wait_for_domains(attachment: _Attachment, seconds: float) -> None:
    """Give discovery and the enable round trips a moment to land.

    Waits for a verdict rather than for a target: a host with no Metro at all would
    otherwise sit out the whole window on every status call.
    """
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if attachment.domains or attachment.cdp_error:
            return
        time.sleep(0.1)


def _wait_for_records(attachment: _Attachment, seconds: float) -> None:
    """Give a freshly attached channel a moment to produce something.

    Returns as soon as anything arrives, so a busy app costs nothing and only a silent
    one pays the whole window.
    """
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if attachment.records:
            return
        time.sleep(0.1)


MOBILE_CONSOLE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["read", "status", "watch", "exits", "clear", "stop"],
            "description": (
                "`read` (default) returns what the app logged since your last read. "
                "`status` reports which channel is live and whether the Network domain "
                "exists. `watch` starts notifying you when the app dies natively or is "
                "declared not responding. `exits` reports Android's own record of why "
                "this app's processes ended. `clear` drops the buffer on both sides. "
                "`stop` detaches."
            ),
        },
        "level": {
            "type": "string",
            "enum": ["log", "info", "warn", "error"],
            "description": "Minimum level to return. Default `log` (everything).",
        },
        "kind": {
            "type": "string",
            "description": (
                "Comma-separated filter over console, exception, network, logcat, "
                "log-entry. Omitted returns all of them."
            ),
        },
        "limit": {"type": "integer", "description": "Most recent N records. Default 100."},
        "wait": {
            "type": "number",
            "description": (
                "Seconds to wait for something to arrive before returning, up to 60. "
                "Returns as soon as anything does. Default 3."
            ),
        },
        "all": {
            "type": "boolean",
            "description": "Return the whole buffer instead of only what is new since your last read.",
        },
        "port": {"type": "integer", "description": "Metro's port. Default 8081."},
        "package": {
            "type": "string",
            "description": (
                "For `exits`: the app's package. Defaults to whatever is in the "
                f"foreground. In Expo Go the bundle runs inside {EXPO_GO_PACKAGE}, not a "
                "package named after the app."
            ),
        },
    },
    "required": ["action"],
    "additionalProperties": False,
}


def _mobile_console_check() -> bool:
    """Available when a device backend could run at all. Reachability, not surface."""
    try:
        from hermes_cli.tools_config_android import android_tools_ready
        return android_tools_ready()
    except Exception:
        return False


registry.register(
    name="mobile_console",
    toolset="device",
    schema=MOBILE_CONSOLE_SCHEMA,
    handler=lambda args, **kw: mobile_console(
        action=str(args.get("action") or "read"),
        session_id=str(kw.get("session_id") or ""),
        host=str(args.get("host") or "127.0.0.1"),
        port=int(args.get("port") or DEFAULT_METRO_PORT),
        level=str(args.get("level") or "log"),
        kind=str(args.get("kind") or ""),
        limit=int(args.get("limit") if args.get("limit") is not None else _DEFAULT_LIMIT),
        wait=float(args.get("wait") if args.get("wait") is not None else _DEFAULT_WAIT),
        all_records=bool(args.get("all")),
        args_package=str(args.get("package") or ""),
    ),
    check_fn=_mobile_console_check,
    emoji="📱",
)
