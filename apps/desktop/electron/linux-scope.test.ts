import { describe, expect, it } from 'vitest'

import { createToolsScopePolicy, scopedShellArgv, terminalScopeUnit } from './linux-scope'

describe('scopedShellArgv', () => {
  it('runs the shell as a transient scope under the tools slice', () => {
    const spawn = scopedShellArgv('/bin/zsh', ['-il'], 'hermes-terminal-abc', '/usr/bin/systemd-run')

    expect(spawn.command).toBe('/usr/bin/systemd-run')
    expect(spawn.args).toEqual([
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      '--slice=hermes-tools.slice',
      '--unit=hermes-terminal-abc',
      '--',
      '/bin/zsh',
      '-il'
    ])
  })
})

describe('terminalScopeUnit', () => {
  it('keeps only what a unit name may contain', () => {
    expect(terminalScopeUnit('3f2a-9b7c-0000-1111-2222')).toBe('hermes-terminal-3f2a9b7c0000')
    expect(terminalScopeUnit('---')).toBe('hermes-terminal-pane')
  })
})

describe('createToolsScopePolicy', () => {
  const findOnPath = (command: string) => (command === 'systemd-run' ? '/usr/bin/systemd-run' : null)

  it('leaves the spawn alone off Linux', async () => {
    const policy = createToolsScopePolicy({ findOnPath, log: () => {}, platform: 'darwin', probe: async () => true })

    expect(await policy.wrap('/bin/zsh', ['-il'], 'u')).toEqual({ args: ['-il'], command: '/bin/zsh' })
  })

  it('leaves the spawn alone without systemd-run on PATH', async () => {
    const policy = createToolsScopePolicy({ findOnPath: () => null, log: () => {}, platform: 'linux' })

    expect(await policy.wrap('/bin/sh', ['-i'], 'u')).toEqual({ args: ['-i'], command: '/bin/sh' })
  })

  it('scopes the spawn once the probe passes and probes only once per TTL', async () => {
    let probes = 0
    let clock = 0

    const policy = createToolsScopePolicy({
      findOnPath,
      log: () => {},
      now: () => clock,
      platform: 'linux',
      probe: async () => {
        probes += 1

        return true
      }
    })

    const [first, second] = await Promise.all([policy.wrap('/bin/sh', ['-i'], 'a'), policy.wrap('/bin/sh', ['-i'], 'b')])

    expect(first.command).toBe('/usr/bin/systemd-run')
    expect(second.args).toContain('--unit=b')
    expect(probes).toBe(1)

    clock = 61_000
    await policy.wrap('/bin/sh', ['-i'], 'c')
    expect(probes).toBe(2)
  })

  it('falls back and says so once when the user bus is unreachable', async () => {
    const lines: string[] = []
    const policy = createToolsScopePolicy({ findOnPath, log: line => lines.push(line), platform: 'linux', probe: async () => false })

    expect((await policy.wrap('/bin/sh', ['-i'], 'a')).command).toBe('/bin/sh')
    expect((await policy.wrap('/bin/sh', ['-i'], 'b')).command).toBe('/bin/sh')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/panes share the desktop cgroup/)
  })
})
