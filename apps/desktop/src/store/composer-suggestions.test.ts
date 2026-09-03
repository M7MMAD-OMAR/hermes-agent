import { describe, expect, it } from 'vitest'

import {
  $composerSuggestionsBySession,
  type ComposerSuggestion,
  forgetSessionSuggestions,
  markSuggestionInvoked,
  offerSuggestions,
  resetComposerSuggestions,
  suggestionKey
} from './composer-suggestions'

const suggestion = (id: string, provider = 'test'): ComposerSuggestion => ({
  doneLabel: 'done',
  doneTip: 'done',
  id,
  invoke: async () => {},
  label: id,
  provider,
  tip: 'because',
  workingLabel: 'working',
  workingTip: 'working'
})

const pillsFor = (sessionId: string) => ($composerSuggestionsBySession.get()[sessionId] ?? []).map(s => s.id)

describe('composer suggestion bus', () => {
  it('publishes event offerings per session and withdraws on empty offer', () => {
    offerSuggestions('s1', 'test', [suggestion('a')])

    expect(pillsFor('s1')).toEqual(['a'])
    expect(pillsFor('s2')).toEqual([])

    offerSuggestions('s1', 'test', [])

    expect(pillsFor('s1')).toEqual([])
  })

  it('caps merged suggestions at two', () => {
    offerSuggestions('s3', 'test', [suggestion('a'), suggestion('b'), suggestion('c')])

    expect(pillsFor('s3')).toHaveLength(2)

    offerSuggestions('s3', 'test', [])
  })

  it('never strikes a suggestion the cap evicted while it was still offered', () => {
    // `capped` is painted, then repeatedly pushed off the strip by a
    // higher-ranked provider that grows and shrinks. Event offerings flatten
    // in Map insertion order, so provider 'a' always outranks 'b'.
    const squeeze = () => {
      offerSuggestions('cap1', 'a', [suggestion('hog', 'a'), suggestion('keeper', 'a')])
      offerSuggestions('cap1', 'a', [suggestion('hog', 'a')])
    }

    offerSuggestions('cap1', 'a', [suggestion('hog', 'a')])
    offerSuggestions('cap1', 'b', [suggestion('capped', 'b')])

    expect(pillsFor('cap1')).toEqual(['hog', 'capped'])

    // Four evictions — past IGNORED_LIMIT. Losing the slot race is not a
    // decision the user made, so none of them may count against `capped`.
    for (let i = 0; i < 4; i += 1) {
      squeeze()
    }

    expect(pillsFor('cap1')).toEqual(['hog', 'capped'])

    offerSuggestions('cap1', 'a', [])
    offerSuggestions('cap1', 'b', [])
  })

  it('still strikes a painted suggestion that the cap later hides', () => {
    // `solo` is painted, so the user saw it. It then loses the slots and is
    // withdrawn by its own provider — that is a genuine ignored offer.
    for (let i = 0; i < 3; i += 1) {
      offerSuggestions('cap2', 'b', [suggestion('solo', 'b')])
      offerSuggestions('cap2', 'b', [])
    }

    offerSuggestions('cap2', 'b', [suggestion('solo', 'b')])

    expect(pillsFor('cap2')).toEqual([])
  })

  it('forgets one session outright — offerings and ledger both', () => {
    for (let i = 0; i < 3; i += 1) {
      offerSuggestions('gone', 'test', [suggestion('naggy')])
      offerSuggestions('gone', 'test', [])
    }

    offerSuggestions('gone', 'test', [suggestion('naggy')])
    offerSuggestions('stays', 'test', [suggestion('kept')])

    // Quieted for this session, and something standing on a neighbour.
    expect(pillsFor('gone')).toEqual([])
    expect(pillsFor('stays')).toEqual(['kept'])

    forgetSessionSuggestions('gone')

    // The ledger went with it: the runtime id is dead, so a resumed
    // conversation must not inherit three strikes it never earned.
    offerSuggestions('gone', 'test', [suggestion('naggy')])

    expect(pillsFor('gone')).toEqual(['naggy'])
    expect(pillsFor('stays')).toEqual(['kept'])

    forgetSessionSuggestions('gone')
    forgetSessionSuggestions('stays')
  })

  it('leaves the shared null bucket alone', () => {
    // Scope note, not an endorsement: the `''` bucket is a shared drain that
    // `useSessionSlice` never reads back, and nothing empties its EVENT half
    // today. This pins only that a caller with no session id cannot wipe it on
    // every other session-less composer's behalf — deciding who owns that
    // drain is a separate question from evicting a real session.
    offerSuggestions(null, 'test', [suggestion('draft')])

    forgetSessionSuggestions(null)
    forgetSessionSuggestions(undefined)
    forgetSessionSuggestions('')

    expect(($composerSuggestionsBySession.get()[''] ?? []).map(x => x.id)).toEqual(['draft'])

    offerSuggestions(null, 'test', [])
  })

  it('resets every session on a gateway switch', () => {
    offerSuggestions('sw1', 'test', [suggestion('a')])
    offerSuggestions('sw2', 'test', [suggestion('b')])

    resetComposerSuggestions()

    expect($composerSuggestionsBySession.get()).toEqual({})

    // The offerings are gone too, not just the published copy — a republish
    // from an unrelated session must not resurrect them.
    offerSuggestions('sw3', 'test', [suggestion('c')])

    expect(pillsFor('sw1')).toEqual([])
    expect(pillsFor('sw2')).toEqual([])

    offerSuggestions('sw3', 'test', [])
  })

  it('dedupes by provider-namespaced key across providers', () => {
    offerSuggestions('s4', 'p1', [suggestion('same', 'p1')])
    offerSuggestions('s4', 'p2', [suggestion('same', 'p2')])

    // Different providers, same id — distinct keys, both allowed.
    expect(pillsFor('s4')).toEqual(['same', 'same'])

    offerSuggestions('s4', 'p1', [])
    offerSuggestions('s4', 'p2', [])
  })

  it('quiets a suggestion after it is repeatedly withdrawn uninvoked', () => {
    // Three offer/withdraw cycles = three strikes.
    for (let i = 0; i < 3; i += 1) {
      offerSuggestions('s5', 'test', [suggestion('naggy')])
      offerSuggestions('s5', 'test', [])
    }

    offerSuggestions('s5', 'test', [suggestion('naggy')])

    expect(pillsFor('s5')).toEqual([])

    offerSuggestions('s5', 'test', [])
  })

  it('an invoked suggestion never accrues strikes', () => {
    for (let i = 0; i < 3; i += 1) {
      offerSuggestions('s6', 'test', [suggestion('used')])
      markSuggestionInvoked('s6', suggestionKey(suggestion('used')))
      offerSuggestions('s6', 'test', [])
    }

    offerSuggestions('s6', 'test', [suggestion('used')])

    expect(pillsFor('s6')).toEqual(['used'])

    offerSuggestions('s6', 'test', [])
  })

  it('replaces an offer whose rendered copy changed under the same key', () => {
    offerSuggestions('s7', 'test', [{ ...suggestion('linear'), tip: 'because you mentioned “linear”' }])
    offerSuggestions('s7', 'test', [{ ...suggestion('linear'), tip: 'because you pasted linear.app' }])

    // Same key, new trigger — the strip must paint the new reason, not the
    // first one it ever saw.
    expect(($composerSuggestionsBySession.get().s7 ?? []).map(s => s.tip)).toEqual(['because you pasted linear.app'])

    offerSuggestions('s7', 'test', [])
  })

  it('re-offering the same key swaps in the fresh invoke closure', async () => {
    const calls: string[] = []

    const offer = (tag: string) =>
      offerSuggestions('s8', 'test', [
        { ...suggestion('linear'), invoke: async () => void calls.push(tag), label: `Add linear ${tag}` }
      ])

    offer('first')
    offer('second')

    await ($composerSuggestionsBySession.get().s8 ?? [])[0]!.invoke({ cancelled: () => false, sessionId: 's8', target: 'main' })

    // A pinned first object means the pill runs work built for a draft the
    // user has since changed.
    expect(calls).toEqual(['second'])

    offerSuggestions('s8', 'test', [])
  })

  it('keeps the previous invoke when nothing the pill paints changed', async () => {
    // The other half of the reference bail-out, pinned so nobody reads
    // "swaps in the fresh closure" above as unconditional. A provider whose
    // action moves must move a rendered field or its id with it.
    const calls: string[] = []

    const offer = (tag: string) =>
      offerSuggestions('s8b', 'test', [
        { ...suggestion('linear'), invoke: async () => void calls.push(tag) }
      ])

    offer('first')
    offer('second')

    await ($composerSuggestionsBySession.get().s8b ?? [])[0]!.invoke({ cancelled: () => false, sessionId: 's8b', target: 'main' })

    expect(calls).toEqual(['first'])

    offerSuggestions('s8b', 'test', [])
  })

  it('keeps the array reference when nothing the pill paints changed', () => {
    offerSuggestions('s9', 'test', [suggestion('linear')])

    const first = $composerSuggestionsBySession.get().s9

    offerSuggestions('s9', 'test', [suggestion('linear')])

    expect($composerSuggestionsBySession.get().s9).toBe(first)

    offerSuggestions('s9', 'test', [])
  })
})
