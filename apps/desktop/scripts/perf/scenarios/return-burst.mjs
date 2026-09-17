// What does coming back to the window cost?
//
// Leaving the window and returning fires `focus` and `visibilitychange`
// (sometimes each more than once). Every listener keyed on those raw events
// used to fire on each of them, so the reveal frame competed with a burst of
// duplicate gateway RPCs and their store publishes. This scenario replays one
// return synthetically (hidden -> visible, then the focus events a compositor
// sends) and counts what the renderer does in the seconds after it:
//   - return_rpc_n         gateway RPC frames sent (WebSocket JSON-RPC requests)
//   - return_rpc_dupes     requests whose method+params repeated within the burst
//   - return_longtask_ms   main-thread long-task time after the return
//   - return_longtasks_n   number of long tasks
//
// No backend needed: the requests are counted at the socket, whether or not
// anything answers them. Attaches to whatever the page is showing; with a
// session open the counts include that session's own refreshers.
//
//   node scripts/perf/run.mjs return-burst --spawn [--seconds 3]

import { sleep } from '../lib/cdp.mjs'

const ARM = `
  (() => {
    const rec = { rpc: [], longtasks: [], stop: false }
    window.__RB__ = rec
    if (!window.__RB_PATCHED__) {
      window.__RB_PATCHED__ = true
      const send = WebSocket.prototype.send
      WebSocket.prototype.send = function (data) {
        const rec = window.__RB__
        if (rec && !rec.stop) {
          try {
            const m = JSON.parse(data)
            if (m && m.method) rec.rpc.push({ t: performance.now(), key: m.method + ' ' + JSON.stringify(m.params ?? null) })
          } catch {}
        }
        return send.apply(this, arguments)
      }
    }
    try {
      rec.po = new PerformanceObserver(list => {
        if (rec.stop) return
        for (const e of list.getEntries()) rec.longtasks.push({ t: e.startTime, d: e.duration })
      })
      rec.po.observe({ entryTypes: ['longtask'] })
    } catch {}
    return 'armed'
  })()
`

// Model a real return: the document reports hidden, then visible, then the
// compositor focuses the surface (twice, as Wayland compositors commonly do).
const RETURN = `
  (() => {
    let state = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
    state = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
    return performance.now()
  })()
`

const COLLECT = `
  (() => {
    const rec = window.__RB__
    rec.stop = true
    try { rec.po && rec.po.disconnect() } catch {}
    delete document.visibilityState
    return JSON.stringify({ rpc: rec.rpc, longtasks: rec.longtasks })
  })()
`

export default {
  name: 'return-burst',
  tier: 'ci',
  description: 'RPC and long-task burst in the seconds after the window comes back.',
  async run(cdp, opts = {}) {
    const seconds = Number(opts.seconds ?? 3)

    await cdp.send('Runtime.enable')
    await cdp.eval(ARM)
    const t0 = await cdp.eval(RETURN)
    await sleep(seconds * 1000)
    const data = JSON.parse(await cdp.eval(COLLECT))

    const rpc = data.rpc.filter(r => r.t >= t0)
    const longtasks = data.longtasks.filter(l => l.t >= t0)
    const seen = new Map()
    let dupes = 0

    for (const r of rpc) {
      const n = (seen.get(r.key) ?? 0) + 1
      seen.set(r.key, n)

      if (n > 1) {
        dupes += 1
      }
    }

    const byMethod = {}

    for (const r of rpc) {
      const method = r.key.split(' ')[0]
      byMethod[method] = (byMethod[method] ?? 0) + 1
    }

    return {
      metrics: {
        return_rpc_n: rpc.length,
        return_rpc_dupes: dupes,
        return_longtasks_n: longtasks.length,
        return_longtask_ms: Math.round(longtasks.reduce((a, l) => a + l.d, 0))
      },
      detail: { seconds, byMethod }
    }
  }
}
