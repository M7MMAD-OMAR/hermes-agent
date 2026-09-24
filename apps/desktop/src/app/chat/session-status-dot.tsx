import { useStore } from '@nanostores/react'

import { type Translations, useI18n } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { $sessionColorById, sessionColorFor } from '@/store/session-color'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'
import type { SessionInfo } from '@/types/hermes'

// A pure lookup table: each state maps to its className, aria-label, and title.
// No priority resolution here — $sessionDotStateById already picked one.
// Label/title resolve from sidebar.row translations, keyed by name.
type DotVariant = {
  ariaLabel?: (r: Translations['sidebar']['row']) => string
  className: string
  role?: 'status'
  title?: (r: Translations['sidebar']['row']) => string
}

// Shared base for every active dot; idle is smaller and uses its own class.
const DOT_BASE = 'size-1.5 rounded-full'

// Three colors and one solid/faint axis, none of it moving. Motion on a 6px
// circle can only say "something is happening" — which the row's arc already
// says, better — while costing a repaint per frame on every row at once. What
// the dot is for is telling states APART, and that is a job for color and
// weight: solid means producing, diluted means open but quiet. The two states
// this replaces differed by 30% opacity and were, in practice, the same dot.
//
// The quiet states were drawn as a ring (`border`) until a stroke that small
// read as a hole punched in the row. They carry a diluted fill instead: no
// line anywhere in the shell, and the axis survives intact.
const DOT_VARIANTS: Record<SessionDotState, DotVariant> = {
  // Amber — a clarify/approval is blocking the turn. The one "act now" color,
  // and the only state the user is required to do something about.
  'needs-input': {
    ariaLabel: r => r.needsInput,
    className: `${DOT_BASE} bg-(--ui-attention)`,
    role: 'status',
    title: r => r.waitingForAnswer
  },
  // Accent — the turn is running. The row's arc carries the motion.
  working: {
    ariaLabel: r => r.sessionRunning,
    className: `${DOT_BASE} bg-(--ui-accent)`,
    role: 'status'
  },
  // Faint accent, still authoritatively running, but nothing has arrived for
  // the watchdog window. Same color as working because it IS working; diluted
  // because nothing is coming out of it right now.
  stalled: {
    ariaLabel: r => r.sessionRunning,
    className: `${DOT_BASE} bg-(--ui-accent)/40`,
    role: 'status',
    title: r => r.sessionRunning
  },
  // Faint muted: a terminal(background=true) process outlived the turn. A
  // diluted mark reads as "still open" without claiming the model is working; a
  // solid grey dot read as finished, the opposite of what this means.
  background: {
    ariaLabel: r => r.backgroundRunning,
    className: `${DOT_BASE} bg-(--ui-text-tertiary)/45`,
    role: 'status',
    title: r => r.backgroundRunning
  },
  // Emerald — the turn finished while the user was looking elsewhere. The
  // color is theme-derived (`--ui-success`, a success green rotated toward the
  // accent) so eight finished dots can't sit in the sidebar fighting a palette
  // they don't belong to. Under a green accent it stays emerald.
  unread: {
    ariaLabel: r => r.finishedUnread,
    className: `${DOT_BASE} bg-(--ui-success)`,
    role: 'status',
    title: r => r.finishedUnread
  },
  // The faintest ink the app has, for a chat that has never run. It shares the
  // dilution with `background` because both mean "open, not producing", and
  // sits on the dimmest ink because a draft is the one state that has yet to
  // do anything at all.
  draft: {
    ariaLabel: r => r.draftSession,
    className: `${DOT_BASE} bg-(--ui-text-quaternary)/45`,
    title: r => r.draftSession
  },
  // Settled: the project color when there is one, else the faintest filled
  // grey. Every session shows SOME mark — a row with nothing in the lead slot
  // reads as broken next to its neighbours, so "no color" falls back to the
  // quietest ink rather than to an invisible dot.
  idle: {
    className: 'size-1 rounded-full bg-(--ui-text-quaternary)'
  }
}

/** The dot a state paints, for surfaces that describe a status rather than
 *  render a session — the sidebar's status filter, say. Idle carries no color
 *  of its own (it inherits the project's), so callers supply one. */
export const sessionDotClassName = (state: SessionDotState): string => DOT_VARIANTS[state].className

/** The mark a state earns on a TAB, none for the quiet states. Color and weight
 *  on a 6 px dot tell states apart to someone who already knows the code; a
 *  strip of eight tabs has to be read cold, mid-task, by someone who wants to
 *  know which chats are running, which are waiting on them, and which finished
 *  while they were elsewhere. So the state gets its own mark beside the dot —
 *  and Idle and draft stay unmarked, so a quiet strip is quiet.
 *
 *  A MARK, not a word. The word was "RUNNING" (Arabic "يعمل"), and a tab is
 *  mostly title: on a narrow strip the status spent more width than the thing
 *  it was labelling, and the title it pushed out is what tells two running
 *  chats apart. One glyph keeps the distinction and gives the width back.
 *
 *  The glyphs carry no language — the word they stand for lives in the tooltip,
 *  translated — which is also why they are not first letters: "بانتظارك" and
 *  "بالخلفية" share one, and a mark that collides is worse than none.
 *
 *  Colour, not a box: every mark used to sit in a pill, the two quiet states
 *  in an OUTLINED one. At this size a stroke around a 10 px glyph is a second
 *  shape competing with the glyph, and the shell carries no lines anywhere.
 *  The ink separates the states on its own; only `needs-input` keeps a fill,
 *  because it is the one state the user has to act on. */
const CHIP_VARIANTS: Partial<
  Record<SessionDotState, { className: string; glyph: string; label: (r: Translations['sidebar']['row']) => string }>
