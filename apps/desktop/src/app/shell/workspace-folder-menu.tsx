import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  dropdownMenuSectionLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { displayPath, pathLeaf } from '@/lib/display-path'
import { triggerHaptic } from '@/lib/haptics'
import { Check, FolderOpen } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { copyFilePath, revealFile } from '@/store/file-actions'
import { revealFileInTree } from '@/store/layout'
import { notify, notifyError } from '@/store/notifications'
import { $projectTree, moveSessionToCwd, projectNameForCwd } from '@/store/projects'

import { workspaceFolderTargets } from './workspace-folder-targets'

interface WorkspaceFolderMenuProps {
  /** The focused chat's working directory. Never empty: the chip is hidden without one. */
  cwd: string
  onClose: () => void
  /** Profile the session row lives under, for the gateway the move is sent to. */
  profile?: null | string
  /** Stored session id to re-home. Null while a draft has no row yet, which
   *  leaves the panel read-only rather than moving the wrong chat. */
  sessionId: null | string
}

/**
 * The workspace chip's menu: which folder this chat belongs to, and a one click
 * way to move it somewhere else.
 *
 * The move itself is not new. `session.workspace.move` and the project list have
 * been reachable for a while through the sidebar's session row context menu, but
 * only there: the user had to find the row, right click it and open a submenu.
 * The folder name in the statusbar is where people actually look to answer
 * "which folder is this chat in", so it is also where the answer should be
 * changeable. This panel is that surface over the same tested store call.
 *
 * "Open folder" exists because a target is not always a project. A chat opened
 * in the wrong directory often needs to land in a plain folder that has no
 * projects.db row yet, and the backend takes a cwd, not a project id.
 */
export function WorkspaceFolderMenu({ cwd, onClose, profile, sessionId }: WorkspaceFolderMenuProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const fileMenu = t.fileMenu
  const tree = useStore($projectTree)

  const targets = useMemo(() => workspaceFolderTargets(tree, cwd), [cwd, tree])
  const currentLabel = projectNameForCwd(cwd) || pathLeaf(cwd)

  // Selecting any row closes the menu, so this component is unmounted long
  // before the move resolves. That is why the outcome is reported through the
  // toast store rather than local state: there is no component left to render
  // a spinner into.
  const move = (target: string, label: string) => {
    if (!sessionId) {
      return
    }

    triggerHaptic('selection')
    onClose()
    moveSessionToCwd(sessionId, target, profile)
      .then(() => notify({ durationMs: 2_000, kind: 'success', message: p.movedTo(label) }))
      .catch(err => notifyError(err, p.moveFailed))
  }

  const browse = async () => {
    // `multiple: false` so the bridge resolves a single path; `defaultPath` puts
    // the dialog where the chat already is rather than at the home directory.
    const picked = await window.hermesDesktop?.selectPaths?.({
      defaultPath: cwd,
      directories: true,
      multiple: false,
      title: t.rightSidebar.openFolder
    })

    const next = picked?.[0]?.trim()

    if (next && next !== cwd) {
      move(next, pathLeaf(next))
    }
  }

  return (
    <div className="py-1">
      <DropdownMenuLabel className={cn(dropdownMenuSectionLabel, 'text-(--ui-text-quaternary)')}>
        {p.moveToProject}
      </DropdownMenuLabel>

      {/* The current folder is listed, checked and inert. Showing it is the
          point: the panel has to answer "where am I" before it offers to
          change it, and a checked row says that without a second heading. */}
      <DropdownMenuItem className="gap-2 text-xs" disabled>
        <Check className="size-3.5 shrink-0" />
        <span className="truncate">{currentLabel}</span>
      </DropdownMenuItem>

      {targets.map(target => (
        <DropdownMenuItem
          className="gap-2 pl-[1.9rem] text-xs text-foreground focus:bg-accent"
          disabled={!sessionId}
          key={target.id}
          onSelect={() => move(target.cwd, target.label)}
          title={displayPath(target.cwd)}
        >
          <span className="truncate">{target.label}</span>
        </DropdownMenuItem>
      ))}

      <DropdownMenuItem
        className="gap-2 text-xs text-foreground focus:bg-accent"
        disabled={!sessionId}
        onSelect={() => void browse()}
      >
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="truncate">{t.rightSidebar.openFolder}</span>
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        className="gap-2 text-xs text-foreground focus:bg-accent"
        onSelect={() => void copyFilePath(cwd)}
        title={displayPath(cwd)}
      >
        <span className="truncate">{fileMenu.copyPath}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2 text-xs text-foreground focus:bg-accent"
        onSelect={() => void revealFile(cwd)}
        title={displayPath(cwd)}
      >
        <span className="truncate">{fileMenu.revealFileManager}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2 text-xs text-foreground focus:bg-accent"
        onSelect={() => revealFileInTree(cwd)}
        title={displayPath(cwd)}
      >
        <span className="truncate">{fileMenu.revealInSidebar}</span>
      </DropdownMenuItem>
    </div>
  )
}
