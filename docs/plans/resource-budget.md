# Hermes resource budget: measurements, lifetimes, plan

Measured 7 Sep 2026, 09:05 to 09:50, on the live desktop with the user's real
layout: several conversations open as tabs, the freshly rebuilt package
(`82b829ebbb`), no embedded browser tab open at the time of sampling (the
persisted tab list was empty after the old Khadamat tab was closed).

## 1. What deskwatch already knows

`deskwatch why` over the last 60 minutes matched three casebook signatures,
none of them new:

| Signature | Evidence | Casebook |
|---|---|---|
| Thermal | peak 100 C, package throttling in 113 of 117 samples | desktop-performance.md |
| dGPU link not held | 4 samples at PCIe 16 GT/s in P3 | 2026-09-02, PCIe Gen 1 |
| WARP DNS wedge | 8 consecutive samples could not resolve cloudflare.com | 2026-09-03, WARP DNS |

The two stall events it recorded name Hermes directly:

- 10:13:31, throttling 8.2 s of 30.6 s. iGPU 86.8 % busy, of which Hyprland
  46.8 % and **Hermes 39.0 %**. CPU: whisper-server 65.5 %, **Hermes renderer
  29.5 % and 16.0 %** (two processes), nvidia-powerd 12.5 %.
- 10:15:40, throttling 8.8 s of 30.5 s. CPU: a Chromium renderer (the user's
  own browser) 84.5 %, **Hermes renderer 38.0 %**, **Hermes backend python
  24.5 %**.

So Hermes is a top-three CPU consumer and a top-two iGPU consumer during the
stalls, but never the only one. Whisper-server (Nabria dictation) and the
user's Chromium were the larger single items in each event.

## 2. Per-process footprint

Process inventory at 09:20, from `/proc`, cgroup from `/proc/<pid>/cgroup`:

| Process | RSS | Lifetime CPU avg | cgroup |
|---|---|---|---|
| Electron main (630013) | 281 MB | 2.1 % | app-org.chromium.Chromium-630013.scope |
| Renderer, primary window (630218) | 446 to 581 MB | 17.8 % | **session-3.scope** |
| GPU process (630095) | 199 MB | 4.7 % | session-3.scope |
| Zygotes x3 | 14 + 58 + 59 MB | 0 | session-3.scope |
| Backend python `serve` (630240) | 566 to 589 MB | 11.4 % | app-org.chromium.Chromium-630013.scope |
| Gateway python (2565, systemd) | 188 MB | 0.3 % | hermes-gateway.service |
| chrome-devtools-mcp node (631164) | 146 MB | 0 | (gone from cgroup listing) |
| typescript-language-server + 2 tsservers + typingsInstaller | 69 + 148 + 406 + 92 MB | ~1 % | app scope |
| Network / audio utility processes | 83 + 71 MB | 0 | app scope |

Total Hermes-attributable RSS at the last sampler tick: **1900 MB**, before any
embedded browser guest exists. Each embedded browser tab is one more `<webview>`
guest renderer on top of that.

Lifetime CPU averages are the number `ps %cpu` prints and they mislead in both
directions (the auto-nice casebook entry is about exactly this). A ten-second
per-thread delta at idle told the truth:

| Process | Idle CPU over 10 s | Wakeups over 10 s |
|---|---|---|
| Renderer main thread | 7 ticks (0.7 %) | 505 |
| Renderer ThreadPool threads | 14 ticks | 3,736 |
| Backend python | 7 ticks (0.7 %) | 1,352, of which **1,037 on one thread `data-loop.0`** |
| Electron main | 1 tick | 14 |
| GPU process | 0 | 0 |

At true idle Hermes is cheap. The cost is in turns and in what a turn leaves
behind. Over the lifetime of this run the renderer main thread had 10,712
ticks against 1,960 for its compositor, so it is JavaScript, not painting.

## 3. Disk

| Item | Size | Note |
|---|---|---|
| `~/.hermes/state.db` | **631 MB**, 46,548 extents | `messages` 267 MB, `messages_fts_trigram` 205 MB, `messages_fts` 116 MB. Two full-text indexes over the same table, the trigram one alone is 77 % of the messages it indexes |
| `~/.hermes/transcripts` | 572 MB, 4,608 files | prune_transcripts.py exists; no timer runs it |
| `~/.hermes/sessions` | 175 MB | |
| `~/.config/Hermes` | 225 MB | Electron caches |
| `~/.hermes/logs` | 61 MB | agent.log rotates at 5 MB |

Sampler over 4 minutes at idle: the backend wrote **13.3 MB**, the gateway
1.3 MB, everything else 0. The backend's open file descriptors grew by 215
bytes in that time, so the writes go through connections it opens and closes
per write: `state.db` and its WAL. 46,548 extents on a btrfs SQLite file is the
fragmentation pattern the casebook records as the cause of desktop stalls;
`defrag-hot-dbs.timer` runs weekly and last ran 6 Sep.

