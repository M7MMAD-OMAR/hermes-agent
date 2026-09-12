"""Reference implementation of Decision 3: console, errors and network from a
running React Native app, over CDP through Metro's inspector proxy.

**Which channel this tool uses depends on how the app is running**, and the
difference is invisible in the target metadata. In a **development build**,
`Runtime.consoleAPICalled` delivers every console level with full stack
frames. In **Expo Go** it never fires at all, and the only console channel is
`adb logcat -s ReactNativeJS`. `--with-logcat` runs both and merges them,
which is what a real implementation should do, because the probe for which
one works is just "did anything arrive".

Spike 5 settled the shape of this. Against a real RN 0.86 target:

    Runtime.enable    ok        Page.enable        ERROR (unsupported)
    Log.enable        ok        DOM.getDocument    ERROR (unsupported)
    Network.enable    ok        Target.getTargets  ERROR (unsupported)
    Debugger.enable   ok

    events observed: Runtime.consoleAPICalled, Log.entryAdded,
                     Runtime.executionContextCreated

So the console channel works, the Network domain works on this version, and
the browser-shaped domains do not exist. That last fact is why `agent-browser`
cannot be pointed at this target: it initializes the `Target` domain during
startup and it reads `webSocketDebuggerUrl` out of `/json/version`, which
Metro serves without one.

Two connection requirements that are not optional and are not documented in
any design note:

1. **The `Origin` header is mandatory.** Without it Metro's inspector proxy
   answers the websocket handshake with **HTTP 401**. Metro's own log states
   the rule: the origin must be `http://127.0.0.1:<port>` or its hostname
   must be one of `localhost`, `127.0.0.1`, `0.0.0.0`, `[::]`.
2. **The websocket host must match the origin host.** Connecting to
   `ws://localhost:8081/...` while sending `Origin: http://127.0.0.1:8081`
   passes the origin check and then drops the socket with close code 1006 and
   no close frame, which reads exactly like a crash and is not one.

Usage:
    python mobile_console.py                 # stream until Ctrl-C
    python mobile_console.py --seconds 30    # stream for a fixed window
    python mobile_console.py --json out.json # also write structured records
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any

import websockets

# Matches the level vocabulary `right-rail/preview-console.tsx` already
# renders for the browser console, so the device console drawer can reuse it.
LEVEL_BY_CDP_TYPE = {
    "log": 0,
    "debug": 0,
    "info": 1,
    "warning": 2,
    "warn": 2,
    "error": 3,
    "assert": 3,
}


@dataclass
class ConsoleRecord:
    ts: float
    level: int
    kind: str          # "console" | "log-entry" | "exception" | "network"
    message: str
    source: str | None = None
    line: int | None = None
    stack: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    def format(self) -> str:
        name = {0: "log", 1: "info", 2: "warn", 3: "error"}.get(self.level, "log")
        where = f" ({self.source}:{self.line})" if self.source else ""
        return f"[{name}] {self.message}{where}"


def discover(port: int, host: str = "127.0.0.1") -> dict:
    """Find the RN target. Returns the raw /json/list entry."""
    with urllib.request.urlopen(f"http://{host}:{port}/json/list", timeout=5) as r:
        targets = json.load(r)
    if not targets:
        raise RuntimeError(
            f"no debug targets on {host}:{port}. Is Metro running and the app open?"
        )
    # Prefer a target that is actually attachable.
    for t in targets:
        if t.get("webSocketDebuggerUrl"):
            return t
    raise RuntimeError(
        "every target reported a null webSocketDebuggerUrl, which means the "
        "single debugger slot is already taken"
    )


def _render_remote_object(obj: dict) -> str:
    """CDP RemoteObject to something readable, without a full JS formatter."""
    if "value" in obj:
        v = obj["value"]
        return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    if obj.get("unserializableValue") is not None:
        return str(obj["unserializableValue"])
    if obj.get("description"):
        return obj["description"]
    return obj.get("type", "?")


def _frames(stack: dict | None) -> list[str]:
    if not stack:
        return []
    out = []
    for f in stack.get("callFrames", []):
        fn = f.get("functionName") or "(anonymous)"
        url = f.get("url", "")
        out.append(f"{fn} at {url}:{f.get('lineNumber', 0)}:{f.get('columnNumber', 0)}")
    return out


class MobileConsole:
    """Attaches to one RN target and turns CDP events into ConsoleRecords."""

    def __init__(self, port: int = 8081, host: str = "127.0.0.1") -> None:
        self.port = port
        self.host = host
        self.records: list[ConsoleRecord] = []
        self._next_id = 1
        self.capabilities: dict[str, bool] = {}

    async def _call(self, ws, method: str, params: dict | None = None) -> int:
        mid = self._next_id
        self._next_id += 1
        await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        return mid

    async def run(self, seconds: float | None, on_record) -> None:
        target = discover(self.port, self.host)
        ws_url = target["webSocketDebuggerUrl"]
        # Force the host to match the Origin we are about to send. See the
        # module docstring: a mismatch is a silent 1006 drop.
        ws_url = ws_url.replace("localhost", self.host)
        origin = f"http://{self.host}:{self.port}"

        caps = target.get("reactNative", {}).get("capabilities", {})
        print(f"# target : {target.get('title')}")
        print(f"# device : {target.get('deviceName')}")
        print(f"# app    : {target.get('appId')}")
        print(f"# caps   : {caps}")
        print(f"# ws     : {ws_url}\n", flush=True)

        async with websockets.connect(
            ws_url,
            max_size=None,
            additional_headers={"Origin": origin},
            ping_interval=None,
            open_timeout=10,
        ) as ws:
            enables = ["Runtime.enable", "Log.enable", "Network.enable", "Debugger.enable"]
            pending = {}
            for m in enables:
                pending[await self._call(ws, m)] = m

            deadline = None if seconds is None else time.monotonic() + seconds
            while True:
                timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
                if timeout is not None and timeout <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout or 3600)
                except asyncio.TimeoutError:
                    break
                except websockets.exceptions.ConnectionClosed as exc:
                    print(f"\n# connection closed: {exc}", file=sys.stderr)
                    break

                msg = json.loads(raw)

                if "id" in msg:
                    method = pending.pop(msg["id"], None)
                    if method:
                        ok = "error" not in msg
                        self.capabilities[method.split(".")[0]] = ok
                        state = "enabled" if ok else "UNSUPPORTED"
                        print(f"# {method:18} {state}", flush=True)
                    continue

                rec = self._translate(msg)
                if rec is not None:
                    self.records.append(rec)
                    on_record(rec)

    def _translate(self, msg: dict) -> ConsoleRecord | None:
        method = msg.get("method", "")
        p = msg.get("params", {})
        now = time.time()

        if method == "Runtime.consoleAPICalled":
            # RN routes uncaught exceptions through console.error on purpose,
            # so this one event carries both ordinary logs and crashes.
            args = [_render_remote_object(a) for a in p.get("args", [])]
            frames = _frames(p.get("stackTrace"))
            top = frames[0] if frames else None
            src, line = (None, None)
            if top and " at " in top:
                loc = top.rsplit(" at ", 1)[1]
                bits = loc.rsplit(":", 2)
                if len(bits) == 3:
                    src, line = bits[0], int(bits[1]) if bits[1].isdigit() else None
            return ConsoleRecord(
                ts=now,
                level=LEVEL_BY_CDP_TYPE.get(p.get("type", "log"), 0),
                kind="console",
                message=" ".join(args),
                source=src,
                line=line,
                stack=frames,
            )

        if method == "Log.entryAdded":
            e = p.get("entry", {})
            return ConsoleRecord(
                ts=now,
                level=LEVEL_BY_CDP_TYPE.get(e.get("level", "log"), 0),
                kind="log-entry",
                message=e.get("text", ""),
                source=e.get("url"),
                line=e.get("lineNumber"),
            )

        if method == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            desc = (d.get("exception") or {}).get("description") or d.get("text", "")
            return ConsoleRecord(
                ts=now,
                level=3,
                kind="exception",
                message=desc,
                source=d.get("url"),
                line=d.get("lineNumber"),
                stack=_frames(d.get("stackTrace")),
            )

        if method.startswith("Network."):
            short = method.split(".", 1)[1]
            if short == "requestWillBeSent":
                req = p.get("request", {})
                return ConsoleRecord(
                    ts=now, level=0, kind="network",
                    message=f"--> {req.get('method')} {req.get('url','')[:120]}",
                    extra={"requestId": p.get("requestId")},
                )
            if short == "responseReceived":
                resp = p.get("response", {})
                status = resp.get("status", 0)
                return ConsoleRecord(
                    ts=now, level=3 if status >= 400 else 0, kind="network",
                    message=f"<-- {status} {resp.get('url','')[:120]}",
                    extra={"requestId": p.get("requestId")},
                )
            if short == "loadingFailed":
                return ConsoleRecord(
                    ts=now, level=3, kind="network",
                    message=f"xxx failed: {p.get('errorText')}",
                    extra={"requestId": p.get("requestId")},
                )
        return None


LOGCAT_LEVEL = {"V": 0, "D": 0, "I": 1, "W": 2, "E": 3, "F": 3}
LOGCAT_RE = __import__("re").compile(
    r"^\d\d-\d\d \S+\s+\d+\s+\d+\s+([VDIWEF])\s+ReactNativeJS\s*:\s?(.*)$"
)


def tail_logcat(on_record, stop_after: float | None, tag: str = "ReactNativeJS"):
    """The channel that works in Expo Go, where CDP console does not.

    Polls rather than tailing, for a reason that costs real debugging time to
    find: **`adb logcat` block-buffers when its stdout is a pipe.** A live
    `for line in proc.stdout` tail therefore sits completely silent until 4 KiB
    of output accumulates, which on a quiet app can be minutes. It looks
    exactly like "logcat is not working" and is not. The alternatives are
    `stdbuf -oL adb logcat`, which needs coreutils and does not exist on every
    host, or polling `adb logcat -d`, which is what this does.

    Two more gotchas encoded here:

    * **`-t N` is applied before the tag filter** on this adb, so
      `adb logcat -d -s ReactNativeJS:V -t 6` returns the last 6 lines of the
      whole buffer and then filters them, usually to nothing. Never combine
      `-t` with `-s` and expect N tagged lines.
    * A multi-line structured object arrives as N separately tagged lines, so
      a line more indented than its predecessor is folded into it.
    """
    import subprocess as sp
    import threading

    def run() -> None:
        deadline = None if stop_after is None else time.monotonic() + stop_after
        seen: set[str] = set()
        last: ConsoleRecord | None = None
        while deadline is None or time.monotonic() < deadline:
            try:
                out = sp.run(
                    ["adb", "logcat", "-v", "threadtime", "-d", "-s", f"{tag}:V"],
                    capture_output=True, text=True, timeout=20,
                ).stdout
            except Exception:
                time.sleep(1.0)
                continue

            for line in out.splitlines():
                if line in seen:
                    continue
                seen.add(line)
                m = LOGCAT_RE.match(line)
                if not m:
                    continue
                level_ch, text = m.group(1), m.group(2)
                if last is not None and text.startswith(("  ", "\t")) and text.strip():
                    last.message += "\n" + text
                    continue
                last = ConsoleRecord(
                    ts=time.time(),
                    level=LOGCAT_LEVEL.get(level_ch, 0),
                    kind="logcat",
                    message=text,
                )
                on_record(last)
            time.sleep(1.0)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--seconds", type=float, default=None)
    ap.add_argument("--json", dest="json_out")
    ap.add_argument(
        "--with-logcat",
        action="store_true",
        help="also tail logcat, which is the only console channel in Expo Go",
    )
    args = ap.parse_args()

    mc = MobileConsole(args.port, args.host)
    logcat_records: list[ConsoleRecord] = []

    def emit(rec: ConsoleRecord) -> None:
        prefix = "cdp   " if rec.kind != "logcat" else "logcat"
        print(f"{prefix} {rec.format()}", flush=True)
        if rec.stack and rec.level >= 3:
            for f in rec.stack[:6]:
                print(f"        {f}", flush=True)

    def emit_logcat(rec: ConsoleRecord) -> None:
        logcat_records.append(rec)
        emit(rec)

    if args.with_logcat:
        tail_logcat(emit_logcat, args.seconds)

    try:
        asyncio.run(mc.run(args.seconds, emit))
    except KeyboardInterrupt:
        pass

    # Only `Runtime.consoleAPICalled` counts as evidence that the engine
    # delivers console over CDP. `Log.entryAdded` does not: Metro's inspector
    # proxy injects its own notices on that event even when the engine is
    # delivering nothing, so counting it reports a live channel on a target
    # where the channel is dead.
    cdp_console = [r for r in mc.records if r.kind == "console"]
    print(f"\n# captured {len(mc.records)} CDP records, {len(logcat_records)} logcat records")
    print(f"# domains: {mc.capabilities}")
    if args.with_logcat:
        verdict = (
            "CDP console is live on this target"
            if cdp_console
            else "CDP console is DEAD on this target, logcat is the only channel "
            "(this is what Expo Go looks like)"
        )
        print(f"# verdict: {verdict}")
    mc.records.extend(logcat_records)
    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump([asdict(r) for r in mc.records], fh, indent=2)
        print(f"# wrote {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
