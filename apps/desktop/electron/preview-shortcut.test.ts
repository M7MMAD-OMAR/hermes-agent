import { describe, expect, it } from 'vitest'

import { classifyPreviewShortcut, type PreviewShortcutInput } from './preview-shortcut'

const MAC = { isMac: true }
const PC = { isMac: false }

/** A keyDown by default — the case every chord has to answer. */
function press(overrides: PreviewShortcutInput): PreviewShortcutInput {
  return { type: 'keyDown', ...overrides }
}

describe('the reload chords', () => {
  it('sends plain Ctrl/Cmd+R to the page, never the window', () => {
    expect(classifyPreviewShortcut(press({ control: true, key: 'r' }), PC)).toBe('reload-page')
    expect(classifyPreviewShortcut(press({ key: 'r', meta: true }), MAC)).toBe('reload-page')
  })

  it('reserves Shift+Ctrl/Cmd+R for the whole window', () => {
    // The escape hatch was a macOS-only MENU role, so on Linux/Windows it did
    // not exist and plain Ctrl+R was left carrying both jobs.
    expect(classifyPreviewShortcut(press({ control: true, key: 'r', shift: true }), PC)).toBe('reload-window')
    expect(classifyPreviewShortcut(press({ key: 'r', meta: true, shift: true }), MAC)).toBe('reload-window')
  })

  it('fires once per press, not again on release', () => {
    // before-input-event fires for keyUp too; the previous inline check tested
    // neither, so every reload was dispatched twice.
    expect(classifyPreviewShortcut({ control: true, key: 'r', type: 'keyUp' }, PC)).toBeNull()
    expect(classifyPreviewShortcut({ control: true, key: 'r', shift: true, type: 'keyUp' }, PC)).toBeNull()
  })
})

describe('the close chord', () => {
  it('claims Ctrl/Cmd+W', () => {
    expect(classifyPreviewShortcut(press({ control: true, key: 'w' }), PC)).toBe('close-tab')
    expect(classifyPreviewShortcut(press({ key: 'w', meta: true }), MAC)).toBe('close-tab')
  })

  it('leaves Shift+Ctrl/Cmd+W alone', () => {
    expect(classifyPreviewShortcut(press({ control: true, key: 'w', shift: true }), PC)).toBeNull()
  })
})

describe('what must never match', () => {
  it('ignores the bare letter, so typing is untouched', () => {
    expect(classifyPreviewShortcut(press({ key: 'r' }), PC)).toBeNull()
    expect(classifyPreviewShortcut(press({ key: 'w' }), PC)).toBeNull()
  })

  it('ignores AltGr, which many layouts deliver as Control+Alt', () => {
    // Accepting it would fire a reload while the user typed an ordinary
    // character on those layouts.
    expect(classifyPreviewShortcut(press({ alt: true, control: true, key: 'r' }), PC)).toBeNull()
    expect(classifyPreviewShortcut(press({ alt: true, key: 'r', meta: true }), MAC)).toBeNull()
  })

  it('does not accept the other platform\'s accelerator', () => {
    expect(classifyPreviewShortcut(press({ key: 'r', meta: true }), PC)).toBeNull()
    expect(classifyPreviewShortcut(press({ control: true, key: 'r' }), MAC)).toBeNull()
  })

  it('ignores a non-Latin key on another layout', () => {
    // `input.key` is layout-dependent: the Arabic layout puts ق where r sits,
    // and holding Ctrl there must not reload anything.
    expect(classifyPreviewShortcut(press({ control: true, key: 'ق' }), PC)).toBeNull()
  })

  it('is unbothered by a missing or malformed input', () => {
    expect(classifyPreviewShortcut(null, PC)).toBeNull()
    expect(classifyPreviewShortcut(undefined, PC)).toBeNull()
    expect(classifyPreviewShortcut(press({ control: true }), PC)).toBeNull()
  })

  it('treats an absent type as a press, for callers that omit it', () => {
    expect(classifyPreviewShortcut({ control: true, key: 'r' }, PC)).toBe('reload-page')
  })

  it('matches the key case-insensitively (Shift+R reports an uppercase key)', () => {
    expect(classifyPreviewShortcut(press({ control: true, key: 'R', shift: true }), PC)).toBe('reload-window')
  })
})
