import { DataFactory, Writer } from 'n3'
import { localName, propertyLocalName, type Ontology } from './model'

const { namedNode, quad } = DataFactory

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const OWL = 'http://www.w3.org/2002/07/owl#'

/** Serializes the canvas model as an OWL 2 ontology in Turtle. */
export function toTurtle(ontology: Ontology): Promise<string> {
  const base = ontology.iri
  const ontologyIri = base.replace(/[#/]$/, '')
  const writer = new Writer({
    prefixes: { '': base, owl: OWL, rdf: RDF, rdfs: RDFS },
  })
  const type = namedNode(RDF + 'type')
  const label = namedNode(RDFS + 'label')

  writer.addQuad(quad(namedNode(ontologyIri), type, namedNode(OWL + 'Ontology')))

  const classIri = new Map<string, string>()
  for (const node of ontology.nodes) {
    const iri = base + localName(node.data.label)
    classIri.set(node.id, iri)
    writer.addQuad(quad(namedNode(iri), type, namedNode(OWL + 'Class')))
    writer.addQuad(quad(namedNode(iri), label, DataFactory.literal(node.data.label)))
  }

  for (const edge of ontology.edges) {
    const source = classIri.get(edge.source)
    const target = classIri.get(edge.target)
    if (!source || !target || !edge.data) continue

    if (edge.data.kind === 'subClassOf') {
      writer.addQuad(quad(namedNode(source), namedNode(RDFS + 'subClassOf'), namedNode(target)))
    } else {
      const prop = namedNode(base + propertyLocalName(edge.data.label))
      writer.addQuad(quad(prop, type, namedNode(OWL + 'ObjectProperty')))
      writer.addQuad(quad(prop, label, DataFactory.literal(edge.data.label)))
      writer.addQuad(quad(prop, namedNode(RDFS + 'domain'), namedNode(source)))
      writer.addQuad(quad(prop, namedNode(RDFS + 'range'), namedNode(target)))
    }
  }

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
