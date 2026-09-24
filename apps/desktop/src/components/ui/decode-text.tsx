import { type ComponentProps, useEffect, useState } from 'react'

import { prefersReducedMotion } from '@/hooks/use-media-query'
import { createBudgetedLoop } from '@/lib/budgeted-loop'
import { cn } from '@/lib/utils'

/**
 * DecodeText — the "CONNECTING" scramble-decode effect as a reusable
 * primitive (extracted from gateway-connecting-overlay.tsx; same mechanics):
 *
 *  - Even-weight mono ascii charset so cycling glyphs never jump width
 *    (matches the nousnet-web download-button decode effect).
 *  - Decode resolves half a character per 45ms tick; when fully resolved it
 *    holds for 16 ticks, then (in loop mode) replays.
 *  - The first `prefix` characters NEVER scramble — split at render level so
 *    no timer logic (even a stale HMR one) can garble them.
 *  - Optional blinking dither-cursor square.
 *
 * Typography (mono, small, uppercase, wide tracking) is baked in; color comes
 * from the caller via className/text color so the same primitive works on the
 * boot overlay (--theme-primary) and quiet surfaces (--ui-text-quaternary).
 */

export const DECODE_SCRAMBLE_CHARS = '/\\|-_=+<>~:*'
const TICK_MS = 45
const HOLD_TICKS = 16

function scrambled(tail: string, resolvedCount: number): string {
  return Array.from(tail, (ch, i) =>
    ch === ' ' || i < resolvedCount ? ch : DECODE_SCRAMBLE_CHARS[(Math.random() * DECODE_SCRAMBLE_CHARS.length) | 0]
  ).join('')
}

export interface DecodeTextProps extends Omit<ComponentProps<'span'>, 'prefix'> {
  text: string
  /** Leading character count that stays legible at all times. */
  prefix?: number
  /** Run the decode. When false, renders the plain resolved text (used to
   *  freeze the word during exit choreography). */
  active?: boolean
  /** Replay after the hold (a progress surface such as the boot overlay), or
   *  resolve once and stop. Off by default: a quiet placeholder that replays
   *  forever is a 22 Hz setState ticker for as long as it is on screen — the
   *  empty-zone "HERMES" mark alone held the idle renderer at ~16 commits/s
   *  (#98394). */
  loop?: boolean
  /** Blinking dither-cursor square after the text. */
  cursor?: boolean
}

export function DecodeText({
  active = true,
  className,
  cursor = false,
  loop = false,
  prefix = 0,
  text,
  ...props
}: DecodeTextProps) {
  const staticPrefix = text.slice(0, prefix)
  const tailText = text.slice(prefix)
  const [tail, setTail] = useState(tailText)

  useEffect(() => {
    if (!active) {
      setTail(tailText)

      return
    }

    // Under reduced motion, skip the scramble entirely and render the fully
    // resolved text immediately. The cursor blink (CSS animation) is also
    // killed by the blanket reduced-motion CSS rule.
    if (prefersReducedMotion()) {
      setTail(tailText)

      return
    }

    let resolved = 0
    let hold = 0
    let settled = false

    // rAF, not setInterval: this is decoration, and a timer keeps scrambling a
    // word nobody can see. A window parked on another workspace still runs its
    // timers at full rate (Wayland leaves `document.visibilityState` at
    // 'visible', so every visibility gate in the renderer misses it) while the
    // compositor stops asking for frames — so riding rAF is the only signal
    // that actually tracks "is this on screen". Measured on an 8-tile window:
    // this one placeholder drove ~16 React commits per second forever, on and
    // off screen alike.
    const animation = createBudgetedLoop(
      () => {
        if (resolved >= tailText.length) {
          hold += 1

          if (hold > HOLD_TICKS) {
            if (loop) {
              resolved = 0
              hold = 0
            } else {
              settled = true
            }
          }

          setTail(tailText)

          return
        }

        resolved += 0.5
        setTail(scrambled(tailText, Math.floor(resolved)))
      },
      { fps: 1000 / TICK_MS, idleWhen: () => settled }
    )

    return () => animation.dispose()
  }, [active, loop, tailText])

  return (
    <span
      className={cn(
        'inline-flex items-center font-mono text-[0.64rem] font-semibold uppercase tracking-[0.4em] tabular-nums',
        className
      )}
      {...props}
    >
      {staticPrefix}
      {tail}
      {cursor && (
        <span
          aria-hidden="true"
          className="dither ms-0.5 inline-block size-2 shrink-0 -translate-y-px rounded-[1px] decode-cursor-blink"
        />
      )}
    </span>
  )
}
