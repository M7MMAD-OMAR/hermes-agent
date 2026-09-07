# Browser session isolation: conflict map and plan

Two reported symptoms, two independent causes. Neither is a regression of the
five ownership scars documented in `store/preview.ts`; both are gaps those
scars never covered.

## Symptom 1: a browser panel appears in a conversation that never opened one,
## and the globe cannot close it

The same question, "which conversation is this browser's", is answered by two
different expressions that disagree in one reachable state.

| Consumer | Expression | Value when the primary shows a stored chat whose runtime has not bound |
|---|---|---|
| Panel MOUNT, `app/chat/index.tsx:449` | `browserSessionKey(activeSessionId)` | `draft:new-chat` (the fallback, because the runtime id is null) |
| Globe TOGGLE / ownership, `store/session-states.ts:2044` | `$focusedRuntimeId ?? (storedId ? null : DRAFT)` | `null` |

`toggleEmbeddedBrowser(null)` takes the "no key" arm and opens a tab in the
STRIP instead of collapsing the panel. The panel stays mounted under the draft
key with its own `about:blank` tab and its empty state on screen, and there is
no gesture that reaches it. That is the black uncloseable pane.

The same disagreement is why the panel appears unasked: `draft:new-chat` is one
renderer-global constant, so every surface with no bound runtime claims the same
browser. A browser opened while one chat was unbound is the browser every later
unbound chat mounts.

## Symptom 2: nothing survives a restart, and tabs show in every conversation

Read from the running app's own storage, `~/.config/Hermes/Local Storage`:

```json
[{"id":"url:browser-86c06249-...","target":{"kind":"url","label":"About Us | Khadamat",
  "source":"about:blank","url":"http://127.0.0.1:5178/khadamat/en/about/"}}]
```

No `ownerKey`. The string does not occur anywhere in that database.

`owner` is a runtime id and is deliberately stripped by the encoder, so
`ownerKey` is the only claim that can survive. It is written in exactly one
place, `app/session/hooks/use-preview-routing.ts:104`, the agent's tool-result
path. Every other creation path leaves it undefined:

- `newBrowserTab()` (the strip's "+", the embedded panel's "+", the globe's
  first press) writes `owner` and no `ownerKey`.
- `openPreview()` carries `options.ownerKey` through but only that one caller
  passes it.
- `adoptDraftBrowserSession()` rewrites `owner` onto the real runtime id and
  never stamps `ownerKey`, so even an agent tab born in a new chat loses its
  claim.

On restart every one of those tabs is unowned. Unowned means everyone's, by
design, so they appear in every conversation. That is scar 5's symptom arriving
through a door scar 5 never covered: it fixed RESTORE, and the gap is at WRITE.

## Symptom 3, found while tracing, not reported

`syncBrowserSessionPanes()` reads `$focusedStoredSessionId` but subscribes only
to `$browserSessionId` and `$previewTabs` (`app/chat/preview-tile.tsx:245`). The
stored id moves on its own, which `syncBrowserSession` already documents one
layer up. It also does not re-run when `$embeddedBrowserSessions` changes, so
hides are stale after a panel opens or closes.

## The plan

1. **One key function, every consumer.** `browserSessionKey(runtimeId, storedId)`
   gains the middle rung it is missing: runtime id, else `stored:<storedId>`,
   else the draft sentinel. `syncBrowserSession` returns the same expression
   instead of null. Mount and toggle then cannot disagree, whatever the binding
   state.
2. **Generalise adoption.** `adoptDraftBrowserSession(runtimeId)` becomes
   `adoptBrowserSessionKey(fromKey, runtimeId, storedId)`, keeping the existing
   order (membership first, owners last) that protects the live guest. Both
   provisional keys, `draft:` and `stored:`, hand over through it.
3. **Stamp `ownerKey` at every write, not one.** The store resolves it itself
   from the runtime id, through a resolver injected by `session-states` (a
   static import would be a cycle). `newBrowserTab`, `openPreview` and adoption
   all go through it.
4. **Subscribe the sync to everything it reads**: `$focusedStoredSessionId` and
   `$embeddedBrowserSessions`.

Ownership stays one field on one tab list. Nothing filters
`$dockedPreviewTabs` further, nothing keys on `$focusedRuntimeId`, unowned tabs
stay everyone's, and both halves of the claim keep their existing roles.
