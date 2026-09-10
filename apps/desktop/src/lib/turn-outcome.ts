/**
 * The turn outcome contract, renderer side: three short lists the backend
 * writes after a turn settles (`agent/turn_outcome.py`), pinned under the turn
 * and never folded. Design: docs/design/herwork-workspace.md, Part 4.
 *
 * Pure coercion only. The wire (a live `session.outcome` event) and the DB
 * (`display_metadata.turn_outcome` on the final assistant row) carry the same
 * shape, and both are untrusted input to this end, so both pass through
 * `readTurnOutcome` before anything renders them.
 */

export interface TurnOutcome {
  delivered: string[]
  failed: string[]
  open: string[]
  source: 'model' | 'rules'
}

/** Same numbers as `MAX_ITEMS` / `ITEM_LIMIT` in `agent/turn_outcome.py`. The
 *  backend refuses to emit more; this end guards against an older backend. */
export const OUTCOME_MAX_ITEMS = 3
export const OUTCOME_ITEM_LIMIT = 140

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= OUTCOME_ITEM_LIMIT ? flat : `${flat.slice(0, OUTCOME_ITEM_LIMIT - 1).trimEnd()}…`
}

function readList(raw: unknown): null | string[] {
  if (raw === undefined || raw === null) {
    return []
  }

  if (!Array.isArray(raw)) {
    return null
  }

  const items: string[] = []

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue
    }

    const text = clip(entry)

    if (text && !items.includes(text)) {
      items.push(text)
    }

    if (items.length >= OUTCOME_MAX_ITEMS) {
      break
    }
  }

  return items
}

/** Whole or nothing: a payload that is not the contract yields `null`, and so
 *  does one with nothing to say, because an empty row is not an outcome. */
export function readTurnOutcome(raw: unknown): null | TurnOutcome {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const record = raw as Record<string, unknown>
  const delivered = readList(record.delivered)
  const failed = readList(record.failed)
  const open = readList(record.open)

  if (!delivered || !failed || !open) {
    return null
  }

  if (delivered.length + failed.length + open.length === 0) {
    return null
  }

  return { delivered, failed, open, source: record.source === 'model' ? 'model' : 'rules' }
}
