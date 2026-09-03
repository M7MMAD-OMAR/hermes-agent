import { useStore } from '@nanostores/react'

import { $backdrop } from '@/store/backdrop'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

/** The faint statue texture behind the transcript.
 *
 *  `mix-blend-difference` composites with everything painted beneath it, so
 *  WHERE this mounts is load-bearing, not cosmetic: at chat-surface level it
 *  reached the docked browser and inverted a live website. It belongs inside
 *  the conversation column, clipped to that column's box. See the mount site
 *  in `app/chat/index.tsx`.
 */
export function Backdrop() {
  const on = useStore($backdrop)

  if (!on) {
    return null
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-2 opacity-[0.025] mix-blend-difference">
      <img
        alt=""
        className="h-[160dvh] w-auto min-w-dvw object-cover object-left-top [filter:invert(var(--backdrop-invert-mul,1))]"
        fetchPriority="low"
        src={assetPath('ds-assets/filler-bg0.jpg')}
      />
    </div>
  )
}
