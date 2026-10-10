import { describe, expect, it } from 'vitest'
import type { PropertyConstraint } from '../model'
import { constraintOnArrow, multiplicity, nearTarget } from './multiplicity'

describe('multiplicity', () => {
  it('writes counts the UML way', () => {
    expect(multiplicity({ minCount: 1 })).toBe('1..*')
    expect(multiplicity({ maxCount: 1 })).toBe('0..1')
    expect(multiplicity({ minCount: 2, maxCount: 5 })).toBe('2..5')
    expect(multiplicity({ minCount: 2, maxCount: 2 })).toBe('2')
    expect(multiplicity({ maxCount: 0 })).toBe('0')
    expect(multiplicity({})).toBeUndefined()
  })
})

describe('constraintOnArrow', () => {
  const labels: Record<string, string> = { e3: 'has topping', e7: 'has topping', e4: 'has base' }
  const constraints: PropertyConstraint[] = [
    { path: { type: 'data', name: 'has topping' }, minCount: 9 },
    { path: { type: 'object', property: 'e4' }, minCount: 1 },
    { path: { type: 'object', property: 'e7' }, maxCount: 3 },
  ]

  it('finds the constraint on the arrow’s property, whichever of its edges it names', () => {
    expect(constraintOnArrow(constraints, 'has topping', (id) => labels[id])).toEqual(constraints[2])
    expect(constraintOnArrow(constraints, 'has sauce', (id) => labels[id])).toBeUndefined()
    expect(constraintOnArrow(undefined, 'has topping', (id) => labels[id])).toBeUndefined()
  })
})

describe('nearTarget', () => {
  it('steps back along the line and to its side', () => {
    // A line arriving from below: back down 26, then 14 to the side.
    expect(nearTarget({ x: 100, y: 100 }, { x: 100, y: 300 })).toEqual({ x: 86, y: 126 })
    expect(nearTarget({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})
