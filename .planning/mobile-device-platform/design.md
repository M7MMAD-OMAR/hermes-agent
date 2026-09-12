# Hermes as a mobile development platform: research and design

Status: research complete, **and validated against a real device**. Several
decisions below were reversed or materially corrected by that validation;
each carries a blockquote pointing at the spike that moved it. Read
[`spikes.md`](spikes.md) alongside this file, not after it.

Scope: Android first, on Linux. iOS is out of scope for this workstation and
is addressed only as a forward-looking extension (see "iOS and macOS scope").

This document was produced by a nine-strand research workflow (each strand an
independent agent doing primary-source reading, not a literature summary),
followed by an adversarial completeness pass that cross-checked the nine
strands against each other and against this repository's actual code. Five
real contradictions between strands were found and are resolved below. The
full per-strand findings, with citations, are kept in
[`sources.md`](sources.md) in this folder.

**Companion documents in this folder:**

| File | What it holds |
|---|---|
| [`spikes.md`](spikes.md) | Every empirical result, with the commands and numbers. The authority wherever it disagrees with this file. |
| [`codebase-integration.md`](codebase-integration.md) | Exact `file:line` attachment points in this repo, and two corrections to assumptions made here. |
| [`sources.md`](sources.md) | Per-strand external sources and citations. |
| `prototype/android_driver.py` | Working reference implementation of Decision 2, verified on a live device. |
| `prototype/mobile_console.py` | Working reference implementation of Decision 3's CDP client. |
| `prototype/metro_probe.py` | The spike 4 and 5 probe. |

**What changed when the design met the device**, in one table, because the
pattern matters: five of the eight original spikes moved a decision, and four
of those five moved it away from the option the research had called safe.

| Decision | Research said | Device said |
|---|---|---|
| 2, semantic control | raw `uiautomator dump` is the safe primary | it is SIGKILLed unprivileged on API 36; the Android CLI is the primary |
| 3, console | `Runtime.consoleAPICalled` over CDP | works in a dev build, never fires in Expo Go; needs both channels |
| 3, error detail | RedBox is structurally invisible | LogBox is fully readable as text, code frame included |
| 3, connections | exactly one debugger allowed, a hard constraint | the target advertises `supportsMultipleDebuggers: true` |
| crash classes | three classes: JS, native, ANR | ANR is unreachable from JS in RN; the class is real but catches nothing |
| 1, capture | scrcpy, vendored and version-pinned | `screenrecord` streams H.264 with zero dependencies, first byte in 0.13 s |

## Why this isn't a from-scratch feature

A full-repo search (`android`, `expo`, `emulator`, `adb`, `simulator`,
`mobile`) turned up nothing: Hermes has zero existing mobile code today. But
it already has four subsystems a mobile feature should extend, not duplicate.
Every decision below is written against one of these four seams.

**Seam 1, browser control over raw CDP.** `tools/browser_tool.py` talks to a
Chromium-family browser over the Chrome DevTools Protocol, not Playwright.
`hermes_cli/browser_connect.py`'s `launch_chrome_debug()` spawns a browser
with `--remote-debugging-port` and discovers the CDP endpoint via its `/json`
HTTP API. `tools/browser_tool_session.py`'s `_run_browser_command()` drives a
persistent per-session daemon over that connection for open/snapshot/click/
fill/console/errors/eval. Separately, `tools/browser_cdp_tool.py` speaks raw
CDP directly over a Python websocket to any configured endpoint, a completely
different code path from the daemon above. `gateway/browser_control_broker.py`
mints tickets scoped by `ControllerScope` (session_id, task_id, principal_id,
transport_family) so one browser session belongs to one caller at a time.
`apps/desktop/src/app/chat/embedded-browser-panel.tsx` docks the browser
beside the transcript with a mini tab strip; `right-rail/preview-console.tsx`
is a resizable console drawer with selectable log lines sendable back into
the composer.

**Seam 2, computer-use automation, already auto-installed by Hermes itself.**
`tools/computer_use/backend.py` defines `ComputerUseBackend(ABC)`: start/
stop, `capture()` returning a `CaptureResult`, `click`/`drag`/`scroll`/
`type_text`/`key` returning an `ActionResult`, `list_apps`/`list_windows`,
each `UIElement` carrying bounds that are nulled (not zeroed) when geometry
is unknown. `tools/computer_use/tool.py`'s `handle_computer_use()` dispatches
to the active backend, is permission-gated, and can route a screenshot
through an auxiliary vision model when an action fails. The concrete driver
is a small versioned native binary, `cua-driver`, that Hermes itself
downloads, installs, doctors, and self-updates as part of its own install
flow: `hermes_cli/tools_config_cua.py`'s `install_cua_driver()`, with a
contract-version check, an install/upgrade lock file with stale-lock
recovery, and a doctor self-test. This is Hermes's own precedent for "ships
with Hermes, auto-installs, auto-updates, doctors itself."

**Seam 3, multi-session discipline.** Several Hermes sessions run
concurrently on this machine. Browser automation already avoids fixed ports
and fixed profiles for exactly this reason. adb has the same shape of shared
global state: one server on `127.0.0.1:5037` for the whole machine by
default.

**Seam 4, this machine is Fedora/Hyprland, not macOS.** No window may ever
appear on the user's real desktop. The iOS Simulator requires Xcode on
macOS with no exception; see the dedicated section below.

## Decision 1: screen capture and input, for the docked device panel

> **Amended by spike 11. See `spikes.md`.** A v1 stage was inserted ahead of
> scrcpy. `adb exec-out screenrecord --time-limit 0 --output-format=h264 -`
> streams unlimited on-device-encoded H.264 over adb with **zero third-party
> dependencies**, verified working on this device. It gives the same
> on-device MediaCodec encode that is scrcpy's core value, decodable by the
> same Electron `VideoDecoder` this decision already specifies, with no
> vendored jar, no pinned wire protocol, and no provisioning step. scrcpy
> remains the right answer for what screenrecord cannot do (low latency,
> input injection over the same socket, audio, display rotation events), so
> it stays the Decision 1 primary for the finished feature. But v1 should
> ship on screenrecord and earn scrcpy, rather than taking on a vendored
> Apache-2.0 jar and a version-locked internal protocol before the panel
> exists. The numbers that justify the staging are in spike 11.

