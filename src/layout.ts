import dagre from '@dagrejs/dagre'
import type { ClassNode, RelationEdge } from './model'
import { localName } from './model'
import { entityIri } from './owl'
import { loadCanvas, type Workspace } from './pages'
import { edgeKey, type SavedEdge, type SavedLayout, type SavedPage } from './savedLayout'
import { CLASS_HEIGHT, CLASS_WIDTH, nearestSide } from './sketch/snap'

/**
 * Places imported classes with a layered layout: superclasses above their subclasses, SKOS broader
 * concepts above narrower ones, and object properties pulling related classes close.
 * `keep` holds positions of classes already drawn (by node id); they stay put, and a new class sits
 * where the layout puts it relative to a kept neighbour, so re-importing an edited file only adds boxes.
 */
export function layoutOntology(nodes: ClassNode[], edges: RelationEdge[], keep = new Map<string, { x: number; y: number }>()): { nodes: ClassNode[]; edges: RelationEdge[] } {
  // Parent of each class in a hierarchy (its general end), and the classes below each parent.
  const parentOf = (e: RelationEdge): [string, string] | undefined =>
    e.data?.kind === 'narrower' ? [e.source, e.target] : HIERARCHY.has(e.data?.kind ?? '') ? [e.target, e.source] : undefined
  const childCount = new Map<string, number>()
  const parents = new Map<string, string[]>()
  for (const e of edges) {
    const pair = parentOf(e)
    if (!pair || pair[0] === pair[1]) continue
    childCount.set(pair[0], (childCount.get(pair[0]) ?? 0) + 1)
    parents.set(pair[1], [...(parents.get(pair[1]) ?? []), pair[0]])
  }
  // Many leaves under one parent would make one very wide row; they stack in columns under it instead.
  const leavesOf = new Map<string, string[]>()
  for (const n of nodes) {
    const up = parents.get(n.id)
    if (up?.length === 1 && !childCount.has(n.id)) leavesOf.set(up[0], [...(leavesOf.get(up[0]) ?? []), n.id])
  }
  for (const [parent, leaves] of leavesOf) if (leaves.length <= LEAF_ROW) leavesOf.delete(parent)
  const blockOf = new Map([...leavesOf].flatMap(([parent, leaves]) => leaves.map((l) => [l, `block:${parent}`] as const)))
  const at = (id: string) => blockOf.get(id) ?? id

  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) if (!blockOf.has(n.id)) g.setNode(n.id, { width: CLASS_WIDTH, height: CLASS_HEIGHT })
  for (const [parent, leaves] of leavesOf) {
    const { width, height } = leafGrid(leaves.length)
    g.setNode(`block:${parent}`, { width, height })
    g.setEdge(parent, `block:${parent}`, { weight: 4, minlen: 1 }, `block:${parent}`)
  }
  const inHierarchy = new Set(edges.filter((e) => HIERARCHY.has(e.data?.kind ?? '')).flatMap((e) => [e.source, e.target]))
  for (const e of edges) {
    if (blockOf.has(e.source) && parentOf(e)?.[1] === e.source) continue // drawn by the block's own edge
    const kind = e.data?.kind
    const [source, target] = [at(e.source), at(e.target)]
    if (source === target) continue
    // The general end goes on top: dagre ranks an edge's source above its target.
    if (kind === 'subClassOf' || kind === 'broader' || kind === 'topConceptOf') g.setEdge(target, source, { weight: 4, minlen: 1 }, e.id)
    else if (kind === 'narrower') g.setEdge(source, target, { weight: 4, minlen: 1 }, e.id)
    // Other arrows only rank a class that sits in no hierarchy, so properties between trees don't bend them.
    else if (!inHierarchy.has(e.source) || !inHierarchy.has(e.target)) g.setEdge(source, target, { weight: 1, minlen: 1 }, e.id)
  }
  dagre.layout(g)

  // dagre gives centres; the canvas wants top-left corners. Stacked leaves fill their block column by column.
  const laid = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    if (blockOf.has(n.id)) continue
    const { x, y } = g.node(n.id)
    laid.set(n.id, { x: x - CLASS_WIDTH / 2, y: y - CLASS_HEIGHT / 2 })
  }
  for (const [parent, leaves] of leavesOf) {
    const { x, y, width, height } = g.node(`block:${parent}`)
    const { indent } = leafGrid(leaves.length)
    leaves.forEach((id, i) => {
      const [column, row] = [Math.floor(i / LEAF_COLUMN), i % LEAF_COLUMN]
      laid.set(id, { x: x - width / 2 + indent + column * (CLASS_WIDTH + LEAF_GAP_X), y: y - height / 2 + row * (CLASS_HEIGHT + LEAF_GAP_Y) })
    })
  }

  // Shift new classes next to a kept neighbour, the same distance away as in the layout.
  const neighbours = new Map<string, string[]>()
  for (const e of edges) {
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target])
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source])
  }
  const position = new Map(laid)
  if (keep.size > 0) {
    for (const [id, p] of keep) if (position.has(id)) position.set(id, p)
    // Breadth-first from kept classes, so a chain of new classes follows the first kept one it reaches.
    const anchored = new Set([...keep.keys()].filter((id) => position.has(id)))
    const queue = [...anchored]
    while (queue.length > 0) {
      const id = queue.shift()!
      for (const next of neighbours.get(id) ?? []) {
        if (anchored.has(next)) continue
        const [from, to, base] = [laid.get(id)!, laid.get(next)!, position.get(id)!]
        position.set(next, { x: base.x + to.x - from.x, y: base.y + to.y - from.y })
        anchored.add(next)
        queue.push(next)
      }
    }
    // Classes with no path to a kept one go below everything already drawn.
    const bottom = Math.max(...[...keep.values()].map((p) => p.y)) + CLASS_HEIGHT + 120
    const top = Math.min(...[...laid.values()].map((p) => p.y))
    for (const n of nodes) if (!anchored.has(n.id)) position.set(n.id, { x: laid.get(n.id)!.x, y: bottom + laid.get(n.id)!.y - top })
  }

  const box = (id: string) => ({ id, ...position.get(id)!, width: CLASS_WIDTH, height: CLASS_HEIGHT })
  const centre = (id: string) => ({ x: position.get(id)!.x + CLASS_WIDTH / 2, y: position.get(id)!.y + CLASS_HEIGHT / 2 })
  // Hierarchy arrows run from the lower class's top dot to the upper one's bottom dot, as when drawn by hand;
  // other arrows attach to the dots facing each other.
  const handles = (e: RelationEdge): { sourceHandle: string; targetHandle: string; bend?: { x: number; y: number } } => {
    const pair = parentOf(e)
    if (pair && blockOf.has(pair[1])) {
      // A stacked leaf reaches up to its parent from its left dot.
      return pair[1] === e.source ? { sourceHandle: 'left', targetHandle: 'bottom' } : { sourceHandle: 'bottom', targetHandle: 'left' }
    }
    const vertical = HIERARCHY.has(e.data?.kind ?? '')
    if (vertical && centre(e.source).y !== centre(e.target).y) {
      const up = centre(e.source).y > centre(e.target).y
      return { sourceHandle: up ? 'top' : 'bottom', targetHandle: up ? 'bottom' : 'top' }
    }
    // A long arrow between classes in one row would run through the classes between them: arc it over the row.
    const [from, to] = [centre(e.source), centre(e.target)]
    if (!vertical && Math.abs(from.y - to.y) < CLASS_HEIGHT && Math.abs(from.x - to.x) > CLASS_WIDTH * 1.6) {
      arcs.set(e.source, (arcs.get(e.source) ?? 0) + 1)
      return { sourceHandle: 'top', targetHandle: 'top', bend: { x: 0, y: -40 - 30 * arcs.get(e.source)! } }
    }
    return { sourceHandle: nearestSide(box(e.source), to), targetHandle: nearestSide(box(e.target), from) }
  }
  const arcs = new Map<string, number>()
  return {
    nodes: nodes.map((n) => ({ ...n, position: position.get(n.id)! })),
    edges: edges.map((e) => {
      if (e.sourceHandle && e.targetHandle) return e
      const { bend, ...ends } = handles(e)
      return { ...e, ...ends, ...(bend && !e.data?.bend && { data: { ...e.data!, bend } }) }
    }),
  }
}

