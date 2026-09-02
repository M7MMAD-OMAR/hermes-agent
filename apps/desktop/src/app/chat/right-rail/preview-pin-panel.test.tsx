/**
 * The panel is the durable half of the feature: the engine dies with the page,
 * and everything that has to outlive a navigation lives here. These are the
 * behaviours that only exist at this level — closing hands the page back,
 * pages keep their own comments, and attaching sends the whole review.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PinEngineReport, PreviewPin } from '@/lib/preview-pins/types'
import { $composerAttachments } from '@/store/composer'

import { PreviewPinPanel } from './preview-pin-panel'

// Mock state lives on `vi.hoisted` refs: vi.mock is hoisted above the consts,
// so the factories must read through a holder that exists at hoist time.
const h = vi.hoisted(() => ({
  browserWindow: vi.fn(() => false),
  relay: vi.fn(async (_attachment: unknown) => true),
  notified: [] as { kind?: string; title?: string }[],
  submitted: vi.fn((_text: string) => true),
  queued: vi.fn((_key: string, _text: string) => true)
}))

const { browserWindow, relay, notified, submitted, queued } = h

vi.mock('@/store/windows', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isBrowserWindow: () => h.browserWindow()
}))

vi.mock('@/store/composer-relay', () => ({ relayComposerAttachment: (a: unknown) => h.relay(a) }))

vi.mock('@/store/notifications', () => ({
  notify: (input: { kind?: string; title?: string }) => {
    h.notified.push(input)

    return 'id'
  }
}))

vi.mock('@/app/chat/composer/focus', () => ({
  requestComposerSubmit: (text: string) => h.submitted(text)
}))

vi.mock('@/store/composer-queue', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueQueuedPrompt: (key: string, payload: { text: string }) => h.queued(key, payload.text)
}))

import { $pinBook, setPinBook } from '@/lib/preview-pins/pin-book-store'
import { $queuedPromptsBySession } from '@/store/composer-queue'
import { $activeSessionId, $sessions } from '@/store/session'
import { $sessionStates } from '@/store/session-states'

import {
  $annotateToggleRequest,
  $attachPinsRequest,
  requestAnnotateToggle,
  requestAttachPins
} from './preview-pin-requests'

const HOME = 'http://localhost:5178/en/index.html'
const ABOUT = 'http://localhost:5178/en/about.html'

/** The guest page, standing in for the engine: one bucket of pins per url. */
const page = {
  armed: false,
  hidden: false,
  pins: {} as Record<string, PreviewPin[]>,
  url: HOME
}

function report(): PinEngineReport {
  return {
    armed: page.armed,
    hidden: page.hidden,
    pendingShots: [],
    pins: page.pins[page.url] ?? [],
    url: page.url
  }
}

const readPinsMock = vi.fn(async () => report())

const hidePins = vi.fn(async () => {
  page.armed = false
  page.hidden = true

  return report()
})

const showPins = vi.fn(async (seed?: null | PreviewPin[]) => {
  page.hidden = false

  if (seed?.length) {
    page.pins[page.url] = seed
  }

  return report()
})

const armPins = vi.fn(async (seed?: null | PreviewPin[]) => {
  page.armed = true

  if (seed?.length) {
    page.pins[page.url] = seed
  }

  return report()
})

vi.mock('./preview-pins', () => ({
  armPins: (seed?: null | PreviewPin[]) => armPins(seed),
  deliverPin: vi.fn(async () => report()),
  ackDeliverRequests: vi.fn(async () => report()),
  clearPins: vi.fn(async () => {
    page.pins = {}

    return report()
  }),
  disarmPins: vi.fn(async () => {
    page.armed = false

    return report()
  }),
  hidePins: () => hidePins(),
  readPins: () => readPinsMock(),
  reattachPins: vi.fn(async (seed?: null | PreviewPin[]) => {
    // Mirrors the real seed filter: only pins belonging to this page, and only
    // when there is something to seed — buildScript skips an empty seed, so a
    // mock that honours `[]` would wipe the page the panel just opened.
    if (seed?.length) {
      page.pins[page.url] = seed.filter(pin => pin.pageUrl === page.url)
    }

    return report()
  }),
  removePin: vi.fn(async () => report()),
  showPins: (seed?: null | PreviewPin[]) => showPins(seed),
  takeShot: vi.fn(async () => report()),
  togglePinResolved: vi.fn(async () => report())
}))