> = {
  // The one state the user must act on keeps its tone fill: a fill is how this
  // shell separates a surface, and dimming the only "act now" mark to a bare
  // glyph in a strip of glyphs is the opposite of what it is for.
  'needs-input': {
    className: 'rounded bg-(--ui-attention-background) text-(--ui-attention)',
    glyph: '!',
    label: r => r.chipNeedsInput
  },
  working: { className: 'text-(--ui-accent)', glyph: '▶', label: r => r.chipWorking },
  stalled: { className: 'text-(--ui-accent)/70', glyph: '▶', label: r => r.chipWorking },
  background: { className: 'text-(--ui-text-tertiary)', glyph: '⋯', label: r => r.chipBackground },
  unread: { className: 'text-(--ui-success)', glyph: '✓', label: r => r.chipDone }
}

export interface SessionStatusDotProps {
  /** The STORED session id — the key every live-state atom (working /
   *  attention / stalled / unread / background) is keyed by, on BOTH surfaces:
   *  the sidebar row's `session.id` and a pane tile's `storedSessionId` are the
   *  same stored id (`$workingSessionIds` et al. map `storedSessionId`).
   *
   *  Null on a new chat that has yet to reach the backend — no id to key by,
   *  and no turn behind it, which is the draft state by definition. */
  storedSessionId: null | string
  /** The session row for color resolution — recents OR the project tree. Both
   *  call sites already hold it; passing it lets the idle dot inherit the
   *  project color even for a session older than the paginated recents page
   *  (which has no `$sessionColorById` entry). */
  session?: null | SessionInfo
  /** TUI-style tree stem for a branched session (`└─ ` / `├─ `). */
  branchStem?: string
  /** Applied to the OUTER wrapper (stem + dot) — e.g. hover-fade on the
   *  reorder handle. */
  className?: string
}

/**
 * SESSION STATUS DOT — the ONE primitive the sidebar row, the pane tabs, and
 * the session switcher render, so a session's status can never disagree
 * between surfaces. It resolves everything itself from the stored session id:
 * the live state (via `$sessionDotStateById`, already reduced to one mutually
 * exclusive answer) and the color (override → project, via `sessionColorFor`).
 * An idle session shows its project color; the active states own the dot with
 * their semantic color so an attention cue is never masked by the tint.
 */
/** The one live state both marks read. Selector, not a plain useStore: the map
 *  is rebuilt whenever ANY session's status changes, but a given mark only
 *  repaints when ITS OWN state flips. */
function useSessionDotState(storedSessionId: null | string): SessionDotState {
  return useStoreSelector($sessionDotStateById, states =>
    storedSessionId ? (states[storedSessionId] ?? 'idle') : 'draft'
  )
}

export function SessionStatusDot({ storedSessionId, session, branchStem, className }: SessionStatusDotProps) {
  const { t } = useI18n()
  const r = t.sidebar.row

  // Subscribe to the shared color map for reactivity; sessionColorFor falls
  // back to the resolver for a session outside the recents page.
  useStore($sessionColorById)
  const color = sessionColorFor(session) ?? null
  const dotState = useSessionDotState(storedSessionId)
  const variant = DOT_VARIANTS[dotState]

  return (
    <span className={cn('flex items-center gap-0.5', className)}>
      {branchStem ? (
        <span aria-hidden className="shrink-0 font-mono text-[0.625rem] leading-none text-(--ui-text-quaternary)">
          {branchStem}
        </span>
      ) : null}
      {dotState === 'idle' ? (
        // Rendered even with no color to paint: an empty dot of the same size
        // keeps every row's title on one left edge, so a session finishing
        // can't shift the list under the pointer.
        <span aria-hidden="true" className={variant.className} style={color ? { backgroundColor: color } : undefined} />
      ) : (
        <span
          aria-label={variant.ariaLabel?.(r)}
          className={variant.className}
          role={variant.role}
          title={variant.title?.(r)}
        />
      )}
    </span>
  )
}

/**
 * THE MARK A TAB CARRIES, and the only one. A tab used to show the dot and the
 * glyph together: two marks, one meaning, on the surface with the least room
 * for either. The dot is the sidebar's mark, where it also carries the project
 * colour and sits in a list that reads top to bottom; on a tab it was saying a
 * second time what the glyph beside it already said.
 *
 * Nothing at all for the quiet states, so a strip of settled chats is quiet and
 * the ones that want something stand out by being the only marked tabs.
 */
export function SessionStatusChip({
  storedSessionId,
  className
}: {
  className?: string
  storedSessionId: null | string
}) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const variant = CHIP_VARIANTS[useSessionDotState(storedSessionId)]

  return (
    <span
      // The accessible name lives here now: this IS the status on a tab, not a
      // decoration beside one. A quiet tab announces nothing.
      aria-label={variant?.label(r)}
      className={cn(
        // THE BOX STAYS EVEN WHEN THE GLYPH DOES NOT. Two reasons: a tab's
        // title starts at the same place whatever the state is, so a strip
        // does not shuffle as chats finish; and the tab's ⌘-number hint paints
        // absolutely INSIDE this box (tab-key-hints.tsx), so a zero-width lead
        // would take the number away from every settled tab, which is most of
        // them.
        'inline-flex w-3.5 shrink-0 justify-center text-[0.625rem] font-medium leading-4',
        variant?.className,
        className
      )}
      data-slot="session-status-chip"
      role={variant ? 'status' : undefined}
      // The word the mark stands for, in the reader's language, for anyone who
      // has not yet learned the glyph.
      title={variant?.label(r)}
    >
      {variant?.glyph}
    </span>
  )
}