**Primary: scrcpy's on-device server plus a Hermes-native host client.**
scrcpy (Apache-2.0, actively maintained, `Genymobile/scrcpy`) needs no root
and no app installed on the device; it mirrors over an adb-forwarded socket.
Confirmed numbers: Android API 21+ minimum (API 30+ for audio), roughly
35 to 70 ms latency, about 1 second to first frame, default H.264 bitrate
8 Mbps. It already honors `ADB_SERVER_SOCKET` and `-s`/`--serial`, which is
exactly the per-session isolation Seam 3 needs (see Decision 4).

Do not ship scrcpy's own reference GUI client at all; run the server side
headless and write a small Hermes-native client that reads the raw video and
control sockets directly, decoding with Electron's own `VideoDecoder`
(WebCodecs). This repo's `apps/desktop/package.json` pins Electron 40.10.2, a
release with mature WebCodecs H.264 support, so one decoder covers Hermes's
case; the browser-portability layer that a general-purpose viewer like
ws-scrcpy needs (it ships four separate decoders to cover arbitrary
browsers) is not needed here.

scrcpy's own docs call its client/server wire protocol internal and
unstable, and the server refuses a mismatched client version. Do not fetch
"latest" scrcpy. Pin an exact `scrcpy-server.jar` and apply the same
contract-version/doctor/lock pattern already built for `cua-driver` in
`hermes_cli/tools_config_cua.py`, not a new mechanism. scrcpy is not present
in this machine's dnf repositories (`dnf info scrcpy` returns nothing), so
Hermes must own this provisioning step itself, the same way it already owns
`cua-driver`'s.

License note: scrcpy is Apache-2.0, not MIT. Vendoring `scrcpy-server.jar`
carries a NOTICE-retention obligation; ship the file alongside it.

**Reference only, do not vendor: `NetrisTV/ws-scrcpy`** (MIT). Good to read
for the browser-embedding approach, but its video/control core is a fork
frozen at scrcpy v1.19 (September 2021) against current v3.3.4 (December
2025), about five years and two major versions stale, and its own README
states there is no encryption or authorization on its WebSocket bridge.

**Rejected as primary: the Android Emulator's own `-grpc` channel, or
Cuttlefish's WebRTC path.** Google's own release notes call the gRPC
interface "experimental... meant for same-machine use only," its screen
RPCs read as screenshot-polling rather than confirmed continuous streaming
(unverified either way; the `.proto` source could not be fetched), and the
React embedding library (`google/android-emulator-webrtc`) looks dormant
(npm shows 1.0.18, two years stale, against a GitHub `package.json` that
already reads 2.0.1). Cuttlefish's WebRTC path is real but is a materially
different, heavier virtual-device backend than a normal Android Studio AVD,
and neither path has any physical-device story. **Flip condition:** revisit
only if the feature is ever deliberately scoped to emulator-only sessions
forever, which conflicts with the Android-first framing below (physical
devices matter too).

*Resolves a contradiction*: an earlier pass (the Radon IDE strand) proposed
building a bespoke in-house MJPEG-over-loopback-HTTP capture binary, mirroring
Radon's own proprietary architecture. The dedicated streaming-protocols
strand, going deeper on the same question with real license and latency
numbers, supersedes that: scrcpy is the primary, not the alternative.

## Decision 2: semantic device control (the mobile analogue of ref-addressed clicking)

An agent needs to address "the login button," not a pixel, the same
guarantee `browser_snapshot`'s ARIA refs already give for the browser and
`UIElement.bounds` gives for desktop automation.

> **Reversed by spike 1. See `spikes.md`.** This decision originally made
> `adb shell uiautomator dump` the primary and Google's Android CLI the
> spike-gated alternative, on the reasoning that the raw-adb path was the
> verified, zero-dependency one. Running it settled the question the other
> way: on Android 16 (API 36), `adb shell uiautomator dump` is SIGKILLed
> (rc 137) for the normal `shell` user and only succeeds after `adb root`.
> A physical device cannot be rooted by an ordinary user, so the
> "safe fallback" is the path that fails on exactly the hardware Hermes
> users will point it at. The text below is the corrected decision.

**Primary, verified on a running API 36 device: a new
`AndroidBackend(ComputerUseBackend)` built on `android layout` for reading
and `adb shell input tap/text/keyevent/swipe` for acting.** The read half
and the act half come from different tools, and that split is deliberate:
`adb shell input` was confirmed working as the unprivileged `shell` user in
the same spike that killed `uiautomator dump`, so the acting half keeps the
zero-dependency property the original decision wanted. Only the reading
half needs the CLI.

`android layout` returns JSON, one object per element, with these keys
observed on a real dump: `class`, `resource-id`, `content-desc`, `text`,
`interactions` (a normalized array such as `CLICKABLE`, `LONG_CLICKABLE`,
`FOCUSABLE`, `SCROLLABLE`), `bounds`, `center`, and `children` in tree mode.
`--flat` gives a flat list, `--full` includes non-interactive and hidden
elements, `--no-idle` skips the layout-idle wait, `--output` writes to a
file, and `--device` selects a serial. The precomputed `center` is a real
convenience: it is the tap point, so the backend never derives one from
`bounds`.

Map this into `tools/computer_use/backend.py`'s existing `UIElement` shape:
`role` from `class`, `label` from `text` or `content-desc`, `bounds` parsed
from the `[x1,y1][x2,y2]` string, an assigned index, and an `element_token`
for the same stale-detection contract the existing backend already uses.
Wire it into the existing `handle_computer_use` dispatch, permission gate,
and vision-routing fallback, not a parallel tool surface.

**Refs must be synthesized, not passed through.** Spike 1 confirmed
`resource-id` is stable across re-dumps and across navigation, but it is
present on only some elements (9 of 16 on the launcher screen) and is the
app's own resource identifier, so it is not unique: a list of rows sharing
one `testID` yields N identical `resource-id` values. Hermes therefore
keeps a per-snapshot ref table keyed on a tuple of
`(resource-id, text, content-desc, class, ordinal-within-duplicates)`,
exactly as `browser_snapshot` already does for ARIA refs, rather than
handing the agent a raw `resource-id`. This is the same contract, not a
weaker one.

**`android screen capture --annotate` plus `android screen resolve` is the
vision fallback, and it works.** Verified: `--annotate` writes a PNG with
labeled bounding boxes, and `screen resolve --screenshot shot.png --string
"tap #1 then #3"` returned `tap 1049 206 then 227 372`, substituting real
centers. This is functionally identical to Seam 2's existing
`_route_capture_through_aux_vision` fallback and covers the case the
original decision worried about: Compose, Flutter and RN surfaces that
expose a thin or empty accessibility tree.

