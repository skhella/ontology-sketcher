import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import { bendThrough, bentPath, edgeLine } from './curve'

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

describe('edgeLine', () => {
  it('leaves a corner dot diagonally and keeps React Flow\'s bezier between side dots', () => {
    const { d, mid } = edgeLine({ x: 0, y: 0 }, 'bottom-right', { x: 100, y: 100 }, 'top-left', undefined)
    // Each control point is half the distance ahead along its diagonal: 100√2 · ½ · ½√2 = 50 on each axis.
    expect(d).toBe('M0,0 C50,50 50,50 100,100')
    expect(mid).toEqual({ x: 50, y: 50 })
    expect(edgeLine({ x: 0, y: 0 }, Position.Bottom, { x: 0, y: 100 }, Position.Top, undefined).d).toBe('M0,0 C0,50 0,50 0,100')
  })
})
