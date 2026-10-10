import { Parser, Store, type Quad, type Term } from 'n3'
import {
  localName,
  propertyLocalName,
  type Annotation,
  type Characteristic,
  type ClassAxiom,
  type ClassData,
  type ClassExpression,
  type ClassNode,
  type DataProperty,
  type Mapping,
  type Quantifier,
  type RelationEdge,
  type SkosEdgeKind,
} from './model'
import { LAYOUT_PROPERTY, parseLayout, type SavedLayout } from './savedLayout'
import { conceptSchemes, MAPPING_KINDS, NODE_KIND_STYLES } from './skos'
import { ANNOTATION_PROPERTIES, BUILT_IN_ANNOTATION_PROPERTIES, OWL, RDF, RDFS, SKOS, SKOS_ANNOTATION_PROPERTIES, XSD } from './vocab'

/**
 * Reads an OWL 2 ontology in Turtle (or N-Triples) back into canvas nodes and edges: the reverse of owl.ts and skos.ts.
 * Named classes become nodes; rdfs:subClassOf between named classes and object properties (one arrow per
 * domain/range pair) become edges; restrictions become class axioms; data properties are listed on their domain classes.
 * SKOS concepts and schemes become concept and scheme nodes with their broader, narrower, related and topConceptOf edges.
 * Node positions are left at 0,0; see layout.ts. SHACL shapes in the same file are left alone.
 */

export type OwlImportSummary = {
  classes: number
  concepts: number
  subClassOf: number
  objectProperties: number
  dataProperties: number
  axioms: number
  /** What the canvas cannot show yet, one short phrase each, e.g. "2 individuals". */
  skipped: string[]
}

/** `layout` is how this app drew the ontology when it exported it, see savedLayout.ts. */
export type OwlImportResult = { iri: string; nodes: ClassNode[]; edges: RelationEdge[]; layout?: SavedLayout; summary: OwlImportSummary }

const TYPE = RDF + 'type'
const LABEL = RDFS + 'label'
const SUB_CLASS_OF = RDFS + 'subClassOf'

const CHARACTERISTICS: Record<string, Characteristic> = {
  [OWL + 'FunctionalProperty']: 'functional',
  [OWL + 'InverseFunctionalProperty']: 'inverseFunctional',
  [OWL + 'TransitiveProperty']: 'transitive',
  [OWL + 'SymmetricProperty']: 'symmetric',
  [OWL + 'AsymmetricProperty']: 'asymmetric',
  [OWL + 'ReflexiveProperty']: 'reflexive',
  [OWL + 'IrreflexiveProperty']: 'irreflexive',
}

// Restriction predicates and the quantifier each stands for; see RESTRICTION in owl.ts.
const QUANTIFIERS: [string, Quantifier, boolean][] = [
  [OWL + 'someValuesFrom', 'some', true],
  [OWL + 'allValuesFrom', 'only', true],
  [OWL + 'minQualifiedCardinality', 'min', true],
  [OWL + 'maxQualifiedCardinality', 'max', true],
  [OWL + 'qualifiedCardinality', 'exactly', true],
  [OWL + 'minCardinality', 'min', false],
  [OWL + 'maxCardinality', 'max', false],
  [OWL + 'cardinality', 'exactly', false],
]

const AXIOM_KINDS = [
  [SUB_CLASS_OF, 'subClassOf'],
  [OWL + 'equivalentClass', 'equivalentClass'],
  [OWL + 'disjointWith', 'disjointWith'],
] as const

const SKOS_EDGES: [string, SkosEdgeKind][] = [
  [SKOS + 'broader', 'broader'],
  [SKOS + 'narrower', 'narrower'],
  [SKOS + 'related', 'related'],
  [SKOS + 'topConceptOf', 'topConceptOf'],
]

