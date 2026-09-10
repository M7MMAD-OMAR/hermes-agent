import { describe, expect, it } from 'vitest'

import { LOOK_MAX_EDGE, scaleToFit, shrinkLook } from './preview-look'

describe('the picture the model receives', () => {
  it('leaves a small capture at its own size', () => {
    expect(scaleToFit(800, 600)).toEqual({ height: 600, width: 800 })
  })

  it('caps the long edge and keeps the shape', () => {
    expect(scaleToFit(2800, 1400)).toEqual({ height: 700, width: LOOK_MAX_EDGE })
    expect(scaleToFit(1000, 4000)).toEqual({ height: LOOK_MAX_EDGE, width: 350 })
  })

  it('never returns a zero-sized picture', () => {
    expect(scaleToFit(0, 0)).toEqual({ height: 1, width: 1 })
    expect(scaleToFit(4000, 1)).toEqual({ height: 1, width: LOOK_MAX_EDGE })
  })

  it('hands back the original when the capture cannot be decoded', async () => {
    // jsdom decodes nothing, which is the same path a broken capture takes:
    // a large picture is still better than no picture.
    const original = 'data:image/png;base64,notreallyanimage'

    expect(await shrinkLook(original)).toBe(original)
  })
})
