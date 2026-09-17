import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { localeDirection, useI18n } from '@/i18n'
import { $activeGatewayProfile, $profiles, profileLabel } from '@/store/profile'
import {
  type ProjectTransferPlan,
  type ProjectTransferReport,
  readProjectTransferPlan,
  transferProject
} from '@/store/projects'

interface ProjectTransferDialogProps {
  project: { id: string; name: string }
  onClose: () => void
}

// Hand a project to another profile. The folders on disk never move: a project
// is a pointer at them, and the same folder can be a project in several
// profiles at once. What crosses is the record and the conversations, so the
// dialog reads the plan first and shows how much history is about to travel.
//
// Copy is the default. A move retires the source conversations into an archive
// the app has no way to undo, so it is a deliberate second choice, never the
// button someone lands on by accident.
export function ProjectTransferDialog({ project, onClose }: ProjectTransferDialogProps) {
  const { t, locale } = useI18n()
  const p = t.sidebar.projects
  const profiles = useStore($profiles)
  const current = useStore($activeGatewayProfile)
  const targets = profiles.filter(entry => entry.name !== current)
  const [target, setTarget] = useState(targets[0]?.name ?? '')
  const [move, setMove] = useState(false)
  const [plan, setPlan] = useState<null | ProjectTransferPlan>(null)
  const [report, setReport] = useState<null | ProjectTransferReport>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const alive = useRef(true)

  // eslint-disable-next-line no-restricted-syntax -- Async lifecycle guard, not a reactive mirror.
  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
    }
  }, [])

  // Read the plan whenever the target changes: the counts, and whether a
  // project on this folder already exists over there, are per-target facts.
  useEffect(() => {
    if (!target) {
      return
    }

    let current = true

    setPlan(null)
    setError(null)
    void readProjectTransferPlan(project.id, target)
      .then(next => {
        if (current && alive.current) {
          setPlan(next)
        }
      })
      .catch((err: unknown) => {
        if (current && alive.current) {
          setError(String(err))
        }
      })

    return () => {
      current = false
    }
  }, [project.id, target])

  async function run() {
    setBusy(true)
    setError(null)

    try {
      const next = await transferProject(project.id, target, move)

      if (alive.current) {
        setReport(next)
      }
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

  const blocked = Boolean(plan && !plan.ok)

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
          <DialogTitle>{p.transferTitle(project.name)}</DialogTitle>
          <DialogDescription>{p.transferHint}</DialogDescription>
        </DialogHeader>
        {report ? (
          <div className="space-y-1">
            <p className="text-sm">{p.transferDone(report.moved_sessions, report.target_profile)}</p>
            {/* A partial failure still carried most of the history; the counts say how much,
                and re-running the same transfer picks up only what is missing. */}
            {!report.ok && (
              <p className="text-xs text-destructive" role="alert">
                {p.transferPartial(report.failed_sessions)}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{p.transferNoTargets}</p>
            ) : (
              <Select dir={localeDirection(locale)} onValueChange={setTarget} value={target}>
                <SelectTrigger aria-label={p.transferTarget}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targets.map(entry => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {profileLabel(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {plan && (
              <div className="space-y-1 text-sm">
                <p>{p.transferCarries(plan.session_count, plan.message_count)}</p>
                <p className="text-xs text-muted-foreground">{p.transferFoldersStay}</p>
                {plan.notes.map(note => (
                  <p className="text-xs text-muted-foreground" key={note}>
                    {note}
                  </p>
                ))}
                {plan.blockers.map(blocker => (
                  <p className="text-xs text-destructive" key={blocker} role="alert">
                    {blocker}
                  </p>
                ))}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input
                checked={move}
                className="mt-1"
                onChange={event => setMove(event.target.checked)}
                type="checkbox"
              />
              <span>
                {p.transferMove}
                <span className="block text-xs text-muted-foreground">{p.transferMoveHint}</span>
              </span>
            </label>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {report ? (
            <Button onClick={onClose}>{t.common.close}</Button>
          ) : (
            <>
              <Button onClick={onClose} variant="ghost">
                {t.common.cancel}
              </Button>
              <Button disabled={busy || !plan || blocked} onClick={() => void run()}>
                {move ? p.transferConfirmMove : p.transferConfirmCopy}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
