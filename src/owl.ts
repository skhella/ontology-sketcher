import { DataFactory, Writer, type NamedNode, type Quad, type Quad_Object } from 'n3'
import { localName, propertyLocalName, type Characteristic, type ClassExpression, type EntityData, type Ontology, type Quantifier } from './model'
import { isSkosEdge, skosQuads } from './skos'
import { BUILT_IN_ANNOTATION_PROPERTIES, expandIri, IRI_VALUED, isAbsoluteIri, OWL, PREFIXES, RDF, RDFS, XSD } from './vocab'

const { literal, namedNode, quad } = DataFactory

/** The IRI of a class or property: its own `iri` when set, else `localName` after the ontology IRI. */
export function entityIri(base: string, data: EntityData, local: string): string {
  return data.iri?.trim() ? expandIri(data.iri, base) : base + local
}

// The OWL vocabulary for each quantifier: [predicate without a filler, predicate with a filler class].
const RESTRICTION: Record<Quantifier, [string, string]> = {
  some: ['', OWL + 'someValuesFrom'],
  only: ['', OWL + 'allValuesFrom'],
  min: [OWL + 'minCardinality', OWL + 'minQualifiedCardinality'],
  max: [OWL + 'maxCardinality', OWL + 'maxQualifiedCardinality'],
  exactly: [OWL + 'cardinality', OWL + 'qualifiedCardinality'],
}

const CHARACTERISTIC: Record<Characteristic, string> = {
  functional: OWL + 'FunctionalProperty',
  inverseFunctional: OWL + 'InverseFunctionalProperty',
  transitive: OWL + 'TransitiveProperty',
  symmetric: OWL + 'SymmetricProperty',
  asymmetric: OWL + 'AsymmetricProperty',
  reflexive: OWL + 'ReflexiveProperty',
  irreflexive: OWL + 'IrreflexiveProperty',
}

const AXIOM_PREDICATE = { subClassOf: RDFS + 'subClassOf', equivalentClass: OWL + 'equivalentClass', disjointWith: OWL + 'disjointWith' }

/** The annotation assertions on a class, property, concept or scheme; empty values are left out. */
function annotationQuads(subject: string, data: EntityData): Quad[] {
  return (data.annotations ?? []).flatMap((a) => {
    const value = a.value.trim()
    if (!value || !a.property) return []
    const object = IRI_VALUED.has(a.property) && isAbsoluteIri(value) ? namedNode(value) : literal(value, a.lang?.trim() || undefined)
    return [quad(namedNode(subject), namedNode(a.property), object)]
  })
}

