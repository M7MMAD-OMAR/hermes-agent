import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  MACOS_TAHOE_DARWIN_MAJOR,
  macTitleBarOverlayHeight,
  nativeOverlayWidth,
  OVERLAY_FALLBACK_WIDTH,
  titleBarOverlayOptions
} from './titlebar-overlay-width'

// This static reservation is only the pre-layout FALLBACK. Once laid out the
// renderer reads the exact width from navigator.windowControlsOverlay
// (use-window-controls-overlay-width.ts) and uses these values only when the WCO
// API is unavailable.

test('Windows reserves the overlay fallback width', () => {
  assert.equal(nativeOverlayWidth({ isWindows: true }), OVERLAY_FALLBACK_WIDTH)
})

test('WSLg custom controls reserve the same fallback width', () => {
  // The original bug: WSL fell through to 0, so the right tools sat under the
  // controls and the title overran into them. The renderer paints them there.
  assert.equal(nativeOverlayWidth({ isWsl: true }), OVERLAY_FALLBACK_WIDTH)
})

test('WSLg disables the undersized native overlay in favor of renderer controls', () => {
  assert.equal(
    titleBarOverlayOptions({
      platform: 'wslg',
      titlebarHeight: 34,
      color: 'transparent',
      foreground: '#ffffff',
      dark: true
    }),
    false
  )
})

test('native Windows keeps the window-controls overlay; plain Linux asks for none', () => {
  const input = { titlebarHeight: 34, color: 'transparent', foreground: '#ffffff', dark: false }

  assert.deepEqual(titleBarOverlayOptions({ platform: 'windows', ...input }), {
    color: 'transparent',
    height: 34,
    symbolColor: '#ffffff'
  })
  assert.equal(titleBarOverlayOptions({ platform: 'linux', ...input }), false)
})

test('macOS keeps its height-only traffic-light overlay', () => {
  assert.deepEqual(
    titleBarOverlayOptions({
      platform: 'mac',
      darwinMajor: MACOS_TAHOE_DARWIN_MAJOR,
      titlebarHeight: 34,
      color: 'transparent',
      foreground: '#ffffff'
    }),
    { height: 0 }
  )
})

test('Linux paints no overlay of ours, so it reserves nothing', () => {
  // The compositor owns close/minimize/maximize on Linux, so main.ts asks for
  // no overlay there. Reserving its width anyway is a dead gap at the end of
  // the top-edge zone's tab row, which is the row that needed the space.
  assert.equal(nativeOverlayWidth({ isWindows: false, isWsl: false }), 0)
  assert.equal(nativeOverlayWidth(), 0)
  assert.equal(nativeOverlayWidth({}), 0)
})

test('macOS uses traffic lights, not a WCO overlay, so it reserves nothing', () => {
  assert.equal(nativeOverlayWidth({ isMac: true }), 0)
})

test('pre-Tahoe keeps the full titlebar overlay height', () => {
  assert.equal(macTitleBarOverlayHeight({ darwinMajor: MACOS_TAHOE_DARWIN_MAJOR - 1, titlebarHeight: 34 }), 34)
})

test('Tahoe (Darwin 25+) drops the overlay height to 0 to avoid electron#49183', () => {
  assert.equal(macTitleBarOverlayHeight({ darwinMajor: MACOS_TAHOE_DARWIN_MAJOR, titlebarHeight: 34 }), 0)
  assert.equal(macTitleBarOverlayHeight({ darwinMajor: MACOS_TAHOE_DARWIN_MAJOR + 1, titlebarHeight: 34 }), 0)
})

test('macTitleBarOverlayHeight tolerates missing args (unknown platform → 0)', () => {
  assert.equal(macTitleBarOverlayHeight(), 0)
})
