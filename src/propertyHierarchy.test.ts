import { describe, expect, it } from 'vitest'
import type { ClassNode, RelationEdge } from './model'
import { saveCanvas, workspaceFrom } from './pages'
import { propertyEntries, propertyTrees, type PropertyTree } from './propertyHierarchy'

const P = 'http://example.org/plant#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const BFO_PART_OF = 'http://purl.obolibrary.org/obo/BFO_0000050'
const XSD = 'http://www.w3.org/2001/XMLSchema#'

const cls = (id: string, label: string, extra: Partial<ClassNode['data']> = {}): ClassNode => ({
  id,
  type: 'owlClass',
  position: { x: 0, y: 0 },
  data: { label, ...extra },
})
const prop = (id: string, source: string, target: string, label: string, subPropertyOf?: string): RelationEdge => ({
  id,
  type: 'relation',
  source,
  target,
  data: { kind: 'objectProperty', label, ...(subPropertyOf && { subPropertyOf }) },
})
/** The trees as nested labels, to compare shapes. */
const shape = (trees: PropertyTree[]): unknown[] => trees.map((t) => (t.children.length ? { [t.entry.label]: shape(t.children) } : t.entry.label))

describe('property hierarchy', () => {
  const nodes = [cls('plant', 'Plant'), cls('unit', 'Unit', { dataProperties: [{ name: 'tag', datatype: XSD + 'string' }] }), cls('pump', 'Pump')]
  const edges = [
    prop('e1', 'unit', 'plant', 'part of'),
    prop('e2', 'pump', 'unit', 'component of', 'e1'),
    prop('e3', 'pump', 'plant', 'component of', 'e1'),
    prop('e4', 'pump', 'pump', 'connected to'),
  ]

  it('nests drawn object properties by subPropertyOf, with domain, range and pages', () => {
    const { workspace } = workspaceFrom('Overview', nodes, edges)
    const entries = propertyEntries(workspace, { iri: P })

    expect(shape(propertyTrees(entries, 'object'))).toEqual(['connected to', { 'part of': ['component of'] }])
    const componentOf = entries.get(P + 'componentOf')!
    expect(componentOf.domains).toEqual(['Pump'])
    expect(componentOf.ranges).toEqual(['Unit', 'Plant'])
    expect(componentOf.pages.map((p) => p.name)).toEqual(['Overview'])
    expect(shape(propertyTrees(entries, 'data'))).toEqual(['tag'])
    expect(entries.get(P + 'tag')).toMatchObject({ domains: ['Unit'], ranges: ['xsd:string'] })
  })

  it('lists the pages each property appears on', () => {
    const { workspace, pageId } = workspaceFrom('Overview', nodes, edges)
    const detail = { id: 'detail', name: 'Pump detail', nodes: [], edges: [] }
    const ws = saveCanvas({ ...workspace, pages: [...workspace.pages, detail] }, 'detail', [nodes[1], nodes[2]], [edges[1]])
    const entries = propertyEntries(ws, { iri: P })

    expect(entries.get(P + 'componentOf')!.pages.map((p) => p.id)).toEqual([pageId, 'detail'])
    expect(entries.get(P + 'partOf')!.pages.map((p) => p.id)).toEqual([pageId])
    expect(entries.get(P + 'tag')!.pages.map((p) => p.id)).toEqual([pageId, 'detail'])
  })

  it('shows parents from another ontology, kept from an import, above the properties that use them', () => {
    const { workspace } = workspaceFrom('Overview', nodes, edges)
    const keptStatements = [{ about: P + 'partOf', ntriples: `<${P}partOf> <${RDFS}subPropertyOf> <${BFO_PART_OF}> .\n` }]
    const kept = [{ kind: 'object' as const, iri: P + 'locatedIn', label: 'located in', domains: [P + 'Pump'], ranges: [BFO_PART_OF], subPropertyOf: [BFO_PART_OF] }]
    const entries = propertyEntries(workspace, { iri: P, kept, keptStatements })

    expect(shape(propertyTrees(entries, 'object'))).toEqual([{ BFO_0000050: ['located in', { 'part of': ['component of'] }] }, 'connected to'])
    expect(entries.get(BFO_PART_OF)).toMatchObject({ outside: true, pages: [] })
    expect(entries.get(P + 'locatedIn')).toMatchObject({ kept: true, domains: ['Pump'], pages: [] })
  })

  it('cuts a subPropertyOf cycle instead of looping', () => {
    const cyclic = [prop('a', 'pump', 'unit', 'a', 'b'), prop('b', 'pump', 'unit', 'b', 'a')]
    const { workspace } = workspaceFrom('P', nodes, cyclic)
    expect(shape(propertyTrees(propertyEntries(workspace, { iri: P }), 'object'))).toEqual([{ a: ['b'] }])
  })
})