**Two costs this path carries, both of which Hermes must own explicitly:**

1. **It installs an APK on the device.** The first `android layout` call
   printed `Installing layout instrumentation server...` and left
   `com.android.cli.interact.instrumentation` installed, registered as
   `com.android.cli.interact.instrumentation/.InstrumentationServer`. This
   is why it works unprivileged: it goes through the supported
   `am instrument` path rather than the blocked `uiautomator` binary. It is
   also a side effect on the user's device, so the device panel must
   disclose it, and the panel's cleanup action must be able to
   `adb uninstall com.android.cli.interact.instrumentation`.
2. **The CLI self-downloads.** See spike 9: the `android` in
   `cmdline-tools` is a launcher stub that fetches an 87 MiB binary on
   first use. Wrap it the way `tools_config_cua.py` wraps `cua-driver`'s
   installer: own progress reporting, lock file with stale-lock recovery,
   timeout plus tree-kill on cancel, doctor surfaced via `android info`,
   and `ANDROID_CLI_DOWNLOAD_URL` exposed in `hermes config` for mirrored
   or air-gapped installs.

**Keep the raw `uiautomator` reader as a documented fallback for old API
levels only.** It is not dead code: the kill was observed on API 36, and
older images may still permit it. But it is the fallback now, not the
primary, and Hermes must never present it as the safe default.

**Rejected candidates, with reasons that matter for future reference:**

| Candidate | Why not primary |
|---|---|
| `mobile-next/mobile-mcp` | Its own click tools are coordinate-only (`x,y`), a step backward from what Hermes already ships for the browser. |
| `mobilecli` (underlies mobile-mcp and mobilewright) | Functional Source License 1.1, Competing Use clause plausibly covers agent-driven accessibility-tree automation directly. Do not auto-install through Hermes's own pipeline without an explicit legal decision. |
| Appium + UiAutomator2 | Heaviest option by far: JDK 21, Node.js 20.11+, a persistent shared WebDriver server, an on-device instrumentation APK per session. Reintroduces the exact shared-server-state risk Seam 3 already disciplines for browsers. Reserve for a need Hermes does not have today (iOS real-device parity, or interop with an existing WebDriver test corpus). |
| Maestro | Apache-2.0, clean, genuinely semantic `id`/`text` selectors. But its only confirmed programmatic surfaces are running a YAML flow file or its bundled MCP server, not a raw per-action API a Python backend could wrap. See "UI test authoring" below; it is the right tool for a different job. |

## Decision 3: console, JS exceptions, and network from a running RN/Expo app

React Native DevTools (the rebuilt CDP-based debugger replacing Flipper)
shipped stable in **RN 0.76** (October 23, 2024), not 0.74; 0.74 is only
where Flipper's own scaffolding was removed. It attaches to Metro's
inspector proxy (`@react-native/dev-middleware`): `HTTP GET
http://<host>:8081/json/list` discovers debuggable pages, and the debugger
connects to that page's own `webSocketDebuggerUrl`
(`ws://<host>:8081/inspector/debug?device=<id>&page=<id>`). This is
structurally the same discovery-then-connect shape
`hermes_cli/browser_connect.py` already uses for a Chrome debug port.

> **Substantially revised by spikes 5, 13, 13b and 14. See `spikes.md`.**
> The CDP console channel works, but **only in a development build**. In
> Expo Go it never fires: with a listener attached and every console button
> fired, not one application log arrived, and the stream said why, in as many
> words: `The current JavaScript engine, HermesRuntime[RNBridgeless], does
> not support debugging over the Chrome DevTools Protocol.` In a real
> development build of the same app, every level arrived over
> `Runtime.consoleAPICalled` with full stack traces and that warning never
> appeared.
>
> **`Runtime.enable` returning `ok` proves nothing.** It means the inspector
> proxy accepted the command, not that the engine implements the domain. The
> `/json/list` metadata is byte-for-byte the same shape in both cases. Only
> behaviour distinguishes them.
>
> The channel matrix, every cell verified on a running app:
>
> | Signal | Expo Go | Development build |
> |---|---|---|
> | console, all levels, over CDP | **never fires** | **works, with stack traces** |
> | console, all levels, over `adb logcat -s ReactNativeJS` | works | works |
> | JS exceptions and unhandled rejections | logcat, and the LogBox tree | both, plus CDP |
> | error class, source file, line, code frame | `android layout --full` | same |
> | network requests and responses | CDP `Network.*` | CDP `Network.*` |
>
> **So Decision 3 implements both and chooses at runtime.** CDP is the better
> channel wherever it is available: structured arguments, real stack frames,
> source locations, none of which survive logcat's flattening to text. logcat
> is the channel that always works, and is the only one in Expo Go, which is
> how most people run an Expo project for the first time. The probe is
> cheap: attach, enable, and fall back to logcat if no
> `Runtime.consoleAPICalled` arrives in a short window while logcat is
> producing lines.

**Build a new `mobile_console` tool on `tools/browser_cdp_tool.py`'s raw
websocket path**, not on the external `agent-browser` Rust CLI that
`browser_console()` shells out to today via `browser_tool_session.py`'s
daemon. `browser_cdp_tool.py` already speaks CDP directly over Python's
`websockets` library to any configured endpoint; that is the correct
attachment point, kept fully under Hermes's own control rather than waiting
for upstream `agent-browser` to add React Native support (its docs mention
none today).

**Two connection requirements, both discovered the hard way, neither
optional:**

1. **The `Origin` header is mandatory.** Without it Metro's inspector proxy
   rejects the websocket handshake with **HTTP 401**. Metro's own log states
   the rule: the origin must be `http://127.0.0.1:<port>`, or its hostname
   must be one of `localhost`, `127.0.0.1`, `0.0.0.0`, `[::]`.
2. **The websocket host must match the origin host.** Using the
   `webSocketDebuggerUrl` from `/json/list` verbatim (it says `localhost`)
   while sending a `127.0.0.1` origin passes the origin check and then drops
   the socket with close code **1006 and no close frame**, which is
   indistinguishable from a crash. Rewrite the host to match the origin.

A working implementation of both, plus the event translation, is in
`prototype/mobile_console.py`.

