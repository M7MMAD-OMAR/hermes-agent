import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { $localModelsEnabled } from '@/store/local-models-flag'
import { $localRuntimeJobs } from '@/store/local-runtime-jobs'
import {
  $modelVisibilityOpen,
  $visibleModelsByScope,
  modelVisibilityKey,
  setModelVisibilityOpen,
  setVisibleModels
} from '@/store/model-visibility'
import type { LocalRuntimeJob } from '@/types/hermes'

import { ModelCatalogMenu, type ModelMenuController } from './model-catalog-menu'

// Radix calls these on open; jsdom doesn't implement them.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

const getGlobalModelOptions = vi.fn()

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: (...args: unknown[]) => getGlobalModelOptions(...args),
  // The menu kicks the app-level job poller on mount; echo the store so a
  // poll can't wipe the jobs a test staged (the real backend is authority,
  // and here the store plays that part).
  getLocalModelsJobs: vi.fn(async () => {
    const { $localRuntimeJobs } = await import('@/store/local-runtime-jobs')

    return { jobs: [...$localRuntimeJobs.get()] }
  }),
  getLocalModelsStatus: vi.fn().mockResolvedValue({ loading: {} }),
  setApiRequestProfile: vi.fn()
}))

beforeEach(() => {
  $visibleModelsByScope.set({})
  $localRuntimeJobs.set([])
  // These suites exercise the local-models rows, which ship behind --local.
  $localModelsEnabled.set(true)
  setModelVisibilityOpen(false)
  getGlobalModelOptions.mockResolvedValue({
    providers: [{ models: ['gemini-3.1-pro', 'gemini-2.5-flash'], name: 'Google', slug: 'google' }]
  })
})

afterEach(() => {
  cleanup()
  // The backend mock echoes this snapshot; retire fixture jobs before jsdom
  // disappears so an in-flight app-level poll cannot schedule another tick.
  $localRuntimeJobs.set([])
  vi.clearAllMocks()
})

// A minimal controller — these tests are about the CATALOG's own behaviour
// (what it lists, what it offers), not about what any host does with a pick.
function renderMenu(profile?: string) {
  const select = vi.fn()

  const controller: ModelMenuController = {
    applyPreset: vi.fn(),
    current: { effort: '', fast: false, model: '', provider: '' },
    presetFor: () => ({}),
    select,
    setOptions: vi.fn()
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <DropdownMenu open>
        <DropdownMenuContent>
          <ModelCatalogMenu controller={controller} {...(profile ? { profile } : {})} />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>
  )

  return select
}

// Curation is one preference PER BOT (profile), and within a bot it belongs to
// the catalog rather than to whichever surface mounted it. If a host had to opt
// in, the composer and the kanban board would end up disagreeing about what "my
// models" means for the same bot, which is exactly the drift extracting this
// component was meant to prevent.
describe('the catalog owns model curation', () => {
  it('honours the stored Edit Models shortlist', async () => {
    setVisibleModels('default', new Set([modelVisibilityKey('google', 'gemini-2.5-flash')]))

    renderMenu()

    await screen.findByText(/Gemini 2\.5 Flash/i)
    expect(screen.queryByText(/Gemini 3\.1 Pro/i)).toBeNull()
  })

  it('still finds a hidden model by search — curation narrows the default view, not the catalog', async () => {
    setVisibleModels('default', new Set([modelVisibilityKey('google', 'gemini-2.5-flash')]))

    renderMenu()
    await screen.findByText(/Gemini 2\.5 Flash/i)

    const input = screen.getByRole('textbox', { name: 'Search models' })

    fireEvent.change(input, { target: { value: 'gemini-3.1' } })

    await vi.waitFor(() => {
      // The fold makes this id-style query highlight the spaced label: the
      // row renders as <mark>Gemini 3.1</mark> + ' Pro'.
      expect(screen.getByText('Gemini 3.1', { selector: 'mark' })).toBeDefined()
      // Display name is "Gemini 3.1 pro" (no title-case for gemini ids); the
      // row label span carries it (plus the effort meta suffix).
      expect(
        screen.getByText((_, element) =>
          Boolean(element?.classList.contains('truncate') && (element?.textContent ?? '').startsWith('Gemini 3.1 pro'))
        )
      ).toBeDefined()
    })
  })

  it('offers Edit Models without the host wiring it up', async () => {
    renderMenu()
    await screen.findByText(/Gemini 3\.1 Pro/i)

    fireEvent.click(screen.getByText('Edit models…'))

    expect($modelVisibilityOpen.get()).toBe(true)
  })
})

