/**
 * Names the code that froze the main process.
 *
 * When the Electron main thread stops turning its event loop, the window stops
 * answering the compositor and the person gets "not responding". Nothing in
 * desktop.log says why: the log lines from that stretch all land with one
 * timestamp when the loop resumes (19 September 2026, 1:13 PM to 1:15 PM, a
 * burst of ten lines stamped 09:15:12.595Z). main.ts still has a hundred-odd
 * synchronous filesystem and process calls, any of which becomes a stall when
 * the process's pages are in swap and the disk is busy.
 *
 * Two parts. The main thread keeps V8's sampling profiler running on itself
 * through a same-thread inspector session, at a coarse interval: the sampler
 * is signal driven, so it keeps recording the JavaScript stack while the
 * thread sits in a blocking call. A worker thread watches a heartbeat the
 * main thread bumps in shared memory; when the beat goes stale it notes the
 * process's swap and the machine's memory pressure and posts a message. That
 * message is delivered the moment the loop turns again, and the main thread
 * then stops the profile synchronously, sums the samples of the stalled
 * window by stack, writes the heaviest ones to desktop.log, and starts a
 * fresh profile.
 *
 * Why not ask the main thread from the worker during the stall: an inspector
 * request made from another thread is served by the main loop, not by an
 * interrupt, so anything asked during a stall runs after it. Only a sampler
 * that was already running can say what happened inside. Forty samples a
 * second cost well under a percent; the profile is thrown away every ten
 * minutes so it cannot grow.
 *
 * What the top stack means: a real function name is the caller of the
 * blocking call; "(garbage collector)" is V8; "(idle)" or "(program)" with
 * the loop stalled means the thread was not being scheduled at all, which on
 * this machine is paging.
 */
import inspector from 'node:inspector'
import { Worker } from 'node:worker_threads'

export const MAIN_LOOP_STALL_MS = 1_500
export const MAIN_LOOP_HEARTBEAT_MS = 250
// Deciseconds since the watchdog started, in an Int32: six years before it wraps.
export const HEARTBEAT_UNIT_MS = 100
export const SAMPLING_INTERVAL_US = 25_000
export const PROFILE_CYCLE_MS = 10 * 60_000

export interface ProfileNode {
  callFrame: { functionName: string; lineNumber: number; url: string }
  children?: number[]
  id: number
}

/** The subset of a `Profiler.stop` result the summary needs. */
export interface CpuProfile {
  nodes: ProfileNode[]
  samples: number[]
  timeDeltas: number[]
}

export interface HotStack {
  frames: string[]
  ms: number
}

export interface StallReport {
  memory: Record<string, string>
  note: string
  stacks: HotStack[]
  stalledMs: number
}

function frameOf(node: ProfileNode): string {
  const { functionName, lineNumber, url } = node.callFrame
  const where = url ? `${url}:${lineNumber + 1}` : ''

  return where ? `${functionName || '(anonymous)'} (${where})` : functionName || '(anonymous)'
}

/**
 * The stacks that owned the last `windowMs` of samples, heaviest first. Pure.
 * Sample time is attributed to the stack it was taken on, so a thread blocked
 * in `readFileSync` for a minute shows a minute under its caller.
 */
export function summarizeProfile(profile: CpuProfile, windowMs: number, limit = 3): HotStack[] {
  const byId = new Map<number, ProfileNode>()
  const parent = new Map<number, number>()

  for (const node of profile.nodes) {
    byId.set(node.id, node)

    for (const child of node.children ?? []) {
      parent.set(child, node.id)
    }
  }

  const spent = new Map<number, number>()
  let covered = 0

  for (let i = profile.samples.length - 1; i >= 0 && covered < windowMs * 1000; i -= 1) {
    const delta = profile.timeDeltas[i] ?? 0
    const id = profile.samples[i]

    if (id === undefined) {
      continue
    }

    spent.set(id, (spent.get(id) ?? 0) + delta)
    covered += delta
  }

  return [...spent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, us]) => {
      const frames: string[] = []

      for (let cursor: number | undefined = id; cursor !== undefined && frames.length < 12; cursor = parent.get(cursor)) {
        const node = byId.get(cursor)

        if (!node || node.callFrame.functionName === '(root)') {
          break
        }

        frames.push(frameOf(node))
      }

      return { frames, ms: Math.round(us / 1000) }
    })
}

export type StallKind = 'javascript' | 'not-scheduled' | 'garbage-collector' | 'unknown'

export function classifyStall(stacks: HotStack[]): StallKind {
  const top = stacks[0]?.frames[0]

  if (!top) {
    return 'unknown'
  }

  if (top.startsWith('(garbage collector)')) {
    return 'garbage-collector'
  }

  if (top.startsWith('(idle)') || top.startsWith('(program)')) {
    return 'not-scheduled'
  }

  return 'javascript'
}

const MEANING: Record<StallKind, string> = {
  'garbage-collector': 'V8 was collecting',
  javascript: 'blocked inside',
  'not-scheduled': 'no code of ours was running: paged out or starved',
  unknown: 'no samples captured'
}

export function formatStallReport(report: StallReport): string {
  const kind = classifyStall(report.stacks)

  const context = Object.entries(report.memory)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')

  const stacks = report.stacks
    .filter(stack => stack.frames.length > 0)
    .map(stack => `\n  ${stack.ms} ms\n${stack.frames.map(frame => `    at ${frame}`).join('\n')}`)
    .join('')

  return `[main] event loop stalled ~${report.stalledMs} ms (${MEANING[kind]}); ${report.note}${context ? `; ${context}` : ''}${stacks}`
}