/** Serializes the canvas model as an OWL 2 ontology in Turtle. */
export function toTurtle(ontology: Ontology): Promise<string> {
  const base = ontology.iri
  const ontologyIri = base.replace(/[#/]$/, '')
  const quads: Quad[] = []
  const entities: EntityData[] = [...ontology.nodes.map((n) => n.data), ...ontology.edges.map((e) => e.data ?? {})]
  const usedAnnotationProperties = new Set(
    entities.flatMap((d) =>
      (d.annotations ?? []).filter((a) => a.property && a.value.trim()).map((a) => a.property),
    ),
  )
  // SKOS concepts and schemes, see skos.ts; computed first so their annotation properties are declared too.
  const skos = skosQuads(ontology, (data, local) => entityIri(base, data, local), annotationQuads)
  for (const p of skos.annotationProperties) usedAnnotationProperties.add(p)
  const usesXsd = ontology.nodes.some(
    (n) =>
      !!n.data.dataProperties?.length ||
      n.data.axioms?.some((a) => a.expression.type === 'restriction' && !['some', 'only'].includes(a.expression.quantifier)),
  )

  const prefixes: Record<string, string> = { '': base, owl: OWL, rdf: RDF, rdfs: RDFS }
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if ([...usedAnnotationProperties].some((p) => p.startsWith(ns))) prefixes[prefix] = ns
  }
  if (usesXsd) prefixes.xsd = XSD
  const writer = new Writer({ prefixes })
  const type = namedNode(RDF + 'type')
  const label = namedNode(RDFS + 'label')

  const annotate = (subject: string, data: EntityData) => quads.push(...annotationQuads(subject, data))

  quads.push(quad(namedNode(ontologyIri), type, namedNode(OWL + 'Ontology')))

  const classIri = new Map<string, string>()
  const annotationProperties = new Set<string>()
  // Per object property IRI: its labels, and source class IRI → target class IRIs over every edge drawn with it.
  const properties = new Map<string, { labels: Set<string>; uses: Map<string, Set<string>>; edges: string[] }>()
  for (const node of ontology.nodes) {
    if (node.data.kind) continue
    const iri = entityIri(base, node.data, localName(node.data.label))
    classIri.set(node.id, iri)
    quads.push(quad(namedNode(iri), type, namedNode(OWL + 'Class')))
    quads.push(quad(namedNode(iri), label, literal(node.data.label)))
    annotate(iri, node.data)
  }

  const propertyIri = new Map<string, string>()
  for (const edge of ontology.edges) {
    if (edge.data?.kind === 'objectProperty') propertyIri.set(edge.id, entityIri(base, edge.data, propertyLocalName(edge.data.label)))
  }

  // A named class, or an inline [ a owl:Restriction … ]; undefined when it points at a deleted class or property.
  const expression = (e: ClassExpression): Quad_Object | undefined => {
    if (e.type === 'class') {
      const iri = classIri.get(e.ref)
      return iri ? namedNode(iri) : undefined
    }
    const property = propertyIri.get(e.property)
    const filler = e.filler === undefined ? undefined : classIri.get(e.filler)
    if (!property || (e.filler !== undefined && !filler)) return undefined
    const [unqualified, qualified] = RESTRICTION[e.quantifier]
    const parts: { predicate: NamedNode; object: Quad_Object }[] = [
      { predicate: type, object: namedNode(OWL + 'Restriction') },
      { predicate: namedNode(OWL + 'onProperty'), object: namedNode(property) },
    ]
    if (e.quantifier === 'some' || e.quantifier === 'only') {
      parts.push({ predicate: namedNode(qualified), object: namedNode(filler ?? OWL + 'Thing') })
    } else {
      const n = literal(String(Math.max(0, Math.floor(e.n ?? 0))), namedNode(XSD + 'nonNegativeInteger'))
      parts.push({ predicate: namedNode(filler ? qualified : unqualified), object: n })
      if (filler) parts.push({ predicate: namedNode(OWL + 'onClass'), object: namedNode(filler) })
    }
    return writer.blank(parts) as unknown as Quad_Object
  }

  for (const node of ontology.nodes) {
    for (const axiom of node.data.axioms ?? []) {
      const object = expression(axiom.expression)
      if (object) quads.push(quad(namedNode(classIri.get(node.id)!), namedNode(AXIOM_PREDICATE[axiom.kind]), object))
    }
  }

  for (const edge of ontology.edges) {
    const source = classIri.get(edge.source)
    const target = classIri.get(edge.target)
    if (!source || !target || !edge.data || isSkosEdge(edge.data.kind)) continue

    if (edge.data.kind === 'subClassOf') {
      quads.push(quad(namedNode(source), namedNode(RDFS + 'subClassOf'), namedNode(target)))
    } else if (edge.data.kind === 'annotationProperty') {
      // An annotation between two classes, e.g. :Pizza :inspiredBy :Flatbread; no domain or range.
      const iri = entityIri(base, edge.data, propertyLocalName(edge.data.label))
      if (!annotationProperties.has(iri)) {
        annotationProperties.add(iri)
        quads.push(quad(namedNode(iri), type, namedNode(OWL + 'AnnotationProperty')))
        quads.push(quad(namedNode(iri), label, literal(edge.data.label)))
      }
      quads.push(quad(namedNode(source), namedNode(iri), namedNode(target)))
      annotate(iri, edge.data)
    } else {
      const iri = entityIri(base, edge.data, propertyLocalName(edge.data.label))
      let property = properties.get(iri)
      if (!property) {
        property = { labels: new Set(), uses: new Map(), edges: [] }
        properties.set(iri, property)
        quads.push(quad(namedNode(iri), type, namedNode(OWL + 'ObjectProperty')))
      }
      // Declared and labelled once, however many arrows carry the property.
      if (!property.labels.has(edge.data.label)) {
        property.labels.add(edge.data.label)
        quads.push(quad(namedNode(iri), label, literal(edge.data.label)))
      }
      if (!property.uses.has(source)) property.uses.set(source, new Set())
      property.uses.get(source)!.add(target)
      property.edges.push(edge.id)
      annotate(iri, edge.data)
    }
  }

  // Characteristics, inverseOf and subPropertyOf, gathered over every edge of each object property.
  const edgeData = new Map(ontology.edges.map((e) => [e.id, e.data]))
  for (const [iri, { edges }] of properties) {
    const data = edges.map((id) => edgeData.get(id)!)
    const characteristics = new Set(data.flatMap((d) => d.characteristics ?? []))
    for (const c of Object.keys(CHARACTERISTIC) as Characteristic[]) {
      if (characteristics.has(c)) quads.push(quad(namedNode(iri), type, namedNode(CHARACTERISTIC[c])))
    }
    for (const [field, predicate] of [['inverseOf', OWL + 'inverseOf'], ['subPropertyOf', RDFS + 'subPropertyOf']] as const) {
      const others = new Set(data.map((d) => d[field] && propertyIri.get(d[field])).filter((o): o is string => !!o && o !== iri))
      for (const other of others) quads.push(quad(namedNode(iri), namedNode(predicate), namedNode(other)))
    }
  }

  // Data properties listed on classes; classes sharing a name share the property.
  const dataProperties = new Map<string, { label: string; domains: Set<string>; datatypes: Set<string>; functional: boolean }>()
  for (const node of ontology.nodes) {
    for (const p of node.data.dataProperties ?? []) {
      if (!p.name.trim()) continue
      const iri = base + propertyLocalName(p.name)
      const entry = dataProperties.get(iri) ?? { label: p.name.trim(), domains: new Set(), datatypes: new Set(), functional: false }
      entry.domains.add(classIri.get(node.id)!)
      if (p.datatype) entry.datatypes.add(p.datatype)
      entry.functional ||= !!p.functional
      dataProperties.set(iri, entry)
    }
  }

  // OWL 2 DL wants every annotation property that isn't built in declared, e.g. skos:definition.
  const declarations = [...usedAnnotationProperties]
    .filter((p) => !BUILT_IN_ANNOTATION_PROPERTIES.has(p))
    .map((p) => quad(namedNode(p), type, namedNode(OWL + 'AnnotationProperty')))

  writer.addQuads([quads[0], ...declarations, ...quads.slice(1), ...skos.quads])

  // A property drawn between several class pairs: OWL reads repeated domain/range axioms as an
  // intersection, so the domain and range are unions, and each source class keeps its own targets
  // as `Source ⊑ ∀p.(T1 ⊔ …)` wherever they are narrower than the overall range.
  const union = (iris: Iterable<string>, kind = OWL + 'Class') => {
    const members = [...iris].map((i) => namedNode(i))
    if (members.length === 1) return members[0]
    return writer.blank([
      { predicate: type, object: namedNode(kind) },
      // @types/n3 types list() as an array; at runtime it is one serialized `( … )` term.
      { predicate: namedNode(OWL + 'unionOf'), object: writer.list(members) as unknown as Quad_Object },
    ])
  }
  const restrictions: [string, string, Set<string>][] = []
  for (const [iri, { uses }] of properties) {
    const ranges = new Set([...uses.values()].flatMap((targets) => [...targets]))
    writer.addQuad(namedNode(iri), namedNode(RDFS + 'domain'), union(uses.keys()))
    writer.addQuad(namedNode(iri), namedNode(RDFS + 'range'), union(ranges))
    for (const [source, targets] of uses) if (targets.size < ranges.size) restrictions.push([source, iri, targets])
  }
  for (const [source, iri, targets] of restrictions) {
    writer.addQuad(
      namedNode(source),
      namedNode(RDFS + 'subClassOf'),
      writer.blank([
        { predicate: type, object: namedNode(OWL + 'Restriction') },
        { predicate: namedNode(OWL + 'onProperty'), object: namedNode(iri) },
        { predicate: namedNode(OWL + 'allValuesFrom'), object: union(targets) },
      ]),
    )
  }

  for (const [iri, { label: name, domains, datatypes, functional }] of dataProperties) {
    writer.addQuad(namedNode(iri), type, namedNode(OWL + 'DatatypeProperty'))
    if (functional) writer.addQuad(namedNode(iri), type, namedNode(OWL + 'FunctionalProperty'))
    writer.addQuad(namedNode(iri), label, literal(name))
    writer.addQuad(namedNode(iri), namedNode(RDFS + 'domain'), union(domains))
    if (datatypes.size > 0) writer.addQuad(namedNode(iri), namedNode(RDFS + 'range'), union(datatypes, RDFS + 'Datatype'))
  }

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
