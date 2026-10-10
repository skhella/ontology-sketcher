import { describe, expect, it } from 'vitest'
import { initialTheme } from './theme'

describe('initialTheme', () => {
  it('follows the system setting when nothing is stored', () => {
    expect(initialTheme(null, true)).toBe('dark')
    expect(initialTheme(null, false)).toBe('light')
  })

  it('keeps a theme the user picked over the system setting', () => {
    expect(initialTheme('light', true)).toBe('light')
    expect(initialTheme('dark', false)).toBe('dark')
  })

  it('ignores an unknown stored value', () => {
    expect(initialTheme('sepia', true)).toBe('dark')
  })
})
