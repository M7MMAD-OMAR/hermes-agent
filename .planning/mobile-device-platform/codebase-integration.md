# Codebase integration notes for a mobile device platform

Read-only research pass over this checkout, branch `autobuild/sidebar-browser`.
Every claim below carries a `file:line` citation. Where a claim rests on weaker
evidence, such as strings extracted from a prebuilt binary, that is labelled.

Quoting note: many docstrings in this repo contain long dashes, which are banned
in this file. Where a docstring matters, its meaning is paraphrased and the line
is cited instead of quoted verbatim. Only mechanical code lines are quoted.

---

## 1. The external `agent-browser` binary, and whether `console` / `errors` can run against a React Native CDP target

### Verdict

**Rewrite, do not reuse.** The blocker is not that `console` and `errors`
internally need `Page` or `DOM`. The blocker is one level earlier: every path in
this repo that hands a CDP endpoint to `agent-browser` hands it a **browser-level**
endpoint and then discovers a page target from it. A React Native JS target
published by Metro's inspector proxy is a **page-level** socket with no browser
endpoint above it and no `Target` domain. The connection cannot be established at
all, so `console` and `errors` never get the chance to run.

### How the binary is invoked

`tools/browser_tool_session.py:553-614` (`_run_browser_command`) builds one argv
per call. The backend selection is at `tools/browser_tool_session.py:585-593`:

```python
        if session_info.get("cdp_url"):
            backend_args = ["--cdp", session_info["cdp_url"]]
        else:
            backend_args = ["--session", session_info["session_name"]]
            if _cloud._is_headed_mode():
                backend_args.append("--headed")
            if engine != "auto" and not _bt._is_camofox_mode():
                backend_args += ["--engine", engine]
```

and the final argv at `tools/browser_tool_session.py:595`:

```python
    cmd_parts = _agent_browser_argv(browser_cmd) + backend_args + ["--json", command] + args
```

So yes, there is a `--cdp` flag, and it takes the websocket URL directly. The
comment block at `tools/browser_tool_session.py:583-584` states that `--cdp` is
never combined with `--session`, because agent-browser 0.13 and later would
create a local browser and silently ignore `--cdp` if both were present.

The process is spawned at `tools/browser_tool_session.py:133-152`
(`_popen_agent_browser`), with stdout and stderr redirected to temp files inside
the per-session socket directory rather than pipes, because the CLI forks a
daemon that inherits its file descriptors. The daemon is per session, and the
socket directory is set through `AGENT_BROWSER_SOCKET_DIR` at
`tools/browser_tool_session.py:121-130` (`_agent_browser_command_env`), which also
sets `AGENT_BROWSER_IDLE_TIMEOUT_MS` for daemon side idle self termination.

Output is parsed at `tools/browser_tool_session.py:435-473`
(`_interpret_browser_command_output`), which expects JSON on stdout because of the
`--json` flag.

### Subcommands this repo invokes

Every `_run_browser_command` call site in `tools/`:

| Subcommand | Args | Call site |
|---|---|---|
| `open` | `["about:blank"]` | `tools/browser_tool.py:670` |
| `open` | `[url]` | `tools/browser_tool.py:733` |
| `snapshot` | `["-c"]` or `[]` | `tools/browser_tool.py:695`, `tools/browser_tool.py:786` |
| `click` | `["@e5"]` | via `_guarded_action`, `tools/browser_tool.py:852` |
| `press` | `[key]` | via `_guarded_action`, `tools/browser_tool.py:907` |
| `fill` | `[ref, text]` | `tools/browser_tool.py:864` |
| `scroll` | `[direction, pixels]` | `tools/browser_tool.py:884` |
| `back` | `[]` | `tools/browser_tool.py:893` |
| `console` | `["--clear"]` or `[]` | `tools/browser_tool.py:956` |
| `errors` | `["--clear"]` or `[]` | `tools/browser_tool.py:957` |
| `eval` | `[expression]` | `tools/browser_tool.py:1068`, `tools/browser_tool.py:1151`, `tools/browser_tool_eval_policy.py:49` |
| `record` | `["start", path]` / `["stop"]` | `tools/browser_tool.py:1111`, `tools/browser_tool.py:1128` |
| `screenshot` | varies | `tools/browser_tool.py:1182` |
| `close` | `[]` | `tools/browser_tool_lifecycle.py:668` |
| `get` | `["url"]` | `tools/browser_tool_lightpanda_fallback.py:128` |
| `get` | `["cdp-url"]` | `tools/browser_use_cli.py:388` |

There is a second, separate spawn helper that does not go through
`_run_browser_command`: `_agent_browser_session_cmd` at
`tools/browser_tool_real_profile.py:51`, used for `get cdp-url`
(`tools/browser_tool_real_profile.py:69`) and `close`
(`tools/browser_tool_real_profile.py:112`).

The `console` and `errors` subcommands take exactly one optional flag in this
repo's usage, `--clear`, set at `tools/browser_tool.py:955`:

```python
    clear_args = ["--clear"] if clear else []
```

### Where the binary lives, and whether its source is in this repo

**The source of `agent-browser` is not in this repository.** It is an external
npm package, pinned at `tools/browser_tool.py:126`:

```python
AGENT_BROWSER_NPX_SPEC = "agent-browser@^0.26.0"
```

