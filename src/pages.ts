import type { ClassData, ClassNode, Ontology, RelationData, RelationEdge } from './model'

/**
 * Pages work like views in Archi or Enterprise Architect: classes and relations live once in a
 * shared store, and a page only places them. The same class (same node id, same IRI) can sit on
 * several pages; editing it on one page edits it everywhere, while position, size, colours and
 * curves stay per page.
 */

/** Everything about a class except how one page draws it. */
export type ClassEntity = Omit<ClassData, 'style'>
/** Everything about a relation except how one page draws it. */
export type RelationEntity = Omit<RelationData, 'style' | 'bend'> & { source: string; target: string }

export type Store = { classes: Record<string, ClassEntity>; relations: Record<string, RelationEntity> }

/** A canvas node or edge with only its page-specific data left in `data`. */
export type NodePlacement = Omit<ClassNode, 'data'> & { data: Pick<ClassData, 'style'> }
export type EdgePlacement = Omit<RelationEdge, 'data'> & { data: Pick<RelationData, 'style' | 'bend'> }

export type Page = { id: string; name: string; nodes: NodePlacement[]; edges: EdgePlacement[] }

export type Workspace = { store: Store; pages: Page[] }

/** Builds a one-page workspace from a canvas. */
export function workspaceFrom(name: string, nodes: ClassNode[], edges: RelationEdge[]): { workspace: Workspace; pageId: string } {
  const pageId = crypto.randomUUID()
  const empty: Workspace = { store: { classes: {}, relations: {} }, pages: [{ id: pageId, name, nodes: [], edges: [] }] }
  return { workspace: saveCanvas(empty, pageId, nodes, edges), pageId }
}

/**
 * Writes the active page's canvas back into the workspace: entity data goes to the shared store,
 * the rest becomes that page's placements. Classes and relations no page places any more are
 * dropped, so deleting a class from the last page that shows it deletes it from the ontology.
 */
export function saveCanvas(workspace: Workspace, pageId: string, nodes: ClassNode[], edges: RelationEdge[]): Workspace {
  const classes = { ...workspace.store.classes }
  const relations = { ...workspace.store.relations }
  const placedNodes: NodePlacement[] = []
  const placedEdges: EdgePlacement[] = []

  for (const node of nodes) {
    const { style, ...entity } = node.data
    classes[node.id] = entity
    placedNodes.push({ ...node, selected: false, data: style ? { style } : {} })
  }
  for (const edge of edges) {
    if (!edge.data) continue
    const { style, bend, ...entity } = edge.data
    relations[edge.id] = { ...entity, source: edge.source, target: edge.target }
    placedEdges.push({ ...edge, selected: false, markerEnd: undefined, data: { ...(style && { style }), ...(bend && { bend }) } })
  }

  const pages = workspace.pages.map((p) => (p.id === pageId ? { ...p, nodes: placedNodes, edges: placedEdges } : p))
  return { store: prune({ classes, relations }, pages), pages }
}

function prune(store: Store, pages: Page[]): Store {
  const nodeIds = new Set(pages.flatMap((p) => p.nodes.map((n) => n.id)))
  const edgeIds = new Set(pages.flatMap((p) => p.edges.map((e) => e.id)))
  const classes = Object.fromEntries(Object.entries(store.classes).filter(([id]) => nodeIds.has(id)))
  const relations = Object.fromEntries(
    Object.entries(store.relations).filter(([id, r]) => edgeIds.has(id) && nodeIds.has(r.source) && nodeIds.has(r.target)),
  )
  return { classes, relations }
}

/** The canvas for one page: its placements filled in with the shared entity data. */
export function loadCanvas(workspace: Workspace, pageId: string): { nodes: ClassNode[]; edges: RelationEdge[] } {
  const page = workspace.pages.find((p) => p.id === pageId)
  if (!page) return { nodes: [], edges: [] }
  const { classes, relations } = workspace.store
  const nodes: ClassNode[] = page.nodes
    .filter((n) => classes[n.id])
    .map((n) => ({ ...n, data: { ...classes[n.id], ...n.data } }))
  const edges: RelationEdge[] = page.edges
    .filter((e) => relations[e.id])
    .map((e) => {
      const { source, target, ...entity } = relations[e.id]
      return { ...e, source, target, data: { ...entity, ...e.data } }
    })
  return { nodes, edges }
}

/** Classes in the store that the page does not show yet, for placing them there. */
export function classesNotOn(workspace: Workspace, pageId: string): { id: string; label: string }[] {
  const page = workspace.pages.find((p) => p.id === pageId)
  const onPage = new Set(page?.nodes.map((n) => n.id))
  return Object.entries(workspace.store.classes)
    .filter(([id]) => !onPage.has(id))
    .map(([id, c]) => ({ id, label: c.label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Places an existing class on a page, and with it every stored relation between that class and
 * classes already on the page (Archi does the same when you drag an element into a view).
 * Each relation keeps the handles and curve of the first page that draws it.
 */
export function placeClass(workspace: Workspace, pageId: string, classId: string, position: { x: number; y: number }): Workspace {
  const page = workspace.pages.find((p) => p.id === pageId)
  if (!page || !workspace.store.classes[classId] || page.nodes.some((n) => n.id === classId)) return workspace

  const source = workspace.pages.flatMap((p) => p.nodes).find((n) => n.id === classId)
  const node: NodePlacement = { id: classId, type: 'owlClass', position, data: source?.data.style ? { style: source.data.style } : {} }
  const onPage = new Set([...page.nodes.map((n) => n.id), classId])
  const drawn = new Set(page.edges.map((e) => e.id))
  const newEdges: EdgePlacement[] = Object.entries(workspace.store.relations)
    .filter(([id, r]) => !drawn.has(id) && onPage.has(r.source) && onPage.has(r.target) && (r.source === classId || r.target === classId))
    .map(([id, r]) => {
      const elsewhere = workspace.pages.flatMap((p) => p.edges).find((e) => e.id === id)
      const { bend: _bend, ...look } = elsewhere?.data ?? {}
      return {
        id,
        type: 'relation',
        source: r.source,
        target: r.target,
        sourceHandle: elsewhere?.sourceHandle,
        targetHandle: elsewhere?.targetHandle,
        data: look,
      }
    })

  const pages = workspace.pages.map((p) => (p.id === pageId ? { ...p, nodes: [...p.nodes, node], edges: [...p.edges, ...newEdges] } : p))
  return { ...workspace, pages }
}

/**
 * The ontology to export from the chosen pages, as one merged model: every class placed on a
 * chosen page, and every relation drawn on a chosen page. A relation drawn only on pages left
 * out is not exported, even if both its classes are. Each class and relation appears once, however
 * many chosen pages show it.
 */
export function mergePages(workspace: Workspace, pageIds: string[], iri: string): Ontology {
  const chosen = new Set(pageIds)
  const merged: Workspace = { ...workspace, pages: workspace.pages.filter((p) => chosen.has(p.id)) }
  const nodes = new Map<string, ClassNode>()
  const edges = new Map<string, RelationEdge>()
  for (const page of merged.pages) {
    const canvas = loadCanvas(merged, page.id)
    for (const n of canvas.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n)
    for (const e of canvas.edges) if (!edges.has(e.id)) edges.set(e.id, e)
  }
  return { iri, nodes: [...nodes.values()], edges: [...edges.values()] }
}

/** Deletes a page; classes and relations only that page showed leave the ontology with it. */
export function removePage(workspace: Workspace, pageId: string): Workspace {
  const pages = workspace.pages.filter((p) => p.id !== pageId)
  return { store: prune(workspace.store, pages), pages }
}