Send `Runtime.enable`, `Log.enable`, and `Network.enable` (probing whether
the target actually implements it, see below), then listen for:

- **`Runtime.consoleAPICalled`**, the confirmed primary channel. React
  Native's own `ExceptionsManager.js` routes every uncaught synchronous
  exception through `console.error(data.message)` specifically so "DevTools
  handlers which patch console methods" see it, so this single event covers
  both ordinary logs and uncaught-exception detection. Unhandled promise
  rejections route through `console.warn` on a separate path with a built-in
  roughly 2 second engine-level debounce (an open RN issue confirms this);
  filter on `type IN {"error","warn"}`, not `"error"` alone.
- **`Log.entryAdded`**, referenced in Hermes's own inspector agent code.
- **`Network.requestWillBeSent`/`responseReceived`/`loadingFinished`/
  `loadingFailed`**, **verified working on RN 0.86 during spike 5**, with
  real request and response events captured. This was scoped to v2 behind an
  "RN >=0.83" gate; the gate is real but current Expo already clears it, so
  **network visibility moves into v1**. It is also, after spike 13, the only
  thing CDP is actually needed for. Probe with `Network.enable` and report
  "target does not implement the Network domain, requires RN 0.83 or newer"
  explicitly on older apps rather than silently returning an empty list. A
  filed bug (`facebook/react-native#54796`) reports Android response bodies
  missing as of the 0.83.0-rc.4 build; unresolved status not confirmed.

Treat `Runtime.exceptionThrown` as best-effort only; its RN/Hermes
implementation status could not be confirmed from a primary source.

**Not a hard constraint after all. Corrected by spike 4.** This document
stated that the JS engine allows exactly one CDP debugger connection at a
time, and built ticket-scoped ownership on that premise. The running target
says otherwise, in a machine-readable capability flag:

```json
"reactNative": {
  "capabilities": {
    "nativePageReloads": true,
    "nativeSourceCodeFetching": false,
    "supportsMultipleDebuggers": true
  }
}
```

**Read `reactNative.capabilities.supportsMultipleDebuggers` rather than
assuming.** Keep the `ControllerScope`-style ticket, mirroring
`gateway/browser_control_broker.py`, because it is still how Hermes stops two
of its own sessions fighting, and because older targets will report `false`.
But make it a policy the flag drives: an **exclusive** lease when the flag is
false, an **advisory** lease when it is true. Hardcoding exclusivity would
needlessly lock a developer out of their own React Native DevTools window on
a stack that supports sharing.

**Partly visible after all, see spike 14.** The LogBox overlay is readable
via `android layout --full`, so its message, class and source location are
not invisible. What remains genuinely invisible on the CDP channel: native
RedBox cases (JS not yet loaded, LogBox itself failing to render, a native
`RCTLogFatal`). These are exactly what Seam 2's screenshot-plus-aux-vision
fallback is for: when the debug websocket goes silent, fall back to a
screenshot of the device surface. See "Crash and ANR notifications" below
for the native-crash and ANR classes specifically.

**Cheaper alternative, investigated and almost certainly dead. See
`codebase-integration.md` and spike 5.** The hope was to point
`agent-browser`'s existing `console`/`errors` subcommands at the Metro debug
websocket via its `--cdp <ws_url>` flag. Three things came back against it:

1. **`agent-browser` has no source in this repo to adapt.** It is an
   external npm package pinned as `agent-browser@^0.26.0`
   (`tools/browser_tool.py:126`, upstream `vercel-labs/agent-browser`), and
   the published package ships prebuilt Rust binaries only.
2. **The failure is at bootstrap, one level before `console` ever runs.**
   Strings in the shipped 0.26.0 binary include `Target domain
   initialization attempt exceeded the remaining startup deadline`, `No
   webSocketDebuggerUrl in /json/version at`, and `No webSocketDebuggerUrl
   found in /json/list targets`. It expects a **browser-level** endpoint and
   discovers a page beneath it. Metro publishes only per-target page-level
   sockets and no `Target` domain above them, so the connection never
   reaches a state where `console` could dispatch.
3. **This repo's own CDP code makes the same assumption**, which is
   corroborating rather than decisive: `tools/browser_tool_cdp.py:31,41`
   resolves through `/json/version` to a `webSocketDebuggerUrl`, and
   `tools/browser_supervisor.py:354-363` runs `Target.getTargets`, picks
   `type=="page"`, then `Target.attachToTarget(flatten=True)`.

The evidence for (2) is `strings` output from a binary whose source is not
available, not a live experiment, so it is graded strong-but-not-proven. The
experiment that settles it is one invocation against a running Metro target,
and it is cheap. **Plan for the rewrite; run the experiment anyway, because
the cost of being wrong is a whole subsystem.**

**A correction that matters more than the above.** The research pass assumed
`browser_console()` was fed by the raw Python CDP path. It is not. That path
(`_cdp_call`, `tools/browser_cdp_tool.py:166-204`) **discards all CDP
events**, and the supervisor's event dispatch table
(`tools/browser_supervisor.py:410-412`) registers only five frame events and
three dialog events: **no `Runtime.consoleAPICalled` and no exception
event at all**. Console data reaches Hermes exclusively through the external
`agent-browser` daemon, in every configuration; `browser.cdp_url` only
changes that daemon's argv. The `ConsoleEvent` dataclass at
`tools/browser_supervisor.py:485-491` is populated by nothing.

So there is no existing `Runtime.consoleAPICalled` handler in this repo to
extend. Decision 3 is a **new event-subscribing CDP client**, not an
extension of one. That is more code than this document originally implied,
and it is better to know now.

**Scope boundary, stated plainly:** none of this buys component-tree,
Redux, or router-state inspection. Radon IDE's own equivalent features are
framework-specific JS-side bridges requiring a small runtime hook shipped
into the target app's own source (their `radon-ide` npm package), fitting
none of Hermes's four seams. Scope this as an explicit v2+ item (see
Roadmap), not a silent gap in the console tool's coverage.

## Decision 4: provisioning, in four tiers, matching the `cua-driver` pattern

Every tier below is modeled on `hermes_cli/tools_config_cua.py`'s install,
lock, doctor, contract-version pattern, not a new mechanism.

