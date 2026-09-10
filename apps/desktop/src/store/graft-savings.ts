import { atom } from 'nanostores'

import { graftResultText, isGraftTool, sumGraftSavings } from '@/components/assistant-ui/tool/graft-model'

/**
 * Running Graft tally per session: how many context-graph calls the agent
 * made and how many tokens their `[graft] tokens saved ≈ N` lines add up to.
 * The Claude Code statusline carries the same figure; here the statusbar
 * reads it for the focused session.
 *
 * Keyed by RUNTIME session id (the id gateway tool events arrive under), the
 * same key the composer status stack and statusbar readouts use. Fed only by
 * live `tool.complete` events, so a reloaded transcript starts from zero
 * (the per-row figures still render from the stored results).
 */
export interface GraftSessionSavings {
  calls: number
  tokensSaved: number
}

export const $graftSavingsBySession = atom<Record<string, GraftSessionSavings>>({})

// tool.complete can be replayed for one call (progress + complete, reconnect
// mirrors); a tool id counts once.
const seenToolIds = new Map<string, Set<string>>()

export function recordGraftToolResult(sessionId: string, toolId: string, toolName: string, result: unknown): void {
  if (!sessionId || !isGraftTool(toolName)) {
    return
  }

  if (toolId) {
    let seen = seenToolIds.get(sessionId)

    if (!seen) {
      seen = new Set()
      seenToolIds.set(sessionId, seen)
    }

    if (seen.has(toolId)) {
      return
    }

    seen.add(toolId)
  }

  const saved = sumGraftSavings(graftResultText(result))
  const current = $graftSavingsBySession.get()
  const prior = current[sessionId] ?? { calls: 0, tokensSaved: 0 }

  $graftSavingsBySession.set({
    ...current,
    [sessionId]: { calls: prior.calls + 1, tokensSaved: prior.tokensSaved + saved }
  })
}

export function graftSavingsFor(sessionId: null | string | undefined): GraftSessionSavings | null {
  return sessionId ? ($graftSavingsBySession.get()[sessionId] ?? null) : null
}

/** Test seam. */
export function resetGraftSavings(): void {
  seenToolIds.clear()
  $graftSavingsBySession.set({})
}