/** A class's or concept's IRI, for matching imported classes to ones already on the canvas. */
export function nodeIri(base: string, node: ClassNode): string {
  return entityIri(base, node.data, localName(node.data.label))
}

/** Arrows that build a hierarchy, drawn top to bottom and used to split large ontologies into pages. */
const HIERARCHY = new Set(['subClassOf', 'broader', 'narrower', 'topConceptOf'])

// More leaves than LEAF_ROW under one parent stack in columns of LEAF_COLUMN, indented right of the parent.
const LEAF_ROW = 5
const LEAF_COLUMN = 10
const LEAF_INDENT = 40
const LEAF_GAP_X = 40
const LEAF_GAP_Y = 24

/**
 * The block a parent's stacked leaves fill, as dagre sees it. dagre centres it under the parent, so the
 * columns start `indent` in from its left edge, just right of the parent's middle, like a file tree:
 * each leaf's arrow leaves from its left dot and runs up beside the column.
 */
function leafGrid(count: number): { width: number; height: number; indent: number } {
  const columns = Math.ceil(count / LEAF_COLUMN)
  const rows = Math.min(count, LEAF_COLUMN)
  const width = columns * CLASS_WIDTH + (columns - 1) * LEAF_GAP_X
  return { width: 2 * width + 2 * LEAF_INDENT, height: rows * CLASS_HEIGHT + (rows - 1) * LEAF_GAP_Y, indent: width + 2 * LEAF_INDENT }
}