**Tier 0, detect (0 bytes).** Check `ANDROID_HOME`, then the deprecated
`ANDROID_SDK_ROOT`, then the OS default path (`$HOME/Android/Sdk` on
Linux), before downloading anything. This is the exact order `@expo/cli`'s
own `assertSdkRoot()` already checks, confirmed by reading its source
(`AndroidSdk.ts`) directly, so Hermes's doctor check should mirror it rather
than reinvent a resolution order. If the Android CLI binary is already on
`PATH`, `android info` prints the resolved SDK location in one call.

**Tier 1, guided minimal install.** Real numbers pulled directly from
Google's live package manifests (`dl.google.com/android/repository/`,
checked 2026-09-11, Linux x86_64, **download bytes**, see the caveat
below): platform-tools 9.05 MB, emulator package 519.7 MB, system image
`android-34;google_apis;x86_64` 1.56 GB, system image `android-36` 1.90 GB.
Build-tools (64.2 MB) is not needed; Hermes drives devices, it does not
compile APKs. **Minimal persistent download is about 2.1 GB for API 34
(default) or 2.5 GB for API 36.** Default to API 34's `google_apis` image
(not `google_apis_playstore`, smaller and faster-updated; Play Services is
unlikely to matter for UI-automation-style control). Google's Android SDK
license forbids redistributing the SDK or any system image; every tier here
is a live pull the user's own machine performs, exactly `cua-driver`'s own
posture (a separately-hosted installer, never a bundled binary), never
something Hermes vendors.

*Disk-size caveat, stated plainly rather than rounded off:* the figures
above are **download** sizes from Google's manifests, not installed size,
and specifically not an AVD's userdata partition after real first boot,
which grows further. Getting real installed-disk numbers needs an actual
install-and-measure pass (`du -sh` on the resulting SDK tree and on
`userdata.img` after one real boot); that pass was not done in this
research round and should happen before this number goes into any
user-facing copy. The same caveat applies to `cua-driver`'s own footprint,
the reference point this whole document compares against, whose installed
size is not stated anywhere in this repository either.

*License acceptance, a genuinely new step with no existing precedent:*
`hermes_cli/tools_config_cua.py` has no license or EULA acceptance
anywhere in it, because `cua-driver` does not have one. The Android SDK
does (a click-through EULA, the same one `sdkmanager --licenses` accepts
interactively). Design this as one explicit in-Hermes confirmation dialog,
shown once, presenting Google's Android SDK Terms of Service with an
Accept button before Tier 1 ever runs, the same shape as Xcode's or Android
Studio's own first-run EULA screen, not something silently accepted on the
user's behalf.

*Launch, specifically, uses the classic `emulator` binary, not the new
Android CLI:* the new CLI's `android emulator start` headless behavior is
unverified anywhere reachable in this research; the classic binary's flags
are fully confirmed straight from Google's own docs:
`emulator -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
-port <session-port> @<avd>`. Given Seam 3/4 treat "never a window on the
real desktop" as a hard constraint, do not route that one step through an
unverified code path. Use the new Android CLI for provisioning, inspection,
and doctor duties only, whose behavior is independently confirmed. If spike
1 fails and Decision 2 stays on the raw-adb backend permanently, and spike
3 also rules out the CLI for provisioning, fall back to `sdkmanager`/
`avdmanager` directly for Tier 1 (both Java tools, so this reintroduces the
JDK host dependency the CLI's small native-looking binary avoids); the
install-target list (platform-tools, emulator package, one system image, no
build-tools) stays the same either way.

*KVM doctor step:* run `emulator -accel-check` (needs no full boot) as the
first probe, falling back to `egrep -c '(vmx|svm)' /proc/cpuinfo` and
`/dev/kvm` group-ownership inspection. Treat "user is not yet in the `kvm`
group" as an expected first-run outcome on a fresh workstation, with a
clearly explained one-time `sudo usermod -aG kvm $USER` plus re-login, the
same shape as `cua-driver`'s own doctor self-test.

**Tier 2, physical device over adb (effectively 0 bytes beyond Tier 1's
platform-tools).** The true zero-install path. Wireless debugging
(Android 11+): `adb pair ipaddr:port` using a code shown on the device,
then LAN auto-reconnect over mDNS. Measured directly rather than assumed:
platform-tools alone is 8.64 MiB compressed, 22 MB on disk, adb itself
10.15 MiB. The pairing code is generated by the device and shown on
screen; Hermes cannot pre-know or automate it. The natural UI slot is a
docked "pair a device" prompt in the same family as the embedded browser
panel, asking the user to type the on-screen code, not any attempt at
silent pairing.

**Tier 3, remote/cloud device, documented fallback only.** BrowserStack App
Automate (about $199 to $249/month), BrowserStack App Live (about $39 to
$49/user/month), Firebase Test Lab (Spark: 5 free physical-device runs per
day; Blaze: 30 free device-minutes per day then $5/device-hour), Sauce Labs
Real Device Cloud (about $199/year, one parallel session). These are paid
services requiring the user's own account and billing. Hermes must never
auto-provision, store, or enter credentials for them, matching the same
rule that already governs financial credentials generally. If ever driving
one of these providers' own web UI is wanted, `tools/browser_tool_real_profile.py`
(the existing consented-real-profile browser engine) is the correct
mechanism, under the user's own logged-in session, not a new credential
surface.

**Waydroid, an opt-in smoke-test toggle, never a tier.** Container-based
(LXC plus the host kernel's `binder_linux` module, not a VM), a single
Android 13 base image, GPL-3.0 for the main repo. This machine already runs
a Wayland compositor (Hyprland) which Waydroid needs, but whether Fedora's
stock kernel ships `binder_linux` enabled was not confirmed. It has no
clean wipe/snapshot story equivalent to an AVD's `-wipe-data` (reset means
reinstalling the app, not restoring a factory image) and cannot validate
`minSdk`/`targetSdk`-specific behavior. Offer it as a separate, clearly
labeled "fast sanity check" toggle beside the real emulator tier, never as
a substitute for it.

### Session isolation, and the AVD-reuse fix

*Resolves a contradiction*: one line of research proposed isolating each
session's `ANDROID_USER_HOME` (the directory holding AVD definitions and
userdata images) the same way a browser session gets its own profile
directory. That is wrong and self-defeating: `ANDROID_USER_HOME` is exactly
where the user's own Android-Studio-created AVDs live, so redirecting it
per session makes `emulator -list-avds` see zero AVDs in that session,
and every Hermes session would silently create and store its own copy,
precisely the duplicated-downloads-and-disk-space outcome the whole
provisioning design exists to avoid.