Resolution order is in `tools/browser_tool_install.py:109-156`
(`_find_agent_browser`): `PATH`, then an extended PATH covering Homebrew and
managed directories, then `<repo>/node_modules/.bin`
(`tools/browser_tool_install.py:104-106`), then an npx sentinel fallback. The npx
form is expanded at `tools/browser_tool_session.py:97-108` (`_agent_browser_argv`)
into:

```python
        return [_npx_bin, "--ignore-scripts", "--prefer-offline", "-y", _bt.AGENT_BROWSER_NPX_SPEC]
```

The package is no longer a root `package.json` dependency; the docstring at
`tools/browser_tool_install.py:161-173` explains it resolves lazily through npx
and that `hermes update` warms the npx cache.

On this machine the resolved package is at
`/home/sbarah/.npm/_npx/ad6c181e5b604bdb/node_modules/agent-browser`, version
`0.26.0`, Apache 2.0, upstream repository `github.com/vercel-labs/agent-browser`.
The npm package ships **prebuilt Rust binaries only**, no Rust source: `bin/`
contains `agent-browser-linux-x64`, `agent-browser-darwin-arm64` and siblings,
plus a `bin/agent-browser.js` shim. So the implementation of `console` and
`errors` is not readable as source anywhere on this machine.

### Does the repo document required CDP domains?

No. Nothing in this repository states which CDP domains `agent-browser` requires.
The nearest thing is the Hermes-side CDP code, which does state its own
assumptions, and the vendored package's own docs.

The vendored docs list `--cdp <port|url>` as a global option and document CDP
mode as connecting to "Electron apps, Chrome/Chromium instances with remote
debugging, WebView2 applications, any browser exposing a CDP endpoint". They
describe `--cdp` as accepting either a port number, resolved via
`http://localhost:{port}`, or a full websocket URL. These are the package's
`README.md` and `skill-data/core/references/commands.md`, outside this repo.

### The evidence that it would not work against a React Native target

**Strong evidence, named error strings inside the shipped binary.** Running
`strings` over `bin/agent-browser-linux-x64` (version 0.26.0) yields, among
others:

- `Target domain initialization attempt exceeded the remaining startup deadline`
- `No webSocketDebuggerUrl found in /json/list targets`
- `No webSocketDebuggerUrl in /json/version at`
- `Failed to connect to /json/list at`
- `Timeout connecting to /json/list at`

The first of those is decisive on its own. The binary has a startup phase it
itself calls "Target domain initialization", with its own deadline. A CDP target
that does not implement `Target` cannot complete that phase.

**Suggestive evidence, string table adjacency, not proof of call order.** The
same binary contains the adjacent run `Target.attachToTargetPage.enableRuntime.enable`
and, elsewhere, `Target.setDiscoverTargetsTarget.getTargets`. This is consistent
with an attach sequence of `Target.attachToTarget`, then `Page.enable`, then
`Runtime.enable`, but string adjacency in a Rust binary's constant pool is not
proof. The binary also contains many `Page.*`, `DOM.*`, `Input.*`, `Network.*`
and `Fetch.*` method names, and deserializer type names including
`struct GetTargetsResult`, `struct AttachToTargetResult`, `struct TargetCreatedEvent`,
`struct TargetDestroyedEvent`, `struct ExceptionThrownEvent`.

I read `strings` output from a prebuilt binary. I did not read the Rust source,
which is not present on this machine, and I did not run the binary against any
target.

**Corroborating evidence from Hermes's own CDP code**, which shows the same
browser-level assumption end to end:

- `tools/browser_tool_cdp.py:23-24`: a URL containing `/devtools/browser/` passes
  through unchanged, which is the browser-level websocket form.
- `tools/browser_tool_cdp.py:31`: anything else is turned into a `/json/version`
  discovery URL, and `tools/browser_tool_cdp.py:41` reads `webSocketDebuggerUrl`
  out of that response. `/json/version` is a browser-level endpoint. Metro serves
  per-target entries at `/json/list`.
- `tools/browser_supervisor.py:354-363` (`_attach_initial_page`) is explicit:

```python
        targets = (await self._cdp("Target.getTargets")).get("result", {}).get("targetInfos", [])
        page_target = next((t for t in targets if t.get("type") == "page"), None)
        if page_target is None:
            page_target = (await self._cdp("Target.createTarget", {"url": "about:blank"}))["result"]
        attach = await self._cdp("Target.attachToTarget", {"targetId": page_target["targetId"], "flatten": True})
        self._page_session_id = sid = attach["result"]["sessionId"]
        await self._enable_page_domains(sid, timeout=10.0)
```

  and `tools/browser_supervisor_frames.py:50-54` (`_enable_page_domains`):

```python
        await self._cdp("Page.enable", session_id=session_id, timeout=timeout)
        await self._cdp("Runtime.enable", session_id=session_id, timeout=timeout)
        await self._cdp("Target.setAutoAttach", _AUTO_ATTACH_PARAMS, session_id=session_id, timeout=timeout)
```

- `tools/browser_cdp_tool.py:191-198`: the raw one-shot path, when given a
  `target_id`, also starts with `Target.attachToTarget`.

So a new mobile console tool cannot reuse `agent-browser`, and it cannot reuse
`CDPSupervisor` unmodified either. What it can reuse is the lower layer: the
websocket send and correlate loop, described in section 2.

---

## 2. The raw asyncio websocket CDP path

