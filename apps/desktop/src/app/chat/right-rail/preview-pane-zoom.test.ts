/**
 * The guest zoom contract: zooming the APP window must never change what a
 * page inside the browser pane renders. The arithmetic lives in
 * pinGuestZoom/zoomFactorToLevel; these tests pin the contract they must hold.
 */

import { describe, expect, it, vi } from 'vitest'

import { pinGuestZoom, zoomFactorToLevel } from './preview-pane'

describe('guest zoom pinning (Sprint 04)', () => {
  it('factor↔level round trips through Chromium mapping', () => {
    for (const factor of [0.5, 0.9, 1, 1.34, 2]) {
      // level = log(factor)/log(1.2); 1.2^level reconstructs the factor.
      const level = zoomFactorToLevel(factor)

      expect(Math.pow(1.2, level)).toBeCloseTo(factor, 10)
    }
  })

  it('pins the guest to the INVERSE of the host zoom, so the page paints 1:1', () => {
    const setZoomLevel = vi.fn()
    const webview = { setZoomLevel } as never

    expect(pinGuestZoom(webview, 1.34)).toBe(true)
    // Host at 134%: the guest compensates with 1.2^level = 1/1.34, i.e. the
    // negative level. Net paint = 1.34 × (1/1.34) = 1.
    const level = setZoomLevel.mock.calls[0][0] as number

    expect(Math.pow(1.2, level) * 1.34).toBeCloseTo(1, 10)
  })

  it('at 100% the pin is level 0 — the guest is untouched', () => {
    const setZoomLevel = vi.fn()
    const webview = { setZoomLevel } as never

    pinGuestZoom(webview, 1)

    expect(setZoomLevel).toHaveBeenCalledWith(0)
  })

  it('degenerate factors fall back to 1 (no pin, level 0)', () => {
    const setZoomLevel = vi.fn()
    const webview = { setZoomLevel } as never

    pinGuestZoom(webview, Number.NaN)

    expect(setZoomLevel).toHaveBeenCalledWith(0)
  })

  it('a guest without the zoom API is skipped, not crashed on', () => {
    const webview = {} as never

    expect(pinGuestZoom(webview, 1.34)).toBe(false)
    expect(pinGuestZoom(null, 1.34)).toBe(false)
  })

  it('a webview destroyed mid-call surfaces false instead of throwing', () => {
    const webview = {
      setZoomLevel: () => {
        throw new Error('Object has been destroyed')
      }
    } as never

    expect(pinGuestZoom(webview, 1.34)).toBe(false)
  })
})
