"""Spikes 4 and 5: what Metro's inspector proxy actually exposes.

Spike 4 asks whether `/json/list` marks an already-attached debugger, the way
Chrome nulls `webSocketDebuggerUrl` on a taken target. That decides whether
Decision 3's one-connection constraint can be pre-flight detected or only
discovered by attaching and failing.

Spike 5 asks whether a CDP client that expects a browser-level endpoint can
work against a Metro target at all. `codebase-integration.md` found strings in
the shipped `agent-browser` binary showing it initializes the `Target` domain
during startup, which Metro does not serve. This probe settles it empirically
instead of by inference: it fetches `/json/version` (which a browser serves
and Metro may not), lists targets, then attaches directly and asks the target
which domains it really honours.

Usage:  python metro_probe.py [--port 8081]
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

try:
    import websockets  # noqa: F401
except ImportError:  # pragma: no cover
    websockets = None


def _get(url: str) -> tuple[int, object]:
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except Exception as exc:  # connection refused, timeout
        return 0, f"{type(exc).__name__}: {exc}"


def probe_http(port: int) -> list[dict]:
    print(f"== HTTP discovery on localhost:{port} ==\n")

    for path in ("/json/version", "/json", "/json/list"):
        status, body = _get(f"http://localhost:{port}{path}")
        print(f"GET {path} -> {status}")
        if isinstance(body, str):
            print(f"  {body[:300]}")
        else:
            print(f"  {json.dumps(body, indent=2)[:1500]}")
        print()

    status, targets = _get(f"http://localhost:{port}/json/list")
    if status != 200 or not isinstance(targets, list):
        print("no target list, cannot continue")
        return []

    print("== SPIKE 4: is an attached debugger detectable from the listing? ==\n")
    for i, t in enumerate(targets):
        ws = t.get("webSocketDebuggerUrl")
        print(f"target {i}: {t.get('title') or t.get('description') or '?'}")
        print(f"  type            = {t.get('type')}")
        print(f"  webSocketDebuggerUrl = {ws!r}")
        # React Native adds its own hints beyond the Chrome shape.
        for key in ("reactNative", "vm", "deviceName", "appId"):
            if key in t:
                print(f"  {key} = {json.dumps(t[key])[:200]}")
        print()

    print(
        "Spike 4 reading: a null or missing webSocketDebuggerUrl means the slot\n"
        "is taken and Hermes can pre-flight detect it. A url present on every\n"
        "target even while a debugger is attached means detection is\n"
        "attach-and-fail only. Re-run this with React Native DevTools open to\n"
        "see which case holds.\n"
    )
    return targets


async def probe_domains(ws_url: str) -> None:
    import websockets

    print("== SPIKE 5: which CDP domains does the target actually honour? ==\n")
    # The domains that matter: Runtime and Log carry the console, Network is
    # the RN >=0.83 gate, Page/DOM/Target are what a browser-shaped client
    # assumes and what Metro is expected to lack.
    checks = [
        ("Runtime.enable", {}),
        ("Log.enable", {}),
        ("Network.enable", {}),
        ("Debugger.enable", {}),
        ("Page.enable", {}),
        ("DOM.getDocument", {}),
        ("Target.getTargets", {}),
    ]

    async with websockets.connect(ws_url, max_size=None) as ws:
        for i, (method, params) in enumerate(checks, start=1):
            await ws.send(json.dumps({"id": i, "method": method, "params": params}))

        seen = 0
        events: dict[str, int] = {}
        results: dict[int, str] = {}
        import asyncio

        try:
            while seen < len(checks):
                raw = await asyncio.wait_for(ws.recv(), timeout=6)
                msg = json.loads(raw)
                if "id" in msg:
                    seen += 1
                    if "error" in msg:
                        results[msg["id"]] = f"ERROR {msg['error'].get('message')}"
                    else:
                        results[msg["id"]] = "ok"
                else:
                    events[msg["method"]] = events.get(msg["method"], 0) + 1
        except asyncio.TimeoutError:
            pass

        for i, (method, _) in enumerate(checks, start=1):
            verdict = results.get(i, "NO REPLY (timed out)")
            print(f"  {method:22} {verdict}")

        print("\n  events received during the probe:")
        for name, count in sorted(events.items()):
            print(f"    {name} x{count}")
        if not events:
            print("    (none)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8081)
    args = ap.parse_args()

    targets = probe_http(args.port)
    if not targets:
        return 1

    ws_url = next(
        (t.get("webSocketDebuggerUrl") for t in targets if t.get("webSocketDebuggerUrl")),
        None,
    )
    if not ws_url:
        print("no attachable target (every webSocketDebuggerUrl was null or absent)")
        return 1

    if websockets is None:
        print("the `websockets` package is not importable; skipping the domain probe")
        print(f"attachable target: {ws_url}")
        return 1

    import asyncio

    asyncio.run(probe_domains(ws_url))
    return 0


if __name__ == "__main__":
    sys.exit(main())
