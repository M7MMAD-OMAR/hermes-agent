# Sources and full research trail

Backs [`design.md`](design.md). Produced by a nine-strand research workflow
(each strand an independent primary-source-reading pass) plus one
adversarial completeness/contradiction pass over all nine. Full agent
transcripts and structured JSON are preserved in this session's workflow
run `wf_bf7d36f6-ada`; this file is the durable, human-readable copy.

## Strand: Radon IDE (Software Mansion) and close relatives

- https://github.com/software-mansion/radon-ide (issue-tracking + docs only, no implementation source)
- https://github.com/software-mansion/radon-ide/blob/main/LICENSE.txt
- https://radon.swmansion.com/docs/features/dev-tools
- https://radon.swmansion.com/docs/features/network-inspector
- https://radon.swmansion.com/docs/features/overview
- https://radon.swmansion.com/docs/guides/simulators
- https://radon.swmansion.com/docs/getting-started/compatibility
- https://radon.swmansion.com/pricing
- https://radon.swmansion.com/docs/features/radon-ai
- https://github.com/software-mansion/radon-ide/issues/645 (pasted logs, MJPEG server)
- https://github.com/software-mansion/radon-ide/issues/688 (Linux support tracking)
- https://github.com/software-mansion/radon-ide/issues/1541 (Claude Code MCP support request)
- https://github.com/software-mansion/argent (Apache-2.0 CLI, proprietary capture binary)
- https://deepwiki.com/software-mansion/radon-ide (AI-generated, secondary)
- https://swmansion.com/blog/react-native-ide-is-now-radon-ide-cfbdad77d43c
- https://dartcode.org/releases/v3-12/ and https://docs.flutter.dev/tools/devtools/vscode (comparison point)
- https://github.com/radon-h2020/radon-ide (unrelated EU project, disambiguation only)

