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

Verified end to end through `handle_computer_use` against the Expo demo app on a
headless `Expo_API_36` emulator: capture (`som`, `ax`, `vision`), click by testID,
type, read back, key, scroll, focus_app, and the overlay guard.

## Not started

Each of these is a Roadmap line that has no code yet.

1. **`DeviceControlScope` / `DeviceControlBroker`**, mirroring
   `gateway/browser_control_broker.py`. Today two sessions driving the same serial
   collide silently; the backend only refuses to *guess* between two attached
   devices. Decision 4's lease is what makes concurrent sessions safe.
2. **The adb transport isolation** that goes with it:
   `ADB_SERVER_SOCKET=localfilesystem:<short path>` per session. Note the prefix is
   `localfilesystem:`, not `unix:`, and never call `adb kill-server`.
3. **The `mobile_console` tool** (Decision 3) on `tools/browser_cdp_tool.py`'s path:
   CDP through Metro's inspector proxy merged with logcat, because
   `Runtime.consoleAPICalled` works in a development build and never fires in Expo
   Go. `prototype/mobile_console.py` is the working reference.
4. **Screen capture for a panel** (Decision 1): `adb exec-out screenrecord
   --time-limit 0 --output-format=h264 -` decoded by Electron's `VideoDecoder`.
   scrcpy is the later stage, not the first one.
5. **`EmbeddedDevicePanel`** (Decision 5) beside the transcript, in the same family
   as `apps/desktop/src/app/chat/embedded-browser-panel.tsx`.
6. **The crash and ANR pipeline** onto the existing `_run_streams` push channel. Note
   the class count: ANR is unreachable from JS under Hermes, so the useful classes
   are JS and native.

## Two things the live runs taught that are not in the spikes

**`emulator -accel-check` frames its verdict between bare marker tokens.** It prints
`accel:`, a status number, the human sentence, then `accel` again. Taking the last
non-empty line reports "accel" as the acceleration status.

**The Orbit private display cannot host the packaged Electron app.** Orbit caps all
its jobs at 2 GiB and 512 tasks together, and with another agent's browser session
running there is not enough left: Electron fails `pthread_create` and the private
input helper cannot spawn. The app does start and render when the budget is free.
A terminal running the CLI fits comfortably and is the cheaper live check.
