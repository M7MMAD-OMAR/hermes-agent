import { OFFICE_PREVIEW_KIND_BY_FAMILY, officeFamilyForPath } from '@hermes/shared/office-format'
import { atom, computed, type WritableAtom } from 'nanostores'

import { forgetPreviewConsole } from '@/app/chat/right-rail/preview-console-store'
import { dismissTreePane, isPaneVisible } from '@/components/pane-shell/tree/store'
import { previewKindForPath } from '@/lib/preview-kind'
import { readJson, writeKey } from '@/lib/storage'
import { normalize } from '@/lib/text'

import { recordFeatureUse } from './desktop-metrics'
import { $rightRailActiveTabId, type RightRailTabId, selectRightRailTab } from './layout'
import { clearExplicitPreviewOpen, noteExplicitPreviewOpen, PREVIEW_TILE_PREFIX } from './preview-explicit'
import {
  $pendingRuntimeByTab,
  $rotatedSessionIds,
  $selectionIsListed,
  bucketTabsFor,
  currentSessionId,
  drawerShowsTab,
  ownerIdentity,
  type PreviewOwner,
  setPendingRuntime
} from './preview-ownership'
import { normalizeProfileKey } from './profile'
import { $activeSessionId } from './session'
import { $focusedSessionIsTile, $focusedStoredSessionId } from './session-focus'
import { canOpenBrowserWindow, isBrowserWindow, openBrowserInNewWindow, windowBrowserTabId } from './windows'

/**
 * PREVIEW RAIL — one list of tabs, one way in.
 *
 * Everything the rail can show is a `PreviewTarget` in `$previewTabs`: a file
 * on disk, a live URL, or a generated artifact. There is no privileged "live
 * preview" slot alongside the tabs; `openPreview` is the only entry point, so
 * a tool result, a file-browser click, and an artifact card all travel the
 * same road and behave identically once open.
 *
 * Every tab belongs to the session that opened it (#73890): the drawer shows
 * the focused session's tabs plus the pinned ones, and a hidden session's
 * tabs stay alive until it comes back. Tabs close when you close them.
 */

/** How an HTML file target shows: the live page, or its source. */
export type PreviewRenderMode = 'preview' | 'source'

export interface PreviewTarget {
  binary?: boolean
  byteSize?: number
  /** Inline image bytes (a `data:` URL) when the renderer already holds them —
   * e.g. a pasted/dropped screenshot whose only on-disk copy is a transient
   * path the preview can't reliably re-read. Rendered directly and NOT
   * persisted (it would bloat localStorage). */
  dataUrl?: string
  /** `artifact` targets have nothing behind them on disk or on the network —
   * `url` is an id into the artifact registry, which owns the content. They
   * are what lets the rail preview generated HTML the workspace never saw. */
  kind: 'artifact' | 'file' | 'url'
  label: string
  large?: boolean
  language?: string
  mimeType?: string
  path?: string
  /** `directory`/`missing` are typed non-previewable results from main-process
   * normalization (#101683): they never reach `openPreview` — callers branch on
   * them for the native folder action / not-found reporting instead. */
  previewKind?: 'binary' | 'directory' | 'html' | 'image' | 'missing' | 'pdf' | 'sheet' | 'slides' | 'text' | 'word'
  renderMode?: PreviewRenderMode
  /** Tombstone set when a read/watch confirmed the file is gone. The tab stays
   *  open for the session showing an explicit "file no longer exists" state,
   *  but is dropped at the next restore so day-2 boots stop re-probing it. */
  missing?: boolean
  source: string
  /** Runtime-only target that cannot be restored from persisted state. */
  transient?: boolean
  url: string
}

export interface PreviewServerRestart {
  message?: string
  status: 'complete' | 'error' | 'running'
  taskId: string
  url: string
}

/** Where an open came from. It decides agent ownership of a browser tab (a
 *  tool result opens in, and claims, the agent's tab) and whether an HTML file
 *  is forced back to its rendered page on hand-over. */
export type PreviewRecordSource = 'explicit-link' | 'file-browser' | 'manual' | 'tool-result'

export interface PreviewTab {
  /** Opened by the agent, and so the tab it browses in. The agent re-uses this
   *  tab across a whole task instead of stacking one per navigation, and never
   *  reaches for a tab without it — see `browserTabId`. */
  agent?: boolean
  id: RightRailTabId
  /** RUNTIME session id of the agent that opened this tab, when one did.
   *
   *  Runtime, never the stored id. A session-keyed preview registry existed
   *  once and was removed in 96999b116 because it was keyed on the STORED id,
   *  which lands late: an `open_preview` from a session whose stored id had not
   *  arrived was written and then immediately reconciled away, so the pane
   *  flashed and vanished. The runtime id is in hand at the moment the tool
   *  runs. This is also why ownership is a field on the one tab list rather
   *  than a second registry beside it — two lists under two id rules is the
   *  shape that failed.
   *
   *  Absent = nobody's: a file-browser click, an artifact, a link you opened.
   *  Those stay visible to everyone. */
  owner?: string
  /** STORED session id of the conversation that owns this tab — the same claim
   *  as `owner`, in the one form that survives a restart.
   *
   *  `owner` is a runtime id and is dropped on the way out, so without this
   *  every restored tab came back belonging to nobody and showed in EVERY
   *  conversation: reopen the app and the other chat's page is sitting in
   *  yours again.
   *
   *  Safe where the deleted registry was not, because this id decides only what
   *  the strip DRAWS — nothing routes a write through it. The registry removed
   *  in 96999b116 keyed the WRITE path on the stored id and lost races against
   *  its own arrival; a late id here can only leave a tab visible a moment
   *  longer. */
  ownerKey?: string
  target: PreviewTarget
  /** Stored id of the session that owns the tab. Absent on a tab opened in a
   *  fresh draft (adopted when the draft becomes a session) and on legacy rows
   *  written before session scoping (decodePreviewTabs migrates those to
   *  pinned). */
  sessionId?: string
  /** Pinned tabs render in EVERY session — the explicit cross-session
   *  workspace. Everything else is visible only in the session that owns it.
   *  Always written by this build, so a missing flag marks a legacy row. */
  pinned?: boolean
}

const TABS_STORAGE_KEY = 'hermes.desktop.previewTabs.v2'
/** Superseded by the tab list above; cleared so it can't leak forever. */
const LEGACY_SESSION_REGISTRY_KEY = 'hermes.desktop.sessionPreviews.v1'

function isPreviewTarget(value: unknown): value is PreviewTarget {
  if (!value || typeof value !== 'object') {
    return false
  }

  const r = value as Record<string, unknown>

  return (
    (r.kind === 'artifact' || r.kind === 'file' || r.kind === 'url') &&
    typeof r.label === 'string' &&
    typeof r.source === 'string' &&
    typeof r.url === 'string'
  )
}

// Artifact tabs are never written (their registry is memory-only), so a
// restored artifact row is stale storage — drop it rather than reviving a tab
// with nothing behind it.
function isPreviewTab(value: unknown): value is PreviewTab {
  if (!value || typeof value !== 'object') {
    return false
  }

  const r = value as Record<string, unknown>

  return typeof r.id === 'string' && (r.id.startsWith('file:') || r.id.startsWith('url:')) && isPreviewTarget(r.target)
}

function isPdfFileTarget(target: PreviewTarget): boolean {
  if (target.kind !== 'file') {
    return false
  }

  if (target.mimeType?.toLowerCase() === 'application/pdf') {
    return true
  }

  if ([target.path, target.source].some(value => (value ? /\.pdf$/i.test(value) : false))) {
    return true
  }

  try {
    return /\.pdf$/i.test(new URL(target.url).pathname)
  } catch {
    return false
  }
}

/** A path that picked up the closing `**` of the bold marker it was written
 *  inside. The file never existed under that name, so the tab could only ever
 *  fail; an asterisk is not a character real paths end with. */
const STRAY_MARKUP_TAIL = /\*+$/

function withoutStrayMarkup(target: PreviewTarget): PreviewTarget {
  if (target.kind !== 'file' || !STRAY_MARKUP_TAIL.test(target.url)) {
    return target
  }

  const trim = (value: string | undefined) => (value === undefined ? undefined : value.replace(STRAY_MARKUP_TAIL, ''))
  const path = trim(target.path)
  const url = trim(target.url) ?? target.url

  return {
    ...target,
    label: trim(target.label) ?? target.label,
    ...(path === undefined ? {} : { path }),
    // The tab was classified while its extension still read `.docx**`, so its
    // kind is whatever an unknown suffix falls back to. Ask again now that the
    // name is the file's real one.
    previewKind: previewKindForPath(path || url),
    source: trim(target.source) ?? target.source,
    url
  }
}

/** Office files were one `office` kind while they all previewed as the same
 *  printed PDF. Each family now has its own viewer, so a tab persisted under
 *  the old kind has to be re-pointed or it renders as "no inline preview". */
function withCurrentOfficeKind(target: PreviewTarget): PreviewTarget {
  if (target.kind !== 'file' || (target.previewKind as string | undefined) !== 'office') {
    return target
  }

  const family = officeFamilyForPath(target.path || target.url)

  return { ...target, previewKind: family ? OFFICE_PREVIEW_KIND_BY_FAMILY[family] : 'binary' }
}

/** Upgrade tabs persisted by earlier builds: PDFs classified as generic
 * binary, Office files classified under the single retired `office` kind, and
 * paths that swallowed the markdown emphasis they were written inside. Without
 * these restore-time migrations an already-open tab keeps failing after
 * Desktop itself has been upgraded, and the only fix a reader has is to close
 * and reopen it. */
export function decodePreviewTabs(raw: string): PreviewTab[] {
  const parsed = JSON.parse(raw) as unknown

  // Storage holds one list per profile now; a build before that stored a single
  // array. Both answer "every tab on disk", which is what a reader of the raw
  // key (the pop-out's `adoptPersistedBrowserTab`) is asking for.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.values(parsed as Record<string, unknown>).flatMap(parseTabList)
  }

  return parseTabList(parsed)
}

function parseTabList(parsed: unknown): PreviewTab[] {
  const restored = (Array.isArray(parsed) ? parsed.filter(isPreviewTab) : [])
    // Drop tombstoned file tabs (a previous session confirmed the file is
    // gone). Keeping them would re-probe a known-dead path on every boot.
    .filter(tab => !tab.target.missing)
    .map(tab => {
      const repaired = withCurrentOfficeKind(withoutStrayMarkup(tab.target))

      const target =
        isPdfFileTarget(repaired) && repaired.previewKind === 'binary'
          ? { ...repaired, previewKind: 'pdf' as const }
          : repaired

      return target === tab.target ? tab : { ...tab, id: previewTabId(target, tab.sessionId), target }
    })

  // Repairing a path can land a tab on an id another tab already holds: the
  // broken `prd.docx**` and the working `prd.docx` were both open at once. A
  // list holding two of one id has no single answer to "select this tab", so
  // the first one wins and the duplicate is dropped.
  const seen = new Set<string>()

  const unique = restored.filter(tab => {
    if (seen.has(tab.id)) {
      return false
    }

    seen.add(tab.id)

    return true
  })

  // Legacy rows (written before session scoping) have no owner and no way to
  // recover one — keep them as workspace-pinned rather than dropping them or
  // dumping every stale tab into one chat. Ids are kept verbatim: a Browser's
  // minted id is how the pop-out window finds its tab (#119850).
  //
  // A browser tab this fork wrote carries `ownerKey` (the stored id of the
  // conversation whose browser it is) and nothing else: that IS an owner, so it
  // goes back to its conversation instead of being pinned into all of them.
  return unique.map(tab =>
    tab.sessionId !== undefined || tab.pinned !== undefined
      ? tab
      : tab.ownerKey
        ? { ...tab, pinned: false, sessionId: tab.ownerKey }
        : { ...tab, pinned: true }
  )
}

