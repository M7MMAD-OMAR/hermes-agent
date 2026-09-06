import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { AlertCircle, Bell, CheckCircle2, CreditCard, HelpCircle, MessageQuestion, Terminal } from '@/lib/icons'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { NativeNotificationKind } from '@/store/native-notifications'
import { $inbox, clearInbox, type InboxEntry, markAllInboxRead, markInboxEntryRead } from '@/store/notification-inbox'
import { $sessions, sessionMatchesStoredId } from '@/store/session'

/** One glyph per kind, so the list can be scanned without reading it. */
const KIND_ICON: Record<NativeNotificationKind, typeof Bell> = {
  approval: HelpCircle,
  backgroundDone: Terminal,
  credits: CreditCard,
  input: MessageQuestion,
  plugin: Bell,
  turnDone: CheckCircle2,
  turnError: AlertCircle
}

/** Kinds that are waiting on the user rather than reporting something done. */
const WAITING = new Set<NativeNotificationKind>(['approval', 'input'])

/**
 * The titlebar bell's list: what happened in the chats you have open while you
 * were reading a different one.
 *
 * Clicking an entry opens its chat with the `stack` intent, which places it
 * beside what is already loaded instead of replacing it. That is deliberate and
 * matches the native-notification click path: arriving from a notification
 * should never cost the user the chat they were in the middle of.
 */
export function NotificationInboxPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const copy = t.titlebar.inbox
  const entries = useStore($inbox)
  const sessions = useStore($sessions)
  const navigate = useNavigate()

  const titleFor = (entry: InboxEntry): null | string => {
    if (!entry.storedSessionId) {
      return null
    }

    const row = sessions.find(session => sessionMatchesStoredId(session, entry.storedSessionId!))

    return row ? sessionTitle(row) : null
  }

  const openEntry = (entry: InboxEntry) => {
    markInboxEntryRead(entry.id)
    onClose()

    if (entry.storedSessionId) {
      openSession(entry.storedSessionId, navigate, 'stack')
    }
  }

  return (
    <div className="flex max-h-[26rem] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-(--ui-border-weak) px-3 py-2">
        <span className="text-xs font-medium">{copy.title}</span>
        {entries.length > 0 && (
          <div className="flex items-center gap-1">
            <Button className="h-6 px-1.5 text-[0.6875rem]" onClick={markAllInboxRead} size="sm" variant="ghost">
              {copy.markAllRead}
            </Button>
            <Button className="h-6 px-1.5 text-[0.6875rem]" onClick={clearInbox} size="sm" variant="ghost">
              {copy.clear}
            </Button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs text-(--ui-text-tertiary)">{copy.empty}</p>
          <p className="mt-1 text-[0.6875rem] text-(--ui-text-quaternary)">{copy.emptyHint}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {entries.map(entry => {
            const Icon = KIND_ICON[entry.kind]
            const chat = titleFor(entry)

            return (
              <li key={entry.id}>
                <button
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60',
                    // An entry with no chat has nowhere to go; it still reads as
                    // a record, so it stays in the list rather than being hidden.
                    !entry.storedSessionId && 'cursor-default'
                  )}
                  onClick={() => openEntry(entry)}
                  type="button"
                >
                  <Icon
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      entry.kind === 'turnError'
                        ? 'text-destructive'
                        : WAITING.has(entry.kind)
                          ? 'text-(--ui-text-secondary)'
                          : 'text-(--ui-text-tertiary)'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('truncate text-xs', !entry.read && 'font-medium')}>{entry.title}</span>
                      {!entry.read && <span className="size-1.5 shrink-0 rounded-full bg-(--ui-accent)" />}
                    </span>
                    {chat && <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">{chat}</span>}
                    {entry.body && (
                      <span className="block truncate text-[0.6875rem] text-(--ui-text-quaternary)">{entry.body}</span>
                    )}
                  </span>
                  <span className="shrink-0 pt-0.5 text-[0.625rem] text-(--ui-text-quaternary)">
                    {relativeTime(entry.at)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
