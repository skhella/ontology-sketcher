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
  type KeptProperty,
  type Mapping,
  type Namespace,
  type PropertyValue,
  type Quantifier,
  type RelationEdge,
  type SkosEdgeKind,
} from './model'
import { LAYOUT_PROPERTY, OLD_LAYOUT_PROPERTY, parseLayout, type SavedLayout } from './savedLayout'
import { conceptSchemes, MAPPING_KINDS, NODE_KIND_STYLES } from './skos'
import { suggestPrefix } from './namespaces'
import { ANNOTATION_PROPERTIES, BUILT_IN_ANNOTATION_PROPERTIES, IRI_VALUED, isAbsoluteIri, OWL, PREFIXES, RDF, RDFS, shortName, SKOS, SKOS_ANNOTATION_PROPERTIES, XSD } from './vocab'

/**
 * Reads an OWL 2 ontology in Turtle (or N-Triples) back into canvas nodes and edges: the reverse of owl.ts and skos.ts.
 * Named classes become nodes; rdfs:subClassOf between named classes and object properties (one arrow per
 * domain/range pair) become edges; restrictions become class axioms; data properties are listed on their domain classes.
 * Properties that can't be drawn that way (a range outside the file, such as skos:Concept, or no domain) are kept
 * as they are, so the export writes them back (see KeptProperty).
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
export type OwlImportResult = {
  iri: string
  namespaces: Namespace[]
  nodes: ClassNode[]
  edges: RelationEdge[]
  kept: KeptProperty[]
  layout?: SavedLayout
  summary: OwlImportSummary
}

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

/** How a class the file only refers to looks, see ClassData.outside. */
const OUTSIDE_STYLE = { stroke: '#868e96', strokeStyle: 'dashed' } as const