/** The tabs a profile's rail is showing, keyed by profile. */
type TabsByProfile = Record<string, PreviewTab[]>

/** Read every profile's bucket. A value written by a build that stored ONE
 *  global array is held back and adopted by the first scope to arrive rather
 *  than dropped — tabs the user can see are the tabs that must survive. */
let pendingLegacyTabs: PreviewTab[] | null = null

function loadTabsByProfile(): TabsByProfile {
  const stored = readJson<unknown>(TABS_STORAGE_KEY)

  if (Array.isArray(stored)) {
    pendingLegacyTabs = parseTabList(stored)

    return {}
  }

  if (!stored || typeof stored !== 'object') {
    return {}
  }

  const byProfile: TabsByProfile = {}

  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    byProfile[normalizeProfileKey(key)] = parseTabList(value)
  }

  return byProfile
}

const tabsByProfile = loadTabsByProfile()

/** Inline bytes are not restorable. Strip them from images, and skip remote
 *  HTML and artifact tabs that cannot render without their in-memory payload. */
function persistableTabs(tabs: PreviewTab[]): PreviewTab[] {
  return tabs.filter(
    tab =>
      tab.target.kind !== 'artifact' &&
      !tab.target.transient &&
      !(tab.target.previewKind === 'html' && tab.target.dataUrl)
  )
}

function persistTabs() {
  const buckets: TabsByProfile = {}

  for (const [key, tabs] of Object.entries(tabsByProfile)) {
    const persistable = persistableTabs(tabs)

    if (persistable.length > 0) {
      buckets[key] = persistable
    }
  }

  // `dataUrl` holds inline bytes that cannot be restored; drop the key wherever
  // it survives the filter above (an image tab). An empty map removes the key
  // rather than storing `{}`, matching the tiles store.
  writeKey(
    TABS_STORAGE_KEY,
    Object.keys(buckets).length === 0
      ? null
      : JSON.stringify(
          buckets,
          // `agent` and `owner` go out with `dataUrl`. Ownership is a claim by the
          // session that is running, not a property of the tab: persisted, it never
          // expires, and a tab the user adopted as their own weeks ago would still
          // answer to the next session's agent (the #93190 clobber, deferred rather
          // than removed). `owner` also names a RUNTIME session, and no runtime
          // survives the restart, so a restored owner would bind the tab to a dead
          // id. `ownerKey` deliberately survives: it is the restart-durable half.
          (key, value) => (key === 'agent' || key === 'dataUrl' || key === 'owner' ? undefined : value)
        )
  )
}

// Tabs are scoped to THE CHAT ON SCREEN, not to the window's gateway socket.
// `session-states.ts` resolves the focused session's owner and pushes it here
// via `setPreviewScope`; the two must not be conflated, because a focused tab
// does not swap the socket — every bot chat is served by one pooled backend, so
// a socket-keyed rail showed one agent's preview in every agent's chat. That is
// the same trap `bot-row.tsx` documents for the roster highlight. (It also owns
// the resolver, so it pushes rather than having this module reach for it — this
// file is already imported by session-states.ts.)
//
// Which bucket the atom mirrors. A RENAME moves the view without the scope
// changing, so this has to follow the rename or the persist subscriber below
// would resurrect the bucket the rename just deleted.
let viewKey = 'default'

export const $previewTabs = atom<PreviewTab[]>([])

// Adoption phase: emissions that carry storage THIS MODULE JUST READ, not a
// change. nanostores' subscribe fires immediately, and writing what was just
// read back is a data-loss clobber: every renderer boots against storage it
// has not adopted yet, and echoing the empty view back overwrites the real
// record before adoption can read it. A legacy single-array store is wiped
// this way before `pendingLegacyTabs` is ever adopted; a bucket store loses
// its `default` bucket the same way.
let adoptingStoredTabs = true

$previewTabs.subscribe(tabs => {
  if (adoptingStoredTabs) {
    return
  }

  // `subscribe` hands a readonly view; the bucket is a mutable store of its own.
  tabsByProfile[viewKey] = [...tabs]
  persistTabs()
  forgetGonePendingTabs()
})

// Seed the view with this renderer's own bucket. Without it the primary
// profile's rail never restores: `viewKey` already IS 'default', so
// `setPreviewScope` early-returns and nothing else moves the bucket into the
// atom. Suppressed like the creation emission above — a persist here would
// echo the just-read record back out (wiping a legacy store before adoption).
$previewTabs.set(tabsByProfile[viewKey] ?? [])
adoptingStoredTabs = false

/** Re-home the rail onto the profile that owns the chat on screen. Called by
 *  `session-states.ts` whenever the focused session (or its resolved owner)
 *  changes; the previous agent's tabs must not leak into the next one. */
export function setPreviewScope(scope: string) {
  const next = normalizeProfileKey(scope) || 'default'

  if (next === viewKey) {
    return
  }

  applyPreviewScope(next)
}

/** Swap the view onto `next`'s bucket (legacy tabs ride along into it). Split
 *  from `setPreviewScope` so `adoptPersistedBrowserTab` can force a re-home
 *  onto the bucket a persisted tab lives in — the same-key early return above
 *  would skip exactly that case (a fresh pop-out renderer starts on 'default'
 *  while the popped tab belongs to another profile). */
function applyPreviewScope(next: string) {
  if (pendingLegacyTabs) {
    tabsByProfile[next] = [...(tabsByProfile[next] ?? []), ...pendingLegacyTabs]
    pendingLegacyTabs = null
    persistTabs()
  }

  viewKey = next
  $previewTabs.set(tabsByProfile[next] ?? [])
}

/** Drop one profile's rail. Delete counterpart of the tiles store's
 *  `dropTilesForProfile`, which profile deletion calls. */
export function dropPreviewTabsForProfile(profile: string) {
  const key = normalizeProfileKey(profile)

  delete tabsByProfile[key]
  persistTabs()

  if (key === viewKey) {
    $previewTabs.set([])
  } else {
    forgetGonePendingTabs()
  }
}

/** Move one profile's rail to another. Rename counterpart of the tiles store's
 *  `migrateTilesForProfile`: without it a rename strands the tabs under a
 *  profile that no longer exists. */
export function migratePreviewTabsForProfile(oldProfile: string, newProfile: string) {
  const from = normalizeProfileKey(oldProfile)
  const to = normalizeProfileKey(newProfile)

  if (from === to) {
    return
  }

  const moved = tabsByProfile[from]

  if (moved) {
    delete tabsByProfile[from]
    tabsByProfile[to] = [...(tabsByProfile[to] ?? []), ...moved]
  }

  // The view belongs to the renamed profile; only its NAME changed. Re-point it
  // BEFORE the atom is set, so the persist subscriber writes the new bucket
  // rather than resurrecting the one just deleted.
  const wasInView = from === viewKey

  if (wasInView) {
    viewKey = to
  }

  persistTabs()

  if (wasInView) {
    $previewTabs.set(tabsByProfile[to] ?? [])
  }
}

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(LEGACY_SESSION_REGISTRY_KEY)
  } catch {
    // Storage access can throw in locked-down contexts; nothing depends on it.
  }
}

/** The tabs an agent tool acting for `owner` (default: the focused session)
 *  may read or drive: never another session's hidden tab, and never another
 *  profile's pin. A popped-out Browser renderer answers only for the one tab
 *  it shows (the chat window decided the requester may see it —
 *  `previewTabIdsVisibleTo`). */
export function previewTabsFor(owner: PreviewOwner = $focusedStoredSessionId.get()): PreviewTab[] {
  if (isBrowserWindow()) {
    const own = windowBrowserTabId()

    return $previewTabs.get().filter(tab => tab.id === own)
  }

  return bucketTabsFor($previewTabs.get(), ownerIdentity(owner), viewKey, viewKey)
}

/** Ids of the tabs `owner` may see in ANY profile's rail, for scoping a
 *  request to a popped-out Browser window: a background session's Browser
 *  can be popped out while another profile is in view. Its own tabs count in
 *  every bucket; pins only in its own profile's. */
export function previewTabIdsVisibleTo(owner: PreviewOwner): string[] {
  const who = ownerIdentity(owner)

  const buckets: [string, readonly PreviewTab[]][] = [
    [viewKey, $previewTabs.get()],
    ...Object.entries(tabsByProfile).filter(([key]) => key !== viewKey)
  ]

  return buckets.flatMap(([key, tabs]) => bucketTabsFor(tabs, who, key, viewKey)).map(tab => tab.id)
}

/** Tabs the FOCUSED session sees. The layout-tree mirror renders only these,
 *  so a session switch swaps the drawer; hidden tabs stay in `$previewTabs`.
 *  The primary also shows the tabs its runtime opened before its stored id
 *  arrived: the selection can name that id a beat before the runtime binds it,
 *  and a Browser hidden in that gap would lose its page. Never under a listed
 *  session: a resume selects it a beat before it unbinds the runtime. */
export const $visiblePreviewTabs = computed(
  [
    $previewTabs,
    $focusedStoredSessionId,
    $rotatedSessionIds,
    $pendingRuntimeByTab,
    $activeSessionId,
    $focusedSessionIsTile,
    $selectionIsListed
  ],
  (tabs, sessionId, rotated, pending, activeRuntime, focusedIsTile, selectionIsListed) =>
    tabs.filter(tab =>
      drawerShowsTab(tab, { activeRuntime, focusedIsTile, pending, rotated, selectionIsListed, sessionId })
    )
)

// The tab each session last had in front, so switching back to a session
// fronts what it was showing instead of its first tab. Memory-only.
const activeTabBySession = new Map<string, RightRailTabId>()

function rememberActiveTab(sessionId: null | string, tabId: RightRailTabId | null): void {
  const key = currentSessionId(sessionId)

  if (key && tabId) {
    activeTabBySession.set(key, tabId)
  }
}

/** Rekey a rotated conversation's tabs onto its new stored id. Every profile
 *  bucket, not just the view: a background tile's conversation rotates too. */
export function rekeyPreviewTabsSession(previousId: string, nextId: string): void {
  // Both ends resolve to their current tips first: a late or replayed event
  // can name an id that already rotated, or point back at an older tip, and
  // linking anything but two distinct tips would close an alias cycle.
  const from = currentSessionId(previousId)
  const to = currentSessionId(nextId)

  if (!from || !to || from === to) {
    return
  }

  const owned = (tab: PreviewTab) =>
    currentSessionId(tab.sessionId) === from || (tab.ownerKey != null && currentSessionId(tab.ownerKey) === from)

  // `ownerKey` is the same claim as `sessionId` in this fork's agent browser
  // tabs, so it follows the conversation onto its new tip too.
  const rekey = (tabs: PreviewTab[]) =>
    tabs.some(owned)
      ? tabs.map(tab =>
          owned(tab) ? { ...tab, ...(tab.ownerKey == null ? {} : { ownerKey: to }), sessionId: to } : tab
        )
      : null

  let backgroundChanged = false

  for (const [key, tabs] of Object.entries(tabsByProfile)) {
    const next = key === viewKey ? null : rekey(tabs)

    if (next) {
      tabsByProfile[key] = next
      backgroundChanged = true
    }
  }

  if (backgroundChanged) {
    persistTabs()
  }

  const view = rekey($previewTabs.get())

  // Only after the rekey: `owned` resolves through the map as it was.
  $rotatedSessionIds.set(new Map([...$rotatedSessionIds.get(), [from, to]]))

  if (view) {
    $previewTabs.set(view)
  }

  const remembered = activeTabBySession.get(from)

  if (remembered) {
    activeTabBySession.set(to, remembered)
  }
}

