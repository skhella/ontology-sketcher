import { describe, expect, it } from 'vitest'
import { acceptFor, DRAWING_FILE, isIOS, ONTOLOGY_FILE, PROJECT_FILE, SHAPES_FILE, wrongFileKind } from './filePicker'

const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }
const ipadAsMac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }
const mac = { userAgent: ipadAsMac.userAgent, platform: 'MacIntel', maxTouchPoints: 0 }
const windows = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 }

describe('file pickers', () => {
  it('recognises iPhone and iPad, including iPads that say they are a Mac', () => {
    expect(isIOS(iphone)).toBe(true)
    expect(isIOS(ipadAsMac)).toBe(true)
    expect(isIOS(mac)).toBe(false)
    expect(isIOS(windows)).toBe(false)
    expect(isIOS(undefined)).toBe(false)
  })

  it('leaves out the accept filter on iOS, where unknown extensions grey files out', () => {
    for (const kind of [ONTOLOGY_FILE, SHAPES_FILE, DRAWING_FILE, PROJECT_FILE]) expect(acceptFor(kind, true)).toBeUndefined()
  })

  it('keeps the desktop filters', () => {
    expect(acceptFor(ONTOLOGY_FILE, false)).toBe('.ttl,.nt,.owl,text/turtle')
    expect(acceptFor(SHAPES_FILE, false)).toBe('.ttl,text/turtle')
    expect(acceptFor(DRAWING_FILE, false)).toBe('.excalidraw,.json,application/json')
    expect(acceptFor(PROJECT_FILE, false)).toBe('.json,application/json')
  })

  it('checks the extension after a file is picked', () => {
    expect(wrongFileKind('pizza.owl', ONTOLOGY_FILE)).toBeUndefined()
    expect(wrongFileKind('Pizza.TTL', ONTOLOGY_FILE)).toBeUndefined()
    expect(wrongFileKind('my.sketcher.json', PROJECT_FILE)).toBeUndefined()
    expect(wrongFileKind('photo.jpg', ONTOLOGY_FILE)).toBe('photo.jpg is not an ontology in Turtle (.ttl, .nt, .owl).')
    expect(wrongFileKind('pizza.owl', SHAPES_FILE)).toMatch(/not a SHACL shapes file/)
  })
})
