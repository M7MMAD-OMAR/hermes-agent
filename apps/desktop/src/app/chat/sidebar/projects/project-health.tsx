import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { $projects, openProjectEdit, type ProjectFolderDraft } from '@/store/projects'

export function ProjectHealthIndicator({ id, name }: { id: string; name: string }) {
  const { t } = useI18n()
  const projects = useStore($projects)

  const unhealthy = projects
    .find(project => project.id === id)
    ?.folders.some(folder => folder.health && folder.health !== 'available')

  if (!unhealthy) {
    return null
  }

  return (
    <Tip label={t.sidebar.projects.folderNeedsAttention}>
      <Button
        aria-label={t.sidebar.projects.folderNeedsAttention}
        onClick={() => void openProjectEdit({ id, name })}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Codicon className="text-amber-500" name="warning" size="0.875rem" />
      </Button>
    </Tip>
  )
}

export function ProjectFolderHealth({
  folder,
  disabled,
  onReconnect
}: {
  folder: ProjectFolderDraft
  disabled: boolean
  onReconnect: (path: string) => void
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects

  if (!folder.health || folder.health === 'available') {
    return null
  }

  const labels = { missing: p.folderMissing, unavailable: p.folderUnavailable, not_directory: p.folderNotDirectory }

  return (
    <span className="mt-1 flex flex-col gap-1 whitespace-normal text-xs text-amber-500" role="status">
      {labels[folder.health]}
      {folder.suggested_paths?.map(path => (
        <Button
          className="h-auto justify-start whitespace-normal break-all text-start"
          disabled={disabled}
          key={path}
          onClick={() => onReconnect(path)}
          size="sm"
          type="button"
          variant="outline"
        >
          {p.reconnectFolder}: <span dir="ltr">{path}</span>
        </Button>
      ))}
    </span>
  )
}
