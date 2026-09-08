import { describe, expect, it } from 'vitest'

import { summarizeTurnProgress } from './turn-progress-model'

const tool = (toolCallId: string, toolName: string, args: unknown, result?: unknown) => ({
  toolCallId,
  toolName,
  args,
  result
})

describe('useful progress evidence', () => {
  it('requires a completed check and marks its evidence outdated after another successful edit', () => {
    const check = tool('check', 'terminal', { command: 'bun run typecheck' }, { exit_code: 0 })
    const edit = tool('edit', 'write_file', { path: '/site/app.tsx' }, { files_modified: ['/site/app.tsx'] })
    expect(
      summarizeTurnProgress([tool('start', 'terminal', { command: 'bun run test' }, { session_id: 123 })]).lastCheck
    ).toBeUndefined()
    expect(
      summarizeTurnProgress([tool('echo', 'terminal', { command: "echo 'pytest passed'" }, { exit_code: 0 })]).lastCheck
    ).toBeUndefined()
    expect(
      summarizeTurnProgress([tool('masked', 'terminal', { command: 'bun run test || true' }, { exit_code: 0 })])
        .lastCheck
    ).toBeUndefined()
    expect(summarizeTurnProgress([check, edit])).toMatchObject({
      lastCheck: 'bun run typecheck',
      lastEdit: '/site/app.tsx',
      checkOutdated: true
    })
    expect(summarizeTurnProgress([edit, check])).toMatchObject({ checkOutdated: false })
    expect(
      summarizeTurnProgress([
        tool('fail', 'write_file', { path: '/site/bad.tsx' }, { success: false, error: 'Permission denied' })
      ])
    ).toMatchObject({ latestError: 'Permission denied' })
  })

  it('ignores replayed calls and exposes repeated activity and current task without inventing completion', () => {
    const read = tool('one', 'read_file', { path: '/site/app.tsx' }, { content: 'same' })
    expect(summarizeTurnProgress([read, read, read]).repetitions).toBe(0)

    const facts = summarizeTurnProgress([
      tool(
        'todo',
        'todo_list',
        {},
        { todos: [{ id: 'a', content: 'Verify mobile navigation', status: 'in_progress' }] }
      ),
      read,
      { ...read, toolCallId: 'two' },
      { ...read, toolCallId: 'three' }
    ])

    expect(facts).toMatchObject({
      currentTask: 'Verify mobile navigation',
      repeatedAction: '/site/app.tsx',
      repetitions: 3
    })
    expect(facts.lastCheck).toBeUndefined()
  })
})
