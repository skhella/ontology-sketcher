import { describe, expect, it } from 'vitest'
import type { ClassNode, RelationEdge } from './model'
import { Position } from '@xyflow/react'
import { arrowhead, dotEndpoint, needsLatinExtended, sized, toSvg, wrap } from './svgExport'

// Every character half the font size wide.
const measure = (text: string, fontSize: number) => (text.length * fontSize) / 2

const node = (id: string, label: string, x: number, y: number, data: Partial<ClassNode['data']> = {}): ClassNode => ({
  id,
  type: 'owlClass',
  position: { x, y },
  measured: { width: 180, height: 64 },
  data: { label, ...data },
})

describe('wrap', () => {
  const ten = (t: string) => t.length * 10
  it('keeps a short name on one line', () => {
    expect(wrap('Pizza', 164, ten)).toEqual(['Pizza'])
  })
  it('breaks at spaces and camelCase humps', () => {
    expect(wrap('Very Long Name', 100, ten)).toEqual(['Very Long', 'Name'])
    expect(wrap('MeasurementDevice', 120, ten)).toEqual(['Measurement', 'Device'])
  })
  it('breaks a piece wider than the line anywhere', () => {
    expect(wrap('abcdefghijkl', 50, ten)).toEqual(['abcde', 'fghij', 'kl'])
  })
})

describe('arrowhead', () => {
  it('points along the line into the tip', () => {
    // Line arriving from the left at (100, 0): the barbs sit behind the tip, either side.
    expect(arrowhead({ x: 100, y: 0 }, { x: 90, y: 0 }, 1)).toEqual([
      { x: 95, y: -4 },
      { x: 100, y: 0 },
      { x: 95, y: 4 },
    ])
  })
})

describe('toSvg', () => {
  const nodes = [
    node('a', 'Pizza', 0, 0, { constraints: [{ path: { type: 'object', property: 'e2' }, minCount: 1 }] }),
    node('b', 'Food & Drink', 0, 200),
    node('c', 'Topping', 300, 0, { kind: 'concept' }),
  ]
  const edges: RelationEdge[] = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', type: 'relation', data: { kind: 'subClassOf', label: '' } },
    { id: 'e2', source: 'a', target: 'c', sourceHandle: 'right', targetHandle: 'left', type: 'relation', data: { kind: 'objectProperty', label: 'hasTopping' } },
  ]

  it('draws classes, edges, labels and badges, cropped to the drawing', () => {
    const svg = toSvg(nodes, edges, { measure })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('>Pizza</tspan>')
    expect(svg).toContain('>Food &amp; Drink</tspan>')
    expect(svg).toContain('>subClassOf</text>')
    expect(svg).toContain('>hasTopping</text>')
    expect(svg).toContain('>concept</text>')
    // The SHACL count beside the arrowhead.
    expect(svg).toContain('>1..*</text>')
    // From the badge above the top row to below the bottom class, with padding.
    const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number)
    expect(x).toBeLessThan(0)
    expect(y).toBeLessThan(-9)
    expect(x + width).toBeGreaterThan(480)
    expect(y + height).toBeGreaterThan(264)
    expect(y + height).toBeLessThan(300)
  })

  it('is drawn the same each time, like the canvas', () => {
    expect(toSvg(nodes, edges, { measure })).toBe(toSvg(nodes, edges, { measure }))
  })

  it('adds the font, a background and the dark filter on request', () => {
    const plain = toSvg(nodes, edges, { measure })
    expect(plain).not.toContain('<style>')
    expect(plain).not.toContain('filter=')
    const dressed = toSvg(nodes, edges, { measure, fontCss: '@font-face{}', background: true, dark: true })
    expect(dressed).toContain('<style>@font-face{}</style>')
    expect(dressed).toContain('fill="#121212"')
    expect(dressed).toContain('filter="url(#dark)"')
  })

  it('leaves out edges to classes not on the page', () => {
    const svg = toSvg(nodes.slice(0, 1), edges, { measure })
    expect(svg).not.toContain('subClassOf')
  })
})

describe('needsLatinExtended', () => {
  it('spots letters beyond Latin-1', () => {
    expect(needsLatinExtended('Café')).toBe(false)
    expect(needsLatinExtended('Łódź')).toBe(true)
  })
})

describe('pages not on screen', () => {
  const unmeasured = (label: string, data: Partial<ClassNode['data']> = {}): ClassNode => ({ id: label, type: 'owlClass', position: { x: 0, y: 0 }, data: { label, ...data } })

  it('keeps a measured size and estimates a missing one from the wrapped label', () => {
    const measured = node('a', 'A', 0, 0)
    expect(sized(measured, measure)).toBe(measured)
    expect(sized(unmeasured('Pump'), measure).measured).toEqual({ width: 180, height: 64 })
    // 10px a character: 'Measurement' and 'Device' on two lines, 'Instrumentation' on a third.
    expect(sized(unmeasured('MeasurementDevice Instrumentation'), measure).measured).toEqual({ width: 180, height: 84 })
    expect(sized(unmeasured('Pump', { style: { shape: 'oval' } }), measure).measured).toEqual({ width: 180, height: 64 })
  })

  it('ends edges on the outer side of the dot, as the canvas does', () => {
    expect(dotEndpoint(node('a', 'A', 0, 0), Position.Top)).toEqual({ x: 90, y: -5.5 })
    expect(dotEndpoint(node('a', 'A', 0, 0), Position.Right)).toEqual({ x: 185.5, y: 32 })
  })
})