/** No predicate: annotationsOf then leaves no label out. */
const NO_LABEL = ''

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
  const counts = new Map<string, number>()
  for (const c of [...subjectsOfType(OWL + 'Class'), ...subjectsOfType(SKOS + 'Concept')]) {
    const ns = c.replace(/[^#/]*$/, '')
    if (ns && ns !== OWL && ns !== SKOS) counts.set(ns, (counts.get(ns) ?? 0) + 1)
  }
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  const iri = prefixes[''] ?? common ?? (ontologyIri ? (/[#/]$/.test(ontologyIri) ? ontologyIri : ontologyIri + '#') : 'http://example.org/ontology#')

  // Classes and properties in another namespace (not a built-in vocabulary) keep it as their `namespace`,
  // listed under the file's prefix for it, or a made-up one when the file has none.
  const builtIn = new Set(Object.values(PREFIXES))
  const prefixFor = new Map(Object.entries(prefixes).filter(([p, ns]) => p && !builtIn.has(ns)).map(([p, ns]) => [ns, p]))
  const namespaces = new Map<string, string>()
  const namespaceField = (entity: string) => {
    const ns = entity.replace(/[^#/]*$/, '')
    if (!ns || ns === iri || builtIn.has(ns) || !/[#/]$/.test(ns) || !isAbsoluteIri(ns)) return {}
    if (!namespaces.has(ns)) namespaces.set(ns, prefixFor.get(ns) ?? suggestPrefix(ns, [...namespaces.values(), ...prefixFor.values()]))
    return { namespace: ns }
  }

  // An entity's `iri` field: left out when the label already gives that IRI, a local name inside its namespace, else the full IRI.
  const iriField = (entity: string, derivedLocal: string) => {
    const field = namespaceField(entity)
    const ns = field.namespace ?? iri
    if (entity === ns + derivedLocal) return field
    return { ...field, iri: entity.startsWith(ns) && entity.length > ns.length ? entity.slice(ns.length) : entity }
  }
  // The rdfs:label (or skos:prefLabel) shown as the name: one without a language or in English, else the first.
  // Other labels, e.g. in other languages, stay annotations; see annotationsOf.
  const labelTerm = (s: string, predicate = LABEL) => {
    const labels = objects(s, predicate).filter((o) => o.termType === 'Literal')
    return labels.find((l) => !('language' in l) || !l.language || l.language === 'en') ?? labels[0]
  }
  const labelOf = (s: string) => labelTerm(s)?.value ?? s.replace(/^.*[#/]/, '')
  // The label's language, or that there is no label at all (see EntityData.unlabelled).
  const labelLangOf = (s: string, predicate = LABEL) => {
    const term = labelTerm(s, predicate)
    if (!term) return { unlabelled: true }
    return 'language' in term && term.language ? { labelLang: term.language } : {}
  }

  const declaredAnnotationProperties = new Set([
    ...subjectsOfType(OWL + 'AnnotationProperty'),
    ...BUILT_IN_ANNOTATION_PROPERTIES,
    ...ANNOTATION_PROPERTIES,
    ...SKOS_ANNOTATION_PROPERTIES,
  ])

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

  // --- Nodes ---------------------------------------------------------------------------------------------
  const concepts = new Set(subjectsOfType(SKOS + 'Concept'))
  const schemes = new Set(subjectsOfType(SKOS + 'ConceptScheme'))
  const skipClasses = new Set([OWL + 'Thing', OWL + 'Nothing', SKOS + 'Concept', SKOS + 'ConceptScheme'])
  const declaredClasses = new Set([...subjectsOfType(OWL + 'Class'), ...subjectsOfType(RDFS + 'Class')])
  const classIris = [...declaredClasses].filter((c) => !skipClasses.has(c))
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

  // Classes an object property goes from or to, when its other end is drawn, get a box too: an outside one when
  // the file doesn't declare them, e.g. skos:Concept or a class of another ontology. owl:Thing stays out.
  for (const p of subjectsOfType(OWL + 'ObjectProperty').filter((p) => !p.startsWith(SKOS))) {
    const ends = [object(p, RDFS + 'domain'), object(p, RDFS + 'range')].map((t) => unionMembers(t).filter((c) => c !== OWL + 'Thing' && c !== OWL + 'Nothing'))
    if (ends.some((e) => e.length === 0) || !ends.flat().some((c) => classIris.includes(c))) continue
    for (const c of ends.flat()) if (!classIris.includes(c) && !concepts.has(c) && !schemes.has(c)) classIris.push(c)
  }

  for (const c of classIris) {
    if (concepts.has(c) || schemes.has(c)) continue
    // Not declared in the file, or declared without a label in another namespace, as this app exports an outside class.
    if (!declaredClasses.has(c) || (!labelTerm(c) && !c.startsWith(iri))) {
      // Named the way the file would write it, e.g. skos:Concept; a namespace with a tag on the box needs only the local name.
      const local = c.replace(/^.*[#/]/, '') || c
      const field = iriField(c, localName(local))
      addNode(c, { label: field.namespace ? local : shortName(c), outside: true, ...field, style: OUTSIDE_STYLE })
      continue
    }
    const label = labelOf(c)
    addNode(c, { label, ...labelLangOf(c), ...iriField(c, localName(label)) })
  }
  for (const c of [...schemes, ...concepts]) {
    const pref = labelTerm(c, SKOS + 'prefLabel')
    const label = pref?.value ?? labelOf(c)
    const lang = pref ? labelLangOf(c, SKOS + 'prefLabel') : labelLangOf(c)
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


  // A property kept as it is, see KeptProperty.
  const kept: KeptProperty[] = []
  const keep = (p: string, kind: KeptProperty['kind']) => {
    namespaceField(p)
    const named = (predicate: string) => objects(p, predicate).filter((o) => o.termType === 'NamedNode').map((o) => o.value)
    const domains = unionMembers(object(p, RDFS + 'domain'))
    const ranges = unionMembers(object(p, RDFS + 'range'))
    const characteristics = kind === 'object' ? objects(p, TYPE).map((t) => CHARACTERISTICS[t.value]).filter((c): c is Characteristic => !!c) : []
    if (kind === 'data' && isA(p, OWL + 'FunctionalProperty')) characteristics.push('functional')
    kept.push({
      kind,
      iri: p,
      label: labelTerm(p)?.value ?? '',
      ...labelLangOf(p),
      ...(domains.length > 0 && { domains }),
      ...(ranges.length > 0 && { ranges }),
      ...(characteristics.length > 0 && { characteristics }),
      ...(named(RDFS + 'subPropertyOf').length > 0 && { subPropertyOf: named(RDFS + 'subPropertyOf') }),
      ...(named(OWL + 'inverseOf').length > 0 && { inverseOf: named(OWL + 'inverseOf') }),
      ...annotationsOf(p),
    })
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
      ...labelLangOf(p),
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
      keep(p, 'object')
      skip('object properties that cannot be drawn as arrows (kept for the export)')
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
      addEdge(nodeId.get(q.subject.value)!, nodeId.get(q.object.value)!, { kind: 'annotationProperty', label, ...labelLangOf(ap), ...iriField(ap, propertyLocalName(label)) })
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
        const name = labelOf(p)
        listed.push({
          name,
          datatype: range ?? XSD + 'string',
          ...(isA(p, OWL + 'FunctionalProperty') && { functional: true }),
          ...labelLangOf(p),
          ...iriField(p, propertyLocalName(name)),
          ...annotationsOf(p),
        })
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

    // Values of the ontology's own data and object properties on a concept or scheme, e.g. an ordinal.
    if (data.kind) {
      const values: PropertyValue[] = []
      for (const q of store.getQuads(entity, null, null, null)) {
        const p = q.predicate.value
        if (STRUCTURAL.has(p) || !(isA(p, OWL + 'DatatypeProperty') || isA(p, OWL + 'ObjectProperty'))) continue
        if (q.object.termType === 'NamedNode') values.push({ property: p, value: q.object.value, kind: 'iri' })
        else if (q.object.termType === 'Literal') {
          const { language, datatype } = q.object
          values.push({ property: p, value: q.object.value, kind: 'literal', ...(language ? { lang: language } : datatype.value !== XSD + 'string' && { datatype: datatype.value }) })
        }
      }
      if (values.length > 0) data.values = values
    }

    // An outside class has no label of its own, so every label it has in the file is an annotation.
    Object.assign(data, annotationsOf(entity, data.outside ? NO_LABEL : data.kind && labelTerm(entity, SKOS + 'prefLabel') ? SKOS + 'prefLabel' : LABEL))
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

  const dataOnly = dataProperties.filter((p) => !dataPropertyCount.has(p))
  for (const p of dataOnly) keep(p, 'data')
  if (dataOnly.length) skip('data properties without a domain class (kept for the export)', dataOnly.length)
  const individuals = subjectsOfType(OWL + 'NamedIndividual').filter((i) => !concepts.has(i) && !schemes.has(i)).length
  if (individuals) skip('individuals', individuals)
  const shapes = subjectsOfType('http://www.w3.org/ns/shacl#NodeShape').length
  if (shapes) skip('SHACL shapes', shapes)

  const layout = parseLayout(ontologyIri ? (object(ontologyIri, LAYOUT_PROPERTY) ?? object(ontologyIri, OLD_LAYOUT_PROPERTY))?.value : undefined)

  return {
    iri,
    namespaces: [...namespaces].map(([ns, prefix]) => ({ prefix, iri: ns })),
    nodes,
    edges,
    kept,
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

  // Annotation assertions with literal or IRI values, as the inspector lists them. The label shown as the name
  // (`labelPredicate`, rdfs:label or a concept's skos:prefLabel, see labelTerm) is left out; other labels stay.
  function annotationsOf(subject: string, labelPredicate = LABEL): { annotations?: Annotation[] } {
    const annotations: Annotation[] = []
    const name = labelTerm(subject, labelPredicate)
    for (const q of store.getQuads(subject, null, null, null)) {
      const p = q.predicate.value
      if (p === labelPredicate && name?.equals(q.object)) continue
      if (STRUCTURAL.has(p) && p !== SKOS + 'prefLabel' && p !== LABEL) continue
      if (!declaredAnnotationProperties.has(p)) continue
      if (q.object.termType === 'Literal') {
        const { language, datatype } = q.object
        annotations.push({ property: p, value: q.object.value, ...(language ? { lang: language } : datatype.value !== XSD + 'string' && { datatype: datatype.value }) })
      } else if (q.object.termType === 'NamedNode' && !nodeId.has(q.object.value)) {
        annotations.push({ property: p, value: q.object.value, ...(!IRI_VALUED.has(p) && { iri: true }) })
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
