# Spike results

Empirical answers to the eight spikes listed at the end of `design.md`.
Every verdict here was produced by running the command on this host, not by
reading documentation. Where a verdict contradicts `design.md`, the
corresponding Decision in that file is edited in the same change.

## Host used for these spikes

| | |
|---|---|
| OS | Fedora 44, kernel 7.1.12-200.fc44.x86_64 |
| SDK | `~/Android/Sdk`, 7.7 GiB installed (full Android Studio install) |
| cmdline-tools | 22.0 |
| Android CLI | 1.0.16261425 (see spike 9) |
| adb | 1.0.41, platform-tools 37.0.1 |
| AVD | `Expo_API_36`, android-36 google_apis x86_64 |
| KVM | `/dev/kvm` present, mode 0666, so no group membership needed |
| Free disk | 538 GiB on `/home` |

This host is a Tier 3 machine in `design.md`'s taxonomy (everything already
installed), which is the right place to measure reuse but the wrong place to
measure a cold Tier 0 install. Tier 0 numbers stay projections.

---

## Spike 9 (new, not in the original list): what `cmdline-tools/latest/bin/android` actually is

This one was not planned. It has to be recorded first because spikes 1, 2 and
3 all depend on it and because it changes Decision 4.

**`$ANDROID_HOME/cmdline-tools/latest/bin/android` is not the Android CLI.**
It is a 4.9 MiB Rust launcher stub (built from
`tools/vendor/google/android/launcher.rs`, linked against `ureq` and `rustls`)
whose only job is to download the real CLI on first invocation. Strings
recovered from the binary:

```
https://dl.google.com/android/cli/latest/
linux_x86_64
android-cli
ANDROID_CLI_DOWNLOAD_URL
ANDROID_CLI_FRESH_INSTALL
ANDROID_CLI_LAUNCHER_VERSION
ANDROID_CLI_LAUNCHER_PID
ANDROID_CLI_LAUNCHER_PATH
ANDROID_USER_HOME
Failed to find user home directory and ANDROID_USER_HOME is not set
Downloading Android CLI...
version=1.0.15498356          (the launcher's own version)
```

On this host the first invocation downloaded an 87 MiB binary to
`~/.android/bin/android-cli` and then exec'd it. The real CLI reports
version **1.0.16261425**.

Three consequences for Hermes, all of them Decision 4 changes:

1. **First run needs the network and gives no output on a non-tty.** Two
   20-second probes and a 120-second probe all returned zero bytes and looked
   like a hang. It was an 87 MiB download with progress written only to a tty.
   Hermes must run this once, deliberately, inside its provisioning step with
   its own progress reporting, exactly the way `_run_cua_driver_installer`
   already does, and never let it happen lazily inside an agent tool call.
2. **The install path is `$ANDROID_USER_HOME/bin/android-cli`.** This is the
   same variable Decision 4 already resolved to keep shared rather than
   per-session, so the fix made for AVD reuse also covers the CLI. A
   per-session `ANDROID_USER_HOME` would have re-downloaded 87 MiB per
   session.
3. **`ANDROID_CLI_DOWNLOAD_URL` is an override.** An air-gapped or
   proxy-restricted Hermes install can point this at an internal mirror,
   which is the only offline story the CLI has. Worth exposing in
   `hermes config` rather than discovering later.

**Verdict: the Android CLI is real, is on this host, and works. It is also a
network-dependent self-downloader, which is a provisioning constraint
`design.md` did not account for.**

---

## Spike 1: is `android layout`'s element identifier stable, and is the raw-adb fallback actually safe?

This spike was written to decide whether Decision 2's primary stays on raw
`adb shell uiautomator dump` or flips to the Android CLI. It answered both
halves, and it flipped the decision.

### 1a: stability of `resource-id`

Two consecutive `android layout --flat --pretty` dumps of an untouched
screen were **byte-identical**. A third pair, taken before and after real
navigation (`input keyevent KEYCODE_APP_SWITCH`, then `KEYCODE_HOME`),
produced the same element count and the identical set of `resource-id`
values.

**`resource-id` is stable. It is not sufficient.** On the launcher screen,
16 elements carried only 9 `resource-id` values; the other 7 had none. The
keys actually present, with coverage:

| Key | Coverage |
|---|---|
| `class` | 16/16 |
| `bounds` | 16/16 |
| `center` | 16/16 |
| `interactions` | 15/16 |
| `content-desc` | 14/16 |
| `resource-id` | 9/16 |
| `text` | 8/16 |

There is **no opaque per-element handle** in the output. `resource-id` is
the app's own Android resource identifier, so it is stable by construction
but not unique: a `FlatList` whose rows share one `testID` produces N
identical values. Decision 2 now specifies a synthesized per-snapshot ref
table rather than passing `resource-id` through.

