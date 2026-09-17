# Sending mid-turn: attribution, delivery, and the false teardown

Reported 16 September 2026, desktop app. A turn was running a foreground terminal batch
(`sleep 200; ... find ...`). The user sent a follow-up. The tool row was marked aborted, the
turn settled as the bare string `Operation interrupted.`, and the follow-up left no bubble.

## What the follow-up's own path does

Composer, busy, plain text: [use-composer-submit.ts:279](apps/desktop/src/app/chat/composer/hooks/use-composer-submit.ts:279)
-> `session.redirect` -> [InterruptControlMixin.redirect](agent/interrupt_control.py:228). Three branches:
tools running -> steer plus a yield request; model request in flight -> cancel only that request
and rebuild; neither -> decline so the caller queues.

None of the three can produce `Operation interrupted.`. That string comes only from
[close_interrupted_tool_sequence](agent/message_sanitization.py:185), which is on the `interrupt()`
path, and `redirect()` deliberately does not fan out to tool workers or child agents. So another
caller stopped that turn, and the settled turn said nothing about which.

That is what the work below fixes: the next occurrence names its own cause, the two most likely
callers can no longer fire spuriously, and an accepted-but-waiting correction says so.

## Delivered

### 1. Interrupt attribution — [agent/interrupt_origin.py](agent/interrupt_origin.py)

`interrupt(origin=...)` carries which stop path fired into the settled turn: the transcript
placeholder ("Operation interrupted: the app lost its connection to the agent..."), the turn
result's `interrupt_origin`, and the log line. An open registry, so a new stop path is one
`register_interrupt_origin` call rather than an edit at every call site.

Attributed: user stop, user message, ws orphan reap, liveness watchdog, lease lost, compute host,
session closed, turn timeout, internal retry. Unattributed callers keep the byte-identical
historical string, so nothing downstream that matched it changes meaning, and `unknown` in a
report is a grep target rather than a guess.

`hard_interrupt` deliberately does NOT default to `user_stop`: shutdown, timeout and cache
invalidation all hard-stop turns, and "you stopped it" would be a confident lie where `unknown`
is honest. The origin rides the compat shim
([interrupt_compat.py](agent/interrupt_compat.py:22)) on the same terms as `tool_reason`, so a
third-party agent that predates attribution settles as `unknown` rather than raising.

### 2. The false teardown — [gateway-liveness-policy.ts](apps/desktop/src/lib/gateway-liveness-policy.ts)

The renderer force-closed the socket after a 2-probe streak, roughly 3 seconds of grace against
stalls that last minutes; the gateway then saw its client vanish mid-turn and reaped the session.
Replaced with two better signals:

- **A recent inbound frame is positive proof** the transport is alive, which a ping timeout can
  never supply. `JsonRpcGatewayClient.msSinceLastFrame` stamps every decoded frame and resets on
  connect, so a reconnect is never credited with the old socket's liveness.
- **A time budget, not a probe count**: while work is in flight, failures are tolerated for
  `LIVENESS_MAX_DEFERRAL_MS` (120s) with exponential re-probe backoff capped at 30s. The backend
  defers its own reap while turn activity is fresh (`ws_orphan_activity_stale_s`, 600s), five
  times this budget, so holding on cannot strand a session.

Idle sockets still close on the first failure, and malformed counters fail closed.

### 3. The message that looked eaten — the `delivery` field

`status: redirected` only ever said *accepted*. But a redirect degrades to a steer whenever there
is no model request to cancel, and that steer can sit behind a command the backend cannot hand to
the background. Accepted-and-waiting and accepted-and-delivered were indistinguishable.

`redirect()` and `/steer` now record `model_cancelled` / `tool_boundary` / `tool_boundary_blocked`;
the correction RPCs return it; the desktop keeps a per-session
[store](apps/desktop/src/store/correction-delivery.ts) and renders a
[status row](apps/desktop/src/app/chat/composer/status-stack/pending-correction-row.tsx) saying
"Waiting for the running command" with the message text. The gateway's busy ack stopped promising
"I'll adjust" for a correction that is actually waiting.

Recording lives on `record_correction_delivery`, not inside `steer()`: `steer()` is a primitive
the drain-requeue path also calls, and stamping there left a stale mode for the next correction.
The slot is cleared at the turn boundary with the attribution slots.

### 4. The redirect dead window — [conversation_loop.py](agent/conversation_loop.py:1604)

