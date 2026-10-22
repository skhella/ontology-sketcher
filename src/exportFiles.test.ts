import { Parser } from 'n3'
import { describe, expect, it } from 'vitest'
import { exportFiles, exportFilesPerPage, pageFileStems } from './exportFiles'
import type { ClassNode, RelationEdge } from './model'
import { placeClass, saveCanvas, workspaceFrom, type Workspace } from './pages'
import { LAYOUT_PROPERTY } from './savedLayout'

const IRI = 'http://example.org/plant#'
const cls = (id: string, label: string): ClassNode => ({ id, type: 'owlClass', position: { x: 0, y: 0 }, data: { label } })
const sco = (id: string, source: string, target: string): RelationEdge => ({ id, type: 'relation', source, target, data: { kind: 'subClassOf', label: '' } })
const context = { iri: IRI, namespaces: [], kept: [], keptStatements: [] }

/** Equipment on both pages; Pump under it on the first, Valve under it on the second. */
function twoPages(): Workspace {
  const { workspace, pageId } = workspaceFrom('Pumps', [cls('equipment', 'Equipment'), cls('pump', 'Pump')], [sco('p', 'pump', 'equipment')])
  let ws: Workspace = { ...workspace, pages: [...workspace.pages, { id: 'valves', name: 'Valves', nodes: [], edges: [] }] }
  ws = placeClass(ws, 'valves', 'equipment', { x: 0, y: 0 })
  ws = saveCanvas(ws, 'valves', [cls('equipment', 'Equipment'), cls('valve', 'Valve')], [sco('v', 'valve', 'equipment')])
  return { ...ws, pages: ws.pages.map((p) => (p.id === pageId ? { ...p, id: 'pumps' } : p)) }
}

const triples = (turtle: string) =>
  new Parser()
    .parse(turtle)
    .filter((q) => q.predicate.value !== LAYOUT_PROPERTY)
    .map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`)
    .sort()

describe('exportFilesPerPage', () => {
  it('writes each page as if it were exported alone, the shared class in both files', async () => {
    const ws = twoPages()
    const files = await exportFilesPerPage('owl', ws, ['pumps', 'valves'], context)
    expect(files.map((f) => [f.name, f.label])).toEqual([
      ['Pumps.ttl', 'Pumps (OWL)'],
      ['Valves.ttl', 'Valves (OWL)'],
    ])
    for (const [file, id] of [[files[0], 'pumps'], [files[1], 'valves']] as const) {
      const [alone] = await exportFiles('owl', ws, [id], context)
      expect(file.text).toBe(alone.text)
    }
    expect(files[0].text).toContain(':Equipment')
    expect(files[1].text).toContain(':Equipment')
    expect(files[0].text).not.toContain(':Valve')
    expect(files[1].text).not.toContain(':Pump')
  })

  it('adds no statement the merged export does not have', async () => {
    const ws = twoPages()
    const [merged] = await exportFiles('owl', ws, ['pumps', 'valves'], context)
    const parts = await exportFilesPerPage('owl', ws, ['pumps', 'valves'], context)
    const all = new Set(triples(merged.text))
    for (const part of parts) for (const t of triples(part.text)) expect(all).toContain(t)
  })

  it('leaves out pages not chosen', async () => {
    const files = await exportFilesPerPage('cypher', twoPages(), ['valves'], context)
    expect(files.map((f) => f.name)).toEqual(['Valves.cypher'])
  })
})

describe('pageFileStems', () => {
  it('makes file names from page names, unique without regard to case', () => {
    const stems = pageFileStems([
      { id: 'a', name: 'Prozess / Übersicht' },
      { id: 'b', name: 'prozess übersicht' },
      { id: 'c', name: '  ' },
      { id: 'd', name: 'v1.2' },
    ])
    expect([...stems.values()]).toEqual(['Prozess-Übersicht', 'prozess-übersicht-2', 'page', 'v1-2'])
  })
})