### 1b: is the raw-adb fallback actually available?

**No, not on current Android.** On this API 36 (Android 16) image:

```
$ adb shell uiautomator dump /sdcard/ui.xml
Killed
RC=137
```

rc 137 is SIGKILL. It fails as the ordinary `shell` user for every path
tried (default, `/sdcard`, `/data/local/tmp`). The binary is present and
executable at `/system/bin/uiautomator`. After `adb root`:

```
$ adb shell uiautomator dump /data/local/tmp/ui.xml
UI hierchary dumped to: /data/local/tmp/ui.xml
RC=0
```

So the tool works only with root. A physical device cannot be rooted by an
ordinary user, which means the "verified, zero-dependency, zero-license-risk
fallback" fails on exactly the hardware Hermes users will attach.

Importantly, only the **reading** half is affected. `adb shell input
keyevent` and `adb shell input text` both returned RC=0 as the unprivileged
`shell` user in the same session. Decision 2 therefore splits the two:
`android layout` reads, `adb shell input` acts.

### 1c: does the visual fallback work?

Yes, both halves. `android screen capture --annotate --output shotA.png`
wrote a 1.8 MiB annotated PNG, and:

```
$ android screen resolve --screenshot shotA.png --string "tap #1 then #3"
tap 1049 206 then 227 372
```

The `#N` labels resolve to real element centers. This is a working
equivalent of Seam 2's `_route_capture_through_aux_vision` fallback.

### 1d: what it costs

The first `android layout` call printed `Installing layout instrumentation
server...` and left a package behind:

```
package:com.android.cli.interact.instrumentation
instrumentation:com.android.cli.interact.instrumentation/.InstrumentationServer
```

That instrumentation server is *why* it works unprivileged: it uses the
supported `am instrument` path instead of the blocked `uiautomator` binary.
It is also a durable change to the user's device, so it has to be disclosed
in the device panel and removable from it.

**Verdict: Decision 2 is reversed. `android layout` is the primary reader,
`adb shell input` stays the actor, raw `uiautomator` is demoted to an
old-API-level fallback.**

---

## Spike 2: does `android emulator start` run headless?

**No. There is no headless flag.** The complete option surface:

```
Usage: android emulator start [-h] [--cold] <device>
  --cold    Starts the emulator without loading from a snapshot.
```

`--cold` is the only behaviour switch. The sibling commands are `create`,
`stop`, `list` and `remove`; `create` takes only a device profile name and
`--list-profiles`.

**Verdict: confirms `design.md`'s existing decision. Launch stays on the
classic `emulator` binary so Hermes can pass `-no-window`, which is
non-negotiable here: this workstation's `AGENTS.md` forbids an agent putting
a window on the person's screen.** The Android CLI is still usable for
`layout`, `screen` and `sdk`; it is simply not usable as the launcher.

This was confirmed the expensive way. `android emulator start Expo_API_36`
booted the device successfully in 25 seconds, and put a window titled
`Android Emulator - Expo_API_36:5554` on the user's Hyprland desktop. It
was killed immediately. **The CLI is not merely missing a headless flag, it
defaults to windowed with no way to opt out**, which makes it unusable as a
launcher for any agent bound by this machine's rules.

Follow-on worth recording: `android emulator start` claims to "return when the
emulator is fully started and ready to use", which is a real convenience the
classic binary lacks (it forks and leaves you polling
`sys.boot_completed`). If Hermes launches with the classic binary, it owns
that readiness poll itself.

---

## Spike 3: what package coordinate does `android sdk install` accept?

**Slash-separated, not the classic semicolon form.** `android sdk list` on
this host prints the installed system image as:

```
Installed packages:
  system-images/android-36/google_apis/x86_64   7.0.0   Google APIs Intel x86_64 Atom System Image
```

not `system-images;android-36;google_apis;x86_64`, which is what `sdkmanager`
uses and what `design.md` assumed. The install grammar is
`android sdk install <package>[@<version>]`, so a version is pinnable, and
`--platform=<os>_<arch>` allows provisioning for a host other than the current
one.

**Verdict: answered. Hermes must not hardcode the semicolon coordinate for
the CLI path.** The safe implementation is the one `design.md` already
prescribed: run `android sdk list` at provisioning time and match the printed
form, because the two tools disagree and Hermes may end up calling either.

---

## Spike 7: real installed disk, replacing the download-byte figures

Measured with `du -sh` on this host.

| Component | On disk |
|---|---|
| `platform-tools` | 22 MiB |
| `cmdline-tools` | 174 MiB |
| `emulator` | 821 MiB |
| one system image (android-36 google_apis x86_64) | 4.3 GiB |
| **Tier 1 subtotal** | **5.26 GiB** |
| `android-cli` (spike 9) | 87 MiB |
| **Tier 1 total** | **~5.35 GiB** |

