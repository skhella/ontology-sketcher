import type { Namespace } from './model'
import { suggestPrefix } from './namespaces'

type Props = {
  namespaces: Namespace[]
  /** `renamed` is set when an entry's IRI changed, so classes and properties in it can follow. */
  onChange: (namespaces: Namespace[], renamed?: { from: string; to: string }) => void
}

/** Toolbar menu listing the namespaces classes and properties can live in besides the ontology's own, e.g. reference data libraries. */
export function NamespacesMenu({ namespaces, onChange }: Props) {
  const update = (i: number, patch: Partial<Namespace>) => {
    const next = namespaces.map((n, j) => (j === i ? { ...n, ...patch } : n))
    onChange(next, patch.iri !== undefined ? { from: namespaces[i].iri, to: patch.iri } : undefined)
  }
  const add = () => onChange([...namespaces, { prefix: suggestPrefix('', namespaces.map((n) => n.prefix)), iri: 'http://example.org/library#' }])

  return (
    <details className="menu namespaces">
      <summary title="Namespaces classes and properties can live in besides the ontology's own, e.g. one per reference data library">
        Namespaces{namespaces.length > 0 ? ` (${namespaces.length})` : ''}
      </summary>
      <div className="menu-items">
        {namespaces.map((n, i) => (
          <span key={i} className="namespace-row">
            <input value={n.prefix} size={6} aria-label="Prefix" onChange={(e) => update(i, { prefix: e.target.value.trim() })} />
            <input value={n.iri} size={30} aria-label="Namespace IRI" onChange={(e) => update(i, { iri: e.target.value.trim() })} />
            <button onClick={() => onChange(namespaces.filter((_, j) => j !== i))} aria-label={`Remove ${n.prefix}`} title="Remove from the list; classes in it keep their IRIs">
              ×
            </button>
          </span>
        ))}
        <button onClick={add}>+ Namespace</button>
        <span className="menu-note">Pick one per class or property in the inspector. New classes go in the ontology IRI.</span>
      </div>
    </details>
  )
}
