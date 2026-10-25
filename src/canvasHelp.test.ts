import { describe, expect, it } from 'vitest'
import { helpShown } from './canvasHelp'

describe('helpShown', () => {
  it('shows the help when nothing is stored', () => {
    expect(helpShown(null)).toBe(true)
  })

  it('keeps the help hidden once the user hid it', () => {
    expect(helpShown('hidden')).toBe(false)
    expect(helpShown('shown')).toBe(true)
  })
})
