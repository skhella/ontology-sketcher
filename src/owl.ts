import { DataFactory, Writer, type Quad, type Quad_Object } from 'n3'
import { localName, propertyLocalName, type EntityData, type Ontology } from './model'
import { BUILT_IN_ANNOTATION_PROPERTIES, expandIri, IRI_VALUED, isAbsoluteIri, OWL, PREFIXES, RDF, RDFS } from './vocab'

const { literal, namedNode, quad } = DataFactory

/** The IRI of a class or property: its own `iri` when set, else `localName` after the ontology IRI. */
export function entityIri(base: string, data: EntityData, local: string): string {
  return data.iri?.trim() ? expandIri(data.iri, base) : base + local
}

/** Serializes the canvas model as an OWL 2 ontology in Turtle. */
export function toTurtle(ontology: Ontology): Promise<string> {
  const base = ontology.iri
  const ontologyIri = base.replace(/[#/]$/, '')
  const quads: Quad[] = []
  const usedAnnotationProperties = new Set<string>()
  const type = namedNode(RDF + 'type')
  const label = namedNode(RDFS + 'label')

  const annotate = (subject: string, data: EntityData) => {
    for (const a of data.annotations ?? []) {
      const value = a.value.trim()
      if (!value || !a.property) continue
      usedAnnotationProperties.add(a.property)
      const object = IRI_VALUED.has(a.property) && isAbsoluteIri(value) ? namedNode(value) : literal(value, a.lang?.trim() || undefined)
      quads.push(quad(namedNode(subject), namedNode(a.property), object))
    }
  }

  quads.push(quad(namedNode(ontologyIri), type, namedNode(OWL + 'Ontology')))

  const classIri = new Map<string, string>()
  // Per object property IRI: its labels, and source class IRI → target class IRIs over every edge drawn with it.
  const properties = new Map<string, { labels: Set<string>; uses: Map<string, Set<string>> }>()
  for (const node of ontology.nodes) {
    const iri = entityIri(base, node.data, localName(node.data.label))
    classIri.set(node.id, iri)
    quads.push(quad(namedNode(iri), type, namedNode(OWL + 'Class')))
    quads.push(quad(namedNode(iri), label, literal(node.data.label)))
    annotate(iri, node.data)
  }

  for (const edge of ontology.edges) {
    const source = classIri.get(edge.source)
    const target = classIri.get(edge.target)
    if (!source || !target || !edge.data) continue

    if (edge.data.kind === 'subClassOf') {
      quads.push(quad(namedNode(source), namedNode(RDFS + 'subClassOf'), namedNode(target)))
    } else {
      const iri = entityIri(base, edge.data, propertyLocalName(edge.data.label))
      let property = properties.get(iri)
      if (!property) {
        property = { labels: new Set(), uses: new Map() }
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
      annotate(iri, edge.data)
    }
  }

  // OWL 2 DL wants every annotation property that isn't built in declared, e.g. skos:definition.
  const declarations = [...usedAnnotationProperties]
    .filter((p) => !BUILT_IN_ANNOTATION_PROPERTIES.has(p))
    .map((p) => quad(namedNode(p), type, namedNode(OWL + 'AnnotationProperty')))

  const prefixes: Record<string, string> = { '': base, owl: OWL, rdf: RDF, rdfs: RDFS }
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if ([...usedAnnotationProperties].some((p) => p.startsWith(ns))) prefixes[prefix] = ns
  }
  const writer = new Writer({ prefixes })
  writer.addQuads([quads[0], ...declarations, ...quads.slice(1)])

  // A property drawn between several class pairs: OWL reads repeated domain/range axioms as an
  // intersection, so the domain and range are unions, and each source class keeps its own targets
  // as `Source ⊑ ∀p.(T1 ⊔ …)` wherever they are narrower than the overall range.
  const union = (iris: Iterable<string>) => {
    const members = [...iris].map((i) => namedNode(i))
    if (members.length === 1) return members[0]
    return writer.blank([
      { predicate: type, object: namedNode(OWL + 'Class') },
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

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
