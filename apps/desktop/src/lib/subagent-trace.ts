/**
 * TEMPORARY diagnostic for one open question: a subagent activity row for one
 * conversation appeared in every open conversation at once.
 *
 * Everything static analysis can settle has been settled. The transcript is
 * correct (the command appears in exactly one session's rows), the backend's
 * process filter is correct, unscoped `subagent.*` events are dropped rather
 * than attributed to the focused chat, the delegate fallback only fires for
 * `delegate_task`, and the event dispatcher is mounted once per window. Every
 * one of those paths reads correct, and the bug happens anyway, so one of those
 * five readings is wrong and no amount of further reading will say which.
 *
 * This records the two facts that name it: what session id the frame carried,
 * and what session id the row was finally written under. When those differ, or
 * when one row is written under several ids, the answer is in the log.
 *
 * DELETE THIS FILE and its two call sites once the question is answered.
 */

const LIMIT = 400
const PREFIX = '[subagent-trace]'
const FLAG = 'hermes.debug.subagentTrace'

/**
 * OFF unless explicitly switched on, and that is not only politeness.
 *
 * Tracing every write cost enough time per call to separate two subagents that
 * previously shared a millisecond, which flipped their spawn order and broke a
 * real ordering test. Instrumentation that changes what it measures is worse
 * than none, so it stays inert until asked for.
 */
let enabled = false

function readFlag(): boolean {
  try {
    return window.localStorage?.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

export interface SubagentTraceEntry {
  at: string
  stage: string
  detail: Record<string, unknown>
}

declare global {
  interface Window {
    __subagentTrace?: SubagentTraceEntry[]
    __subagentTraceDump?: () => string
    __subagentTraceOn?: (on?: boolean) => string
  }
}

function ring(): SubagentTraceEntry[] {
  if (typeof window === 'undefined') {
    return []
  }

  if (!window.__subagentTrace) {
    window.__subagentTrace = []
    // Reading a long console is painful; this hands the whole log over as one
    // string the user can copy in a single action.
    window.__subagentTraceDump = () => JSON.stringify(window.__subagentTrace ?? [], null, 2)
  }

  return window.__subagentTrace
}

/** Switch tracing on (persisted, so it survives the reload this asks for). */
export function installSubagentTraceSwitch(): void {
  if (typeof window === 'undefined' || window.__subagentTraceOn) {
    return
  }

  enabled = readFlag()

  window.__subagentTraceOn = (on = true) => {
    enabled = on

    try {
      if (on) {
        window.localStorage?.setItem(FLAG, '1')
      } else {
        window.localStorage?.removeItem(FLAG)
      }
    } catch {
      // Private mode or a locked-down store: the in-memory switch still works
      // for this window, which is all a single reproduction needs.
    }

    return on ? 'subagent tracing ON. Reproduce, then run __subagentTraceDump()' : 'subagent tracing OFF'
  }
}

export function traceSubagent(stage: string, detail: Record<string, unknown>): void {
  if (!enabled || typeof window === 'undefined') {
    return
  }

  const entry: SubagentTraceEntry = { at: new Date().toISOString(), detail, stage }
  const log = ring()

  log.push(entry)

  if (log.length > LIMIT) {
    log.splice(0, log.length - LIMIT)
  }

   
  console.info(PREFIX, stage, detail)
}
