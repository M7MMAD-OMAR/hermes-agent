import type { GatewayEventPayload } from '@/lib/chat-messages'
import { normalizePersonalityValue } from '@/lib/chat-runtime'
import { isTodoToolName } from '@/lib/todos'

import type { ClientSessionState } from '../../../types'

type SessionRuntimeStatePatch = Partial<
  Pick<
    ClientSessionState,
    'branch' | 'cwd' | 'fast' | 'model' | 'personality' | 'provider' | 'reasoningEffort' | 'serviceTier' | 'yolo'
  >
>

export function sessionInfoStatePatch(payload: GatewayEventPayload | undefined): SessionRuntimeStatePatch {
  const patch: SessionRuntimeStatePatch = {}

  if (typeof payload?.model === 'string') {
    patch.model = payload.model || ''
  }

  if (typeof payload?.provider === 'string') {
    patch.provider = payload.provider || ''
  }

  if (typeof payload?.cwd === 'string') {
    patch.cwd = payload.cwd
  }

  if (typeof payload?.branch === 'string') {
    patch.branch = payload.branch
  }

  if (typeof payload?.personality === 'string') {
    patch.personality = normalizePersonalityValue(payload.personality)
  }

  if (typeof payload?.reasoning_effort === 'string') {
    patch.reasoningEffort = payload.reasoning_effort
  }

  if (typeof payload?.service_tier === 'string') {
    patch.serviceTier = payload.service_tier
  }

  if (typeof payload?.fast === 'boolean') {
    patch.fast = payload.fast
  }

  if (typeof payload?.yolo === 'boolean') {
    patch.yolo = payload.yolo
  }

  return patch
}

export function hasSessionInfoStatePatch(patch: SessionRuntimeStatePatch): boolean {
  return Object.keys(patch).length > 0
}

/** Keep the runtime-state object when a heartbeat only restates cached fields.
 *  `$sessionStates` feeds every mounted session surface, so an equivalent spread
 *  re-renders them all at the heartbeat cadence. */
export function applySessionInfoStatePatch(
  state: ClientSessionState,
  patch: SessionRuntimeStatePatch
): ClientSessionState {
  if (
    (patch.branch === undefined || patch.branch === state.branch) &&
    (patch.cwd === undefined || patch.cwd === state.cwd) &&
    (patch.fast === undefined || patch.fast === state.fast) &&
    (patch.model === undefined || patch.model === state.model) &&
    (patch.personality === undefined || patch.personality === state.personality) &&
    (patch.provider === undefined || patch.provider === state.provider) &&
    (patch.reasoningEffort === undefined || patch.reasoningEffort === state.reasoningEffort) &&
    (patch.serviceTier === undefined || patch.serviceTier === state.serviceTier) &&
    (patch.yolo === undefined || patch.yolo === state.yolo)
  ) {
    return state
  }

  return { ...state, ...patch }
}

// Minimum gap between two assistant-text flushes during a stream. Was 16ms
// (rAF only), which at typical LLM token rates of ~30-80 tok/sec meant every
// token got its own React commit + Streamdown markdown re-parse, scaling
// linearly with the growing last-block length. Bumping to 33ms lets ~2 tokens
// batch into one commit at 60 tok/sec without introducing visible lag on the
// streaming text (still 30 fps of visible text growth). Big perceived
// smoothness win on long messages with big trailing paragraphs; see
// `scripts/profile-typing-lag.md` for the measurement work behind this.
export const STREAM_DELTA_FLUSH_MS = 33

// Ceiling for the ADAPTIVE flush gap (see scheduleDeltaFlush). Under heavy
// multi-stream load the gap stretches to 3x the measured flush cost so the
// main thread stays responsive to input; this cap guarantees streaming text
// still visibly updates at least ~4x per second no matter the load.
export const MAX_STREAM_FLUSH_GAP_MS = 250

// Flush floor while the window is NOT focused. While any turn is in flight the
// main process unthrottles chat windows, which pins `document.visibilityState`
// to `visible` even for a window parked on another workspace or behind
// everything else, so a hidden Hermes with several streaming sessions kept
// re-rendering markdown 30 times a second for nobody. Focus is the one honest
// signal left: unfocused text grows at 10 updates a second (still fluid on a
// second monitor, one third of the commits), and the focus handler flushes
// whatever is queued the instant the user comes back.
export const UNFOCUSED_STREAM_FLUSH_MS = 100

// Flush floor while the window is not being PRESENTED at all — parked on
// another workspace, minimised, fully covered. Focus already slows an
// unfocused window to 10 commits a second, which is the right cadence for a
// window someone can still see on a second monitor; for a window whose pixels
// go nowhere it is still ten markdown re-parses a second per streaming
// session, and this user runs eight at once. The deltas keep arriving and keep
// landing in the queue either way: only the paint waits, at most a second, and
// the return handler flushes on the way back in. See lib/window-presented.ts
// for why a frame, not `document.visibilityState`, is what proves this.
export const HIDDEN_STREAM_FLUSH_MS = 1_000

/** The gap the next flush waits out.
 *
 *  The floor comes from how much of this window the user can actually see, and
 *  presentation outranks focus: an unfocused window on a second monitor is
 *  still being read, a focused-looking window on another workspace is not.
 *  From there the gap stretches toward 3x what the last flush cost, so a heavy
 *  multi-stream commit leaves the main thread idle frames for input.
 *
 *  MAX_STREAM_FLUSH_GAP_MS caps the COST stretch only. Capping the result
 *  would also cap the floor, which quietly clamped the hidden floor back to
 *  250ms: the promise that cap exists to keep, that text never updates slower
 *  than 4 times a second, is a promise about text somebody is watching. */