function pin(pageUrl: string, comment: string, id = comment): PreviewPin {
  return {
    anchor: {
      label: comment,
      ordinal: 0,
      path: 'body>button',
      rect: { h: 0.1, w: 0.1, x: 0, y: 0 },
      role: 'button',
      selector: `#${id}`,
      text: comment
    },
    comment,
    createdAt: id.length,
    id,
    kind: 'element',
    pageUrl,
    resolved: false,
    target: comment
  }
}

beforeEach(() => {
  page.armed = false
  page.hidden = false
  page.pins = {}
  page.url = HOME
  $composerAttachments.set([])
  $queuedPromptsBySession.set({})
  setPinBook({})
  $activeSessionId.set('sess-1')
  $sessions.set([{ _lineage_root_id: 'root-1', id: 'sess-1' } as never])
  $sessionStates.set({})
  // Request counters are module state: without a reset, a hotkey pressed in
  // one test fires again inside the next test's fresh panel mount.
  $annotateToggleRequest.set(0)
  $attachPinsRequest.set(0)
  submitted.mockClear()
  submitted.mockReturnValue(true)
  queued.mockClear()
  queued.mockReturnValue(true)
  browserWindow.mockReturnValue(false)
  relay.mockResolvedValue(true)
  notified.length = 0
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('closing the panel', () => {
  it('hands the page back instead of leaving it armed', async () => {
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(showPins).toHaveBeenCalled())

    view.rerender(<PreviewPinPanel open={false} url={HOME} />)

    // The reported bug: a closed panel that still swallows the next click.
    await waitFor(() => expect(hidePins).toHaveBeenCalled())
  })

  it('hides on unmount too, since a pane can go away without closing', async () => {
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(showPins).toHaveBeenCalled())
    view.unmount()
    await waitFor(() => expect(hidePins).toHaveBeenCalled())
  })

  it('renders nothing while closed', () => {
    render(<PreviewPinPanel open={false} url={HOME} />)
    expect(screen.queryByText('Annotate')).toBeNull()
  })
})

describe('bubble requests and keybinds (Sprint 02)', () => {
  it('executes a bubble NOW request: one submit, delivered, no resend', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    // The bubble wrote its intent; the next state read carries it out.
    readPinsMock.mockResolvedValueOnce({
      ...report(),
      deliver: [{ id: 'hero', mode: 'now' }]
    })
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1))
    expect(submitted.mock.calls[0][0]).toContain('hero')
    // Delivered: gone from the pending list, marked in the book.
    await waitFor(() => expect(screen.queryAllByText('hero')).toHaveLength(0))
    expect($pinBook.get()[HOME][0].delivered).toBe(true)

    // And it must NOT fire again on the next identical poll.
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1))
  })

  it('executes a bubble QUEUE request through the queue, not the composer', async () => {
    page.pins[HOME] = [pin(HOME, 'nav', 'nav')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('nav').length).toBeGreaterThan(0))

    readPinsMock.mockResolvedValueOnce({
      ...report(),
      deliver: [{ id: 'nav', mode: 'queue' }]
    })

    await waitFor(() => expect(queued).toHaveBeenCalledTimes(1))
    expect(queued.mock.calls[0][1]).toContain('nav')
    await waitFor(() => expect(screen.queryAllByText('nav')).toHaveLength(0))
    expect(submitted).not.toHaveBeenCalled()
  })

  it('the annotate keybind request toggles the arm state', async () => {
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getByText('Annotate')).toBeTruthy())

    requestAnnotateToggle()

    await waitFor(() => expect(armPins).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Annotating')).toBeTruthy())
  })

  it('the attach keybind request delivers every pending comment', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    requestAttachPins()

    await waitFor(() => expect(screen.queryAllByText('hero')).toHaveLength(0))
    expect($pinBook.get()[HOME][0].delivered).toBe(true)
  })
})

