import { describe, expect, it } from 'vitest'
import { bendThrough, bentPath } from './curve'

describe('bentPath', () => {
  it('passes through the dragged point and keeps the bend relative to the ends', () => {
    const source = { x: 0, y: 0 }
    const target = { x: 100, y: 0 }
    const bend = bendThrough(source, target, { x: 50, y: 40 })
    expect(bend).toEqual({ x: 0, y: 40 })

    const { d, through } = bentPath(source, target, bend)
    expect(through).toEqual({ x: 50, y: 40 })
    // Quadratic at t = 0.5: 0.25 * source + 0.5 * control + 0.25 * target.
    expect(d).toBe('M 0,0 Q 50,80 100,0')

    // Moving the target keeps the same offset from the new midpoint.
    expect(bentPath(source, { x: 200, y: 0 }, bend).through).toEqual({ x: 100, y: 40 })
  })
})
