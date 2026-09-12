"""``hermes device`` subcommand parser: the mobile device platform's provisioning surface.

Named for the capability, not the platform. Android is the only backend today; an iOS
one would add device kinds here rather than a second command.
"""

from __future__ import annotations

import json

from hermes_cli.subcommands._shared import add_json_flag


def _device_status(args) -> int:
    from hermes_cli.tools_config_android import android_tools_status
    status = android_tools_status()
    if bool(getattr(args, "json", False)):
        print(json.dumps(status, indent=2, sort_keys=True))
        return 0 if status["ready"] else 1
    if not status["sdk_root"]:
        print("Android SDK: not found")
        print("  Checked ANDROID_HOME, ANDROID_SDK_ROOT and the platform default.")
        print("  Run: hermes device install --accept-license")
        return 1
    print(f"Android SDK: {status['sdk_root']}")
    print(f"  adb:        {status['adb'] or 'missing (install platform-tools)'}")
    print(f"  emulator:   {status['emulator'] or 'missing'}")
    cli_state = "ready" if status["android_cli_downloaded"] else "not downloaded yet"
    print(f"  android:    {status['android_cli'] or 'missing'} ({cli_state})")
    kvm = status["kvm"]
    print(f"  {'✓' if kvm['accelerated'] else '⚠'} acceleration: {kvm['detail'] or 'unknown'}")
    if kvm["fix"]:
        print(f"    {kvm['fix']}")
    print(f"  license accepted: {'yes' if status['license_accepted'] else 'no'}")
    print(f"  AVDs: {', '.join(status['avds']) or 'none'}")
    for device in status["devices"]:
        label = " ".join(part for part in (device["model"], f"({device['state']})") if part)
        # A device can be attached and still unusable because another session holds it.
        # Reporting only "attached" sends the reader to look for a hardware problem.
        lease = device.get("leased_by")
        print(f"  device: {device['serial']} {label}"
              + (f" leased by {lease}" if lease else ""))
    if not status["devices"]:
        print("  device: none attached")
    if not status["ready"]:
        print("  Run: hermes device install --accept-license")
    return 0 if status["ready"] else 1


def _device_install(args) -> int:
    from hermes_cli.tools_config_android import install_android_tools
    return 0 if install_android_tools(
        accept_license=bool(getattr(args, "accept_license", False))) else 1


def _device_list(args) -> int:
    from hermes_cli.tools_config_android import attached_devices
    devices = attached_devices()
    if bool(getattr(args, "json", False)):
        print(json.dumps(devices, indent=2, sort_keys=True))
        return 0
    for device in devices:
        print(f"{device['serial']:24} {device['state']:14} {device['model']}")
    if not devices:
        print("No devices attached.")
    return 0


def _device_instrumentation(args) -> int:
    """Report or remove the APK that reading a screen installs on the device.

    This exists because the install is a durable change to hardware the user owns. A
    capability that can silently modify a phone must also be able to undo it.
    """
    from hermes_cli.tools_config_android import (
        LAYOUT_INSTRUMENTATION_PACKAGE, layout_instrumentation_installed,
        remove_layout_instrumentation)
    serial = getattr(args, "serial", "") or ""
    if getattr(args, "remove", False):
        if remove_layout_instrumentation(serial):
            print(f"Removed {LAYOUT_INSTRUMENTATION_PACKAGE}.")
            return 0
        print(f"Could not remove {LAYOUT_INSTRUMENTATION_PACKAGE}.")
        return 1
    present = layout_instrumentation_installed(serial)
    print(f"{LAYOUT_INSTRUMENTATION_PACKAGE}: {'installed' if present else 'not installed'}")
    if present:
        print("  Reading a screen installed it. Remove with: hermes device instrumentation --remove")
    return 0


def _device_pair(args) -> int:
    from hermes_cli.tools_config_android import pair_wireless
    result = pair_wireless(str(getattr(args, "address", "")), str(getattr(args, "code", "")))
    print(result.get("output") or result.get("error", ""))
    if result.get("ok"):
        print(f"  {result['next']}")
    return 0 if result.get("ok") else 1


def _device_connect(args) -> int:
    from hermes_cli.tools_config_android import connect_wireless
    result = connect_wireless(str(getattr(args, "address", "")))
    print(result.get("output") or result.get("error", ""))
    return 0 if result.get("ok") else 1