$rightRailActiveTabId.listen(tabId => {
  const sessionId = $focusedStoredSessionId.get()

  if (tabId && $visiblePreviewTabs.get().some(tab => tab.id === tabId)) {
    rememberActiveTab(sessionId, tabId)
  }
})

/** The tab the focused session's drawer should front: the current selection
 *  when it is visible, else the one this session last had in front, else its
 *  first tab. */
export function preferredVisibleTabId(): RightRailTabId | null {
  const visible = $visiblePreviewTabs.get()
  const isVisible = (id: null | RightRailTabId | undefined) => Boolean(id && visible.some(tab => tab.id === id))
  const active = $rightRailActiveTabId.get()

  if (isVisible(active)) {
    return active
  }

  const key = currentSessionId($focusedStoredSessionId.get())
  const remembered = key ? activeTabBySession.get(key) : undefined

  return isVisible(remembered) ? remembered! : (visible[0]?.id ?? null)
}

/** A fresh draft has no session yet, so tabs opened there are ownerless (the
 *  drawer of every draft shows them). Called where the draft's first send
 *  assigns its stored id — beside the composer draft's own hand-over — so the
 *  tabs follow it into the conversation. Never on a focus change: clicking an
 *  existing session or a side tile must leave the draft's tabs in the draft. */
export function adoptDraftPreviewTabs(storedSessionId: string): void {
  const pending = $pendingRuntimeByTab.get()
  // A tab a live runtime opened before its stored id is that runtime's, not
  // the draft's.
  const draftOwned = (tab: PreviewTab) => tab.sessionId == null && !tab.pinned && !pending.has(tab.id)
  const tabs = $previewTabs.get()

  if (tabs.some(draftOwned)) {
    $previewTabs.set(tabs.map(tab => (draftOwned(tab) ? { ...tab, sessionId: storedSessionId } : tab)))
  }
}

/** Drop the runtime notes of tabs no profile bucket holds any more (closed,
 *  pruned, or their profile dropped). */
function forgetGonePendingTabs(): void {
  const pending = $pendingRuntimeByTab.get()

  if (pending.size === 0) {
    return
  }

  const alive = new Set<string>(Object.values(tabsByProfile).flatMap(tabs => tabs.map(tab => tab.id)))

  if ([...pending.keys()].some(id => !alive.has(id))) {
    $pendingRuntimeByTab.set(new Map([...pending].filter(([id]) => alive.has(id))))
  }
}

/** `runtimeId`'s stored id was just bound (its session state went from no
 *  stored id to `storedSessionId`): the tabs it opened before then are that
 *  session's. Called by the session-state layer at that transition — never on
 *  a selection change, which is also what resuming another session looks
 *  like. Every profile bucket: the runtime may not be the one in view. */
export function adoptPendingRuntimeTabs(runtimeId: string, storedSessionId: string): void {
  const ids = new Set([...$pendingRuntimeByTab.get()].filter(([, runtime]) => runtime === runtimeId).map(([id]) => id))

  if (ids.size === 0) {
    return
  }

  const adopt = (tabs: PreviewTab[]) =>
    tabs.some(tab => ids.has(tab.id) && tab.sessionId == null)
      ? tabs.map(tab =>
          ids.has(tab.id) && tab.sessionId == null
            ? {
                ...tab,
                ...(tab.agent && !tab.ownerKey ? { ownerKey: storedSessionId } : {}),
                sessionId: storedSessionId
              }
            : tab
        )
      : null

  let backgroundChanged = false

  for (const [key, tabs] of Object.entries(tabsByProfile)) {
    const next = key === viewKey ? null : adopt(tabs)

    if (next) {
      tabsByProfile[key] = next
      backgroundChanged = true
    }
  }

  if (backgroundChanged) {
    persistTabs()
  }

  const view = adopt($previewTabs.get())

  // Owner first, then the note: the other order leaves a beat where the tab
  // is neither owned nor pending and drops out of the drawer.
  if (view) {
    $previewTabs.set(view)
  }

  $pendingRuntimeByTab.set(new Map([...$pendingRuntimeByTab.get()].filter(([id]) => !ids.has(id))))
}

/** The tab the rail actually shows. A stale or missing selection falls back to
 *  the first tab, so the strip, `⌘W`, and the pane never disagree about which
 *  tab is on screen. */
function resolveActiveTab(tabs: PreviewTab[], activeTabId: RightRailTabId | null): PreviewTab | null {
  return tabs.find(tab => tab.id === activeTabId) ?? tabs[0] ?? null
}

/** Which of its own tabs each RUNTIME session's agent is working in. Module
 *  state, not persisted: it is a property of the turn in flight, and a restored
 *  one would point the agent at a tab it has no memory of opening.
 *
 *  Keyed, because it used to be one variable for the whole app. Two chats
 *  browsing at once both resolved to it, so the second `open_preview` landed in
 *  the first one's tab and every later click, read and navigation went to
 *  whichever page won last — one shared browser wearing N conversations. */
const agentTabBySession = new Map<string, RightRailTabId>()

/** Key for agent opens that arrive with no session id. */
const UNSCOPED = '\u0000unscoped'

/** Is `tab` the browsing tab of the agent in `sessionId`?
 *
 *  One predicate for both lookups below — they must agree, or "go back to the
 *  tab already holding this page" resolves to a different tab than "keep
 *  working where I was", and `new_tab` becomes one-way again.
 *
 *  A null session matches the agent tabs nobody has claimed rather than
 *  nothing: an event that arrives unscoped must still browse beside the user,
 *  never fall through to the page they are reading. */
function agentOwns(tab: PreviewTab, sessionId: null | string): boolean {
  return Boolean(isBrowserTab(tab) && tab.agent && (sessionId ? tab.owner === sessionId : !tab.owner))
}

/** The tab an AGENT ACTION operates on — clicking, typing, navigating, reading.
 *
 *  Not the active tab. Resolving a write by "what's on screen" means the agent
 *  clicks around the page you just switched to, which is the same mistake as
 *  #93190 one layer down: the agent's tab is where it opened its page, and
 *  focus is yours to move while it works.
 *
 *  And not ANY agent tab: `sessionId` is which conversation is asking. Without
 *  it, session A's `read_preview` answers from session B's page.
 *
 *  NO FALLBACK TO THE ACTIVE TAB. A conversation that never opened a page of
 *  its own used to fall through to "the page you are looking at" and every
 *  `drive_preview` verb — reload and navigate included — landed on YOUR tab:
 *  the reported "يحذف لي كل شيء ويحدث المتصفح". The agent now gets a clear
 *  error and opens its own tab with `open_preview`; a session's own tab, or
 *  its newest, still resolves here.
 *
 *  Reads resolve through here too: `read_preview` answering from a different
 *  tab than `drive_preview` acted on let the agent click one page and report
 *  another. */
export function agentPreviewTabId(sessionId: null | string): RightRailTabId | null {
  const tabs = $previewTabs.get()

  return agentTab(tabs, sessionId)?.id ?? null
}

/** This session's CURRENT tab, or the newest it owns if that one has been
 *  closed.
 *
 *  Tracked rather than derived: resolving by "the newest agent tab" alone made
 *  `new_tab` one-way — once the agent opened a second tab, every later action
 *  went there and the first was unreachable for the rest of the session, since
 *  no tool selects a browser tab. */
function agentTab(tabs: readonly PreviewTab[], sessionId: null | string): PreviewTab | undefined {
  const owned = (tab: PreviewTab) => agentOwns(tab, sessionId)
  const current = tabs.find(tab => tab.id === agentTabBySession.get(sessionId ?? UNSCOPED) && owned(tab))

  return current ?? tabs.findLast(owned)
}
// A restored active id whose tab didn't survive validation would leave the rail
// pointing at nothing. Checked against every tab, not the visible ones: at
// boot no session is focused yet, and re-homing onto the focused session's
// tabs is the preview tiles' job once one is.
selectRightRailTab(resolveActiveTab($previewTabs.get(), $rightRailActiveTabId.get())?.id ?? null)

/** The target the rail is currently showing, or null when it has no tabs. */
export const $previewTarget = computed(
  [$visiblePreviewTabs, $rightRailActiveTabId],
  (tabs, activeTabId) => resolveActiveTab(tabs, activeTabId)?.target ?? null
)

/** Raw `source` strings of every tab the active session sees, for the composer
 *  rows that toggle a preview open and closed by the target they were handed. */
export const $previewTabSources = computed($visiblePreviewTabs, tabs => tabs.map(tab => tab.target.source))

export interface BrowserPage {
  title: string
  url: string
}

/**
 * What each Browser tab is SHOWING right now, as opposed to the target it was
 * opened with. Kept out of the target on purpose: the pane builds its guest
 * from `target.url`, so folding navigation back in would tear the webview down
 * and lose the history behind it. Memory-only — a restored tab reports again
 * on its first load.
 */
export const $browserPages = atom<Record<string, BrowserPage>>({})

export function noteBrowserPage(tabId: string, page: BrowserPage) {
  const current = $browserPages.get()[tabId]

  if (current?.title === page.title && current.url === page.url) {
    return
  }

  $browserPages.set({ ...$browserPages.get(), [tabId]: page })
}

export function forgetBrowserPage(tabId: string) {
  const { [tabId]: gone, ...rest } = $browserPages.get()

  if (gone) {
    $browserPages.set(rest)
  }
}

/** Write the page a Browser is showing back onto its persisted tab. The
 *  webview is built from `target.url`, so this is for hand-off (pop-out /
 *  dock-back), not for every in-page hop — that would tear the guest down. */
export function commitBrowserTabLocation(tabId: string, url: string, title?: string) {
  const nextUrl = url.trim()

  if (!tabId || !nextUrl) {
    return
  }

  const tabs = $previewTabs.get()
  const index = tabs.findIndex(tab => tab.id === tabId)

  if (index === -1) {
    return
  }

  const tab = tabs[index]
  const nextTitle = title?.trim()

  if (tab.target.kind !== 'url' || (tab.target.url === nextUrl && (!nextTitle || tab.target.label === nextTitle))) {
    return
  }

  $previewTabs.set(
    tabs.map((item, i) =>
      i === index
        ? {
            ...item,
            target: {
              ...item.target,
              ...(nextTitle ? { label: nextTitle } : {}),
              url: nextUrl
            }
          }
        : item
    )
  )
}