**The fix:** keep `ANDROID_USER_HOME` shared, pointed at the user's real
`~/.android`, so existing AVDs stay visible to every session. Isolate only
two things:

1. **The adb transport**, per session, via a short-path unix domain socket
   under `XDG_RUNTIME_DIR/hermes/`, `ADB_SERVER_SOCKET=localfilesystem:<path>`.
   This was confirmed both by reading AOSP's `client/commandline.cpp`
   directly and by an empirical test on this machine: a default server on
   port 5037 and an isolated one on 5038 ran as two distinct PIDs, and
   killing the isolated one left the default server (and its PID) untouched.
   `ADB_SERVER_SOCKET`'s correct prefix on this build is `localfilesystem:`,
   not `unix:`; the latter fails outright. Keep the socket path short
   (AF_UNIX caps `sun_path` at 108 bytes on Linux). This matches the
   existing `sbar-orbit` broker-socket convention on this machine more
   closely than TCP-port allocation, and reuses `tools_config_cua.py`'s
   stale-lock-recovery pattern for the socket file `kill-server` leaves
   behind. **Never call `adb kill-server`** from Hermes automation; it tears
   down the shared server for every client on the host, not just the caller.
2. **Device/AVD ownership**, via a lease, not a directory. adb has no
   built-in mutual exclusion beyond `-s`/`ANDROID_SERIAL` (pure routing) and
   the newer `--one-device` flag (restricts one *server* to one device, but
   does nothing about a second, independent session's server also
   targeting that same serial). Add a `DeviceControlScope` ticket, keyed on
   session_id/task_id/principal_id plus the device serial, minted, consumed,
   and released through the same shape as
   `gateway/browser_control_broker.py`'s `BrowserControlBroker`, with
   `-s serial` as the routing primitive once a ticket is granted.

AVD-instance port isolation (each launched AVD claims its own console+adb
port pair from the pool `5554` to `5682`, 64 concurrent instances, via
`-port`) is orthogonal to the above and is ready to use as-is.

### Device management commands, verified against primary sources

| Action | Command |
|---|---|
| List devices | `adb devices -l` |
| Uninstall app | `adb shell pm uninstall [-k] [--user user_id] <package>` |
| Clear app cache/data | `adb shell pm clear <package>` |
| Force-stop app | `adb shell am force-stop <package>` (note: `am`, the activity manager, not `pm`; an earlier draft of this research had this wrong) |
| List AVDs | `avdmanager list avd` (`avdmanager` itself is documented as deprecated in favor of the new `android` CLI) |
| Create AVD | `avdmanager create avd -n <name> -k "system-images;android-34;google_apis;x86_64" -d <device>` |
| Delete AVD | `avdmanager delete avd -n <name>` |
| Wipe/factory-reset AVD | `emulator -wipe-data @<avd>` (destructive) |
| Pin one device | `adb -s <serial> <command>`, or `$ANDROID_SERIAL` |
| Pin one adb server | `adb -P <port>`, confirmed against the AOSP `adb.1` man page (`ANDROID_ADB_SERVER_PORT` is repeated across blogs but was not found in that primary source; treat `-P` as the confirmed lever) |

These are the exact primitives the device panel's buttons below call.

## Decision 5: the device panel inside Hermes

No existing strand designed this; it is the one genuinely new piece of work
this research did not cover by extending a backend seam, because it is a
frontend, not a backend, concern. It is modeled directly on the two panels
already in this repo, read in full for this section:
`apps/desktop/src/app/chat/embedded-browser-panel.tsx` and
`apps/desktop/src/app/chat/right-rail/preview-console.tsx`.

**`EmbeddedDevicePanel(sessionId, surfaceId)`**, same gate shape as
`EmbeddedBrowserPanel`: subscribes to one atom (`$embeddedDeviceSessions`),
renders nothing until this conversation actually has a device attached, and
the same "lead host" rule so a conversation shown twice on screen renders
its device stream in exactly one place. Docked beside the transcript, same
side (never a band across the top, for the same reason the browser panel
gives: the transcript needs its scrollback and the device stream needs its
vertical run), same resizable seam with a stored width fraction, same
`rtl:flex-row-reverse` handling.

**Above the stream, a device-picker strip** (the mobile analogue of the
tab strip in `EmbeddedTab`): each entry is either a running AVD, an
available-but-unbooted AVD, or a connected physical device (three visually
distinct chip states), plus an agent-ownership indicator identical to the
existing `tab.agent` flag and hubot icon. Selecting an entry is the
**switch-device action**: release the current `DeviceControlScope` ticket
and adb lease (does not stop the AVD or disconnect the phone, only detaches
Hermes's own control of it), attach the new one, re-point the scrcpy client
and the CDP mobile-console listener at the new target. A `+` button opens
device creation: an AVD-profile picker sourced from `avdmanager list
device`, defaulting to the same curated profile Tier 1 provisioning uses
rather than exposing the full matrix by default, with a "more options"
disclosure for RAM/resolution/DPI/orientation for users who want it
("customize the device," as asked).

**The stream itself** is the scrcpy/WebCodecs client from Decision 1,
filling the panel body the way `PreviewPane` fills the browser panel's body,
with the same "nothing attached yet" empty state.

**A device-console drawer**, modeled directly on `PreviewConsolePanel`:
same resizable bottom drawer, same per-entry level coloring (log/info/warn/
error), same selectable rows sendable back into the composer as a fenced
block via `requestComposerInsert`, same copy/clear actions. Feeds from the
`mobile_console` tool's buffered `Runtime.consoleAPICalled`/`Log.entryAdded`
events (Decision 3) plus the crash/ANR events described next, each tagged
by its signal class so the drawer can color a native crash differently from
a JS console.error.

**A device-actions menu** (three-dot overflow beside the picker, since
these are occasional actions, not primary navigation): "Clear cache" (`pm
clear`), "Wipe data" (`emulator -wipe-data`, with a confirmation, since it
is destructive), "Force stop" (`am force-stop`), "Reinstall app," "Try on
another device" (the same switch-device flow above, pre-filtered to devices
not currently running the target app), each a thin wrapper over the table
in Decision 4, each going through the same permission-gate
`handle_computer_use()` already applies to desktop automation, so a
destructive action is never silent.

