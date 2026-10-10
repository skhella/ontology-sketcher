import type { Edge, Node } from '@xyflow/react'
import type { Point } from './sketch/curve'
import type { SketchStyle } from './sketch/style'

/** A named OWL class drawn as a box on the canvas. `style` is visual only. */
export type ClassData = { label: string; style?: SketchStyle }
export type ClassNode = Node<ClassData, 'owlClass'>

/**
 * Edge kinds the canvas understands.
 * - subClassOf: source rdfs:subClassOf target
 * - objectProperty: an owl:ObjectProperty with domain = source, range = target
 */
export type EdgeKind = 'subClassOf' | 'objectProperty'
/** `style` and `bend` (offset of the curve's midpoint, see sketch/curve.ts) are visual only. */
export type RelationData = { kind: EdgeKind; label: string; style?: SketchStyle; bend?: Point }
export type RelationEdge = Edge<RelationData, 'relation'>

export type Ontology = {
  iri: string
  nodes: ClassNode[]
  edges: RelationEdge[]
}

/** Turns a free-text label into a local name usable after the ontology IRI. */
export function localName(label: string): string {
  const words = label.trim().split(/[^A-Za-z0-9_]+/).filter(Boolean)
  if (words.length === 0) return 'Unnamed'
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

export function propertyLocalName(label: string): string {
  const name = localName(label)
  return name[0].toLowerCase() + name.slice(1)
}

export const sampleOntology: Ontology = {
  iri: 'http://example.org/pizza#',
  nodes: [
    { id: 'pizza', type: 'owlClass', position: { x: 80, y: 60 }, data: { label: 'Pizza' } },
    { id: 'topping', type: 'owlClass', position: { x: 460, y: 60 }, data: { label: 'Topping' } },
    { id: 'margherita', type: 'owlClass', position: { x: 80, y: 260 }, data: { label: 'Margherita' } },
    { id: 'tomato', type: 'owlClass', position: { x: 460, y: 260 }, data: { label: 'Tomato Topping' } },
  ],
  edges: [
    { id: 'e1', type: 'relation', source: 'margherita', target: 'pizza', data: { kind: 'subClassOf', label: '' } },
    { id: 'e2', type: 'relation', source: 'tomato', target: 'topping', data: { kind: 'subClassOf', label: '' } },
    { id: 'e3', type: 'relation', source: 'pizza', target: 'topping', data: { kind: 'objectProperty', label: 'has topping' } },
  ],
}
