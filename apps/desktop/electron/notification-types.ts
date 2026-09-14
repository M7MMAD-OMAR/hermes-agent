export interface HermesNotification {
  title?: string
  body?: string
  silent?: boolean
  kind?: string
  sessionId?: string
  /** Durable click target captured before runtime bindings can be recycled. */
  focusSessionId?: string
  /** DURABLE chat id, so main can build the `hermes://chat/<id>` body link.
   *  Not the runtime id in `sessionId`: the link must still resolve after the
   *  runtime is retired and after the app has been closed and relaunched. */
  chatId?: string
  /** Translated anchor text for that link (main is not localized). */
  linkLabel?: string
  /** Dedupe discriminator for session-less notifications (e.g. plugin id). */
  tag?: string
  /** Absolute icon path for Electron `Notification`. */
  icon?: string
  /** Resolved hash-router path opened on body click (plugin / deeplink-compatible). */
  activate?: string
  /** Renderer handle for onActivate / onAction callbacks. */
  notifyId?: string
  actions?: { id: string; text: string; activate?: string }[]
}