/** Pull one tab out of shared storage into this renderer's view. Two callers,
 *  two shapes (#119850):
 *
 *  - The docked mirror when a pop-out closes (`onBrowserPopoutClosed`): the
 *    tab is already in this view, so adopt the newer URL/label the sibling
 *    window committed — every bucket is fair game, because the sibling writes
 *    through its own scoped view, which is not necessarily this one.
 *  - A fresh pop-out renderer (`PreviewTilePane` in `?win=browser`): no
 *    session ever pushes a scope there, so the scoped view starts empty. Find
 *    the bucket that owns the tab and re-home the view onto it. Re-homing
 *    rather than splicing the tab into the current bucket keeps this window's
 *    later writes (address-bar navigation) in the OWNER's bucket — a splice
 *    would duplicate the tab into the primary profile's rail.
 *
 *  Reads every profile bucket plus the pre-scoping single-array shape. */
export function adoptPersistedBrowserTab(tabId: string) {
  if (!tabId) {
    return
  }

  try {
    const stored = readJson<unknown>(TABS_STORAGE_KEY)

    if (!stored) {
      return
    }

    const buckets: Array<[string, PreviewTab[]]> = Array.isArray(stored)
      ? [['default', parseTabList(stored)]]
      : Object.entries(stored as Record<string, unknown>).map(
          ([key, value]) => [normalizeProfileKey(key), parseTabList(value)] as [string, PreviewTab[]]
        )

    if ($previewTabs.get().some(tab => tab.id === tabId)) {
      const persisted = buckets.flatMap(([, tabs]) => tabs).find(tab => tab.id === tabId)

      if (persisted?.target.kind === 'url') {
        commitBrowserTabLocation(tabId, persisted.target.url, persisted.target.label)
      }

      return
    }

    for (const [key, tabs] of buckets) {
      if (tabs.some(tab => tab.id === tabId)) {
        applyPreviewScope(key || 'default')

        return
      }
    }
  } catch {
    // Storage can throw; the in-memory tab stays as it was.
  }
}

/** Pop the in-app Browser into its own OS window. Shared by the address-bar
 *  glyph and the tab context menu so they cannot drift. */
export function popOutBrowserTab(tabId: string) {
  if (!tabId || !canOpenBrowserWindow()) {
    return
  }

  const tab = $previewTabs.get().find(item => item.id === tabId)

  if (!tab || tab.target.kind !== 'url') {
    return
  }

  const page = $browserPages.get()[tabId]

  markBrowserTabPopped(tabId, true)
  commitBrowserTabLocation(tabId, page?.url || tab.target.url, page?.title)
  void openBrowserInNewWindow(tabId).then(ok => {
    if (!ok) {
      markBrowserTabPopped(tabId, false)
    }
  })
}

/** Tabs currently shown in a popped-out Browser window. The docked tree
 *  hides them so the page isn't in two places; closing the window docks
 *  them again. Memory-only — a relaunch with no pop-out window restores. */
export const $poppedBrowserTabIds = atom<ReadonlySet<string>>(new Set())

export function markBrowserTabPopped(tabId: string, popped: boolean) {
  setMembership($poppedBrowserTabIds, tabId, popped)
}

/** WHOSE browser the rail is showing — the conversation the tabs belong to.
 *
 *  Lives here, with the rail it describes; `session-states` owns the RULE for
 *  moving it, because that rule is about panes and focus. Keeping the atom on
 *  this side of the line means the preview store still knows nothing about
 *  sessions, which is what lets it be mocked and tested on its own. */
export const $browserSessionId = atom<null | string>(null)

/**
 * The conversation that does not have a runtime id yet.
 *
 * A new chat has no runtime session until its first turn creates one — the
 * chat view says so itself ("The global atoms stay the DRAFT surface"). Every
 * door into the browser was keyed on that id: `toggleEmbeddedBrowser` returns
 * early on a null session, and the panel is mounted only when one exists. So
 * on an empty conversation the globe was a no-op, which is the whole of "ما
 * بقدر افتح المتصفح إذا كانت المحادثة فارغة".
 *
 * This is a STAND-IN for the runtime id, not a second identity: one tab list,
 * one `owner` field, and `adoptBrowserSessionKey` rewrites it in place the
 * moment the real id lands. Rewriting an owner never removes a tab, so no pane
 * is torn down and no live page is lost — the failure mode that killed the
 * session-keyed registry in `96999b116`.
 *
 * Only the PRIMARY surface can be a draft (tiles are bound to a runtime id
 * before they render), so one sentinel per renderer is enough.
 */
export const DRAFT_BROWSER_SESSION_ID = 'draft:new-chat'

/**
 * A conversation that EXISTS but whose runtime has not bound yet.
 *
 * The middle rung, and its absence is what put an uncloseable browser on
 * screen. There are three binding states, not two: a live runtime, a stored
 * conversation waiting for one (a chat you reopened, anything before its first
 * turn resolves), and a genuine new chat. Collapsing the middle one into the
 * draft made every unbound conversation answer to the SAME key, so a browser
 * opened in one appeared in the next, and collapsing it into `null` on the
 * other side left the globe with nothing to toggle. Both happened at once:
 * the panel mounted under the draft key while the globe resolved to null, and
 * no gesture could reach the panel that was on screen.
 *
 * Provisional, like the draft: `adoptBrowserSessionKey` rewrites it to the
 * runtime id the moment one binds, in place, so no tab leaves the list and no
 * live page is torn down.
 */
const STORED_BROWSER_KEY_PREFIX = 'stored:'

export function storedBrowserSessionKey(storedSessionId: string): string {
  return `${STORED_BROWSER_KEY_PREFIX}${storedSessionId}`
}

/** The stored session id a `stored:` key names, else null. The ONE decoder:
 *  every consumer that needs to know what a key is goes through this or
 *  `isProvisionalBrowserKey`, so the encoding lives in one place. */
export function storedIdFromBrowserKey(key: null | string): null | string {
  return key?.startsWith(STORED_BROWSER_KEY_PREFIX) ? key.slice(STORED_BROWSER_KEY_PREFIX.length) : null
}

/** Is this key a stand-in rather than a runtime id? */
export function isProvisionalBrowserKey(key: null | string): key is string {
  return key === DRAFT_BROWSER_SESSION_ID || storedIdFromBrowserKey(key) !== null
}

/** The browser key for a surface in ANY binding state.
 *
 *  ONE function for every consumer. The panel's mount key and the key the
 *  globe toggles are the same question, and they were two expressions in two
 *  files; they disagreed in the middle state above, which is a drift only a
 *  test over all three states can catch (`browser-session-key.test.ts`). */
export function browserSessionKey(runtimeId: null | string, storedSessionId: null | string = null): string {
  if (runtimeId) {
    return runtimeId
  }

  return storedSessionId ? storedBrowserSessionKey(storedSessionId) : DRAFT_BROWSER_SESSION_ID
}

/** The STORED session id a browser key claims, when it names one.
 *
 *  Runtime ids are resolved through `storedSessionResolver`; the preview store
 *  cannot import `session-states` (that module imports this one), so the
 *  lookup is injected rather than reached for. */
let storedSessionResolver: (runtimeId: string) => null | string = () => null

/** Wired once by `session-states`, which owns the runtime-to-stored map. */
export function setStoredSessionResolver(resolve: (runtimeId: string) => null | string): void {
  storedSessionResolver = resolve
}

/**
 * The restart-durable half of an ownership claim, for any browser key.
 *
 * `owner` is a runtime id and the encoder strips it, so `ownerKey` is the ONLY
 * claim that can survive a restart. It used to be stamped by exactly one
 * caller, the agent's tool-result path, which meant every tab a PERSON opened
 * came back from storage owned by nobody. Unowned is everyone's by design, so
 * on the next launch those tabs appeared in every conversation at once. That
 * is the reported "no state is saved": the restore side was right all along
 * and the write side never filled the field.
 */
function ownerKeyFor(sessionId: null | string): string | undefined {
  if (!sessionId || sessionId === DRAFT_BROWSER_SESSION_ID) {
    return undefined
  }

  return storedIdFromBrowserKey(sessionId) ?? storedSessionResolver(sessionId) ?? undefined
}

/** Is this tab part of the browser the conversation `sessionId` is showing?
 *
 *  UNOWNED TABS ALWAYS ARE, and that arm is not a nicety — it is the whole
 *  reason the last attempt at scoping this pane broke. Filtering the mirror by
 *  workspace mode once dropped the pane out of Bot Mode entirely, so
 *  `openPreview` ran and a clicked link looked like a no-op (see the note on
 *  `watchPreviewTileMirror`). Everything a person opens themselves — a file
 *  from the tree, an artifact card, a link in any chat — is unowned and belongs
 *  to no conversation, so it stays visible from all of them. Only an agent's
 *  own browser tabs are scoped, which is exactly what "this chat's browser"
 *  means. */
export function previewTabBelongsToSession(
  tab: PreviewTab,
  sessionId: null | string,
  storedSessionId?: null | string
): boolean {
  // Pins are the explicit cross-session workspace.
  if (tab.pinned) {
    return true
  }

  // A live agent tab answers to the exact conversation that opened it.
  if (tab.owner) {
    return !sessionId || tab.owner === sessionId
  }

  // A RESTORED tab has only its durable claim: its runtime died with the last
  // run. Matching the conversation's stored id is what keeps a browser with its
  // own chat across a restart instead of spilling into all of them.
  const durable = tab.ownerKey ?? tab.sessionId

  if (durable) {
    const stored = storedSessionId ?? (sessionId ? ownerKeyFor(sessionId) : undefined)

    return !sessionId || (Boolean(stored) && currentSessionId(durable) === currentSessionId(stored))
  }

  // No conversation established yet (first paint, a window with no chat
  // focused), or a tab nobody owns: show it. An empty rail is a worse answer
  // than an unscoped one, and this is the state the Bot Mode regression lived in.
  return true
}

// ── The embedded browser — the conversation's browser docked INSIDE its chat
//    column (a bordered panel above the transcript) instead of the layout
//    strip. Same engine, same store, same per-session ownership as the strip's
//    panes; only the home differs. The panel mounts the tab's PreviewPane, and
//    `$dockedPreviewTabs` drops the focused conversation's embedded tabs from
//    the mirror, so a page is never live in two places at once.
//
//    Membership (mounted) and expansion (visible vs parked) are separate sets:
//    collapsing hides the panel without unmounting it, so the page — and the
//    agent mid-drive — survives the toggle. Both are memory-only on purpose:
//    they key runtime session ids, and an embed that outlived its conversation
//    would strand its tabs out of the strip forever.

/** Add/remove one id in a set atom, in place of the `set(get(), …)` triple at
 *  every call site. Returns the SAME set when nothing changed, so a no-op write
 *  notifies nobody. */
const setMembership = (store: WritableAtom<ReadonlySet<string>>, id: string, member: boolean): void => {
  const current = store.get()

  if (current.has(id) === member) {
    return
  }

  const next = new Set(current)

  if (member) {
    next.add(id)
  } else {
    next.delete(id)
  }

  store.set(next)
}

/** Conversations whose browser lives in their chat column. */
export const $embeddedBrowserSessions = atom<ReadonlySet<string>>(new Set())