There are two distinct raw CDP implementations in Python. Both use the
`websockets` library. Neither of them handles `Runtime.consoleAPICalled`.

### 2a. `tools/browser_tool_cdp.py`, endpoint resolution only

This file contains no websocket code at all. It is endpoint resolution plus
supervisor lifecycle:

- `_resolve_cdp_override(cdp_url: str) -> str`, `tools/browser_tool_cdp.py:12-47`.
  Pass through for a URL containing `/devtools/browser/`
  (`tools/browser_tool_cdp.py:23-24`); otherwise build a `/json/version` URL
  (`tools/browser_tool_cdp.py:31`), `requests.get` it
  (`tools/browser_tool_cdp.py:36`), and read `webSocketDebuggerUrl`
  (`tools/browser_tool_cdp.py:41`). Falls back to the raw value with a warning.
- `_get_cdp_override_raw() -> str`, `tools/browser_tool_cdp.py:50-59`. Reads env
  `BROWSER_CDP_URL` first, then config `browser.cdp_url`. No network I/O. Gates
  must use this one.
- `_get_cdp_override() -> str`, `tools/browser_tool_cdp.py:62-69`. Same, but runs
  the discovery HTTP call.
- `_get_dialog_policy_config() -> Tuple[str, float]`, `tools/browser_tool_cdp.py:72-98`.
- `_ensure_cdp_supervisor(task_id: str) -> None`, `tools/browser_tool_cdp.py:101-124`.
  Resolves a URL, then `SUPERVISOR_REGISTRY.get_or_start(...)` at
  `tools/browser_tool_cdp.py:122`. Swallows all errors.
- `_stop_cdp_supervisor(task_id: str) -> None`, `tools/browser_tool_cdp.py:127-133`.

### 2b. `tools/browser_cdp_tool.py`, the stateless one-shot call

This is the `browser_cdp` tool: one websocket per call, one command, then close.

- `_resolve_cdp_endpoint() -> str`, `tools/browser_cdp_tool.py:103-110`.
- `_browser_cdp_private_guard(*, task_id: str, method: str, params: Dict[str, Any]) -> Optional[str]`,
  `tools/browser_cdp_tool.py:138-163`. SSRF and private-page guard.
- `_cdp_call(ws_url, method, params, target_id, timeout) -> Dict[str, Any]`,
  `tools/browser_cdp_tool.py:166-204`. This is the core. Connection:

```python
    async with websockets.connect(ws_url, max_size=None, open_timeout=timeout, close_timeout=5,
                                  ping_interval=None) as ws:
```

  at `tools/browser_cdp_tool.py:172-173`. `max_size=None` because CDP responses
  can be large; `ping_interval=None` because CDP servers do not expect pings.

  Command send and response correlation is the nested `_send`, at
  `tools/browser_cdp_tool.py:177-188`:

```python
        async def _send(req: Dict[str, Any], what: str) -> Dict[str, Any]:
            nonlocal next_id
            call_id, next_id = next_id, next_id + 1
            await ws.send(json.dumps({"id": call_id, **req}))
            deadline = asyncio.get_running_loop().time() + timeout
            while True:  # ignore events / out-of-order responses
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise TimeoutError(f"Timed out {what}")
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=remaining))
                if msg.get("id") == call_id:
                    return msg
```

  Note what this does with events: **it drops them**. Any frame without a
  matching `id` is discarded in the loop. There is no event dispatch on this path
  at all. A `Runtime.consoleAPICalled` frame arriving here is thrown away.

  Target attach, when `target_id` is given, at `tools/browser_cdp_tool.py:190-198`:

```python
            msg = await _send({"method": "Target.attachToTarget", "params": {"targetId": target_id, "flatten": True}},
                              f"attaching to target {target_id}")
```

- `_browser_cdp_via_supervisor(task_id, frame_id, method, params, timeout) -> str`,
  `tools/browser_cdp_tool.py:207-254`. Routes through the live supervisor for an
  out of process iframe, via `safe_schedule_threadsafe` at
  `tools/browser_cdp_tool.py:245-246`.
- `browser_cdp(method, params=None, target_id=None, frame_id=None, timeout=30.0, task_id=None) -> str`,
  `tools/browser_cdp_tool.py:257-318`. The public tool. `_run_async(_cdp_call(...))`
  at `tools/browser_cdp_tool.py:299`. Returns
  `{"success": True, "method": ..., "result": ...}` or an error.
- `_run_async(coro)`, `tools/browser_cdp_tool.py:90-100`. The sync to async bridge.
- `_redact_cdp_output(value, *, always_paths=(), flagged_paths=())`,
  `tools/browser_cdp_tool.py:48-75`.

### 2c. `tools/browser_supervisor.py`, the persistent connection with event dispatch

This is the only place in Python with a long-lived CDP websocket and an event
dispatch table. It is the natural attachment point for a mobile console tool,
except that its attach sequence is browser-level, as shown in section 1.

Class `CDPSupervisor(DialogSupervisionMixin, FrameTrackingMixin)`,
`tools/browser_supervisor.py:90-412`.

- `__init__(self, task_id, cdp_url, *, dialog_policy=DEFAULT_DIALOG_POLICY, dialog_timeout_s=DEFAULT_DIALOG_TIMEOUT_S) -> None`,
  `tools/browser_supervisor.py:96-124`. Relevant state:
  `self._pending_calls: Dict[int, asyncio.Future]`
  (`tools/browser_supervisor.py:119`), `self._ws: Optional[ClientConnection]`
  (`tools/browser_supervisor.py:120`), `self._page_session_id`
  (`tools/browser_supervisor.py:121`), `self._next_call_id`
  (`tools/browser_supervisor.py:118`).
