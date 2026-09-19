import * as React from 'react'

import { type MenuKit, renderActionItem } from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { translateNow } from '@/i18n'
import { isMetaClose, middleClickHandlers } from '@/lib/middle-click'
import { cn } from '@/lib/utils'

/** Inset stroke for a vertical tab rail — content-facing edge. */
export const PANE_TAB_STRIP_LINE_LEFT = 'shadow-[inset_1px_0_0_var(--ui-stroke-tertiary)]'
export const PANE_TAB_STRIP_LINE_RIGHT = 'shadow-[inset_-1px_0_0_var(--ui-stroke-tertiary)]'

// Surface tokens become transparent under glass; the body owns the tint.
// The close-button fade masks the label, so it needs no second surface fill.
// EVERY TAB IS ITS OWN OPAQUE BOX. The fill is not decoration: it is what
// stops one tab's label from being read on top of its neighbour's. `--tab-face`
// is the surface the close-button runway fades into, and it follows the tab's
// own fill so the runway always masks the text it is there to mask.
const TAB =
  'group/tab relative flex items-center rounded-(--row-radius) border-transparent bg-(--tab-bg) text-[0.6875rem] font-medium [--tab-face:var(--tab-bg)] [-webkit-app-region:no-drag]'

// EVERY TAB STAYS ON SCREEN. `shrink-0` meant a strip that ran out of room
// pushed its later tabs into a horizontal scroll, so the chats at the back
// were simply not there to be clicked. They share the strip instead: an equal
// slice each, capped at `max-w-48` so two tabs do not stretch across a wide
// pane, floored low enough that a narrow rail still fits all of its own. Past
// that floor it scrolls, which is the honest answer for twenty tabs.
//
// Inset from the bar so each chip has air above and below it rather than
// filling the strip edge to edge.
const TAB_HORIZONTAL = 'h-[calc(100%-0.375rem)] min-w-12 max-w-48 flex-1 basis-0'

// A closeable tab's floor keeps short labels left of the close button.
// A floor, not padding — a tab already wider than it pays nothing.
const TAB_CLOSEABLE = 'min-w-13'

const TAB_VERTICAL = 'w-full max-h-48 justify-center [writing-mode:vertical-rl]'

const TAB_ACTIVE = 'text-foreground [--tab-bg:var(--pane-tab-active-bg,var(--ui-editor-surface-background))]'

// Horizontal only: the active tab is marked by a WASH, not by a rule. A
// 2px accent line under one tab is the brightest thing on a strip of quiet
// grey labels, so the eye lands on it every time it crosses the top of a
// pane, and it is a single-sided edge, which this shell does not draw. A
// faint fill says the same thing and says it as background rather than as a
// mark. Drawn as an inset shadow like the hover wash, so it costs no layout
// and stacks over whatever surface the tab already carries.
const TAB_ACTIVE_WASH = 'shadow-[inset_0_0_0_100vmax_var(--ui-row-active-background)]'

// Inactive = gutter, defaulting to the shared chrome surface so a strip that
// sets no vars still matches the sidebar/titlebar instead of falling through to
// the raw (unmixed) card seed. Hover DARKENS: surfaces this close in value need
// a darkening wash to register at all.
const TAB_IDLE =
  'text-(--ui-text-tertiary) [--tab-bg:var(--pane-tab-strip-bg,var(--ui-sidebar-surface-background))] hover:shadow-[inset_0_0_0_100vmax_color-mix(in_srgb,#000_var(--ui-tab-hover-darken),transparent)] hover:text-(--ui-text-secondary)'

// A tab riding a multi-tab selection: an accent wash over whatever surface the
// tab sits on. A background-image gradient (not a shadow) so it stacks cleanly
// over `--tab-bg` without fighting the active underline / hover shadows.
const TAB_SELECTED =
  '[background-image:linear-gradient(color-mix(in_srgb,var(--ui-accent)_14%,transparent),color-mix(in_srgb,var(--ui-accent)_14%,transparent))] text-foreground'

