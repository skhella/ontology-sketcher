import { useState } from 'react'
import type { ClassNode, PropertyValue, RelationEdge } from '../model'
import { shortName, XSD } from '../vocab'

/** A property an individual can have a value for: `datatype` for a data property, from its range. */
export type ValueProperty = { iri: string; label: string; kind: 'object' | 'data'; datatype?: string }
/** What the values editor offers: the project's properties, and its individuals as the values of object properties. */
export type IndividualChoices = { properties: ValueProperty[]; individuals: { iri: string; label: string }[] }

type Props = {
  node: ClassNode
  nodes: ClassNode[]
  edges: RelationEdge[]
  choices: IndividualChoices
  onChange: (values: PropertyValue[] | undefined) => void
}

/** The classes an individual is an instance of (its arrows on this page) and its property values, which can be edited. */
export function IndividualDetails({ node, nodes, edges, choices, onChange }: Props) {
  const types = edges.filter((e) => e.source === node.id && e.data?.kind === 'instanceOf').map((e) => nodes.find((n) => n.id === e.target)?.data.label ?? '?')
  const values = node.data.values ?? []
  const [adding, setAdding] = useState('')
  const property = (iri: string) => choices.properties.find((p) => p.iri === iri)
  const individual = (iri: string) => choices.individuals.find((i) => i.iri === iri)
  const set = (next: PropertyValue[]) => onChange(next.length > 0 ? next : undefined)
  const update = (at: number, patch: Partial<PropertyValue>) => set(values.map((v, i) => (i === at ? { ...v, ...patch } : v)))

  const add = () => {
    const p = property(adding)
    if (!p) return
    const value: PropertyValue =
      p.kind === 'object'
        ? { property: p.iri, value: '', kind: 'iri' }
        : { property: p.iri, value: '', kind: 'literal', ...(p.datatype && p.datatype !== XSD + 'string' && { datatype: p.datatype }) }
    set([...values, value])
  }

  return (
    <>
      <fieldset className="concept-schemes">
        <legend>Instance of (rdf:type)</legend>
        {types.length > 0 ? types.join(', ') : <span className="muted">No class on this page. Draw an arrow from this individual to a class.</span>}
      </fieldset>
      <fieldset className="annotations individual-values">
        <legend>Property values</legend>
        {values.map((v, i) => (
          <div className="annotation" key={i}>
            <span className="property" title={v.property}>
              {property(v.property)?.label ?? shortName(v.property)}
            </span>
            <button className="remove" aria-label={`Remove ${property(v.property)?.label ?? shortName(v.property)}`} onClick={() => set(values.filter((_, j) => j !== i))}>
              ×
            </button>
            {v.kind === 'iri' ? (
              <select className="value" value={v.value} onChange={(e) => update(i, { value: e.target.value })} aria-label="Value">
                {!individual(v.value) && <option value={v.value}>{v.value ? shortName(v.value) : 'choose…'}</option>}
                {choices.individuals.map((ind) => (
                  <option key={ind.iri} value={ind.iri}>
                    {ind.label}
                  </option>
                ))}
              </select>
            ) : (
              <input className="value" value={v.value} placeholder="value" onChange={(e) => update(i, { value: e.target.value })} />
            )}
            {v.kind === 'iri' ? (
              <span className="lang datatype">IRI</span>
            ) : v.datatype ? (
              <span className="lang datatype" title={v.datatype}>
                {shortName(v.datatype)}
              </span>
            ) : (
              <input className="lang" value={v.lang ?? ''} placeholder="lang" title="Language tag, e.g. en" onChange={(e) => update(i, { lang: e.target.value || undefined })} />
            )}
          </div>
        ))}
        <div className="add-annotation">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Property">
            <option value="">property…</option>
            {(['object', 'data'] as const).map((kind) => (
              <optgroup key={kind} label={kind === 'object' ? 'Object properties' : 'Data properties'}>
                {choices.properties
                  .filter((p) => p.kind === kind)
                  .map((p) => (
                    <option key={p.iri} value={p.iri} title={p.iri}>
                      {p.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button onClick={add} disabled={!adding}>
            + Add
          </button>
        </div>
      </fieldset>
    </>
  )
}
