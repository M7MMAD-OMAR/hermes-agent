import type { PreviewEmulatePayload } from '@/global'

/**
 * Remembers which device-emulation override the guest is actually carrying.
 *
 * The pane recomputes its override on every rung of a ladder (attach, navigate,
 * pane resize, app zoom change), so without a memo it would re-send the same
 * override dozens of times a second while a window is being dragged. The memo
 * is the reason the ladder is cheap, and it is also the thing that can lie.
 *
 * The bridge answers `false` for a guest that is gone, mid-teardown, or not yet
 * owned by this renderer. Recording such an attempt as applied poisons the memo
 * for the pane's whole life: every later rung short-circuits, so the preset
 * stays lit in the toolbar and keeps reporting its size while the page lays out
 * at whatever width the pane happens to be. That is what "the setting is saved
 * but completely ignored" looks like from the outside, and why it survives a
 * window resize: a resize runs the ladder, and the ladder is exactly what the
 * poisoned memo disables.
 *
 * So the key is set optimistically, which keeps a burst of resize ticks down to
 * one send, and cleared again the moment the guest says no.
 */
export interface EmulationCache {
  /** Is this override already believed to be in force? */
  has: (key: string) => boolean
  /** Drop the memo, for a guest that has forgotten everything (a navigation). */
  forget: () => void
  /** Send an override and keep the memo only while the guest accepts it. */
  send: (payload: PreviewEmulatePayload, key: string) => void
}

export type EmulateSender = (payload: PreviewEmulatePayload) => Promise<boolean> | undefined

export function createEmulationCache(send: EmulateSender | undefined): EmulationCache {
  let applied: null | string = null

  const drop = (key: string) => {
    // Only the key this call claimed. A later send may already have replaced it,
    // and clearing that one would re-send an override that IS in force.
    if (applied === key) {
      applied = null
    }
  }

  return {
    forget: () => {
      applied = null
    },
    has: key => applied === key,
    send: (payload, key) => {
      applied = key

      if (!send) {
        drop(key)

        return
      }

      try {
        const result = send(payload)

        if (!result) {
          drop(key)

          return
        }

        void result.then(ok => {
          if (!ok) {
            drop(key)
          }
        }, () => drop(key))
      } catch {
        drop(key)
      }
    }
  }
}