**A "pair a device" entry point** for Tier 2's wireless-debugging flow: a
small dialog asking the user to type the on-screen IP:port or pairing code,
matching the shape of Android Studio's own QR/pairing dialog, never an
attempt at silent or automatic pairing (the code is generated by the device
and cannot be predicted).

## Crash and ANR notifications: three distinct signal classes

The user's "any error in the app, it shows it, gives a notification"
requirement is really three different signals with three different
detection channels; treat them as distinct rather than one generic "error"
event, the same way Sentry's own Android SDK keeps them distinct internally
(`UncaughtExceptionHandlerIntegration`, `AnrIntegration`, `NdkIntegration`,
noted here only for calibration, not as something to build on).

1. **JS exception (sync uncaught, or unhandled promise rejection).
   Corrected by spikes 13, 13b and 14: `Runtime.consoleAPICalled` is right
   for a development build and useless in Expo Go.** Where it works it is
   the best channel available, carrying full stack frames. Where it does not,
   these two do, both verified against a real thrown exception and a real
   unhandled rejection:

   - **`adb logcat -s ReactNativeJS`**, which gives the earliest signal and
     the correct level. An unhandled rejection arrives verbatim as
     `E ReactNativeJS: [Error: Uncaught (in promise, id: 0) Error: ...]`.
     Levels map directly onto the existing console vocabulary: `I` to
     log/info, `W` to warn, `E` to error. The one parsing cost is that a
     multi-line structured object arrives as N separately tagged lines and
     must be reassembled by continuation indent.
   - **The LogBox overlay, read with `android layout --full`** (spike 14),
     which gives what logcat cannot: the error class (`Console Warning`,
     `Uncaught Error`), the pending-error count (`Log 1 of 2`), and the
     **source file, line, column and surrounding code frame**. This document
     previously assumed the overlay was structurally invisible and needed a
     vision fallback. It is plain text in the accessibility tree.

   **The overlay is also an action blocker, and this is the part that will
   cause silent bugs if missed.** During spike 14 a LogBox overlay swallowed
   two navigation taps: `input tap` returned 0, the coordinates were real,
   and nothing happened, because the overlay was on top. **The device
   backend must check for the overlay before reporting any action
   successful**, the same way a browser backend checks for a modal dialog.
   The overlay's own controls carry no `resource-id`, only content
   descriptions (`Dismiss`, `Minimize`, `Copy`, `See N more frames`), so
   they are addressable by content-desc.

2. **Native crash.** No root needed: a persistent per-session
   `adb logcat -b crash` tail, matching `AndroidRuntime E "FATAL
   EXCEPTION: <thread>"`. For the trace body, prefer
   `ActivityManager.getHistoricalProcessExitReasons()` /
   `ApplicationExitInfo.getTraceInputStream()` (Android 11/API 30+, no
   root) over `adb pull /data/tombstones/...` (root-gated); fall back to
   `adb bugreport` (no root, heavier, multi-minute) if that trace comes
   back incomplete. Whether `adb shell dumpsys activity exit-info
   <package>` exposes full trace text or only metadata was not confirmed
   and needs a smoke test against a real crashed app before this path is
   trusted as primary.

3. **ANR (Application Not Responding). Corrected by spike 6: this class
   does not catch the failure React Native actually has.** The mechanism
   described below is correct for a genuinely blocked native UI thread:
   a no-root `adb logcat -b events` tail matching the structured `am_anr`
   tag, plus human-readable `ActivityManager E "ANR in <package>"` in the
   main buffer, with the `ApplicationExitInfo` trace-body path
   (`REASON_ANR`) and `adb bugreport` as fallback since roughly 30 percent
   of `ApplicationExitInfo` ANR traces are reported incomplete in practice.

   **But it will almost never fire for an RN app.** The fixture blocked the
   JavaScript thread for 12 seconds. The UI stayed fully responsive to the
   accessibility layer the whole time (`android layout` returned in 0.9 s at
   t+4, t+8, t+12 and t+15 seconds) and `logcat -b events` recorded no
   `am_anr`, no `am_crash`, no `am_proc_died`. Under Hermes the JavaScript
   thread is not the Android UI thread, so an RN app can be completely
   wedged from the user's point of view while Android considers it perfectly
   healthy.

   **Keep the ANR watcher, and do not claim it covers "the app froze".** The
   RN freeze case needs a different signal: the JS thread stops responding
   while the view tree keeps rendering. A liveness probe over the debugger
   channel, or watching for the app's own UI to stop changing while input is
   still accepted, are the candidates. **Neither is designed yet, and this is
   an open gap rather than a solved problem.**

**Transport, corrected. See `codebase-integration.md`.** The research pass
named `_SessionEventQueue` in `gateway/platforms/api_server.py` as the push
channel to reuse. **That is the wrong object.** `_SessionEventQueue` is
constructed inside a request closure (`api_server.py:3105`) and is not
reachable from an out-of-band producer, which is exactly what a logcat tail
or a CDP listener is. A crash arriving from a background task has no handle
on it.

The reachable channel is the `_run_streams` registry
(`api_server_runs.py:428`, with the publish path at `:145-165`). Both the
mobile CDP listener and the adb-logcat tail should emit their named events
(`app.error` / `device.crash` / `device.anr`) there, which keeps the intent
of the original decision (reuse the existing push path, do not invent a
second one, do not poll) while pointing at the object that can actually be
reached from outside a request.

This correction is load-bearing: building against `_SessionEventQueue` would
have produced a notification pipeline that works in a unit test and never
fires in production.

**One scoping detail that will silently break if missed:** in Expo Go (as
opposed to a development build), the developer's JS bundle runs inside the
`host.exp.exponent` process, not a package named after the developer's own
app. Any package-name-scoped logcat or `dumpsys` filtering must special-case
this or it watches the wrong process and reports zero errors for a real
Expo Go session.

## UI test authoring

Requirement 3 explicitly asks for writing UI tests, a distinct deliverable
from live imperative control. **Maestro** (Apache-2.0, clean license
end to end, confirmed by reading its `LICENSE` file directly) is the right
tool for this specifically: a YAML flow is itself a portable, human- and
CI-readable artifact, using `id`/`text` accessibility selectors rather than
hand-rolled refs. It is not the primary imperative backend (Decision 2
covers that; Maestro's only confirmed programmatic surfaces are running a
flow file or its bundled MCP server, not a raw per-action API). Offer it as
an **opt-in** authoring path: the agent writes and runs Maestro flows,
accepting the JDK 17+ host dependency (not sized or checked against what is
already on this machine) only when that specific feature is used, not as
part of the core provisioning tiers.

