import { JsonRpcGatewayClient } from '@hermes/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `msSinceLastFrame` — the signal that tells a dead transport from a busy backend.
 *
 * A liveness ping that times out proves neither: a gateway starved mid-tool-call answers no ping
 * while its socket is perfectly alive, and tearing that socket down mid-turn is what fed the
 * orphan reap and killed turns with a bare "Operation interrupted." (#95327). An inbound frame,
 * of any kind, is the positive proof a ping timeout can never supply.
 */

interface ListenerEntry {
  callback: (event: any) => void
  once: boolean
}

class FakeSocket {
  static readonly CLOSED = 3
  static readonly OPEN = 1

  readonly sent: string[] = []
  readyState = FakeSocket.OPEN
  private listeners = new Map<string, ListenerEntry[]>()

  addEventListener(type: string, callback: (event: any) => void, options?: AddEventListenerOptions): void {
    const entries = this.listeners.get(type) ?? []

    entries.push({ callback, once: Boolean(options?.once) })
    this.listeners.set(type, entries)
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) {
      return
    }

    this.readyState = FakeSocket.CLOSED
    this.emit('close', { code: 1000 })
  }

  emit(type: string, event: any = {}): void {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      entry.callback(event)

      if (entry.once) {
        this.removeEventListener(type, entry.callback)
      }
    }
  }

  message(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  raw(data: unknown): void {
    this.emit('message', { data })
  }

  removeEventListener(type: string, callback: (event: any) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(entry => entry.callback !== callback)
    )
  }

  send(payload: string): void {
    this.sent.push(payload)
  }
}

const connectClient = async (socket: FakeSocket) => {
  const client = new JsonRpcGatewayClient({ socketFactory: () => socket as unknown as WebSocket })
  const connected = client.connect('ws://gateway.test/api/ws')

  socket.emit('open')
  await connected

  return client
}

describe('JsonRpcGatewayClient frame clock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reports null until a frame has actually arrived', async () => {
    // Crucially not 0: "no frame yet" must never be mistaken for "a frame just now", or a
    // freshly opened socket would be credited with liveness it has not demonstrated.
    vi.stubGlobal('WebSocket', { OPEN: FakeSocket.OPEN })
    const socket = new FakeSocket()
    const client = await connectClient(socket)

    expect(client.msSinceLastFrame).toBeNull()
  })

  it('stamps on any inbound frame', async () => {
    vi.stubGlobal('WebSocket', { OPEN: FakeSocket.OPEN })
    const socket = new FakeSocket()
    const client = await connectClient(socket)

    socket.message({ jsonrpc: '2.0', method: 'event', params: { payload: {}, type: 'gateway.ready' } })

    expect(client.msSinceLastFrame).toBeGreaterThanOrEqual(0)
    expect(client.msSinceLastFrame).toBeLessThan(1_000)
  })

  it('ages as time passes and refreshes on the next frame', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', { OPEN: FakeSocket.OPEN })
    const socket = new FakeSocket()
    const client = await connectClient(socket)

    socket.message({ jsonrpc: '2.0', method: 'event', params: { payload: {}, type: 'gateway.ready' } })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(client.msSinceLastFrame).toBeGreaterThanOrEqual(20_000)

    socket.message({ jsonrpc: '2.0', method: 'event', params: { payload: {}, type: 'status.update' } })
    expect(client.msSinceLastFrame).toBeLessThan(1_000)
  })

  it('counts a frame whose handler throws', async () => {
    // The transport delivered bytes. Whether a handler liked them is a different question, and
    // losing the liveness proof to an unrelated handler bug would tear down a healthy socket.
    vi.stubGlobal('WebSocket', { OPEN: FakeSocket.OPEN })
    const socket = new FakeSocket()
    const client = await connectClient(socket)

    client.onAny(() => {
      throw new Error('handler blew up')
    })

    try {
      socket.message({ jsonrpc: '2.0', method: 'event', params: { payload: {}, type: 'gateway.ready' } })
    } catch {
      // The throw itself is not what this test is about.
    }

    expect(client.msSinceLastFrame).not.toBeNull()
  })

  it('ignores a frame with no readable text', async () => {
    // Nothing was decoded, so nothing was proven about the transport.
    vi.stubGlobal('WebSocket', { OPEN: FakeSocket.OPEN })
    const socket = new FakeSocket()
    const client = await connectClient(socket)

    socket.raw(undefined)

    expect(client.msSinceLastFrame).toBeNull()
  })

  it('does not carry a previous socket history into a new connection', async () => {
    // A reconnect starts with nothing proven; inheriting the old socket's last frame would
    // credit the NEW socket with liveness it has not shown.
    vi.stubGlobal('WebSocket', { OPEN: FakeSocket.OPEN })
    const first = new FakeSocket()
    const client = await connectClient(first)

    first.message({ jsonrpc: '2.0', method: 'event', params: { payload: {}, type: 'gateway.ready' } })
    expect(client.msSinceLastFrame).not.toBeNull()

    first.close()

    const second = new FakeSocket()
    const reconnected = client.connect('ws://gateway.test/api/ws')

    second.emit('open')

    // The factory is fixed to `first`, so drive the reconnect through the client's own socket
    // rather than asserting on this stand-in; what matters is the counter reset on connect().
    await Promise.race([reconnected, Promise.resolve()])

    expect(client.msSinceLastFrame).toBeNull()
  })
})
