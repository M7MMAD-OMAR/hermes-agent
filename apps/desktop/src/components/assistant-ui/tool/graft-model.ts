import { translateNow } from '@/i18n'
import { firstStringField } from '@/lib/text'

import { compactPreview, isRecord, parseMaybeObject } from './fallback-model/format'

/**
 * Graft (github.com/nanonets/graft) serves a repo's context graph over MCP.
 * Hermes registers its tools as `mcp__graft__graft_<op>`; every retrieval
 * result opens with a `[graft] tokens saved ≈ N (P%) ...` line that names how
 * much reading the covered files whole would have cost. This module is the
 * pure side of the tool row: it recognises the tools, parses that line plus the
 * per-operation headline facts out of the result text, and phrases them.
 */

export type GraftOp = 'ask' | 'callers' | 'check' | 'grep' | 'map' | 'skeleton'

export type GraftFreshness = 'fresh' | 'missing' | 'stale'

export interface GraftSavings {
  /** Files the call covered, per the savings line (`reading the N file(s)`). */
  files?: number
  /** Share of the baseline the call avoided, 0..100. */
  percent?: number
  tokensSaved: number
}

export interface GraftFacts {
  /** Only for `check`: whether the wiring graph matches the code. */
  freshness?: GraftFreshness
  /** Ranked hits (`ask`), grep matches (`grep`), or signatures (`skeleton`). */
  hits?: number
  /** Files in the index, when the result states it (`grep`, `map`). */
  indexedFiles?: number
  op: GraftOp
  savings: GraftSavings | null
  /** `in` argument: the subtree the call was narrowed to. */
  scope?: string
  /** The query / pattern / file / symbol the call was about. */
  target?: string
}

const GRAFT_TOOL_RE = /^(?:mcp__graft__)?graft_(find_code|find_all|file_api|trace_calls|repo_map|check_freshness)$/

const OP_BY_TOOL: Record<string, GraftOp> = {
  check_freshness: 'check',
  file_api: 'skeleton',
  find_all: 'grep',
  find_code: 'ask',
  repo_map: 'map',
  trace_calls: 'callers'
}

const SAVINGS_RE = /\[graft\] tokens saved ≈ ([\d,]+)(?:\s*\((\d+)%\))?(?:[^\n]*?reading the (\d+) (?:source )?file\(s\))?/

const SAVINGS_LINE_RE = /^[ \t]*\[graft\] tokens saved[^\n]*\n*/gm

/** `mcp__graft__graft_find_code` (or the bare MCP name) → `ask`; null otherwise. */
export function graftOperation(toolName: string): GraftOp | null {
  const match = GRAFT_TOOL_RE.exec(toolName)

  return match ? (OP_BY_TOOL[match[1]!] ?? null) : null
}

export function isGraftTool(toolName: string): boolean {
  return graftOperation(toolName) !== null
}

const parseCount = (raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return undefined
  }

  const n = Number(raw.replace(/,/g, ''))

  return Number.isFinite(n) ? n : undefined
}

/**
 * The text of a tool result however the transport shaped it: the joined
 * string Hermes stores, an MCP `content` block list, or a wrapper record.
 */
