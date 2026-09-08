import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { $activeConnectionId } from '@/store/connections'
import { requestGatewayForAgent } from '@/store/gateway'
import { $activeGatewayProfile, $profileScope, ALL_PROFILES } from '@/store/profile'
import { requestStartWorkSession } from '@/store/projects'

interface ProjectWorkflowDialogProps {
  project: { id: string; name: string }
  onClose: () => void
}

const WORKFLOWS = ['quick-ui', 'client-delivery', 'research', 'weekly-review'] as const
const APPROACHES = ['quick', 'standard', 'thorough'] as const

export function ProjectWorkflowDialog({ project, onClose }: ProjectWorkflowDialogProps) {
  const { t, locale } = useI18n()
  const a = t.projectWorkflows
  const profile = useStore($activeGatewayProfile)
  const connectionId = useStore($activeConnectionId)
  const profileScope = useStore($profileScope)
  const [owner] = useState({ profile, connectionId })
  const [workflow, setWorkflow] = useState<(typeof WORKFLOWS)[number]>('quick-ui')
  const [approach, setApproach] = useState<(typeof APPROACHES)[number]>('quick')
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const ownsScope = owner.profile === profile && owner.connectionId === connectionId && profileScope !== ALL_PROFILES

  // eslint-disable-next-line no-restricted-syntax -- Async lifecycle guard, not a reactive mirror.
  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!ownsScope) {
      onClose()
    }
  }, [ownsScope, onClose])

  async function openDraft() {
    setBusy(true)
    setError(null)

    try {
      const result = await requestGatewayForAgent<{ cwd: string; draft: string }>(
        owner.connectionId,
        owner.profile,
        'projects.workflow',
        { id: project.id, workflow, approach, task }
      )

      if (
        !alive.current ||
        owner.profile !== $activeGatewayProfile.get() ||
        owner.connectionId !== $activeConnectionId.get() ||
        $profileScope.get() === ALL_PROFILES
      ) {
        return
      }

      requestStartWorkSession(result.cwd, result.draft, {
        openTab: true,
        route: { connectionId: owner.connectionId || 'local', profile: owner.profile }
      })
      onClose()
    } catch (err) {
      if (alive.current) {
        setError(String(err))
      }
    } finally {
      if (alive.current) {
        setBusy(false)
      }
    }
  }

  if (!ownsScope) {
    return null
  }

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) {
          onClose()
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {a.title}: {project.name}
          </DialogTitle>
          <DialogDescription>{a.hint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Select
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            onValueChange={value => {
              setWorkflow(value as typeof workflow)
              setApproach(value === 'quick-ui' ? 'quick' : 'standard')
            }}
            value={workflow}
          >
            <SelectTrigger aria-label={a.workflow}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOWS.map(value => (
                <SelectItem key={value} value={value}>
                  {a.names[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{a.descriptions[workflow]}</p>
          <div className="space-y-2">
            <Select
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
              onValueChange={value => setApproach(value as typeof approach)}
              value={approach}
            >
              <SelectTrigger aria-label={a.approach}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROACHES.map(value => (
                  <SelectItem key={value} value={value}>
                    {a.approaches[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{a.approachHint}</p>
          </div>
          <Textarea
            aria-label={a.task}
            dir="auto"
            maxLength={16000}
            onChange={event => setTask(event.target.value)}
            placeholder={a.task}
            value={task}
          />
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button disabled={busy || !task.trim()} onClick={() => void openDraft()}>
            {busy ? a.preparing : a.openDraft}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
