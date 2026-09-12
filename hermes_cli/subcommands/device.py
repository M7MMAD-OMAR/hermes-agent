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
        print(f"  device: {device['serial']} {label}")
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

    _actions = {"status": _device_status, "install": _device_install,
                "list": _device_list, "instrumentation": _device_instrumentation}

    def cmd_device(args):
        handler = _actions.get(getattr(args, "device_action", None))
        if handler is not None:
            return handler(args)
        device_parser.print_help()

    device_parser.set_defaults(func=cmd_device)
