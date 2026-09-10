"""Desktop rebuild toasts on Linux.

The .desktop entry launches `hermes desktop` with Terminal=false, so a launcher click that lands on
the rebuild path spends minutes with no window and nothing printed anywhere the user can see. The
launcher now announces the rebuild through notify-send. These tests pin the pure argv builder; the
subprocess wrapper around it is best-effort and never raises.
"""

from hermes_cli.main_desktop import _desktop_build_notification_argv


def test_linux_start_toast_persists_until_replaced():
    argv = _desktop_build_notification_argv("start", platform="linux")

    assert argv is not None
    assert argv[0] == "notify-send"
    assert "--expire-time=0" in argv
    assert "--print-id" in argv
    assert "--urgency=normal" in argv
    assert "rebuilding" in argv[-2].lower()


def test_done_and_failed_replace_the_start_toast():
    done = _desktop_build_notification_argv("done", platform="linux", replaces_id="42")
    failed = _desktop_build_notification_argv("failed", platform="linux", replaces_id="42")

    assert done is not None and "--replace-id=42" in done
    assert failed is not None and "--replace-id=42" in failed
    # Only the start toast is pinned open; the others may expire normally.
    assert "--expire-time=0" not in done
    assert "--expire-time=0" not in failed


def test_failed_is_critical_and_points_at_a_terminal():
    argv = _desktop_build_notification_argv("failed", platform="linux")

    assert argv is not None
    assert "--urgency=critical" in argv
    assert "--force-build" in argv[-1]


def test_non_numeric_replace_id_is_ignored():
    argv = _desktop_build_notification_argv("done", platform="linux", replaces_id="not-an-id")

    assert argv is not None
    assert not any(arg.startswith("--replace-id") for arg in argv)


def test_other_platforms_and_unknown_phases_show_nothing():
    assert _desktop_build_notification_argv("start", platform="darwin") is None
    assert _desktop_build_notification_argv("start", platform="win32") is None
    assert _desktop_build_notification_argv("bogus", platform="linux") is None
