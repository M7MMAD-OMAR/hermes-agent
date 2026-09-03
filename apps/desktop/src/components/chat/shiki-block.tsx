'use client'

import { type ComponentProps, useEffect, useState } from 'react'
/**
 * The ONLY static importer of `react-shiki` (and through it the multi-MB
 * shiki language/theme bundle). Every consumer reaches this module through
 * `React.lazy(() => import('./shiki-block'))` — see `LazyShiki` in
 * shiki-highlighter.tsx — so the shiki chunk stays entirely off the
 * cold-start path and loads on the first highlighted code block instead.
 *
 * Do NOT import this module statically from anything the entry graph
 * reaches, or the chunk moves back into boot.
 *
 * ── The mount queue ─────────────────────────────────────────────────────
 *
 * react-shiki throttles per INSTANCE: each block schedules its own highlight
 * `delay` ms after its own mount, with a per-component timer. Opening a
 * session mounts every transcript's code blocks at once, so all of their
 * timers fire in the same task window and the tokenizer runs back-to-back —
 * measured on the real bench (1044-session DB, reload burst): seven
 * 300–544 ms main-thread stalls per open, shiki + oniguruma-wasm on top of
 * every one.
 *
 * This wrapper turns that thundering herd into a queue: a module-level
 * ticket admits at most MAX_CONCURRENT mounts at a time, and the next one is
 * admitted only after a settle gap. Unmounted-before-admission blocks
 * release their slot; an admitted block renders the real highlighter
 * immediately (react-shiki's own per-instance throttle still applies after
 * that). The visual result is identical — every block ends up highlighted —
 * the work just stops arriving as one burst.
 */
import ShikiHighlighter from 'react-shiki'

type ShikiProps = ComponentProps<typeof ShikiHighlighter>

/** Highlights in flight before the next queued block may mount. One at a
 *  time keeps each highlight its own ~20-40 ms slice instead of N stacked. */
const MAX_CONCURRENT = 1
/** Idle gap after an admission before the queue may hand out the next one —
 *  long enough for the admitted highlight's synchronous tokenization to run,
 *  short enough that a screenful of blocks finishes in a few hundred ms. */
const RELEASE_GAP_MS = 40

const pending: Array<() => void> = []
let active = 0

function pump(): void {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const admit = pending.shift()!

    active += 1
    admit()
  }
}

function enqueue(admit: () => void): () => void {
  pending.push(admit)
  pump()

  return () => {
    const index = pending.indexOf(admit)

    if (index !== -1) {
      pending.splice(index, 1)
    }
  }
}

/** A minimal plain-text stand-in for the pre-admission frames. A plain
 *  <code> in the same slot the real highlighter fills, so the swap doesn't
 *  reflow the transcript. */
const PendingCode = ({ code }: { code: string }) => <code className="block whitespace-pre">{code}</code>

export default function ShikiBlock(props: ShikiProps) {
  const [admitted, setAdmitted] = useState(false)
  const code = typeof props.children === 'string' ? props.children : ''

  useEffect(() => {
    if (admitted) {
      // Give back the slot a gap after the highlighter mounted. Exactly one
      // release per admission: the timer normally fires; an unmount before
      // it does releases the still-held slot instead of leaking it.
      let released = false

      const releaseTimer = window.setTimeout(() => {
        released = true
        active = Math.max(0, active - 1)
        pump()
      }, RELEASE_GAP_MS)

      return () => {
        window.clearTimeout(releaseTimer)

        if (!released) {
          active = Math.max(0, active - 1)
          pump()
        }
      }
    }

    let cancelled = false

    const cancel = enqueue(() => {
      if (cancelled) {
        // Never claimed the slot's work — hand it straight back.
        active = Math.max(0, active - 1)
        pump()

        return
      }

      setAdmitted(true)
    })

    return () => {
      cancelled = true
      cancel()
    }
  }, [admitted])

  if (!admitted) {
    return <PendingCode code={code} />
  }

  return <ShikiHighlighter {...props} />
}
