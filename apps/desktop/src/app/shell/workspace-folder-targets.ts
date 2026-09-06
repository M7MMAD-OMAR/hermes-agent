import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { projectRootCwd } from '@/store/projects'

/** One row in the statusbar workspace picker: a folder this chat can move to. */
export interface WorkspaceFolderTarget {
  id: string
  label: string
  cwd: string
}

/**
 * The folders offered by the statusbar workspace picker, most recently worked
 * in first.
 *
 * Four kinds of node are dropped, each for its own reason:
 *
 *  - the project that already owns `currentCwd`, because moving a chat where it
 *    already lives is a no-op the user should not be offered;
 *  - the synthetic "Home" bucket (`isNoProject`), which has no folder at all;
 *  - any project whose tree carries no path, since there is nothing to move
 *    into and the backend would reject the move;
 *  - archived projects, which are hidden from every other picker.
 *
 * Auto projects (a git root promoted without a projects.db row) are KEPT. They
 * are real folders the user works in, and the statusbar already labels a session
 * by its cwd leaf when no named project claims it, so excluding them would make
 * the picker unable to offer the folder the user is looking at.
 *
 * Ordering is by `lastActive` descending, with the label as the tie-break so the
 * list is stable across renders rather than reshuffling on every tree refresh.
 */
export function workspaceFolderTargets(
  tree: readonly SidebarProjectTree[],
  currentCwd: string
): WorkspaceFolderTarget[] {
  const current = (currentCwd || '').trim()

  return tree
    .filter(node => !node.isNoProject && !node.archived)
    .map(node => ({ cwd: projectRootCwd(node), id: node.id, label: node.label, lastActive: node.lastActive ?? 0 }))
    .filter(target => target.cwd && target.cwd !== current)
    .sort((a, b) => b.lastActive - a.lastActive || a.label.localeCompare(b.label))
    .map(({ cwd, id, label }) => ({ cwd, id, label }))
}