Between `_model_request_active.clear()` and `_executing_tools = True`, `redirect()` saw neither
flag and declined — the same answer for "the turn is over" and "the loop is between phases", so a
correction typed at the wrong millisecond was demoted to a separate follow-up turn. A
`_turn_loop_active` event now spans the whole loop: alive-between-phases degrades to a steer that
lands at the next tool boundary; genuinely over still declines so the caller queues.

### 5. Yield honesty — [tools/interrupt.py](tools/interrupt.py)

`yield_to_background_handler` returns `None` for any non-local backend, so on docker or
singularity the yield request was accepted and silently dropped. A `yieldable_wait` scope now
publishes which waits can honour a yield (feeding the `delivery` mode above) and, on exit, drops
an unconsumed request — a latent bug where a yield nobody consumed would release the *next*,
unrelated command.

### 6. Tests

| File | What it pins |
|---|---|
| [tests/agent/test_interrupt_origin.py](tests/agent/test_interrupt_origin.py) | registry, publication, settlement, the unattributed path staying byte-identical |
| [tests/agent/test_redirect_delivery.py](tests/agent/test_redirect_delivery.py) | the dead window, both decline cases, delivery modes, the yield registry |
| [tests/tui_gateway/test_correction_delivery_rpc.py](tests/tui_gateway/test_correction_delivery_rpc.py) | the RPC field, and that a raising reader never costs the correction |
| [tests/tui_gateway/test_interrupt_attribution.py](tests/tui_gateway/test_interrupt_attribution.py) | Stop and the reaper no longer settle alike |
| [gateway-liveness-policy.test.ts](apps/desktop/src/lib/gateway-liveness-policy.test.ts) | frame proof, budget, backoff bounds |
| [json-rpc-gateway-frame-clock.test.ts](apps/desktop/src/lib/json-rpc-gateway-frame-clock.test.ts) | the frame clock, including reset on reconnect |
| [correction-delivery.test.ts](apps/desktop/src/store/correction-delivery.test.ts) | store semantics, session isolation |
| [pending-correction-row.test.tsx](apps/desktop/src/app/chat/composer/status-stack/pending-correction-row.test.tsx) + [-section](apps/desktop/src/app/chat/composer/status-stack/pending-correction-section.test.tsx) | the row, and that it never summons an empty status card |

## Verification

Run through `scripts/run_tests.sh`, the canonical per-file-isolated runner. That matters: the
same suites in one shared pytest process report ~20 extra failures from cross-file state leakage,
on a clean `HEAD` worktree just as much as here.

| Suite | Result |
|---|---|
| `tests/gateway` + `tests/tui_gateway` (9,217) | **1 failed** — the untracked `.claude/settings.json` below |
| `tests/agent` (~9,400) | 7 failed in 5 files — **every one reproduced on a clean `HEAD` worktree** |
| every touched suite, scoped (427 + 49) | all pass |
| desktop vitest: `src/lib`, `src/store`, `src/app/chat/composer`, `src/app/gateway` (3,748) | all pass |
| `apps/shared` (102) | all pass |
| `tsc --noEmit`, `eslint` on touched files | clean |

Six of the seven agent-suite failures are in `test_relay_*`, from another agent's in-flight work
in `agent/relay_runtime.py`; the seventh is the documented host-state family
(`test_auxiliary_main_first` reading real provider config). All seven were reproduced on a clean
`git worktree` at `HEAD` before being set aside.

The single gateway failure,
`test_async_session_store.py::test_no_repository_local_claude_permissions_file`, is a
working-tree fact rather than a code one: an untracked `.claude/settings.json` dating to
11 September belongs to another agent sharing this checkout, so it was left alone.

### Tests this work had to change

Nine assertions pinned the exact call signature of `interrupt(...)` and now see the attribution
keyword. Each was updated to state the new contract rather than loosened:
`test_multiplex_busy_input_mode` (2), `test_agent_loop_stopped_hook` (2), `test_busy_session_ack`,
`test_gateway_shutdown`, `test_hygiene_deferred_work_drain` (2), `test_subagent_protection`. One
behavioral test, `use-gateway-boot.test.tsx`'s "repeated timeouts while busy still rebuild the
socket", now asserts both halves of the new policy: kept inside the budget, rebuilt past it.

### Three bugs the tests caught in this work

1. **Five lease and watchdog tests broke** because `origin=` was passed directly to an agent
   whose `interrupt` predates it. Fixed by probing the keyword (`_origin_kwargs`,
   `request_interrupt`) the way the compat shim already does for `tool_reason` — the gateway's
   busy paths call the soft interrupt inside broad `except` blocks, where that `TypeError` would
   not have surfaced as a bug but as a silently skipped interrupt.
