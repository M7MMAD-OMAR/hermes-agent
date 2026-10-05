import { atom, computed } from 'nanostores'

type Updater<T> = T | ((current: T) => T)

interface WritableStore<T> {
  get: () => T
  set: (value: T) => void
}

const DEFAULT_CONSOLE_HEIGHT = 240
/** How many messages one tab's console keeps. A page in a render loop is
 *  unbounded; this is not. */
export const PREVIEW_CONSOLE_MAX_ENTRIES = 200
export const PREVIEW_CONSOLE_MAX_MESSAGE_CHARS = 64 * 1024
export const PREVIEW_CONSOLE_MAX_SOURCE_CHARS = 4 * 1024
export const PREVIEW_CONSOLE_MAX_TOTAL_CHARS = 512 * 1024
const PREVIEW_CONSOLE_TRUNCATION_MARKER = '\n… [truncated]'

export interface ConsoleEntry {
  id: number
  level: number
  line?: number
  message: string
  source?: string
}

/** Chromium's own names, as `webContents`' console-message reports them since
 *  Electron 35. `warning` is the spelling that matters — it is what a missing
 *  translation key arrives as. */
const LEVEL_NUMBER: Record<string, number> = {
  debug: 0,
  error: 3,
  info: 1,
  log: 0,
  verbose: 0,
  warn: 2,
  warning: 2
}

/**
 * One numeric convention for a level that arrives in two shapes.
 *
 * `webContents` moved to a STRING level in Electron 35; `<webview>`, which is
 * what the pane actually hosts, was never migrated and still emits an Integer
 * 0-3. The whole app — the panel's colours and labels, and the digest that
 * tells the agent how many errors a page threw — compares numbers.
 *
 * So this is insurance against a silent death rather than a live bug: if that
 * divergence is ever settled, a string level would quietly stop equalling 3,
 * every error would count as a `log`, and the agent would go back to being
 * told a broken page is fine. Nothing would throw.
 */
export function consoleLevel(level: number | string | undefined): number {
  if (typeof level === 'number') {
    return Number.isFinite(level) ? level : 0
  }

  return typeof level === 'string' ? (LEVEL_NUMBER[level.toLowerCase()] ?? 0) : 0
}

export interface ConsoleEntryInput {
  level: number
  line?: number
  message: string
  source?: string
}

function updateAtom<T>(store: WritableStore<T>, next: Updater<T>) {
  store.set(typeof next === 'function' ? (next as (current: T) => T)(store.get()) : next)
}

function truncateConsoleText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  const marker = PREVIEW_CONSOLE_TRUNCATION_MARKER.slice(0, maxChars)
  const kept = Math.max(0, maxChars - marker.length)
  let prefix = value.slice(0, kept)

  // Avoid manufacturing a lone UTF-16 high surrogate at the cut. Replacing
  // the partial code point keeps the exact code-unit budget and produces a
  // display-safe string for React/Electron.
  const last = prefix.charCodeAt(prefix.length - 1)

  if (last >= 0xd800 && last <= 0xdbff) {
    prefix = `${prefix.slice(0, -1)}\ufffd`
  }

  return `${prefix}${marker}`
}

function consoleEntryChars(entry: ConsoleEntry): number {
  return entry.message.length + (entry.source?.length ?? 0)
}

function fitConsoleHistory(entries: ConsoleEntry[]): ConsoleEntry[] {
  let kept = entries.slice(-PREVIEW_CONSOLE_MAX_ENTRIES)
  let chars = kept.reduce((total, entry) => total + consoleEntryChars(entry), 0)
  let drop = 0

  // Each field is truncated far below the aggregate cap, so the newest entry
  // always fits. Evict oldest-first to preserve the most useful recent logs.
  while (drop < kept.length - 1 && chars > PREVIEW_CONSOLE_MAX_TOTAL_CHARS) {
    chars -= consoleEntryChars(kept[drop])
    drop++
  }

  if (drop > 0) {
    kept = kept.slice(drop)
  }

  return kept
}

export function createPreviewConsoleState() {
  const $height = atom(DEFAULT_CONSOLE_HEIGHT)
  const $logs = atom<ConsoleEntry[]>([])
  const $logCount = computed($logs, logs => logs.length)
  const $open = atom(false)
  const $selectedLogIds = atom<ReadonlySet<number>>(new Set())
  let nextLogId = 0
  // Whether anything has ever been dropped off the front. `nextLogId` alone
  // cannot say: `clear` empties the log without resetting it, so a cleared
  // console would look overflowed forever.
  let overflowed = false
  // How much of this console the AGENT has been told about. It lives here
  // rather than beside the reporter because only this store knows when the log
  // restarts: both `clear` and `reset` make every later message new again, and
  // a watermark kept outside could not tell a cleared console from a quiet one
  // (the count returns to where it was). See preview-console-digest.ts.
  let reportedId = 0

  return {
    $height,
    $logCount,
    $logs,
    $open,
    $selectedLogIds,
    append(entry: ConsoleEntryInput) {
      const nextEntry: ConsoleEntry = {
        ...entry,
        id: ++nextLogId,
        message: truncateConsoleText(entry.message, PREVIEW_CONSOLE_MAX_MESSAGE_CHARS),
        ...(entry.source === undefined
          ? {}
          : { source: truncateConsoleText(entry.source, PREVIEW_CONSOLE_MAX_SOURCE_CHARS) })
      }

      const incoming = [...$logs.get(), nextEntry]
      const logs = fitConsoleHistory(incoming)

      // Dropped off the front by the entry or size cap: the console is no
      // longer the whole story (see `overflowed`).
      if (logs.length < incoming.length) {
        overflowed = true
      }

      $logs.set(logs)

      const selected = $selectedLogIds.get()

      if (selected.size > 0) {
        const retained = new Set(logs.map(log => log.id))
        const nextSelected = new Set([...selected].filter(id => retained.has(id)))

        if (nextSelected.size !== selected.size) {
          $selectedLogIds.set(nextSelected)
        }
      }
    },
    clear() {
      $logs.set([])
      $selectedLogIds.set(new Set())
      reportedId = 0
      overflowed = false
    },
    clearSelection() {
      if ($selectedLogIds.get().size === 0) {
        return
      }

      $selectedLogIds.set(new Set())
    },
    /** Everything logged since the agent was last told, and mark it told. */
    drainUnreported(): ConsoleEntry[] {
      const logs = $logs.get()
      const fresh = logs.filter(log => log.id > reportedId)

      reportedId = logs.length > 0 ? logs[logs.length - 1].id : reportedId

      return fresh
    },
    /** Whether messages have been dropped off the front, so the counts a caller
     *  computes over `$logs` are floors rather than totals. */
    overflowed: () => overflowed,
    reset() {
      nextLogId = 0
      $logs.set([])
      $selectedLogIds.set(new Set())
      reportedId = 0
      overflowed = false
    },
    setHeight(next: Updater<number>) {
      updateAtom($height, next)
    },
    setOpen(next: Updater<boolean>) {
      updateAtom($open, next)
    },
    toggleSelection(id: number) {
      const next = new Set($selectedLogIds.get())

      if (!next.delete(id)) {
        next.add(id)
      }

      $selectedLogIds.set(next)
    }
  }
}

export type PreviewConsoleState = ReturnType<typeof createPreviewConsoleState>
