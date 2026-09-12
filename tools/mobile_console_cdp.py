"""The CDP half of the device console: attach to a React Native target through Metro.

Two connection requirements, neither documented anywhere and both of which cost real
time to rediscover:

1. **The `Origin` header is mandatory.** Without it Metro's inspector proxy answers the
   websocket handshake with HTTP 401. The origin must be `http://127.0.0.1:<port>`, or
   its hostname must be one of localhost, 127.0.0.1, 0.0.0.0, [::].
2. **The websocket host must match that origin's host.** Using the
   `webSocketDebuggerUrl` from `/json/list` verbatim, which says `localhost`, while
   sending a `127.0.0.1` origin passes the origin check and then drops the socket with
   close code 1006 and no close frame, which reads exactly like a crash and is not one.

The browser-shaped domains do not exist here. `Page`, `DOM` and `Target` all answer
with an error, which is why this is a new client rather than a reuse of the browser
tooling: every path in this repo that hands out a CDP endpoint hands out a
browser-level one and discovers a page beneath it, and Metro publishes only page-level
sockets with no `Target` domain above them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("tools.mobile_console")

DEFAULT_METRO_PORT = 8081
#: One vocabulary for both channels, matching what the browser console drawer renders.
LEVEL_NAMES = {0: "log", 1: "info", 2: "warn", 3: "error"}
_LEVEL_BY_CDP_TYPE = {"log": 0, "debug": 0, "info": 1, "warning": 2, "warn": 2,
                      "error": 3, "assert": 3}
#: Domains worth enabling. `Network` is probed rather than assumed: it needs RN 0.83+.
_ENABLE_METHODS = ("Runtime.enable", "Log.enable", "Network.enable")


@dataclass
class ConsoleRecord:
    """One line from the app, whichever channel carried it."""
    ts: float
    level: int
    kind: str                       # console | log-entry | exception | network | logcat
    message: str
    channel: str = "cdp"            # cdp | logcat
    source: Optional[str] = None
    line: Optional[int] = None
    stack: List[str] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        payload = {"ts": round(self.ts, 3), "level": LEVEL_NAMES.get(self.level, "log"),
                   "kind": self.kind, "channel": self.channel, "message": self.message}
        if self.source:
            payload["source"] = f"{self.source}:{self.line}" if self.line else self.source
        if self.stack:
            payload["stack"] = self.stack[:8]
        if self.extra:
            payload.update(self.extra)
        return payload


class MetroUnavailable(RuntimeError):
    """Metro is not running, or has no attachable target."""


def discover_target(port: int = DEFAULT_METRO_PORT, host: str = "127.0.0.1") -> Dict[str, Any]:
    """The RN target to attach to, from Metro's own listing.

    A null `webSocketDebuggerUrl` is the listing's way of saying the target's single
    debugger slot is taken, so targets are filtered on it rather than taken in order.
    """
    url = f"http://{host}:{port}/json/list"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:  # noqa: S310 - fixed loopback URL
            targets = json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise MetroUnavailable(
            f"no Metro inspector on {host}:{port} ({e}). Start the dev server, open the "
            f"app on the device, and if the device is not the host run "
            f"`adb reverse tcp:{port} tcp:{port}`.") from e
    if not targets:
        raise MetroUnavailable(
            f"Metro is running on {host}:{port} but no app is connected to it. Open the "
            "app on the device.")
    attachable = [t for t in targets if t.get("webSocketDebuggerUrl")]
    if not attachable:
        raise MetroUnavailable(
            "every target reports a null webSocketDebuggerUrl, so their debugger slots "
            "are taken. Close React Native DevTools and try again.")
    return attachable[-1]


def supports_multiple_debuggers(target: Dict[str, Any]) -> bool:
    """Whether this target tolerates a second debugger alongside ours.

    Read rather than assumed. Older targets report false, and hardcoding exclusivity
    would lock a developer out of their own DevTools window on a stack that shares fine.
    """
    capabilities = (target.get("reactNative") or {}).get("capabilities") or {}
    return bool(capabilities.get("supportsMultipleDebuggers"))


def _render_remote_object(obj: Dict[str, Any]) -> str:
    """A CDP RemoteObject as text, without pulling in a JavaScript formatter."""
    if "value" in obj:
        value = obj["value"]
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if obj.get("unserializableValue") is not None:
        return str(obj["unserializableValue"])
    return obj.get("description") or obj.get("type", "?")


def tidy_url(url: str) -> str:
    """A Metro bundle URL, shortened to the part a reader can act on.

    Every frame in a React Native stack carries the whole bundle URL with its transform
    query attached, around 300 characters of it, identical on every line. Left whole it
    buries the function name and the line number, which are the only parts anyone reads.
    """
    if not url:
        return ""
    path = url.split("?", 1)[0].split("//&", 1)[0]
    segments = [segment for segment in path.split("/") if segment]
    return "/".join(segments[-2:]) if len(segments) > 2 else path


#: A bundle URL embedded in text, with its `:line:column` suffix kept out of the match.
_URL_IN_TEXT = re.compile(r"https?://[^\s)]+?(?=(?::\d+:\d+)?[\s)]|$)")


def tidy_text(text: str) -> str:
    """The same shortening, applied inside a message.

    React Native stringifies an Error with its whole stack into the `console.error`
    argument, so the frames arrive as message text rather than as a stack array. Left
    alone, one render error is several thousand characters of the same repeated bundle
    URL, and the line that says what broke is somewhere inside it.
    """
    return _URL_IN_TEXT.sub(lambda m: tidy_url(m.group(0)), text)


def _frames(stack: Optional[Dict[str, Any]]) -> List[str]:
    if not stack:
        return []
    return [f"{frame.get('functionName') or '(anonymous)'} at {tidy_url(frame.get('url', ''))}"
            f":{frame.get('lineNumber', 0)}:{frame.get('columnNumber', 0)}"
            for frame in stack.get("callFrames", [])]


def _split_location(frame: str) -> tuple:
    """`fn at url:line:col` to (url, line). Returns (None, None) when it is not that."""
    if " at " not in frame:
        return (None, None)
    parts = frame.rsplit(" at ", 1)[1].rsplit(":", 2)
    if len(parts) != 3:
        return (None, None)
    return (parts[0], int(parts[1]) if parts[1].isdigit() else None)


def translate(message: Dict[str, Any]) -> Optional[ConsoleRecord]:
    """One CDP event as a record, or None when it is not one we carry."""
    method, params, now = message.get("method", ""), message.get("params", {}), time.time()

    if method == "Runtime.consoleAPICalled":
        # React Native routes every uncaught synchronous exception through
        # console.error on purpose, so this one event carries ordinary logs and
        # crashes both. Unhandled rejections arrive as console.warn on a separate
        # path, which is why an error filter on this channel has to include warn.
        frames = _frames(params.get("stackTrace"))
        source, line = _split_location(frames[0]) if frames else (None, None)
        return ConsoleRecord(
            ts=now, level=_LEVEL_BY_CDP_TYPE.get(params.get("type", "log"), 0), kind="console",
            message=tidy_text(" ".join(_render_remote_object(a) for a in params.get("args", []))),
            source=source, line=line, stack=frames)

    if method == "Log.entryAdded":
        entry = params.get("entry", {})
        return ConsoleRecord(ts=now, level=_LEVEL_BY_CDP_TYPE.get(entry.get("level", "log"), 0),
                             kind="log-entry", message=tidy_text(entry.get("text", "")),
                             source=tidy_url(entry.get("url", "")), line=entry.get("lineNumber"))

    if method == "Runtime.exceptionThrown":
        details = params.get("exceptionDetails", {})
        return ConsoleRecord(
            ts=now, level=3, kind="exception",
            message=tidy_text((details.get("exception") or {}).get("description")
                              or details.get("text", "")),
            source=tidy_url(details.get("url", "")), line=details.get("lineNumber"),
            stack=_frames(details.get("stackTrace")))

    if method.startswith("Network."):
        return _translate_network(method.split(".", 1)[1], params, now)
    return None


def _translate_network(event: str, params: Dict[str, Any], now: float) -> Optional[ConsoleRecord]:
    request_id = {"request_id": params.get("requestId")}
    if event == "requestWillBeSent":
        request = params.get("request", {})
        return ConsoleRecord(ts=now, level=0, kind="network", extra=request_id,
                             message=f"--> {request.get('method')} {request.get('url', '')[:200]}")
    if event == "responseReceived":
        response = params.get("response", {})
        status = response.get("status", 0)
        return ConsoleRecord(ts=now, level=3 if status >= 400 else 0, kind="network",
                             extra=request_id,
                             message=f"<-- {status} {response.get('url', '')[:200]}")
    if event == "loadingFailed":
        return ConsoleRecord(ts=now, level=3, kind="network", extra=request_id,
                             message=f"xxx failed: {params.get('errorText')}")
    return None


async def stream(target: Dict[str, Any], host: str, port: int, *, on_record: Callable,
                 on_domains: Callable, should_stop: Callable[[], bool]) -> None:
    """Attach and pump events until ``should_stop`` says otherwise.

    `Runtime.enable` answering ok proves the inspector proxy accepted the command, not
    that the engine implements the domain, so the caller decides whether this channel is
    live from whether anything actually arrived on it.
    """
    import websockets

    ws_url = target["webSocketDebuggerUrl"].replace("localhost", host)
    origin = f"http://{host}:{port}"
    async with websockets.connect(ws_url, max_size=None, additional_headers={"Origin": origin},
                                  ping_interval=None, open_timeout=10) as socket:
        pending = {}
        for index, method in enumerate(_ENABLE_METHODS, start=1):
            await socket.send(json.dumps({"id": index, "method": method, "params": {}}))
            pending[index] = method
        domains: Dict[str, bool] = {}
        while not should_stop():
            try:
                raw = await asyncio.wait_for(socket.recv(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.debug("mobile console socket closed: %s", e)
                return
            message = json.loads(raw)
            if "id" in message:
                method = pending.pop(message["id"], None)
                if method:
                    domains[method.split(".")[0]] = "error" not in message
                    on_domains(dict(domains))
                continue
            record = translate(message)
            if record is not None:
                on_record(record)
