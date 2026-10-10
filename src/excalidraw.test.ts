import { describe, expect, it } from 'vitest'
import { describeImport, importExcalidraw } from './excalidraw'

const shape = (id: string, type: string, x: number, y: number, extra = {}) => ({ id, type, x, y, width: 200, height: 100, isDeleted: false, ...extra })
const label = (id: string, containerId: string | null, text: string) => ({ ...shape(id, 'text', 0, 0), text, originalText: text, containerId })
const arrow = (id: string, from: string | null, to: string | null) => ({
  ...shape(id, 'arrow', 0, 0),
  startBinding: from ? { elementId: from, focus: 0, gap: 4, fixedPoint: null } : null,
  endBinding: to ? { elementId: to, focus: 0, gap: 4, fixedPoint: null } : null,
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

  it('rejects files that are not Excalidraw', () => {
    expect(() => importExcalidraw('not json')).toThrow(/not valid JSON/)
    expect(() => importExcalidraw('{"foo":1}')).toThrow(/Excalidraw/)
  })
})
