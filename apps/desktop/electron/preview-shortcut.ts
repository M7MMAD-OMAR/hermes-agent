/**
 * Which app gesture a `before-input-event` keypress means.
 *
 * Pure so the decision can be unit-tested; `installPreviewShortcut` in main.ts
 * owns the side effects. Three chords ride this hook rather than the
 * application menu, because that menu exists only on macOS (`setApplicationMenu(null)`
 * everywhere else) — a menu accelerator would leave Windows and Linux with no
 * binding at all.
 *
 * Two defects this module exists to fix, both invisible until named:
 *
 *  1. `before-input-event` fires for keyUp as well as keyDown, and the original
 *     inline check tested neither. Every ⌘R therefore dispatched the reload
 *     TWICE — once on the way down, once on the way up.
 *  2. `forceReload` (⇧⌘R) was documented as "the unconditional whole-window
 *     escape hatch", but it is a MENU role, so on Linux and Windows it did not
 *     exist. Plain ⌘R was the only reload, and its fallback reloaded the entire
 *     renderer — discarding the composer and returning to the home route. The
 *     escape hatch is now a real chord on every platform, which is what lets
 *     plain ⌘R stay scoped to the page under the cursor.
 */

/** The slice of Electron's `Input` this decision needs. */
export interface PreviewShortcutInput {
  alt?: boolean
  control?: boolean
  key?: string
  meta?: boolean
  shift?: boolean
  type?: string
}

export type PreviewShortcut =
  /** ⌘W — close the focused tab, else the window (the renderer decides). */
  | 'close-tab'
  /** ⌘R — reload the focused in-app browser page. Never the app itself. */
  | 'reload-page'
  /** ⇧⌘R — reload the whole window. The deliberate escape hatch. */
  | 'reload-window'

/**
 * Classify one keypress, or null when it is not one of ours.
 *
 * `isMac` selects the accelerator key (⌘ vs Ctrl). Alt is excluded on purpose:
 * on many keyboard layouts AltGr arrives as Control+Alt, so accepting it would
 * fire these chords while the user was typing an ordinary character.
 */
export function classifyPreviewShortcut(
  input: PreviewShortcutInput | null | undefined,
  { isMac }: { isMac: boolean }
): null | PreviewShortcut {
  if (!input) {
    return null
  }

  // Act on the press only. A missing `type` is treated as a press so a caller
  // that does not forward it keeps working.
  if (input.type !== undefined && input.type !== 'keyDown') {
    return null
  }

  const accel = (isMac ? input.meta : input.control) && !input.alt

  if (!accel) {
    return null
  }

  // `input.key` is the LAYOUT-dependent character, so this only ever matches a
  // Latin r/w. That is deliberate: matching a physical code would fire while
  // the user types the letter sitting on that key in another layout.
  const key = String(input.key ?? '').toLowerCase()

  if (key === 'w' && !input.shift) {
    return 'close-tab'
  }

  if (key === 'r') {
    return input.shift ? 'reload-window' : 'reload-page'
  }

  return null
}
