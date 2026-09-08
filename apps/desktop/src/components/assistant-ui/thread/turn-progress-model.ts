import { firstStringField } from '@/lib/text'
import { isTodoToolName, parseTodos } from '@/lib/todos'
import { extractToolErrorMessage } from '@/lib/tool-result-summary'

import { isFileEditTool, parseMaybeObject } from '../tool/fallback-model'
import type { ToolCallLike } from '../tool/run-summary'

export interface TurnProgressFacts {
  lastEdit?: string
  lastCheck?: string
  checkOutdated: boolean
  latestError?: string
  currentTask?: string
  repeatedAction?: string
  repetitions: number
}

const CHECK_COMMAND =
  /(?:^|&&)\s*(?:[^\s;&|]+\/)?(?:pytest|vitest|playwright|tsc|eslint|ruff|cargo\s+(?:test|check)|go\s+test|(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(?:test[\w:-]*|typecheck|lint|check|build))\b/

export function summarizeTurnProgress(tools: readonly ToolCallLike[]): TurnProgressFacts {
  const facts: TurnProgressFacts = { checkOutdated: false, repetitions: 0 }
  const seen = new Set<string>()
  const errors = new Map<string, string>()
  let lastSignature = ''
  let repeatCount = 0
  let editIndex = -1
  let checkIndex = -1

  for (const [index, tool] of tools.entries()) {
    if (tool.toolCallId && seen.has(tool.toolCallId)) {
      continue
    }

    if (tool.toolCallId) {
      seen.add(tool.toolCallId)
    }

    const args = parseMaybeObject(tool.args)
    const command = firstStringField(args, ['command', 'code'])
    const path = firstStringField(args, ['path', 'file', 'filepath'])
    const target = command || path || firstStringField(args, ['query', 'url']) || tool.toolName
    const signature = `${tool.toolName}:${target}`

    repeatCount = signature === lastSignature ? repeatCount + 1 : 1
    lastSignature = signature
    facts.repetitions = repeatCount >= 3 ? repeatCount : 0
    facts.repeatedAction = repeatCount >= 3 ? target : undefined

    if (tool.result === undefined) {
      continue
    }

    const result = parseMaybeObject(tool.result)
    const error = extractToolErrorMessage(tool.result)
    const exitCode = result.exit_code ?? result.exitCode
    const failed = Boolean(error) || result.success === false || (typeof exitCode === 'number' && exitCode !== 0)

    if (failed) {
      errors.delete(signature)
      errors.set(signature, error || target)

      continue
    }

    errors.delete(signature)

    if (isTodoToolName(tool.toolName)) {
      const todos = parseTodos(tool.result)

      if (todos) {
        facts.currentTask = todos.find(todo => todo.status === 'in_progress')?.content
      }
    }

    const modified = Array.isArray(result.files_modified)
      ? result.files_modified.filter((file): file is string => typeof file === 'string')
      : []

    const changedPath = modified.at(-1) || firstStringField(result, ['resolved_path', 'path']) || path

    if (
      isFileEditTool(tool.toolName) &&
      result.no_change !== true &&
      changedPath &&
      (modified.length > 0 || result.success === true || result.status === 'success')
    ) {
      facts.lastEdit = changedPath
      editIndex = index
    }

    // A zero exit code proves only this command passed, not that the task is done.
    // Background-start acknowledgements have no exit code and earn no check mark.
    if (tool.toolName === 'terminal' && !/[;\n]|\|\|/.test(command) && CHECK_COMMAND.test(command) && exitCode === 0) {
      facts.lastCheck = command
      checkIndex = index
    }
  }

  facts.latestError = [...errors.values()].at(-1)
  facts.checkOutdated = checkIndex >= 0 && editIndex > checkIndex

  return facts
}