- `start(self, timeout: float = 15.0) -> None`, `tools/browser_supervisor.py:128-144`.
  Spawns a daemon thread running its own asyncio loop.
- `stop(self, timeout: float = 5.0) -> None`, `tools/browser_supervisor.py:146-157`.
- `snapshot(self) -> SupervisorSnapshot`, `tools/browser_supervisor.py:163-171`.
- `respond_to_dialog(self, action, *, prompt_text=None, dialog_id=None, timeout=10.0) -> Dict[str, Any]`,
  `tools/browser_supervisor.py:173-203`.
- `evaluate_runtime(self, expression, *, return_by_value=True, await_promise=True, timeout=10.0) -> Dict[str, Any]`,
  `tools/browser_supervisor.py:205-258`.
- `_thread_main(self) -> None`, `tools/browser_supervisor.py:262-283`.
- `_run(self) -> None`, `tools/browser_supervisor.py:300-352`. The reconnecting
  outer loop. Websocket open at `tools/browser_supervisor.py:312`:

```python
                self._ws = await asyncio.wait_for(websockets.connect(self.cdp_url, max_size=50 * 1024 * 1024), timeout=10.0)
```

  Reader task creation at `tools/browser_supervisor.py:323`:

```python
            reader_task = asyncio.create_task(self._read_loop(), name="cdp-reader")
```

  Exponential backoff from 0.5s to a 10s cap, `tools/browser_supervisor.py:305`
  and `tools/browser_supervisor.py:320-321`.
- `_attach_initial_page(self) -> None`, `tools/browser_supervisor.py:354-363`.
  Quoted in section 1. Browser-level.
- `_cdp(self, method, params=None, *, session_id=None, timeout=10.0) -> Dict[str, Any]`,
  `tools/browser_supervisor.py:365-379`. Command send plus correlation by future:

```python
        call_id, self._next_call_id = self._next_call_id, self._next_call_id + 1
        payload: Dict[str, Any] = {"id": call_id, "method": method}
        payload.update({k: v for k, v in (("params", params), ("sessionId", session_id)) if v})
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending_calls[call_id] = fut
        await self._ws.send(json.dumps(payload))
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending_calls.pop(call_id, None)
```

- `_read_loop(self) -> None`, `tools/browser_supervisor.py:381-406`. Responses go
  to futures, events go to handlers, at `tools/browser_supervisor.py:392-402`:

```python
                if "id" in msg:
                    fut = self._pending_calls.pop(msg["id"], None)
                    if fut is None or fut.done():
                        continue
                    if "error" in msg:
                        fut.set_exception(RuntimeError(f"CDP error on id={msg['id']}: {msg['error']}"))
                    else:
                        fut.set_result(msg)
                elif handler := self._EVENT_HANDLERS.get(msg.get("method")):
                    result = handler(self, msg.get("params", {}), msg.get("sessionId"))
                    if result is not None:
                        await result
```

- `_EVENT_HANDLERS`, `tools/browser_supervisor.py:410-412`. Merged from the two
  mixins. The complete registered set is five frame events plus three dialog
  events:
  - `tools/browser_supervisor_frames.py:160-165`: `Page.frameAttached`,
    `Page.frameNavigated`, `Page.frameDetached`, `Target.attachedToTarget`,
    `Target.detachedFromTarget`.
  - `tools/browser_supervisor_dialogs.py:303-306`: `Page.javascriptDialogOpening`,
    `Page.javascriptDialogClosed`, `Fetch.requestPaused`.

  **No `Runtime.consoleAPICalled`. No `Runtime.exceptionThrown`. No `Log.entryAdded`.**
  A new handler key added to one of these mixin dictionaries, or a third mixin, is
  the exact extension point for a mobile console feed.

- `_SupervisorRegistry`, `tools/browser_supervisor.py:415-468`, with
  `get(task_id)` at `:422`, `get_or_start(task_id, cdp_url, *, dialog_policy, dialog_timeout_s, start_timeout=15.0)`
  at `:430-455`, `stop(task_id)` at `:457`, `stop_all()` at `:462`. The module
  global is `SUPERVISOR_REGISTRY`.

### `ConsoleEvent` is a decoy

`tools/browser_supervisor.py:485-491` defines:

```python
@dataclass
class ConsoleEvent:
    ts: float
    level: str  # "log" | "error" | "warning" | "exception"
    text: str
    url: Optional[str] = None
```

with `CONSOLE_HISTORY_MAX = 50` at `tools/browser_supervisor.py:483`. Both sit
inside the block opened at `tools/browser_supervisor.py:474` and marked as a
plugin compatibility shim, revert scheduled, for names external plugins imported
before a September 2026 decomposition. Nothing in the supervisor populates a
`ConsoleEvent`. Do not build on it.

### The only `Runtime.consoleAPICalled` in the tree

There is exactly one, and it is JavaScript, not Python, and it is a build script:
`apps/desktop/scripts/check-preview-agent.mjs:159`, inside `connect` at
`apps/desktop/scripts/check-preview-agent.mjs:143-173`. It is not part of the
tool pipeline.

