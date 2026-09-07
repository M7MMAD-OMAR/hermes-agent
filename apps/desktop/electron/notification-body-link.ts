// Making an OS notification actually clickable on Linux.
//
// Electron's Notification adds exactly one action on Linux, "default"/"View",
// and drops the `actions` array entirely (macOS only). Whether that default
// action can be reached is up to the notification daemon, and several popular
// shells bind nothing to a body click, so the notification looks inert even
// though the app is listening.
//
// Every daemon that advertises `body-hyperlinks` does honour a link inside the
// body, so a `hermes://chat/<id>` anchor gives the notification a target the
// user can actually hit. It also outlives the app: the URL goes through the
// desktop entry, so it works when Hermes is closed, which no IPC path can do.
//
// Strictly capability-gated. A daemon without `body-hyperlinks` would show the
// raw markup as text, which is worse than no link at all.

/** Stored session ids are opaque, but a URL must never smuggle a path. */
const SAFE_SESSION_ID = /^[A-Za-z0-9._~:@+-]{1,200}$/

/**
 * The `hermes://chat/<id>` URL for one conversation, or null when the id is
 * unusable.
 *
 * The id is always the DURABLE (stored) session id. A runtime id is ephemeral:
 * by the time the user clicks, the session may have been evicted and resumed
 * under a new one. A cold start has no renderer state to translate with either,
 * so nothing but the durable id can work.
 */
export function chatDeepLink(storedSessionId: null | string | undefined, scheme = 'hermes'): null | string {
  const id = String(storedSessionId ?? '').trim()

  if (!id || !SAFE_SESSION_ID.test(id)) {
    return null
  }

  return `${scheme}://chat/${encodeURIComponent(id)}`
}

/** Parse the reply of `org.freedesktop.Notifications.GetCapabilities`. */
export function parseNotifyCapabilities(raw: string): string[] {
  const out: string[] = []

  // gdbus prints a GVariant tuple: (['persistence', 'body', 'actions'],)
  for (const match of String(raw ?? '').matchAll(/'([^']*)'/g)) {
    const cap = match[1]?.trim()

    if (cap) {
      out.push(cap)
    }
  }

  return out
}

export function supportsBodyHyperlinks(capabilities: readonly string[] | null | undefined): boolean {
  return Array.isArray(capabilities) && capabilities.includes('body-hyperlinks')
}

/** Pango/HTML-ish escape. Only applied on the path that injects markup. */
function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface DecorateBodyOptions {
  capabilities?: readonly string[] | null
  /** Absolute `hermes://…` URL, or null when the event names no chat. */
  link?: null | string
  /** Already-translated anchor text. */
  linkLabel?: null | string
}

/**
 * Append a clickable link to a notification body, or return it untouched.
 *
 * Untouched is the answer whenever anything is missing: no link, no label, or a
 * daemon that does not advertise `body-hyperlinks`. That keeps the failure mode
 * "the notification is exactly what it is today" rather than "the notification
 * shows angle brackets".
 */
export function decorateNotificationBody(body: string, options: DecorateBodyOptions = {}): string {
  const text = String(body ?? '')
  const link = (options.link ?? '').trim()
  const label = (options.linkLabel ?? '').trim()

  if (!link || !label || !supportsBodyHyperlinks(options.capabilities)) {
    return text
  }

  // Only http(s) and our own scheme may be linked. The daemon hands the href to
  // the desktop's URL opener, so an arbitrary scheme here would be an open
  // redirect into whatever handler the system has registered.
  if (!/^hermes(-dev)?:\/\//.test(link)) {
    return text
  }

  const anchor = `<a href="${escapeMarkup(link)}">${escapeMarkup(label)}</a>`

  return text ? `${escapeMarkup(text)}\n${anchor}` : anchor
}