/** An import with more classes than this, and no saved layout, is spread over pages; see `planImport`. */
export const PAGE_LIMIT = 60

/** The pages being exported, as a layout to send along with the Turtle (see savedLayout.ts). */
export function saveLayout(workspace: Workspace, pageIds: string[], base: string): SavedLayout {
  const iriOf = new Map(Object.entries(workspace.store.classes).map(([id, c]) => [id, entityIri(base, c, localName(c.label))]))
  const pages = workspace.pages
    .filter((p) => pageIds.includes(p.id))
    .map((page): SavedPage => {
      const canvas = loadCanvas(workspace, page.id)
      return {
        name: page.name,
        ...(page.classId && iriOf.has(page.classId) && { class: iriOf.get(page.classId) }),
        nodes: canvas.nodes.map((n) => ({ iri: iriOf.get(n.id)!, x: Math.round(n.position.x), y: Math.round(n.position.y), ...(n.data.style && { style: n.data.style }) })),
        edges: canvas.edges
          .filter((e) => e.data && iriOf.has(e.source) && iriOf.has(e.target))
          .map((e) => ({
            source: iriOf.get(e.source)!,
            kind: e.data!.kind,
            label: e.data!.label,
            target: iriOf.get(e.target)!,
            ...(e.sourceHandle && { sourceHandle: e.sourceHandle }),
            ...(e.targetHandle && { targetHandle: e.targetHandle }),
            ...(e.data!.style && { style: e.data!.style }),
            ...(e.data!.bend && { bend: e.data!.bend }),
          })),
      }
    })
  return { version: 1, pages }
}

/** A page an import fills: the first replaces the current page, the rest are added. */
export type PlannedPage = { name?: string; classId?: string; nodes: ClassNode[]; edges: RelationEdge[] }

type Group = { name?: string; classId?: string; ids: string[]; positions: Map<string, { x: number; y: number }>; looks?: Map<string, SavedEdge>; current?: boolean }

/**
 * Lays an imported ontology out on pages.
 * - Classes and arrows already in the workspace (same IRI, same kind) keep their ids, so other pages showing them stay linked.
 * - A file exported from here brings back its pages, positions and looks from its layout; classes the
 *   layout does not know (added elsewhere) go on its first page, next to a neighbour.
 * - Otherwise a small ontology fills the current page, and classes already on it keep their place and look.
 * - A large one (over `limit` classes) gets an overview page with the top of each hierarchy, then a page per branch.
 * Every arrow is drawn on at least one page, so nothing is lost when pages are saved.
 */