Not in Tier 1, present here only because Android Studio installed them:
`ndk` 2.0 GiB, `build-tools` 293 MiB, `platforms` 135 MiB, `cmake` 60 MiB.
Skipping those is what takes the 7.7 GiB full install down to 5.35 GiB.

The AVD is the figure `design.md` was missing entirely:

| `Expo_API_36.avd` after real boots | Size |
|---|---|
| `snapshots/` | 3.7 GiB |
| `userdata-qemu.img.qcow2` | 1.8 GiB |
| `cache.img.qcow2` | 82 MiB |
| everything else | ~44 MiB |
| **total** | **5.6 GiB** |

**Verdict: a cold Tier 1 install costs roughly 5.35 GiB of SDK plus 5.6 GiB
of AVD state, so about 11 GiB steady-state, not the ~3 GiB the download-byte
figures implied.** The single largest line is `snapshots/` at 3.7 GiB, and it
is optional: booting with `-no-snapshot` avoids creating it at the cost of a
slower start. That is a real knob for the device panel to expose, and it is
the difference between an 11 GiB and a 7 GiB footprint.

This also sharpens requirement 1 (reuse, do not duplicate): reusing an
existing SDK and an existing AVD saves ~11 GiB per user, not ~3 GiB.

---

## Spike 8: does Fedora's stock kernel ship binder?

**Yes, compiled in, not as a module.**

```
CONFIG_ANDROID_BINDER_IPC=y
CONFIG_ANDROID_BINDERFS=y
```

`modinfo binder_linux` fails precisely because it is `=y` rather than `=m`,
and `grep -w binder /proc/filesystems` confirms `nodev binder` is registered.
Waydroid itself is packaged in Fedora updates (`waydroid 1.6.3-1.fc44`).

**Verdict: the optional Waydroid smoke-test toggle is viable on Fedora with
no kernel work and no out-of-tree module.** It stays optional and stays out
of v1; this only records that the kernel gate `design.md` worried about is
not a gate on this distribution.

---

## Spike 10 (new): headless boot requires `-gpu host`, software rendering segfaults

Three headless launches of `Expo_API_36` exited 1 with no error line in the
emulator's own log, the last line being only
`Emulator is performing a full startup`. `coredumpctl` told the real story:

```
SIGSEGV  /home/sbarah/Android/Sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64-headless
```

three times, once per attempt. The common factor was the renderer. With
`-no-window`, the emulator auto-selects software rendering
(`emuglConfig_init: vulkan_mode_selected:lavapipe gles_mode_selected:swangle`,
`Selecting Vulkan device: llvmpipe`) and the headless QEMU binary segfaults
during startup. Explicitly forcing `-gpu swiftshader_indirect` segfaults the
same way, and additionally breaks snapshot loading with
`Change of GLES renderer detected` / `Failed to load snapshot 'default_boot'`.

The launch that works:

```bash
emulator -avd <name> -no-window -no-audio -no-boot-anim \
         -no-snapshot -no-metrics -gpu host
```

`-gpu host` selects the real GPU (here `NVIDIA GeForce RTX 4070 Laptop`) and
boots headless in **17.4 seconds**, with zero windows on the user's display.

**Verdict, scoped to what was actually measured: on this hardware, headless
launch needs `-gpu host`, and the conventional advice to fall back to
`swiftshader_indirect` is wrong here, because that is the renderer that
segfaults.**

Do not generalise this into "always pass `-gpu host`". This host has an
RTX 4070 and an Intel iGPU, so `-gpu host` has something real to select. On a
headless server, a VM, or a CI runner with no usable GPU, `-gpu host` has
nothing to bind and software rendering is the only option available, which is
the path that failed here. **That case is unverified and may well work**, since
the segfault may be specific to this Mesa or driver stack rather than to
software rendering in general.

What the implementation should therefore do, which holds in both cases:
prefer `-gpu host` where a GPU exists, and treat an abnormal exit as a
diagnosable event rather than something to retry blindly into. The emulator
writes no error for a segfault, so detection means noticing the process died
without `sys.boot_completed` and reporting the renderer as the leading
suspect, not parsing the log for a message that is not there.

Two more things this spike settled for Decision 5, the device panel:

- **A silent exit code 1 is the most likely first-run failure a user will
  hit.** The emulator's own log contains no error for a segfault. The panel
  cannot just relay the exit code: it has to detect the process died
  abnormally, name the renderer as the likely cause, and offer the recovery
  actions the user asked for by name, which here are exactly "try a
  different GPU mode", "cold boot" and "wipe data".
- **`-no-snapshot` avoids the 3.7 GiB `snapshots/` directory** measured in
  spike 7, at the cost of a slower start. That is a real footprint knob for
  the panel to expose.

