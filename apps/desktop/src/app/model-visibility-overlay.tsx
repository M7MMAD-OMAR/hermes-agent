import { useStore } from '@nanostores/react'

import { ModelVisibilityDialog } from '@/components/model-visibility-dialog'
import type { HermesGateway } from '@/hermes'
import { $modelVisibilityOpen, $modelVisibilityTarget, setModelVisibilityOpen } from '@/store/model-visibility'
import { $activeSessionId, $gatewayState } from '@/store/session'

interface ModelVisibilityOverlayProps {
  gateway?: HermesGateway
  onOpenProviders: () => void
  ownerConnectionId?: string
  profile: string
}

export function ModelVisibilityOverlay({
  gateway,
  onOpenProviders,
  ownerConnectionId,
  profile
}: ModelVisibilityOverlayProps) {
  const activeSessionId = useStore($activeSessionId)
  const gatewayOpen = useStore($gatewayState) === 'open'
  const open = useStore($modelVisibilityOpen)
  // Edit the bot whose menu asked, not whichever profile this chrome is on.
  const target = useStore($modelVisibilityTarget)
  // A targeted profile has no session here: the active session belongs to this
  // chrome, and pairing it with another profile would query a catalog that
  // belongs to neither.
  const targeted = !!target && target.profile !== profile

  if (!gatewayOpen) {
    return null
  }

  return (
    <ModelVisibilityDialog
      gw={gateway}
      onOpenChange={setModelVisibilityOpen}
      onOpenProviders={onOpenProviders}
      open={open}
      ownerConnectionId={target?.ownerConnectionId ?? ownerConnectionId}
      profile={target?.profile ?? profile}
      sessionId={targeted ? null : activeSessionId}
    />
  )
}
