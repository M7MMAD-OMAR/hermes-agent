/**
 * Files the conversation's browser downloads.
 *
 * Two halves of one loop. Going out: the workspace the window is looking at
 * names the folder its downloads belong in, and the main process saves there
 * instead of opening a save dialog. Coming back: the file that arrived is
 * announced and opened in the rail, so a spreadsheet fetched from a dashboard
 * is on screen as a spreadsheet a second later rather than sitting unnoticed
 * in a folder.
 *
 * Outside a workspace nothing is named, and a download keeps the OS prompt: a
 * browser the user opened for themselves must not write into a project.
 */

import { useEffect } from 'react'

import { $workspaceNewSessionTarget } from '@/components/pane-shell/workspace-scope'
import { translateNow } from '@/i18n'
import { localPreviewTarget } from '@/lib/local-preview'
import { notify } from '@/store/notifications'
import { openPreview } from '@/store/preview'
import { notifyWorkspaceChanged } from '@/store/workspace-events'

/** The folder the workspace on screen puts downloads in, if it names one. */
export function workspaceDownloadDir(target: ReturnType<typeof $workspaceNewSessionTarget.get>): null | string {
  return target?.kind === 'route' ? (target.route.downloadDir ?? null) : null
}

let publishedDir: null | string | undefined

export function useBrowserDownloads(): void {
  useEffect(() => {
    const publish = () => {
      const directory = workspaceDownloadDir($workspaceNewSessionTarget.get())

      // The store notifies on every workspace update; only a changed folder is
      // worth an IPC round trip. Module scope, not a ref: there is one slot in
      // the main process, so what was last published is a property of the app
      // rather than of whichever window's hook is running.
      if (directory === publishedDir) {
        return
      }

      publishedDir = directory
      void window.hermesDesktop?.setBrowserDownloadDir?.(directory)
    }

    return $workspaceNewSessionTarget.subscribe(publish)
  }, [])

  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onBrowserDownload?.(record => {
      // The desk's file lists read the folder, so they need to hear about it.
      notifyWorkspaceChanged()

      const target = localPreviewTarget(record.path)

      // Opened, then announced. The toast says where it went; offering to open
      // a file that is already on screen would be an action with nothing to do.
      if (target) {
        openPreview(target, 'tool-result')
      }

      notify({ message: record.name, title: translateNow('preview.office.downloaded') })
    })

    return () => unsubscribe?.()
  }, [])
}