interface PaneTabProps extends React.ComponentProps<'div'> {
  active?: boolean
  dirty?: boolean
  /** Close verb. Horizontal tabs reveal a hover ✕ over the label's masked
   *  right edge; middle-click and ⌘-click always work,
   *  and stay the only gestures on vertical rails (no room for a chip ✕).
   *  There is no way to take the ✕ off a tab that HAS this verb: the chip and
   *  the pointer gestures are one affordance, so a closeable tab always says
   *  so. Omit `onClose` to make a tab uncloseable. */
  onClose?: () => void
  /** Part of a multi-tab selection (⌥/Ctrl-click, Shift-click) — an accent
   *  wash marks every tab that a drag would carry, Chrome-style. */
  selected?: boolean
  /** Vertical rail form (collapsed sidebar zones). */
  vertical?: boolean
  /** Content-facing edge of a vertical rail — the strip line the active tab cuts. */
  side?: 'left' | 'right'
}

/**
 * Editor tab shell — preview rail + zone headers + collapsed vertical rails.
 *
 * Defaults need no vars: the active tab takes the editor surface, inactive the
 * sidebar one. Override `--pane-tab-active-bg` to change what the active tab
 * merges into, `--pane-tab-strip-bg` for a gutter unlike the bar around it.
 */
export const PaneTab = React.forwardRef<HTMLDivElement, PaneTabProps>(function PaneTab(
  {
    active = false,
    dirty = false,
    onClose,
    onMouseDown,
    onPointerDown,
    onPointerUp,
    onClickCapture,
    selected = false,
    vertical = false,
    side = 'left',
    children,
    className,
    ...props
  },
  ref
) {
  // Vertical rails only. Horizontal tabs draw no bottom border — the strip owns
  // that rule, and a per-tab border stacked a second translucent line over it.
  // Physical on purpose: `side` is the caller's own placement of the rail, so
  // the border must hug the pane it sits against, not the reading direction.
  const edge = vertical ? (side === 'right' ? 'border-l' : 'border-r') : undefined
  const middle = middleClickHandlers(onClose)

  return (
    <div
      className={cn(
        TAB,
        vertical ? TAB_VERTICAL : TAB_HORIZONTAL,
        !vertical && onClose && TAB_CLOSEABLE,
        edge,
        active ? cn(TAB_ACTIVE, !vertical && TAB_ACTIVE_WASH) : cn(TAB_IDLE, edge && `${edge}-(--ui-stroke-tertiary)`),
        selected && TAB_SELECTED,
        className
      )}
      data-active={active}
      data-closeable={(onClose && !vertical) || undefined}
      data-selected={selected || undefined}
      data-slot="pane-tab"
      data-vertical={vertical || undefined}
      onClickCapture={event => {
        // Sites whose tab activates on the label's own onClick (the preview
        // rail) fire it AFTER our pointerdown close — swallow that stray click
        // in the capture phase so it can't re-select the just-closed tab.
        if (onClose && isMetaClose(event)) {
          event.preventDefault()
          event.stopPropagation()
        }

        onClickCapture?.(event)
      }}
      onMouseDown={event => {
        middle.onMouseDown(event)
        onMouseDown?.(event)
      }}
      onPointerDown={event => {
        middle.onPointerDown(event)

        // ⌘-click closes. Preempt here — the tab strips activate/drag on
        // pointerdown (drag-session onTap), so we must claim the press before
        // the shell's own handler starts a drag, and skip it entirely.
        if (onClose && isMetaClose(event)) {
          event.preventDefault()
          event.stopPropagation()
          onClose()

          return
        }

        onPointerDown?.(event)
      }}
      onPointerUp={event => {
        middle.onPointerUp(event)
        onPointerUp?.(event)
      }}
      ref={ref}
      {...props}
    >
      <div
        className={cn('pane-tab-content flex h-full min-w-0 max-w-full flex-1 items-center', vertical && 'contents')}
      >
        {children}
      </div>
      {dirty && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute grid size-4 place-items-center group-hover/tab:group-data-[closeable]/tab:opacity-0',
            vertical ? 'bottom-1.5 left-1/2 -translate-x-1/2' : 'end-1.5 top-1/2 -translate-y-1/2'
          )}
        >
          <span className="size-2 rounded-full bg-(--ui-warning) shadow-[0_0_0_2px_var(--tab-bg),0_1px_2px_rgba(0,0,0,0.45)]" />
        </span>
      )}
      {onClose && !vertical && (
        // Hover ✕, painted OVER the label's right edge as an overlay (no
        // layout shift, tab width never jumps on hover). The runway is a tiny
        // transparent→`--tab-face` gradient, so the button melts into the
        // tab's effective surface instead of hard-clipping the text under it.
        // Short labels are kept legible by TAB_CLOSEABLE, not by padding.
        // Rendered after the dirty dot: on hover the ✕ takes the dot's spot,
        // VS Code-style.
        <span className="pointer-events-none absolute inset-y-0 end-0 flex items-stretch opacity-0 transition-opacity group-hover/tab:pointer-events-auto group-hover/tab:opacity-100">
          {/* Both pieces re-draw the active underline: they paint over the
              tab's own last-pixel row, so without it the ✕ would bite a
              notch out of the accent line on the active tab. */}
          <span aria-hidden className="w-4 bg-linear-to-r from-transparent to-(--tab-face)" />
          <button
            aria-label={translateNow('common.close')}
            className="grid cursor-pointer place-items-center bg-(--tab-face) pe-1.5 ps-0.5 text-(--ui-text-tertiary) outline-none hover:text-foreground [&>*]:rounded-full [&>*]:p-0.5 [&>*]:transition-colors [&>*]:hover:bg-(--ui-control-active-background)"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }}
            onPointerDown={event => {
              // Claim a plain left press so the shell can't also activate or
              // drag the tab. Middle/⌘ presses bubble on purpose — the tab's
              // own close gestures already route them.
              if (event.button === 0 && !isMetaClose(event)) {
                event.stopPropagation()
              }
            }}
            tabIndex={-1}
            type="button"
          >
            <Codicon name="close" size="0.6875rem" />
          </button>
        </span>
      )}
    </div>
  )
})

