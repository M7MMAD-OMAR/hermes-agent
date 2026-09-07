/**
 * `hermes://chat/<storedSessionId>`: the OS-level address of one conversation.
 *
 * Why a deep link rather than the existing notification IPC: the IPC path only
 * exists while the app is running and only ever reaches the main window. A URL
 * is the one address that survives the app being closed (the desktop entry
 * relaunches it and the link arrives as cold-start argv) and that a
 * notification daemon can carry in the body as a plain hyperlink, which is what
 * makes the notification itself clickable on shells that bind no default
 * action.
 *
 * The id in the link is always the DURABLE (stored) session id. A runtime id is
 * ephemeral: by the time the user clicks, the session may have been evicted and
 * resumed under a new one, and the link would resolve to nothing. A cold start
 * has no renderer state to translate with either, so nothing else would work.
 */

/** Stored session ids are opaque, but a link must never smuggle a path. */
const SAFE_ID = /^[A-Za-z0-9._~:@+-]{1,200}$/

export interface ChatDeepLinkPayload {
  kind: string
  name?: string
  params?: Record<string, string>
}

/**
 * The stored session id a `chat` deep link names, or null.
 *
 * Returns null for every other kind so the caller can fall through to the
 * generic plugin/open resolver rather than swallowing links it does not own.
 */
export function chatSessionIdFromDeepLink(payload: ChatDeepLinkPayload | null | undefined): null | string {
  if (payload?.kind !== 'chat') {
    return null
  }

  const id = (payload.name ?? '').trim()

  return id && SAFE_ID.test(id) ? id : null
}
