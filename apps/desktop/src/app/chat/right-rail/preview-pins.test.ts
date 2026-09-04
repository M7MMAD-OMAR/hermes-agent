/**
 * PREVIEW PINS BRIDGE — the script the host actually sends into the guest.
 *
 * The engine's own behaviour is covered by pin-in-page.test.ts against a real
 * document. What is only true HERE is what the bridge wraps around it: the
 * timeout, the null-on-no-page contract, and which verbs wait for the guest to
 * paint before answering.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  capture: null as null | ((rect: unknown) => Promise<string>),
  runner: null as null | ((code: string) => Promise<unknown>)
}))

vi.mock('./preview-script-runner', () => ({
  activePreviewCapture: () => h.capture,
  activePreviewScriptRunner: () => h.runner
}))

import { aimPin, capturePinShot, pinVerb, readPins, shootPin } from './preview-pins'

/** The last script the bridge sent, and a canned report back. */
let sent: string[]

beforeEach(() => {
  sent = []
  h.capture = async () => 'data:image/png;base64,shot'

  h.runner = async (code: string) => {
    sent.push(code)

    return { armed: false, hidden: false, pins: [], url: 'http://x' }
  }
})

describe('what the bridge sends', () => {
  it('aim waits for the guest to paint before it answers', async () => {
    await aimPin('pin-1')

    // Hiding the overlay is a style change; the capture reads the compositor.
    // Without this wait the shot can still contain our own markers — the exact
    // thing aiming is for.
    expect(sent[0]).toContain('requestAnimationFrame')
    expect(sent[0]).toContain('new Promise')
  })

  it('ordinary verbs answer immediately — no frame tax on the poll', async () => {
    await readPins()
    await shootPin('pin-1', 'data:image/png;base64,x')

    // `state` runs every poll beat while a review is open. Making it wait two
    // frames would put a frame tax on the whole panel for nothing: it changes
    // nothing visual that the caller is about to photograph.
    for (const code of sent) {
      expect(code).not.toContain('requestAnimationFrame')
    }
  })

  it('answers null when no page is behind the pane, rather than throwing', async () => {
    h.runner = null

    expect(await pinVerb({ verb: 'state' })).toBeNull()
  })

  it('a verb that throws is null, not an exception the panel has to catch', async () => {
    h.runner = async () => {
      throw new Error('guest navigated mid-call')
    }

    expect(await pinVerb({ verb: 'state' })).toBeNull()
  })

  it('a report without pins is refused — a half-answer is not an answer', async () => {
    h.runner = async () => ({ armed: true, hidden: false, url: 'http://x' })

    expect(await pinVerb({ verb: 'state' })).toBeNull()
  })
})

describe('the overlay always comes back', () => {
  /**
   * `aim` hides the whole pin overlay INSIDE the guest, so by the time
   * anything downstream can fail, the user's comments are already invisible.
   * Every one of these paths used to return before `shoot` ran, leaving them
   * that way until a reload.
   */
  const verbsIn = () => sent.map(code => (code.match(/"verb":"(\w+)"/) ?? [])[1])

  it('restores after a normal capture', async () => {
    h.runner = async (code: string) => {
      sent.push(code)

      return { aim: { height: 20, left: 5, top: 5, width: 40 }, armed: false, hidden: false, pins: [], url: 'http://x' }
    }

    expect(await capturePinShot('pin-1')).toBe(true)
    expect(verbsIn()).toEqual(['aim', 'shoot'])
  })

  it('restores when aim times out and never answers', async () => {
    h.runner = async (code: string) => {
      sent.push(code)

      if (code.includes('"verb":"aim"')) {
        throw new Error('preview pins: aim did not answer')
      }

      return { armed: false, hidden: false, pins: [], url: 'http://x' }
    }

    expect(await capturePinShot('pin-1')).toBe(false)
    expect(verbsIn()).toContain('shoot')
  })

  it('restores when the pin resolves nowhere, so no capture is taken', async () => {
    h.runner = async (code: string) => {
      sent.push(code)

      return { aim: null, armed: false, hidden: false, pins: [], url: 'http://x' }
    }

    expect(await capturePinShot('pin-1')).toBe(false)
    expect(verbsIn()).toContain('shoot')
  })

  it('restores when the capture itself throws', async () => {
    h.capture = async () => {
      throw new Error('guest torn down mid-shot')
    }

    h.runner = async (code: string) => {
      sent.push(code)

      return { aim: { height: 20, left: 5, top: 5, width: 40 }, armed: false, hidden: false, pins: [], url: 'http://x' }
    }

    expect(await capturePinShot('pin-1')).toBe(false)
    expect(verbsIn()).toContain('shoot')
  })
})

describe('the paint wait cannot hang', () => {
  it('races requestAnimationFrame against a timer', async () => {
    await aimPin('pin-1')

    // A page that is not painting never fires rAF — a hidden pane, an occluded
    // guest, a backgrounded window. Verified in a real browser; jsdom fires rAF
    // on a timer regardless of visibility, so the hang is invisible here and
    // only this assertion keeps the guard in place.
    expect(sent[0]).toContain('requestAnimationFrame')
    expect(sent[0]).toContain('setTimeout')
  })
})
