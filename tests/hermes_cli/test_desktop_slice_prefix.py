"""The desktop launch lands the whole process tree in ``hermes.slice`` when that slice exists."""
from __future__ import annotations

from hermes_cli import main_desktop


def test_no_prefix_off_linux():
    assert main_desktop._desktop_slice_prefix(platform="darwin", which=lambda _: "/bin/x",
                                              unit_exists=lambda _: True) == []


def test_no_prefix_without_systemd_run():
    assert main_desktop._desktop_slice_prefix(platform="linux", which=lambda _: None,
                                              unit_exists=lambda _: True) == []


def test_no_prefix_when_slice_is_not_configured():
    # Opt-in by presence: a machine without the unit launches exactly as before.
    assert main_desktop._desktop_slice_prefix(platform="linux", which=lambda _: "/usr/bin/systemd-run",
                                              unit_exists=lambda _: False) == []


def test_prefix_is_a_transient_scope_inside_the_slice():
    prefix = main_desktop._desktop_slice_prefix(platform="linux", which=lambda _: "/usr/bin/systemd-run",
                                                unit_exists=lambda unit: unit == "hermes.slice")
    assert prefix[:3] == ["systemd-run", "--user", "--scope"]
    assert "--slice=hermes.slice" in prefix
    # A dead scope must not outlive a failed launch.
    assert "--collect" in prefix
    assert any(a.startswith("--unit=hermes-desktop-") for a in prefix)
