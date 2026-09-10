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

export function useBrowserDownloads(): void {
  useEffect(() => {
    const publish = () => {
      void window.hermesDesktop?.setBrowserDownloadDir?.(workspaceDownloadDir($workspaceNewSessionTarget.get()))
    }

    publish()

    return $workspaceNewSessionTarget.subscribe(publish)
  }, [])

  useEffect(() => {
    const unsubscribe = window.hermesDesktop?.onBrowserDownload?.(record => {
      // The desk's file lists read the folder, so they need to hear about it.
      notifyWorkspaceChanged()

      const target = localPreviewTarget(record.path)

      notify({
        action: target ? { label: translateNow('preview.openPreview'), onClick: () => openPreview(target, 'tool-result') } : undefined,
        message: record.name,
        title: translateNow('preview.office.downloaded')
      })

      if (target) {
        openPreview(target, 'tool-result')
      }
    })

    return () => unsubscribe?.()
  }, [])
}