---

## Spike 11 (new): what screen capture actually costs, and whether scrcpy is needed for v1

Decision 1 picked scrcpy without a measurement, because none was possible
without a device. Measured now, on the booted emulator at 1080x2400.

### The naive path is too slow for a live panel

| Method | Per frame | Size | Effective rate |
|---|---|---|---|
| `adb exec-out screencap -p` (PNG) | 0.64 s | 1.37 MB | ~1.6 fps |
| `adb exec-out screencap` (raw) | 0.19 s | 10.4 MB | ~5 fps, at 52 MB/s |

Five PNG frames timed 0.63 to 0.65 seconds each, so the figure is tight.
**`screencap` is fine for a one-off screenshot and unusable as a video
source**, which is the assumption Decision 1 was built on and it holds.

### But scrcpy is not the only way to get an encoded stream

`screenrecord` v1.4 is present on the device, and it streams H.264 to stdout:

```bash
adb exec-out 'screenrecord --time-limit 0 --bit-rate 8M --output-format=h264 -'
```

Verified: a 3 second capture at 2 Mbps produced 58,405 bytes of raw H.264 on
stdout, exit 0. `--time-limit 0` explicitly removes the default 180 second
cap, per the tool's own help text, so the stream is unbounded.
`--display-id` selects a display and `--size` sets the resolution.

This is the same on-device MediaCodec encode that scrcpy's server performs,
reached with no server jar, no pinned wire protocol, and no provisioning.
It feeds the same Electron `VideoDecoder` (WebCodecs) that Decision 1
already specifies for scrcpy's stream.

### Why this matters more here than it would elsewhere

**scrcpy is not packaged on this platform.** `dnf list scrcpy` returns
"No matching packages", `dnf repoquery` finds nothing, and a Flathub search
returns no scrcpy. So the scrcpy path is not "install a package", it is
"Hermes vendors and version-locks an Apache-2.0 jar whose wire protocol its
own maintainers call internal and unstable, and whose server refuses a
mismatched client". That is real work and real ongoing maintenance, and
Decision 1 already acknowledged Hermes would have to own the provisioning.

### Measured: time to first byte, and sustained bitrate

The staging decision turns on whether the stream starts fast enough to feel
live. Measured directly by timing the first byte off `adb exec-out`'s stdout,
three trials:

| Trial | First byte |
|---|---|
| 1 | 0.12 s |
| 2 | 0.14 s |
| 3 | 0.14 s |

**0.13 seconds to first byte**, against scrcpy's own documented "about 1
second to first frame". On this axis screenrecord is not a compromise, it is
faster.

Sustained bitrate, with continuous swipe input driving real screen motion,
8 Mbps requested:

```
first byte 0.13s | 1,643,705 bytes in 8.0s | 201 KiB/s | ~1.6 Mbps
```

On a **static** screen the same stream produced 61,441 bytes and then
effectively nothing: reads blocked for tens of seconds. That is correct
H.264 behaviour, not a fault, and it is a useful property (an idle device
panel costs no bandwidth). It is also a **decoder requirement**: the host
side must tolerate arbitrarily long gaps between frames and must not treat
a stalled read as a dead stream. A naive read-with-timeout loop will
disconnect a perfectly healthy idle device.

### What screenrecord does not give you

Being honest about the tradeoff, because this is a staging decision and not
a reversal:

- **Steady-state latency.** First-byte latency is measured and good.
  End-to-end glass-to-glass latency is not, because it needs the decoder
  side built. scrcpy's 35 to 70 ms remains the number to beat, and the
  encoder buffering that screenrecord does may well put it behind once
  frames are flowing continuously.
- **Input injection.** scrcpy carries control on a second socket. With
  screenrecord, input goes through `adb shell input`, which Decision 2
  already uses and which spike 1 confirmed works unprivileged. So this gap
  costs nothing for the semantic path, only for raw low-latency touch
  passthrough in the panel.
- **Audio, clipboard, rotation events.** scrcpy has them, screenrecord does
  not.

**Verdict: stage it. v1 streams with `screenrecord`, which starts in 0.13 s,
costs 1.6 Mbps under motion and nothing at idle, works today with zero
dependencies, and unblocks the entire device panel. Adopt scrcpy when a
measured steady-state latency or input-passthrough requirement justifies
vendoring the jar.** Decision 1 has been amended in place with a pointer
here.

---

## Spike 6 (partial): what `dumpsys activity exit-info` returns

Run against the booted device, 9,848 bytes of output covering every package
with process-exit history. The record shape is fixed:

```
package: com.android.providers.contacts
  Historical Process Exit for uid=10096
      ApplicationExitInfo #0:
        timestamp=2026-08-11 05:58:21.822 pid=4721 realUid=10096 packageUid=10096 definingUid=10096 user=0
        process=android.process.acore reason=14 (FREEZER) subreason=20 (FREEZER BINDER TRANSACTION) status=0
        importance=400 pss=0.00 rss=0.00 description=Sync transaction while frozen state=empty trace=null
```

So it is **structured, greppable, per-package, and carries a numeric
`reason` with a human label** (`15 (STATE CHANGE)`, `14 (FREEZER)`), which
is exactly what a crash classifier needs to tell a crash from an ordinary
exit without parsing prose.

The spike's actual question was whether `trace=` carries a trace body or
only metadata. Every record on an idle device shows `trace=null`, because
none of these exits were crashes or ANRs. **This half is unanswered until a
real crash exists to observe**, which is what the demo application's crash
screen is being built for. Recorded here so the shape is not re-derived.

---

## Spike 12 (new): `testID` really does become `resource-id`

The entire ref contract in Decision 2 rests on this and it had never been
checked. Run against the demo fixture (Expo SDK 57, RN 0.86) in Expo Go:

```
# host.exp.exponent/.experience.ExperienceActivity
[e4]  #home.counter.increment  Button    'Increment'      (clickable,focusable)
[e12] #home.echo.input         EditText  'Type something' (clickable,long_clickable,focusable,editable)
[e18] #home.toggle.switch      Switch    'home.toggle.switch' (checkable,clickable,focusable)
[e21] #home.slider.control     SeekBar   'home.slider.control' (focusable)
[e26] #home.nav.forms          Button    'Forms'          (clickable,focusable)
```

**Every `testID` on the Home screen reached `android layout` as a
`resource-id`, verbatim, with no mangling.** The Android class is correct per
component (`Button`, `EditText`, `Switch`, `SeekBar`, `ScrollView`) and the
`interactions` array is accurate (`editable` only on the text input,
`checkable` only on the switch).

**Verdict: the ref contract works, and `testID` is the addressing mode to
prefer over positional refs.** That last part came out of a failure during
the test: after typing into a field, the soft keyboard reflowed the screen
and a positional ref taken before the keystroke no longer resolved. The
driver refused it rather than tapping the wrong thing, which is the contract
behaving correctly, but it shows positional refs are fragile in exactly the
situation an agent hits most often. `android_driver.py` now accepts a
`testID` anywhere it accepts a ref.

---

## Spike 4: can an already-attached debugger be detected before attaching?

`GET /json/list` against Metro, app running:

```json
{
  "id": "13b1...-1",
  "title": "host.exp.exponent (Google sdk_gphone64_x86_64)",
  "description": "React Native Bridgeless [C++ connection]",
  "appId": "host.exp.exponent",
  "type": "node",
  "webSocketDebuggerUrl": "ws://localhost:8081/inspector/debug?device=13b1...&page=1",
  "deviceName": "sdk_gphone64_x86_64 - 16 - API 36",
  "reactNative": {
    "logicalDeviceId": "13b1...",
    "capabilities": {
      "nativePageReloads": true,
      "nativeSourceCodeFetching": false,
      "supportsMultipleDebuggers": true
    }
  }
}
```

**The answer is better than the question assumed: `supportsMultipleDebuggers:
true`.** `design.md` states as a **hard constraint** that "Hermes (the JS
engine) allows exactly one CDP debugger connection at a time" and builds a
whole ticket-scoped ownership design on it. On this stack, React Native
Bridgeless, that constraint does not hold, and the target advertises so in a
machine-readable capability flag.

**Verdict: do not hardcode the single-connection assumption. Read
`reactNative.capabilities.supportsMultipleDebuggers` and honour it.** The
`ControllerScope`-style ticket is still worth having, because it is how
Hermes avoids two of its own sessions fighting and because older targets will
report `false`, but it should be a policy driven by the flag, not a law of
physics. Design the broker to degrade: exclusive lease when the flag is
false, advisory lease when it is true.

Note also `/json/version` returns only `{"Browser": "Mobile JavaScript",
"Protocol-Version": "1.1"}` with **no `webSocketDebuggerUrl`**, which
matters for spike 5.

---

## Spike 5: can `agent-browser` be pointed at a Metro target? And what does the target actually support?

### The domain probe, run live

Attached directly to the RN target's websocket and issued each domain's
entry point:

| Command | Result |
|---|---|
| `Runtime.enable` | ok |
| `Log.enable` | ok |
| `Network.enable` | ok |
| `Debugger.enable` | ok |
| `Page.enable` | **ERROR, unsupported** |
| `DOM.getDocument` | **ERROR, unsupported** |
| `Target.getTargets` | **ERROR, unsupported** |
| `Runtime.evaluate` | **ERROR** |

Events seen during the probe: `Runtime.consoleAPICalled`,
`Runtime.executionContextCreated`, `Log.entryAdded`.