def _device_maestro(args) -> int:
    from hermes_cli.tools_config_maestro import install_maestro, maestro_status, remove_maestro
    action = getattr(args, "maestro_action", None)
    if action == "install":
        return 0 if install_maestro() else 1
    if action == "remove":
        print("Removed." if remove_maestro() else "Nothing of ours to remove.")
        return 0
    status = maestro_status()
    print(f"Maestro: {status['maestro'] or 'not installed'}"
          + (f" ({status['version']})" if status["version"] else ""))
    print(f"  Java: {status['java'] or 'not found'}"
          + ("" if status["java_ok"] else "  (needs 17 or newer)"))
    if not status["ready"]:
        print("  Run: hermes device maestro install   (about 315 MB)")
    return 0 if status["ready"] else 1


def build_device_parser(subparsers) -> None:
    """Attach the ``device`` subcommand to ``subparsers``."""
    device_parser = subparsers.add_parser(
        "device", help="Manage mobile device support (Android SDK, emulators, attached devices)",
        description="Detect, provision and inspect the tooling the mobile device\n"
            "backend drives. `status` costs nothing and downloads nothing.\n"
            "`install` fetches what is missing, and refuses until Google's\n"
            "Android SDK Terms of Service have been accepted with\n"
            "--accept-license.\n\n"
            "Reading a device's screen installs a small instrumentation APK\n"
            "on the device. `instrumentation` reports it and removes it.")
    device_sub = device_parser.add_subparsers(dest="device_action")

    device_status = device_sub.add_parser(
        "status", help="Report SDK, acceleration, AVDs and attached devices (read-only)")
    add_json_flag(device_status, "Emit the full detection payload as JSON.")

    device_install = device_sub.add_parser(
        "install", help="Provision Android device support")
    device_install.add_argument(
        "--accept-license", action="store_true",
        help="Record acceptance of Google's Android SDK Terms of Service "
            "(https://developer.android.com/studio/terms). Nothing downloads without it.")

    device_list = device_sub.add_parser("list", help="List devices adb can currently see")
    add_json_flag(device_list, "Emit the device list as JSON.")

    device_instr = device_sub.add_parser(
        "instrumentation", help="Report or remove the on-device instrumentation APK")
    device_instr.add_argument("--serial", default="", help="Target one device by serial.")
    device_instr.add_argument("--remove", action="store_true",
                              help="Uninstall it. The next screen read reinstalls it.")

    device_pair = device_sub.add_parser(
        "pair", help="Pair with a device over the network (Android 11+)",
        description="Wireless debugging pairs once with a six-digit code the DEVICE\n"
            "generates and shows on its own screen, under Developer options,\n"
            "Wireless debugging, Pair device with pairing code. Hermes cannot\n"
            "read that code; you type it. The pairing port shown there is not\n"
            "the same as the debugging port you connect to afterwards.")
    device_pair.add_argument("address", help="The ip:port shown on the pairing dialog.")
    device_pair.add_argument("--code", required=True, help="The six digits on the device.")

    device_connect = device_sub.add_parser(
        "connect", help="Attach to an already-paired device (once per session)")
    device_connect.add_argument("address", help="The device's ip:port from Wireless debugging.")

    device_maestro = device_sub.add_parser(
        "maestro", help="Manage the optional Maestro UI-test runner",
        description="Maestro turns a UI test into a YAML file that runs in CI with no\n"
            "Hermes on the machine. It is a 315 MB JVM application and needs a\n"
            "JDK 17 or newer, so it is opt-in rather than part of the ordinary\n"
            "device install. An install you made yourself is used in preference\n"
            "to ours and is never touched by `remove`.")
    device_maestro_sub = device_maestro.add_subparsers(dest="maestro_action")
    device_maestro_sub.add_parser("status", help="Report whether Maestro and a JDK are present")
    device_maestro_sub.add_parser("install", help="Download and verify the pinned release")
    device_maestro_sub.add_parser("remove", help="Delete Hermes's own copy")

    _actions = {"status": _device_status, "install": _device_install,
                "list": _device_list, "instrumentation": _device_instrumentation,
                "pair": _device_pair, "connect": _device_connect, "maestro": _device_maestro}

    def cmd_device(args):
        handler = _actions.get(getattr(args, "device_action", None))
        if handler is not None:
            return handler(args)
        device_parser.print_help()

    device_parser.set_defaults(func=cmd_device)
