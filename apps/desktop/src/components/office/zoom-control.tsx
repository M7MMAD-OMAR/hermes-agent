/**
 * The zoom control both Office viewers wear.
 *
 * Shared so the same keystroke moves a spreadsheet and a document by the same
 * amount and the toolbar is styled once. Both viewers scale with CSS `zoom`
 * rather than a transform, because column widths and page reflow have to
 * follow the scale.
 */

import type { ReactNode } from 'react'

import { useI18n } from '@/i18n'

/** The steps the buttons walk. 1 is the middle of the range on purpose: it is
 *  where the reset click lands and where a document opens unless it is being
 *  fitted to the rail. */
export const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2] as const

/** The step `delta` places from `zoom`, clamped to the ends of the range. */
export function steppedZoom(zoom: number, delta: number): number {
  const nearest = ZOOM_STEPS.reduce(
    (best, step, index) => (Math.abs(step - zoom) < Math.abs(ZOOM_STEPS[best]! - zoom) ? index : best),
    0
  )

  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, nearest + delta))] ?? 1
}

const BUTTON = 'rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

export function ZoomControl({
  onZoom,
  trailing,
  zoom
}: {
  onZoom: (zoom: number) => void
  trailing?: ReactNode
  zoom: number
}) {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 items-center gap-1">
      {trailing}
      <button aria-label={t.preview.office.zoomOut} className={BUTTON} onClick={() => onZoom(steppedZoom(zoom, -1))} type="button">
        −
      </button>
      <button
        aria-label={t.preview.office.resetZoom}
        className="min-w-10 rounded px-1 text-[0.625rem] tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => onZoom(1)}
        title={t.preview.office.resetZoom}
        type="button"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button aria-label={t.preview.office.zoomIn} className={BUTTON} onClick={() => onZoom(steppedZoom(zoom, 1))} type="button">
        +
      </button>
    </div>
  )
}