describe('one comment, one send (Sprint 01)', () => {
  it('the book survives a remount: the review is in the store, not the component', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    view.unmount()
    // A fresh mount (pane reopen, conversation switch back, window reopen)
    // reads the book from the store — the ref used to die with the component.
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))
  })

  it('Send delivers ONE comment as a real submit and leaves the others pending', async () => {
    page.pins[HOME] = [pin(HOME, 'hero'), pin(HOME, 'nav', 'nav')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen
      .getAllByTitle('Send this comment to the chat now')
      .find(button => button.closest('li')?.textContent?.includes('hero'))!
      .click()

    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1))
    expect(submitted.mock.calls[0][0]).toContain('hero')
    // Only the sent comment leaves the list — the other stays exactly as it was.
    await waitFor(() => expect(screen.queryAllByText('hero')).toHaveLength(0))
    expect(screen.getAllByText('nav').length).toBeGreaterThan(0)
  })

  it('Queue parks ONE comment in the conversation queue, and nothing is deleted', async () => {
    page.pins[HOME] = [pin(HOME, 'hero'), pin(HOME, 'nav', 'nav')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen
      .getAllByTitle("Add this comment to the conversation's queue")
      .find(button => button.closest('li')?.textContent?.includes('hero'))!
      .click()

    await waitFor(() => expect(queued).toHaveBeenCalledTimes(1))
    expect(queued.mock.calls[0][0]).toBe('root-1')
    expect(queued.mock.calls[0][1]).toContain('hero')
    await waitFor(() => expect(screen.queryAllByText('hero')).toHaveLength(0))
    // The unsent comment is untouched — auto-deleting anything not delivered
    // was the reported bug.
    expect(screen.getAllByText('nav').length).toBeGreaterThan(0)
  })

  it('Send all empties the pending list only, and only on real delivery', async () => {
    page.pins[HOME] = [pin(HOME, 'hero'), pin(HOME, 'nav', 'nav')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    await waitFor(() => expect(screen.queryAllByText('hero')).toHaveLength(0))
    await waitFor(() => expect(screen.queryAllByText('nav')).toHaveLength(0))
    // The comments still exist in the book, marked delivered — history, not dust.
    const book = $pinBook.get()
    expect(book[HOME]).toHaveLength(2)
    expect(book[HOME].every(p => p.delivered)).toBe(true)
  })

  it('a failed delivery is NOT marked delivered — nothing disappears silently', async () => {
    browserWindow.mockReturnValue(true)
    relay.mockResolvedValue(false)
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    await waitFor(() => expect(notified.at(-1)?.kind).toBe('error'))
    // The comment is still pending: the user's writing is never the price of a
    // failed send.
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))
    expect($pinBook.get()[HOME][0].delivered).toBeUndefined()
  })
})

