import { describe, expect, it } from 'vitest'

import { parseTaskLink } from './task-link'

describe('saved task links', () => {
  it('keeps the explicitly selected board and task together', () => {
    expect(parseTaskLink('#/kanban?board=client-delivery&task=t_abc123')).toEqual({ board: 'client-delivery', task: 't_abc123' })
    expect(parseTaskLink('#/kanban?task=t_abc123')).toEqual({ board: 'default', task: 't_abc123' })
  })
  it('does not open unrelated routes or invalid identifiers', () => {
    for (const hash of ['#/artifacts?task=t_abc', '#/kanban', '#/kanban?task=other', '#/kanban?task=t_abc&board=../../private']) {
      expect(parseTaskLink(hash)).toBeNull()
    }
  })
})
