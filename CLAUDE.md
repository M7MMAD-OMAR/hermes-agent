# Working in this checkout

`AGENTS.md` is the codebase guide — architecture, style, tools, plugins,
skills, testing. Read it for anything about *the code*.

This file covers only what is true of **this fork and this working copy**, which
`AGENTS.md` cannot know.

## Layout

| | |
|---|---|
| `origin` | `NousResearch/hermes-agent` — upstream, read-only |
| `fork` | `M7MMAD-OMAR/hermes-agent` — ours, push here |
| working branch | `autobuild/sidebar-browser` — **not** `main` |

`main` is a stale local ref. All work is on `autobuild/sidebar-browser`, which
carries ~130 commits of local features that are not upstream.

## Never run `hermes update` here

It switches the checkout to `main` and force-rebuilds. That is how local
branches got lost before. Take upstream this way instead:

```bash
git worktree add -b merge/upstream-<date> /tmp/merge-wt autobuild/sidebar-browser
cd /tmp/merge-wt && git merge origin/main      # resolve, test here
```

The worktree touches only `.git` and its own directory, so conflict resolution
and the full test suite never move the live checkout. Then:

```bash
hermes-land-update        # ~/.local/bin — refuses if the app is up or the tree is dirty
```

It fast-forwards, rebuilds with `hermes desktop --build-only --force-build`, and
pushes. `pnpm build` alone is **not** enough — only that command regenerates
`apps/desktop/release/linux-unpacked`, which is what the launcher starts.

## Other agents share this checkout

More than one agent session edits these files at the same time. Before any
`checkout`, `merge`, or `rebase`:

```bash
git status --porcelain | wc -l    # twice, a minute apart
```

Uncommitted work here belongs to someone else and no tag or push can recover
it. If `git merge` refuses with *"local changes would be overwritten"*, that is
the guard doing its job — do not force it.

`hermes desktop` silently **rebuilds** when the tree is dirty, so a launch can
sit for minutes with no window. That is not a hang.

## Local features — do not "clean up"

These exist only on this branch and look like additions upstream never made:
post-turn **Next Moves** (ghost text in the composer, taken with Tab), the
conversation's **browser docked beside the transcript**, **one browser per
conversation** with per-tab agent ownership, the **pin book** and browser
comments, and the **two-deck composer**.

## Testing

```bash
cd apps/desktop && npx vitest run          # ~9,600 tests, ~4 min
python -m pytest tests/agent tests/state -q # scope it — see below
```

**Do not run `pytest tests/` unscoped.** It spawns real Chromium instances and
drove load average to 42 on this machine. Pick the directories your change
touches.

Two failures are environmental, not yours — confirm by reproducing them on a
clean checkout before chasing either:

- `test_model_options_preserves_canonical_custom_row_after_agent_init` reads
  real host state (fixed on this branch by stubbing the OAuth probe).
- A post-run unhandled error from `katex-memo.ts` via `thread-remount.test.tsx`;
  exit code is still 0.

## Config

`~/.hermes/config.yaml` holds live secrets and is **not** under version control.
Never commit it, never paste it, and prefer `hermes config` over hand-editing.
The backend caches it at startup — a config change needs a desktop restart, not
just an MCP-server kill.
