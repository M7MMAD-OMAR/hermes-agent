import type { FC } from 'react'

import { ThreadRefLink, useThreadRef } from '@/app/threads/thread-ref-link'

import { SessionRefLink } from './directive-text'

/**
 * One `@session:` reference, rendered as whatever it actually is.
 *
 * A delegated thread and an ordinary conversation are both sessions, but they
 * are not the same thing to a reader: opening a session switches you to it,
 * while a thread is work you look in on. This picks the right one.
 *
 * It exists as its own component because the choice needs a hook, and a hook
 * cannot run inside the conditional branch in `markdown-text`.
 *
 * The fallback is the plain session link, and it is the default: an id nobody
 * has loaded as a thread (a chip in an old message, a thread from another
 * conversation) renders exactly as it did before.
 */
export const SessionOrThreadRef: FC<{ value: string }> = ({ value }) => {
  const thread = useThreadRef(value)

  return thread ? <ThreadRefLink thread={thread} /> : <SessionRefLink value={value} />
}
