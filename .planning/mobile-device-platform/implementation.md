# Implementation: what has landed, and what is left

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
| Maestro flow authoring and running (v2) | `hermes_cli/tools_config_maestro.py`, `tools/mobile_test.py` | 20 tests; a real flow passed and a deliberately wrong one failed, both live |
| Wireless pairing (Tier 2) | `pair_wireless` / `connect_wireless`, `hermes device pair \| connect` | 4 tests; no physical device on this host, so the adb exchange itself is unverified |
| The device panel (Decision 5) | `apps/desktop/src/app/chat/device-panel.tsx`, `tui_gateway/methods_device.py` | 11 vitest tests, the RPC pair driven live; the rendered panel is unverified |
| Screen recording (Decision 1, v1 stage) | `tools/mobile_record.py`, toolset `device` | `tests/tools/test_mobile_record.py`, 7 tests; a 6 second recording pulled and the device file removed |
| Lease-aware adb routing | `tools/computer_use/device_adb.py`, used by every adb caller | 6 tests, plus a live check that a leaseholder and a reader resolve differently |
| Crash and ANR notifications | `tools/mobile_console_crash.py`, `mobile_console` actions `watch` and `exits` | a real native crash delivered a `watch_match` notification end to end |
| The device lease | `gateway/device_control_broker.py`, taken in `start()`, freed in `stop()` | `tests/gateway/test_device_control_broker.py`, 19 tests, including a subprocess contention test and a SIGKILL release |

Verified end to end through `handle_computer_use` against the Expo demo app on a
headless `Expo_API_36` emulator: capture (`som`, `ax`, `vision`), click by testID,
type, read back, key, scroll, focus_app, and the overlay guard.

## One run over the whole surface

Done live against the demo app on a headless `Expo_API_36` emulator, in the order a
session would use it:

```
1 console   emulator-5554, the only device attached | cdp=True
2 capture   1080x2400, 38 elements on com.anonymous.hermesmobiledemo
3 act       confirmed: tap Button 'Increment'
4 lease     emulator-5554, leased by this session
5 console   1 error: [demo] error level message from the console screen
6 watch     proc_98024576e058
7 exits     5 recorded process exits
8 record    75025 bytes in 4.5s
9 release   lease returned, console detached
```

## Roadmap state

**v1 is complete.** Every line of it has code, tests, and a live run behind it.

**v2 is complete except for one item its own text makes conditional.** Network
visibility landed in v1 rather than v2, and stricter than specified: the gate the
roadmap describes is an RN version check, and what shipped reports the channel live only
once a request event has actually arrived, because the version check turned out not to
predict whether events come (see the spike-5 note below). Maestro authoring and wireless
pairing both landed.

**v3 cannot be built here.** It is contingent on a macOS Hermes build existing at all;
the iOS Simulator requires Xcode on macOS with no exception, and this is a Fedora
workstation. Nothing about it is blocked by the work above: the backend seams it extends
(`ComputerUseBackend`, the lease, the console's channel split) are all in place.

## Not started, and why each one is not merely undone

1. **The component tree, Redux and router bridge** (v2). The roadmap makes this
   conditional in its own sentence: "if real agent usage shows it is needed badly enough
   to justify a JS hook shipped into target apps". The condition has not occurred, and
   the cost is specific rather than vague: it means shipping a runtime hook into the
   user's own application source, which is the one thing every other piece here avoids.
   The device platform reads what the app already exposes; this would require the app to
   expose more. Build it when an agent's real usage names a case the accessibility tree
   and the console cannot answer.

2. **An iOS backend** (v3). Needs macOS. See above.

## Verified, and to what standard

Everything in the table above was driven against a real device except two things, and
both are named rather than implied:

- **The wireless pairing exchange.** There is no physical device on this host, so the
  code path is tested and the adb handshake is not. An emulator cannot stand in: it is
  reached over TCP already and never pairs.
- **The rendered device panel.** Its RPC pair was driven live and it carries 11 vitest
  tests, but the packaged Electron app cannot run inside an Orbit session under its
  2 GiB and 512-task budget while another agent holds one, and the person's own screen
  is not available to an agent. What has not been seen is the panel drawing itself.


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

**A per-session adb server is unverifiable for the case that matters, so the lease plus
one routing helper stands in its place.** Decision 4 proposed isolating the transport
with `ADB_SERVER_SOCKET=localfilesystem:<path>` per session alongside the lease. Two
servers do coexist, and both see an emulator, which is a TCP connection to a console
port. A USB device is not that: one adb server claims the interface exclusively, and a
second server is the ordinary way to make a physical device go offline for both. That
case cannot be tested on this host, and it is the one Tier 2 calls the true zero-install
path. Shipping it would mean the physical-device path is the only one nobody checked. So
what is isolated is routing: `tools/computer_use/device_adb.py` is the single place that
decides which serial a command talks to, and it prefers the session's own lease. That
also fixed a real bug: the console resolved "the device" independently, so a session
leased to one phone could read another one's logs.

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
