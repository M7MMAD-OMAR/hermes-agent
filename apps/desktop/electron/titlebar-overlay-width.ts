export const OVERLAY_FALLBACK_WIDTH = 144

interface TitleBarOverlayOptionsInput {
  platform?: 'linux' | 'mac' | 'windows' | 'wslg'
  darwinMajor?: number
  titlebarHeight?: number
  color?: string
  foreground?: string | null
  dark?: boolean
}

/**
 * Static pre-layout reservation (px) for the right-side native window-controls
 * overlay (min/max/close). Only a FALLBACK: once laid out the renderer reads
 * the exact width from navigator.windowControlsOverlay
 * (use-window-controls-overlay-width.ts) and uses this value only when the WCO
 * API is unavailable.
 *
 * Windows paints Electron's overlay and WSLg paints the renderer's own
 * controls (wslg-window-controls.tsx), so those two reserve room for them.
 * macOS positions traffic lights with trafficLightPosition instead, and plain
 * Linux paints no controls of ours at all: the compositor owns those buttons
 * there. Reserving width for controls nobody paints is a dead gap at the end
 * of the tab row. Mirrors `titleBarOverlayOptions` below.
 *
 * @param {{ isWindows?: boolean, isWsl?: boolean, isMac?: boolean }} opts
 */
export function nativeOverlayWidth({ isWindows = false, isWsl = false, isMac = false } = {}) {
  return isWindows || isWsl ? OVERLAY_FALLBACK_WIDTH : 0
}

/**
 * Build Electron's Window Controls Overlay options for every desktop host.
 * With `titleBarStyle: hidden`, Windows shows no window controls unless an
 * overlay object is provided. WSLg deliberately returns false so the renderer
 * can paint correctly scaled Windows-style controls instead, and plain Linux
 * returns false because the compositor already owns close, minimize and
 * maximize there (a keybind, a titlebar the WM paints, a gesture): an Electron
 * overlay would be a second set of buttons sitting on the row the zone's tabs
 * need.
 */
export function titleBarOverlayOptions({
  platform = 'linux',
  darwinMajor = 0,
  titlebarHeight = 0,
  color,
  foreground,
  dark = false
}: TitleBarOverlayOptionsInput = {}) {
  // Electron's Linux overlay keeps a narrow, unscaled three-button cluster
  // under WSLg. The renderer owns larger Windows-shaped controls there while
  // the host's RAIL local-move path continues to own edge dragging and Snap.
  if (platform === 'wslg' || platform === 'linux') {
    return false
  }

  if (platform === 'mac') {
    return { height: macTitleBarOverlayHeight({ darwinMajor, titlebarHeight }) }
  }

  return {
    color,
    height: titlebarHeight,
    symbolColor: foreground || (dark ? '#f7f7f7' : '#242424')
  }
}

// macOS Tahoe ships as Darwin 25 (Sequoia is 24); the Darwin number is truthful,
// unlike the product version which macOS reports as 16 or 26 depending on the
// build SDK.
export const MACOS_TAHOE_DARWIN_MAJOR = 25

/**
 * Height (px) to pass to `titleBarOverlay` on macOS. Tahoe (Darwin 25+)
 * miscalculates the native traffic-light position when the overlay carries a
 * nonzero height (electron#49183), shoving the lights into the left titlebar
 * tools. Return 0 there so `setWindowButtonPosition` lands them at the configured
 * inset; the renderer paints its own drag strips, so nothing is lost. Pre-Tahoe
 * keeps the full titlebar height, byte-identical.
 *
 * @param {{ darwinMajor?: number, titlebarHeight?: number }} opts
 */
export function macTitleBarOverlayHeight({ darwinMajor = 0, titlebarHeight = 0 } = {}) {
  return darwinMajor >= MACOS_TAHOE_DARWIN_MAJOR ? 0 : titlebarHeight
}
