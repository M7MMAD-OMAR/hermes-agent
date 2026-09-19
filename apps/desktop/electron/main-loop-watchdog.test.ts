import { describe, expect, it } from 'vitest'

import { classifyStall, formatStallReport, installMainLoopWatchdog, summarizeProfile } from './main-loop-watchdog'
import type { CpuProfile } from './main-loop-watchdog'

// (root) -> ensureBackend -> readGhCliToken -> readFileSync ; (root) -> (idle) ; (root) -> (garbage collector)
const profile: CpuProfile = {
  nodes: [
    { callFrame: { functionName: '(root)', lineNumber: -1, url: '' }, children: [2, 5, 6], id: 1 },
    { callFrame: { functionName: 'ensureBackend', lineNumber: 99, url: 'file:///m.mjs' }, children: [3], id: 2 },
    { callFrame: { functionName: 'readGhCliToken', lineNumber: 3362, url: 'file:///m.mjs' }, children: [4], id: 3 },
    { callFrame: { functionName: 'readFileSync', lineNumber: 440, url: 'node:fs' }, id: 4 },
    { callFrame: { functionName: '(idle)', lineNumber: -1, url: '' }, id: 5 },
    { callFrame: { functionName: '(garbage collector)', lineNumber: -1, url: '' }, id: 6 }
  ],
  // Old idle time, then 80 s stuck under readFileSync, then a little GC.
  samples: [5, 5, 4, 4, 4, 6],
  timeDeltas: [25_000, 25_000, 40_000_000, 40_000_000, 500_000, 25_000]
}

describe('summarizeProfile', () => {
  it('attributes the stalled window to the stack the samples were taken on', () => {
    const stacks = summarizeProfile(profile, 82_000)

    expect(stacks[0]).toEqual({
      frames: ['readFileSync (node:fs:441)', 'readGhCliToken (file:///m.mjs:3363)', 'ensureBackend (file:///m.mjs:100)'],
      ms: 80_500
    })
    expect(stacks[1]).toEqual({ frames: ['(idle)'], ms: 50 })
    expect(stacks[2]).toEqual({ frames: ['(garbage collector)'], ms: 25 })
  })

  it('looks back only as far as the window', () => {
    // 80 ms window: only the tail (GC 25 ms + one 40 s chunk) is counted; the idle prefix is not.
    const stacks = summarizeProfile(profile, 80)

    expect(stacks.map(stack => stack.frames[0])).toEqual(['readFileSync (node:fs:441)', '(garbage collector)'])
  })
})

describe('classifyStall', () => {
  it('reads the meaning off the heaviest stack', () => {
    expect(classifyStall([{ frames: ['readFileSync (node:fs:441)', 'x'], ms: 1 }])).toBe('javascript')
    expect(classifyStall([{ frames: ['(idle)'], ms: 1 }])).toBe('not-scheduled')
    expect(classifyStall([{ frames: ['(program)'], ms: 1 }])).toBe('not-scheduled')
    expect(classifyStall([{ frames: ['(garbage collector)'], ms: 1 }])).toBe('garbage-collector')
    expect(classifyStall([])).toBe('unknown')
  })
})

describe('formatStallReport', () => {
  it('puts the verdict, the context, and each hot stack on the record', () => {
    const line = formatStallReport({
      memory: { VmRSS: '178MB', VmSwap: '46MB', psiMem10: '0.70' },
      note: 'resumed 80500 ms after the watchdog noticed',
      stacks: summarizeProfile(profile, 82_000, 1),
      stalledMs: 82_000
    })

    expect(line).toBe(
      '[main] event loop stalled ~82000 ms (blocked inside); resumed 80500 ms after the watchdog noticed; VmRSS=178MB VmSwap=46MB psiMem10=0.70\n' +
        '  80500 ms\n' +
        '    at readFileSync (node:fs:441)\n' +
        '    at readGhCliToken (file:///m.mjs:3363)\n' +
        '    at ensureBackend (file:///m.mjs:100)'
    )
  })

  it('stays on one line when nothing was captured', () => {
    const line = formatStallReport({ memory: {}, note: 'profiler was not running', stacks: [], stalledMs: 2_000 })

    expect(line).toBe('[main] event loop stalled ~2000 ms (no samples captured); profiler was not running')
  })
})

// A synchronous block on this thread, the way a swapped-out readFileSync is.
function blockThread(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

describe('installMainLoopWatchdog', () => {
  it('names the function the main thread was blocked in', async () => {
    const lines: string[] = []
    const dispose = installMainLoopWatchdog({ heartbeatMs: 20, log: line => lines.push(line), stallMs: 150 })

    try {
      // Let the profiler and the watcher settle before the stall.
      await new Promise(resolve => setTimeout(resolve, 500))

      function theSlowCaller() {
        blockThread(600)
      }

      theSlowCaller()

      const deadline = Date.now() + 5_000

      while (lines.length === 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } finally {
      dispose()
    }

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[main\] event loop stalled ~\d+ ms \(blocked inside\)/)
    expect(lines[0]).toContain('theSlowCaller')
  }, 10_000)
})
