// Where an embedded terminal shell lives in the cgroup tree (Linux only).
//
// A pane's shell inherits the cgroup of the Electron main process, and so does
// everything the person or an agent starts from it: a dev server, a test suite,
// a VM. The kernel then treats that work and the window as one unit, and pays
// for the VM's memory by swapping the window out. Measured 19 September 2026:
// two QEMU guests started from Hermes terminals, 82 seconds unresponsive.
//
// `systemd-run --user --scope` puts each pane in its own transient scope under
// hermes-tools.slice (a user unit: bounded, low weight) instead of the desktop's
// hermes-ui.slice (protected). The wrapper is the pty leader; the shell is its
// child in the same session and takes the terminal's foreground group itself,
// so job control works as before. Off Linux, or without a usable user bus, the
// spawn is exactly what it was.
import { execFile as nodeExecFile } from 'node:child_process'

export const HERMES_TOOLS_SLICE = 'hermes-tools.slice'

// Both verdicts expire: a user bus can vanish after a true and appear after a
// false (a login session ending, linger enabled later). Same TTL as the
// Python side's probe in tools/process_registry.py.
const PROBE_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 3_000

export interface ScopedSpawn {
  args: string[]
  command: string
}

/** The spawn that puts `command args` in its own scope under the tools slice. Pure. */
export function scopedShellArgv(
  command: string,
  args: string[],
  unit: string,
  systemdRun = 'systemd-run'
): ScopedSpawn {
  return {
    args: ['--user', '--scope', '--quiet', '--collect', `--slice=${HERMES_TOOLS_SLICE}`, `--unit=${unit}`, '--', command, ...args],
    command: systemdRun
  }
}

/** A unit name systemd accepts, recognisable in `systemctl --user status`. */
export function terminalScopeUnit(id: string): string {
  return `hermes-terminal-${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'pane'}`
}

export type ScopeProbe = (systemdRun: string) => Promise<boolean>

/** `systemd-run --user --scope` works only with a reachable user bus; try once, cheaply. */
export const probeUserScope: ScopeProbe = systemdRun =>
  new Promise(resolve => {
    const unit = `hermes-probe-scope-${process.pid}-${Math.random().toString(36).slice(2, 10)}`
    // `/bin/sh -c 'exit 0'`, not /bin/true: NixOS ships the former without the latter.
    const { args } = scopedShellArgv('/bin/sh', ['-c', 'exit 0'], unit)

    nodeExecFile(systemdRun, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, error => resolve(!error))
  })

export interface ToolsScopePolicyDeps {
  findOnPath: (command: string) => null | string
  log: (line: string) => void
  now?: () => number
  platform?: NodeJS.Platform
  probe?: ScopeProbe
}

export interface ToolsScopePolicy {
  /** The spawn to use for `command args`: scoped when possible, else unchanged. */
  wrap: (command: string, args: string[], unit: string) => Promise<ScopedSpawn>
}

export function createToolsScopePolicy({
  findOnPath,
  log,
  now = Date.now,
  platform = process.platform,
  probe = probeUserScope
}: ToolsScopePolicyDeps): ToolsScopePolicy {
  let verdict: null | { available: boolean; at: number } = null
  let pending: null | Promise<boolean> = null
  let explained = false

  const available = async (systemdRun: string): Promise<boolean> => {
    if (verdict && now() - verdict.at < PROBE_TTL_MS) {
      return verdict.available
    }

    // One probe at a time: concurrent first panes share it rather than each
    // spending a D-Bus round trip.
    pending ??= probe(systemdRun)
      .then(ok => {
        verdict = { at: now(), available: ok }

        if (!ok && !explained) {
          explained = true
          log('[terminal] systemd-run --user --scope unavailable; panes share the desktop cgroup')
        }

        return ok
      })
      .finally(() => {
        pending = null
      })

    return pending
  }

  return {
    wrap: async (command, args, unit) => {
      const plain = { args, command }

      if (platform !== 'linux') {
        return plain
      }

      const systemdRun = findOnPath('systemd-run')

      if (!systemdRun) {
        return plain
      }

      return (await available(systemdRun)) ? scopedShellArgv(command, args, unit, systemdRun) : plain
    }
  }
}
