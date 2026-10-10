import { useState, type ReactNode } from 'react'
import { localName, propertyLocalName, type Annotation, type ClassNode, type EdgeKind, type EntityData, type RelationEdge } from '../model'
import { entityIri } from '../owl'
import { ClassAxioms } from './ClassAxioms'
import { ANNOTATION_PROPERTIES, compactIri, expandIri, RDFS_COMMENT, SKOS_DEFINITION } from '../vocab'

type Props = {
  base: string
  nodes: ClassNode[]
  edges: RelationEdge[]
  /** Everything selected; the inspector edits one element at a time. */
  selection: (ClassNode | RelationEdge)[]
  onNodeChange: (id: string, patch: Partial<ClassNode['data']>) => void
  onEdgeChange: (id: string, patch: Partial<NonNullable<RelationEdge['data']>>) => void
}

/** Protégé-style entity panel for the selected class or edge: IRI, label, annotations and class axioms. */
export function Inspector({ base, nodes, edges, selection, onNodeChange, onEdgeChange }: Props) {
  if (selection.length !== 1) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <p className="muted">{selection.length} items selected. Select one class or edge to edit it.</p>
      </aside>
    )
  }

  const item = selection[0]
  if (item.type === 'owlClass') {
    const node = item as ClassNode
    return (
      <aside className="inspector" aria-label="Inspector">
        <h2>Class</h2>
        <EntityFields
          base={base}
          data={node.data}
          label={node.data.label}
          derivedLocal={localName(node.data.label)}
          onChange={(patch) => onNodeChange(node.id, patch)}
        />
        <ClassAxioms
          nodeId={node.id}
          axioms={node.data.axioms ?? []}
          nodes={nodes}
          edges={edges}
          onChange={(axioms) => onNodeChange(node.id, { axioms })}
        />
      </aside>
    )
  }

  const edge = item as RelationEdge
  const data = edge.data ?? { kind: 'subClassOf' as const, label: '' }
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?'
  const sameName = data.kind === 'objectProperty' ? edges.filter((e) => e.data?.kind === 'objectProperty' && e.data.label === data.label).length : 0

  const setKind = (kind: EdgeKind) => {
    if (kind === data.kind) return
    if (kind === 'subClassOf') onEdgeChange(edge.id, { kind, label: '' })
    else onEdgeChange(edge.id, { kind, label: data.label || 'new property' })
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <h2>{data.kind === 'subClassOf' ? 'Subclass axiom' : 'Object property'}</h2>
      <Field label="Edge type" group>
        <div className="segmented">
          {(['subClassOf', 'objectProperty'] as const).map((kind) => (
            <button key={kind} className={kind === data.kind ? 'active' : undefined} aria-pressed={kind === data.kind} onClick={() => setKind(kind)}>
              {kind === 'subClassOf' ? 'subClassOf' : 'object property'}
            </button>
          ))}
        </div>
      </Field>
      {data.kind === 'subClassOf' ? (
        <p className="axiom">
          {labelOf(edge.source)} <span className="keyword">subClassOf</span> {labelOf(edge.target)}
        </p>
      ) : (
        <>
          <p className="axiom">
            <span className="keyword">domain</span> {labelOf(edge.source)} · <span className="keyword">range</span> {labelOf(edge.target)}
          </p>
          <EntityFields
            base={base}
            data={data}
            label={data.label}
            derivedLocal={propertyLocalName(data.label)}
            onChange={(patch) => onEdgeChange(edge.id, patch)}
          />
          {sameName > 1 && (
            <p className="muted">
              {sameName} edges are named "{data.label}" and export as one property; each edge's annotations are added to it.
            </p>
          )}
        </>
      )}
    </aside>
  )
}

type EntityFieldsProps = {
  base: string
  data: EntityData
  label: string
  /** Local name the exporter derives from the label when no IRI is set. */
  derivedLocal: string
  onChange: (patch: EntityData & { label?: string }) => void
}

