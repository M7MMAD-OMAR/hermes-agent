import { describe, expect, it } from 'vitest'

import { isProcessNotification, isRuntimeNudge } from './runtime-nudges'

// The desktop's half of a list the backend owns. `tests/agent/test_desktop_
// renders_runtime_nudges.py` pins that the two agree; these cases pin what the
// matcher does with them, which Python cannot see.

describe('isRuntimeNudge', () => {
  it('catches the iteration-cap request the user reported as a fake message', () => {
    expect(
      isRuntimeNudge(
        "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response summarizing what you've found and accomplished so far, without calling any more tools."
      )
    ).toBe(true)
  })

  it('matches after trimming, since the transcript stores whitespace as sent', () => {
    expect(
      isRuntimeNudge(
        '\n  [System: Continue now. Execute the required tool calls and only send your final answer after completing the task.]  \n'
      )
    ).toBe(true)
  })

  it('matches prefix nudges, which carry a variable tail', () => {
    expect(isRuntimeNudge('[IMPORTANT: Background process proc_e454d92c33af completed normally (exit code 0).]')).toBe(
      true
    )
    expect(isRuntimeNudge('[Your active task list was preserved across context compression]\n1. do the thing')).toBe(
      true
    )
  })

  it('leaves real prompts alone — including ones that talk ABOUT the nudges', () => {
    expect(isRuntimeNudge('why did it say I reached the maximum number of tool-calling iterations?')).toBe(false)
    expect(isRuntimeNudge('continue')).toBe(false)
    expect(isRuntimeNudge('')).toBe(false)
    // Whole-string match, not substring: quoting a nudge is not being one.
    expect(
      isRuntimeNudge(
        'look at this: [System: Continue now. Execute the required tool calls and only send your final answer after completing the task.]'
      )
    ).toBe(false)
  })
})

describe('isProcessNotification', () => {
  it('is the narrower family, so it can keep its richer rendering', () => {
    expect(isProcessNotification('[IMPORTANT: Background process proc_1 exited.]')).toBe(true)
    expect(isProcessNotification("You've reached the maximum number of tool-calling iterations allowed.")).toBe(false)
  })
})
