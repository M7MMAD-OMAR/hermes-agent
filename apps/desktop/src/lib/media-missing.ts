import { isFileMediaPath, isInlineMediaSrc, mediaName } from '@/lib/media'

/**
 * Why a delivered result would not load, told apart so the user is not sent to
 * click an "Open file" link that cannot work.
 *
 * The distinction is not cosmetic. Results used to be written wherever the
 * producer chose, and two common choices delete themselves: the gateway prunes
 * its image cache hourly at 24 hours, and `/tmp` is tmpfs on most Linux installs.
 * Reopening a conversation months later found the transcript intact and the
 * files gone, rendered as an audio player stuck at 0:00 with a link that also
 * failed. That reads as a broken app, so people retry it forever. Saying the file
 * is gone is the difference between an unexplained defect and a fact.
 */
export type MediaFailure = 'gone' | 'unreadable'

/**
 * Ask the desktop bridge whether the file is still there.
 *
 * Only a local filesystem path can be checked, so anything else is reported
 * `unreadable`: a remote URL that failed is a transport problem, and claiming it
 * was deleted would be a confident lie. The bridge answering false for a path it
 * is not allowed to read has the same shape as a deleted file, which is why the
 * copy says the file cannot be found rather than accusing anything of deleting
 * it.
 */
export async function classifyMediaFailure(path: string): Promise<MediaFailure> {
  if (isInlineMediaSrc(path) || !isFileMediaPath(path)) {
    return 'unreadable'
  }

  const exists = await window.hermesDesktop?.mediaExists?.(path)

  // `undefined` is "no bridge to ask" (a browser build), not "deleted".
  return exists === false ? 'gone' : 'unreadable'
}

/** What to tell the user, given the failure and the file's name. */
export function mediaFailureMessage(failure: MediaFailure, path: string): string {
  const name = mediaName(path)

  return failure === 'gone'
    ? `${name} is no longer on disk. The conversation kept its name, but the file itself was deleted.`
    : `Couldn't load ${name} (unreadable, or too large).`
}
