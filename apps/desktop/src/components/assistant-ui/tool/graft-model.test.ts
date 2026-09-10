import { afterEach, describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'

import { buildToolView, type ToolPart } from './fallback-model'
import {
  graftCountLabel,
  graftOperation,
  graftResultText,
  graftSavingsLabel,
  graftSummary,
  graftTitle,
  parseGraftResult,
  parseGraftSavings,
  stripGraftSavingsLine,
  sumGraftSavings
} from './graft-model'

// Captured from `graft mcp` 0.16.0 (graft_find_code over a monorepo).
const ASK_RESULT = `[graft] tokens saved ≈ 17,234 (93%) \u2014 this pack ≈ 1,263 tok vs reading the 5 source file(s) whole ≈ 18,497 tok. Estimate (baseline = those files read in full). At the end of your reply, tell the user the total graft tokens saved this turn \u2014 sum each such line across your graft calls \u2014 e.g. "🌱 graft saved ~N tokens this turn".

graft ask \u2014 "payments checkout flow"  (lexical)

1. checkout-reservation-concurrency.mjs · file  [symbol]
   docs/project/execution/checkout-reservation-concurrency.mjs

2. [packages/billing/] checkout-session.ts · file  [symbol]
   packages/billing/src/checkout-session.ts

3. [apps/web/] PaymentsList · function  [symbol]
   apps/web/src/routes/i.$slug.payments.index.tsx:L116-L1052
   function PaymentsList()
`

// graft_find_all
const GREP_RESULT = `[graft] tokens saved ≈ 1,531 (91%) \u2014 this output ≈ 154 tok vs reading the 2 file(s) it covers whole ≈ 1,685 tok (estimate). At the end of your reply, tell the user the total graft tokens saved this turn.

"PushRendered" \u2014 4 hits in 4 symbols across 2 files (searched 1452 indexed files)

PushRendered · type · packages/notifications/src/templates/push.ts:L12-L15 · 0 in-edges
  L12: export type PushRendered = {
`

// graft_file_api
const SKELETON_RESULT = `[graft] tokens saved ≈ 720 (86%) \u2014 this output ≈ 122 tok vs reading the 1 file(s) it covers whole ≈ 842 tok (estimate).

graft skeleton \u2014 packages/notifications/src/templates/push.ts
- L12-L15  type PushRendered  type PushRendered = { title: string; body: string; };
- L17-L20  type PushTemplate  type PushTemplate = { title: string; body: string; };
- L23-L30  function interpolate  interpolate = ( template: string, vars: Record<string, unknown>, ): string
- L101-L113  function renderPushByTemplateKey  renderPushByTemplateKey = ( templateKey: string, vars: Record<string, unknown>, ): PushRendered | null
`

// graft_repo_map
const MAP_RESULT = `[graft] tokens saved ≈ 2,546,026 (100%) \u2014 this output ≈ 10,339 tok vs reading the 1452 file(s) it covers whole ≈ 2,556,365 tok (estimate).

repo map \u2014 1452 files · 7182 symbols · 19489 edges · javascript, python, tsx, typescript

## packages/notifications/
`

// graft_check_freshness: wiring graph in sync, deep (LLM) layer never built.
const CHECK_RESULT = `graft check: NO GRAPH

No graft/manifest.json found. Run \`graft build --deep\` first.

graph check: OK \u2014 the wiring graph is in sync with the code. (meaning tier 0% complete \u2014 8634 of 8634 node(s) pending)`

const graftPart = (toolName: string, args: Record<string, unknown>, result: unknown): ToolPart => ({
  args,
  isError: false,
  result,
  toolCallId: 'call_graft',
  toolName,
  type: 'tool-call'
})

afterEach(() => {
  setRuntimeI18nLocale('en')
})

describe('graftOperation', () => {
  it('maps the MCP tool names Hermes registers, prefixed or bare', () => {
    expect(graftOperation('mcp__graft__graft_find_code')).toBe('ask')
    expect(graftOperation('mcp__graft__graft_find_all')).toBe('grep')
    expect(graftOperation('mcp__graft__graft_file_api')).toBe('skeleton')
    expect(graftOperation('mcp__graft__graft_trace_calls')).toBe('callers')
    expect(graftOperation('mcp__graft__graft_repo_map')).toBe('map')
    expect(graftOperation('graft_check_freshness')).toBe('check')
  })

  it('ignores other MCP servers and core tools', () => {
    expect(graftOperation('mcp__figma__get_design_context')).toBeNull()
    expect(graftOperation('mcp__graft__something_else')).toBeNull()
    expect(graftOperation('search_files')).toBeNull()
  })
})

describe('parseGraftSavings', () => {
  it('reads tokens, percent and covered files from the preamble', () => {
    expect(parseGraftSavings(ASK_RESULT)).toEqual({ files: 5, percent: 93, tokensSaved: 17234 })
    expect(parseGraftSavings(GREP_RESULT)).toEqual({ files: 2, percent: 91, tokensSaved: 1531 })
    expect(parseGraftSavings(MAP_RESULT)).toEqual({ files: 1452, percent: 100, tokensSaved: 2546026 })
  })

  it('accepts a bare figure without percent or baseline', () => {
    expect(parseGraftSavings('[graft] tokens saved ≈ 900\n\nbody')).toEqual({ tokensSaved: 900 })
  })

  it('returns null when the call reported no savings (tiny files, freshness check)', () => {
    expect(parseGraftSavings(CHECK_RESULT)).toBeNull()
    expect(parseGraftSavings('')).toBeNull()
  })

  it('sums every savings line in a blob', () => {
    expect(sumGraftSavings(`${ASK_RESULT}\n${GREP_RESULT}`)).toBe(17234 + 1531)
    expect(sumGraftSavings(CHECK_RESULT)).toBe(0)
  })
})

describe('graftResultText', () => {
  it('unwraps MCP content blocks and wrapper records', () => {
    expect(graftResultText({ content: [{ text: 'a', type: 'text' }, { text: 'b', type: 'text' }] })).toBe('a\nb')
    expect(graftResultText({ result: 'wrapped' })).toBe('wrapped')
    // A string result is the text itself, never re-parsed: the graft body is
    // prose, and a body that happens to be JSON-shaped must still render whole.
    expect(graftResultText('plain')).toBe('plain')
    expect(graftResultText('{"result":"kept verbatim"}')).toBe('{"result":"kept verbatim"}')
  })
})

describe('stripGraftSavingsLine', () => {
  it('drops the preamble and keeps the body, wherever the line sits', () => {
    expect(stripGraftSavingsLine(ASK_RESULT).startsWith('graft ask \u2014 "payments checkout flow"')).toBe(true)
    expect(stripGraftSavingsLine('body\n[graft] tokens saved ≈ 5 (1%)')).toBe('body')
  })
})

describe('parseGraftResult', () => {
  it('counts ranked hits for ask and keeps the query and scope', () => {
    const facts = parseGraftResult(
      'mcp__graft__graft_find_code',
      { in: 'apps/web/', query: 'payments checkout flow' },
      ASK_RESULT
    )

    expect(facts).toMatchObject({
      hits: 3,
      op: 'ask',
      scope: 'apps/web/',
      target: 'payments checkout flow',
      savings: { tokensSaved: 17234 }
    })
  })

  it('reads the grep summary line', () => {
    expect(parseGraftResult('mcp__graft__graft_find_all', { pattern: 'PushRendered' }, GREP_RESULT)).toMatchObject({
      hits: 4,
      indexedFiles: 1452,
      op: 'grep',
      target: 'PushRendered'
    })
  })

  it('counts signatures for skeleton and files for map', () => {
    expect(
      parseGraftResult('mcp__graft__graft_file_api', { file: 'packages/notifications/src/templates/push.ts' }, SKELETON_RESULT)
    ).toMatchObject({ hits: 4, op: 'skeleton', target: 'packages/notifications/src/templates/push.ts' })

    expect(parseGraftResult('mcp__graft__graft_repo_map', {}, MAP_RESULT)).toMatchObject({ indexedFiles: 1452, op: 'map' })
  })

  it('reads the wiring graph verdict for check, not the deep-layer notice', () => {
    expect(parseGraftResult('mcp__graft__graft_check_freshness', {}, CHECK_RESULT)).toMatchObject({
      freshness: 'fresh',
      op: 'check',
      savings: null
    })

    expect(parseGraftResult('mcp__graft__graft_check_freshness', {}, 'graph check: STALE \u2014 3 files changed')).toMatchObject({
      freshness: 'stale'
    })

    expect(parseGraftResult('mcp__graft__graft_check_freshness', {}, 'graft check: NO GRAPH')).toMatchObject({
      freshness: 'missing'
    })
  })

  it('accepts JSON-string args and an undefined result while running', () => {
    expect(parseGraftResult('mcp__graft__graft_trace_calls', '{"symbol":"PushRendered"}', undefined)).toEqual({
      op: 'callers',
      savings: null,
      target: 'PushRendered'
    })
  })

  it('returns null for non-graft tools', () => {
    expect(parseGraftResult('read_file', {}, 'x')).toBeNull()
  })
})

describe('phrasing', () => {
  const ask = parseGraftResult('mcp__graft__graft_find_code', { query: 'payments checkout flow' }, ASK_RESULT)!

  it('labels savings, counts and the one-line summary', () => {
    expect(graftSavingsLabel(ask)).toBe('saved ≈ 17.2k tokens (93%)')
    expect(graftCountLabel(ask)).toBe('3 hits')
    expect(graftSummary(ask)).toBe('3 hits · saved ≈ 17.2k tokens (93%)')

    const scoped = parseGraftResult('mcp__graft__graft_find_all', { in: 'server/src', pattern: 'x' }, GREP_RESULT)!

    expect(graftSummary(scoped)).toBe('4 hits · saved ≈ 1.5k tokens (91%) · in server/src')
  })

  it('titles the row with its subject, or the plain operation without one', () => {
    expect(graftTitle(ask, false)).toBe('Graft: asked “payments checkout flow”')
    expect(graftTitle(ask, true)).toBe('Graft: asking “payments checkout flow”')

    const map = parseGraftResult('mcp__graft__graft_repo_map', {}, MAP_RESULT)!

    expect(graftTitle(map, false)).toBe('Graft: mapped the repo')
    expect(graftCountLabel(map)).toBe('1452 indexed files')

    const check = parseGraftResult('mcp__graft__graft_check_freshness', {}, CHECK_RESULT)!

    expect(graftCountLabel(check)).toBe('graph in sync')
    expect(graftSavingsLabel(check)).toBe('')
  })
})

describe('buildToolView for graft rows', () => {
  it('gives a completed ask its title, count, savings meta and a body without the preamble', () => {
    const view = buildToolView(
      graftPart('mcp__graft__graft_find_code', { query: 'payments checkout flow' }, ASK_RESULT),
      ''
    )

    expect(view.title).toBe('Graft: asked “payments checkout flow”')
    expect(view.countLabel).toBe('3 hits')
    expect(view.metaLabel).toBe('saved ≈ 17.2k tokens (93%)')
    expect(view.icon).toBe('type-hierarchy')
    expect(view.status).toBe('success')
    expect(view.detail.startsWith('graft ask')).toBe(true)
    expect(view.detail).not.toContain('[graft] tokens saved')
  })

  it('shimmers the verb while the call is still running', () => {
    const view = buildToolView(graftPart('mcp__graft__graft_find_all', { pattern: 'PushRendered' }, undefined), '')

    expect(view.title).toBe('Graft: searching “PushRendered”')
    expect(view.titleAction?.text).toBe('searching')
    expect(view.metaLabel).toBeUndefined()
  })

  it('falls back to the operation title when the args are unknown', () => {
    const view = buildToolView(graftPart('mcp__graft__graft_repo_map', {}, undefined), '')

    expect(view.title).toBe('Graft: mapping the repo')
  })

  it('keeps the freshness verdict as the count and claims no savings', () => {
    const view = buildToolView(graftPart('mcp__graft__graft_check_freshness', {}, CHECK_RESULT), '')

    expect(view.countLabel).toBe('graph in sync')
    expect(view.metaLabel).toBeUndefined()
  })

  it('does not paint counts or savings on a failed call', () => {
    const view = buildToolView(
      { ...graftPart('mcp__graft__graft_find_code', { query: 'x' }, 'Error: index missing'), isError: true },
      ''
    )

    expect(view.status).toBe('error')
    expect(view.countLabel).toBeUndefined()
    expect(view.metaLabel).toBeUndefined()
  })
})
