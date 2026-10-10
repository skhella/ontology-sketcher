import { DataFactory, Writer, type Quad } from 'n3'
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
      const prop = namedNode(iri)
      quads.push(quad(prop, type, namedNode(OWL + 'ObjectProperty')))
      quads.push(quad(prop, label, literal(edge.data.label)))
      quads.push(quad(prop, namedNode(RDFS + 'domain'), namedNode(source)))
      quads.push(quad(prop, namedNode(RDFS + 'range'), namedNode(target)))
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

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