---

## 3. Where `browser_console()` data actually comes from

`browser_console(clear: bool = False, expression: Optional[str] = None, task_id: Optional[str] = None) -> str`
is at `tools/browser_tool.py:938-973`.

Three branches, in order:

**Branch 1, evaluation, `tools/browser_tool.py:941-945`.** If `expression` is not
`None`, this is not a console read at all; it runs an eval policy check and
delegates to `_browser_eval`, which at `tools/browser_tool.py:1068` calls
`_run_browser_command(effective_task_id, "eval", [expression])`.

**Branch 2, Camofox, `tools/browser_tool.py:947-948`:**

```python
    if _is_camofox_mode():
        return _camofox("camofox_console", clear, task_id)
```

`camofox_console` at `tools/browser_camofox.py:572-578` returns an empty result
with a note saying console capture is not available on that backend. The deciding
condition is `is_camofox_mode()` at `tools/browser_camofox.py:83-93`: true when
`browser.cloud_provider` is `camofox` **and** no CDP override is active. A set
`BROWSER_CDP_URL` env var or a `browser.cdp_url` config value makes it false
(`tools/browser_camofox.py:91-92`).

**Branch 3, the default, `tools/browser_tool.py:950-971`.** Two subprocess calls
to the external daemon:

```python
    console_result = _session._run_browser_command(effective_task_id, "console", clear_args)
    errors_result = _session._run_browser_command(effective_task_id, "errors", clear_args)
```

Shaping, at `tools/browser_tool.py:959-966`, reads `data.messages` from the first
and `data.errors` from the second, redacts each through
`_snapshot._redact_browser_output`, and tags them `source: "console"` and
`source: "exception"` respectively. The response shape at
`tools/browser_tool.py:967-970` is
`{"success", "console_messages", "js_errors", "total_messages", "total_errors"}`.

### The concrete answer

**Console data comes exclusively from the external `agent-browser` daemon.** It
never comes from the raw Python CDP path, in any configuration. Setting
`browser.cdp_url` does not move console reads onto the Python websocket; it only
changes the argv `agent-browser` is spawned with, from
`--session <name>` to `--cdp <ws_url>` (`tools/browser_tool_session.py:585-593`).
The Python supervisor started alongside it at `tools/browser_tool_session.py:580-581`
handles dialogs and frame tracking only, and registers no console events.

The single deciding condition inside `browser_console` is `_is_camofox_mode()`,
and the Camofox branch returns an empty stub rather than an alternative data
source.

---

## 4. `_SessionEventQueue` and the SSE push channels

### Definition

`gateway/platforms/api_server.py:1038-1067`.

```python
class _SessionEventQueue:
    def __init__(self, session_id: str, run_id: str):
        self.loop = asyncio.get_running_loop()
        self.queue: "asyncio.Queue[Optional[tuple[str, Dict[str, Any]]]]" = asyncio.Queue()
        self.session_id = session_id
        self.run_id = run_id
        self.seq = 0
```

Two methods:

`payload(self, name: str, payload: Dict[str, Any]) -> tuple[str, Dict[str, Any]]`,
`gateway/platforms/api_server.py:1047-1053`:

```python
        self.seq += 1
        payload.setdefault("session_id", self.session_id)
        payload.setdefault("run_id", self.run_id)
        payload.setdefault("seq", self.seq)
        payload.setdefault("ts", time.time())
        return name, payload
```

`enqueue(self, name: str, payload: Dict[str, Any]) -> None`,
`gateway/platforms/api_server.py:1055-1067`:

```python
        event = self.payload(name, payload)
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None
        with suppress(RuntimeError):
            if running_loop is self.loop:
                self.queue.put_nowait(event)
            else:
                self.loop.call_soon_threadsafe(self.queue.put_nowait, event)
```

### Exact event shape

A queue item is the tuple `(name, payload)`, or `None` as the terminator. The
payload is a dict that always carries `session_id`, `run_id`, `seq` (a
monotonically increasing per-run integer starting at 1) and `ts` (a float unix
timestamp), unless the caller already supplied one of those keys, plus whatever
the caller adds. `name` becomes the SSE `event:` field at
`gateway/platforms/api_server.py:3190`:

```python
                await response.write(_sse_frame(payload, event=name, ensure_ascii=False))
```

`_sse_frame` is at `gateway/platforms/api_server.py:223`.

### Every push site

All of them are inside `APIServerAdapter._handle_session_chat_stream`,
`gateway/platforms/api_server.py:3092-3202`. There are no others in the tree.

| Line | Call | Event name |
|---|---|---|
| `api_server.py:3116` | `events.enqueue("assistant.delta", {"message_id", "delta"})` | `assistant.delta` |
| `api_server.py:3120` | `events.enqueue("tool.progress", {"message_id", "tool_name", "delta"})` | `tool.progress` |
| `api_server.py:3122` | `events.enqueue(event_type, {"message_id", "tool_name", "preview", "args"})` | `tool.started` / `tool.completed` / `tool.failed` |
| `api_server.py:3126` | `await queue.put(_event_payload("run.started", {...}))` | `run.started` |
| `api_server.py:3130` | `await queue.put(_event_payload("message.started", {...}))` | `message.started` |
| `api_server.py:3140` | `await queue.put(_event_payload("assistant.completed", {...}))` | `assistant.completed` |
| `api_server.py:3153` | `await queue.put(_event_payload("run.completed", completed_payload))` | `run.completed` |
| `api_server.py:3165` | `await queue.put(_event_payload("error", {"message": ...}))` | `error` |
| `api_server.py:3169` | `await queue.put(_event_payload("done", {}))` | `done` |
| `api_server.py:3170` | `await queue.put(None)` | terminator |