// Predicates the importer reads as structure; everything else on a class is a candidate annotation.
const STRUCTURAL = new Set([
  TYPE,
  LABEL,
  SUB_CLASS_OF,
  OWL + 'equivalentClass',
  OWL + 'disjointWith',
  RDFS + 'domain',
  RDFS + 'range',
  RDFS + 'subPropertyOf',
  OWL + 'inverseOf',
  SKOS + 'prefLabel',
  SKOS + 'inScheme',
  SKOS + 'hasTopConcept',
  ...SKOS_EDGES.map(([p]) => p),
  ...MAPPING_KINDS.map((k) => SKOS + k),
])

/** Parses Turtle and converts it, see the module comment. Throws with a readable message on files it cannot read. */
export function importOwl(text: string): OwlImportResult {
  if (/^\s*(<\?xml|<rdf:RDF)/.test(text)) {
    throw new Error('This is RDF/XML. Save it as Turtle first (in Protégé: File > Save as > Turtle Syntax).')
  }
  const prefixes: Record<string, string> = {}
  let quads: Quad[]
  try {
    quads = new Parser().parse(text, null, (prefix, iri) => {
      prefixes[prefix] = iri.value
    })
  } catch (error) {
    throw new Error(`This is not valid Turtle: ${(error as Error).message}`)
  }
  const store = new Store(quads)
  return convert(store, prefixes)
}