function EntityFields({ base, data, label, derivedLocal, onChange }: EntityFieldsProps) {
  const annotations = data.annotations ?? []
  const setAnnotations = (next: Annotation[]) => onChange({ annotations: next })

  // Definition and comment get their own boxes; they edit the first annotation of that property.
  const definitionAt = annotations.findIndex((a) => a.property === SKOS_DEFINITION)
  const commentAt = annotations.findIndex((a) => a.property === RDFS_COMMENT)

  const setSingle = (at: number, property: string, value: string) => {
    if (at < 0) {
      if (value) setAnnotations([...annotations, { property, value }])
    } else if (!value && !annotations[at].lang) {
      setAnnotations(annotations.filter((_, i) => i !== at))
    } else {
      setAnnotations(annotations.map((a, i) => (i === at ? { ...a, value } : a)))
    }
  }

  return (
    <>
      <Field label="Label (rdfs:label)">
        <input value={label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field label="IRI">
        <input value={data.iri ?? ''} placeholder={`:${derivedLocal}`} onChange={(e) => onChange({ iri: e.target.value || undefined })} />
        <small className="muted iri">{entityIri(base, data, derivedLocal)}</small>
      </Field>
      <Field label="Definition (skos:definition)">
        <textarea rows={3} value={annotations[definitionAt]?.value ?? ''} onChange={(e) => setSingle(definitionAt, SKOS_DEFINITION, e.target.value)} />
      </Field>
      <Field label="Comment (rdfs:comment)">
        <textarea rows={2} value={annotations[commentAt]?.value ?? ''} onChange={(e) => setSingle(commentAt, RDFS_COMMENT, e.target.value)} />
      </Field>
      <AnnotationTable
        base={base}
        annotations={annotations}
        hidden={new Set([definitionAt, commentAt])}
        onChange={setAnnotations}
      />
    </>
  )
}

/** Neo4j-style key/value rows for every other annotation, plus a row to add one. */
function AnnotationTable({
  base,
  annotations,
  hidden,
  onChange,
}: {
  base: string
  annotations: Annotation[]
  /** Indices shown in their own fields above. */
  hidden: Set<number>
  onChange: (next: Annotation[]) => void
}) {
  const [adding, setAdding] = useState(ANNOTATION_PROPERTIES[2])
  const [custom, setCustom] = useState('')
  const update = (at: number, patch: Partial<Annotation>) => onChange(annotations.map((a, i) => (i === at ? { ...a, ...patch } : a)))

  const add = () => {
    const property = adding === 'custom' ? expandIri(custom, base) : adding
    if (adding === 'custom' && !custom.trim()) return
    onChange([...annotations, { property, value: '' }])
    setCustom('')
  }

  return (
    <fieldset className="annotations">
      <legend>Annotations</legend>
      {annotations.map((a, i) =>
        hidden.has(i) ? null : (
          <div className="annotation" key={i}>
            <span className="property" title={a.property}>
              {compactIri(a.property)}
            </span>
            <button className="remove" aria-label={`Remove ${compactIri(a.property)}`} onClick={() => onChange(annotations.filter((_, j) => j !== i))}>
              ×
            </button>
            <input className="value" value={a.value} placeholder="value" onChange={(e) => update(i, { value: e.target.value })} />
            <input
              className="lang"
              value={a.lang ?? ''}
              placeholder="lang"
              title="Language tag, e.g. en"
              onChange={(e) => update(i, { lang: e.target.value || undefined })}
            />
          </div>
        ),
      )}
      <div className="add-annotation">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Annotation property">
          {ANNOTATION_PROPERTIES.map((p) => (
            <option key={p} value={p}>
              {compactIri(p)}
            </option>
          ))}
          <option value="custom">other…</option>
        </select>
        {adding === 'custom' && (
          <input value={custom} placeholder="prefix:name or IRI" onChange={(e) => setCustom(e.target.value)} aria-label="Custom annotation property" />
        )}
        <button onClick={add}>+ Add</button>
      </div>
    </fieldset>
  )
}

/** A labelled control; `group` for several buttons, which a <label> would wrongly click on. */
function Field({ label, group, children }: { label: string; group?: boolean; children: ReactNode }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className="field">
      <span className="field-label">{label}</span>
      {children}
    </Tag>
  )
}
