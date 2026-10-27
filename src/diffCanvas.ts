import type { OntologyDiff, Status } from './diff'
import { localName, propertyLocalName, type ClassNode, type EdgeKind, type RelationEdge } from './model'
import { entityIri } from './owl'
import type { Workspace } from './pages'
import { edgeKey } from './savedLayout'

/** Excalidraw's green, orange and red, for added, changed and removed. */
export const DIFF_COLORS: Record<Status, string> = { added: '#2f9e44', changed: '#f08c00', removed: '#e03131' }

/** Ghost classes and arrows are drawn only, never kept: their ids start with this. */
export const GHOST = 'diff-ghost:'

export type CanvasDiff = {
  /** Classes on the page by node id. */
  nodes: Map<string, Status>
  /** Arrows on the page by edge id: added arrows, and arrows of a property that changed. */
  edges: Map<string, Status>
  /** Removed classes where the earlier file drew them on a page of the same name. */
  ghostNodes: ClassNode[]
  /** Removed arrows whose two ends are on this page, as classes or ghosts. */
  ghostEdges: RelationEdge[]
}

/** How `diff` shows on the page being drawn: which classes and arrows to colour, and what to draw that is gone. */
export function canvasDiff(diff: OntologyDiff, ws: Workspace, pageId: string, base: string, page: { nodes: ClassNode[]; edges: RelationEdge[] }): CanvasDiff {
  const { classes, relations } = ws.store
  const iriOf = new Map(Object.entries(classes).map(([id, c]) => [id, entityIri(base, c, localName(c.label))]))
  const status = new Map(diff.entities.map((e) => [e.iri, e.status]))
  const addedArrows = new Set(diff.arrows.filter((a) => a.status === 'added').map((a) => a.key))

  const nodes = new Map<string, Status>()
  for (const n of page.nodes) {
    const s = status.get(iriOf.get(n.id) ?? '')
    if (s) nodes.set(n.id, s)
  }
  const edges = new Map<string, Status>()
  for (const e of page.edges) {
    const r = relations[e.id]
    if (!r) continue
    // The canvas label is what the layout and the triples both name an arrow by.
    if (addedArrows.has(edgeKey(iriOf.get(e.source) ?? '', r.kind, r.label, iriOf.get(e.target) ?? ''))) edges.set(e.id, 'added')
    else if (r.kind === 'objectProperty' && status.get(entityIri(base, r, propertyLocalName(r.label))) === 'changed') edges.set(e.id, 'changed')
  }

  // The earlier file's page with this page's name, or its only page when both versions have one page.
  const name = ws.pages.find((p) => p.id === pageId)?.name
  const pages = diff.oldLayout?.pages ?? []
  const oldPage = pages.find((p) => p.name === name) ?? (pages.length === 1 && ws.pages.length === 1 ? pages[0] : undefined)
  const removed = new Map(diff.entities.filter((e) => e.status === 'removed' && e.kind === 'class').map((e) => [e.iri, e.label]))
  const ghostNodes: ClassNode[] = (oldPage?.nodes ?? [])
    .filter((n) => removed.has(n.iri))
    .map((n) => ({
      id: GHOST + n.iri,
      type: 'owlClass',
      position: { x: n.x, y: n.y },
      data: { label: removed.get(n.iri)!, style: { ...n.style, stroke: DIFF_COLORS.removed, strokeStyle: 'dashed', fillStyle: 'hachure', fill: 'transparent' } },
      className: 'diff-removed',
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    }))
  const onPage = new Map(page.nodes.map((n) => [iriOf.get(n.id) ?? '', n.id]))
  for (const g of ghostNodes) onPage.set(g.id.slice(GHOST.length), g.id)
  const ghostEdges: RelationEdge[] = diff.arrows
    .filter((a) => a.status === 'removed' && onPage.has(a.source) && onPage.has(a.target))
    .map((a) => {
      const saved = oldPage?.edges.find((e) => edgeKey(e.source, e.kind, e.label, e.target) === a.key)
      return {
        id: GHOST + a.key,
        type: 'relation',
        source: onPage.get(a.source)!,
        target: onPage.get(a.target)!,
        sourceHandle: saved?.sourceHandle ?? 'top',
        targetHandle: saved?.targetHandle ?? 'bottom',
        data: { kind: a.kind as EdgeKind, label: a.label, style: { stroke: DIFF_COLORS.removed, strokeStyle: 'dashed' } },
        className: 'diff-removed',
        selectable: false,
        focusable: false,
      }
    })
  return { nodes, edges, ghostNodes, ghostEdges }
}