Key numbers: Radon supports macOS only officially (Windows experimental,
Linux community-PR-only as of issue #688). Pricing: free (non-commercial) /
Pro $21-25/mo / Team $75/mo / Enterprise custom.

## Strand: Expo/React Native ecosystem's own device-management tooling

- https://github.com/expo/expo/blob/main/packages/@expo/cli/src/start/platforms/android/AndroidSdk.ts
- https://github.com/expo/expo/blob/main/packages/@expo/cli/src/start/platforms/android/AndroidDeviceManager.ts
- https://github.com/expo/expo/blob/main/packages/@expo/cli/src/start/platforms/android/getDevices.ts
- https://github.com/expo/expo/blob/main/packages/@expo/cli/src/start/platforms/android/emulator.ts
- https://github.com/expo/expo/blob/main/packages/@expo/cli/src/start/platforms/android/adb.ts
- https://github.com/expo/orbit/blob/main/README.md and https://github.com/expo/orbit/releases/tag/expo-orbit-v2.8.1
- https://docs.expo.dev/build/orbit/
- https://docs.expo.dev/develop/development-builds/development-workflows/
- https://docs.expo.dev/versions/latest/sdk/dev-menu/
- https://docs.expo.dev/build-reference/local-builds/
- https://github.com/expo/expo/blob/main/packages/expo-dev-client/package.json

Key numbers: Expo Orbit 2.8.1 (2026-08-17) ships real Linux rpm (112 MiB)
and deb (103 MiB) builds, MIT licensed, but exposes no CLI/API surface at
all. Expo's own emulator spawn (`emulator @name`) shows a real window by
design (no `-no-window`); boot readiness is polled via the boot animation,
up to a 3-minute timeout.

## Strand: screen-mirroring/streaming and input-injection protocols

- https://github.com/genymobile/scrcpy (Apache-2.0)
- https://raw.githubusercontent.com/Genymobile/scrcpy/master/doc/develop.md
- https://raw.githubusercontent.com/Genymobile/scrcpy/master/doc/connection.md
- https://raw.githubusercontent.com/Genymobile/scrcpy/master/doc/control.md
- https://github.com/Genymobile/scrcpy/releases/tag/v3.3.4 and /v1.19
- https://github.com/NetrisTV/ws-scrcpy (MIT, core frozen at scrcpy v1.19)
- https://developer.android.com/studio/run/emulator-console (gRPC, `-grpc`)
- https://developer.android.com/studio/releases/emulator (gRPC 29.0.6, "experimental, same-machine use only")
- https://source.android.com/docs/devices/cuttlefish/webrtc
- https://github.com/google/android-emulator-webrtc (Apache-2.0, appears dormant)

Key numbers: scrcpy API 21+ min (30+ for audio), 30-120 fps, ~35-70 ms
latency, ~1 s startup, 8 Mbps default bitrate. Not in this machine's dnf
repos (`dnf info scrcpy` empty).

## Strand: semantic device control (ref-addressed view hierarchy)

- https://github.com/mobile-next/mobile-mcp and /mobilecli (FSL-1.1 license, Competing Use clause)
- https://github.com/mobile-next/mobilewright (Apache-2.0 wrapper around the FSL binary)
- https://github.com/mobile-dev-inc/Maestro (Apache-2.0, `LICENSE` read directly)
- https://docs.maestro.dev/llms-full.txt
- https://maestro.dev/blog/maestro-re-building-the-ios-driver (moved to XCUITest for iOS, 1.18.0)
- https://github.com/appium/appium and /appium-uiautomator2-driver

Key numbers: mobilecli 1.0.9, linux-amd64 binary 16.08 MB, FSL-1.1
(Apache-2.0 grant effective two years after each release). Maestro needs
Java 17+ on the host. Appium needs JDK 21 + Node.js 20.11+ + a persistent
server.

## Strand: console/exceptions/network via CDP through Metro's inspector proxy

- https://raw.githubusercontent.com/facebook/react-native/main/packages/dev-middleware/src/inspector-proxy/InspectorProxy.js
- https://raw.githubusercontent.com/facebook/react-native/main/packages/dev-middleware/src/inspector-proxy/Device.js
- https://reactnative.dev/blog/2024/10/23/release-0.76-new-architecture (React Native DevTools shipped stable here, not 0.74)
- https://github.com/react-native-community/discussions-and-proposals/blob/main/proposals/0641-decoupling-flipper-from-react-native-core.md
- https://cdpstatus.reactnative.dev/devtools-protocol/1-3/Network, /Runtime, /Log (Hermes/RN CDP conformance tracker)
- https://github.com/facebook/react-native/commit/ffb82cb2f052f276a94a004d5acea0ab44f8098c (ExceptionsManager routes exceptions to console.error)
- https://reactnative.dev/blog/2020/07/06/version-0.63 (LogBox)
- https://github.com/steve228uk/metro-mcp (multiplexing proxy, works around Hermes's single-CDP-connection limit)
- https://github.com/vercel-labs/agent-browser (this repo's own external CDP/WebDriver automation CLI)
- https://github.com/facebook/react-native/issues/54796 (Android network-inspector response-body bug, 0.83.0-rc.4)

## Strand: Android SDK provisioning on Linux

- https://developer.android.com/tools/agents/android-cli and /download (Google's official agent-first CLI, stable 1.0, 2026-05-19)
- https://github.com/android/skills/blob/main/devtools/android-cli/SKILL.md
- https://android-developers.googleblog.com/2026/05/android-cli-stable-1-0-agent-development.html (names Claude Code explicitly)
- https://developer.android.com/tools/avdmanager, /sdkmanager, /studio/run/emulator-commandline, /studio/run/emulator-acceleration, /tools/adb, /tools/variables
- https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/master/docs/user/adb.1.md
- https://dl.google.com/android/repository/repository2-3.xml and /sys-img/google_apis/sys-img2-3.xml (live package manifests, real byte sizes)
- https://docs.waydro.id/ and https://github.com/waydroid/waydroid/blob/main/LICENSE (GPL-3.0)

Key numbers (download bytes, Linux x86_64, checked 2026-09-11): Android
CLI binary 5.07 MB; cmdline-tools 181 MB; platform-tools 9.05 MB;
build-tools 36.1.0, 64.2 MB; emulator package 519.7 MB; system image
android-36 1.90 GB; system image android-34 1.56 GB.

## Strand: physical and remote Android devices

- https://developer.android.com/tools/adb, /tools/releases/platform-tools
- https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/client/commandline.cpp (primary source for `ANDROID_ADB_SERVER_PORT`/`ADB_SERVER_SOCKET`)
- https://dl.google.com/android/repository/platform-tools-latest-linux.zip (HEAD-checked, 9,054,187 bytes)
- https://www.browserstack.com/pricing, /app-automate
- https://firebase.google.com/pricing
- https://saucelabs.com/pricing, /products/real-device-cloud

Empirically tested on this machine: `ANDROID_ADB_SERVER_PORT` isolation
(two servers, 5037 and 5038, independent PIDs, isolated `kill-server`
verified not to affect the other); `ADB_SERVER_SOCKET=localfilesystem:<path>`
unix-socket isolation (confirmed working; `unix:` prefix fails; 108-byte
`sun_path` limit confirmed).

## Strand: iOS scope-setting

- https://www.courtlistener.com/opinion/1903111/apple-inc-v-psystar-corp/ (9th Cir. 2011)
- https://www.apple.com/legal/sla/docs/xcode.pdf
- https://developer.apple.com/xcode/system-requirements
- https://developer.apple.com/documentation/xcode/testing-in-simulator-versus-testing-on-hardware-devices
- https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/ ("simulators can only run on macOS")
- https://github.com/appium/WebDriverAgent (BSD license)

## Strand: crash/ANR/notification design

- https://raw.githubusercontent.com/facebook/react-native/0.79-stable/packages/react-native/Libraries/Core/ExceptionsManager.js
- https://cdpstatus.reactnative.dev/devtools-protocol/react-native-hermes/Runtime, /Debugger
- https://github.com/react-native-community/discussions-and-proposals/discussions/718
- https://github.com/facebook/react-native/issues/54960 (~2s promise-rejection debounce)
- https://github.com/aosp-mirror/platform_frameworks_base/blob/master/services/core/java/com/android/server/am/EventLogTags.logtags (`am_crash`/`am_anr`)
- https://proandroiddev.com/get-app-crash-info-using-gethistoricalprocessexitreasons-b62e8edd369f
- https://embrace.io/blog/android-applicationexitinfo-api/
- Sentry/Bugsnag Android SDK docs, calibration only, not a build target

Internal source read directly for the transport decision: `gateway/platforms/api_server.py`
(`_SessionEventQueue`, confirmed existing push channel, used today for
`assistant.delta`/`tool.progress`).

## Completeness/contradiction pass: what it found and how design.md resolved it

The tenth agent in this workflow read all nine strands together against the
four user requirements and this repository's actual code, and returned
`needs_followup` with five real cross-strand contradictions and several
gaps. Each is resolved in `design.md`; summarized here for traceability:

1. Radon strand's primary (build a bespoke MJPEG binary) contradicted the
   streaming strand's primary (scrcpy). Resolved: scrcpy wins (Decision 1).
2. Three different adb-isolation proposals (TCP port in two strands, an
   unconfirmed env var flagged in a third) versus the physical-devices
   strand's own empirical unix-socket test. Resolved: unix socket wins
   (Decision 4, session isolation).
3. The semantic-control strand's raw-adb primary never saw Google's Android
   CLI, discovered independently by the provisioning strand. Resolved: not
   fully, deliberately; presented as spike-gated (Decision 2), since the
   discriminating test (resourceId stability) needs a real device.
4. The provisioning strand's own per-session `ANDROID_USER_HOME` proposal
   defeated requirement 1's "reuse existing AVDs." Resolved: fixed in
   Decision 4 (shared `ANDROID_USER_HOME`, leased device ownership instead).
5. The console strand's own open question ("which CDP event populates
   `browser_console()` today") was answered by the critic reading
   `tools/browser_tool_session.py` directly: it is the external
   `agent-browser` daemon, not a literal CDP event in this repo. Resolved:
   reflected in Decision 3 as the reason to build on `browser_cdp_tool.py`
   instead.

Two gaps the critic found are **not yet resolved** and are carried forward
explicitly in `design.md` rather than silently dropped: real installed-disk
numbers (all figures in this package are download bytes), and the Android
SDK EULA acceptance flow (genuinely new design work, no `cua-driver`
precedent to copy). Both appear in "Spikes required before implementation."
