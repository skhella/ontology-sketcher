import dagre from '@dagrejs/dagre'
import type { ClassNode, RelationEdge } from './model'
import { localName } from './model'
import { entityIri } from './owl'
import { CLASS_HEIGHT, CLASS_WIDTH, nearestSide } from './sketch/snap'

/**
 * Places imported classes with a layered layout: superclasses above their subclasses, SKOS broader
 * concepts above narrower ones, and object properties pulling related classes close.
 * `keep` holds positions of classes already drawn (by node id); they stay put, and a new class sits
 * where the layout puts it relative to a kept neighbour, so re-importing an edited file only adds boxes.
 */
export function layoutOntology(nodes: ClassNode[], edges: RelationEdge[], keep = new Map<string, { x: number; y: number }>()): { nodes: ClassNode[]; edges: RelationEdge[] } {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: CLASS_WIDTH, height: CLASS_HEIGHT })
  const hierarchy = new Set(['subClassOf', 'broader', 'narrower', 'topConceptOf'])
  const inHierarchy = new Set(edges.filter((e) => hierarchy.has(e.data?.kind ?? '')).flatMap((e) => [e.source, e.target]))
  for (const e of edges) {
    const kind = e.data?.kind
    // The general end goes on top: dagre ranks an edge's source above its target.
    if (kind === 'subClassOf' || kind === 'broader' || kind === 'topConceptOf') g.setEdge(e.target, e.source, { weight: 4, minlen: 1 }, e.id)
    else if (kind === 'narrower') g.setEdge(e.source, e.target, { weight: 4, minlen: 1 }, e.id)
    // Other arrows only rank a class that sits in no hierarchy, so properties between trees don't bend them.
    else if (!inHierarchy.has(e.source) || !inHierarchy.has(e.target)) g.setEdge(e.source, e.target, { weight: 1, minlen: 1 }, e.id)
  }
  dagre.layout(g)

  // dagre gives centres; the canvas wants top-left corners.
  const laid = new Map(nodes.map((n) => {
    const { x, y } = g.node(n.id)
    return [n.id, { x: x - CLASS_WIDTH / 2, y: y - CLASS_HEIGHT / 2 }]
  }))

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
  const handles = (e: RelationEdge) => {
    const vertical = hierarchy.has(e.data?.kind ?? '')
    if (vertical && centre(e.source).y !== centre(e.target).y) {
      const up = centre(e.source).y > centre(e.target).y
      return { sourceHandle: up ? 'top' : 'bottom', targetHandle: up ? 'bottom' : 'top' }
    }
    return { sourceHandle: nearestSide(box(e.source), centre(e.target)), targetHandle: nearestSide(box(e.target), centre(e.source)) }
  }
  return {
    nodes: nodes.map((n) => ({ ...n, position: position.get(n.id)! })),
    edges: edges.map((e) => (e.sourceHandle && e.targetHandle ? e : { ...e, ...handles(e) })),
  }
}

/** A class's or concept's IRI, for matching imported classes to ones already on the canvas. */
export function nodeIri(base: string, node: ClassNode): string {
  return entityIri(base, node.data, localName(node.data.label))
}

/**
 * Lays out an imported ontology onto the current page. Classes whose IRI is already on the page keep
 * their node id, position and look, and arrows already drawn between the same classes keep theirs;
 * everything else is placed by `layoutOntology`. Each side's `iri` is the namespace its classes were named in.
 */
export function placeImport(
  imported: { iri: string; nodes: ClassNode[]; edges: RelationEdge[] },
  current: { iri: string; nodes: ClassNode[]; edges: RelationEdge[] },
): { nodes: ClassNode[]; edges: RelationEdge[]; kept: number } {
  const existing = new Map(current.nodes.map((n) => [nodeIri(current.iri, n), n]))
  const nodeIds = new Map<string, string>() // imported id → id on the page
  for (const n of imported.nodes) {
    const old = existing.get(nodeIri(imported.iri, n))
    if (old && (old.data.kind ?? 'class') === (n.data.kind ?? 'class')) nodeIds.set(n.id, old.id)
  }
  const node = (id: string) => nodeIds.get(id) ?? id
  const edgeKey = (e: RelationEdge, map: (id: string) => string) => `${map(e.source)} ${e.data?.kind} ${e.data?.label} ${map(e.target)}`
  const oldEdges = new Map(current.edges.map((e) => [edgeKey(e, (id) => id), e]))
  const edgeIds = new Map<string, string>()
  for (const e of imported.edges) {
    const old = oldEdges.get(edgeKey(e, node))
    if (old) edgeIds.set(e.id, old.id)
  }
  const edge = (id: string) => edgeIds.get(id) ?? id

  // Rewrites every id the data points at: axioms, schemes, inverse and parent properties.
  const nodes: ClassNode[] = imported.nodes.map((n) => {
    const old = current.nodes.find((o) => o.id === nodeIds.get(n.id))
    const axioms = n.data.axioms?.map((a) => ({
      ...a,
      expression:
        a.expression.type === 'class'
          ? { ...a.expression, ref: node(a.expression.ref) }
          : { ...a.expression, property: edge(a.expression.property), ...(a.expression.filler && { filler: node(a.expression.filler) }) },
    }))
    const data = { ...n.data, ...(axioms && { axioms }), ...(n.data.inScheme && { inScheme: n.data.inScheme.map(node) }), ...(old?.data.style && { style: old.data.style }) }
    return { ...n, id: node(n.id), data }
  })
  const edges: RelationEdge[] = imported.edges.map((e) => {
    const old = current.edges.find((o) => o.id === edgeIds.get(e.id))
    const data = {
      ...e.data!,
      ...(e.data?.inverseOf && { inverseOf: edge(e.data.inverseOf) }),
      ...(e.data?.subPropertyOf && { subPropertyOf: edge(e.data.subPropertyOf) }),
      ...(old?.data?.style && { style: old.data.style }),
      ...(old?.data?.bend && { bend: old.data.bend }),
    }
    return { ...e, id: edge(e.id), source: node(e.source), target: node(e.target), sourceHandle: old?.sourceHandle, targetHandle: old?.targetHandle, data }
  })

  const keep = new Map(current.nodes.filter((n) => [...nodeIds.values()].includes(n.id)).map((n) => [n.id, n.position]))
  return { ...layoutOntology(nodes, edges, keep), kept: keep.size }
}
