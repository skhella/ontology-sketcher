import { describe, expect, it } from 'vitest'
import { sampleOntology, type ClassNode, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { classesNotOn, loadCanvas, mergePages, placeClass, saveCanvas, workspaceFrom, type Workspace } from './pages'

const cls = (id: string, label: string, x = 0): ClassNode => ({ id, type: 'owlClass', position: { x, y: 0 }, data: { label } })
const sco = (id: string, source: string, target: string): RelationEdge => ({
  id,
  type: 'relation',
  source,
  target,
  data: { kind: 'subClassOf', label: '' },
})

/** A meta page with Equipment, and an empty domain page. */
function twoPages(): { ws: Workspace; meta: string; domain: string } {
  const { workspace, pageId: meta } = workspaceFrom('Meta', [cls('equipment', 'Equipment')], [])
  const domain = 'domain'
  return { ws: { ...workspace, pages: [...workspace.pages, { id: domain, name: 'Domain', nodes: [], edges: [] }] }, meta, domain }
}

describe('pages', () => {
  it('round-trips a canvas, keeping style per page and entity data in the store', () => {
    const styled = { ...cls('a', 'A'), data: { label: 'A', style: { fill: '#ffec99' } } }
    const edge = { ...sco('e', 'a', 'b'), data: { kind: 'subClassOf' as const, label: '', bend: { x: 1, y: 2 } } }
    const { workspace, pageId } = workspaceFrom('P', [styled, cls('b', 'B')], [edge])

    expect(workspace.store.classes.a).toEqual({ label: 'A' })
    expect(workspace.store.relations.e).toEqual({ kind: 'subClassOf', label: '', source: 'a', target: 'b' })
    const canvas = loadCanvas(workspace, pageId)
    expect(canvas.nodes[0].data).toEqual({ label: 'A', style: { fill: '#ffec99' } })
    expect(canvas.edges[0].data).toEqual({ kind: 'subClassOf', label: '', bend: { x: 1, y: 2 } })
  })

  it('shares one class between pages, so a rename on one page shows on the other', () => {
    let { ws, meta, domain } = twoPages()
    ws = placeClass(ws, domain, 'equipment', { x: 50, y: 50 })
    ws = saveCanvas(ws, domain, [{ ...cls('equipment', 'Plant Equipment'), position: { x: 50, y: 50 } }], [])

    expect(Object.keys(ws.store.classes)).toEqual(['equipment'])
    expect(loadCanvas(ws, meta).nodes[0].data.label).toBe('Plant Equipment')
    expect(loadCanvas(ws, meta).nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('removes a class from the ontology only when no page shows it', () => {
    let { ws, meta, domain } = twoPages()
    ws = placeClass(ws, domain, 'equipment', { x: 0, y: 0 })
    ws = saveCanvas(ws, domain, [], [])
    expect(ws.store.classes.equipment).toBeDefined()
    ws = saveCanvas(ws, meta, [], [])
    expect(ws.store.classes.equipment).toBeUndefined()
  })

  it('brings stored relations along when a class is placed next to its partner', () => {
    let { ws, meta, domain } = twoPages()
    ws = saveCanvas(ws, meta, [cls('equipment', 'Equipment'), cls('pump', 'Pump')], [sco('e', 'pump', 'equipment')])
    ws = placeClass(ws, domain, 'pump', { x: 0, y: 0 })
    expect(loadCanvas(ws, domain).edges).toHaveLength(0)
    ws = placeClass(ws, domain, 'equipment', { x: 0, y: 200 })
    expect(loadCanvas(ws, domain).edges.map((e) => e.id)).toEqual(['e'])
    expect(classesNotOn(ws, domain)).toEqual([])
  })

  it('exports the chosen pages merged, without relations drawn only on pages left out', async () => {
    let { ws, meta, domain } = twoPages()
    ws = saveCanvas(ws, meta, [cls('equipment', 'Equipment'), cls('pump', 'Pump')], [sco('e', 'pump', 'equipment')])
    ws = placeClass(ws, domain, 'pump', { x: 0, y: 0 })
    ws = saveCanvas(ws, domain, [...loadCanvas(ws, domain).nodes, cls('cp', 'Centrifugal Pump')], [sco('d', 'cp', 'pump')])

    const domainOnly = mergePages(ws, [domain], 'http://x#')
    expect(domainOnly.nodes.map((n) => n.id).sort()).toEqual(['cp', 'pump'])
    expect(domainOnly.edges.map((e) => e.id)).toEqual(['d'])

    const all = mergePages(ws, [meta, domain], 'http://x#')
    expect(all.nodes.map((n) => n.id).sort()).toEqual(['cp', 'equipment', 'pump'])
    expect(all.edges.map((e) => e.id).sort()).toEqual(['d', 'e'])
  })

  it('exports a single page the same as the canvas it came from', async () => {
    const { workspace, pageId } = workspaceFrom('P', sampleOntology.nodes, sampleOntology.edges)
    expect(await toTurtle(mergePages(workspace, [pageId], sampleOntology.iri))).toBe(await toTurtle(sampleOntology))
  })
})
