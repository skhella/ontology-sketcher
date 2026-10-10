import { describe, expect, it } from 'vitest'
import { describeImport, importExcalidraw } from './excalidraw'

const shape = (id: string, type: string, x: number, y: number, extra = {}) => ({ id, type, x, y, width: 200, height: 100, isDeleted: false, ...extra })
const label = (id: string, containerId: string | null, text: string) => ({ ...shape(id, 'text', 0, 0), text, originalText: text, containerId })
const arrow = (id: string, from: string | null, to: string | null, extra = {}) => ({
  ...shape(id, 'arrow', 0, 0),
  startBinding: from ? { elementId: from, focus: 0, gap: 4, fixedPoint: null } : null,
  endBinding: to ? { elementId: to, focus: 0, gap: 4, fixedPoint: null } : null,
  ...extra,
})

const file = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    shape('pizza', 'rectangle', 0, 0),
    label('t1', 'pizza', 'Pizza'),
    shape('marg', 'ellipse', 0, 300),
    label('t2', 'marg', 'Margherita\nPizza'),
    shape('top', 'diamond', 400, 0),
    label('t3', 'top', 'Topping'),
    arrow('a1', 'marg', 'pizza'),
    arrow('a2', 'pizza', 'top'),
    label('t4', 'a2', 'has topping'),
    // Skipped: free text, unlabelled shape, loose arrow, line, deleted shape.
    label('note', null, 'just a note'),
    shape('blank', 'rectangle', 800, 0),
    arrow('loose', 'pizza', null),
    shape('l1', 'line', 0, 0),
    { ...shape('gone', 'rectangle', 0, 0), isDeleted: true },
    label('t5', 'gone', 'Deleted'),
  ],
  appState: {},
  files: {},
}

describe('importExcalidraw', () => {
  const { nodes, edges, summary } = importExcalidraw(JSON.stringify(file))

  it('turns labelled shapes into classes centred on the original shape', () => {
    expect(nodes.map((n) => n.data.label)).toEqual(['Pizza', 'Margherita Pizza', 'Topping'])
    expect(nodes[0].position).toEqual({ x: 10, y: 18 })
  })

  it('maps bound arrows to subClassOf, or an object property when labelled', () => {
    expect(edges.map((e) => [e.source, e.target, e.data?.kind, e.data?.label])).toEqual([
      ['marg', 'pizza', 'subClassOf', ''],
      ['pizza', 'top', 'objectProperty', 'has topping'],
    ])
  })

  it('counts what it skipped', () => {
    expect(summary).toEqual({ classes: 3, subClassOf: 1, objectProperties: 1, skipped: 4 })
    expect(describeImport(summary)).toBe(
      'Imported 3 classes, 1 subClassOf, 1 object property. Skipped 4 other elements (free text, lines, unlabelled shapes or loose arrows).',
    )
  })

  it('keeps colours, fill, stroke and sloppiness', () => {
    const styled = {
      elements: [
        shape('a', 'ellipse', 0, 0, { strokeColor: '#e03131', backgroundColor: '#ffc9c9', fillStyle: 'cross-hatch', strokeWidth: 2, strokeStyle: 'solid', roughness: 0 }),
        label('ta', 'a', 'A'),
        shape('b', 'rectangle', 400, 0, { strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'zigzag', strokeWidth: 1, strokeStyle: 'dotted', roughness: 2 }),
        label('tb', 'b', 'B'),
        arrow('ab', 'a', 'b', { strokeColor: '#1971c2', backgroundColor: '#ffc9c9', strokeWidth: 4, strokeStyle: 'dashed', roughness: 1 }),
      ],
    }
    const result = importExcalidraw(JSON.stringify(styled))
    expect(result.nodes.map((n) => n.data.style)).toEqual([
      { stroke: '#e03131', fill: '#ffc9c9', fillStyle: 'cross-hatch', strokeWidth: 2, strokeStyle: 'solid', roughness: 0 },
      { stroke: '#1e1e1e', fill: 'transparent', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'dotted', roughness: 2 },
    ])
    expect(result.edges[0].data?.style).toEqual({ stroke: '#1971c2', strokeWidth: 4, strokeStyle: 'dashed', roughness: 1 })
  })

  it('keeps the bend of curved arrows', () => {
    const curved = {
      elements: [
        shape('a', 'rectangle', 0, 0),
        label('ta', 'a', 'A'),
        shape('b', 'rectangle', 400, 0),
        label('tb', 'b', 'B'),
        arrow('ab', 'a', 'b', { points: [[0, 0], [100, -60], [200, 0]] }),
        arrow('ba', 'b', 'a', { points: [[0, 0], [-200, 0]] }),
      ],
    }
    const { edges } = importExcalidraw(JSON.stringify(curved))
    expect(edges.map((e) => e.data?.bend)).toEqual([{ x: 0, y: -60 }, undefined])
  })

  it('attaches arrows to the side of the class they touched', () => {
    const sides = {
      elements: [
        shape('a', 'rectangle', 0, 0),
        label('ta', 'a', 'A'),
        shape('b', 'rectangle', 400, 0),
        label('tb', 'b', 'B'),
        // From A's right edge (200, 50) to B's left edge (400, 50).
        arrow('ab', 'a', 'b', { x: 200, y: 50, points: [[0, 0], [200, 0]] }),
        // From B's bottom (500, 100) round to A's bottom (100, 100).
        arrow('ba', 'b', 'a', { x: 500, y: 100, points: [[0, 0], [-200, 80], [-400, 0]] }),
      ],
    }
    const { edges } = importExcalidraw(JSON.stringify(sides))
    expect(edges.map((e) => [e.sourceHandle, e.targetHandle])).toEqual([
      ['right', 'left'],
      ['bottom', 'bottom'],
    ])
  })

  it('reads arrows labelled SCO or subClassOf as subClassOf', () => {
    const labelled = {
      elements: [
        shape('a', 'rectangle', 0, 0),
        label('ta', 'a', 'A'),
        shape('b', 'rectangle', 400, 0),
        label('tb', 'b', 'B'),
        arrow('x1', 'a', 'b'),
        label('l1', 'x1', 'SCO'),
        arrow('x2', 'a', 'b'),
        label('l2', 'x2', 'subClassof'),
        arrow('x3', 'a', 'b'),
        label('l3', 'x3', 'scope'),
      ],
    }
    const { edges } = importExcalidraw(JSON.stringify(labelled))
    expect(edges.map((e) => [e.data?.kind, e.data?.label])).toEqual([
      ['subClassOf', ''],
      ['subClassOf', ''],
      ['objectProperty', 'scope'],
    ])
  })

  it('rejects files that are not Excalidraw', () => {
    expect(() => importExcalidraw('not json')).toThrow(/not valid JSON/)
    expect(() => importExcalidraw('{"foo":1}')).toThrow(/Excalidraw/)
  })
})