Note `gateway/platforms/api_server.py:3106`:

```python
        queue, _event_payload = events.queue, events.payload
```

so the `await queue.put(_event_payload(...))` form and the `events.enqueue(...)`
form are the same channel. The first is used from the coroutine, the second from
executor threads, since `enqueue` hops back onto the owning loop.

### A correction to the premise, important for a crash and ANR pipeline

`_SessionEventQueue` is **not a general notification bus**. It is constructed at
`gateway/platforms/api_server.py:3105`:

```python
        events = _SessionEventQueue(session_id, run_id)
```

inside the request handler, lives only in that handler's closure, is never stored
on the adapter, and is torn down when the run ends. An out-of-band producer, such
as a device watcher noticing a crash or an ANR, has **no way to reach it**. The
only injection points into a live run are the two callbacks passed into
`_run_agent` at `gateway/platforms/api_server.py:3133-3135`:
`stream_delta_callback=_delta` (defined `:3115-3117`) and
`tool_progress_callback=_tool_progress` (defined `:3119-3122`).

There is a second, longer-lived SSE channel that is reachable from outside a
request closure, and it is the better model for a crash and ANR pipeline:

- `GET /v1/runs/{run_id}/events`, handler `_handle_run_events` at
  `gateway/platforms/api_server_runs.py:660-700`, headers at
  `gateway/platforms/api_server_runs.py:681-682`.
- Its queues live in the adapter-level dict `self._run_streams`, created per run
  at `gateway/platforms/api_server_runs.py:428`:

```python
    q = self._run_streams[run_id] = asyncio.Queue()
```

- The push helper is `_make_run_event_callback(self, run_id, loop, *, _api_server)`
  at `gateway/platforms/api_server_runs.py:145-165`, whose inner `_push` at
  `gateway/platforms/api_server_runs.py:149-155` does a dictionary lookup by
  `run_id` and then `loop.call_soon_threadsafe(q.put_nowait, event)`. That lookup
  by id, rather than a captured closure variable, is what makes it reachable from
  an independent producer thread.

I did not verify which of the two channels the desktop app actually consumes for
notifications; see the gaps section.

---

## 5. `BrowserControlBroker` public surface, for a parallel `DeviceControlBroker`

File: `gateway/browser_control_broker.py`. One `threading.RLock` guards all state,
and send callbacks run outside it so a controller may call `complete` from inside
its own send (module docstring, `gateway/browser_control_broker.py:1-7`).

### Module constants

| Name | Line | Value or purpose |
|---|---|---|
| `DEFAULT_TICKET_TTL` | `:23` | `30.0` seconds |
| `DEFAULT_COMMAND_TIMEOUT` | `:25` | `30.0` seconds |
| `MAX_DEFERRED_CANCELS` | `:27` | `512` |
| `BROWSER_CONTROL_PROTOCOL_VERSION` | `:29` | `1`, exact int required, bools rejected |
| `BROWSER_CONTROL_CAPABILITIES` | `:32-35` | frozenset of 12 allowed action names |
| `BROWSER_CONTROL_DEVELOPER_CAPABILITIES` | `:37` | `{"browser_cdp", "browser_evaluate"}`, fail closed |
| `BROWSER_CONTROL_ARTIFACT_CAPABILITIES` | `:39` | `{"browser_artifact_download", "browser_artifact_upload"}` |
| `FRAME_COMMAND` | `:42` | `"browser.controller.command"` |
| `FRAME_CANCEL` | `:43` | `"browser.controller.cancel"` |
| `_OWNER_UNSET` | `:20` | sentinel object |
| `_IDENTITY_FIELDS` | `:121` | the six stable identity field names |

### Module functions

| Signature | Line |
|---|---|
| `browser_control_protocol_supported(value: Any) -> bool` | `:45-47` |
| `_extension_control_flag(config: Optional[dict], key: str) -> bool` | `:50-61` |
| `browser_control_developer_mode(config: Optional[dict] = None) -> bool` | `:64-66` |
| `browser_control_enabled(config: Optional[dict] = None) -> bool` | `:69-71` |
| `filter_browser_control_capabilities(value: Any, *, developer_mode: Optional[bool] = None) -> frozenset` | `:74-81` |
| `_same_scope_identity(first: ControllerScope, second: ControllerScope) -> bool` | `:124-125` |
| `_cancel_frame(pending: _PendingCommand) -> dict` | `:165-166` |
| `get_browser_control_broker() -> BrowserControlBroker` | `:510-512` |

Module global `_GLOBAL_BROKER = BrowserControlBroker()` at `:507`.

### Exception hierarchy

| Class | Line | Raised when |
|---|---|---|
| `BrowserControlError(Exception)` | `:84-85` | base |
| `ControllerTicketInvalid` | `:88-89` | unknown, consumed or expired ticket |
| `ControllerUnavailable` | `:92-93` | no controller for scope with capability |
| `ControllerCancelled` | `:96-97` | pending work failed closed by `detach` or `cancel` |
| `ControllerTimeout` | `:100-101` | dispatch wall clock exceeded |
| `ControllerRejected` | `:104-105` | controller completed with `ok=False` |

