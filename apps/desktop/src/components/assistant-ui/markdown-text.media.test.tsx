import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $connection } from '@/store/session'

import { MarkdownImage, MarkdownTextContent } from './markdown-text'

const REMOTE_IMAGE_PATH = '/home/user/project/images/remote-preview.png'
const REMOTE_IMAGE_DATA_URL = 'data:image/png;base64,cmVtb3RlLWltYWdl'

describe('MarkdownTextContent remote images', () => {
  const api = vi.fn(async ({ path }: { path: string }) => {
    if (path.startsWith('/api/fs/read-data-url?')) {
      return { dataUrl: REMOTE_IMAGE_DATA_URL }
    }

    throw new Error(`unexpected path ${path}`)
  })

  let originalDesktop: typeof window.hermesDesktop

  beforeEach(() => {
    api.mockClear()
    originalDesktop = window.hermesDesktop
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
    $connection.set({ mode: 'remote', profile: 'remote-work' } as never)
  })

  afterEach(() => {
    cleanup()
    $connection.set(null)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: originalDesktop
    })
  })

  it('passes the gateway bridge data URL through Streamdown to the zoomable image', async () => {
    render(<MarkdownTextContent isRunning={false} text={`![Remote preview](${REMOTE_IMAGE_PATH})`} />)

    const image = await screen.findByRole('img', { name: 'Remote preview' })

    expect(image.getAttribute('src')).toBe(REMOTE_IMAGE_DATA_URL)
    expect(api).toHaveBeenCalledWith({
      path: '/api/fs/read-data-url?path=%2Fhome%2Fuser%2Fproject%2Fimages%2Fremote-preview.png',
      profile: 'remote-work'
    })
  })
})

// Regression for #40896: generated media often arrives as image markdown
// (`![clip](clip.mp4)`). A raw <img> with a video/audio source paints a
// broken-image icon even though the file is valid, so MarkdownImage must route
// video/audio sources to the proper <video>/<audio> element.
describe('MarkdownImage media routing', () => {
  afterEach(cleanup)

  it('renders a <video> (not a broken <img>) for a video source', async () => {
    const { container } = render(<MarkdownImage alt="clip" src="file:///tmp/clip.mp4" />)

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders an <audio> element for an audio source', async () => {
    const { container } = render(<MarkdownImage alt="note" src="file:///tmp/note.mp3" />)

    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
  })

  it('still renders an <img> for an image source', () => {
    const { container } = render(<MarkdownImage alt="pic" src="file:///tmp/pic.png" />)

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('audio')).toBeNull()
  })
})

// A delivered result whose file has been deleted used to render as an audio
// player stuck at 0:00 with an "Open audio file" link that also failed, or as a
// bare "Open chart.png" link. Nothing said the file was gone, so it read as a
// loading bug and invited the user to keep clicking. Measured on one real
// install: 655 of 687 delivered files were already deleted.
// The transcript stores a delivered file as a markdown link with a `#media:`
// href (see lib/markdown-preprocess.ts); the raw `MEDIA:` tag never reaches the
// renderer.
const mediaLink = (path: string) => `[${path.split('/').pop()}](#media:${encodeURIComponent(path)})`

describe('a delivered result whose file is gone', () => {
  let originalDesktop: typeof window.hermesDesktop

  const desktop = (exists: boolean) => ({
    mediaExists: vi.fn().mockResolvedValue(exists),
    readFileDataUrl: vi.fn().mockRejectedValue(new Error('ENOENT'))
  })

  const install = (value: unknown) =>
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value })

  beforeEach(() => {
    originalDesktop = window.hermesDesktop
    $connection.set(null)
  })

  afterEach(() => {
    cleanup()
    install(originalDesktop)
  })

  it('says the file is no longer on disk instead of offering a dead link', async () => {
    // An image resolves through the data-URL bridge, so its failure is
    // deterministic here. Audio and video reach the same state through the
    // media element's own `error` event, exercised below.
    install(desktop(false))

    render(<MarkdownTextContent isRunning={false} text={mediaLink('/tmp/refine_ab.jpg')} />)

    expect(await screen.findByText(/no longer on disk/i)).toBeTruthy()
  })

  it('says so for audio too, once the player reports it cannot load', async () => {
    install(desktop(false))

    const { container } = render(<MarkdownTextContent isRunning={false} text={mediaLink('/tmp/cast_narrator.mp3')} />)

    const player = await waitFor(() => {
      const found = container.querySelector('audio')

      expect(found).toBeTruthy()

      return found as HTMLAudioElement
    })

    // jsdom never loads media, so the browser's own error event is fired here
    // rather than waited for.
    player.dispatchEvent(new Event('error'))

    expect(await screen.findByText(/no longer on disk/i)).toBeTruthy()
  })

  it('does not claim deletion when the file is still there', async () => {
    // The load failed but the file exists, so the honest answer is that it could
    // not be loaded. Claiming it was deleted would send the user looking for
    // something sitting on their own disk.
    install(desktop(true))

    render(<MarkdownTextContent isRunning={false} text={mediaLink('/tmp/refine_ab.jpg')} />)

    await waitFor(() => expect(screen.queryByText(/Loading /)).toBeNull())
    expect(screen.queryByText(/no longer on disk/i)).toBeNull()
  })
})
