import type { ClassNode, PropertyConstraint, RelationEdge } from '../model'
import { compactIri, DATATYPES } from '../vocab'
import { ClassSelect } from './ClassAxioms'

type Props = {
  nodeId: string
  constraints: PropertyConstraint[]
  nodes: ClassNode[]
  edges: RelationEdge[]
  onChange: (constraints: PropertyConstraint[]) => void
}

/**
 * SHACL constraints on the class: per property, how many values its instances must have and of what type.
 * They export as a node shape targeting this class, see shacl.ts.
 */
export function Constraints({ nodeId, constraints, nodes, edges, onChange }: Props) {
  // Edges with the same label are one property; offer each once, by its first edge.
  const properties = edges.filter(
    (e, i) => e.data?.kind === 'objectProperty' && edges.findIndex((f) => f.data?.kind === 'objectProperty' && f.data.label === e.data!.label) === i,
  )
  // Data properties are listed on classes; offer every name once, with the datatype it was first given.
  const dataProperties = new Map<string, string>()
  for (const n of nodes) for (const p of n.data.dataProperties ?? []) if (p.name.trim() && !dataProperties.has(p.name)) dataProperties.set(p.name, p.datatype)

  // The stored edge may be a later edge of the same property; show it as that property's first edge.
  const firstEdge = (id: string) => {
    const label = edges.find((e) => e.id === id)?.data?.label
    return properties.find((p) => p.data?.label === label)?.id
  }
  // The class an arrow of this property points at from this class, to prefill the value type.
  const drawnTarget = (edgeId: string) => {
    const label = edges.find((e) => e.id === edgeId)?.data?.label
    return edges.find((e) => e.data?.kind === 'objectProperty' && e.data.label === label && e.source === nodeId)?.target
  }

  const fromKey = (key: string): PropertyConstraint => {
    if (key.startsWith('o:')) {
      const property = key.slice(2)
      return { path: { type: 'object', property }, class: drawnTarget(property) }
    }
    const name = key.slice(2)
    return { path: { type: 'data', name }, datatype: dataProperties.get(name) }
  }

  const add = () => {
    const own = properties.find((p) => edges.some((e) => e.source === nodeId && e.data?.kind === 'objectProperty' && e.data.label === p.data?.label))
    const ownData = nodes.find((n) => n.id === nodeId)?.data.dataProperties?.find((p) => p.name.trim())
    const key = own ? `o:${own.id}` : ownData ? `d:${ownData.name}` : properties[0] ? `o:${properties[0].id}` : `d:${[...dataProperties.keys()][0]}`
    onChange([...constraints, { ...fromKey(key), minCount: 1 }])
  }
  const update = (at: number, patch: Partial<PropertyConstraint>) => onChange(constraints.map((c, i) => (i === at ? { ...c, ...patch } : c)))
  // Picking another property starts that row over, keeping the counts and message.
  const setProperty = (at: number, key: string) => {
    const { minCount, maxCount, message } = constraints[at]
    onChange(constraints.map((c, i) => (i === at ? { ...fromKey(key), minCount, maxCount, message } : c)))
  }
  const countInput = (at: number, field: 'minCount' | 'maxCount', label: string) => (
    <label title={field === 'minCount' ? 'At least this many values (sh:minCount)' : 'At most this many values (sh:maxCount)'}>
      {label}{' '}
      <input
        className="cardinality"
        type="number"
        min={0}
        value={constraints[at][field] ?? ''}
        placeholder="–"
        onChange={(e) => update(at, { [field]: e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value))) })}
      />
    </label>
  )

  return (
    <fieldset className="constraints">
      <legend>Constraints (SHACL)</legend>
      <p className="muted">Rules this class's instance data must follow. They export as SHACL shapes; validators report data that breaks them, reasoners ignore them.</p>
      {constraints.map((c, i) => {
        // The picker's value: `o:<edge id>` for an object property, `d:<name>` for a data property.
        const edgeId = c.path.type === 'object' ? firstEdge(c.path.property) : undefined
        const key = c.path.type === 'object' ? (edgeId ? `o:${edgeId}` : '') : `d:${c.path.name}`
        const name = c.path.type === 'object' ? (edges.find((e) => e.id === edgeId)?.data?.label ?? 'constraint') : c.path.name
        return (
          <div className="constraint" key={i}>
            <div className="constraint-line">
              <select value={key} aria-label="Constrained property" onChange={(e) => setProperty(i, e.target.value)}>
                {!key && <option value="">(deleted property)</option>}
                {c.path.type === 'data' && !dataProperties.has(c.path.name) && <option value={key}>{c.path.name}</option>}
                {properties.length > 0 && (
                  <optgroup label="Object properties">
                    {properties.map((p) => (
                      <option key={p.id} value={`o:${p.id}`}>
                        {p.data?.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {dataProperties.size > 0 && (
                  <optgroup label="Data properties">
                    {[...dataProperties.keys()].map((n) => (
                      <option key={n} value={`d:${n}`}>
                        {n}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button className="remove" aria-label={`Remove ${name}`} onClick={() => onChange(constraints.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
            <div className="constraint-line">
              {countInput(i, 'minCount', 'min')}
              {countInput(i, 'maxCount', 'max')}
              {c.path.type === 'object' ? (
                <ClassSelect value={c.class} classes={nodes} empty="(any class)" onChange={(id) => update(i, { class: id })} />
              ) : (
                <select value={c.datatype ?? ''} aria-label="Datatype" onChange={(e) => update(i, { datatype: e.target.value || undefined })}>
                  <option value="">(any datatype)</option>
                  {c.datatype && !DATATYPES.includes(c.datatype) && <option value={c.datatype}>{compactIri(c.datatype)}</option>}
                  {DATATYPES.map((d) => (
                    <option key={d} value={d}>
                      {compactIri(d)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              className="message"
              value={c.message ?? ''}
              placeholder="Message when broken (optional)"
              aria-label="Message"
              onChange={(e) => update(i, { message: e.target.value || undefined })}
            />
            {c.minCount !== undefined && c.maxCount !== undefined && c.maxCount < c.minCount && (
              <small className="warning">max is below min, so no data can pass.</small>
            )}
          </div>
        )
      })}
      <button className="add" onClick={add} disabled={properties.length === 0 && dataProperties.size === 0}>
        + Constraint
      </button>
    </fieldset>
  )
}