export function streamFlushGapMs({
  focused,
  lastFlushCostMs,
  presented
}: {
  focused: boolean
  lastFlushCostMs: number
  presented: boolean
}): number {
  const floor = presented ? (focused ? STREAM_DELTA_FLUSH_MS : UNFOCUSED_STREAM_FLUSH_MS) : HIDDEN_STREAM_FLUSH_MS

  return Math.max(floor, Math.min(lastFlushCostMs * 3, MAX_STREAM_FLUSH_GAP_MS))
}

// How long an optimistically armed turn (busy/awaitingResponse set at submit /
// restore / edit, before the backend confirms it live) may hold off a
// session.info running=false heartbeat. Within this window a running=false is
// treated as a PRE-START report — the submit round trip hasn't finished, so
// settling on it would drop the spinner and reopen the send guard mid-flight.
// Past it, the gateway's running=false is authoritative: the turn never went
// live (rewind refused after the arm, gateway bounce, dropped submit response,
// missed terminal error event) and holding busy any longer latches the
// composer shut until app restart (#86795 — every send gets queued behind a
// turn that does not exist, and the queue drain waits on busy→false forever).
// Generous vs. the real pre-start gap: the busy-retry deadline is 6s and the
// backend flips running=true on accept, so heartbeats stop carrying false
// within a couple seconds of a healthy submit.
export const PRE_TURN_LIVE_SETTLE_GRACE_MS = 15_000

// Gateway/provider failures sometimes arrive as message.complete text instead
// of an explicit error event. Treat matches as inline assistant errors so they
// persist like real error events and don't get erased by hydrate fallback.
const COMPLETION_ERROR_PATTERNS = [
  /^API call failed after \d+ retries:/i,
  /^HTTP\s+\d{3}\b/i,
  /^(Provider|Gateway)\s+error:/i
]

export function completionErrorText(finalText: string): string | null {
  const text = finalText.trim()

  return text && COMPLETION_ERROR_PATTERNS.some(re => re.test(text)) ? text : null
}

export const SUBAGENT_EVENT_TYPES = new Set([
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.thinking',
  'subagent.tool',
  'subagent.progress',
  'subagent.complete'
])

// Anonymous progress events that carry todos but no name still belong to the
// todo stream; named todo events are obviously routed there too.
export function toTodoPayload(payload: GatewayEventPayload | undefined): GatewayEventPayload | undefined {
  if (!payload) {
    return undefined
  }

  const isTodo = isTodoToolName(payload.name) || (!payload.name && Object.hasOwn(payload, 'todos'))

  return isTodo ? { ...payload, name: 'todo_list', tool_id: payload.tool_id || 'todo-live' } : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseMaybeRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return {}
    }
  }

  return asRecord(value)
}

const firstString = (...candidates: unknown[]): string => {
  for (const v of candidates) {
    if (typeof v === 'string' && v) {
      return v
    }
  }

  return ''
}

export function delegateTaskPayloads(
  payload: GatewayEventPayload | undefined,
  phase: 'running' | 'complete',
  sourceEventType?: string
): Record<string, unknown>[] {
  if (payload?.name !== 'delegate_task') {
    return []
  }

  const args = parseMaybeRecord(payload.args ?? payload.input)
  const result = parseMaybeRecord(payload.result)
  const rawTasks = Array.isArray(args.tasks) ? args.tasks : []
  const tasks = rawTasks.length ? rawTasks.map(parseMaybeRecord) : [args]
  const resultStatus = typeof result.status === 'string' ? result.status.toLowerCase() : ''
  const failedResult = Boolean(payload.error) || ['timeout', 'error', 'failed', 'failure'].includes(resultStatus)
  const status = phase === 'complete' ? (failedResult ? 'failed' : 'completed') : 'running'
  const toolId = payload.tool_id || payload.tool_call_id || payload.id || 'delegate_task'
  const progressText = firstString(payload.preview, payload.message, payload.context)

  const eventType =
    phase === 'complete'
      ? 'subagent.complete'
      : sourceEventType === 'tool.start'
        ? 'subagent.start'
        : 'subagent.progress'

  return tasks.map((task, index) => {
    const goal = firstString(task.goal, args.goal, payload.context) || 'Delegated task'
    const summary = firstString(result.summary, payload.summary, payload.message)

    return {
      depth: 0,
      duration_seconds: payload.duration_s,
      goal,
      status,
      subagent_id: `delegate-tool:${toolId}:${index}`,
      summary: summary || undefined,
      task_count: tasks.length,
      task_index: index,
      text: eventType === 'subagent.progress' ? progressText || goal : undefined,
      tool_name: eventType === 'subagent.start' ? 'delegate_task' : undefined,
      tool_preview: eventType === 'subagent.start' ? progressText : undefined,
      toolsets: Array.isArray(task.toolsets) ? task.toolsets : Array.isArray(args.toolsets) ? args.toolsets : [],
      event_type: eventType,
      output_tail:
        phase === 'complete' && summary
          ? [{ is_error: Boolean(payload.error), preview: summary, tool: 'delegate_task' }]
          : undefined
    }
  })
}
