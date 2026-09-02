/**
 * PIN PANEL REQUESTS — the keybind layer's way to reach the pin panel.
 *
 * Keybind handlers live app-wide (`use-keybinds.ts`) while the panel is one
 * component deep in the preview pane, and the panel's real actions (toggle
 * annotate, attach pending) close over page state no global knows. An atom
 * request counter is the seam: handlers bump it, the panel watches and runs
 * its own action, nobody reaches into anybody's internals.
 *
 * Counters, not flags: two taps in a row must toggle twice — a boolean would
 * swallow the second press.
 */

import { atom } from 'nanostores'

export const $annotateToggleRequest = atom(0)

export const requestAnnotateToggle = () => $annotateToggleRequest.set($annotateToggleRequest.get() + 1)

export const $attachPinsRequest = atom(0)

export const requestAttachPins = () => $attachPinsRequest.set($attachPinsRequest.get() + 1)