/**
 * The heartbeat watcher, as CommonJS source for `new Worker(source, { eval: true })`:
 * the main bundle is one esbuild file and this way there is no second entry
 * point to stage. Plain JavaScript on purpose; it does nothing but read a
 * shared integer, and read /proc when that integer is stale.
 */
export const WATCHDOG_WORKER_SOURCE = String.raw`
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')

const beat = new Int32Array(workerData.heartbeat)
const { epoch, unitMs, stallMs, pollMs } = workerData
const now = () => Math.floor((Date.now() - epoch) / unitMs)
let reportedBeat = -1

function memory() {
  const out = {}
  try {
    const status = fs.readFileSync('/proc/self/status', 'utf8')
    for (const key of ['VmRSS', 'VmSwap']) {
      const match = status.match(new RegExp(key + ':\\s+(\\d+) kB'))
      if (match) out[key] = Math.round(Number(match[1]) / 1024) + 'MB'
    }
  } catch {}
  try {
    const psi = fs.readFileSync('/proc/pressure/memory', 'utf8').split('\n')[0]
    const some = psi && psi.match(/avg10=([\d.]+)/)
    if (some) out.psiMem10 = some[1]
  } catch {}
  return out
}

setInterval(() => {
  const last = Atomics.load(beat, 0)
  if ((now() - last) * unitMs < stallMs || last === reportedBeat) return
  reportedBeat = last
  // Delivered when the main loop turns again; the main side measures the total then.
  parentPort.postMessage({ type: 'stall', stallStartedAt: epoch + last * unitMs, memory: memory() })
}, pollMs)
`

/** A same-thread profiler; `post` is synchronous for a session connected to its own thread. */
class MainThreadProfiler {
  private readonly session = new inspector.Session()

  private running = false

  constructor() {
    this.session.connect()
  }

  private post<T = void>(method: string, params?: Record<string, unknown>): T {
    let out: T | undefined
    let failure: Error | null = null

    this.session.post(method, params ?? {}, (error, result) => {
      failure = error
      out = result as T
    })

    if (failure) {
      throw failure
    }

    return out as T
  }

  start(): void {
    this.post('Profiler.enable')
    this.post('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US })
    this.post('Profiler.start')
    this.running = true
  }

  /** The profile since `start()`, or null when nothing was running. */
  stop(): CpuProfile | null {
    if (!this.running) {
      return null
    }

    this.running = false

    return this.post<{ profile: CpuProfile }>('Profiler.stop').profile
  }

  dispose(): void {
    try {
      this.stop()
      this.post('Profiler.disable')
    } finally {
      this.session.disconnect()
    }
  }
}

export interface MainLoopWatchdogOptions {
  heartbeatMs?: number
  log: (line: string) => void
  stallMs?: number
}

/** Start watching; returns a disposer. Never throws: a watchdog must not be a new way to fail. */
export function installMainLoopWatchdog({
  heartbeatMs = MAIN_LOOP_HEARTBEAT_MS,
  log,
  stallMs = MAIN_LOOP_STALL_MS
}: MainLoopWatchdogOptions): () => void {
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))
  let profiler: MainThreadProfiler

  try {
    profiler = new MainThreadProfiler()
    profiler.start()
  } catch (error) {
    log(`[main] event loop watchdog unavailable: ${describe(error)}`)

    return () => {}
  }

  const shared = new SharedArrayBuffer(4)
  const beat = new Int32Array(shared)
  const epoch = Date.now()

  const hermesMainLoopHeartbeat = () => {
    Atomics.store(beat, 0, Math.floor((Date.now() - epoch) / HEARTBEAT_UNIT_MS))
  }

  hermesMainLoopHeartbeat()
  const heartbeat = setInterval(hermesMainLoopHeartbeat, heartbeatMs)
  heartbeat.unref()

  // Bound the profile's memory: drop it and start over on a quiet cadence.
  const recycle = setInterval(() => {
    try {
      profiler.stop()
      profiler.start()
    } catch (error) {
      log(`[main] event loop watchdog could not recycle its profile: ${describe(error)}`)
    }
  }, PROFILE_CYCLE_MS)

  recycle.unref()

  let worker: Worker

  try {
    worker = new Worker(WATCHDOG_WORKER_SOURCE, {
      eval: true,
      workerData: { epoch, heartbeat: shared, pollMs: Math.max(100, Math.floor(stallMs / 3)), stallMs, unitMs: HEARTBEAT_UNIT_MS }
    })
  } catch (error) {
    clearInterval(heartbeat)
    clearInterval(recycle)
    profiler.dispose()
    log(`[main] event loop watchdog unavailable: ${describe(error)}`)

    return () => {}
  }

  worker.unref()
  worker.on('message', (message: { memory?: Record<string, string>; stallStartedAt?: number; type?: string }) => {
    if (message?.type !== 'stall') {
      return
    }

    // This runs on the first loop turn after the stall, so "now" is its end.
    const stalledMs = Math.max(0, Date.now() - (message.stallStartedAt ?? Date.now()))

    try {
      const profile = profiler.stop()
      const stacks = profile ? summarizeProfile(profile, stalledMs + 1_000) : []

      log(formatStallReport({ memory: message.memory ?? {}, note: profile ? 'profile of the stalled window' : 'profiler was not running', stacks, stalledMs }))
      profiler.start()
    } catch (error) {
      log(`[main] event loop stalled ~${stalledMs} ms; profile unavailable: ${describe(error)}`)
    }
  })
  worker.on('error', error => {
    log(`[main] event loop watchdog failed: ${describe(error)}`)
  })

  return () => {
    clearInterval(heartbeat)
    clearInterval(recycle)
    void worker.terminate()

    try {
      profiler.dispose()
    } catch {
      // Nothing left to say; the process is on its way out.
    }
  }
}
