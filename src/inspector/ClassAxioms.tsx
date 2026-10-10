import type { AxiomKind, ClassAxiom, ClassExpression, ClassNode, Quantifier, RelationEdge } from '../model'

type Props = {
  nodeId: string
  axioms: ClassAxiom[]
  nodes: ClassNode[]
  edges: RelationEdge[]
  onChange: (axioms: ClassAxiom[]) => void
}

const SECTIONS: { kind: AxiomKind; title: string }[] = [
  { kind: 'subClassOf', title: 'SubClass Of' },
  { kind: 'equivalentClass', title: 'Equivalent To' },
  { kind: 'disjointWith', title: 'Disjoint With' },
]

const QUANTIFIERS: Quantifier[] = ['some', 'only', 'min', 'max', 'exactly']
const isCardinality = (q: Quantifier) => q === 'min' || q === 'max' || q === 'exactly'

/** Protégé's class description: superclasses, equivalent and disjoint classes, as named classes or restrictions. */
export function ClassAxioms({ nodeId, axioms, nodes, edges, onChange }: Props) {
  // Edges with the same label are one property; offer each once, by its first edge.
  const properties = edges.filter(
    (e, i) => e.data?.kind === 'objectProperty' && edges.findIndex((f) => f.data?.kind === 'objectProperty' && f.data.label === e.data!.label) === i,
  )
  const classes = nodes.filter((n) => n.id !== nodeId)
  const drawn = edges.filter((e) => e.data?.kind === 'subClassOf' && e.source === nodeId)
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label

  const add = (kind: AxiomKind) => {
    const expression: ClassExpression =
      kind === 'subClassOf' && properties.length > 0
        ? { type: 'restriction', quantifier: 'some', property: properties[0].id, filler: classes[0]?.id }
        : { type: 'class', ref: classes[0]?.id ?? '' }
    onChange([...axioms, { kind, expression }])
  }
  const update = (at: number, expression: ClassExpression) => onChange(axioms.map((a, i) => (i === at ? { ...a, expression } : a)))

  return (
    <>
      {SECTIONS.map(({ kind, title }) => (
        <fieldset className="axioms" key={kind}>
          <legend>{title}</legend>
          {kind === 'subClassOf' &&
            drawn.map((e) => (
              <div className="axiom-row drawn" key={e.id} title="Drawn on the canvas">
                {labelOf(e.target) ?? '?'} <span className="muted">(arrow)</span>
              </div>
            ))}
          {axioms.map((a, i) =>
            a.kind !== kind ? null : (
              <div className="axiom-row" key={i}>
                <ExpressionEditor expression={a.expression} classes={classes} fillers={nodes} properties={properties} edges={edges} onChange={(e) => update(i, e)} />
                <button className="remove" aria-label={`Remove ${title} axiom`} onClick={() => onChange(axioms.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ),
          )}
          <button className="add" onClick={() => add(kind)} disabled={classes.length === 0 && properties.length === 0}>
            + {title}
          </button>
        </fieldset>
      ))}
    </>
  )
}

function ExpressionEditor({
  expression: e,
  classes,
  fillers,
  properties,
  edges,
  onChange,
}: {
  expression: ClassExpression
  /** Classes a named-class axiom can point at: every class but this one. */
  classes: ClassNode[]
  /** Classes a restriction can point at, this one included (e.g. Person hasParent some Person). */
  fillers: ClassNode[]
  /** One edge per distinct object property. */
  properties: RelationEdge[]
  edges: RelationEdge[]
  onChange: (e: ClassExpression) => void
}) {
  const setForm = (form: string) => {
    if (form === 'class') onChange({ type: 'class', ref: e.type === 'restriction' ? (e.filler ?? classes[0]?.id ?? '') : e.ref })
    else {
      const quantifier = form as Quantifier
      const filler = e.type === 'class' ? e.ref || undefined : e.filler
      const property = e.type === 'restriction' ? e.property : (properties[0]?.id ?? '')
      onChange({ type: 'restriction', quantifier, property, filler, n: isCardinality(quantifier) ? (e.type === 'restriction' ? e.n : undefined) ?? 1 : undefined })
    }
  }

  // Reads in Manchester order: "class Pizza", or "hasTopping some Topping" with the quantifier in the middle.
  const form = (
    <select className="keyword" value={e.type === 'class' ? 'class' : e.quantifier} onChange={(ev) => setForm(ev.target.value)} aria-label="Expression type">
      <option value="class">class</option>
      {QUANTIFIERS.map((q) => (
        <option key={q} value={q} disabled={properties.length === 0}>
          {q}
        </option>
      ))}
    </select>
  )

  if (e.type === 'class') {
    return (
      <div className="expression">
        {form}
        <ClassSelect value={e.ref} classes={classes} onChange={(ref) => onChange({ ...e, ref: ref ?? '' })} />
      </div>
    )
  }

  // The stored edge may be a later edge of the same property; show it as that property's first edge.
  const label = edges.find((x) => x.id === e.property)?.data?.label
  const property = properties.find((p) => p.data?.label === label)?.id ?? ''
  return (
    <div className="expression">
      <select value={property} onChange={(ev) => onChange({ ...e, property: ev.target.value })} aria-label="Property">
        {!property && <option value="">(deleted property)</option>}
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.data?.label}
          </option>
        ))}
      </select>
      {form}
      {isCardinality(e.quantifier) && (
        <input
          className="cardinality"
          type="number"
          min={0}
          value={e.n ?? 0}
          onChange={(ev) => onChange({ ...e, n: Math.max(0, Math.floor(Number(ev.target.value))) })}
          aria-label="Cardinality"
        />
      )}
      <ClassSelect
        value={e.filler}
        classes={fillers}
        empty={isCardinality(e.quantifier) ? '(any)' : 'owl:Thing'}
        onChange={(filler) => onChange({ ...e, filler })}
      />
    </div>
  )
}

export function ClassSelect({
  value,
  classes,
  empty,
  onChange,
}: {
  value: string | undefined
  classes: ClassNode[]
  /** Label for "no class"; without it a class must be picked. */
  empty?: string
  onChange: (id: string | undefined) => void
}) {
  const missing = !!value && !classes.some((c) => c.id === value)
  return (
    <select value={value ?? ''} onChange={(ev) => onChange(ev.target.value || undefined)} aria-label="Class">
      {(empty || !value) && <option value="">{empty ?? '(pick a class)'}</option>}
      {missing && <option value={value}>(deleted class)</option>}
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.data.label}
        </option>
      ))}
    </select>
  )
}