interface PaneTabLabelProps extends React.ComponentProps<'button'> {
  /** `button` when the label is the activation target (preview rail);
   *  default `span` defers to the shell (zone drag/activate). */
  as?: 'button' | 'span'
}

/** Truncating label inside a `PaneTab`. `className` merges into the text span
 *  (e.g. `normal-case tracking-normal` for filenames). On a closeable tab the
 *  text clips instead of ellipsizing, so the hover mask can fade its right edge. */
export const PaneTabLabel = React.forwardRef<HTMLElement, PaneTabLabelProps>(function PaneTabLabel(
  { as = 'span', className, children, ...props },
  ref
) {
  const Comp = as as React.ElementType

  return (
    <Comp
      className="flex h-full min-w-0 max-w-full items-center overflow-hidden px-1.5 text-start outline-none group-data-[vertical]/tab:h-auto group-data-[vertical]/tab:w-full group-data-[vertical]/tab:justify-center group-data-[vertical]/tab:py-2"
      ref={ref}
      {...props}
    >
      <span
        // A TAB CARRIES A NAME, NOT A STAMP. This was 9px, letter-spaced and
        // upper-cased, which is the app's idiom for a fixed pane label
        // ("TERMINAL", "FILES") and the wrong treatment for the thing most
        // tabs actually hold: a session title the user wrote, often an Arabic
        // sentence, where upper-casing does nothing and 9px is simply small.
        // It reads at the same size as the rest of the tab now.
        //
        // `truncate`, never `text-clip`: a closeable tab used to hard-cut its
        // label mid-word because the close button sits over the end. The close
        // runway is a gradient into the tab's own fill, so the ellipsis lands
        // under the fade instead of being chopped off.
        className={cn('block min-w-0 truncate text-[0.6875rem] font-medium', className)}
      >
        {children}
      </span>
    </Comp>
  )
})

interface PaneTabStripProps extends React.ComponentProps<'div'> {
  /** The scrolling tab list — receives `role="tablist"`. */
  children: React.ReactNode
  /** Ref on the scroller itself, for `useActiveTabVisible`. */
  listRef?: React.Ref<HTMLDivElement>
  /** Non-scrolling trailing chrome pinned to the right (the minimize chevron). */
  trailing?: React.ReactNode
  /** Top-edge panel header shares the native window-control band. */
  titlebar?: boolean
}

/**
 * The horizontal tab bar every strip in the app sits in. Owns the bar's height
 * and surface, the scroll behaviour (hidden scrollbars, contained overscroll),
 * and the pinned trailing slot — so a new strip inherits all of it instead of
 * re-deriving the geometry and drifting out of alignment.
 *
 * Tabs go in `children` as `PaneTab`s; per-strip extras (drag handlers,
 * `data-zone-tabstrip`, drop carets) ride on the usual div props.
 */
