import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { classifyMediaFailure, mediaFailureMessage } from './media-missing'

const desktopWindow = window as unknown as { hermesDesktop?: unknown }

function bridge(exists: boolean | undefined) {
  const mediaExists = vi.fn().mockResolvedValue(exists)

  desktopWindow.hermesDesktop = { mediaExists }

  return mediaExists
}

beforeEach(() => {
  delete desktopWindow.hermesDesktop
})

afterEach(() => {
  delete desktopWindow.hermesDesktop
})

describe('telling a deleted result from one that just would not load', () => {
  it('reports a local file the bridge cannot find as gone', async () => {
    bridge(false)
    expect(await classifyMediaFailure('/tmp/cast_narrator.mp3')).toBe('gone')
  })

  it('reports a local file that is still there as merely unreadable', async () => {
    // The file exists, so whatever failed was the load, not the file. Saying it
    // was deleted here would send the user hunting for something that is on
    // their disk.
    bridge(true)
    expect(await classifyMediaFailure('/tmp/cast_narrator.mp3')).toBe('unreadable')
  })

  it('never claims a remote URL was deleted', async () => {
    const mediaExists = bridge(false)

    expect(await classifyMediaFailure('https://example.com/clip.mp3')).toBe('unreadable')
    expect(mediaExists).not.toHaveBeenCalled()
  })

  it('never claims a data URL was deleted', async () => {
    expect(await classifyMediaFailure('data:audio/mpeg;base64,AAAA')).toBe('unreadable')
  })

  it('does not guess when there is no bridge to ask', async () => {
    // A browser build has no filesystem. "Deleted" would be a confident lie.
    expect(await classifyMediaFailure('/tmp/cast_narrator.mp3')).toBe('unreadable')
  })
})

describe('what the user is told', () => {
  it('says the file is gone, naming it', () => {
    const message = mediaFailureMessage('gone', '/tmp/cast_narrator.mp3')

    expect(message).toContain('cast_narrator.mp3')
    expect(message).toContain('no longer on disk')
  })

  it('does not say deleted when the file may still be there', () => {
    const message = mediaFailureMessage('unreadable', '/tmp/cast_narrator.mp3')

    expect(message).toContain('cast_narrator.mp3')
    expect(message).not.toContain('no longer on disk')
  })
})