The backend also holds 12 file descriptors on the Electron main process's
GPU caches (`DawnGraphiteCache`, `DawnWebGPUCache`, `GPUCache`, a dictionary).
They are inherited across the spawn, not opened by Python. Harmless in size,
telling about the spawn: no `close_fds`.

## 4. Lifetimes: what creates, what releases, what leaks

| Resource | Created by | Meant to release | Releases today | Verdict |
|---|---|---|---|---|
| Runtime session state in the renderer | first turn / tile resume | `evictable()` at publish, `closeSessionTile` for settled | settled and unreferenced states drop their transcript at next publish; busy ones stay until settle | Sound. The "app crawls after a day of tiles" leak is already closed |
| Backend pool (non-primary profile backends) | profile switch | LRU cap 3, idle 10 min | `pool-eviction.ts` counts only spawned processes | Sound, bounded |
| Embedded browser guests | globe / agent open | `closeBrowserTabsForSession` on session end; the strip filter | released; hidden panes stay mounted by design | Sound. Not bounded: N tabs = N guests, no ceiling |
| Per-tab registries (find, input, nav, reader, script, console, page title) | pane mount | `forgetPreviewTab` on close | only console and page title are forgotten by the store; find/input/nav/reader/script release in their own pane unmount effects | Sound as long as the pane unmounts; the two module maps are the ones a bulk closer could miss and they are covered |
| Subagents per session | delegation | `clearSessionSubagents(sid)` | called from session end | Sound |
| LSP servers (tsserver etc.) | first LSP tool use in a project | idle reaper, `DEFAULT_IDLE_TIMEOUT = 600` s | reaper is started when enabled | **Unverified**: the sbartube tsserver pair (555 MB) was 9 minutes old at inventory; recheck after 10 minutes of no use |
| MCP servers (chrome-devtools-mcp) | backend start, per `config.yaml` | `idle_timeout_seconds: 900` | `_wait_for_lifecycle_event` recycles at the deadline and the process is gone (agent.log shows recycles at 09:31 and 10:21; pid 631164 no longer exists) | Sound. Cleared after tracing |
| Audio stream in the backend | the desktop's gateway-ready wake probe (`wake.status`, `wake.start`), which imports sounddevice | never | a `pw-PortAudio` pair and a `data-loop.0` thread at idle, 100 wakeups a second, with `enabled=False` | **Confirmed and fixed**: `import sounddevice` runs Pa_Initialize and nothing ran Pa_Terminate. Probes now release PortAudio unless a listener is armed (`tools/wake_word.py`, `_probe_audio`). Takes effect at the next backend start |
| Renderer subscriptions | tab open/close/navigate/title tick | n/a | `EmbeddedBrowserPanel` gates 8 subscriptions behind one atom; `publishSessionState` skips identical heartbeats; stream flush is a 33 ms adaptive floor with rAF avoided on purpose; background windows are re-throttled 5 s after the last turn | Sound. The 20 % idle-CPU bug from `backgroundThrottling: false` is already fixed by `stream-throttle.ts` |

## 5. Ranked plan

Ranked by measured cost. Each item: the change, the expected saving in the
units measured, the risk, what it must not break.

1. **Put Hermes under one cgroup with a ceiling.** Today the renderer, GPU
   process and zygotes sit in `session-3.scope` while main and the backend sit
   in an `app-…scope`, because this run was launched from a shell. A
   `hermes.slice` with `CPUQuota` (600 % worked for the batch slice where
   `CPUWeight` did nothing) and the launcher wrapping the binary in
   `systemd-run --slice`. Saving: bounds the 30 to 38 % renderer spikes and the
   24 % backend spikes so a turn cannot take the package with it. Risk: a too
   low quota slows streaming; start at 600 %, measure. Must not break: the
   backend spawn tree must land in the same slice or the cap misses it.
2. **Make the two suspected lifetime leaks measured, then fix them.** The
   audio stream (1,037 wakeups per 10 s at idle, one thread) and the MCP
   server that is never recycled (146 MB). Reproduction for each is in section
   6. Saving: 146 MB RSS and 100 wakeups a second at idle. Risk: none if the
   release is scoped to "no voice session, no tool call in N minutes".
3. **Bound embedded browser guests.** N open tabs are N renderers and there
   is no ceiling. Add a per-conversation cap (2 tabs is what a person uses) and
   a global cap with LRU discard of a *hidden* guest whose conversation has not
   been on screen for M minutes, by closing the tab through the existing
   `closeRightRailTab` so every registry releases. Saving: one guest renderer
   is 60 to 150 MB and a share of the iGPU; the 39 % iGPU by Hermes in the
   10:13 stall is compositing plus guests. Risk: a page the agent was driving
   loses scroll and form state. Mitigation: never discard a tab whose owner
   session is busy. Must not break: hide-not-filter, unowned tabs visible
   everywhere, one tab list.
