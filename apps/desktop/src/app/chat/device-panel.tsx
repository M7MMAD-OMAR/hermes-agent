import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $activeConnectionId } from '@/store/connections'
import {
  $deviceFrames,
  $devicePanelSessions,
  clearDeviceFrame,
  EMPTY_FRAME,
  FRAME_INTERVAL_MS,
  setDeviceFrame,
  setDeviceUnavailable
} from '@/store/device'
import { requestGatewayForAgent } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'

/**
 * DEVICE PANEL — the phone this conversation is driving, docked beside the transcript.
 *
 * The same side-not-top argument the embedded browser makes, for the same reason and
 * more so: a phone is a tall, narrow thing. A band across the top of the chat would
 * show a letterbox of it and cost the transcript its scrollback at the same time.
 *
 * It polls one frame at a time rather than pipelining, so a slow device makes the view
 * lag instead of making it queue. Each poll waits for the previous one, which on a real
 * phone settles at roughly three frames a second: enough to watch a tap land.
 *
 * A failed poll keeps the last frame and dims it. A panel that blanks the moment a
 * device blinks is worse than a two-second-old frame beside its reason, because the
 * reason is usually "the app is restarting" and the old frame is still where it was.
 */

interface DeviceResponse {
  readonly device?: string
  readonly available: boolean
  readonly frame?: string
  readonly height?: number
  readonly reason?: string
  readonly width?: number
}

/**
 * THE GATE — mounted by every chat surface, rendering nothing until this conversation
 * actually has a panel open. It subscribes to one atom; the body below holds the poll
 * loop and a second subscription that rewrites several times a second.
 */
export function DevicePanel({ sessionId }: { sessionId: string }) {
  const open = useStore($devicePanelSessions)

  if (!open.has(sessionId)) {
    return null
  }

  return <DevicePanelBody sessionId={sessionId} />
}

function DevicePanelBody({ sessionId }: { sessionId: string }) {
  const { t } = useI18n()
  const frames = useStore($deviceFrames)
  const profile = useStore($activeGatewayProfile)
  const connectionId = useStore($activeConnectionId)
  const frame = frames.get(sessionId) ?? EMPTY_FRAME
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) {
      return
    }

    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    // One poll at a time. Pipelining on an interval queues requests against a device
    // that is slower than the interval, and the view then runs permanently behind.
    const tick = async () => {
      try {
        const result = await requestGatewayForAgent<DeviceResponse>(connectionId, profile, 'device.frame', {
          session_id: sessionId
        })

        if (!alive) {
          return
        }

        if (result.available && result.frame) {
          setDeviceFrame(sessionId, { height: result.height ?? 0, url: result.frame, width: result.width ?? 0 })
        } else {
          setDeviceUnavailable(sessionId, result.reason ?? '')
        }
      } catch (error) {
        if (alive) {
          setDeviceUnavailable(sessionId, error instanceof Error ? error.message : String(error))
        }
      }

      if (alive) {
        timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS)
      }
    }

    void tick()

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [connectionId, paused, profile, sessionId])

  // A reopened panel must never show the previous phone for a frame.
  useEffect(() => () => clearDeviceFrame(sessionId), [sessionId])

  return (
    <div className="flex h-full min-w-0 flex-col border-s border-border bg-background" data-testid="device-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs">
        {/* The reason belongs in exactly one place: beside a stale frame up here, or in
            place of the missing one below. Rendering it in both says it twice. */}
        <span className="truncate text-muted-foreground">
          {frame.dataUrl && frame.reason ? frame.reason : t.device.live}
        </span>
        <button
          className="rounded px-1.5 py-0.5 hover:bg-accent"
          onClick={() => setPaused(value => !value)}
          type="button"
        >
          {paused ? t.device.resume : t.device.pause}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {frame.dataUrl ? (
          <img
            alt={t.device.screen}
            className={cn('max-h-full max-w-full object-contain', frame.stale && 'opacity-50')}
            src={frame.dataUrl}
          />
        ) : (
          <p className="px-3 text-center text-xs text-muted-foreground">
            {frame.reason || t.device.waiting}
          </p>
        )}
      </div>
    </div>
  )
}