function convert(store: Store, prefixes: Record<string, string>): OwlImportResult {
  const objects = (s: Term | string, p: string) => store.getObjects(s, p, null)
  const object = (s: Term | string, p: string) => objects(s, p)[0]
  const subjectsOfType = (type: string) => store.getSubjects(TYPE, type, null).filter((t) => t.termType === 'NamedNode').map((t) => t.value)
  const isA = (s: string, type: string) => store.countQuads(s, TYPE, type, null) > 0

  // The namespace: the empty prefix when the file has one, else the one most classes share, else the ontology IRI plus '#'.
  const ontologyIri = subjectsOfType(OWL + 'Ontology')[0]
  const namespaces = new Map<string, number>()
  for (const c of [...subjectsOfType(OWL + 'Class'), ...subjectsOfType(SKOS + 'Concept')]) {
    const ns = c.replace(/[^#/]*$/, '')
    if (ns && ns !== OWL && ns !== SKOS) namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1)
  }
  const common = [...namespaces].sort((a, b) => b[1] - a[1])[0]?.[0]
  const iri = prefixes[''] ?? common ?? (ontologyIri ? (/[#/]$/.test(ontologyIri) ? ontologyIri : ontologyIri + '#') : 'http://example.org/ontology#')

  // An entity's `iri` field: left out when the label already gives that IRI, a local name inside the namespace, else the full IRI.
  const iriField = (entity: string, derivedLocal: string) => {
    if (entity === iri + derivedLocal) return {}
    return { iri: entity.startsWith(iri) && entity.length > iri.length ? entity.slice(iri.length) : entity }
  }
  const labelOf = (s: string) => {
    const labels = objects(s, LABEL).filter((o) => o.termType === 'Literal')
    const label = labels.find((l) => !('language' in l) || !l.language || l.language === 'en') ?? labels[0]
    return label?.value ?? s.replace(/^.*[#/]/, '')
  }

  const declaredAnnotationProperties = new Set([
    ...subjectsOfType(OWL + 'AnnotationProperty'),
    ...BUILT_IN_ANNOTATION_PROPERTIES,
    ...ANNOTATION_PROPERTIES,
    ...SKOS_ANNOTATION_PROPERTIES,
  ])

  // --- Nodes ---------------------------------------------------------------------------------------------
  const concepts = new Set(subjectsOfType(SKOS + 'Concept'))
  const schemes = new Set(subjectsOfType(SKOS + 'ConceptScheme'))
  const skipClasses = new Set([OWL + 'Thing', OWL + 'Nothing', SKOS + 'Concept', SKOS + 'ConceptScheme'])
  const classIris = [...new Set([...subjectsOfType(OWL + 'Class'), ...subjectsOfType(RDFS + 'Class')])].filter((c) => !skipClasses.has(c))
  // Named superclasses that are never declared still get a box, so the hierarchy stays whole.
  for (const q of store.getQuads(null, SUB_CLASS_OF, null, null)) {
    if (q.subject.termType === 'NamedNode' && q.object.termType === 'NamedNode' && !skipClasses.has(q.object.value) && !concepts.has(q.object.value)) {
      if (!classIris.includes(q.object.value)) classIris.push(q.object.value)
      if (!classIris.includes(q.subject.value)) classIris.push(q.subject.value)
    }
  }

  const nodeId = new Map<string, string>()
  const entityOf = new Map<string, string>()
  const nodes: ClassNode[] = []
  const addNode = (entity: string, data: ClassData) => {
    const id = crypto.randomUUID()
    nodeId.set(entity, id)
    entityOf.set(id, entity)
    nodes.push({ id, type: 'owlClass', position: { x: 0, y: 0 }, data })
  }

  for (const c of classIris) {
    if (concepts.has(c) || schemes.has(c)) continue
    const label = labelOf(c)
    addNode(c, { label, ...iriField(c, localName(label)) })
  }
  for (const c of [...schemes, ...concepts]) {
    const prefLabels = objects(c, SKOS + 'prefLabel').filter((o) => o.termType === 'Literal')
    const pref = prefLabels.find((l) => 'language' in l && l.language === 'en') ?? prefLabels[0]
    const label = pref?.value ?? labelOf(c)
    const lang = pref && 'language' in pref && pref.language ? { labelLang: pref.language } : {}
    const kind = concepts.has(c) ? 'concept' : 'scheme'
    addNode(c, { label, kind, ...lang, ...iriField(c, localName(label)), style: NODE_KIND_STYLES[kind] })
  }

  // --- Edges ---------------------------------------------------------------------------------------------
  const edges: RelationEdge[] = []
  const addEdge = (source: string, target: string, data: RelationEdge['data']): RelationEdge => {
    const edge: RelationEdge = { id: crypto.randomUUID(), type: 'relation', source, target, data: data && { ...data } }
    edges.push(edge)
    return edge
  }

  // Members of an owl:unionOf list, or the class itself when named.
  const unionMembers = (term: Term | undefined): string[] => {
    if (!term) return []
    if (term.termType === 'NamedNode') return [term.value]
    const list = object(term, OWL + 'unionOf')
    return list ? listItems(list).filter((t) => t.termType === 'NamedNode').map((t) => t.value) : []
  }
  const listItems = (head: Term): Term[] => {
    const items: Term[] = []
    let node: Term | undefined = head
    while (node && node.value !== RDF + 'nil' && items.length < 10_000) {
      const first = object(node, RDF + 'first')
      if (first) items.push(first)
      node = object(node, RDF + 'rest')
    }
    return items
  }

  let subClassOf = 0
  for (const c of classIris) {
    for (const sup of objects(c, SUB_CLASS_OF)) {
      if (sup.termType === 'NamedNode' && nodeId.has(c) && nodeId.has(sup.value)) {
        addEdge(nodeId.get(c)!, nodeId.get(sup.value)!, { kind: 'subClassOf', label: '' })
        subClassOf++
      }
    }
  }

  // Object properties: one arrow per domain class and range class, narrowed per source by the
  // `Source ⊑ ∀p.(T1 ⊔ …)` restrictions owl.ts writes for a property drawn between several pairs.
  const skipped: Record<string, number> = {}
  const skip = (what: string, n = 1) => (skipped[what] = (skipped[what] ?? 0) + n)
  const propertyEdge = new Map<string, string>() // property IRI → first edge id, for restrictions and inverseOf
  const propertyEdges = new Map<string, RelationEdge[]>()
  const consumed = new Set<string>() // blank node ids of restrictions turned into arrows rather than axioms
  const objectProperties = subjectsOfType(OWL + 'ObjectProperty').filter((p) => !p.startsWith(SKOS))

  for (const p of objectProperties) {
    const label = labelOf(p)
    const domains = unionMembers(object(p, RDFS + 'domain')).filter((d) => nodeId.has(d))
    const ranges = unionMembers(object(p, RDFS + 'range')).filter((r) => nodeId.has(r))
    const characteristics = objects(p, TYPE)
      .map((t) => CHARACTERISTICS[t.value])
      .filter((c): c is Characteristic => !!c)
    const data = {
      kind: 'objectProperty' as const,
      label,
      ...iriField(p, propertyLocalName(label)),
      ...(characteristics.length > 0 && { characteristics }),
      ...annotationsOf(p),
    }
    const pairs: [string, string][] = []
    for (const d of domains) {
      let targets = ranges
      for (const r of objects(d, SUB_CLASS_OF)) {
        if (r.termType !== 'BlankNode' || object(r, OWL + 'onProperty')?.value !== p) continue
        const only = unionMembers(object(r, OWL + 'allValuesFrom')).filter((t) => ranges.includes(t))
        if (only.length > 0 && only.length < ranges.length && objects(r, OWL + 'allValuesFrom').length === 1) {
          targets = only
          consumed.add(r.value)
        }
      }
      for (const t of targets) pairs.push([d, t])
    }
    // A property with no domain or range but used in a restriction is drawn from that class to the filler.
    if (pairs.length === 0) {
      for (const q of store.getQuads(null, OWL + 'onProperty', p, null)) {
        const holder = store.getSubjects(SUB_CLASS_OF, q.subject, null)[0] ?? store.getSubjects(OWL + 'equivalentClass', q.subject, null)[0]
        const filler = object(q.subject, OWL + 'someValuesFrom') ?? object(q.subject, OWL + 'allValuesFrom') ?? object(q.subject, OWL + 'onClass')
        if (holder && filler && nodeId.has(holder.value) && nodeId.has(filler.value)) {
          pairs.push([holder.value, filler.value])
          break
        }
      }
    }
    if (pairs.length === 0) {
      skip('object properties without a domain and range')
      continue
    }
    for (const [d, t] of pairs) {
      const edge = addEdge(nodeId.get(d)!, nodeId.get(t)!, data)
      if (!propertyEdge.has(p)) propertyEdge.set(p, edge.id)
      propertyEdges.set(p, [...(propertyEdges.get(p) ?? []), edge])
    }
  }
  // inverseOf and subPropertyOf point at the other property's first arrow, on every arrow of the property.
  for (const p of objectProperties) {
    const links: Partial<Record<'inverseOf' | 'subPropertyOf', string>> = {}
    const inverse = objects(p, OWL + 'inverseOf').find((o) => propertyEdge.has(o.value))
    const parent = objects(p, RDFS + 'subPropertyOf').find((o) => propertyEdge.has(o.value))
    if (inverse) links.inverseOf = propertyEdge.get(inverse.value)
    if (parent) links.subPropertyOf = propertyEdge.get(parent.value)
    if (!propertyEdge.has(p) || Object.keys(links).length === 0) continue
    for (const e of propertyEdges.get(p) ?? []) e.data = { ...e.data!, ...links }
  }

  // Annotation properties asserted between two classes become arrows; see annotationProperty in model.ts.
  for (const ap of subjectsOfType(OWL + 'AnnotationProperty')) {
    for (const q of store.getQuads(null, ap, null, null)) {
      if (q.object.termType !== 'NamedNode' || !nodeId.has(q.subject.value) || !nodeId.has(q.object.value)) continue
      const label = labelOf(ap)
      addEdge(nodeId.get(q.subject.value)!, nodeId.get(q.object.value)!, { kind: 'annotationProperty', label, ...iriField(ap, propertyLocalName(label)) })
    }
  }

  // SKOS relations between concepts and schemes; hasTopConcept only when topConceptOf is missing.
  const skosPairs = new Set<string>()
  for (const [predicate, kind] of SKOS_EDGES) {
    for (const q of store.getQuads(null, predicate, null, null)) {
      const [s, o] = [q.subject.value, q.object.value]
      if (!nodeId.has(s) || !nodeId.has(o)) continue
      // owl.ts writes broader/narrower as drawn; a file with both directions would draw each link twice.
      const key = kind === 'narrower' ? `broader ${o} ${s}` : `${kind} ${s} ${o}`
      if (skosPairs.has(key)) continue
      skosPairs.add(key)
      addEdge(nodeId.get(s)!, nodeId.get(o)!, { kind, label: kind })
    }
  }
  for (const q of store.getQuads(null, SKOS + 'hasTopConcept', null, null)) {
    const [scheme, concept] = [q.subject.value, q.object.value]
    if (!nodeId.has(scheme) || !nodeId.has(concept) || skosPairs.has(`topConceptOf ${concept} ${scheme}`)) continue
    skosPairs.add(`topConceptOf ${concept} ${scheme}`)
    addEdge(nodeId.get(concept)!, nodeId.get(scheme)!, { kind: 'topConceptOf', label: 'topConceptOf' })
  }

  // --- Class details ---------------------------------------------------------------------------------------
  // A restriction or named class as a ClassExpression; undefined for what the inspector cannot show (unions, nesting).
  const expressionOf = (term: Term): ClassExpression | undefined => {
    if (term.termType === 'NamedNode') return nodeId.has(term.value) ? { type: 'class', ref: nodeId.get(term.value)! } : undefined
    const property = object(term, OWL + 'onProperty')
    if (!property || !propertyEdge.has(property.value)) return undefined
    for (const [predicate, quantifier, qualified] of QUANTIFIERS) {
      const value = object(term, predicate)
      if (!value) continue
      const restriction: ClassExpression = { type: 'restriction', quantifier, property: propertyEdge.get(property.value)! }
      if (quantifier === 'some' || quantifier === 'only') {
        if (value.termType !== 'NamedNode') return undefined
        if (value.value === OWL + 'Thing') return restriction
        return nodeId.has(value.value) ? { ...restriction, filler: nodeId.get(value.value)! } : undefined
      }
      const n = Number(value.value)
      if (!Number.isInteger(n) || n < 0) return undefined
      if (!qualified) return { ...restriction, n }
      const onClass = object(term, OWL + 'onClass')
      if (onClass?.value === OWL + 'Thing') return { ...restriction, n }
      return onClass && nodeId.has(onClass.value) ? { ...restriction, n, filler: nodeId.get(onClass.value)! } : undefined
    }
    return undefined
  }

  let axioms = 0
  const dataPropertyCount = new Set<string>()
  const dataProperties = subjectsOfType(OWL + 'DatatypeProperty')
  for (const node of nodes) {
    const entity = entityOf.get(node.id)!
    const data = node.data

    if (!data.kind) {
      const classAxioms: ClassAxiom[] = []
      for (const [predicate, kind] of AXIOM_KINDS) {
        for (const o of objects(entity, predicate)) {
          if (kind === 'subClassOf' && o.termType === 'NamedNode') continue // drawn as an arrow
          if (o.termType === 'BlankNode' && consumed.has(o.value)) continue
          const expression = expressionOf(o)
          if (expression) classAxioms.push({ kind, expression })
          else skip('class axioms the inspector cannot show (unions, intersections, nested restrictions)')
        }
      }
      if (classAxioms.length > 0) data.axioms = classAxioms
      axioms += classAxioms.length

      const listed: DataProperty[] = []
      for (const p of dataProperties) {
        if (!unionMembers(object(p, RDFS + 'domain')).includes(entity)) continue
        const range = unionMembers(object(p, RDFS + 'range'))[0]
        listed.push({ name: labelOf(p), datatype: range ?? XSD + 'string', ...(isA(p, OWL + 'FunctionalProperty') && { functional: true }) })
        dataPropertyCount.add(p)
      }
      if (listed.length > 0) data.dataProperties = listed
    }

    if (data.kind === 'concept') {
      const mappings: Mapping[] = MAPPING_KINDS.flatMap((kind) =>
        objects(entity, SKOS + kind)
          .filter((o) => o.termType === 'NamedNode')
          .map((o) => ({ kind, iri: o.value })),
      )
      if (mappings.length > 0) data.mappings = mappings
    }

    Object.assign(data, annotationsOf(entity, data.kind ? SKOS + 'prefLabel' : undefined))
  }

  // Concepts keep in `inScheme` only the schemes their hierarchy does not already give them (see skos.ts).
  const derived = conceptSchemes(nodes, edges)
  for (const node of nodes) {
    if (node.data.kind !== 'concept') continue
    const entity = entityOf.get(node.id)!
    const listed = objects(entity, SKOS + 'inScheme').map((o) => nodeId.get(o.value)).filter((id): id is string => !!id)
    const extra = listed.filter((s) => !derived.get(node.id)?.has(s))
    if (extra.length > 0) node.data.inScheme = extra
  }

  const dataOnly = dataProperties.filter((p) => !dataPropertyCount.has(p)).length
  if (dataOnly) skip('data properties without a domain class', dataOnly)
  const individuals = subjectsOfType(OWL + 'NamedIndividual').filter((i) => !concepts.has(i) && !schemes.has(i)).length
  if (individuals) skip('individuals', individuals)
  const shapes = subjectsOfType('http://www.w3.org/ns/shacl#NodeShape').length
  if (shapes) skip('SHACL shapes', shapes)

  const layout = parseLayout(ontologyIri ? object(ontologyIri, LAYOUT_PROPERTY)?.value : undefined)

  return {
    iri,
    nodes,
    edges,
    ...(layout && { layout }),
    summary: {
      classes: nodes.filter((n) => !n.data.kind).length,
      concepts: nodes.filter((n) => n.data.kind).length,
      subClassOf,
      objectProperties: objectProperties.filter((p) => propertyEdge.has(p)).length,
      dataProperties: dataPropertyCount.size,
      axioms,
      skipped: Object.entries(skipped).map(([what, n]) => `${n} ${what}`),
    },
  }

  // Annotation assertions with literal or IRI values, as the inspector lists them.
  function annotationsOf(subject: string, alsoSkip?: string): { annotations?: Annotation[] } {
    const annotations: Annotation[] = []
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value
      // A class may carry skos:prefLabel as an annotation; on a concept it is the label itself.
      if (p === LABEL || p === alsoSkip || (STRUCTURAL.has(p) && p !== SKOS + 'prefLabel')) continue
      if (!declaredAnnotationProperties.has(p)) continue
      if (q.object.termType === 'Literal') {
        annotations.push({ property: p, value: q.object.value, ...(q.object.language && { lang: q.object.language }) })
      } else if (q.object.termType === 'NamedNode' && !nodeId.has(q.object.value)) {
        annotations.push({ property: p, value: q.object.value })
      }
    }
    return annotations.length > 0 ? { annotations } : {}
  }
}

export function describeOwlImport({ classes, concepts, subClassOf, objectProperties, dataProperties, axioms, skipped }: OwlImportSummary): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const parts = [plural(classes, 'class', 'classes')]
  if (concepts) parts.push(plural(concepts, 'concept or scheme', 'concepts and schemes'))
  parts.push(`${subClassOf} subClassOf`, plural(objectProperties, 'object property', 'object properties'))
  if (dataProperties) parts.push(plural(dataProperties, 'data property', 'data properties'))
  if (axioms) parts.push(plural(axioms, 'axiom', 'axioms'))
  const text = `Imported ${parts.join(', ')}.`
  return skipped.length > 0 ? `${text} Not shown: ${skipped.join(', ')}.` : text
}