4. **Drop or shrink the trigram index.** 205 MB of the 631 MB database is a
   second full-text index. If substring search is not a feature the user
   reaches for, drop it; if it is, cap it to the last 30 days of messages.
   Saving: 205 MB of hot file, a third of the extents, and a proportional
   share of the 13 MB per 4 minutes of writes. Risk: search regressions.
   Must not break: `hermes db optimize` remains opt-in, no background VACUUM.
5. **A timer for `prune_transcripts.py`.** 572 MB growing about 36 MB a day
   with a pruner that nobody runs. Saving: the archive stops growing. Risk:
   none, it never deletes.
6. **`close_fds=True` on the backend spawn.** Twelve leaked GPU cache
   descriptors. Saving: nothing measurable, it is hygiene, but it is also the
   kind of thing that keeps a cache file un-deletable.
7. **One "end this conversation" function.** The renderer already funnels
   `closeBrowserTabsForSession`, `clearSessionSubagents` and state eviction
   through session end; the backend side (LSP clients bound to that project,
   MCP servers spawned for it, the audio stream) has no equivalent hook. Add
   `end_session(session_id)` in the backend that every close path calls, so a
   release is one function and not a step each path remembers.

## 5b. Done on 7 Sep

- **Item 1, the ceiling.** `~/.config/systemd/user/hermes.slice` with
  `CPUQuota=600%`. The launcher (`hermes_cli/main_desktop.py`) wraps the
  binary in a transient scope inside it when the unit exists. The running
  backend, Electron main, the LSP and MCP children were moved into the slice
  live (`hermes-desktop-live.scope`); the renderer and GPU process could not
  be: they sit in `session-3.scope`, outside the user manager's subtree, and the
  kernel refuses the move. They join at the next launch through the launcher.
- **Item 2, the audio thread.** Confirmed and fixed, see the lifetimes table.
  The live backend keeps its thread until it is restarted.
- **Item 2, the MCP server.** Cleared: the recycler works and kills the
  process. The 40-minute lifetime I saw was 900 s of idle counted from the
  last tool call, which the agent had made.

## 5c. Done on 7 Sep, second pass

- **Item 3, guest ceiling.** `app/chat/browser-guest-budget.ts`: over
  `MAX_BROWSER_GUESTS` (6) the least recently shown Browser tab closes through
  `closeRightRailTab`, never the tab on screen, never a tab whose owner is
  mid-turn. Enforced on tab-list growth only.
- **Item 4, trigram.** A knob, not a drop: `sessions.trigram_fts` (default on).
  Off reclaims 205 MB at the next open and loses partial-word matches; the
  LIKE fallback covers short CJK terms only, so this is a real trade and it is
  the user's to make. Leave it on unless disk or write load is the complaint.
- **Item 5, pruning.** `prune-transcripts.timer`, daily at 5:00 AM, in
  `~/.config/systemd/user`. Dry run showed 0.2 MB to strip today.
- **Item 6, descriptors.** `close_inherited_host_files` in `_run_serve`.
- **Item 7, one end-session function.** Already the shape on both sides:
  the renderer funnels through session end, the backend through
  `_teardown_session` (agent.close). The two backend lifetimes it did not
  cover, the audio probe and MCP servers, have their own release now
  (`_probe_audio`) or already had one (the recycler). Nothing more to add
  without a new leak to point at.

## Not a leak: the git badge

Three open chats showed the same `+4658 -419`. The badge is keyed by the
session's cwd and probes `git status` per cwd; `state.db` shows those three
sessions all live in `R/Projects/P/sbartube`, the fourth in `eqfez.games` and
it shows its own numbers. The badge is the repo's working-tree diff, not the
conversation's own edits; git cannot attribute a diff to a chat.

## 6. Suspected, unmeasured

- **LSP reaper.** Same shape: leave the sbartube chat idle 11 minutes, check
  `pgrep -a tsserver`.
- **13 MB per 4 minutes of idle writes.** Attributed to state.db by
  elimination (no open fd grew), not by tracing. `strace` is not installed;
  `fatrace` or `bpftrace` would settle it.
- **Renderer main-thread cost during a turn.** Lifetime ticks say JavaScript
  dominates over compositing 5 to 1, but no per-turn profile exists. A
  `--cpu-prof` run during one streaming turn would rank the hot paths.

## 7. Not proposed, on purpose

earlyoom, uresourced, tuned profile, MGLRU settings: settled in the casebook.
The embedded browser ownership model: rebuilt this week, not the leak.
`nice` for anything: ordering, not watts, and permanent (auto-nice casebook).