## Network visibility and component/state inspection: explicit scope, not a silent gap

Two sub-pieces of "see anything happening in the app" are named here and
deliberately deferred, rather than silently dropped:

- **Network requests** are covered only for RN >=0.83 via the CDP `Network`
  domain (Decision 3). Older RN apps, and native (non-RN) Android apps
  entirely, have no covered path in this design. A general Android-agnostic
  approach (an `adb reverse` proxy plus a local CA, the platform-level
  analogue of Radon's own OkHttp-hooking approach) is out of scope for v1
  and would need its own research pass.
- **Component-tree, Redux, and router-state inspection** (what Radon IDE
  ships as `view_component_tree` and its Redux/React Query devtools) fits
  none of the four seams; it needs a small JS hook shipped into the target
  app's own source, mirroring Radon's `radon-ide` npm-package approach.
  Scope as an explicit v2+ milestone.

## iOS and macOS scope

The iOS Simulator requires macOS categorically, not just as today's
practical default. It ships bundled inside Xcode, which Apple distributes
for macOS only; Appium's own XCUITest driver documentation states flatly
that simulators can only run on macOS even in its one guide meant to relax
that requirement (that guide's carve-out covers real devices only, and even
then needs a Mac at least once to build and sign WebDriverAgent). The
restriction is layered: legal (macOS's license ties installation to
Apple-branded hardware, upheld in *Apple Inc. v. Psystar Corp.*, 9th Cir.
2011) and technical (the Simulator runs Darwin-native code directly on the
Mac's own CPU rather than translating instructions, unlike the Android
Emulator's portable QEMU/KVM stack).

**Ship Android-first on Linux now.** A future macOS Hermes build would
mostly extend today's design rather than redesign it: `ComputerUseBackend`
gains an iOS-flavored backend (`xcrun simctl` for lifecycle,
**WebDriverAgent** for a ref-addressed accessibility-tree control surface,
the same shape as Decision 2's Android choice, since WDA's XCUITest
hierarchy is the same kind of stable-ref tree as the CDP ARIA snapshot), the
ticket-scoped broker extends to per-session simulator ownership (a single
per-user `CoreSimulator` daemon manages every booted simulator on a Mac,
the same shared-resource hazard as the fixed adb port), and `cua-driver`'s
install/doctor/lock lifecycle applies to a vendored WebDriverAgent build
(not to `simctl` itself, which ships inside Xcode and cannot be
independently fetched or versioned).

**One thing needs to change today, before v1 ships, not later:** any
Android-specific naming at the tool-function and docked-panel surface
should be platform-neutral now (`device_console`, not `android_console`;
`EmbeddedDevicePanel`, not `EmbeddedAndroidPanel`), because that naming
leaks into the agent-facing tool contract and into saved conversation
state. Renaming it after v1 ships breaks existing transcripts; naming it
correctly from the start costs nothing.

## Spikes required before implementation

These are five- to thirty-minute empirical checks the research could not
complete without a running device, listed so none of them get silently
assumed away during implementation:

1. Does `android layout`'s `resourceId` survive a re-dump as a stable
   identifier? Decides whether Decision 2's primary is the Android CLI or
   the raw-`uiautomator`-dump fallback.
2. Does `android emulator start` default to headless, or expose a
   documented no-window-equivalent flag? Until confirmed, launch stays on
   the classic `emulator` binary regardless of the answer to (1).
3. Does `android sdk install` accept the classic
   `system-images;android-XX;google_apis;x86_64` coordinate, or does it
   need its own syntax for system images specifically? Run `android sdk
   list` at install time to discover the accepted form rather than
   hardcoding one.
4. Does Metro's `/json/list` indicate an already-attached debugger (a null
   `webSocketDebuggerUrl`, the way Chrome's own listing does)? Decides
   whether the one-CDP-connection constraint in Decision 3 can be
   pre-flight-detected or only attach-and-fail.
5. Does `agent-browser`'s `console`/`errors` subcommands work at all when
   `--cdp` points at a target lacking `Page`/`DOM`/`Target` domains? If
   yes, it replaces most of Decision 3's new Python code.
6. Does `adb shell dumpsys activity exit-info <package>` return full crash/
   ANR trace text or only metadata? Decides whether it or `adb bugreport`
   is the primary trace-body source in the crash-notification design.
7. Real installed-disk numbers: `du -sh` on an actual Tier 1 install
   (SDK tree, plus an AVD's `userdata.img` after one real boot), to replace
   the download-byte figures in Decision 4 with the number requirement 1
   actually asked for.
8. Whether Fedora's stock kernel ships `binder_linux` enabled, needed for
   the optional Waydroid smoke-test toggle.

## Roadmap

**v1, Android-first on Linux.** Tier 0 to Tier 2 provisioning (Decision 4)
behind a new `hermes_cli/tools_config_android.py`, mirroring
`tools_config_cua.py`'s structure exactly. A new `AndroidBackend
(ComputerUseBackend)` (Decision 2, safe fallback first, Android CLI once
spike 1 passes), wired into the existing `handle_computer_use` dispatch. A
new `DeviceControlScope`/`DeviceControlBroker` mirroring
`browser_control_broker.py`. The `mobile_console` tool (Decision 3) on
`browser_cdp_tool.py`'s path. scrcpy-backed screen capture (Decision 1),
rendered in the new `EmbeddedDevicePanel`/device-console drawer (Decision
5). The three-class crash/ANR notification pipeline onto the existing
`_run_streams` push channel (see the transport correction above).
Platform-neutral naming from day one.

**v2.** Network-domain visibility gated to RN >=0.83, with an explicit
"unsupported" message on older apps rather than a silent empty result.
Maestro-based UI-test authoring, opt-in. Wireless-pairing dialog polish.
Component-tree/Redux/router bridge, if real agent usage shows it is needed
badly enough to justify a JS hook shipped into target apps.

**v3, contingent on a macOS Hermes build existing at all.** An iOS backend
extending the same four seams: `ComputerUseBackend` gains a
WebDriverAgent-backed implementation, the broker extends to
`CoreSimulator` session ownership, `cua-driver`'s install/doctor lifecycle
wraps a vendored WebDriverAgent build.