**Verdict on `agent-browser`: it cannot work, confirmed empirically rather
than inferred.** `codebase-integration.md` found two failure strings in the
shipped binary, and the live target triggers both conditions exactly:
`Target.getTargets` errors (its "Target domain initialization" phase cannot
complete) and `/json/version` carries no `webSocketDebuggerUrl` (its "No
webSocketDebuggerUrl in /json/version at" path). Decision 3 is a **new CDP
client**, not a reuse. This is now settled from both directions.

**Verdict on the Network domain: it works today, on RN 0.86.** `design.md`
scoped network visibility to v2 and gated it behind "RN >=0.83". The gate is
real but it is already satisfied by current Expo, and real
`Network.requestWillBeSent` / `Network.responseReceived` events were captured
during this session. Network visibility can move into v1.

### Two connection requirements no design note had

Both cost real time to find and both look like bugs when hit:

1. **The `Origin` header is mandatory.** Without it the websocket handshake
   is answered with **HTTP 401**. Metro's own log states the rule: origin
   must be `http://127.0.0.1:<port>`, or its hostname must be one of
   `localhost`, `127.0.0.1`, `0.0.0.0`, `[::]`.
2. **The websocket host must match the origin host.** Connecting to
   `ws://localhost:8081/...` while sending `Origin: http://127.0.0.1:8081`
   passes the origin check and then drops the socket with close code **1006,
   no close frame**, which is indistinguishable from a crash. The
   `webSocketDebuggerUrl` in `/json/list` says `localhost`, so a client that
   uses it verbatim while sending a `127.0.0.1` origin fails this way.

---

## Spike 13: in Expo Go, the JS engine does not deliver console over CDP

**Read this together with spike 13b immediately below, which qualifies it:
the failure is specific to Expo Go, and a development build delivers console
over CDP perfectly.** Taken alone this section overstates the problem.

It was found only because the
fixture has a screen whose whole job is to emit logs on demand.

With the CDP listener attached and every console button fired, **not one of
the application's own `console.log` / `info` / `warn` / `error` calls
arrived over CDP.** The only records captured were Metro's own injected
notices and `Network.*` events. The stream itself explains why:

```
[warn] The current JavaScript engine, HermesRuntime[RNBridgeless], does not
       support debugging over the Chrome DevTools Protocol.
[info] NOTE: You are using an unsupported debugging client. Use the Dev Menu
       in your app to open React Native DevTools.
```

So `Runtime.enable` returning `ok` means the **inspector proxy** accepted the
command. It does not mean the engine implements the domain. A client that
trusts the `ok` and waits for `Runtime.consoleAPICalled` waits forever.

### What does work: logcat

The same button presses landed in logcat, complete and correctly levelled:

```
I ReactNativeJS: [demo] plain log message from the console screen
I ReactNativeJS: [demo] info level message from the console screen
W ReactNativeJS: [demo] warning level message from the console screen
E ReactNativeJS: [demo] error level message from the console screen
I ReactNativeJS: '[demo] structured payload', { kind: 'hermes.mobile.demo.structured',
I ReactNativeJS:   metrics: { frames: 60, jankRatio: 0.031, heapMb: 128.5 },
...
```

`adb logcat -s ReactNativeJS` gives the message, the level (`I`/`W`/`E` maps
onto the existing console level vocabulary), the pid and tid, and a
timestamp. The one cost is that a multi-line structured object arrives as N
tagged lines and has to be reassembled by continuation-indent.

### Verdict, and the caveat on it

**For console and JS errors, logcat is the reliable channel and CDP is not.
For network, CDP is the only channel and it works.** Decision 3 should be
split along that line rather than treating CDP as one pipeline.

**The caveat was the whole story. See spike 13b immediately below: in a
development build, CDP console works perfectly.** The failure is specific to
Expo Go, not to React Native. Read the two spikes together; 13 alone
overstates the problem.

---

## Spike 13b: in a development build, CDP console works completely

A real development build was compiled (`expo prebuild` plus
`gradlew assembleDebug`, a 224 MiB debug APK, package
`com.anonymous.hermesmobiledemo`), installed, and driven through the same
four console buttons with the same listener attached.

Every level arrived over `Runtime.consoleAPICalled`, correctly typed:

```
[log]   [demo] plain log message from the console screen
[info]  [demo] info level message from the console screen
[warn]  [demo] warning level message from the console screen
[error] [demo] error level message from the console screen
        anonymous at .../entry.bundle:1168:39
        overrideMethod at .../entry.bundle:49474:38
        reactConsoleErrorHandler at .../entry.bundle:7409:26
        onPress at .../entry.bundle:157466:27
        _performTransitionSideEffects at .../entry.bundle:60220:19
```

The error carried a **full stack trace**, which logcat does not give. The
`Runtime`, `Log`, `Network` and `Debugger` domains all enabled, and the
`HermesRuntime[RNBridgeless] does not support debugging over the Chrome
DevTools Protocol` warning that dominated spike 13 **did not appear at all**.

### The corrected picture

| | Expo Go | Development build |
|---|---|---|
| CDP `Runtime.consoleAPICalled` | **never fires** | **works, with stack traces** |
| CDP `Network.*` | works | works |
| `adb logcat -s ReactNativeJS` | works | works |
| LogBox overlay via `android layout --full` | works | works |

**Verdict: implement both, and choose at runtime.** CDP is the better
channel where it is available: it carries structured arguments, real stack
frames, and source locations, none of which survive logcat's flattening.
logcat is the channel that always works, and is the only one in Expo Go,
which is how most people run an Expo project for the first time.

The runtime probe is cheap and unambiguous: attach, send `Runtime.enable`,
and watch for the
`does not support debugging over the Chrome DevTools Protocol` warning, or
simply see whether any `Runtime.consoleAPICalled` arrives within a short
window while logcat is producing lines. Fall back to logcat when it does
not. **Do not assume either channel from the target metadata**: the
`/json/list` entry is identical in both cases, including
`supportsMultipleDebuggers: true` and the `React Native Bridgeless [C++
connection]` description. Only behaviour distinguishes them.

### Three implementation gotchas found while building the dual-channel client

All three cost real time and all three look like "the feature is broken".

1. **`adb logcat` block-buffers when its stdout is a pipe.** A live
   `for line in proc.stdout` tail stays completely silent until roughly 4 KiB
   accumulates, which on a quiet app is minutes. It is indistinguishable from
   logcat producing nothing. Either use `stdbuf -oL adb logcat`, which needs
   coreutils and is not portable, or poll `adb logcat -d` and deduplicate.
   `prototype/mobile_console.py` polls.

2. **`-t N` is applied before the tag filter.** On this adb,
   `adb logcat -d -s ReactNativeJS:V -t 6` takes the last 6 lines of the whole
   buffer and then filters them by tag, which usually leaves nothing. It reads
   as "the app logged nothing" when the app logged plenty. Never combine `-t`
   with `-s`.

3. **`Runtime.enable` replays the buffered console.** Attaching mid-session
   delivers history, and re-attaching delivers the same messages again: a
   three-message capture came back with each message twice, once from the
   replay and once live. A client that appends blindly shows every log twice
   after any reconnect. Deduplicate on attach.

A fourth, which is about writing the probe rather than the product: **do not
count `Log.entryAdded` as evidence the CDP console channel is alive.** Metro's
inspector proxy injects its own notices on that event even against a target
where the engine delivers nothing, so a naive liveness check reports a working
channel on a dead one. Only `Runtime.consoleAPICalled` counts.

### A build note worth keeping

The first `gradlew assembleDebug` failed with exit 1 after compiling
essentially everything. The cause was a missing `NODE_ENV`; the build itself
warns `The NODE_ENV environment variable is required but was not specified`
and then fails much later with an unrelated-looking error. Setting
`NODE_ENV=development` fixed it. A Hermes provisioning step that shells out
to Gradle should set it rather than inherit whatever the session has.

---

## Spike 14 (new, and it is the best news in this document): LogBox is fully machine-readable

`design.md` assumed the RedBox/LogBox error overlay was "structurally
invisible" to the accessibility tree and would need the screenshot plus
vision fallback. **That is wrong, and in the most useful possible
direction.** `android layout --full` reads the entire overlay as text.

A real capture, after the fixture emitted a `console.warn`:

```
[e10] TextView 'Log 1 of 2'
[e14] TextView 'Console Warning'
[e15] TextView '[demo] warning level message from the console screen'
[e18] TextView 'Source'
[e23] TextView '   98 |  title="console.warn"'
[e24] TextView '   99 |  onPress={() => {'
[e25] TextView '>  100 |    console.warn('[demo] warning level message from the console screen');'
[e26] TextView '       |                ^'
[e27] TextView '  101 |    bump();'
[e28] TextView '  102 |  }}'
```

Everything Hermes needs is there as plain text:

| What | Where |
|---|---|
| how many errors are pending | `Log 1 of 2` |
| the error class | `Console Warning`, and `Uncaught Error` for a thrown exception |
| the message | the line under the class |
| the source file, line and column | the code frame, with `>` marking the line and `^` the column |
| the stack | a `See 14 more frames` control that expands it |

The overlay's own controls (`Dismiss`, `Minimize`, `Copy`, `See N more
frames`) carry **no `resource-id`**, only content descriptions, so they are
addressable by content-desc but not by testID. The prototype driver dismisses
them via `find Dismiss`.

**Verdict: Hermes can detect, classify, read and dismiss a React Native error
overlay with no CDP, no logcat parsing and no vision model.** This is a
stronger error-surfacing story than the design assumed, and it is the one
channel that works identically in Expo Go and in a development build,
because it is just the app's own UI.

**It is also a blocker an agent must handle.** During this session a LogBox
overlay silently swallowed two navigation taps: the tap "succeeded" (the
coordinates were real, `input tap` returned 0) and nothing happened, because
the overlay was on top. **Any device backend must check for the overlay
before reporting an action as successful**, exactly the way a browser
backend checks for a modal dialog.

---

## Spike 6 (completed): crash classes, and one of the three does not exist

Each failure class fired individually from the fixture's crash screen.

### JS exception and unhandled rejection: both captured, two ways

Unhandled promise rejection, in logcat:

```
E ReactNativeJS: [Error: Uncaught (in promise, id: 0) Error: [demo] unhandled promise rejection from the crash screen]
```

Exception thrown in a `setTimeout` callback, in the LogBox tree:

```
[e10] TextView 'Log 2 of 2'
[e14] TextView 'Uncaught Error'
[e15] TextView '[demo] exception thrown inside a setTimeout callback'
```

Both classes are reliably observable. logcat gives the earliest signal, the
LogBox tree gives the classification and the source location.

### ANR: not reachable from JavaScript at all

The fixture blocked the JavaScript thread for 12 seconds. Throughout the
block, sampled every 3 seconds:

```
t+4s  layout took 0.9s   t+12s layout took 0.9s
t+8s  layout took 0.9s   t+15s layout took 0.9s
```

The UI stayed fully responsive to the accessibility layer, and
`logcat -b events` recorded **no `am_anr`**, no `am_crash`, no
`am_proc_died`.

**Verdict: `design.md`'s three-crash-class model needs correcting to two and
a half.** Under Hermes, the JavaScript thread is not the Android UI thread,
so a frozen JS thread never triggers Android's ANR machinery. An RN app can
be completely wedged from the user's point of view while Android considers
it healthy. The ANR watcher (`logcat -b events` for `am_anr`) is still worth
having, because it catches a genuinely blocked native UI thread, but it will
**never fire for the failure mode RN developers actually hit**.

Detecting a wedged RN app needs a different signal: the JS thread stops
responding while the view tree keeps rendering. A practical heuristic is a
liveness probe over the debugger channel, or watching for the app's own UI to
stop changing while input is still being accepted. Neither is designed yet.
This is an honest gap, not a solved problem.

### `dumpsys activity exit-info`

The record shape is in the partial entry above, and `trace=` remains `null`
for every exit observed, because no observed exit was a native crash. **The
native crash class was never reachable from this fixture**: plain Expo
exposes no JavaScript API that raises SIGSEGV or SIGABRT, so the demo app
carries a documented placeholder rather than a real one. Settling whether
`trace=` carries a body needs a custom native module, which is out of scope
here and is recorded as still open.

### Side benefit: a real performance number

`android layout --flat --no-idle` completed in **0.9 seconds**, consistently,
even under load. `design.md` cited community reports of 1 to 3 seconds for
`uiautomator dump`. The chosen path is at the fast end of that range.

---

## End state

All eight original spikes are answered, plus six that the work itself
raised (9 through 14). The prototype runs green against both app forms:

```
                                              Expo Go   Dev build
counter round-trip                            PASS      PASS
live echo and clear                           PASS      PASS
navigate every screen                         PASS      PASS
an app error is detected and blocks actions   PASS      PASS
```

The harness needed no changes between them beyond how the app is launched
(a deep link for Expo Go, a launcher intent for the dev build), which is the
result that matters: the Decision 2 contract is indifferent to which one the
developer is using.

## Still open, and why

**6b. Does `dumpsys activity exit-info` fill `trace=` for a real native
crash?** The record shape is known and every observed exit carries
`trace=null`, because none was a crash. Plain Expo exposes no JavaScript API
that raises SIGSEGV or SIGABRT, so producing one needs a custom native module
(a JNI `abort()` or a deliberate null dereference) shipped in a development
build. That is a half-day of work and was not in scope here.

**How to detect a wedged React Native app.** Spike 6 established that the
ANR path cannot do it: a 12 second JavaScript block left Android considering
the app perfectly healthy. Nothing currently proposed detects the failure
mode RN developers actually hit. Candidates are a liveness probe over the
debugger channel, or watching for the UI to stop changing while input is
still accepted. **This is the one genuine design gap the spikes opened rather
than closed.**

**Latency under continuous motion.** First-byte latency for the
`screenrecord` stream is measured at 0.13 s and is excellent. Steady-state
glass-to-glass latency is not, because it needs the decoder side built. It is
the number that decides whether scrcpy stays deferred.
