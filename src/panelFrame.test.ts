import { describe, expect, it } from 'vitest'
import { clampFrame, MIN_HEIGHT, MIN_WIDTH, moveFrame, parseFrame, resizeFrame, widenFromLeft } from './panelFrame'

const canvas = { width: 1200, height: 800 }

describe('parseFrame', () => {
  it('reads a stored frame', () => {
    expect(parseFrame('{"x":10,"y":20,"width":500,"height":400}')).toEqual({ x: 10, y: 20, width: 500, height: 400 })
    expect(parseFrame('{"x":10,"y":20,"width":500}')).toEqual({ x: 10, y: 20, width: 500 })
  })

  it('falls back to the default place for anything else', () => {
    expect(parseFrame(null)).toBeNull()
    expect(parseFrame('not json')).toBeNull()
    expect(parseFrame('{"x":"10","y":20,"width":500}')).toBeNull()
    expect(parseFrame('{"x":10,"y":20,"width":500,"height":"big"}')).toBeNull()
  })
})

describe('clampFrame', () => {
  it('keeps a panel that fits where it is', () => {
    expect(clampFrame({ x: 100, y: 50, width: 500, height: 400 }, canvas)).toEqual({ x: 100, y: 50, width: 500, height: 400 })
  })

  it('pulls a panel back inside a canvas that got smaller', () => {
    expect(clampFrame({ x: 900, y: 700, width: 500, height: 400 }, canvas)).toEqual({ x: 700, y: 400, width: 500, height: 400 })
  })

  it('never makes a panel larger than the canvas or smaller than the minimum', () => {
    expect(clampFrame({ x: 0, y: 0, width: 5000, height: 5000 }, canvas)).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(clampFrame({ x: 0, y: 0, width: 10, height: 10 }, canvas)).toEqual({ x: 0, y: 0, width: MIN_WIDTH, height: MIN_HEIGHT })
  })
})

describe('moving and resizing', () => {
  it('moves by the drag and stops at the canvas edge', () => {
    expect(moveFrame({ x: 12, y: 12, width: 420 }, 100, 30, canvas)).toEqual({ x: 112, y: 42, width: 420 })
    expect(moveFrame({ x: 12, y: 12, width: 420 }, -100, -100, canvas)).toEqual({ x: 0, y: 0, width: 420 })
  })

  it('resizes from the corner, keeping the top-left corner in place', () => {
    expect(resizeFrame({ x: 12, y: 12, width: 420, height: 300 }, 200, 100, canvas)).toEqual({ x: 12, y: 12, width: 620, height: 400 })
    expect(resizeFrame({ x: 12, y: 12, width: 420, height: 300 }, 5000, 5000, canvas)).toEqual({ x: 12, y: 12, width: 1188, height: 788 })
    expect(resizeFrame({ x: 12, y: 12, width: 420, height: 300 }, -1000, -1000, canvas)).toEqual({ x: 12, y: 12, width: MIN_WIDTH, height: MIN_HEIGHT })
  })

  it('widens a right-pinned panel when its left edge is dragged left', () => {
    expect(widenFromLeft(330, -170, 1000)).toBe(500)
    expect(widenFromLeft(330, 500, 1000)).toBe(MIN_WIDTH)
    expect(widenFromLeft(330, -5000, 1000)).toBe(1000)
  })
})