### Data classes

`ControllerScope`, frozen dataclass, `:109-117`. Equality over all fields.

```python
    principal_id: Optional[str] = None
    profile_id: Optional[str] = None
    session_id: Optional[str] = None
    controller_id: Optional[str] = None
    browser_profile_id: Optional[str] = None
    transport_family: Optional[str] = None
    capabilities: frozenset = frozenset()
```

`_IDENTITY_FIELDS` at `:121` is the first six. `capabilities` is deliberately
excluded from identity.

`Ticket`, frozen, `:129-132`: `value: str`, `expires_at: float`.

`_TicketRecord`, `:136-139`: `scope`, `expires_at`, `consumed: bool = False`.

`_Controller`, `:143-150`: `scope`, `send: Callable[[dict], None]`, `owner: Any = None`,
`connected: bool = True`, `deferred_cancels: list[dict]`, and
`send_lock: threading.Lock`, which serializes command and cancel writes against
detach or replacement and is never held together with broker state.

`_PendingCommand`, `:154-162`: `scope`, `command_id`, `tool_call_id`,
`event: threading.Event`, `done`, `cancelled`, `ok`, `result`.

### `BrowserControlBroker`, `:169-504`

Constructor, `:171-184`:

```python
    def __init__(self, *, ticket_ttl: float = DEFAULT_TICKET_TTL, command_timeout: float = DEFAULT_COMMAND_TIMEOUT,
                 clock: Optional[Callable[[], float]] = None, developer_mode: Optional[bool] = None) -> None
```

Internal state: `_clock` defaults to `time.monotonic` (`:174`), `_lock` is an
`RLock` (`:175`), `_tickets: Dict[str, _TicketRecord]` (`:176`),
`_controllers: Dict[ControllerScope, _Controller]` (`:177`),
`_pending: Dict[str, _PendingCommand]` (`:178`),
`_developer_mode_pinned: Optional[bool]` (`:181`), where `None` means defer to
live config on every selection so turning developer mode off revokes privileged
capabilities without a restart, and
`_artifact_stores: Dict[Optional[str], Any]` (`:183`).

Public surface, in file order:

| Member | Signature | Line |
|---|---|---|
| `developer_mode` | property `-> bool` | `:186-194` |
| `attach_artifact_store` | `(self, store: Any, *, profile_id: Optional[str] = None) -> None` | `:196-202` |
| `mint_ticket` | `(self, scope: ControllerScope) -> Ticket` | `:208-215` |
| `consume_ticket` | `(self, value: str) -> ControllerScope` | `:217-229` |
| `attach` | `(self, scope: ControllerScope, send: Callable[[dict], None], *, owner: Any = None) -> None` | `:240-287` |
| `select` | `(self, scope: ControllerScope, capability: str) -> Optional[_Controller]` | `:289-295` |
| `is_owner` | `(self, scope: ControllerScope, owner: Any) -> bool` | `:297-300` |
| `disconnect` | `(self, scope: ControllerScope, *, owner: Any = _OWNER_UNSET) -> bool` | `:302-314` |
| `detach` | `(self, scope: ControllerScope, *, owner: Any = _OWNER_UNSET, notify_controller: bool = True) -> None` | `:316-333` |
| `dispatch` | `(self, scope: ControllerScope, *, action: str, arguments: Optional[dict] = None, tool_call_id: Optional[str] = None) -> Any` | `:335-390` |
| `complete` | `(self, command_id: str, *, scope: Optional[ControllerScope] = None, ok: bool, result: Any = None) -> bool` | `:392-401` |
| `cancel` | `(self, scope: ControllerScope, *, tool_call_id: Optional[str]) -> bool` | `:403-418` |
| `scope_for_session` | `(self, *, session_id=None, task_id=None, principal_id=None, transport_family=None) -> Optional[ControllerScope]` | `:464-469` |
| `lane_registered` | `(self, *, session_id=None, task_id=None, principal_id=None, transport_family=None) -> bool` | `:471-475` |
| `disconnect_owner` | `(self, owner: Any) -> int` | `:477-481` |
| `reset` | `(self) -> None` | `:483-493` |
| `ticket_ttl_seconds` | property `-> float` | `:496-498` |
| `pending_count` | property `-> int` | `:501-504` |

Private helpers a mirror implementation will need:

| Member | Signature | Line |
|---|---|---|
| `_controller_for_identity_locked` | `(self, scope) -> Optional[_Controller]` | `:231-233` |
| `_live_controller` | `(self, scope) -> Optional[_Controller]` | `:235-238` |
| `_artifact_store_for_scope` | `(self, scope) -> Any` | `:204-206` |
| `_resolve_pending` | `(self, pending, *, cancelled: bool) -> None` | `:420-423` |
| `_validate_artifact_reference` | `(self, scope, action, arguments) -> None` | `:425-438` |
| `_defer_cancel_locked` | `(self, controller, pending) -> None` | `:440-443` |
| `_pending_for_scope_locked` | `(self, scope) -> list[_PendingCommand]` | `:445-446` |
| `_emit_cancel_frames` | `(self, controller, pendings) -> None` | `:448-454` |
| `_lane_scopes` | `(self, session_id, task_id, principal_id, transport_family) -> list[ControllerScope]` | `:456-462` |

