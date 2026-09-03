/**
 * COMPOSER RELAY — attachments made in a window that has no composer.
 *
 * Every desktop window is its own renderer with its own composer store, so
 * `addComposerAttachment` only ever fills the composer of the window that
 * called it. That is right for every window EXCEPT the popped-out Browser,
 * which has no composer at all: there the click succeeded, the chip landed in
 * an atom nothing renders, and the user saw nothing happen.
 *
 * Only that one window relays. `isAuxiliaryWindow()` looks like the right test
 * and is not — it also covers the secondary session window and the HUD, and
 * both of those are full app renderers with a real composer of their own
 * (see the comments in `store/windows.ts`). Relaying from one of those posts
 * the chip to the PRIMARY window, which is not the window the user is looking
 * at: the same invisible success, one layer further away.
 *
 * Same shape as `session-sync.ts`: a BroadcastChannel, never delivered to its
 * own poster, with the primary window as the only listener. The one addition is
 * an acknowledgement — see `relayComposerAttachment`.
 */

import type { ComposerAttachment } from './composer'

const CHANNEL = 'hermes:composer-attachment'

/** How long to wait for the composer's window to say it took delivery. This is
 *  a same-machine post between two renderers of one Electron app; it either
 *  lands in a frame or there is nobody there. Generous on purpose — the cost of
 *  waiting is a slightly later toast, the cost of being early is a false "could
 *  not add". */
const ACK_TIMEOUT_MS = 400

interface RelayMessage {
  attachment: ComposerAttachment
  requestId: string
}

/** A prompt (words + whatever rides with them) that a window without a
 *  composer wants delivered — the popped-out Browser's pin panel Send/Queue. */
export interface PromptDeliveryPayload {
  attachments: ComposerAttachment[]
  mode: 'now' | 'queue'
  text: string
}

interface DeliveryMessage extends PromptDeliveryPayload {
  requestId: string
}

interface AckMessage {
  ack: string
  /** Only the delivery relay reports an outcome; a bare ack (attachment taken)
   *  means success the same way `true` does. */
  delivered?: boolean
}

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)

let counter = 0

const isRelay = (data: unknown): data is RelayMessage => {
  const message = data as null | Partial<RelayMessage>
  const attachment = message?.attachment

  return (
    typeof message?.requestId === 'string' &&
    Boolean(attachment) &&
    typeof attachment?.id === 'string' &&
    typeof attachment.kind === 'string'
  )
}

const isDelivery = (data: unknown): data is DeliveryMessage => {
  const message = data as null | Partial<DeliveryMessage>

  return (
    typeof message?.requestId === 'string' &&
    typeof message.text === 'string' &&
    (message.mode === 'now' || message.mode === 'queue') &&
    Array.isArray(message.attachments)
  )
}

const isAck = (data: unknown): data is AckMessage => typeof (data as null | Partial<AckMessage>)?.ack === 'string'

/**
 * Hand an attachment to whichever window owns the composer, and report whether
 * that window actually took it.
 *
 * Posting cannot fail usefully — `postMessage` succeeds into an empty room just
 * as happily as a full one — so a bare "we posted it" is exactly the false
 * success this whole file exists to stop. The receiving window acknowledges by
 * id; no acknowledgement inside {@link ACK_TIMEOUT_MS} means nobody took it,
 * and the caller is free to say so.
 */
export function relayComposerAttachment(attachment: ComposerAttachment): Promise<boolean> {
  if (!channel) {
    return Promise.resolve(false)
  }

  counter += 1
  const requestId = `relay-${counter}-${attachment.id}`

  return new Promise<boolean>(resolve => {
    let settled = false

    const finish = (delivered: boolean) => {
      if (settled) {
        return
      }

      settled = true
      channel.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(delivered)
    }

    const onMessage = (event: MessageEvent) => {
      if (isAck(event.data) && event.data.ack === requestId) {
        finish(true)
      }
    }

    const timer = setTimeout(() => finish(false), ACK_TIMEOUT_MS)

    channel.addEventListener('message', onMessage)

    try {
      // Structured-cloned, so only plain data crosses. Everything a
      // ComposerAttachment carries already is.
      channel.postMessage({ attachment, requestId } satisfies RelayMessage)
    } catch {
      finish(false)
    }
  })
}

/** Subscribe the composer-owning window. Acknowledges every attachment it takes
 *  so the sender can tell delivery from a post into an empty room. */
export function onRelayedComposerAttachment(handler: (attachment: ComposerAttachment) => void): () => void {
  if (!channel) {
    return () => {}
  }

  const listener = (event: MessageEvent) => {
    if (!isRelay(event.data)) {
      return
    }

    handler(event.data.attachment)

    try {
      channel.postMessage({ ack: event.data.requestId } satisfies AckMessage)
    } catch {
      // The chip is already in the composer; a lost acknowledgement costs the
      // sender a wrong toast, not the user's attachment.
    }
  }

  channel.addEventListener('message', listener)

  return () => channel.removeEventListener('message', listener)
}

/**
 * Hand one prompt to whichever window owns the composer and the queue, and
 * report whether it actually landed there — the same acknowledgement contract
 * as {@link relayComposerAttachment}, because a popped-out Browser has no way
 * to check on its own. A `false` answer is the caller's cue to say "could not
 * send" and keep the comment pending rather than lose it.
 */
export function relayPromptDelivery(payload: PromptDeliveryPayload): Promise<boolean> {
  if (!channel) {
    return Promise.resolve(false)
  }

  counter += 1
  const requestId = `delivery-${counter}-${payload.mode}`

  return new Promise<boolean>(resolve => {
    let settled = false

    const finish = (delivered: boolean) => {
      if (settled) {
        return
      }

      settled = true
      channel!.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(delivered)
    }

    const onMessage = (event: MessageEvent) => {
      if (isAck(event.data) && event.data.ack === requestId) {
        finish(event.data.delivered !== false)
      }
    }

    const timer = setTimeout(() => finish(false), ACK_TIMEOUT_MS)

    channel.addEventListener('message', onMessage)

    try {
      channel.postMessage({ ...payload, requestId } satisfies DeliveryMessage)
    } catch {
      finish(false)
    }
  })
}

/** Subscribe the window that owns the composer and the queue. Runs the
 *  delivery and answers with its outcome, so the sending window can tell a
 *  delivered prompt from one that landed in an empty room. */
export function onRelayedPromptDelivery(handler: (payload: PromptDeliveryPayload) => Promise<boolean>): () => void {
  if (!channel) {
    return () => {}
  }

  const listener = (event: MessageEvent) => {
    if (!isDelivery(event.data)) {
      return
    }

    const { requestId, delivery } = { requestId: event.data.requestId, delivery: event.data }

    void (async () => {
      let delivered = false

      try {
        delivered = await handler({
          attachments: delivery.attachments,
          mode: delivery.mode,
          text: delivery.text
        })
      } catch {
        delivered = false
      }

      try {
        channel!.postMessage({ ack: requestId, delivered } satisfies AckMessage)
      } catch {
        // The prompt is already delivered or not; the ack only carries the
        // toast. Nothing to recover here.
      }
    })()
  }

  channel.addEventListener('message', listener)

  return () => channel.removeEventListener('message', listener)
}