/**
 * The ONE surface that renders each embedded conversation's browser, per key.
 *
 * Every chat surface hosts its own browser, tiles included, so the same stored
 * conversation can be on screen twice; two panels rendering one tab is one page
 * in two live guests. The first surface to claim a key renders it, every other
 * claimant mounts nothing, and the lead passes on when it unmounts.
 *
 * A key with a lead is a HOSTED conversation: one with a panel rendered and
 * able to hold a page. Not the same question as `$embeddedBrowserSessions`, which says a browser was
 * asked for. This says there is somewhere to put it. Without the distinction,
 * asking a surface that has no panel to embed mints a tab, drops it out of
 * `$dockedPreviewTabs` (the focused conversation's tabs are hidden from the
 * strip precisely so the panel can own them), and hosts it nowhere — a tab that
 * exists, is not in the strip, and has no panel. A black hole, not an error.
 *
 * Registered by the panel itself for as long as it is in the tree, so the store
 * never has to guess which surfaces exist.
 */
export const $embeddedBrowserLeadHosts = atom<ReadonlyMap<string, string>>(new Map())

/** Hosted means "has a lead": derived, so the two can never disagree. */
export const $embeddedBrowserHosts = computed($embeddedBrowserLeadHosts, leads => new Set(leads.keys()))

/** Which mounted SURFACES claim each session, in claim order. Membership
 *  alone cannot answer "is there still one left": two surfaces can resolve to
 *  the same key (a conversation shown as a tile and as the primary, a remount
 *  that overlaps its own unmount), and with a bare Set the FIRST to leave
 *  cleared the flag while a live panel was still rendering, after which the
 *  globe believed there was nowhere to embed and opened a strip tab instead.
 *
 *  ONE claim per surface. A handover (`adoptBrowserSessionKey`) carries a
 *  surface's claim to the runtime key BEFORE that surface re-renders and
 *  registers under it; a second entry would outlive the panel and hold the key
 *  hosted with nothing rendering it. React runs an effect's cleanup before its
 *  re-run, so the same surface never legitimately holds two. */
const hostClaims = new Map<string, string[]>()

function addHostClaim(sessionId: string, surfaceId: string): void {
  const claims = hostClaims.get(sessionId) ?? []

  if (!claims.includes(surfaceId)) {
    hostClaims.set(sessionId, [...claims, surfaceId])
  }
}

/** The first claimant leads; publish only when that changed. */
function publishLeadHost(sessionId: string): void {
  const lead = hostClaims.get(sessionId)?.[0]
  const current = $embeddedBrowserLeadHosts.get()

  if (current.get(sessionId) === lead) {
    return
  }

  const next = new Map(current)

  if (lead) {
    next.set(sessionId, lead)
  } else {
    next.delete(sessionId)
  }

  $embeddedBrowserLeadHosts.set(next)
}

/** Called by the panel on mount; the returned function unregisters. Idempotent
 *  per registration: calling the returned function twice releases one claim.
 *  `surfaceId` names the mounted surface so the lead can be chosen. */
export function registerEmbeddedBrowserHost(sessionId: string, surfaceId: string): () => void {
  addHostClaim(sessionId, surfaceId)
  publishLeadHost(sessionId)

  let released = false

  return () => {
    if (released) {
      return
    }

    released = true

    const remaining = (hostClaims.get(sessionId) ?? []).filter(claim => claim !== surfaceId)

    if (remaining.length > 0) {
      hostClaims.set(sessionId, remaining)
    } else {
      hostClaims.delete(sessionId)
    }

    publishLeadHost(sessionId)
  }
}

/** Tests only: drop every claim, so a case starts with no surfaces mounted.
 *  Clearing the atom alone would leave the counts behind and the next
 *  registration would believe a surface it cannot see is still there. */
export function resetEmbeddedBrowserHosts(): void {
  hostClaims.clear()
  $embeddedBrowserLeadHosts.set(new Map())
}

/** The subset whose panel is expanded (visible) rather than parked. */
export const $embeddedBrowserExpanded = atom<ReadonlySet<string>>(new Set())

/** Mount/unmount the embedded panel for a conversation. Unmounting also
 *  collapses it — a panel cannot be visible while it does not exist. */
export function setEmbeddedBrowserSession(sessionId: string, embedded: boolean): void {
  setMembership($embeddedBrowserSessions, sessionId, embedded)

  if (!embedded) {
    setMembership($embeddedBrowserExpanded, sessionId, false)
  }
}

/** The globe button in the composer, as a toggle:
 *
 *  1. not mounted → mount + expand, and make sure a Browser tab exists and is
 *     fronted (the same route the old open-only button took);
 *  2. mounted + expanded → collapse (parked, page stays alive);
 *  3. mounted + collapsed → expand again.
 *
 *  No path here tears the page down: mounting fronts a tab, collapsing only
 *  hides. Teardown belongs to closing tabs or ending the conversation. */
export function toggleEmbeddedBrowser(sessionId: null | string = $browserSessionId.get()): void {
  // A draft conversation is still a conversation, and it arrives here already
  // carrying DRAFT_BROWSER_SESSION_ID — the focus sync decides that, because it
  // is the only place that can tell a draft from a conversation whose runtime
  // has not resolved yet. Null here is the second case, and it has no browser
  // of its own to toggle: the strip is the honest answer, not the draft's panel.
  const key = sessionId

  // No panel to embed into (a surface that renders no chat column, or a
  // conversation not on screen): open the page in the strip instead of minting
  // a tab that nothing can host. See $embeddedBrowserHosts.
  if (!key || !$embeddedBrowserHosts.get().has(key)) {
    openBrowserTab(sessionId)

    return
  }

  if (!$embeddedBrowserSessions.get().has(key)) {
    openBrowserTab(key, { ownedOnly: true })
    setEmbeddedBrowserSession(key, true)
    setMembership($embeddedBrowserExpanded, key, true)

    return
  }

  setMembership($embeddedBrowserExpanded, key, !$embeddedBrowserExpanded.get().has(key))
}

/**
 * A PROVISIONAL browser becomes the real session's browser.
 *
 * Called when a runtime id binds under a stand-in key: a new chat's first turn
 * (`draft:new-chat`), or a conversation that existed before its runtime did
 * (`stored:<id>`). Everything already opened, tabs, the mounted panel, whether
 * it was expanded, moves to the real id by REWRITING the owner, never by
 * closing and reopening: a tab that leaves `$previewTabs` takes its pane and
 * its live page with it.
 *
 * A no-op when the stand-in owns nothing, which is the common case.
 */
export function adoptBrowserSessionKey(
  fromKey: null | string,
  runtimeId: null | string,
  storedSessionId: null | string = null
): void {
  if (!runtimeId || !isProvisionalBrowserKey(fromKey) || fromKey === runtimeId) {
    return
  }

  const from = fromKey

  // Cheap and exact: this fires on every runtime bind and every focus change,
  // so the common case must cost the O(1) lookups and leave before the scan.
  // The order below is load-bearing and every execution of it is a chance to
  // get it wrong; the ones that have nothing to move should never reach it.
  const ownsTabs =
    $embeddedBrowserSessions.get().has(from) ||
    $browserSessionId.get() === from ||
    hostClaims.has(from) ||
    $previewTabs.get().some(tab => tab.owner === from)

  if (!ownsTabs) {
    return
  }

  // ORDER MATTERS, and getting it wrong destroys the page.
  //
  // `$dockedPreviewTabs` drops a tab whose owner is the focused conversation
  // AND whose conversation is embedded; a tab that leaves that list is answered
  // by `removeTreePane`, which tears down the pane and the live guest inside
  // it. Rewriting `$previewTabs` FIRST publishes exactly one intermediate state
  // — owned by the runtime id, not yet marked embedded — in which the tab is
  // back in the mirror. The mirror registers a pane for it, the next write
  // drops it again, and the page the user just loaded is gone.
  //
  // So: move the MEMBERSHIP first, rewrite the owners last. Every intermediate
  // state then has the tab either owned by the draft (invisible to the runtime
  // session's filter) or already embedded.
  const wasEmbedded = $embeddedBrowserSessions.get().has(from)

  // The HOST moves first of all. The strip keeps a tab only while nothing
  // hosts it, and the panel re-registers under the runtime key on a React
  // render that lands AFTER this function returns. Membership moved without the
  // host is one published state in which the tab is embedded, unhosted, and
  // therefore back in the strip: a pane is registered and torn down again on
  // the next write, and the live guest goes with it.
  const claims = hostClaims.get(from)

  if (claims) {
    for (const claim of claims) {
      addHostClaim(runtimeId, claim)
    }

    hostClaims.delete(from)
    publishLeadHost(runtimeId)
  }

  if (wasEmbedded) {
    const wasExpanded = $embeddedBrowserExpanded.get().has(from)

    setEmbeddedBrowserSession(runtimeId, true)
    setMembership($embeddedBrowserExpanded, runtimeId, wasExpanded)
  }

  if ($browserSessionId.get() === from) {
    $browserSessionId.set(runtimeId)
  }

  const tabs = $previewTabs.get()

  if (tabs.some(tab => tab.owner === from)) {
    // The durable half is stamped HERE too, not just at open: a tab opened in a
    // conversation that had no stored id yet has nothing to claim with until
    // this moment, and leaving it blank is the same as never writing it.
    // Told, not looked up, wherever the caller already knows. The create path
    // knows the stored id it just minted; asking the resolver there would make
    // the durable claim depend on when the runtime-to-stored map happens to be
    // published, and a claim that is written late enough is never written.
    const ownerKey = storedSessionId ?? ownerKeyFor(runtimeId)

    $previewTabs.set(
      // Never DOWN to undefined: a tab that already carries a claim keeps it if
      // the resolver cannot answer yet. Adoption is a handover, not a reset.
      // `sessionId` is the same claim in the drawer's own terms (what
      // `$visiblePreviewTabs` filters on), stamped alongside it.
      tabs.map(tab =>
        tab.owner === from
          ? {
              ...tab,
              owner: runtimeId,
              ownerKey: tab.ownerKey ?? ownerKey,
              sessionId: tab.sessionId ?? tab.ownerKey ?? ownerKey
            }
          : tab
      )
    )

    // Still no stored id: the drawer shows the tab to the runtime that opened
    // it until `adoptPendingRuntimeTabs` hands it over.
    for (const tab of tabs) {
      if (tab.owner === from && !tab.pinned && !tab.sessionId && !tab.ownerKey && !ownerKey) {
        setPendingRuntime(tab.id, runtimeId)
      }
    }
  }

  if (wasEmbedded) {
    setEmbeddedBrowserSession(from, false)
  }

  // The old key's lead goes LAST, after nothing is owned under it.
  if (claims) {
    publishLeadHost(from)
  }
}

/**
 * The draft was abandoned, so its browser is abandoned with it.
 *
 * `DRAFT_BROWSER_SESSION_ID` is one constant for the whole renderer, which is
 * enough only because one surface can be a draft at a time. It is NOT enough
 * across time: a draft that opened a browser and was then replaced by another
 * new chat left its panel and its page mounted under a key the next new chat
 * also answers to, so a conversation nobody had touched opened holding someone
 * else's page. Adoption releases the key when a draft BECOMES a session; this
 * is the other exit, and without it the key is only ever released by luck.
 *
 * Tabs are closed rather than orphaned: the conversation they belonged to never
 * existed, so there is nothing to go back to. Same reasoning as
 * `closeBrowserTabsForSession`, which is what a real conversation's ending
 * calls.
 */
export function releaseDraftBrowserSession(): void {
  closeBrowserTabsForSession(DRAFT_BROWSER_SESSION_ID)
}

/** The conversation ended — its browser ends with it. Closes every Browser tab
 *  the session owns (its own vessels; pages opened WITHOUT an owner are
 *  nobody's conversation and survive) and forgets the embedded state. */