describe('a review across pages', () => {
  it("keeps each page's comments and does not carry them over", async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    page.url = ABOUT
    page.pins[ABOUT] = []
    view.rerender(<PreviewPinPanel open url={ABOUT} />)

    // The home page's comment must not reappear here as a detached pin.
    await waitFor(() => expect(screen.queryAllByText('hero')).toHaveLength(0))
    await waitFor(() => expect(screen.getByText(/1 on 1 other page/)).toBeTruthy())
  })

  it('gives a page its own comments back when the user returns', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    page.url = ABOUT
    page.pins[ABOUT] = [pin(ABOUT, 'team photo')]
    view.rerender(<PreviewPinPanel open url={ABOUT} />)
    await waitFor(() => expect(screen.getAllByText('team photo').length).toBeGreaterThan(0))

    page.url = HOME
    view.rerender(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))
  })

  it('attaches the whole review, not just the page in front of you', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    page.url = ABOUT
    page.pins[ABOUT] = [pin(ABOUT, 'team photo')]
    view.rerender(<PreviewPinPanel open url={ABOUT} />)
    await waitFor(() => expect(screen.getAllByText('team photo').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    await waitFor(() => expect($composerAttachments.get()).toHaveLength(1))
    const attachment = $composerAttachments.get()[0]
    expect(attachment.kind).toBe('pins')
    expect(attachment.label).toBe('2 comments')
    // Both pages in one payload — someone who commented on two pages meant one
    // request, not two.
    expect(attachment.detail).toContain('hero')
    expect(attachment.detail).toContain('team photo')
  })

  it('hands the chip to the window that owns the composer', async () => {
    // A popped-out Browser window has no composer of its own: adding there is a
    // click into a void, which is exactly how this was reported.
    browserWindow.mockReturnValue(true)
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    await waitFor(() => expect(relay).toHaveBeenCalled())
    expect($composerAttachments.get()).toHaveLength(0)
    await waitFor(() => expect(notified.at(-1)?.kind).toBe('success'))
  })

  it('keeps the chip in a window that has its own composer', async () => {
    // The regression this replaced: the guard was `isAuxiliaryWindow()`, which
    // also covers the secondary session window and the HUD. Both render a real
    // composer, so relaying handed the chip to the PRIMARY window — a success
    // toast in front of the user and the attachment one window away.
    browserWindow.mockReturnValue(false)
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    await waitFor(() => expect($composerAttachments.get()).toHaveLength(1))
    expect(relay).not.toHaveBeenCalled()
  })

  it('says so when there is nowhere to put it', async () => {
    browserWindow.mockReturnValue(true)
    relay.mockResolvedValue(false)
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    // Silence is what made the bug invisible; an error is the minimum.
    await waitFor(() => expect(notified.at(-1)?.kind).toBe('error'))
  })

  it('confirms out loud when it did land, since the composer may be off-screen', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    screen.getByText('Send all').click()

    await waitFor(() => expect($composerAttachments.get()).toHaveLength(1))
    await waitFor(() => expect(notified.at(-1)?.title).toBe('Added to chat'))
  })

  it('shows only the two newest, so the list never eats the page', async () => {
    page.pins[HOME] = ['one', 'two', 'three', 'four'].map((name, index) => ({
      ...pin(HOME, name),
      createdAt: index
    }))
    render(<PreviewPinPanel open url={HOME} />)

    await waitFor(() => expect(screen.getAllByText('four').length).toBeGreaterThan(0))
    expect(screen.getAllByText('three').length).toBeGreaterThan(0)
    // The oldest two are behind the toggle rather than pushing the preview down.
    expect(screen.queryAllByText('one')).toHaveLength(0)
    expect(screen.queryAllByText('two')).toHaveLength(0)

    screen.getByText('Show all 4').click()
    await waitFor(() => expect(screen.getAllByText('one').length).toBeGreaterThan(0))

    screen.getByText('Show fewer').click()
    await waitFor(() => expect(screen.queryAllByText('one')).toHaveLength(0))
  })

  it('keeps each row numbered as its own marker, not as its place in the list', async () => {
    page.pins[HOME] = ['one', 'two', 'three'].map((name, index) => ({
      ...pin(HOME, name),
      createdAt: index
    }))
    render(<PreviewPinPanel open url={HOME} />)

    // Newest first, but "3" is still the third pin placed — the page's marker
    // says 3 too, and the two must agree.
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy())
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('offers no toggle when everything already fits', async () => {
    page.pins[HOME] = [pin(HOME, 'only one')]
    render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('only one').length).toBeGreaterThan(0))
    expect(screen.queryByText(/Show all/)).toBeNull()
  })

  it('can still attach from a page that has nothing on it', async () => {
    page.pins[HOME] = [pin(HOME, 'hero')]
    const view = render(<PreviewPinPanel open url={HOME} />)
    await waitFor(() => expect(screen.getAllByText('hero').length).toBeGreaterThan(0))

    page.url = ABOUT
    page.pins[ABOUT] = []
    view.rerender(<PreviewPinPanel open url={ABOUT} />)
    await waitFor(() => expect(screen.getByText(/1 on 1 other page/)).toBeTruthy())

    const button = screen.getByText('Send all') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    await waitFor(() => expect($composerAttachments.get()).toHaveLength(1))
  })
})
