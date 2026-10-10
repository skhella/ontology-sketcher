import { describe, expect, it } from 'vitest'
import { dashArray, roughNodeOptions } from './style'

describe('roughNodeOptions', () => {
  it('falls back to the default look and drops the fill for a transparent background', () => {
    expect(roughNodeOptions(undefined, 7)).toMatchObject({ seed: 7, stroke: '#1e1e1e', fill: '#a5d8ff', fillStyle: 'hachure' })
    expect(roughNodeOptions({ fill: 'transparent', stroke: '#e03131' }, 7)).toMatchObject({ stroke: '#e03131', fill: undefined })
  })
})

describe('dashArray', () => {
  it('draws solid lines without a dash pattern', () => {
    expect(dashArray('solid', 2)).toBeUndefined()
    expect(dashArray(undefined, 2)).toBeUndefined()
    expect(dashArray('dashed', 2)).toBe('12 10')
  })
})