export function closeBrowserTabsForSession(sessionId: null | string, storedSessionId: null | string = null): void {
  if (!sessionId && !storedSessionId) {
    return
  }

  for (const tab of $previewTabs.get()) {
    const owned = (sessionId && tab.owner === sessionId) || (storedSessionId && tab.ownerKey === storedSessionId)

    if (tab.target.kind === 'url' && owned) {
      closeRightRailTab(tab.id)
    }
  }

  if (sessionId) {
    setEmbeddedBrowserSession(sessionId, false)
  }
}

function dockable(
  tabs: PreviewTab[],
  popped: ReadonlySet<string>,
  embeddedSessions: ReadonlySet<string>,
  hosts: ReadonlySet<string>
): PreviewTab[] {
  const notPopped = popped.size === 0 ? tabs : tabs.filter(tab => !popped.has(tab.id))

  // A DRAFT conversation's tabs never belong to the strip, whatever else is
  // true. The draft key exists only for the primary chat column, so its panel
  // is the only surface that can host these, and making that structural is
  // what makes the handover safe in ANY order. Adoption and the focus sync
  // are separate writes; whichever lands first, a draft-owned tab that were
  // merely unfiltered here would re-enter the strip for that beat, register
  // a pane, and lose it again to `removeTreePane` on the next write, taking
  // the live guest with it. Excluded by ownership, there is no such beat to
  // get right.
  //
  // The `.some()` first is the identity short-circuit `notPopped` uses one
  // line up: this computed feeds `paneMirror.sync()`, and nanostores skips
  // notifying when the value is reference-equal, so a fresh array on every
  // unrelated recompute would re-run that whole sync for no change.
  const notDraft = notPopped.some(tab => tab.owner === DRAFT_BROWSER_SESSION_ID)
    ? notPopped.filter(tab => tab.owner !== DRAFT_BROWSER_SESSION_ID)
    : notPopped

  if (embeddedSessions.size === 0) {
    return notDraft
  }

  // A conversation whose browser is embedded AND has a panel mounted to
  // render it hosts its own browser tabs in its chat column, so they leave
  // the strip. Keyed on HOSTED, not on the focused conversation: every chat
  // surface carries its own panel now, and a tile behind another tab keeps
  // its panel mounted, so its page has a home whether or not it is the one
  // on screen. Keying on focus was right when only the primary column could
  // host, and it is what put every other chat's browser in the strip beside
  // the conversation instead of inside it.
  //
  // When the LAST panel for a conversation unmounts (its tile closed, the
  // primary navigated away) the tab returns here, so the strip keeps the
  // page alive for the agent still driving it rather than leaving a tab that
  // exists, is in no strip, and has no panel.
  //
  // Exactly one panel renders a hosted key, see `$embeddedBrowserLeadHosts`;
  // otherwise a conversation on screen twice would run its page in two
  // guests.
  return notDraft.filter(tab => {
    if (tab.target.kind !== 'url' || !tab.owner) {
      return true
    }

    return !(embeddedSessions.has(tab.owner) && hosts.has(tab.owner))
  })
}

/** Preview tabs that still belong in the layout tree (not popped out, and not
 *  hosted by the focused conversation's embedded panel).
 *
 *  NOT scoped to a conversation otherwise, deliberately. This is what the pane
 *  mirror registers from, and dropping a tab out of it calls `removeTreePane`
 *  — which destroys the pane and the live page inside it. Scoping it beyond
 *  the focused-embedded case would mean that glancing at another chat tore
 *  down the page the first chat's agent was in the middle of driving, losing
 *  its scroll, its form, its login, and then reloading it on the way back.
 *  Every other preview tab therefore stays registered; which ones the STRIP
 *  shows is a visibility question, answered by hiding panes
 *  (`syncBrowserSessionPanes`), which keeps them mounted. */
export const $dockedPreviewTabs = computed(
  [$previewTabs, $poppedBrowserTabIds, $embeddedBrowserSessions, $embeddedBrowserHosts],
  dockable
)

/** The FOCUSED session's tabs that still belong in the docked layout tree —
 *  the layout-tree mirror renders only these (#73890): switching sessions
 *  swaps the drawer, and a popped-out Browser pane stays out. A conversation's
 *  hosted embedded browser keeps its tabs out of here too (see `dockable`), so
 *  a page is never live in two places at once. */
export const $dockedVisiblePreviewTabs = computed(
  [$visiblePreviewTabs, $poppedBrowserTabIds, $embeddedBrowserSessions, $embeddedBrowserHosts],
  dockable
)

export const $previewReloadRequest = atom(0)
export const $previewServerRestart = atom<PreviewServerRestart | null>(null)
export const $previewServerRestartStatus = computed($previewServerRestart, restart => restart?.status ?? 'idle')

/** The tab that owns `target`. Files and artifacts are keyed by IDENTITY —
 *  the same file is always the same tab, reopening it re-fronts the one it
 *  already has. A URL has no identity here: a Browser tab is a vessel you
 *  navigate, so it is picked (`browserTabId`) rather than derived.
 *
 *  A FILE tab is additionally owned by a session — the same file opened in
 *  two conversations is two tabs (#73890) — so a session-owned file tab's id
 *  carries the owner it was opened by. The id is identity only: lookups match
 *  a file by its canonical path and owner (`fileTabFor`), so an id never needs
 *  rekeying when the owner changes (draft adoption, compression rotation). */
export function previewTabId(target: PreviewTarget, sessionId?: null | string): RightRailTabId {
  if (target.kind === 'file' && sessionId) {
    return `file:${sessionId}:${target.url}`
  }

  return `${target.kind}:${target.url}`
}

/** A file's identity independent of entry point: a `file://` URL and a plain
 *  path name the same file. */
