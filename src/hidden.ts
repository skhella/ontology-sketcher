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
