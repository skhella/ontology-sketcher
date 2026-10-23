import { describe, expect, it } from 'vitest'
import { exportFiles } from './exportFiles'
import { hiddenOn, withoutHidden } from './hidden'
import { planImport, saveLayout } from './layout'
import type { ClassNode, RelationEdge } from './model'
import { importOwl } from './owlImport'
import { loadCanvas, placeClass, saveCanvas, workspaceFrom, type Workspace } from './pages'
import { LAYOUT_PROPERTY } from './savedLayout'

const IRI = 'http://example.org/plant#'
const cls = (id: string, label: string, hidden?: boolean): ClassNode => ({
  id,
  type: 'owlClass',
  position: { x: 0, y: 0 },
  data: { label, ...(hidden && { hidden }) },
})
const sco = (id: string, source: string, target: string, hidden?: boolean): RelationEdge => ({
  id,
  type: 'relation',
  source,
  target,
  data: { kind: 'subClassOf', label: '', ...(hidden && { hidden }) },
})
const context = { iri: IRI, namespaces: [], kept: [], keptStatements: [] }

/** Equipment, Pump and Valve; Valve is hidden, and so is the arrow from Pump. */
function plant(): { ws: Workspace; pageId: string } {
  const { workspace, pageId } = workspaceFrom(
    'Plant',
    [cls('equipment', 'Equipment'), cls('pump', 'Pump'), cls('valve', 'Valve', true)],
    [sco('p', 'pump', 'equipment', true), sco('v', 'valve', 'equipment')],
  )
  return { ws: workspace, pageId }
}

describe('hidden classes and arrows', () => {
  it('hides an arrow with either of its classes', () => {
    const { ws, pageId } = plant()
    const { nodes, edges } = loadCanvas(ws, pageId)
    const hidden = hiddenOn(nodes, edges)
    expect([...hidden.nodes]).toEqual(['valve'])
    expect([...hidden.edges].sort()).toEqual(['p', 'v'])
    const shown = withoutHidden(nodes, edges)
    expect(shown.nodes.map((n) => n.id)).toEqual(['equipment', 'pump'])
    expect(shown.edges).toEqual([])
  })

  it('keeps being hidden per page, out of the shared store', () => {
    let { ws, pageId } = plant()
    expect(ws.store.classes.valve).toEqual({ label: 'Valve' })
    expect(ws.store.relations.p).not.toHaveProperty('hidden')
    // Placing the class on another page shows it there, with its arrow.
    ws = { ...ws, pages: [...ws.pages, { id: 'other', name: 'Other', nodes: [], edges: [] }] }
    ws = placeClass(placeClass(ws, 'other', 'equipment', { x: 0, y: 0 }), 'other', 'valve', { x: 0, y: 200 })
    const other = loadCanvas(ws, 'other')
    expect(other.nodes.some((n) => n.data.hidden)).toBe(false)
    expect(other.edges.map((e) => [e.id, e.data?.hidden])).toEqual([['v', undefined]])
    expect(loadCanvas(ws, pageId).nodes.find((n) => n.id === 'valve')?.data.hidden).toBe(true)
  })

  it("doesn't keep React Flow's own hidden flag, which the canvas only uses to leave things out", () => {
    const { workspace, pageId } = workspaceFrom('P', [{ ...cls('a', 'A'), hidden: true }], [])
    expect(workspace.pages[0].nodes[0]).not.toHaveProperty('hidden')
    expect(loadCanvas(workspace, pageId).nodes[0].data).toEqual({ label: 'A' })
  })

  it('exports hidden classes and arrows to OWL like any other', async () => {
    const { ws, pageId } = plant()
    const { nodes, edges } = loadCanvas(ws, pageId)
    const shown = saveCanvas(ws, pageId, nodes.map(unhide), edges.map(unhide))
    const strip = (turtle: string) => turtle.split('\n').filter((line) => !line.includes('layout')).join('\n')
    const [withHidden] = await exportFiles('owl', ws, [pageId], context)
    const [allShown] = await exportFiles('owl', shown, [pageId], context)
    expect(withHidden.text).toContain('Valve')
    expect(strip(withHidden.text)).toBe(strip(allShown.text))
  })

  it('saves which classes and arrows are hidden in the layout, and brings it back on import', async () => {
    const { ws, pageId } = plant()
    const layout = saveLayout(ws, [pageId], IRI)
    expect(layout.pages[0].nodes.filter((n) => n.hidden).map((n) => n.iri)).toEqual([IRI + 'Valve'])
    expect(layout.pages[0].edges.filter((e) => e.hidden).map((e) => e.source)).toEqual([IRI + 'Pump'])
    const [file] = await exportFiles('owl', ws, [pageId], context)
    expect(file.text).toContain(LAYOUT_PROPERTY)
    const imported = importOwl(file.text)
    expect(imported.layout).toEqual(layout)
    const fresh = workspaceFrom('Page 1', [], [])
    const [page] = planImport(imported, { iri: IRI, workspace: fresh.workspace, pageId: fresh.pageId }).pages
    expect(page.nodes.filter((n) => n.data.hidden).map((n) => n.data.label)).toEqual(['Valve'])
    expect(page.edges.filter((e) => e.data?.hidden).map((e) => page.nodes.find((n) => n.id === e.source)?.data.label)).toEqual(['Pump'])
  })
})

const unhide = <T extends ClassNode | RelationEdge>(item: T): T => ({ ...item, data: { ...item.data!, hidden: undefined } })
