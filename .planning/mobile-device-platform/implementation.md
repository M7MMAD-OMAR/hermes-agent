# v1 implementation: what has landed, and what is left

Tracks the Roadmap section of [`design.md`](design.md) against the code. Update it in
the same commit that moves an item, or it becomes another stale plan.

## Landed

| Piece | Where | Evidence |
|---|---|---|
| Tier 0 detection, Tier 1 and 2 provisioning, license gate, on-device disclosure | `hermes_cli/tools_config_android.py` | `tests/hermes_cli/test_android_provisioning.py`, 13 tests |
| The provisioning surface | `hermes_cli/subcommands/device.py` (`hermes device status \| install \| list \| instrumentation`) | run live against this host and inside an Orbit session |
| `AndroidDeviceBackend(ComputerUseBackend)` | `tools/computer_use/device_backend*.py` | `tests/computer_use/test_device_backend.py`, 27 tests |
| Selection from the session's own source | `computer_use.surface` in config, read by `tool._new_backend` | env var kept as the test override |
| testID addressing through the tool | `schema.py`'s `test_id`, `tool._target`, `_element_to_dict` | refused with a clear error on a surface that addresses by index |
| The error-overlay guard | `device_backend_input.error_overlay`, applied in `_guarded` | a live render throw is caught, named, and the next action refuses |
| User documentation | `website/docs/user-guide/features/computer-use.md` | the device section, the config key and the on-device disclosure |
| `mobile_console` (Decision 3) | `tools/mobile_console.py` + `_cdp.py` + `_logcat.py`, toolset `device` | `tests/tools/test_mobile_console.py`, 33 tests; both channels verified live on a development build |
| Crash and ANR notifications | `tools/mobile_console_crash.py`, `mobile_console` actions `watch` and `exits` | a real native crash delivered a `watch_match` notification end to end |
| The device lease | `gateway/device_control_broker.py`, taken in `start()`, freed in `stop()` | `tests/gateway/test_device_control_broker.py`, 19 tests, including a subprocess contention test and a SIGKILL release |

Verified end to end through `handle_computer_use` against the Expo demo app on a
headless `Expo_API_36` emulator: capture (`som`, `ax`, `vision`), click by testID,
type, read back, key, scroll, focus_app, and the overlay guard.

## Not started

Each of these is a Roadmap line that has no code yet.

1. **The adb transport isolation** that the lease does not cover:
   `ADB_SERVER_SOCKET=localfilesystem:<short path>` per session. Note the prefix is
   `localfilesystem:`, not `unix:`, and never call `adb kill-server`. The lease already
   prevents the collision this would otherwise cause, so this is isolation for its own
   sake rather than a correctness fix.
2. **Screen capture for a panel** (Decision 1): `adb exec-out screenrecord
   --time-limit 0 --output-format=h264 -` decoded by Electron's `VideoDecoder`.
   scrcpy is the later stage, not the first one.
3. **`EmbeddedDevicePanel`** (Decision 5) beside the transcript, in the same family
   as `apps/desktop/src/app/chat/embedded-browser-panel.tsx`.


## Two things the live runs taught that are not in the spikes

**`emulator -accel-check` frames its verdict between bare marker tokens.** It prints
`accel:`, a status number, the human sentence, then `accel` again. Taking the last
non-empty line reports "accel" as the acceleration status.

**The browser broker's shape does not transfer whole.** `codebase-integration.md`
suggests copying `browser_control_broker.py` almost line for line. Its `dispatch`,
`complete`, `attach`/`detach` and cancel-frame ordering exist to talk to a controller
at the far end of a wire, and a device backend runs adb in this process, so copying
them would have produced code nobody calls. What did transfer is the ticket and scope
half. What had to be added is the part the browser broker does not need at all:
Hermes sessions are separate processes, so the authority is a kernel file lock and not
a dictionary. An in-process registry would have passed every test except the one that
matters, and reported success to every session.

**The push channel the design named is consumed by nobody.** Decision "crash and ANR
notifications" routes events into `_run_streams`, correcting an earlier draft that named
`_SessionEventQueue`. The desktop app contains no `EventSource` at all, so it does not
consume that SSE channel either, and building on it would have produced the same
outcome the correction was written to avoid. The channel that is actually consumed, by
the CLI, the gateway and the TUI alike, is the process registry's `completion_queue`
through watch patterns, which already rate limits a chatty match and caps it over a
session's life. A crash is exactly the "rare one-shot mid-process signal" those patterns
are documented for, so the watcher is a watched background process rather than new
plumbing. Verified end to end: `adb shell am crash` on the demo app produced a
`watch_match` notification naming the pattern and the line.

**`dumpsys activity exit-info` is metadata, never a trace.** The design left this open
and named it as needing a smoke test before the path was trusted. Measured on API 36:
every `ApplicationExitInfo` entry reports `trace=null`, including force stops and
crashes. So it answers "did it die, when, and why" and never "where". The stack for a
native crash comes from logcat's crash buffer at the moment it happens, which the
console already carries under the `AndroidRuntime` tag.

**Spike 5's network result did not reproduce, and the failure has the shape the design
already warned about for the console.** `spikes.md` records `Network.*` as verified
working on RN 0.86 with real request and response events captured. On this host, on a
development build of the demo app on Expo SDK 57 and React Native 0.86, `Network.enable`
returns ok and not one `Network.*` event ever arrives, while the app's own counter shows
nine completed requests. A raw listener attached directly to the target saw only
`Runtime.consoleAPICalled`, `Runtime.executionContextCreated` and `Log.entryAdded`. This
is the same trap the design names for `Runtime.enable`: an enable answering ok means the
inspector proxy accepted the command, not that the engine implements the domain. So the
tool reports the network channel live only once a request event has actually arrived.

**A React Native app reloads constantly, so a one-shot attach is not an attach.** Every
reload and every Metro restart replaces the target. The first version attached once and
fell back to logcat for the rest of the session after the first reload, which reads as
"CDP does not work on this app" and is not that. The CDP channel re-attaches on a two
second cycle, and that was verified by force-stopping the app mid-session.

**A ticket with no second party is a credential handed from a function to itself.**
Decision 4 asked for the lease to be "minted, consumed, and released" like the browser
broker's. That request assumed the remote-controller shape; with the backend calling
`acquire` and `release` directly there is nobody to hand a ticket to, and four passing
tests over an uncalled API read as validated rather than as unused. The ticket half was
written, then deleted. If the device panel ever hands a renderer a credential for a
device, that slice adds it back with a caller.

**The Orbit private display cannot host the packaged Electron app.** Orbit caps all
its jobs at 2 GiB and 512 tasks together, and with another agent's browser session
running there is not enough left: Electron fails `pthread_create` and the private
input helper cannot spawn. The app does start and render when the budget is free.
A terminal running the CLI fits comfortably and is the cheaper live check.
