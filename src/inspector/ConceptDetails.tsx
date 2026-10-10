import type { ClassNode, RelationEdge } from '../model'
import { conceptSchemes } from '../skos'

type Props = {
  node: ClassNode
  nodes: ClassNode[]
  edges: RelationEdge[]
  onChange: (inScheme: string[] | undefined) => void
}

/**
 * The schemes a concept is in. Ticked boxes are its own skos:inScheme choices; a scheme its hierarchy
 * already reaches through a top concept (or the only scheme there is) shows ticked and greyed out.
 */
export function ConceptSchemes({ node, nodes, edges, onChange }: Props) {
  const schemes = nodes.filter((n) => n.data.kind === 'scheme')
  if (schemes.length === 0) return <p className="muted">Add a concept scheme (+ Scheme) to put this concept in it.</p>

  const own = new Set(node.data.inScheme ?? [])
  const withoutOwn = conceptSchemes(
    nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, inScheme: [] } } : n)),
    edges,
  ).get(node.id)!
  const toggle = (id: string) => {
    const next = own.has(id) ? [...own].filter((s) => s !== id) : [...own, id]
    onChange(next.length > 0 ? next : undefined)
  }

  return (
    <fieldset className="concept-schemes">
      <legend>In scheme (skos:inScheme)</legend>
      {schemes.map((s) => {
        const derived = withoutOwn.has(s.id) && !own.has(s.id)
        return (
          <label key={s.id} title={derived ? 'From a top concept of this hierarchy, or the only scheme' : undefined}>
            <input type="checkbox" checked={own.has(s.id) || derived} disabled={derived} onChange={() => toggle(s.id)} /> {s.data.label}
            {derived && <span className="muted"> (from hierarchy)</span>}
          </label>
        )
      })}
    </fieldset>
  )
}

/** A scheme's top concepts and how many concepts it holds, on this page. */
export function SchemeSummary({ node, nodes, edges }: Omit<Props, 'onChange'>) {
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?'
  const tops = edges.filter((e) => e.data?.kind === 'topConceptOf' && e.target === node.id).map((e) => labelOf(e.source))
  const members = [...conceptSchemes(nodes, edges).values()].filter((s) => s.has(node.id)).length
  return (
    <fieldset className="concept-schemes">
      <legend>Scheme contents (this page)</legend>
      <span className="keyword">top concepts</span> {tops.length > 0 ? tops.join(', ') : 'none: draw an arrow from a concept to this scheme'}
      <br />
      <span className="keyword">concepts</span> {members}
    </fieldset>
  )
}