export const PaneTabStrip = React.forwardRef<HTMLDivElement, PaneTabStripProps>(function PaneTabStrip(
  { children, className, listRef, trailing, titlebar = false, ...props },
  ref
) {
  return (
    <div
      // NO SURFACE OF ITS OWN, BUT ITS TABS HAVE ONE. The strip used to paint
      // the sidebar token, which is now the shell GROUND: on a content zone
      // that painted a band of ground across the top of the card, reading as a
      // notch cut out of it. So the strip paints nothing and the zone's fill
      // runs behind it.
      //
      // The TABS are a different question. They stay opaque, in the zone's own
      // fill (the zone publishes it as --pane-tab-strip-bg), because that fill
      // is what keeps one tab's label from being read through the tab beside
      // it. Transparent tabs is how the chats ended up stacked on top of each
      // other. Only the active tab's wash is meant to be visible.
      className={cn(
        'group/pane-header relative flex min-w-0 shrink-0 select-none',
        titlebar ? 'h-full flex-1 [-webkit-app-region:drag]' : 'h-7 [-webkit-app-region:no-drag]',
        className
      )}
      ref={ref}
      {...props}
    >
      <div
        // A GAP, NOT A RULE. Tabs used to be fenced apart by a hairline on
        // each one's leading edge; the strip separates them with the same
        // ground it separates panes with, so a tab is a region with air around
        // it rather than a cell in a grid of lines.
        className="flex min-w-0 flex-1 items-center gap-(--pane-seam) overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={listRef}
        role="tablist"
      >
        {children}
      </div>
      {trailing}
    </div>
  )
})

/** A glyph button on a tab strip: the "+" and anything a pane contributes (a
 *  preview's console / DevTools). Callers pass DATA, never classes — the same
 *  contract as `TitlebarTool`, so every glyph on every strip matches. */
export interface PaneStripTool {
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  id: string
  /** Tooltip text and accessible name. */
  label: string
  onSelect: () => void
}

/**
 * Renders one `PaneStripTool` through the app's `Button` + `Tip` primitives, the
 * way `TitlebarToolButton` does: ghost variant, no active background — state
 * reads from the glyph's own opacity, with `aria-pressed` carrying it for a11y.
 *
 * Pointerdown is claimed here so a click can never also activate or drag the
 * zone behind the strip.
 */
export function PaneStripGlyph({ active, disabled, icon, label, onSelect }: Omit<PaneStripTool, 'id'>) {
  return (
    <Tip label={label} placement="toolbar">
      <Button
        aria-label={label}
        aria-pressed={active ?? undefined}
        className={cn(
          'self-center bg-transparent select-none [-webkit-app-region:no-drag]',
          active ? 'opacity-100' : 'opacity-60 hover:opacity-100'
        )}
        disabled={disabled}
        onClick={onSelect}
        onPointerDown={event => event.stopPropagation()}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {icon}
      </Button>
    </Tip>
  )
}

/** Close-verb enablement for `paneTabCloseItems` — how many tabs each verb hits. */
export interface PaneTabCloseCounts {
  all: number
  others: number
  right: number
}

interface PaneTabCloseItemsOptions {
  counts: PaneTabCloseCounts
  /** Omit to hide Close entirely (an uncloseable tab shows no dead action). */
  onClose?: () => void
  onCloseAll: () => void
  onCloseOthers: () => void
  onCloseToRight: () => void
}

/**
 * The four close verbs every tab menu offers — Close / others / to the right /
 * all — so a tab answers a right-click the same way wherever it lives. No ⌘W
 * hint on Close: the keybind closes the FOCUSED zone's active tab, so it would
 * be a lie on the inactive tab the user actually right-clicked.
 */
export function paneTabCloseItems(
  kit: MenuKit,
  { counts, onClose, onCloseAll, onCloseOthers, onCloseToRight }: PaneTabCloseItemsOptions
) {
  return (
    <>
      {onClose &&
        renderActionItem(kit, {
          icon: 'close',
          label: translateNow('common.close'),
          onSelect: onClose
        })}
      {renderActionItem(kit, {
        disabled: !counts.others,
        icon: 'close-all',
        label: translateNow('zones.closeOthers'),
        onSelect: onCloseOthers
      })}
      {renderActionItem(kit, {
        disabled: !counts.right,
        icon: 'arrow-right',
        label: translateNow('zones.closeToRight'),
        onSelect: onCloseToRight
      })}
      {renderActionItem(kit, {
        disabled: !counts.all,
        icon: 'clear-all',
        label: translateNow('zones.closeAll'),
        onSelect: onCloseAll
      })}
    </>
  )
}
