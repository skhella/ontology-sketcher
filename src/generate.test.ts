import { describe, expect, it } from 'vitest'
import { suggestConstraints } from './generate'
import { sampleOntology, type ClassAxiom, type ClassNode, type RelationEdge } from './model'

const XSD = 'http://www.w3.org/2001/XMLSchema#'
const { nodes, edges } = sampleOntology

const withPizza = (data: Partial<ClassNode['data']>): ClassNode[] => nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, ...data } } : n))
const restriction = (quantifier: 'some' | 'only' | 'min' | 'max' | 'exactly', n?: number, filler?: string): ClassAxiom => ({
  kind: 'subClassOf',
  expression: { type: 'restriction', quantifier, property: 'e3', n, filler },
})

describe('suggestConstraints', () => {
  it('turns an arrow into a value class for the property', () => {
    expect(suggestConstraints('pizza', nodes, edges)).toEqual([{ path: { type: 'object', property: 'e3' }, class: 'topping' }])
    expect(suggestConstraints('topping', nodes, edges)).toEqual([])
  })

  it('reads counts and value classes from restrictions', () => {
    expect(suggestConstraints('pizza', withPizza({ axioms: [restriction('some', undefined, 'tomato')] }), edges)).toEqual([
      { path: { type: 'object', property: 'e3' }, class: 'topping', minCount: 1 },
    ])
    expect(suggestConstraints('pizza', withPizza({ axioms: [restriction('only', undefined, 'tomato'), restriction('exactly', 2)] }), edges)).toEqual([
      { path: { type: 'object', property: 'e3' }, class: 'tomato', minCount: 2, maxCount: 2 },
    ])
    // A qualified max leaves other values free, so it says nothing about the total count.
    expect(suggestConstraints('pizza', withPizza({ axioms: [restriction('min', 3, 'tomato'), restriction('max', 5, 'tomato')] }), edges)).toEqual([
      { path: { type: 'object', property: 'e3' }, class: 'topping', minCount: 3 },
    ])
    // Disjointness is not a requirement on values.
    const disjoint: ClassAxiom = { kind: 'disjointWith', expression: restriction('max', 0).expression }
    expect(suggestConstraints('pizza', withPizza({ axioms: [disjoint] }), edges)).toEqual([{ path: { type: 'object', property: 'e3' }, class: 'topping' }])
  })

  it('uses restrictions on a property the class has no arrow for, naming it by its first edge', () => {
    const more: RelationEdge[] = [
      ...edges,
      { id: 'e4', type: 'relation', source: 'margherita', target: 'tomato', data: { kind: 'objectProperty', label: 'has base' } },
      { id: 'e5', type: 'relation', source: 'topping', target: 'tomato', data: { kind: 'objectProperty', label: 'has base' } },
    ]
    const axioms: ClassAxiom[] = [{ kind: 'equivalentClass', expression: { type: 'restriction', quantifier: 'max', property: 'e5', n: 1 } }]
    expect(suggestConstraints('pizza', withPizza({ axioms }), more)).toEqual([
      { path: { type: 'object', property: 'e3' }, class: 'topping' },
      { path: { type: 'object', property: 'e4' }, maxCount: 1 },
    ])
  })

  it('leaves the value class open when the arrows point at several classes, and caps functional properties', () => {
    const more: RelationEdge[] = [
      ...edges.map((e) => (e.id === 'e3' ? { ...e, data: { ...e.data!, characteristics: ['functional' as const] } } : e)),
      { id: 'e6', type: 'relation', source: 'pizza', target: 'tomato', data: { kind: 'objectProperty', label: 'has topping' } },
    ]
    expect(suggestConstraints('pizza', nodes, more)).toEqual([{ path: { type: 'object', property: 'e3' }, maxCount: 1 }])
  })

  it('adds data properties and skips properties that already have a constraint', () => {
    const withData = withPizza({
      dataProperties: [
        { name: 'name', datatype: XSD + 'string', functional: true },
        { name: 'diameter', datatype: XSD + 'decimal' },
        { name: ' ', datatype: XSD + 'string' },
      ],
    })
    expect(suggestConstraints('pizza', withData, edges)).toEqual([
      { path: { type: 'object', property: 'e3' }, class: 'topping' },
      { path: { type: 'data', name: 'name' }, datatype: XSD + 'string', maxCount: 1 },
      { path: { type: 'data', name: 'diameter' }, datatype: XSD + 'decimal' },
    ])
    expect(
      suggestConstraints('pizza', withData, edges, [
        { path: { type: 'object', property: 'e3' }, minCount: 2 },
        { path: { type: 'data', name: 'name' } },
      ]),
    ).toEqual([{ path: { type: 'data', name: 'diameter' }, datatype: XSD + 'decimal' }])
  })
})