function canonicalFileKey(target: Pick<PreviewTarget, 'path' | 'url'>): string {
  return (target.path || target.url).replace(/^file:\/\//, '')
}

/** The tab already showing `target`'s file in `tabs` (a session's visible set). */
function fileTabFor(tabs: readonly PreviewTab[], target: PreviewTarget): PreviewTab | undefined {
  const key = canonicalFileKey(target)

  return tabs.find(tab => tab.target.kind === 'file' && canonicalFileKey(tab.target) === key)
}

/** `base`, suffixed until no tab holds it: a file's owner-derived id can be
 *  taken by a same-path tab whose owner later changed. */
function unusedTabId(base: RightRailTabId, tabs: readonly PreviewTab[]): RightRailTabId {
  let id = base

  for (let n = 2; tabs.some(tab => tab.id === id); n++) {
    id = `${base}#${n}` as RightRailTabId
  }

  return id
}

const isBrowserTab = (tab: PreviewTab): boolean => tab.target.kind === 'url'

/** A Browser tab's id, minted the way a terminal's is — there is no identity to
 *  derive one from. Random rather than the lowest free slot: an id is never
 *  handed out twice, so per-tab state keyed by it (`$browserPages`, the console
 *  buffer) cannot resurface under a later tab if a close ever fails to wipe it. */
function mintBrowserTabId(): RightRailTabId {
  const unique =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return `url:browser-${unique}`
}

/** The Browser a URL should open in: the one you're looking at, else the one
 *  you used last. A link from chat navigates the browser you already have
 *  rather than stacking another identical tab — new tabs are something you
 *  ask for (the strip's "+"), the way they are in a real browser. `tabs` is
 *  the opening session's visible set: another session's Browser is never
 *  taken over.
 *
 *  THE AGENT IS NOT YOU. Re-using "the tab you're looking at" is right for a
 *  link you clicked and wrong for a tool call: it silently replaced the page
 *  the person was reading with wherever the agent went next (#93190). So an
 *  agent open resolves against the agent's OWN tab (`agentBrowserTabFor`) and
 *  mints one when it has none; it browses beside you rather than over you. */
function browserTabFor(tabs: readonly PreviewTab[]): PreviewTab | undefined {
  const active = tabs.find(tab => tab.id === $rightRailActiveTabId.get())

  return active && isBrowserTab(active) ? active : tabs.findLast(isBrowserTab)
}

/** The tab an agent's tool call opens a page in: its OWN tab, per SESSION.
 *
 *  Both lookups used to match any agent tab, so the second conversation to open
 *  a page inherited the first one's tab, and because a browser tab id once
 *  derived from the url, two chats opening the SAME address collided by
 *  construction. Scoped to `agentSession`, a session with no tab of its own
 *  mints one, which is what makes two conversations two browsers.
 *
 *  Opening a page one of its own tabs already shows means "go back to that
 *  one": the only way the agent can re-target a tab, and the reason `new_tab`
 *  is no longer a one-way door. */
function agentBrowserTabFor(
  tabs: readonly PreviewTab[],
  url: string | undefined,
  agentSession: null | string
): PreviewTab | undefined {
  const holding = url ? tabs.find(tab => agentOwns(tab, agentSession) && tab.target.url === url) : undefined

  return holding ?? agentTab(tabs, agentSession)
}

function browserTabId(tabs: readonly PreviewTab[]): RightRailTabId {
  return browserTabFor(tabs)?.id ?? mintBrowserTabId()
}

/** HTML files open rendered unless the caller asks for a mode. A re-open keeps
 *  the mode the tab is already in, so refreshing the target never undoes a
 *  user's Source pick. */
function withRenderMode(target: PreviewTarget, existing?: PreviewTarget): PreviewTarget {
  if (target.kind !== 'file' || target.previewKind !== 'html' || target.renderMode) {
    return target
  }

  return { ...target, renderMode: existing?.renderMode ?? 'preview' }
}

/** An agent hand-over means "show the page": an HTML file opens rendered even
 *  when its tab is sitting in Source, unlike a re-open from the Files pane. */
export function renderedHtmlTarget(target: PreviewTarget): PreviewTarget {
  return target.kind === 'file' && target.previewKind === 'html' && !target.renderMode
    ? { ...target, renderMode: 'preview' }
    : target
}

/** Flip a tab between live Render and Source in place. Same tab id. */
export function setPreviewRenderMode(tabId: string, renderMode: PreviewRenderMode) {
  const current = $previewTabs.get()
  const index = current.findIndex(tab => tab.id === tabId)

  if (index === -1 || current[index]?.target.renderMode === renderMode) {
    return
  }

  $previewTabs.set(current.map((item, i) => (i === index ? { ...item, target: { ...item.target, renderMode } } : item)))
}

/** Open (or re-front) the tab for `target`. Re-opening an existing tab refreshes
 *  its target so a stale label/path can't outlive the thing it points at. The
 *  only way anything reaches a preview.
 *
 *  The tab belongs to a session, the stored id of the one that asked for it:
 *  `options.owner` when the caller knows better (an agent turn in a side tile),
 *  else the conversation behind `options.sessionId`, else the focused one.
 *  Reuse is decided among the tabs that owner can see (its own plus the pinned
 *  ones), so one session's open never takes over another session's tab; a
 *  reused tab keeps its owner and pin. Opening for a session that is not
 *  focused does not touch the focused drawer's selection: the tab is fronted
 *  when that session's drawer shows.
 *
 *  `options.sessionId` is the RUNTIME session (or provisional browser key) of
 *  the agent making a tool call. It decides which agent tab is "its own" and
 *  who the browser belongs to; `ownerKey` is the durable half of that claim. */
export interface OpenPreviewOptions {
  /** Open in a fresh Browser instead of re-using one. Only a browser. */
  newTab?: boolean
  ownerKey?: null | string
  /** Stored id of the session the tab belongs to; a stored id of `null` means
   *  a draft. Omitted = the conversation behind `sessionId`, else the focused one. */
  owner?: null | string
  /** The asking agent's profile, when it is not the chat on screen: only that
   *  profile's pins may be reused. Omitted = the viewed profile. */
  profile?: null | string
  /** Front the tab. A background conversation opening a page must not yank you
   *  off the page you are reading, so its caller says false. */
  reveal?: boolean
  /** The runtime asking: an ownerless tab is handed to it once its stored id
   *  binds. Omitted = the agent's own session, else the primary's runtime. */
  runtimeId?: null | string
  /** Runtime session id (or provisional browser key) of the asking agent. */
  sessionId?: null | string
}

const PREVIEW_RECORD_SOURCES: ReadonlySet<string> = new Set<PreviewRecordSource>([
  'explicit-link',
  'file-browser',
  'manual',
  'tool-result'
])

/** Two call shapes reach this one door, and both are kept so no caller has to
 *  change: `(target, source, options)` names HOW the open happened, and
 *  `(target, ownerStoredId, runtimeId, profile)` names WHO it is for. A stored
 *  session id is never one of the four source words, which is what tells them
 *  apart; `null` can only be the second shape (a draft's tabs). */
export function openPreview(target: PreviewTarget, source?: PreviewRecordSource, options?: OpenPreviewOptions): void
export function openPreview(
  target: PreviewTarget,
  owner: null | string,
  runtimeId?: null | string,
  profile?: null | string
): void
export function openPreview(
  target: PreviewTarget,
  second?: null | string,
  third?: null | OpenPreviewOptions | string,
  fourth?: null | string
): void {
  const positional = second === null || (typeof second === 'string' && !PREVIEW_RECORD_SOURCES.has(second))

  if (positional) {
    openPreviewWith(target, 'manual', { owner: second, profile: fourth, runtimeId: third as null | string | undefined })

    return
  }

  openPreviewWith(target, (second ?? 'manual') as PreviewRecordSource, (third as OpenPreviewOptions | undefined) ?? {})
}

function openPreviewWith(target: PreviewTarget, source: PreviewRecordSource, options: OpenPreviewOptions) {
  // A tool or an explicit link handing over an HTML file means "show the page",
  // even when its tab sits in Source; a re-open from the Files pane keeps the
  // tab's mode (see `withRenderMode`).
  const resolved = source === 'tool-result' || source === 'explicit-link' ? renderedHtmlTarget(target) : target
  const askingKey = options.sessionId ?? null
  const storedFromKey = askingKey ? (ownerKeyFor(askingKey) ?? null) : null

  const requestedOwner =
    options.owner !== undefined ? options.owner : askingKey ? storedFromKey : $focusedStoredSessionId.get()

  // Only a real runtime id can be handed an ownerless tab later; a provisional
  // key (the draft, a `stored:` stand-in) names no runtime.
  const runtimeId =
    options.runtimeId !== undefined
      ? options.runtimeId
      : askingKey
        ? isProvisionalBrowserKey(askingKey)
          ? null
          : askingKey
        : $activeSessionId.get()

  // Stamp the tip, not an alias: the alias map is memory-only, so a tab
  // stamped with a rotated-away id would be orphaned by the next relaunch.
  const owner = currentSessionId(requestedOwner)
  const current = $previewTabs.get()
  // `newTab` only means anything for a browser: file and artifact tabs are
  // addressed by their content, so a second tab on the same file would be the
  // same tab twice.
  const fresh = Boolean(options.newTab) && resolved.kind === 'url'

  // Reuse never crosses runtimes: with no stored id yet, the runtime decides
  // which ownerless tabs are this opener's (its own pending ones, or the
  // draft's when it is the draft on screen).
  const visible = bucketTabsFor(
    current,
    ownerIdentity({ profile: options.profile, runtimeId: owner === null ? runtimeId : null, sessionId: owner }),
    viewKey,
    viewKey
  )

  const existing = fresh
    ? undefined
    : resolved.kind === 'url'
      ? source === 'tool-result'
        ? agentBrowserTabFor(current, resolved.url, askingKey)
        : browserTabFor(visible)
      : resolved.kind === 'file'
        ? fileTabFor(visible, resolved)
        : current.find(tab => tab.id === previewTabId(resolved))

  const id =
    existing?.id ?? (resolved.kind === 'url' ? mintBrowserTabId() : unusedTabId(previewTabId(resolved, owner), current))

  // Ownership is the tab's, not the target's: it decides who may navigate this
  // tab later, so it has to outlive the open that created it. Sticky, because a
  // person opening a link in the agent's tab is visiting, not taking it over.
  const agentOwned = Boolean(existing?.agent || (resolved.kind === 'url' && source === 'tool-result'))
  // Which agent, not just "an agent". Sticky the same way: a person visiting
  // the tab does not re-assign it, and an existing owner is not displaced by a
  // later session.
  const agentSession = agentOwned ? (existing?.owner ?? askingKey ?? undefined) : undefined

  // Resolved here rather than only from `options`, which one caller passed and
  // every other left empty. A claim that exists only in memory is not a claim:
  // `owner` never reaches storage, so a tab whose `ownerKey` was skipped comes
  // back belonging to nobody. See `ownerKeyFor`.
  const ownerKey = agentOwned
    ? (existing?.ownerKey ?? options.ownerKey ?? ownerKeyFor(agentSession ?? askingKey) ?? undefined)
    : undefined

  const shown = withRenderMode(resolved, existing?.target)
  // An artifact is one tab per artifact; opening it from another session
  // re-owns it, or the session that just asked for it would not see it.
  const sessionId = (existing?.pinned ? existing.sessionId : (owner ?? ownerKey)) ?? undefined

  const tab: PreviewTab = {
    id,
    pinned: Boolean(existing?.pinned),
    sessionId,
    target: shown,
    ...(agentOwned ? { agent: true, owner: agentSession, ownerKey } : {})
  }

  if (agentOwned) {
    agentTabBySession.set(agentSession ?? UNSCOPED, id)
  }

  $previewTabs.set(existing ? current.map(item => (item === existing ? tab : item)) : [...current, tab])

  setPendingRuntime(id, tab.sessionId == null && !tab.pinned ? runtimeId : null)

  // Selecting is a claim on the rail, and the rail is one surface. A background
  // conversation opening a page must not yank you off the page you are reading;
  // a tab the focused drawer does not show is not fronted either, only
  // remembered for when that session's drawer shows.
  if (options.reveal === false || !$visiblePreviewTabs.get().some(item => item.id === id)) {
    rememberActiveTab(owner, id)

    return
  }

  noteExplicitPreviewOpen(id)
  selectRightRailTab(id)
}

const blankPage = (): PreviewTarget => ({ kind: 'url', label: 'Browser', source: 'about:blank', url: 'about:blank' })

/** Tombstone the tabs for a confirmed-missing file: keep them open this
 *  session (the pane shows "file no longer exists"), but flag the target so
 *  the next restore drops them instead of re-probing the dead path on every
 *  boot. Takes a tab id or the file's url/path; a file that is gone is gone
 *  for every session showing it. */
export function markPreviewTabMissing(tabIdOrUrl: string) {
  const current = $previewTabs.get()
  const key = canonicalFileKey({ url: tabIdOrUrl.replace(/^file:(?!\/\/)/, '') })

  const hit = (tab: PreviewTab) =>
    tab.target.kind === 'file' &&
    !tab.target.missing &&
    (tab.id === tabIdOrUrl || tab.target.url === tabIdOrUrl || canonicalFileKey(tab.target) === key)

  if (!current.some(hit)) {
    return
  }

  $previewTabs.set(current.map(tab => (hit(tab) ? { ...tab, target: { ...tab.target, missing: true } } : tab)))
}

/** Show the Browser — the surface, not a page. Keeps whatever it was last
 *  showing so the hotkey re-fronts your page instead of wiping it; with no
 *  browser open it lands on `about:blank`, where the pane's empty state
 *  invites an address. */
export function openBrowserTab(
  sessionId: null | string = $browserSessionId.get(),
  options: { ownedOnly?: boolean } = {}
) {
  // Point the rail at this conversation's browser BEFORE choosing a tab, or the
  // tab we front is one the strip is about to filter away.
  if (sessionId) {
    $browserSessionId.set(sessionId)
  }

  recordFeatureUse('browser_pane')

  const tabs = $previewTabs.get()

  // This conversation's own tab first, then any browser it can see (a page you
  // opened yourself is everyone's). Selected directly rather than routed back
  // through `openPreview`: re-deriving the target's tab there resolved against
  // the WHOLE list, so asking for an empty conversation's browser navigated
  // whichever tab happened to be active — another chat's page — to about:blank.
  //
  // `ownedOnly` turns the second half off, and the EMBEDDED path needs it: an
  // unowned page belongs to the strip and stays there, so adopting one into a
  // conversation's panel would put the same tab on screen twice, in two live
  // guests. The panel mints its own tab instead.
  const shared = options.ownedOnly
    ? undefined
    : tabs.filter(tab => previewTabBelongsToSession(tab, sessionId)).findLast(isBrowserTab)

  const current = agentTab(tabs, sessionId) ?? shared

  if (current) {
    noteExplicitPreviewOpen(current.id)
    selectRightRailTab(current.id)

    return
  }

  newBrowserTab(sessionId)
}

/** ⌘⇧L is a TOGGLE: show the Browser when it's away, fold it away when it's
 *  the thing on screen. "Away" includes dismissed (Close/⌘W), hidden, or
 *  parked behind a sibling tab — each re-opens through openBrowserTab's reveal
 *  path with the page it was last showing. "On screen" means the mirrored
 *  preview-tile pane the layout tree keeps is actually visible, i.e. not
 *  dismissed/hidden/minimized AND holding its zone's active slot. */
export function toggleBrowserTab() {
  const id = browserTabId($visiblePreviewTabs.get())

  if (isPaneVisible(`${PREVIEW_TILE_PREFIX}:${id}`)) {
    dismissTreePane(`${PREVIEW_TILE_PREFIX}:${id}`)

    return
  }

  openBrowserTab()
}

/** Another Browser, always — the strip's "+". It joins the browser you are
 *  looking at, which is a conversation's, so it belongs to that conversation
 *  rather than becoming a stray shared tab. */
export function newBrowserTab(sessionId: null | string = $browserSessionId.get()) {
  const id = mintBrowserTabId()
  const ownerKey = ownerKeyFor(sessionId)
  const owner = currentSessionId(ownerKey ?? (sessionId ? null : $focusedStoredSessionId.get())) ?? undefined

  recordFeatureUse('browser_pane')
  $previewTabs.set([
    ...$previewTabs.get(),
    // BOTH halves of the claim, as everywhere else. This path is the one a
    // person takes (the strip's "+", the panel's "+", the globe's first press),
    // and it was the one writing a runtime owner and nothing durable.
    {
      agent: true,
      id,
      owner: sessionId ?? undefined,
      ownerKey,
      pinned: false,
      sessionId: owner,
      target: blankPage()
    }
  ])
  // A conversation whose stored id has not arrived is visible to its runtime
  // until `adoptPendingRuntimeTabs` hands the tab over. A draft names no
  // runtime: ownerless and unpended is exactly the draft's.
  setPendingRuntime(id, owner === undefined && sessionId && !isProvisionalBrowserKey(sessionId) ? sessionId : null)
  noteExplicitPreviewOpen(id)
  selectRightRailTab(id)
}

/**
 * Everything a preview tab owns OUTSIDE `$previewTabs`, released together.
 *
 * Two module-level stores are keyed by tab id — the console buffer (up to
 * MAX_LOGS unbounded message strings) and the live page title — and neither is
 * reachable from the tab list, so a removal path that forgets either strands it
 * for the window's lifetime. This is a named primitive rather than a step
 * inside `closeRightRailTab` because the bulk closers below rewrite
 * `$previewTabs` wholesale and never call it: closing the rail, and the agent's
 * own `close_preview` tidy-up, are exactly the paths most likely to run
 * unattended and least likely to be noticed leaking.
 */
function forgetPreviewTab(tabId: string): void {
  forgetPreviewConsole(tabId)
  forgetBrowserPage(tabId)
}

/** Pin or unpin a preview tab. Pinned tabs render in EVERY session — the
 *  explicit cross-session workspace; unpinning returns it to its session
 *  (adopting the current one when the tab never had an owner). */
export function setPreviewTabPinned(tabId: string, pinned: boolean): void {
  const currentSession = currentSessionId($focusedStoredSessionId.get()) ?? undefined

  $previewTabs.set(
    $previewTabs
      .get()
      .map(tab =>
        tab.id === tabId ? { ...tab, pinned, sessionId: tab.sessionId ?? (pinned ? undefined : currentSession) } : tab
      )
  )
}

/** Drop the tabs a deleted session opened. Pinned tabs survive — they belong
 *  to the workspace, not the session that opened them. Every profile bucket,
 *  not just the view: a session can be deleted while another profile's chat
 *  is on screen, and its tabs live in its own profile's bucket. */
export function prunePreviewTabsForSession(sessionId: string): void {
  const doomed = currentSessionId(sessionId)
  const keep = (tab: PreviewTab) =>
    tab.pinned ||
    (currentSessionId(tab.sessionId) !== doomed && (tab.ownerKey == null || currentSessionId(tab.ownerKey) !== doomed))
  let backgroundChanged = false

  for (const [key, tabs] of Object.entries(tabsByProfile)) {
    if (key !== viewKey && !tabs.every(keep)) {
      tabsByProfile[key] = tabs.filter(keep)
      backgroundChanged = true
    }
  }

  if (backgroundChanged) {
    persistTabs()
    forgetGonePendingTabs()
  }

  $previewTabs.set($previewTabs.get().filter(keep))
}

export function closeRightRailTab(tabId: string) {
  // BEFORE the membership check, not after: both stores are keyed deletes, so
  // forgetting a tab that has already left the list is free — and callers that
  // reach here on a tab the list no longer holds (the pane mirror's closer,
  // which fires on teardown) are exactly the ones whose state would otherwise
  // be stranded with nobody left to release it.
  forgetPreviewTab(tabId)
  closeRightRailTabs(new Set([tabId]))
}

/** Close `tabIds` in one write, then re-home the selection once. */
function closeRightRailTabs(tabIds: ReadonlySet<string>) {
  const current = $previewTabs.get()

  if (!current.some(tab => tabIds.has(tab.id))) {
    return
  }

  const next = current.filter(tab => !tabIds.has(tab.id))
  // The neighbour comes from the focused drawer: a hidden session's tab
  // must not become the selection.
  const activeId = $rightRailActiveTabId.get()
  const visible = $visiblePreviewTabs.get()
  const visibleIndex = visible.findIndex(tab => tab.id === activeId)
  const remaining = visible.filter(tab => !tabIds.has(tab.id))

  for (const tabId of tabIds) {
    forgetPreviewTab(tabId)
  }

  $previewTabs.set(next)

  if (activeId && tabIds.has(activeId)) {
    const nextId = remaining[Math.min(Math.max(visibleIndex, 0), remaining.length - 1)]?.id ?? null

    if (nextId) {
      noteExplicitPreviewOpen(nextId)
    } else {
      clearExplicitPreviewOpen()
    }

    selectRightRailTab(nextId)
  }

  if (next.length === 0) {
    selectRightRailTab(null)
  }
}

/** Close the tab showing `source` in the CURRENT session, if one is open.
 *  Returns whether it closed. */
export function closePreviewForSource(source: string): boolean {
  return closePreviewMatching(source)
}

/** Close the first docked Browser tab whose current page URL matches.
 *  Browsers keep navigation state outside their persisted target so matching
 *  only target.url misses redirects and in-page navigation. */
export function closeBrowserPreviewMatchingLiveUrl(...candidates: string[]): boolean {
  return closeBrowserMatchingLiveUrlIn($visiblePreviewTabs.get(), candidates)
}

function closeBrowserMatchingLiveUrlIn(tabs: readonly PreviewTab[], candidates: string[]): boolean {
  const queries = new Set(
    candidates
      .map(value => {
        try {
          const url = new URL(value.trim())

          return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
        } catch {
          return ''
        }
      })
      .filter(Boolean)
  )

  if (queries.size === 0) {
    return false
  }

  const pages = $browserPages.get()
  const popped = $poppedBrowserTabIds.get()
  const activeId = $rightRailActiveTabId.get()
  const ordered = [...tabs.filter(tab => tab.id === activeId), ...tabs.filter(tab => tab.id !== activeId)]

  const tab = ordered.find(item => {
    if (item.target.kind !== 'url' || popped.has(item.id)) {
      return false
    }

    const liveUrl = pages[item.id]?.url

    if (!liveUrl) {
      return false
    }

    try {
      return queries.has(new URL(liveUrl).href)
    } catch {
      return false
    }
  })

  if (!tab) {
    return false
  }

  closeRightRailTab(tab.id)

  return true
}

function closePreviewMatchingTabs(tabs: readonly PreviewTab[], candidates: string[]): boolean {
  const queries = [...new Set(candidates.map(value => value.trim()).filter(Boolean))]

  if (queries.length === 0) {
    return false
  }

  const tab = tabs.find(item => {
    const fields = [item.target.source, item.target.url, item.target.label]

    return queries.some(query => fields.includes(query))
  })

  if (!tab) {
    return false
  }

  closeRightRailTab(tab.id)

  return true
}

/** The AGENT'S close of a NAMED tab: like `closePreviewMatching`, but the
 *  request came from a conversation. A named close ("close cnn.com") is the
 *  user's explicit instruction — it may close any matching tab, theirs
 *  included. What this path must never do is the BULK cleanup: the no-url
 *  close is `closeAgentPreviewTabs`, agent-owned tabs only. */
export function closeAgentPreviewTabMatching(sessionId: null | string, ...candidates: string[]): boolean {
  void sessionId

  return closePreviewMatchingTabs($previewTabs.get(), candidates)
}

/** Close the first tab whose source, url, or label matches any candidate.
 *  Empty candidates are a no-op so a missed match cannot wipe the rail —
 *  closing the whole pane is `closeRightRail`. */
export function closePreviewMatching(...candidates: string[]): boolean {
  return closePreviewMatchingTabs($visiblePreviewTabs.get(), candidates)
}

/** Agent-driven close is scoped to the docked rail; an independent Browser
 *  window owns popped tabs and must not lose its backing state here. */
export function closeDockedPreviewMatching(...candidates: string[]): boolean {
  return closePreviewMatchingTabs(dockedTabs($visiblePreviewTabs.get()), candidates)
}

function dockedTabs(tabs: readonly PreviewTab[]): PreviewTab[] {
  const popped = $poppedBrowserTabIds.get()

  return tabs.filter(tab => !popped.has(tab.id))
}

/** An agent's `close_preview` for the session that ran it (`owner`). With
 *  candidates it closes the first matching tab that session can see (live
 *  Browser page first, then source/url/label); without, it closes every tab
 *  that session owns. Never another session's tabs (another runtime's pending
 *  ones included), never another profile's pin, never a pin the agent did not
 *  name. */
export function closeAgentPreview(owner: PreviewOwner, candidates: string[]): void {
  const visible = bucketTabsFor($previewTabs.get(), ownerIdentity(owner), viewKey, viewKey)

  if (candidates.length > 0) {
    if (!closeBrowserMatchingLiveUrlIn(visible, candidates)) {
      closePreviewMatchingTabs(dockedTabs(visible), candidates)
    }

    return
  }

  closeRightRailTabs(new Set(visible.filter(tab => !tab.pinned).map(tab => tab.id)))
}

/** Artifact tabs can't outlive the registry they read from, so clearing it
 *  closes them. File and URL tabs re-read from their source and are left alone. */
export function closeArtifactPreviewTabs() {
  for (const tab of $previewTabs.get()) {
    if (tab.target.kind === 'artifact') {
      closeRightRailTab(tab.id)
    }
  }
}

/** Close every tab so the rail's panes leave the tree. */
export function closeRightRail() {
  clearExplicitPreviewOpen()
  for (const tab of $previewTabs.get()) {
    forgetPreviewTab(tab.id)
  }
  $previewTabs.set([])
  selectRightRailTab(null)
}

/** Close ONLY the agent tabs a session owns — the `close_preview` path when no
 *  url names a specific tab. The user's own pages are untouchable here: an
 *  agent "tidying up" at the end of a task used to take the whole rail with it.
 *  A session that owns nothing closes nothing. Returns how many tabs closed. */
export function closeAgentPreviewTabs(sessionId: null | string): number {
  const current = $previewTabs.get()
  const doomed = current.filter(tab => agentOwns(tab, sessionId))

  if (doomed.length === 0) {
    return 0
  }

  const doomedIds = new Set(doomed.map(tab => tab.id))
  const next = current.filter(tab => !doomedIds.has(tab.id))

  for (const id of doomedIds) {
    forgetPreviewTab(id)
  }

  $previewTabs.set(next)

  const active = $rightRailActiveTabId.get()

  if (active && doomedIds.has(active)) {
    selectRightRailTab(next[0]?.id ?? null)
  }

  for (const id of doomedIds) {
    agentTabBySession.delete(doomed.find(tab => tab.id === id)?.owner ?? UNSCOPED)
  }

  return doomed.length
}

export function requestPreviewReload() {
  $previewReloadRequest.set($previewReloadRequest.get() + 1)
}

export function beginPreviewServerRestart(taskId: string, url: string) {
  $previewServerRestart.set({ status: 'running', taskId, url })
}

export function completePreviewServerRestart(taskId: string, text: string) {
  const current = $previewServerRestart.get()

  if (current?.taskId !== taskId) {
    return
  }

  $previewServerRestart.set({
    ...current,
    message: text,
    status: normalize(text).startsWith('error:') ? 'error' : 'complete'
  })
}

export function progressPreviewServerRestart(taskId: string, text: string) {
  const current = $previewServerRestart.get()

  if (current?.taskId !== taskId || current.status !== 'running') {
    return
  }

  $previewServerRestart.set({
    ...current,
    message: text
  })
}

export function failPreviewServerRestart(taskId: string, message: string) {
  const current = $previewServerRestart.get()

  if (current?.taskId !== taskId || current.status !== 'running') {
    return
  }

  $previewServerRestart.set({
    ...current,
    message,
    status: 'error'
  })
}