### Semantics a mirror must preserve

These are the behaviours that make the broker safe, each worth copying exactly.

- **Tickets are swept on mint.** `mint_ticket` at `:211` drops expired records
  before minting, so the ticket table cannot grow without bound:

```python
            self._tickets = {v: rec for v, rec in self._tickets.items() if rec.expires_at > now}
            value = secrets.token_urlsafe(32)
```

- **Tickets are single use.** `consume_ticket` sets `record.consumed = True` at
  `:228` and raises `ControllerTicketInvalid` for unknown, consumed and expired,
  with distinct messages (`:221`, `:223`, `:225`).
- **Attach is identity-keyed, not scope-keyed.** A same-identity reconnect
  refreshes `send` and capabilities without cancelling pending work; a different
  controller or browser profile in the same authenticated session lane hard
  replaces the old one (`:241-243`, and the lane comparison at `:248-251` over
  `principal_id`, `profile_id`, `session_id`, `transport_family`).
- **`select` trusts the controller's current negotiated set, not the caller's**
  (`:291-295`), and gates developer capabilities on live developer mode at
  `:292-293`.
- **`disconnect` versus `detach` are deliberately different.** `disconnect`
  (`:302-314`) marks the transport offline and leaves pending work alive,
  returning `bool`. `detach` (`:316-333`) removes the controller and fails every
  pending command closed as `ControllerCancelled`, then emits cancel frames while
  still holding the old generation's `send_lock` so a command frame can never
  overtake its terminal cancel frame (comment at `:329-330`).
- **`complete` is single shot** (`:395-399`) and is safe to call from inside the
  send callback, because it takes only the broker lock, never `send_lock`.
- **`dispatch` blocks the calling thread** on `_PendingCommand.event` and raises
  one of four typed errors. It validates artifact references first (`:344-345`),
  and only an `artifact_id` travels on the wire, never bytes.
- **Lane lookups fail closed.** `_lane_scopes` (`:456-462`) returns `[]` unless
  every key component is non-empty; `scope_for_session` (`:464-469`) returns a
  scope only when exactly one match exists, so ambiguity is treated as failure.
  `lane_registered` (`:471-475`) reports True even for an offline controller, so
  callers can distinguish "bound but unavailable" from "never registered".
- **`reset`** (`:483-493`) detaches everything, clears tickets, and sweeps pending
  entries whose controller a concurrent teardown already removed.

A `DeviceControlBroker` can copy this file almost line for line, substituting a
`DeviceScope` whose identity fields name a device rather than a browser profile,
for example `device_id` and `serial` in place of `browser_profile_id`, and a
capability allowlist of device actions. The `send_lock` ordering, the identity
versus capability split, the ticket sweep, and the disconnect versus detach
distinction are the parts that must not be simplified.

---

## 6. What I could not determine, and what it would take

1. **What Metro's inspector proxy serves at `/json/version`, and whether it
   exposes any browser-level websocket.** This is the single fact that would turn
   the section 1 verdict from "very likely fails at connect" into "demonstrably
   fails at connect". I had no running React Native app or Metro server, and I was
   instructed not to touch the emulator. Settling it needs one HTTP GET against a
   live `http://localhost:8081/json/version` and `/json/list`, and then one
   attempt at `agent-browser --cdp <that ws url> --json console` against it.

2. **The actual Rust implementation of `agent-browser`'s `console` and `errors`
   subcommands.** The npm package ships prebuilt binaries only. My evidence is
   `strings` output plus the package's own markdown docs. Settling it needs a
   clone of `github.com/vercel-labs/agent-browser` at tag 0.26.0 and a read of the
   console command's handler. In particular, I could not determine whether the
   console buffer is fed by `Runtime.consoleAPICalled`, by `Log.entryAdded`, or by
   both, nor whether `errors` uses `Runtime.exceptionThrown` or a `Page` level
   event. The string `.exceptionThrown` and the type name
   `struct ExceptionThrownEvent` appear in the binary, which points at
   `Runtime.exceptionThrown`, but I did not confirm the call site.

3. **Which SSE channel the desktop app consumes for notifications.** Section 4
   describes both `_SessionEventQueue` and the `_run_streams` channel behind
   `GET /v1/runs/{run_id}/events`, but I did not trace the TypeScript client in
   `apps/desktop` to see which one drives user-visible notifications. Settling it
   needs a search through the desktop renderer for the SSE endpoint it opens and
   the event names it switches on.

4. **Whether a crash and ANR producer should own its own queue registry or push
   into `_run_streams`.** This is a design question my read does not answer. What
   the read does establish is that `_SessionEventQueue` cannot be the target,
   because no handle to it escapes the request closure.

5. **Whether `agent-browser`'s `--cdp` accepts a page-level websocket at all.**
   The package docs say `--cdp` takes a port or a full websocket URL, and the
   examples all show browser-level endpoints. I found no statement either way
   about a page-level socket. Same experiment as item 1 would settle it.

6. **The complete list of `agent-browser` subcommands.** Section 1 lists the
   subcommands this repository invokes, which is what matters for reuse. The
   authoritative full command surface lives in the package's own `README.md` and
   `skill-data/core/references/commands.md`, outside this repo, and includes
   commands Hermes never calls, such as `connect`, `inspect`, `trace`, `profiler`,
   `state`, `diff` and `tab`.
