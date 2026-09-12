# Working prototype

Four scripts that prove the design's contracts against a real device, and
one demo application to prove them on. Nothing here is production code and
none of it is wired into Hermes. It exists so that the decisions in
[`../design.md`](../design.md) rest on measurements rather than on reading,
and so the eventual implementation has a reference that is known to work.

Every empirical claim in [`../spikes.md`](../spikes.md) was produced with
these.

## What is here

| File | What it proves |
|---|---|
| `android_driver.py` | Decision 2. Reads the screen, assigns refs, taps, types, scrolls, screenshots, resolves visually. |
| `mobile_console.py` | Decision 3. Attaches to a running RN app over CDP and translates its events. |
| `metro_probe.py` | Spikes 4 and 5. What Metro's inspector proxy exposes and which CDP domains the target honours. |
| `ui_test.py` | The "write tests against the interface" requirement. A small assertion layer on top of the driver. |

## Running it

Prerequisites: a booted device, and for the console and test scripts, Metro
running with the app open.

Boot the emulator headless. On this hardware `-gpu host` is required: with
`-no-window` the emulator auto-selects software rendering and the headless
QEMU binary segfaults (spike 10). A host with no usable GPU has not been
tested and may need something else.

```bash
$ANDROID_HOME/emulator/emulator -avd <name> -no-window -no-audio \
    -no-boot-anim -no-snapshot -no-metrics -gpu host
```

Start Metro and open the app:

```bash
cd /home/sbarah/R/Projects/P/hermes-mobile-demo && bun run start --port 8081
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081" host.exp.exponent
```

Then:

```bash
python android_driver.py snapshot          # the screen, as addressable refs
python android_driver.py ids               # every testID on this screen
python android_driver.py find "Increment"  # search by text, label or testID
python android_driver.py tap home.nav.list # by testID, or by ref: tap e12
python android_driver.py type home.echo.input "hello"
python android_driver.py scroll down
python android_driver.py screenshot out.png --annotate

python mobile_console.py --seconds 60 --json capture.json
python mobile_console.py --with-logcat      # both channels, merged
python metro_probe.py --port 8081
python ui_test.py                          # the suite
python ui_test.py --list                   # scenarios without running them
```

`android` must be on PATH (`$ANDROID_HOME/cmdline-tools/latest/bin`), and
`mobile_console.py` and `metro_probe.py` need the `websockets` package, so
run those two with the Hermes venv interpreter.

## What the driver actually does, and why

**Reading goes through `android layout`, acting goes through `adb shell
input`.** That split is not an aesthetic choice. Spike 1 found that
`adb shell uiautomator dump` is SIGKILLed for the unprivileged `shell` user
on API 36 and works only after `adb root`, which is not available on a
physical device. `adb shell input` was confirmed fine unprivileged in the
same session. So the read half needs the Android CLI's instrumentation
server and the act half does not.

**Refs are synthesized, not passed through.** `resource-id` is stable across
re-dumps and across navigation, but it is present on only some elements and
is not unique, so the snapshot keeps its own ref table. Prefer addressing by
`testID` anyway: it survives a re-layout and a positional ref does not, which
the echo scenario in `ui_test.py` demonstrates by opening the soft keyboard
between the tap and the assertion.

**`android layout` can exit 0 and print nothing.** Observed when the
instrumentation server is cold. The driver retries three times with a
backoff; a naive caller sees an empty screen and concludes the app crashed.

**It installs something on the device.** The first `android layout` call
installs `com.android.cli.interact.instrumentation`. That is why it works
unprivileged, and it is a durable change to the user's device that a real
implementation has to disclose and be able to remove.

## The three failure modes worth knowing before you write any of this

1. **An error overlay silently swallows taps.** `input tap` returns 0, the
   coordinates are real, and nothing happens, because LogBox is on top. Two
   navigation steps were lost this way during development before the guard in
   `ui_test.logbox_present()` was written. Any backend must check for the
   overlay before reporting an action successful, the same way a browser
   backend checks for a modal dialog.

2. **The overlay is a bad correctness signal.** An error that definitely
   happened, and that definitely reached logcat, sometimes produced no
   overlay at all. The mechanism was not pinned down: suppression of an
   already-dismissed message is one explanation, LogBox simply not surfacing
   that message in that build configuration is another, and the observation
   base is too thin to say which. The operational conclusion holds either
   way: **assert on logcat, treat the overlay as enrichment.** The overlay is
   excellent enrichment, because it carries the error class, the source file,
   the line and the code frame as plain text, but "no overlay" does not mean
   "no error".

3. **A suite that assumes its starting state produces failures about the
   previous scenario.** `ui_test.reset_app()` force-stops and relaunches
   before each scenario. Repeated hardware BACK presses can also leave the
   navigator in a state where a screen renders but its route does not, and
   every later navigation silently no-ops, which looks exactly like a hung
   app and is not one.

## Current result

```
4/4 scenarios passed, against both Expo Go and a development build

counter round-trip                            PASS
live echo and clear                           PASS
navigate every screen                         PASS
an app error is detected and blocks actions   PASS
```

The last one asserts that `console.log`, `console.warn` and `console.error`
each reach logcat at the correct level (`I`, `W`, `E`). It asserts on logcat
rather than on CDP deliberately: **CDP's `Runtime.consoleAPICalled` works in a
development build and never fires in Expo Go**, so logcat is the only channel
that holds in both, and a test that asserts on CDP would pass on one and fail
on the other for reasons unrelated to the app.

`mobile_console.py --with-logcat` runs both channels and merges them, which is
what a real implementation should do: CDP carries structured arguments and
real stack frames that logcat flattens away, so it is the better channel where
it exists, and logcat is the one that is always there.

## The demo application

`/home/sbarah/R/Projects/P/hermes-mobile-demo`, Expo SDK 57 on React Native
0.86, built as a fixture rather than as a product: seven screens covering
counters, forms with appearing and disappearing validation, a 72 row list
with search and pull to refresh, real and deliberately failing network
requests, every console level, every reachable crash class, and persisted
state. Around 100 distinct `testID` names, expanding to roughly 316
addressable ids at runtime. Its README carries the full table.

Two things it deliberately does not do, both documented in its own README:
there is no real native crash, because plain Expo exposes no JavaScript API
that reaches the native layer that way, and its ANR button cannot produce a
formal ANR, because under Hermes the JavaScript thread is not the Android UI
thread. Spike 6 confirmed the second one empirically: a 12 second JS block
left the UI fully responsive to the accessibility layer and filed no
`am_anr`.
