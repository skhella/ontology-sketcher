import type { EntityDiff, OntologyDiff, Status } from './diff'
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
  /** What changed on each coloured class and ghost, by node id. */
  changes: Map<string, EntityDiff>
  /** Arrows on the page by edge id: arrows only the canvas has, and arrows of a property that changed. */
  edges: Map<string, Status>
  /** Classes only the file has, where it drew them on a page of the same name. */
  ghostNodes: ClassNode[]
  /** Arrows only the file has, whose two ends are on this page, as classes or ghosts. */
  ghostEdges: RelationEdge[]
}

/**
 * How `diff` shows on the page being drawn: which classes and arrows to colour, and what the file has that the canvas
 * doesn't, drawn as ghosts. The file is the earlier version (its extra classes are removed ones) unless `fileIsNewer`
 * (its extra classes are added ones, and the canvas's own extras are the removed ones).
 */
export function canvasDiff(
  diff: OntologyDiff,
  ws: Workspace,
  pageId: string,
  base: string,
  page: { nodes: ClassNode[]; edges: RelationEdge[] },
  fileIsNewer = false,
): CanvasDiff {
  const { classes, relations } = ws.store
  const iriOf = new Map(Object.entries(classes).map(([id, c]) => [id, entityIri(base, c, localName(c.label))]))
  const byIri = new Map(diff.entities.map((e) => [e.iri, e]))
  const status = new Map(diff.entities.map((e) => [e.iri, e.status]))
  const [canvasOnly, fileOnly]: Status[] = fileIsNewer ? ['removed', 'added'] : ['added', 'removed']
  const canvasArrows = new Set(diff.arrows.filter((a) => a.status === canvasOnly).map((a) => a.key))

  const nodes = new Map<string, Status>()
  const changes = new Map<string, EntityDiff>()
  for (const n of page.nodes) {
    const entity = byIri.get(iriOf.get(n.id) ?? '')
    if (entity) {
      nodes.set(n.id, entity.status)
      changes.set(n.id, entity)
    }
  }
  const edges = new Map<string, Status>()
  for (const e of page.edges) {
    const r = relations[e.id]
    if (!r) continue
    // The canvas label is what the layout and the triples both name an arrow by.
    if (canvasArrows.has(edgeKey(iriOf.get(e.source) ?? '', r.kind, r.label, iriOf.get(e.target) ?? ''))) edges.set(e.id, canvasOnly)
    else if (r.kind === 'objectProperty' && status.get(entityIri(base, r, propertyLocalName(r.label))) === 'changed') edges.set(e.id, 'changed')
  }

  // The earlier file's page with this page's name, or its only page when both versions have one page.
  const name = ws.pages.find((p) => p.id === pageId)?.name
  const pages = (fileIsNewer ? diff.newLayout : diff.oldLayout)?.pages ?? []
  const oldPage = pages.find((p) => p.name === name) ?? (pages.length === 1 && ws.pages.length === 1 ? pages[0] : undefined)
  const removed = new Map(diff.entities.filter((e) => e.status === fileOnly && e.kind === 'class').map((e) => [e.iri, e.label]))
  const ghostNodes: ClassNode[] = (oldPage?.nodes ?? [])
    .filter((n) => removed.has(n.iri))
    .map((n) => ({
      id: GHOST + n.iri,
      type: 'owlClass',
      position: { x: n.x, y: n.y },
      data: { label: removed.get(n.iri)!, style: { ...n.style, stroke: DIFF_COLORS[fileOnly], strokeStyle: 'dashed', fillStyle: 'hachure', fill: 'transparent' } },
      className: `diff-ghost diff-${fileOnly}`,
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    }))
  for (const g of ghostNodes) changes.set(g.id, byIri.get(g.id.slice(GHOST.length))!)
  const onPage = new Map(page.nodes.map((n) => [iriOf.get(n.id) ?? '', n.id]))
  for (const g of ghostNodes) onPage.set(g.id.slice(GHOST.length), g.id)
  const ghostEdges: RelationEdge[] = diff.arrows
    .filter((a) => a.status === fileOnly && onPage.has(a.source) && onPage.has(a.target))
    .map((a) => {
      const saved = oldPage?.edges.find((e) => edgeKey(e.source, e.kind, e.label, e.target) === a.key)
      return {
        id: GHOST + a.key,
        type: 'relation',
        source: onPage.get(a.source)!,
        target: onPage.get(a.target)!,
        sourceHandle: saved?.sourceHandle ?? 'top',
        targetHandle: saved?.targetHandle ?? 'bottom',
        data: { kind: a.kind as EdgeKind, label: a.label, style: { stroke: DIFF_COLORS[fileOnly], strokeStyle: 'dashed' } },
        className: `diff-ghost diff-${fileOnly}`,
        selectable: false,
        focusable: false,
      }
    })
  return { nodes, changes, edges, ghostNodes, ghostEdges }
}

/**
 * The file's pages that no canvas page shares a name with, holding classes only the file has: their ghosts have
 * nowhere to show until a page of that name exists. With one page on each side the two pages are matched anyway.
 */
export function pagesOnlyInFile(diff: OntologyDiff, ws: Workspace, fileIsNewer = false): string[] {
  const pages = (fileIsNewer ? diff.newLayout : diff.oldLayout)?.pages ?? []
  if (pages.length === 1 && ws.pages.length === 1) return []
  const fileOnly: Status = fileIsNewer ? 'added' : 'removed'
  const ghosts = new Set(diff.entities.filter((e) => e.status === fileOnly && e.kind === 'class').map((e) => e.iri))
  const names = new Set(ws.pages.map((p) => p.name))
  return pages.filter((p) => !names.has(p.name) && p.nodes.some((n) => ghosts.has(n.iri))).map((p) => p.name)
}
