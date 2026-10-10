import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { snapToClass, toFlowPoint } from './snap'

const a = { id: 'a', x: 0, y: 0, width: 180, height: 64 }
const b = { id: 'b', x: 300, y: 0, width: 180, height: 64 }

describe('snapToClass', () => {
  it('locks onto the dot nearest the pointer anywhere over another class', () => {
    expect(snapToClass([a, b], { x: 310, y: 30 }, 'a')).toEqual({ nodeId: 'b', side: Position.Left, point: { x: 300, y: 32 } })
    expect(snapToClass([a, b], { x: 400, y: 5 }, 'a')?.side).toBe(Position.Top)
    expect(snapToClass([a, b], { x: 470, y: 40 }, 'a')?.side).toBe(Position.Right)
    expect(snapToClass([a, b], { x: 380, y: 60 }, 'a')?.side).toBe(Position.Bottom)
  })

  it('ignores the class the edge starts from and empty canvas', () => {
    expect(snapToClass([a, b], { x: 90, y: 30 }, 'a')).toBeNull()
    expect(snapToClass([a, b], { x: 240, y: 30 }, 'a')).toBeNull()
  })
})

describe('toFlowPoint', () => {
  it('undoes the viewport pan and zoom', () => {
    expect(toFlowPoint({ x: 120, y: 60 }, [20, 10, 2])).toEqual({ x: 50, y: 25 })
  })
})