describe('in-flight local downloads', () => {
  const DOWNLOAD_JOB: LocalRuntimeJob = {
    job_id: 'dl1',
    kind: 'model-download',
    target: 'Qwen3.8 Flash Next (UD-Q4_K_XL)',
    model_id: 'qwen3.8-flash-next',
    status: 'running',
    phase: 'downloading',
    detail: '',
    total_bytes: 100,
    done_bytes: 41,
    percent: 41,
    error: null
  }

  it('shows a downloading model as a disabled progress row in its own Local group', async () => {
    // No llamacpp provider in the catalog (first-ever download).
    $localRuntimeJobs.set([DOWNLOAD_JOB])
    renderMenu()
    await screen.findByText(/Gemini 3\.1 Pro/i)

    const row = screen.getByText('Qwen3.8 Flash Next (UD-Q4_K_XL)')

    expect(row).toBeTruthy()
    expect(screen.getByText('41%')).toBeTruthy()
    expect(row.closest('[role="menuitem"]')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('shows the download inside the Local provider group when it exists', async () => {
    getGlobalModelOptions.mockResolvedValue({
      providers: [
        { models: ['Qwen3.6-27B-UD-Q4_K_XL'], name: 'Local', slug: 'llamacpp' },
        { models: ['gemini-3.1-pro'], name: 'Google', slug: 'google' }
      ]
    })
    $localRuntimeJobs.set([DOWNLOAD_JOB])
    renderMenu()

    await screen.findByText(/Qwen3\.6 27B/i)
    expect(screen.getByText('Qwen3.8 Flash Next (UD-Q4_K_XL)')).toBeTruthy()
    // One Local heading — the trailing fallback group must not double up.
    expect(screen.getAllByText('Local').length).toBe(1)
  })

  it('drops the placeholder row once the download settles', async () => {
    $localRuntimeJobs.set([DOWNLOAD_JOB])
    renderMenu()
    await screen.findByText('Qwen3.8 Flash Next (UD-Q4_K_XL)')

    $localRuntimeJobs.set([{ ...DOWNLOAD_JOB, status: 'done', phase: 'done' }])
    await waitFor(() => {
      expect(screen.queryByText('Qwen3.8 Flash Next (UD-Q4_K_XL)')).toBeNull()
    })
  })

  it('hides the local provider group and download rows without the --local flag (strict)', async () => {
    $localModelsEnabled.set(false)
    getGlobalModelOptions.mockResolvedValue({
      providers: [
        { models: ['Qwen3.6-27B-UD-Q4_K_XL'], name: 'Local', slug: 'llamacpp' },
        { models: ['gemini-3.1-pro'], name: 'Google', slug: 'google' }
      ]
    })
    $localRuntimeJobs.set([DOWNLOAD_JOB])
    renderMenu()

    // Staged models exist and a download is running — none of it shows.
    await screen.findByText(/Gemini 3\.1 Pro/i)
    expect(screen.queryByText(/Qwen3\.6 27B/i)).toBeNull()
    expect(screen.queryByText('Qwen3.8 Flash Next (UD-Q4_K_XL)')).toBeNull()
    expect(screen.queryByText('Local')).toBeNull()
  })
})


// One curation per bot. Someone who runs a profile as a bot pins it to one
// provider and trims its menu down; doing that must not retune every other
// bot's menu, which is what a single global shortlist did.
describe('curation is scoped to the bot', () => {
  it('does not apply one profile\'s shortlist to another profile', async () => {
    setVisibleModels('dn', new Set([modelVisibilityKey('google', 'gemini-2.5-flash')]))

    renderMenu('dn')
    await screen.findByText(/Gemini 2\.5 Flash/i)
    expect(screen.queryByText(/Gemini 3\.1 Pro/i)).toBeNull()

    cleanup()

    // A different bot never customized: it still gets the curated default,
    // which is the whole catalog here.
    renderMenu('builder')
    await screen.findByText(/Gemini 3\.1 Pro/i)
  })

  it('leaves the other profile untouched when one profile is edited', async () => {
    setVisibleModels('dn', new Set([modelVisibilityKey('google', 'gemini-2.5-flash')]))
    setVisibleModels('builder', new Set([modelVisibilityKey('google', 'gemini-3.1-pro')]))

    renderMenu('dn')
    await screen.findByText(/Gemini 2\.5 Flash/i)
    expect(screen.queryByText(/Gemini 3\.1 Pro/i)).toBeNull()
  })
})

// A router serves other labs' models under their own namespace, which the
// display name drops: `anthropic/claude-opus-5` reads as plain "Opus 5", the
// same as the Anthropic-subscription row. The lab has to stay on the row.
describe('models routed through an aggregator name their lab', () => {
  beforeEach(() => {
    getGlobalModelOptions.mockResolvedValue({
      providers: [
        { models: ['claude-opus-5'], name: 'Anthropic', slug: 'anthropic' },
        {
          models: ['anthropic/claude-opus-5', 'deepseek/deepseek-v4.1-flash'],
          name: 'OpenRouter',
          slug: 'openrouter'
        }
      ]
    })
  })

  it('qualifies a routed row with its lab and leaves the first-party row plain', async () => {
    renderMenu()

    await screen.findByText('Anthropic', { selector: 'span' })
    // Two rows read "Opus 5"; only the routed one carries the lab beside it.
    expect(await screen.findAllByText(/Opus 5/)).toHaveLength(2)
    expect(screen.getByText(/· Anthropic/)).toBeTruthy()
    expect(screen.getByText(/· DeepSeek/)).toBeTruthy()
  })

  it('leaves a single-vendor provider unqualified', async () => {
    getGlobalModelOptions.mockResolvedValue({
      providers: [{ models: ['gemini-3.1-pro'], name: 'Google', slug: 'google' }]
    })

    renderMenu()

    await screen.findByText(/Gemini 3\.1 Pro/i)
    expect(screen.queryByText(/· /)).toBeNull()
  })
})
