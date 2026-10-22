import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, record, redo, startHistory, undo } from './history'
import { loadCanvas, saveCanvas } from './pages'
import { sampleProject, type Project } from './project'

/** The sample with every class on its page moved right by `dx`, as a group drag leaves it. */
function moved(project: Project, dx: number, extra: object = {}): Project {
  const canvas = loadCanvas(project.workspace, project.pageId)
  const nodes = canvas.nodes.map((n) => ({ ...n, ...extra, position: { x: n.position.x + dx, y: n.position.y } }))
  return { ...project, workspace: saveCanvas(project.workspace, project.pageId, nodes, canvas.edges) }
}

describe('history', () => {
  it('undoes and redoes a change, and a new change clears redo', () => {
    const start = sampleProject()
    const renamed = { ...start, iri: 'http://example.org/other#' }
    let h = record(startHistory(start), renamed)
    expect(h.past).toHaveLength(1)

    h = undo(h)!
    expect(h.present.iri).toBe(start.iri)
    expect(undo(h)).toBeNull()
    h = redo(h)!
    expect(h.present.iri).toBe('http://example.org/other#')
    expect(redo(h)).toBeNull()

    h = record(undo(h)!, moved(start, 50))
    expect(h.future).toHaveLength(0)
  })

  it('makes a group move one step, ignoring selection, drag state and measured sizes', () => {
    const start = sampleProject()
    const dragged = moved(start, 80, { dragging: true, measured: { width: 120, height: 60 } })
    const dropped = moved(start, 80, { dragging: false })
    let h = record(startHistory(start), dragged)
    h = record(h, dropped)
    expect(h.past).toHaveLength(1)
    expect(undo(h)!.present).toBe(start)
  })

  it('does not count switching pages as a change, but undo returns to the page the change was on', () => {
    const start = sampleProject()
    const second = { id: 'p2', name: 'Second', nodes: [], edges: [] }
    const withPage = { ...start, workspace: { ...start.workspace, pages: [...start.workspace.pages, second] } }
    let h = record(startHistory(start), withPage)
    const edited = moved(withPage, 30)
    h = record(h, edited)
    h = record(h, { ...edited, pageId: 'p2' })
    expect(h.past).toHaveLength(2)
    expect(undo(h)!.present.pageId).toBe(start.pageId)
  })

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let h = startHistory(sampleProject())
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) h = record(h, { ...h.present, iri: `http://example.org/v${i}#` })
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0].iri).toBe('http://example.org/v5#')
  })
})
