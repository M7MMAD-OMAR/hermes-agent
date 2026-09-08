import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import type { NewSessionPlacement } from '@/app/chat/new-session-drag'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { GenerateButton } from '@/components/ui/generate-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { type ProjectIdeaTemplate, randomIdeaTemplates } from '@/lib/project-idea-templates'
import { cn } from '@/lib/utils'
import { notifyError } from '@/store/notifications'
import {
  $newProjectDropPlacement,
  $projectDialog,
  addProjectFolder,
  clearNewProjectDropPlacement,
  closeProjectDialog,
  createProject,
  editProject,
  generateProjectIdea,
  pickProjectFolder,
  type ProjectFolderDraft,
  renameProject
} from '@/store/projects'

import { ProjectFolderHealth } from './projects/project-health'

// Single dialog mounted once in the sidebar; it renders create / rename /
// add-folder flows driven by the $projectDialog atom. Folders are chosen via
// the native directory picker (reused from the default-project-dir setting).
export function ProjectDialog() {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const state = useStore($projectDialog)
  const open = state !== null
  const mode = state?.mode ?? 'create'

  const [name, setName] = useState('')
  const [folders, setFolders] = useState<ProjectFolderDraft[]>([])
  const [idea, setIdea] = useState('')
  const [templates, setTemplates] = useState<ProjectIdeaTemplate[]>([])
  const [generatingIdea, setGeneratingIdea] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // A "New project" DRAG arms where the project should start (tab-strip slot /
  // pane edge / pane center) before the dialog opens. Snapshot it per open —
  // the submit forwards it as `dropPlacement`, and closing clears the store's
  // arm so a later plain-click create never inherits a stale placement.
  let dropPlacement: NewSessionPlacement | undefined

  if (open) {
    dropPlacement = $newProjectDropPlacement.get() ?? undefined
  }

  useEffect(() => {
    if (!open) {
      clearNewProjectDropPlacement()
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setName(state?.name ?? '')
      setFolders(state?.folders ?? [])
      setIdea('')
      setTemplates(randomIdeaTemplates())
      setGeneratingIdea(false)
      setSubmitting(false)
      setError('')

      if (mode !== 'add-folder') {
        window.setTimeout(() => nameRef.current?.select(), 0)
      }
    }
  }, [open, mode, state])

  const onOpenChange = (next: boolean) => {
    if (!next) {
      closeProjectDialog()
    }
  }

  // One submit beat for every flow: guard re-entry, run the write, close on
  // success, surface a toast on failure. Callers pass only the write, plus an
  // optional hook that runs exactly when the write SUCCEEDS (before the close)
  // — the New-project drop arm is consumed there, so a failed attempt keeps
  // its placement for the retry while a successful one can't leak it forward.
  const runSubmit = async (write: () => Promise<unknown>, onSuccess?: () => void) => {
    if (submitting) {
      return
    }

    setSubmitting(true)
    setError('')

    try {
      await write()
      onSuccess?.()
      closeProjectDialog()
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.error)
      notifyError(err, mode === 'edit' ? p.editTitle : p.createFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const pickFolder = async () => {
    try {
      const dir = await pickProjectFolder()

      if (!dir) {
        return
      }

      const projectId = state?.projectId

      if (mode === 'add-folder' && projectId) {
        await runSubmit(() => addProjectFolder(projectId, dir))

        return
      }

      setFolders(prev => (prev.some(folder => folder.path === dir) ? prev : [...prev, { path: dir }]))
    } catch (err) {
      notifyError(err, p.createFailed)
    }
  }

  const reconnectFolder = (index: number, path: string) => {
    setFolders(prev =>
      prev.flatMap((item, i) => {
        if (i === index) {
          const updated = { ...item, path }

          delete updated.health
          delete updated.suggested_paths

          return [updated]
        }

        return item.path === path ? [] : [item]
      })
    )
  }

  const submit = async () => {
    const trimmed = name.trim()
    const projectId = state?.projectId

    if (mode === 'edit' && projectId && trimmed && folders.length) {
      await runSubmit(() => editProject(projectId, trimmed, folders))

      return
    }

    if (mode === 'rename' && projectId) {
      if (trimmed) {
        await runSubmit(() => renameProject(projectId, trimmed))
      }

      return
    }

    // A project owns sessions by folder (cwd-prefix), so creation requires at
    // least one — a folder-less project couldn't hold a session anyway.
    if (mode === 'create' && trimmed && folders.length) {
      // The arm is consumed exactly on SUCCESS (before the close): a failed
      // create leaves the dialog open for a retry that still lands where it
      // was dropped; the open-state effect discards it on cancel/teardown.
      await runSubmit(
        () =>
          createProject({
            dropPlacement,
            folders: folders.map(folder => folder.path),
            idea: idea.trim() || undefined,
            name: trimmed,
            use: true
          }),
        clearNewProjectDropPlacement
      )
    }
  }

  const generateIdea = async () => {
    if (generatingIdea) {
      return
    }

    setGeneratingIdea(true)

    try {
      const text = await generateProjectIdea(name)

      if (text) {
        setIdea(text)
      }
    } finally {
      setGeneratingIdea(false)
    }
  }

  const title =
    mode === 'edit'
      ? p.editTitle
      : mode === 'rename'
        ? p.renameTitle
        : mode === 'add-folder'
          ? p.addFolderTitle
          : p.createTitle

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[85dvh] max-w-lg overflow-y-auto"
        onInteractOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {mode === 'create' && <DialogDescription>{p.createDesc}</DialogDescription>}
          {mode === 'edit' && <DialogDescription>{p.editDesc}</DialogDescription>}
        </DialogHeader>

        {mode !== 'add-folder' && (
          <Input
            autoFocus
            disabled={submitting}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              } else if (event.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder={p.namePlaceholder}
            ref={nameRef}
            value={name}
          />
        )}

        {(mode === 'create' || mode === 'edit') && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{p.foldersLabel}</span>
            {mode === 'edit' && <p className="text-xs text-muted-foreground">{p.readOnlyHint}</p>}
            {folders.length === 0 ? (
              <span className="text-[0.75rem] text-(--ui-text-quaternary)">{p.noFolders}</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {folders.map((folder, index) => (
                  <li
                    className={cn(
                      'flex items-center gap-2 rounded-md bg-(--ui-control-hover-background) px-2 py-1 text-[0.75rem]'
                    )}
                    key={folder.original_path ?? folder.path}
                  >
                    <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="folder" size="0.75rem" />
                    <span className="min-w-0 flex-1 truncate" title={folder.path}>
                      {folder.path}
                      <ProjectFolderHealth
                        disabled={submitting}
                        folder={folder}
                        onReconnect={path => reconnectFolder(index, path)}
                      />
                    </span>
                    {mode === 'edit' && (
                      <label className="flex shrink-0 items-center gap-1 text-xs" title={p.readOnlyHint}>
                        <Checkbox
                          checked={Boolean(folder.read_only)}
                          disabled={submitting}
                          onCheckedChange={checked =>
                            setFolders(current =>
                              current.map((value, i) =>
                                i === index ? { ...value, read_only: checked === true } : value
                              )
                            )
                          }
                        />
                        {p.readOnly}
                      </label>
                    )}
                    {mode === 'edit' && (
                      <Tip label={p.changeFolder}>
                        <Button
                          aria-label={p.changeFolder}
                          disabled={submitting}
                          onClick={async () => {
                            try {
                              const path = await pickProjectFolder()

                              if (path) {
                                reconnectFolder(index, path)
                              }
                            } catch (err) {
                              notifyError(err, p.createFailed)
                            }
                          }}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Codicon name="edit" size="0.75rem" />
                        </Button>
                      </Tip>
                    )}
                    {index > 0 && (
                      <Tip label={p.makePrimary}>
                        <Button
                          aria-label={p.makePrimary}
                          disabled={submitting}
                          onClick={() => setFolders(prev => [prev[index]!, ...prev.filter((_, i) => i !== index)])}
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <Codicon name="target" size="0.75rem" />
                        </Button>
                      </Tip>
                    )}
                    {index === 0 && (
                      <span className="shrink-0 text-[0.625rem] uppercase text-(--ui-text-quaternary)">
                        {p.primaryBadge}
                      </span>
                    )}
                    <Tip label={p.removeFolder}>
                      <Button
                        aria-label={p.removeFolder}
                        className="size-5 shrink-0 text-(--ui-text-quaternary) hover:text-foreground"
                        disabled={submitting}
                        onClick={() => setFolders(prev => prev.filter(f => f !== folder))}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <Codicon name="close" size="0.75rem" />
                      </Button>
                    </Tip>
                  </li>
                ))}
              </ul>
            )}
            <Button
              className="self-start"
              disabled={submitting}
              onClick={() => void pickFolder()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Codicon name="add" size="0.75rem" />
              {p.addFolder}
            </Button>
          </div>
        )}

        {mode === 'create' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.6875rem] font-medium text-(--ui-text-tertiary)">{p.ideaLabel}</span>
            <div className="relative">
              <Textarea
                className="min-h-20 pr-8 text-[0.8125rem]"
                disabled={submitting}
                onChange={event => setIdea(event.target.value)}
                placeholder={p.ideaPlaceholder}
                value={idea}
              />
              <GenerateButton
                className="absolute top-1 right-1"
                disabled={submitting}
                generating={generatingIdea}
                generatingLabel={p.ideaGenerating}
                label={p.ideaGenerate}
                onGenerate={() => void generateIdea()}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {templates.map(template => (
                <button
                  className="flex items-center gap-1 rounded-full border border-(--ui-stroke-tertiary) px-2 py-0.5 text-[0.6875rem] text-(--ui-text-secondary) transition-colors hover:border-(--ui-stroke-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-50"
                  disabled={submitting}
                  key={template.label}
                  onClick={() => setIdea(template.idea)}
                  type="button"
                >
                  <span aria-hidden>{template.emoji}</span>
                  {template.label}
                </button>
              ))}
              <Tip label={p.ideaShuffle}>
                <Button
                  aria-label={p.ideaShuffle}
                  className="size-5 text-(--ui-text-quaternary) hover:text-foreground"
                  disabled={submitting}
                  onClick={() => setTemplates(randomIdeaTemplates())}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Codicon name="refresh" size="0.75rem" />
                </Button>
              </Tip>
            </div>
          </div>
        )}

        {mode === 'add-folder' && (
          <Button disabled={submitting} onClick={() => void pickFolder()} type="button">
            <Codicon name="folder-opened" size="0.875rem" />
            {p.addFolder}
          </Button>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {mode !== 'add-folder' && (
          <DialogFooter>
            <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {t.common.cancel}
            </Button>
            <Button
              disabled={
                submitting ||
                !name.trim() ||
                ((mode === 'create' || mode === 'edit') &&
                  (folders.length === 0 || new Set(folders.map(folder => folder.path)).size !== folders.length))
              }
              onClick={() => void submit()}
              type="button"
            >
              {mode === 'rename' || mode === 'edit' ? t.common.save : p.create}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
