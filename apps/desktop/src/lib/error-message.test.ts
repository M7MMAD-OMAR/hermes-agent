import { describe, expect, it } from 'vitest'

import { inlineErrorMessage } from './error-message'

describe('inlineErrorMessage', () => {
  it('unwraps an Electron remote-method wrapper', () => {
    expect(inlineErrorMessage(new Error("Error invoking remote method 'x': Error: boom"), 'fallback')).toBe('boom')
  })

  it('strips a bare Error prefix', () => {
    expect(inlineErrorMessage(new Error('Error: nope'), 'fallback')).toBe('nope')
  })

  it('falls back when there is no message to read', () => {
    expect(inlineErrorMessage(undefined, 'fallback')).toBe('fallback')
  })

  it('passes an already-clean message through', () => {
    expect(inlineErrorMessage(new Error('Install LibreOffice'), 'fallback')).toBe('Install LibreOffice')
  })
})