export function planImport(
  imported: { iri: string; nodes: ClassNode[]; edges: RelationEdge[]; layout?: SavedLayout },
  current: { iri: string; workspace: Workspace; pageId: string },
  limit = PAGE_LIMIT,
): { pages: PlannedPage[]; kept: number } {
  const { nodes, edges } = matchIds(imported, current)
  const iriOf = new Map(nodes.map((n) => [n.id, nodeIri(imported.iri, n)]))
  const idOf = new Map([...iriOf].map(([id, iri]) => [iri, id]))
  const page = current.workspace.pages.find((p) => p.id === current.pageId)
  const onPage = new Map(page?.nodes.map((n) => [n.id, n]) ?? [])
  let kept = 0

  let groups: Group[]
  if (imported.layout && imported.layout.pages.length > 0) {
    groups = imported.layout.pages.map((p) => ({
      name: p.name,
      classId: p.class ? idOf.get(p.class) : undefined,
      ids: p.nodes.map((n) => idOf.get(n.iri)).filter((id): id is string => !!id),
      positions: new Map(p.nodes.filter((n) => idOf.has(n.iri)).map((n) => [idOf.get(n.iri)!, { x: n.x, y: n.y }])),
      looks: new Map(p.edges.map((e) => [edgeKey(e.source, e.kind, e.label, e.target), e])),
    }))
    const styles = new Map(imported.layout.pages.flatMap((p) => p.nodes.filter((n) => n.style && idOf.has(n.iri)).map((n) => [idOf.get(n.iri)!, n.style!])))
    for (const n of nodes) if (styles.has(n.id)) n.data = { ...n.data, style: styles.get(n.id) }
    const placed = new Set(groups.flatMap((g) => g.ids))
    groups[0].ids.push(...nodes.filter((n) => !placed.has(n.id)).map((n) => n.id))
  } else if (nodes.length > limit) {
    groups = splitByBranch(nodes, edges, limit)
  } else {
    const positions = new Map(nodes.filter((n) => onPage.has(n.id)).map((n) => [n.id, onPage.get(n.id)!.position]))
    kept = positions.size
    groups = [{ ids: nodes.map((n) => n.id), positions, current: true }]
  }

  // An arrow whose classes share no page would be dropped when pages are saved: show its target next to its source.
  for (const e of edges) {
    if (groups.some((g) => g.ids.includes(e.source) && g.ids.includes(e.target))) continue
    const home = groups.find((g) => g.ids.includes(e.source)) ?? groups[0]
    if (!home.ids.includes(e.source)) home.ids.push(e.source)
    home.ids.push(e.target)
  }

  const known = new Set(groups.flatMap((g) => [...(g.looks?.keys() ?? [])]))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const pages = groups.map((g): PlannedPage => {
    const ids = new Set(g.ids)
    const groupNodes = [...ids].map((id) => {
      const n = byId.get(id)!
      // On the current page a class keeps its look; elsewhere it starts with the imported one.
      const style = g.current ? onPage.get(id)?.data.style : undefined
      return style ? { ...n, data: { ...n.data, style } } : n
    })
    const keyOf = (e: RelationEdge) => edgeKey(iriOf.get(e.source)!, e.data?.kind, e.data?.label, iriOf.get(e.target)!)
    // A saved page draws the arrows it drew before, and arrows the layout doesn't know yet.
    const groupEdges = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && (!g.looks || g.looks.has(keyOf(e)) || !known.has(keyOf(e))))
      .map((e) => {
        const old = g.current ? page?.edges.find((o) => o.id === e.id) : undefined
        const saved = g.looks?.get(keyOf(e))
        const look = old ? { ...old.data, sourceHandle: old.sourceHandle, targetHandle: old.targetHandle } : saved
        if (!look) return e
        return {
          ...e,
          sourceHandle: look.sourceHandle ?? undefined,
          targetHandle: look.targetHandle ?? undefined,
          data: { ...e.data!, ...(look.style && { style: look.style }), ...(look.bend && { bend: look.bend }) },
        }
      })
    return { ...(g.name && { name: g.name }), ...(g.classId && { classId: g.classId }), ...layoutOntology(groupNodes, groupEdges, g.positions) }
  })
  return { pages, kept }
}

/**
 * Gives imported classes and arrows the ids of the same ones already in the workspace, and rewrites every id
 * the data points at (axioms, schemes, inverse and parent properties) to match.
 */
function matchIds(
  imported: { iri: string; nodes: ClassNode[]; edges: RelationEdge[] },
  current: { iri: string; workspace: Workspace },
): { nodes: ClassNode[]; edges: RelationEdge[] } {
  const { classes, relations } = current.workspace.store
  const existing = new Map(Object.entries(classes).map(([id, c]) => [`${c.kind ?? 'class'} ${entityIri(current.iri, c, localName(c.label))}`, id]))
  const nodeIds = new Map<string, string>()
  for (const n of imported.nodes) {
    const old = existing.get(`${n.data.kind ?? 'class'} ${nodeIri(imported.iri, n)}`)
    if (old) nodeIds.set(n.id, old)
  }
  const node = (id: string) => nodeIds.get(id) ?? id
  const oldEdges = new Map(Object.entries(relations).map(([id, r]) => [edgeKey(r.source, r.kind, r.label, r.target), id]))
  const edgeIds = new Map<string, string>()
  for (const e of imported.edges) {
    const old = oldEdges.get(edgeKey(node(e.source), e.data?.kind, e.data?.label, node(e.target)))
    if (old) edgeIds.set(e.id, old)
  }
  const edge = (id: string) => edgeIds.get(id) ?? id

  const nodes: ClassNode[] = imported.nodes.map((n) => {
    const axioms = n.data.axioms?.map((a) => ({
      ...a,
      expression:
        a.expression.type === 'class'
          ? { ...a.expression, ref: node(a.expression.ref) }
          : { ...a.expression, property: edge(a.expression.property), ...(a.expression.filler && { filler: node(a.expression.filler) }) },
    }))
    return { ...n, id: node(n.id), data: { ...n.data, ...(axioms && { axioms }), ...(n.data.inScheme && { inScheme: n.data.inScheme.map(node) }) } }
  })
  const edges: RelationEdge[] = imported.edges.map((e) => ({
    ...e,
    id: edge(e.id),
    source: node(e.source),
    target: node(e.target),
    data: {
      ...e.data!,
      ...(e.data?.inverseOf && { inverseOf: edge(e.data.inverseOf) }),
      ...(e.data?.subPropertyOf && { subPropertyOf: edge(e.data.subPropertyOf) }),
    },
  }))
  return { nodes, edges }
}

