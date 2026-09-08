import { useAuiState } from '@assistant-ui/react'
import { useRef } from 'react'

import { useI18n } from '@/i18n'

import type { ToolCallLike } from '../tool/run-summary'

import { summarizeTurnProgress, type TurnProgressFacts } from './turn-progress-model'

interface ProgressSlice {
  thread: {
    isRunning: boolean
    messages: readonly { content: readonly { type: string }[]; status?: { type: string } }[]
  }
}

export function TurnProgress({ indices }: { indices: readonly number[] }) {
  const { t } = useI18n()
  const copy = t.assistant.thread
  const cache = useRef<{ tools: ToolCallLike[]; facts: TurnProgressFacts } | null>(null)

  const facts = useAuiState(state => {
    const { thread } = state as unknown as ProgressSlice
    const tailIndex = indices.at(-1)

    if (!thread.isRunning || tailIndex === undefined || thread.messages[tailIndex]?.status?.type !== 'running') {
      return null
    }

    const tools = indices.flatMap(
      index => thread.messages[index]?.content.filter(part => part.type === 'tool-call') ?? []
    ) as unknown as ToolCallLike[]

    const old = cache.current?.tools

    if (
      !old ||
      tools.length !== old.length ||
      tools.some(
        (tool, i) =>
          tool.toolCallId !== old[i]?.toolCallId || tool.args !== old[i]?.args || tool.result !== old[i]?.result
      )
    ) {
      cache.current = { tools, facts: summarizeTurnProgress(tools) }
    }

    return cache.current?.facts ?? null
  })

  if (
    !facts ||
    !(facts.lastEdit || facts.lastCheck || facts.latestError || facts.currentTask || facts.repeatedAction)
  ) {
    return null
  }

  const rows = [
    { label: copy.progressTask, value: facts.currentTask },
    { label: copy.progressEdit, value: facts.lastEdit },
    { label: facts.checkOutdated ? copy.progressCheckOutdated : copy.progressCheck, value: facts.lastCheck },
    { label: copy.progressError, value: facts.latestError },
    {
      label: copy.progressRepeated,
      value: facts.repeatedAction ? `${facts.repetitions}: ${facts.repeatedAction}` : undefined
    }
  ]

  return (
    <dl
      aria-label={copy.progressTitle}
      className="grid min-w-0 gap-1 rounded-md bg-(--ui-control-hover-background) px-3 py-2 text-xs"
      data-turn-progress=""
    >
      {rows
        .filter(row => row.value)
        .map(row => (
          <div className="flex min-w-0 flex-wrap gap-x-2" key={row.label}>
            <dt className="text-(--ui-text-tertiary)">{row.label}</dt>
            <dd className="line-clamp-2 min-w-0 break-all text-(--ui-text-secondary)" dir="auto">
              {row.value}
            </dd>
          </div>
        ))}
    </dl>
  )
}
