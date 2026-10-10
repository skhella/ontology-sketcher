import type { Characteristic, ClassNode, DataProperty, RelationData, RelationEdge } from '../model'
import { compactIri, DATATYPES } from '../vocab'

const CHARACTERISTICS: { key: Characteristic; label: string }[] = [
  { key: 'functional', label: 'Functional' },
  { key: 'inverseFunctional', label: 'Inverse functional' },
  { key: 'transitive', label: 'Transitive' },
  { key: 'symmetric', label: 'Symmetric' },
  { key: 'asymmetric', label: 'Asymmetric' },
  { key: 'reflexive', label: 'Reflexive' },
  { key: 'irreflexive', label: 'Irreflexive' },
]

type ObjectPropertyProps = {
  edge: RelationEdge
  nodes: ClassNode[]
  edges: RelationEdge[]
  /** Applies a property-level change to every edge drawing this property. */
  onChange: (patch: Partial<RelationData>) => void
}

/** Protégé's object property panel: domain and range, characteristics, inverse and super property. */
export function ObjectPropertyDetails({ edge, nodes, edges, onChange }: ObjectPropertyProps) {
  const data = edge.data!
  const same = edges.filter((e) => e.data?.kind === 'objectProperty' && e.data.label === data.label)
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?'
  const unique = (ids: string[]) => [...new Set(ids.map(labelOf))].join(' ⊔ ')
  // Other object properties, one edge each, to pick an inverse or super property from.
  const others = edges.filter(
    (e, i) =>
      e.data?.kind === 'objectProperty' &&
      e.data.label !== data.label &&
      edges.findIndex((f) => f.data?.kind === 'objectProperty' && f.data.label === e.data!.label) === i,
  )
  const characteristics = new Set(data.characteristics ?? [])
  const toggle = (c: Characteristic) => {
    const next = new Set(characteristics)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    onChange({ characteristics: CHARACTERISTICS.map((x) => x.key).filter((k) => next.has(k)) })
  }

  return (
    <>
      <fieldset className="domain-range">
        <legend>Domain and range (from the arrows)</legend>
        <span className="keyword">domain</span> {unique(same.map((e) => e.source))} · <span className="keyword">range</span>{' '}
        {unique(same.map((e) => e.target))}
      </fieldset>
      <fieldset className="characteristics">
        <legend>Characteristics</legend>
        {CHARACTERISTICS.map(({ key, label }) => (
          <label key={key}>
            <input type="checkbox" checked={characteristics.has(key)} onChange={() => toggle(key)} /> {label}
          </label>
        ))}
      </fieldset>
      <PropertyPicker label="Inverse of" value={data.inverseOf} others={others} edges={edges} onChange={(inverseOf) => onChange({ inverseOf })} />
      <PropertyPicker
        label="SubProperty of"
        value={data.subPropertyOf}
        others={others}
        edges={edges}
        onChange={(subPropertyOf) => onChange({ subPropertyOf })}
      />
    </>
  )
}

function PropertyPicker({
  label,
  value,
  others,
  edges,
  onChange,
}: {
  label: string
  /** Id of an edge drawing the other property; it may be any edge of that property. */
  value: string | undefined
  others: RelationEdge[]
  edges: RelationEdge[]
  onChange: (id: string | undefined) => void
}) {
  const name = value ? edges.find((e) => e.id === value)?.data?.label : undefined
  const selected = others.find((o) => o.data?.label === name)?.id ?? ''
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={selected} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">(none)</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>
            {o.data?.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Neo4j-style property keys on a class, exported as owl:DatatypeProperty with this class as domain. */
export function DataProperties({ properties, onChange }: { properties: DataProperty[]; onChange: (next: DataProperty[]) => void }) {
  const update = (at: number, patch: Partial<DataProperty>) => onChange(properties.map((p, i) => (i === at ? { ...p, ...patch } : p)))
  return (
    <fieldset className="data-properties">
      <legend>Data properties</legend>
      {properties.map((p, i) => (
        <div className="data-property" key={i}>
          <input value={p.name} placeholder="name" aria-label="Data property name" onChange={(e) => update(i, { name: e.target.value })} />
          <select value={p.datatype} aria-label="Datatype" onChange={(e) => update(i, { datatype: e.target.value })}>
            {!DATATYPES.includes(p.datatype) && <option value={p.datatype}>{compactIri(p.datatype)}</option>}
            {DATATYPES.map((d) => (
              <option key={d} value={d}>
                {compactIri(d)}
              </option>
            ))}
          </select>
          <label title="Functional: at most one value">
            <input type="checkbox" checked={!!p.functional} onChange={(e) => update(i, { functional: e.target.checked || undefined })} /> 1
          </label>
          <button className="remove" aria-label={`Remove ${p.name || 'data property'}`} onClick={() => onChange(properties.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="add" onClick={() => onChange([...properties, { name: '', datatype: DATATYPES[0] }])}>
        + Data property
      </button>
    </fieldset>
  )
}
