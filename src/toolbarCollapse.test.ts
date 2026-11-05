import { describe, expect, it } from 'vitest'
import { toolbarCollapsed } from './toolbarCollapse'

describe('toolbarCollapsed', () => {
  it('starts collapsed on narrow screens and open on wide ones', () => {
    expect(toolbarCollapsed(null, true)).toBe(true)
    expect(toolbarCollapsed(null, false)).toBe(false)
  })

  it('keeps the choice the user made, whatever the screen width', () => {
    expect(toolbarCollapsed('expanded', true)).toBe(false)
    expect(toolbarCollapsed('collapsed', false)).toBe(true)
  })
})
