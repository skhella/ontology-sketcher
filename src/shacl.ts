import { DataFactory, Writer, type NamedNode, type Quad_Object } from 'n3'
import { localName, propertyLocalName, type Ontology, type PropertyConstraint } from './model'
import { entityIri } from './owl'
import { OWL, RDF, XSD } from './vocab'

export const SH = 'http://www.w3.org/ns/shacl#'

const { literal, namedNode } = DataFactory

/** The shapes graph's own IRI, next to the ontology's: http://example.org/pizza# → http://example.org/pizza/shapes. */
export function shapesIri(base: string): string {
  return base.replace(/[#/]$/, '') + '/shapes'
}

/** Whether any class carries constraints, i.e. whether there are shapes to export. */
export function hasConstraints(ontology: Ontology): boolean {
  return ontology.nodes.some((n) => !!n.data.constraints?.length)
}

/**
 * Serializes the classes' constraints as a SHACL shapes graph in Turtle, separate from the OWL file:
 * one sh:NodeShape per class with constraints, targeting that class, with one sh:property per constraint.
 * The shapes graph imports the ontology, so tools that follow owl:imports see both.
 */
export function toShaclTurtle(ontology: Ontology): Promise<string> {
  const base = ontology.iri
  const ontologyIri = base.replace(/[#/]$/, '')
  const shapes = shapesIri(base)
  const writer = new Writer({ prefixes: { '': base, shape: shapes + '#', sh: SH, owl: OWL, rdf: RDF, xsd: XSD } })
  const type = namedNode(RDF + 'type')
  const sh = (name: string) => namedNode(SH + name)
  const count = (n: number) => literal(String(Math.max(0, Math.floor(n))), namedNode(XSD + 'integer'))

  writer.addQuad(namedNode(shapes), type, namedNode(OWL + 'Ontology'))
  writer.addQuad(namedNode(shapes), namedNode(OWL + 'imports'), namedNode(ontologyIri))

  const classIri = new Map(ontology.nodes.map((n) => [n.id, entityIri(base, n.data, localName(n.data.label))]))
  const edges = new Map(ontology.edges.map((e) => [e.id, e.data]))

  // The property a constraint is about; undefined when it points at a deleted edge.
  const pathIri = (path: PropertyConstraint['path']): string | undefined => {
    if (path.type === 'data') return path.name.trim() ? base + propertyLocalName(path.name) : undefined
    const data = edges.get(path.property)
    return data?.kind === 'objectProperty' ? entityIri(base, data, propertyLocalName(data.label)) : undefined
  }

  const names = new Set<string>()
  for (const node of ontology.nodes) {
    const constraints = node.data.constraints ?? []
    if (constraints.length === 0) continue
    const target = classIri.get(node.id)!

    // Named after the class's local name; a number keeps two classes with the same local name apart.
    const local = target.replace(/^.*[#/]/, '') || 'Unnamed'
    let name = `${local}Shape`
    for (let i = 2; names.has(name); i++) name = `${local}Shape${i}`
    names.add(name)
    const shape = namedNode(`${shapes}#${name}`)

    writer.addQuad(shape, type, sh('NodeShape'))
    writer.addQuad(shape, sh('targetClass'), namedNode(target))
    for (const c of constraints) {
      const path = pathIri(c.path)
      const valueClass = c.path.type === 'object' && c.class !== undefined ? classIri.get(c.class) : undefined
      if (!path || (c.path.type === 'object' && c.class !== undefined && !valueClass)) continue
      const parts: { predicate: NamedNode; object: Quad_Object }[] = [{ predicate: sh('path'), object: namedNode(path) }]
      if (c.minCount !== undefined) parts.push({ predicate: sh('minCount'), object: count(c.minCount) })
      if (c.maxCount !== undefined) parts.push({ predicate: sh('maxCount'), object: count(c.maxCount) })
      if (valueClass) parts.push({ predicate: sh('class'), object: namedNode(valueClass) })
      if (c.path.type === 'data' && c.datatype) parts.push({ predicate: sh('datatype'), object: namedNode(c.datatype) })
      if (c.message?.trim()) parts.push({ predicate: sh('message'), object: literal(c.message.trim()) })
      writer.addQuad(shape, sh('property'), writer.blank(parts) as unknown as Quad_Object)
    }
  }

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
