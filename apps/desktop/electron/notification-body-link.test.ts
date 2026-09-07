import { describe, expect, it } from 'vitest'

import {
  chatDeepLink,
  decorateNotificationBody,
  parseNotifyCapabilities,
  supportsBodyHyperlinks
} from './notification-body-link'

const HYPERLINKS = ['body', 'body-markup', 'body-hyperlinks', 'actions']

describe('parseNotifyCapabilities', () => {
  it('reads a gdbus GVariant tuple', () => {
    expect(parseNotifyCapabilities("(['persistence', 'body', 'body-hyperlinks'],)")).toEqual([
      'persistence',
      'body',
      'body-hyperlinks'
    ])
  })

  it('returns nothing for an empty or unparseable reply', () => {
    expect(parseNotifyCapabilities('')).toEqual([])
    expect(parseNotifyCapabilities('Error: no such service')).toEqual([])
  })
})

describe('supportsBodyHyperlinks', () => {
  it('is false for a daemon that only advertises actions', () => {
    expect(supportsBodyHyperlinks(['body', 'actions'])).toBe(false)
  })

  it('is false when capabilities were never probed', () => {
    expect(supportsBodyHyperlinks(null)).toBe(false)
    expect(supportsBodyHyperlinks(undefined)).toBe(false)
  })

  it('is true when the daemon advertises body-hyperlinks', () => {
    expect(supportsBodyHyperlinks(HYPERLINKS)).toBe(true)
  })
})

describe('decorateNotificationBody', () => {
  const link = 'hermes://chat/s-1'

  it('appends an anchor when the daemon supports hyperlinks', () => {
    expect(decorateNotificationBody('Done', { capabilities: HYPERLINKS, link, linkLabel: 'Open chat' })).toBe(
      'Done\n<a href="hermes://chat/s-1">Open chat</a>'
    )
  })

  it('leaves the body untouched when the daemon cannot render links', () => {
    expect(decorateNotificationBody('Done', { capabilities: ['body', 'actions'], link, linkLabel: 'Open chat' })).toBe(
      'Done'
    )
  })

  it('leaves the body untouched with no link or no label', () => {
    expect(decorateNotificationBody('Done', { capabilities: HYPERLINKS, linkLabel: 'Open chat' })).toBe('Done')
    expect(decorateNotificationBody('Done', { capabilities: HYPERLINKS, link })).toBe('Done')
  })

  it('refuses a link that is not a hermes scheme', () => {
    expect(
      decorateNotificationBody('Done', { capabilities: HYPERLINKS, link: 'file:///etc/passwd', linkLabel: 'Open' })
    ).toBe('Done')
    expect(
      decorateNotificationBody('Done', { capabilities: HYPERLINKS, link: 'javascript:alert(1)', linkLabel: 'Open' })
    ).toBe('Done')
  })

  it('accepts the dev scheme', () => {
    expect(
      decorateNotificationBody('', { capabilities: HYPERLINKS, link: 'hermes-dev://chat/s-1', linkLabel: 'Open' })
    ).toBe('<a href="hermes-dev://chat/s-1">Open</a>')
  })

  it('escapes body text once markup is in play, so a body cannot close the anchor', () => {
    const out = decorateNotificationBody('<a href="x">click</a> & <b>', {
      capabilities: HYPERLINKS,
      link,
      linkLabel: 'Open chat'
    })

    expect(out).toBe('&lt;a href="x"&gt;click&lt;/a&gt; &amp; &lt;b&gt;\n<a href="hermes://chat/s-1">Open chat</a>')
  })

  it('does not escape a body it is not decorating', () => {
    expect(decorateNotificationBody('a < b & c', { capabilities: ['body'], link, linkLabel: 'Open' })).toBe('a < b & c')
  })
})

describe('chatDeepLink', () => {
  it('builds the chat URL for a stored session id', () => {
    expect(chatDeepLink('20260907_033921_9dd21e')).toBe('hermes://chat/20260907_033921_9dd21e')
  })

  it('honours the dev scheme, which is what a dev build registers', () => {
    expect(chatDeepLink('s-1', 'hermes-dev')).toBe('hermes-dev://chat/s-1')
  })

  it('is null without an id', () => {
    expect(chatDeepLink(null)).toBeNull()
    expect(chatDeepLink(undefined)).toBeNull()
    expect(chatDeepLink('   ')).toBeNull()
  })

  it('refuses an id that would smuggle a path, a space or a scheme', () => {
    expect(chatDeepLink('../../etc/passwd')).toBeNull()
    expect(chatDeepLink('a/b')).toBeNull()
    expect(chatDeepLink('a b')).toBeNull()
    expect(chatDeepLink('x'.repeat(201))).toBeNull()
  })
})
