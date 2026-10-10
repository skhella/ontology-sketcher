import { useState, type ReactNode } from 'react'
import { localName, propertyLocalName, type Annotation, type ClassNode, type EdgeKind, type EntityData, type RelationEdge } from '../model'
import { entityIri } from '../owl'
import { isSkosEdge, NODE_KIND_NAMES, SKOS_EDGE_KINDS } from '../skos'
import { ClassAxioms } from './ClassAxioms'
import { ConceptMappings, ConceptSchemes, SchemeSummary } from './ConceptDetails'
import { Constraints } from './Constraints'
import { DataProperties, ObjectPropertyDetails } from './PropertyDetails'
import { ANNOTATION_PROPERTIES, compactIri, expandIri, RDFS_COMMENT, SKOS_ANNOTATION_PROPERTIES, SKOS_DEFINITION } from '../vocab'

type Props = {
  base: string
  nodes: ClassNode[]
  edges: RelationEdge[]
  /** Everything selected; the inspector edits one element at a time. */
  selection: (ClassNode | RelationEdge)[]
  onNodeChange: (id: string, patch: Partial<ClassNode['data']>) => void
  onEdgeChange: (id: string, patch: Partial<NonNullable<RelationEdge['data']>>) => void
}

/** Protégé-style entity panel for the selected class or edge: IRI, label, annotations, class axioms and SHACL constraints. */
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
    const kind = node.data.kind
    // Concepts and schemes are individuals, so class axioms and constraints only offer classes.
    const classes = nodes.filter((n) => !n.data.kind)
    return (
      <aside className="inspector" aria-label="Inspector">
        <h2>{NODE_KIND_NAMES[kind ?? 'class']}</h2>
        <EntityFields
          base={base}
          data={node.data}
          label={node.data.label}
          labelProperty={kind ? 'skos:prefLabel' : 'rdfs:label'}
          labelLang={kind ? (node.data.labelLang ?? '') : undefined}
          annotationProperties={kind ? SKOS_ANNOTATION_PROPERTIES : undefined}
          derivedLocal={localName(node.data.label)}
          onChange={(patch) => onNodeChange(node.id, patch)}
        />
        {kind === 'concept' && (
          <>
            <ConceptSchemes node={node} nodes={nodes} edges={edges} onChange={(inScheme) => onNodeChange(node.id, { inScheme })} />
            <ConceptMappings base={base} mappings={node.data.mappings ?? []} onChange={(mappings) => onNodeChange(node.id, { mappings })} />
          </>
        )}
        {kind === 'scheme' && <SchemeSummary node={node} nodes={nodes} edges={edges} />}
        {!kind && (
          <>
            <ClassAxioms
              nodeId={node.id}
              axioms={node.data.axioms ?? []}
              nodes={classes}
              edges={edges}
              onChange={(axioms) => onNodeChange(node.id, { axioms })}
            />
            <DataProperties properties={node.data.dataProperties ?? []} onChange={(dataProperties) => onNodeChange(node.id, { dataProperties })} />
            <Constraints
              nodeId={node.id}
              constraints={node.data.constraints ?? []}
              nodes={classes}
              edges={edges}
              onChange={(constraints) => onNodeChange(node.id, { constraints })}
            />
          </>
        )}
      </aside>
    )
  }

  const edge = item as RelationEdge
  const data = edge.data ?? { kind: 'subClassOf' as const, label: '' }
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?'
  const skos = isSkosEdge(data.kind)
  const sameName = data.kind === 'subClassOf' || skos ? 0 : edges.filter((e) => e.data?.kind === data.kind && e.data.label === data.label).length
  // Characteristics, inverse and super property belong to the property, so every edge drawing it gets them.
  const setOnProperty = (patch: Partial<NonNullable<RelationEdge['data']>>) => {
    for (const e of edges) if (e.data?.kind === 'objectProperty' && e.data.label === data.label) onEdgeChange(e.id, patch)
  }

  const setKind = (kind: EdgeKind) => {
    if (kind === data.kind) return
    if (isSkosEdge(kind)) onEdgeChange(edge.id, { kind, label: kind })
    else if (kind === 'subClassOf') onEdgeChange(edge.id, { kind, label: '' })
    else onEdgeChange(edge.id, { kind, label: data.label || 'new property' })
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <h2>{EDGE_TITLES[data.kind]}</h2>
      <Field label="Edge type" group>
        <div className="segmented">
          {(skos ? SKOS_EDGE_KINDS : (['subClassOf', 'objectProperty', 'annotationProperty'] as const)).map((kind) => (
            <button key={kind} className={kind === data.kind ? 'active' : undefined} aria-pressed={kind === data.kind} onClick={() => setKind(kind)}>
              {EDGE_KINDS[kind]}
            </button>
          ))}
        </div>
      </Field>
      {data.kind === 'subClassOf' || skos ? (
        <p className="axiom">
          {labelOf(edge.source)} <span className="keyword">{skos ? `skos:${data.kind}` : 'subClassOf'}</span> {labelOf(edge.target)}
        </p>
      ) : (
        <>
          {data.kind === 'annotationProperty' && (
            <p className="axiom">
              {labelOf(edge.source)} <span className="keyword">{data.label}</span> {labelOf(edge.target)}
            </p>
          )}
          <EntityFields
            base={base}
            data={data}
            label={data.label}
            derivedLocal={propertyLocalName(data.label)}
            onChange={(patch) => onEdgeChange(edge.id, patch)}
          />
          {data.kind === 'objectProperty' && <ObjectPropertyDetails edge={edge} nodes={nodes} edges={edges} onChange={setOnProperty} />}
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

const EDGE_KINDS: Record<EdgeKind, string> = {
  subClassOf: 'subClassOf',
  objectProperty: 'object',
  annotationProperty: 'annotation',
  broader: 'broader',
  narrower: 'narrower',
  related: 'related',
  topConceptOf: 'top concept',
}
const EDGE_TITLES: Record<EdgeKind, string> = {
  subClassOf: 'Subclass axiom',
  objectProperty: 'Object property',
  annotationProperty: 'Annotation property',
  broader: 'Broader concept',
  narrower: 'Narrower concept',
  related: 'Related concept',
  topConceptOf: 'Top concept of scheme',
}

type EntityFieldsProps = {
  base: string
  data: EntityData
  label: string
  /** The property the label exports as. */
  labelProperty?: string
  /** The label's language tag; when given, a box to edit it sits next to the label. */
  labelLang?: string
  /** Properties the annotation picker offers; the OWL list by default. */
  annotationProperties?: string[]
  /** Local name the exporter derives from the label when no IRI is set. */
  derivedLocal: string
  onChange: (patch: EntityData & { label?: string; labelLang?: string }) => void
}

function EntityFields({ base, data, label, labelProperty = 'rdfs:label', labelLang, annotationProperties, derivedLocal, onChange }: EntityFieldsProps) {
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
      <Field label={`Label (${labelProperty})`}>
        {labelLang === undefined ? (
          <input value={label} onChange={(e) => onChange({ label: e.target.value })} />
        ) : (
          <span className="label-with-lang">
            <input value={label} onChange={(e) => onChange({ label: e.target.value })} />
            <input
              className="lang"
              value={labelLang}
              placeholder="lang"
              title="Language tag, e.g. en"
              aria-label="Label language"
              onChange={(e) => onChange({ labelLang: e.target.value || undefined })}
            />
          </span>
        )}
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
        key={annotationProperties ? 'skos' : 'owl'}
        base={base}
        properties={annotationProperties}
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
  properties = ANNOTATION_PROPERTIES,
  annotations,
  hidden,
  onChange,
}: {
  base: string
  properties?: string[]
  annotations: Annotation[]
  /** Indices shown in their own fields above. */
  hidden: Set<number>
  onChange: (next: Annotation[]) => void
}) {
  // skos:prefLabel first for classes; the first SKOS property (altLabel) for concepts.
  const [adding, setAdding] = useState(properties === ANNOTATION_PROPERTIES ? properties[2] : properties[0])
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
          {properties.map((p) => (
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
