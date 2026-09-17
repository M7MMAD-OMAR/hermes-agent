# Upstream merge 20260917

Branch `wip/upstream-20260917-clean`, worktree `/tmp/merge-probe`, two commits on
top of `sbar-hermes` (4187701a41). 1796 upstream commits, 62 conflicted files.

Deliberately NOT named `merge/upstream-*`: `hermes-land-update` lands the newest
branch matching that glob. Rename it when the tree is clean and the app is
closed, and note that the script still hardcodes the old branch name
`autobuild/sidebar-browser`, which has since been renamed to `sbar-hermes`.

## Verified

| | |
|---|---|
| `npx tsc --noEmit` (apps/desktop) | clean |
| vitest | 11364 passed, 0 failed, 18 skipped |
| `scripts/run_tests.sh tests/agent tests/gateway tests/tui_gateway` | 20928 passed, 0 failed |
| wider sweep (+ `tests/hermes_cli tests/tools`) | 2 failures, both pre-existing on the unmerged checkout |
| desktop build | `apps/desktop/release/linux-unpacked` built and launched on an Orbit private display; gateway reached ready, composer and its local controls render |

The `.deb` / `.rpm` step of the build fails on this host: `fpm` needs
`libcrypt.so.1`, which Fedora no longer ships. That is installer packaging only;
`linux-unpacked` is what the launcher runs and it builds fine.

The two pre-existing failures are `tests/hermes_cli/test_desktop_content_hash_git_fastpath.py`
and `tests/hermes_cli/test_cached_fetch_anthropic_models.py`; both fail the same
way on the live checkout without this merge.

## Skipped on purpose, each with the reason at the code it disagrees with

* `response-group.test.tsx`, two continuation cases. Upstream assumes every
  assistant row of a turn is visible, so a background continuation is one
  response with one action bar. This fork folds a turn's working behind a digest
  and its own 12 cases pin that. What upstream's grouping DID bring is wired in:
  `TurnDigest` renders its unfolded rows through `ResponseMessages`.
* `test_launch_db_home_override_race.py::test_get_db_follows_a_process_home_redirected_after_import`.
  This fork binds the launch handle at import time (#102526); upstream's
  first-use variant fixes #112692 but breaks three of that file's siblings here.

## Local behaviour given up

* `store/background-delegation.ts`: the `activity` line (latest child stream
  line, shown as a shimmering "will resume"). Upstream made this a per-runtime
  factory and the consumer auto-merged to count-only copy, leaving the field no
  reader. Upstream also notes the count-only atom deliberately avoids
  recomputing on every stream frame.
* `FloatingComposerSurface` not adopted: it solves the containment problem this
  fork already solves by rendering the composer as a sibling, and adopting it
  meant giving up the column the docked browser and device panels hang off.
* The pasted-PR-comment interception is gone, as upstream intended: a pasted URL
  is never swallowed. The review attachment itself stays, raised from the git
  review pane.

## Translation debt

Coverage ratchets raised, with the reason recorded at each: Arabic untranslated
40 -> 170, interpolated 0 -> 28, other locales 740 -> 870. The long-dash rule was
NOT relaxed; the strings that broke it were rewritten or translated. Bringing the
ratchets back down is a translation pass of its own.

## A trap worth remembering

The first attempt at this merge silently kept the pre-merge version of 187 files
that neither side's history explains, including whole upstream fixes. It was
caught by comparing the result against a clean re-merge of the same two commits
in a scratch worktree. Do that comparison on any large merge here before trusting
it: `comm -23 <(git ls-tree -r origin/main --name-only | sort) <(git ls-files | sort)`
for whole files, and a file-by-file diff against a clean probe for content.