2. **Eight orphan-reap tests broke** on `NameError: _io`. `bind_module` re-creates every function
   in a split `tui_gateway` module against `server`'s globals, so a module-level import there is
   invisible at call time. Fixed with call-time imports, plus a test pinning the literal default
   against the constant it mirrors.
3. **The status stack rendered an empty card** over an idle composer, because the
   pending-correction section was pushed whenever a session existed and only its body rendered
   null. Caught by the existing goal-indicator suite; now pinned by its own test.

## Cleanup pass

A four-angle review (reuse / simplification / efficiency / altitude) ran over the finished diff.
What it changed:

- **One kwarg-gating rule, not three.** `origin_kwargs` in `agent/interrupt_compat.py` is now the
  single place deciding how `origin` is feature-detected; `request_interrupt`,
  `request_hard_interrupt` and the turn lease all call it. The lease had been importing that
  module's private `_accepts_keyword`.
- **One origin slot, not two.** `clear_interrupt` no longer hands the attribution to a second
  slot: nothing reads it as "an interrupt is live" (`_interrupt_requested` is that flag), so it
  simply outlives the clear and the turn boundary resets it.
- **`steer()` records its own delivery.** It was left out on the grounds that an internal requeue
  also calls it — but that meant six external callers under-reported, and `session.steer` could
  return a mode left over from an earlier `redirect`. Now `steer()` records and the one internal
  requeue passes `record_delivery=False`.
- **One delivery resolution, not three spellings.** `record_correction_delivery(thread_ids=...)`
  resolves the tool-boundary case; the two steer branches no longer each compute it, and the
  branch that had hardcoded `tool_boundary` no longer disagrees with them.
- **The invalidation map is the single source.** `/stop`'s two call sites were passing
  `origin=USER_STOP` explicitly *and* mapping it, so the map was exercised only by a test. The
  overrides and the now-unused `origin` parameter are gone.
- **The unreachable policy branch is gone.** `decideLivenessForceClose`'s streak fallback could
  never run: the only caller always supplies `deferredForMs`. Dropping it removed
  `consecutiveFailures`, `LIVENESS_PROBE_FAILURE_STREAK` and the `failure-streak-exhausted`
  reason from the policy's surface.
- **The re-probe re-probes.** It was calling `reconnectNow()`, which first redials every closed
  secondary gateway and resets its backoff to attempt 0. Under the old 2-failure streak that
  happened once per episode; under the 120s budget it would fire on every deferred probe, so no
  secondary's backoff could advance while the primary waited. Extracted `probeLiveness()`.
- **`livenessReprobeDelayMs` delegates** to the shared `reconnectBackoffDelayMs`.
- **The status row is presentational** and built on the shared `StatusRow` (it had hand-rolled
  the container, so it rendered at a different height with no hover treatment next to the queue
  and subagent rows). The visibility gate now lives only in the stack, which is where the
  empty-card bug came from having it in both.
- **Dead surface removed**: `is_thread_yieldable`, `is_interrupt_placeholder`,
  `agent_interrupt_placeholder`, `InterruptOrigin.user_initiated`, `PendingCorrection.acceptedAt`,
  the `_INTERRUPT_ORIGIN_*` aliases in `gateway/run.py`, and a one-line wrapper in
  `turn_finalizer.py` that shadowed a direct call in the same file.
- **`yieldable_wait` is a `@contextmanager`** over `mark_thread_yieldable` /
  `clear_thread_yieldable`, so the terminal wait (whose `try` has four `return`s) calls the
  functions instead of driving `__enter__`/`__exit__` by hand.

One finding surfaced a better answer than the one proposed: rather than give `steer()` a
`record_delivery` flag for the single internal hand-back that must not stamp a delivery, that
hand-back now uses `_requeue_pending_steer` — the helper that already existed for "put text back,
it is not a new correction". `steer()` keeps no flag at all.

Two findings were skipped. Swapping the lease's `_interrupt_turn` for `request_hard_interrupt`
was reverted: that shim prefers `hard_interrupt` when the agent has one, which would bypass an
instance-level `interrupt` override — a behavior change, and three lease tests caught it. And
`_stamp_media_replay_sidecar` in `turn_finalizer.py` drew findings but belongs to another agent's
in-flight work in this shared checkout.

## Not done

Adopting a container backend's process into the background registry. There is no adoptable host
process for docker or singularity, so the yield stays unhonoured there; what changed is that it
is now *reported* as blocked instead of silently dropped. Doing it properly means a container-side
process registry, which is its own piece of work.
