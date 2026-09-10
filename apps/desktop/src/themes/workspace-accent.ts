/**
 * Per-workspace accent seed.
 *
 * A workspace may retint the active theme from one seed color so its tab, its
 * chats and its chrome read as one place (HerWork). `null` means "no
 * workspace tint": the theme paints exactly as authored, which is the state
 * Sessions and Bots are always in.
 *
 * This is NOT `$accentOverride`. That one is a dev-only authoring knob that
 * must stay `null` in production (see accent-override.ts) and is never
 * persisted; this one is production behaviour owned by whichever workspace is
 * on screen. Composition order lives in the theme context: the dev override,
 * when set, wins, because a scratch control must be able to show any color.
 *
 * Not persisted here either: the workspace that owns the seed re-publishes it
 * whenever it takes the scope, and clears it when it hands the scope back.
 */

import { atom } from 'nanostores'

import { normalizeHex } from './color'

export const $workspaceAccent = atom<null | string>(null)

export function setWorkspaceAccent(color: null | string): void {
  $workspaceAccent.set(color === null ? null : (normalizeHex(color) ?? $workspaceAccent.get()))
}
