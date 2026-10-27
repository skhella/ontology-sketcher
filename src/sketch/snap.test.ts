import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { sidePoint, snapToClass, spreadEnds, toAnchor, toFlowPoint } from './snap'

const a = { id: 'a', x: 0, y: 0, width: 180, height: 64 }
const b = { id: 'b', x: 300, y: 0, width: 180, height: 64 }

describe('snapToClass', () => {
  it('locks onto the dot nearest the pointer anywhere over another class', () => {
    expect(snapToClass([a, b], { x: 310, y: 30 }, 'a')).toEqual({ nodeId: 'b', side: Position.Left, point: { x: 300, y: 32 } })
    expect(snapToClass([a, b], { x: 400, y: 5 }, 'a')?.side).toBe(Position.Top)
    expect(snapToClass([a, b], { x: 470, y: 40 }, 'a')?.side).toBe(Position.Right)
    expect(snapToClass([a, b], { x: 380, y: 60 }, 'a')?.side).toBe(Position.Bottom)
  })

  it('locks onto a corner dot near a corner, on the corner of a box and at 45° on an oval', () => {
    expect(snapToClass([a, b], { x: 305, y: 4 }, 'a')).toEqual({ nodeId: 'b', side: 'top-left', point: { x: 300, y: 0 } })
    expect(snapToClass([a, b], { x: 475, y: 60 }, 'a')?.side).toBe('bottom-right')
    const oval = { ...b, oval: true }
    const snap = snapToClass([a, oval], { x: 320, y: 10 }, 'a')
    expect(snap?.side).toBe('top-left')
    expect(snap?.point.x).toBeCloseTo(300 + 90 - 90 * Math.SQRT1_2)
    expect(snap?.point.y).toBeCloseTo(32 - 32 * Math.SQRT1_2)
  })

  it('ignores the class the edge starts from and empty canvas', () => {
    expect(snapToClass([a, b], { x: 90, y: 30 }, 'a')).toBeNull()
    expect(snapToClass([a, b], { x: 240, y: 30 }, 'a')).toBeNull()
  })
})

describe('toAnchor', () => {
  it('keeps the four side ids saved before corner dots existed and falls back on unknown ids', () => {
    expect(toAnchor('left', Position.Top)).toBe(Position.Left)
    expect(toAnchor('bottom-left', Position.Top)).toBe('bottom-left')
    expect(toAnchor(undefined, Position.Bottom)).toBe(Position.Bottom)
    expect(toAnchor('middle', Position.Top)).toBe(Position.Top)
    expect(sidePoint(a, 'top-right')).toEqual({ x: 180, y: 0 })
  })
})

describe('toFlowPoint', () => {
  it('undoes the viewport pan and zoom', () => {
    expect(toFlowPoint({ x: 120, y: 60 }, [20, 10, 2])).toEqual({ x: 50, y: 25 })
  })
})

describe('spreadEnds', () => {
  const boxes = new Map([['a', a]])
  const below = (x: number) => ({ nodeId: 'a', anchor: Position.Bottom, toward: { x, y: 300 } })

  it('moves arrows sharing a dot to the free dots beside it, keeping their left-to-right order', () => {
    expect(spreadEnds([below(400), below(-200), below(90)], boxes)).toEqual(['bottom-right', 'bottom-left', Position.Bottom])
    expect(spreadEnds([below(400), below(-200)], boxes)).toEqual(['bottom-right', 'bottom-left'])
    expect(spreadEnds([below(0), below(100), below(200), below(300)], boxes)).toEqual(['bottom-left', Position.Bottom, 'bottom-right', 'bottom-right'])
  })

  it('leaves a single arrow, fixed arrows and dots another arrow uses alone', () => {
    expect(spreadEnds([below(400)], boxes)).toEqual([Position.Bottom])
    const corner = { nodeId: 'a', anchor: 'bottom-left' as const, toward: { x: -200, y: 300 }, fixed: true }
    expect(spreadEnds([corner, below(0), below(300)], boxes)).toEqual(['bottom-left', Position.Bottom, 'bottom-right'])
    expect(spreadEnds([{ ...below(0), fixed: true }, { ...below(300), fixed: true }], boxes)).toEqual([Position.Bottom, Position.Bottom])
  })
})