/**
 * Pages for a large ontology: an overview with each hierarchy's root and its direct children, then one
 * page per root's branch. Branches bigger than `limit` get a page per child of the root (the root shown
 * on each); small branches share pages. Classes in no hierarchy share the last pages.
 */
function splitByBranch(nodes: ClassNode[], edges: RelationEdge[], limit: number): Group[] {
  const label = new Map(nodes.map((n) => [n.id, n.data.label]))
  const children = new Map<string, string[]>()
  const parent = new Map<string, string>()
  for (const e of edges) {
    if (!HIERARCHY.has(e.data?.kind ?? '')) continue
    const [child, up] = e.data?.kind === 'narrower' ? [e.target, e.source] : [e.source, e.target]
    if (child === up) continue
    if (!parent.has(child)) parent.set(child, up)
    children.set(up, [...(children.get(up) ?? []), child])
  }
  // The root of each class, following the first parent; a cycle stops where it closes.
  const rootOf = (id: string) => {
    const seen = new Set([id])
    let at = id
    while (parent.has(at) && !seen.has(parent.get(at)!)) seen.add((at = parent.get(at)!))
    return at
  }
  const branches = new Map<string, string[]>()
  for (const n of nodes) {
    const root = rootOf(n.id)
    branches.set(root, [...(branches.get(root) ?? []), n.id])
  }
  // Every class below `id`, `id` included.
  const below = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return []
    seen.add(id)
    return [id, ...(children.get(id) ?? []).flatMap((c) => below(c, seen))]
  }

  const roots = [...branches.keys()].filter((r) => branches.get(r)!.length > 1)
  const loose = [...branches.keys()].filter((r) => branches.get(r)!.length === 1)
  const overview = roots.flatMap((r) => [r, ...new Set(children.get(r) ?? [])])
  const groups: Group[] = [{ name: 'Overview', ids: [...new Set(overview.length <= limit ? overview : roots)], positions: new Map() }]

  // Pack branches (or a big branch's sub-branches) onto pages of at most `limit` classes, largest first.
  const parts: { root: string; sub?: string; ids: string[] }[] = []
  for (const r of roots.sort((a, b) => branches.get(b)!.length - branches.get(a)!.length)) {
    if (branches.get(r)!.length <= limit) parts.push({ root: r, ids: branches.get(r)! })
    else for (const c of new Set(children.get(r) ?? [])) parts.push({ root: r, sub: c, ids: [r, ...below(c, new Set([r]))] })
  }
  const packed: { parts: typeof parts; ids: string[] }[] = []
  for (const part of parts) {
    const room = packed.find((g) => new Set([...g.ids, ...part.ids]).size <= limit)
    if (room) {
      room.parts.push(part)
      room.ids.push(...part.ids)
    } else packed.push({ parts: [part], ids: [...part.ids] })
  }
  // Named after its roots, each with the sub-branches it holds: "Animal (Mammal, Bird +3) · Plant".
  const nameOf = (pageParts: typeof parts) =>
    [...new Set(pageParts.map((p) => p.root))]
      .map((r) => {
        const subs = pageParts.filter((p) => p.root === r && p.sub).map((p) => label.get(p.sub!)!)
        if (subs.length === 0) return label.get(r)!
        return `${label.get(r)} (${subs.slice(0, 2).join(', ')}${subs.length > 2 ? ` +${subs.length - 2}` : ''})`
      })
      .join(' · ')
  for (const g of packed) groups.push({ name: nameOf(g.parts), ids: [...new Set(g.ids)], positions: new Map() })
  for (let i = 0; i < loose.length; i += limit) groups.push({ name: 'Other classes', ids: loose.slice(i, i + limit), positions: new Map() })
  return groups
}
