import type { ClassNode, Mapping, MappingKind, RelationEdge } from '../model'
import { conceptSchemes, MAPPING_KINDS } from '../skos'
import { expandIri } from '../vocab'

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

/** Links from a concept to concepts in other vocabularies, e.g. skos:exactMatch a Wikidata item. */
export function ConceptMappings({ base, mappings, onChange }: { base: string; mappings: Mapping[]; onChange: (next: Mapping[] | undefined) => void }) {
  const set = (next: Mapping[]) => onChange(next.length > 0 ? next : undefined)
  const update = (at: number, patch: Partial<Mapping>) => set(mappings.map((m, i) => (i === at ? { ...m, ...patch } : m)))
  return (
    <fieldset className="mappings">
      <legend>Mappings to other vocabularies</legend>
      {mappings.map((m, i) => (
        <div className="mapping" key={i}>
          <select value={m.kind} onChange={(e) => update(i, { kind: e.target.value as MappingKind })} aria-label="Mapping property">
            {MAPPING_KINDS.map((k) => (
              <option key={k} value={k}>
                skos:{k}
              </option>
            ))}
          </select>
          <input value={m.iri} placeholder="https://… or prefix:name" title={m.iri.trim() ? expandIri(m.iri, base) : undefined} onChange={(e) => update(i, { iri: e.target.value })} aria-label="Mapped concept IRI" />
          <button className="remove" aria-label={`Remove skos:${m.kind}`} onClick={() => set(mappings.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button onClick={() => set([...mappings, { kind: 'exactMatch', iri: '' }])}>+ Mapping</button>
    </fieldset>
  )
}
