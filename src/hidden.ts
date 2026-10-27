import type { ClassNode, RelationEdge } from './model'

/**
 * Classes and arrows can be hidden on a page, to draw it with less on it: the canvas leaves them out unless
 * hidden elements are shown, and so does the page's SVG image. An arrow is hidden with either of its classes.
 * Being hidden is only how a page draws them; the OWL, SHACL and Cypher exports include them all the same.
 */
export function hiddenOn(nodes: ClassNode[], edges: RelationEdge[]): { nodes: Set<string>; edges: Set<string> } {
  const hiddenNodes = new Set(nodes.filter((n) => n.data.hidden).map((n) => n.id))
  const hiddenEdges = new Set(edges.filter((e) => e.data?.hidden || hiddenNodes.has(e.source) || hiddenNodes.has(e.target)).map((e) => e.id))
  return { nodes: hiddenNodes, edges: hiddenEdges }
}

/** The page as drawn while hidden elements are not shown. */
export function withoutHidden(nodes: ClassNode[], edges: RelationEdge[]): { nodes: ClassNode[]; edges: RelationEdge[] } {
  const hidden = hiddenOn(nodes, edges)
  return { nodes: nodes.filter((n) => !hidden.nodes.has(n.id)), edges: edges.filter((e) => !hidden.edges.has(e.id)) }
}

/** A class or arrow marked hidden on a page, as the list of hidden elements shows it. */
export type HiddenEntry = { id: string; kind: 'class' | 'arrow'; label: string }

/**
 * What is marked hidden on the page: classes first, then arrows, each by name. Arrows hidden only because a class
 * of theirs is are left out, since they come back with their class.
 */
export function hiddenEntries(nodes: ClassNode[], edges: RelationEdge[]): HiddenEntry[] {
  const names = new Map(nodes.map((n) => [n.id, n.data.label]))
  const byLabel = (a: HiddenEntry, b: HiddenEntry) => a.label.localeCompare(b.label)
  const classes = nodes.filter((n) => n.data.hidden).map((n): HiddenEntry => ({ id: n.id, kind: 'class', label: n.data.label }))
  const arrows = edges
    .filter((e) => e.data?.hidden)
    .map((e): HiddenEntry => {
      const name = e.data!.label || e.data!.kind
      return { id: e.id, kind: 'arrow', label: `${names.get(e.source) ?? e.source} → ${name} → ${names.get(e.target) ?? e.target}` }
    })
  return [...classes.sort(byLabel), ...arrows.sort(byLabel)]
}

/** The page with the classes and arrows whose ids are given no longer marked hidden. */
export function unhideIds(nodes: ClassNode[], edges: RelationEdge[], ids: Set<string>): { nodes: ClassNode[]; edges: RelationEdge[] } {
  const clear = <T extends ClassNode | RelationEdge>(item: T): T =>
    ids.has(item.id) && item.data?.hidden ? { ...item, data: { ...item.data, hidden: undefined } } : item
  return { nodes: nodes.map(clear), edges: edges.map(clear) }
}