export function graftResultText(result: unknown): string {
  if (typeof result === 'string') {
    return result
  }

  if (Array.isArray(result)) {
    return result
      .map(block => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
  }

  const record = parseMaybeObject(result)

  if (Array.isArray(record.content)) {
    return graftResultText(record.content)
  }

  return firstStringField(record, ['result', 'output', 'text', 'data'])
}

/** The `[graft] tokens saved ≈ N (P%) ... reading the F file(s)` line, parsed. */
export function parseGraftSavings(text: string): GraftSavings | null {
  const match = SAVINGS_RE.exec(text)

  if (!match) {
    return null
  }

  const tokensSaved = parseCount(match[1])

  if (tokensSaved === undefined) {
    return null
  }

  const percent = parseCount(match[2])
  const files = parseCount(match[3])

  return {
    tokensSaved,
    ...(percent !== undefined ? { percent } : {}),
    ...(files !== undefined ? { files } : {})
  }
}

/** Sum of every savings line in a blob (a result can carry several). */
export function sumGraftSavings(text: string): number {
  let total = 0

  for (const match of text.matchAll(/\[graft\] tokens saved ≈ ([\d,]+)/g)) {
    total += parseCount(match[1]) ?? 0
  }

  return total
}

/**
 * The result without its savings preamble: the row's meta already says what
 * that line says, and the trailing "tell the user" nudge is aimed at the
 * model, not the person reading the transcript.
 */
export function stripGraftSavingsLine(text: string): string {
  return text.replace(SAVINGS_LINE_RE, '').trim()
}

const countMatches = (text: string, re: RegExp): number => {
  let count = 0

  for (const _ of text.matchAll(re)) {
    count += 1
  }

  return count
}

function freshnessOf(text: string): GraftFreshness | undefined {
  const check = /graph check:\s*([A-Za-z]+)/i.exec(text)

  if (check) {
    return check[1]!.toUpperCase() === 'OK' ? 'fresh' : 'stale'
  }

  if (/NO GRAPH/i.test(text)) {
    return 'missing'
  }

  return undefined
}

function targetOf(op: GraftOp, args: Record<string, unknown>): string | undefined {
  const fields: Record<GraftOp, string[]> = {
    ask: ['query'],
    callers: ['symbol'],
    check: [],
    grep: ['pattern'],
    map: [],
    skeleton: ['file']
  }

  const value = firstStringField(args, fields[op])

  return value ? value.trim() : undefined
}

/** Everything the row states about one Graft call, from its args and result. */
export function parseGraftResult(toolName: string, args: unknown, result: unknown): GraftFacts | null {
  const op = graftOperation(toolName)

  if (!op) {
    return null
  }

  const argsRecord = parseMaybeObject(args)
  const text = result === undefined ? '' : graftResultText(result)
  const scope = firstStringField(argsRecord, ['in']).trim()
  const target = targetOf(op, argsRecord)

  const facts: GraftFacts = {
    op,
    savings: text ? parseGraftSavings(text) : null,
    ...(scope ? { scope } : {}),
    ...(target ? { target } : {})
  }

  if (!text) {
    return facts
  }

  if (op === 'ask') {
    const hits = countMatches(text, /^\d+\.\s+\S/gm)

    if (hits) {
      facts.hits = hits
    }
  }

  if (op === 'grep') {
    const summary = /(\d[\d,]*) hits? in \d[\d,]* symbols? across (\d[\d,]*) files? \(searched (\d[\d,]*) indexed files\)/.exec(
      text
    )

    if (summary) {
      facts.hits = parseCount(summary[1])
      facts.indexedFiles = parseCount(summary[3])
    }
  }

  if (op === 'skeleton') {
    const hits = countMatches(text, /^- L\d+/gm)

    if (hits) {
      facts.hits = hits
    }
  }

  if (op === 'map') {
    const header = /repo map\s+[\u2014-]\s+(\d[\d,]*) files/.exec(text)

    if (header) {
      facts.indexedFiles = parseCount(header[1])
    }
  }

  if (op === 'check') {
    const freshness = freshnessOf(text)

    if (freshness) {
      facts.freshness = freshness
    }
  }

  return facts
}

/** `17234` → `17.2k`, `2546026` → `2.5M`; small counts stay exact. */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }

  if (n >= 10_000) {
    return `${Math.round(n / 1_000)}k`
  }

  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  }

  return String(n)
}

const t = (key: string, ...args: unknown[]) => translateNow(`assistant.tool.graft.${key}`, ...args)

/** Header meta beside the title: the savings figure, or nothing to claim. */
export function graftSavingsLabel(facts: GraftFacts): string {
  if (!facts.savings) {
    return ''
  }

  const tokens = compactTokens(facts.savings.tokensSaved)

  return facts.savings.percent === undefined ? t('saved', tokens) : t('savedPercent', tokens, facts.savings.percent)
}

/** The count that best describes what the call returned, as a meta label. */
export function graftCountLabel(facts: GraftFacts): string {
  if (facts.op === 'check') {
    return facts.freshness ? t(`freshness.${facts.freshness}`) : ''
  }

  if (facts.op === 'map' && facts.indexedFiles !== undefined) {
    return t('indexedFiles', facts.indexedFiles)
  }

  if (facts.hits !== undefined) {
    return t('hits', facts.hits)
  }

  if (facts.savings?.files !== undefined) {
    return t('files', facts.savings.files)
  }

  return ''
}

/** One line that says what the call did and what it saved, for the row body. */
export function graftSummary(facts: GraftFacts): string {
  const parts = [graftCountLabel(facts), graftSavingsLabel(facts), facts.scope ? t('scope', facts.scope) : '']

  return parts.filter(Boolean).join(' · ')
}

/** Row title: the operation with its subject, e.g. `Graft: asked “auth flow”`. */
export function graftTitle(facts: GraftFacts, pending: boolean): string {
  const phase = pending ? 'pending' : 'done'
  const target = facts.target ? compactPreview(facts.target, 48) : ''

  if (facts.op === 'map' || facts.op === 'check' || !target) {
    return t(`titles.${facts.op}.${phase}`)
  }

  return t(`titlesWithTarget.${facts.op}.${phase}`, target)
}

/** The shimmering verb while the call is in flight ("Asking"). */
export function graftPendingAction(facts: GraftFacts): string {
  return t(`titles.${facts.op}.pendingAction`)
}
