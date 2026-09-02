// In-app browser open latency — the globe click → the page is on screen.
//
// Nothing measured this path before, which is why it was allowed to get slow:
// the embedded browser mounts `PreviewPane`, one of the largest components in
// the app, and then attaches an Electron `<webview>` guest, which is a whole
// second renderer process. Both costs are paid on a click the user makes
// constantly, and neither showed up in `stream`/`keystroke`/`transcript`.
//
// TWO operations, not three, and the difference is the whole reason this file
// reports what it does:
//
//   COLD OPEN   the very first globe press — React mounts the panel and
//               Chromium spins up the guest process. Happens ONCE per app
//               launch, so there is exactly one honest sample of it.
//   UN-PARK     every press after that. The globe never unmounts: parking only
//               collapses the panel, and the page (and the agent driving it)
//               stay alive by design. So a second "open" is an un-park, and it
//               SHOULD be near-free — if it is not, the collapse path is
//               tearing down something it claims to keep.
//
// An earlier version of this scenario looped open/park/reopen/park and reported
// every iteration's first click as a warm OPEN. Those clicks never mounted
// anything, so the warm-open number was the un-park number under another name,
// and the p95 mixed one real mount into four un-parks. Both are collected here,
// under the names of what they actually measure.
//
// Also reports the React commit cost attributed during the open, so a
// regression can be told apart from "the machine was busy".

import { SELECTORS, sleep } from '../lib/cdp.mjs'
import { percentile } from '../lib/stats.mjs'

const { browserPanel: PANEL, browserPanelVisible: VISIBLE, browserToggle: TOGGLE } = SELECTORS

/**
 * One open/close cycle, timed inside the page.
 *
 * Timed in the RENDERER, not across CDP: a round trip per phase would measure
 * the debugger, and the numbers here are single-digit-to-tens of ms.
 */
const MEASURE = `
  (async () => {
    const q = sel => document.querySelector(sel)
    const raf = () => new Promise(r => requestAnimationFrame(() => r(performance.now())))

    // Settle: a paint proxy that waits for the element to have a real box, not
    // merely to exist. A mounted-but-zero-height panel is not "open".
    const painted = async (sel, deadlineMs = 4000) => {
      const start = performance.now()
      while (performance.now() - start < deadlineMs) {
        const el = q(sel)
        if (el && el.getBoundingClientRect().width > 1) return await raf()
        await raf()
      }
      return null
    }

    const toggle = q(${JSON.stringify(TOGGLE)})
    if (!toggle) return { error: 'globe button not found' }

    const out = {}

    // ── open ────────────────────────────────────────────────────────────────
    const t0 = performance.now()
    toggle.click()
    const openedAt = await painted(${JSON.stringify(VISIBLE)})
    if (openedAt === null) return { error: 'panel never painted' }
    out.open_paint_ms = openedAt - t0

    // The guest is a separate process; ask the tag whether it has one yet.
    const attachStart = performance.now()
    let attached = null
    while (performance.now() - attachStart < 8000) {
      const view = q(${JSON.stringify(PANEL)})?.querySelector('webview')
      try {
        if (view && typeof view.getWebContentsId === 'function' && view.getWebContentsId() > 0) {
          attached = performance.now()
          break
        }
      } catch {}
      await raf()
    }
    out.open_attach_ms = attached === null ? null : attached - t0

    await new Promise(r => setTimeout(r, 250))

    // ── park, then bring back ───────────────────────────────────────────────
    toggle.click()
    await new Promise(r => setTimeout(r, 150))

    const t1 = performance.now()
    toggle.click()
    const reopenedAt = await painted(${JSON.stringify(VISIBLE)})
    out.reopen_paint_ms = reopenedAt === null ? null : reopenedAt - t1

    // Leave it parked so the next iteration starts from the same state.
    await new Promise(r => setTimeout(r, 150))
    toggle.click()
    await new Promise(r => setTimeout(r, 150))

    return out
  })()
`

export default {
  name: 'browser',
  tier: 'ci',
  description: 'In-app browser: globe click → panel painted → guest attached.',
  async run(cdp, opts = {}) {
    const iterations = Number(opts.iterations ?? 5)

    await cdp.send('Runtime.enable')

    const present = await cdp.eval(`Boolean(document.querySelector(${JSON.stringify(TOGGLE)}))`)

    if (!present) {
      throw new Error(`globe button not found (${TOGGLE}); is a chat view open?`)
    }

    // `unpark` pools both un-park samples an iteration produces: its opening
    // click (a mount only on iteration 0) and its explicit reopen.
    const open = []
    const attach = []
    const unpark = []
    const errors = []

    await cdp.eval('window.__PERF_PROBE__ && (window.__PERF_PROBE__.clear(), window.__PERF_PROBE__.enabled = true)')

    for (let i = 0; i < iterations; i++) {
      const row = await cdp.eval(MEASURE)

      if (!row || row.error) {
        errors.push(row?.error ?? 'no result')
        continue
      }

      // Only iteration 0 mounts. Every later opening click lands on a panel
      // that is already in the tree and merely collapsed, so it is an un-park
      // and is pooled as one — averaging it into the cold number would hide
      // exactly the cost the cold number exists to watch.
      if (i === 0) {
        open.push(row.open_paint_ms)

        // Same reason: the guest attaches once. Later iterations read a
        // webContents id that has existed for seconds, which is not an attach.
        if (row.open_attach_ms !== null) {
          attach.push(row.open_attach_ms)
        }
      } else {
        unpark.push(row.open_paint_ms)
      }

      if (row.reopen_paint_ms !== null) {
        unpark.push(row.reopen_paint_ms)
      }

      await sleep(200)
    }

    if (!open.length) {
      throw new Error(`browser never opened: ${errors.join('; ')}`)
    }

    const commits = await cdp.eval('window.__PERF_PROBE__ ? window.__PERF_PROBE__.summary() : null')

    await cdp.eval('window.__PERF_PROBE__ && (window.__PERF_PROBE__.enabled = false)')

    const round = n => (n === null || n === undefined ? null : Math.round(n * 10) / 10)

    return {
      metrics: {
        // One sample by construction — the panel only mounts once per launch.
        browser_open_cold_ms: round(open[0]),
        browser_attach_cold_ms: round(attach[0]),
        browser_unpark_p50_ms: round(percentile(unpark, 0.5)),
        browser_unpark_p95_ms: round(percentile(unpark, 0.95))
      },
      detail: { iterations, cold: round(open[0]), unparks: unpark.map(round), errors, commits }
    }
  }
}
