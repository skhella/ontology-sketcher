import { DataFactory, Writer, type NamedNode, type Quad_Object } from 'n3'
import { localName, propertyLocalName, type ClassAxiom, type Ontology, type PropertyConstraint } from './model'
import { namespacePrefixes } from './namespaces'
import { entityIri } from './owl'
import { parseTurtle } from './turtle'
import { OWL, RDF, RDFS, shortName, XSD } from './vocab'

export const SH = 'http://www.w3.org/ns/shacl#'

const { literal, namedNode } = DataFactory

/** The shapes graph's own IRI, next to the ontology's: http://example.org/pizza# → http://example.org/pizza/shapes. */
export function shapesIri(base: string): string {
  return base.replace(/[#/]$/, '') + '/shapes'
}

/**
 * A value typed in the inspector (an allowed value or a range bound), as a literal of the constraint's datatype.
 * Without a usable datatype, numbers become xsd:decimal (so ranges compare as numbers) and anything else a plain string.
 */
export function constraintValue(text: string, datatype: string | undefined) {
  const t = text.trim()
  if (datatype && datatype !== RDFS + 'Literal' && datatype !== RDF + 'langString') return literal(t, namedNode(datatype))
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? literal(t, namedNode(XSD + 'decimal')) : literal(t)
}

/** Whether any class carries constraints, i.e. whether there are shapes to export. */
export function hasConstraints(ontology: Ontology): boolean {
  return ontology.nodes.some((n) => !!n.data.constraints?.length || !!n.data.extraShapes?.trim())
}

/**
 * Whether the shapes file has any shape: besides constraints, every arrow between two classes, every data property
 * with a datatype and every restriction axiom becomes a rule (see toShaclTurtle).
 */
export function hasShapes(ontology: Ontology): boolean {
  const isClass = new Set(ontology.nodes.filter((n) => !n.data.kind).map((n) => n.id))
  return (
    hasConstraints(ontology) ||
    ontology.edges.some((e) => e.data?.kind === 'objectProperty' && isClass.has(e.source) && isClass.has(e.target)) ||
    ontology.nodes.some(
      (n) => !n.data.kind && (n.data.dataProperties?.some((p) => p.name.trim() && p.datatype) || n.data.axioms?.some((a) => a.expression.type === 'restriction')),
    )
  )
}

/** A class or property by its local name, for messages: https://w3id.org/x#hasPart → hasPart. */
const localOf = (iri: string) => iri.replace(/^.*[#/]/, '') || iri

/** How the message of a shape made from a restriction axiom starts, which tells it apart from an arrow's. */
export const AXIOM_MESSAGE = 'From the class axiom '

/** "A", "A or B", "A, B or C". */
const either = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`)

/**
 * Serializes what the sketch says instance data should look like as a SHACL shapes graph in Turtle, separate from
 * the OWL file (see toTurtle): one sh:NodeShape per class, targeting that class, with an sh:property for
 * - each object property drawn from the class: sh:class of the target, or sh:or over the targets when the
 *   property is drawn from the class to several (no counts: an arrow says nothing about how many);
 * - each data property listed on the class: its sh:datatype;
 * - each restriction axiom: `only` as sh:class, `some` and cardinalities as (qualified) counts, as written;
 *   a disjointWith restriction as sh:not;
 * - each constraint row from the inspector;
 * plus any shapes imported for the class that the constraints can't hold (see shapesImport.ts).
 * Rules from the drawing carry an sh:message naming the class, the property and what is allowed.
 * The shapes graph imports the ontology, so tools that follow owl:imports see both.
 */
export function toShaclTurtle(ontology: Ontology): Promise<string> {
  const base = ontology.iri
  const ontologyIri = base.replace(/[#/]$/, '')
  const shapes = shapesIri(base)
  const writer = new Writer({ prefixes: { '': base, ...namespacePrefixes(ontology.namespaces, base), shape: shapes + '#', sh: SH, owl: OWL, rdf: RDF, xsd: XSD } })
  const type = namedNode(RDF + 'type')
  const sh = (name: string) => namedNode(SH + name)
  const count = (n: number) => literal(String(Math.max(0, Math.floor(n))), namedNode(XSD + 'integer'))

  writer.addQuad(namedNode(shapes), type, namedNode(OWL + 'Ontology'))
  writer.addQuad(namedNode(shapes), namedNode(OWL + 'imports'), namedNode(ontologyIri))

  const classIri = new Map(ontology.nodes.map((n) => [n.id, entityIri(base, n.data, localName(n.data.label))]))
  const isClass = new Set(ontology.nodes.filter((n) => !n.data.kind).map((n) => n.id))
  const edges = new Map(ontology.edges.map((e) => [e.id, e.data]))
  type Parts = { predicate: NamedNode; object: Quad_Object }[]
  const message = (text: string) => ({ predicate: sh('message'), object: literal(text) })
  const blank = (parts: Parts) => writer.blank(parts) as unknown as Quad_Object

  // Per source class: property IRI → the classes it is drawn to, in drawing order.
  const arrows = new Map<string, Map<string, string[]>>()
  for (const edge of ontology.edges) {
    if (edge.data?.kind !== 'objectProperty' || !isClass.has(edge.source) || !isClass.has(edge.target)) continue
    const property = entityIri(base, edge.data, propertyLocalName(edge.data.label))
    const byProperty = arrows.get(edge.source) ?? new Map<string, string[]>()
    const targets = byProperty.get(property) ?? []
    const target = classIri.get(edge.target)!
    if (!targets.includes(target)) targets.push(target)
    byProperty.set(property, targets)
    arrows.set(edge.source, byProperty)
  }

  // sh:class (or sh:datatype) for one allowed value, sh:or over several.
  const oneOf = (kind: 'class' | 'datatype', values: string[]): Parts =>
    values.length === 1
      ? [{ predicate: sh(kind), object: namedNode(values[0]) }]
      : [{ predicate: sh('or'), object: writer.list(values.map((v) => blank([{ predicate: sh(kind), object: namedNode(v) }]))) as unknown as Quad_Object }]

  // A restriction axiom as a property shape; undefined when it says nothing about data (`only owl:Thing`) or points at a deleted entity.
  const axiomShape = (source: string, axiom: ClassAxiom): Parts | undefined => {
    const e = axiom.expression
    if (e.type !== 'restriction') return undefined
    const data = edges.get(e.property)
    const property = data?.kind === 'objectProperty' ? entityIri(base, data, propertyLocalName(data.label)) : undefined
    const filler = e.filler === undefined ? undefined : classIri.get(e.filler)
    if (!property || (e.filler !== undefined && !filler) || (e.quantifier === 'only' && !filler)) return undefined
    const n = e.quantifier === 'some' ? 1 : Math.max(0, Math.floor(e.n ?? 0))
    const parts: Parts = [{ predicate: sh('path'), object: namedNode(property) }]
    if (e.quantifier === 'only') parts.push({ predicate: sh('class'), object: namedNode(filler!) })
    else {
      const [min, max] = filler ? ['qualifiedMinCount', 'qualifiedMaxCount'] : ['minCount', 'maxCount']
      if (filler) parts.push({ predicate: sh('qualifiedValueShape'), object: blank([{ predicate: sh('class'), object: namedNode(filler) }]) })
      if (e.quantifier !== 'max') parts.push({ predicate: sh(min), object: count(n) })
      if (e.quantifier === 'max' || e.quantifier === 'exactly') parts.push({ predicate: sh(max), object: count(n) })
    }
    const said = [localOf(source), axiom.kind, localOf(property), e.quantifier, ...(['some', 'only'].includes(e.quantifier) ? [] : [String(n)]), ...(filler ? [localOf(filler)] : [])]
    parts.push(message(`${AXIOM_MESSAGE}${said.join(' ')}.`))
    return parts
  }

  // The property a constraint is about; undefined when it points at a deleted edge.
  const pathIri = (path: PropertyConstraint['path']): string | undefined => {
    if (path.type === 'data') return path.name.trim() ? base + propertyLocalName(path.name) : undefined
    const data = edges.get(path.property)
    return data?.kind === 'objectProperty' ? entityIri(base, data, propertyLocalName(data.label)) : undefined
  }

  const names = new Set<string>()
  for (const node of ontology.nodes) {
    // Imported shapes the rows can't hold go out as they came in.
    if (node.data.extraShapes?.trim()) writer.addQuads(parseTurtle(node.data.extraShapes, base).store.getQuads(null, null, null, null))
    const constraints = node.data.constraints ?? []
    const target = classIri.get(node.id)!
    // Rules from the drawing: arrows, data property datatypes and restriction axioms.
    const drawn: Parts[] = []
    const excluded: Parts[] = []
    if (isClass.has(node.id)) {
      for (const [property, targets] of arrows.get(node.id) ?? []) {
        drawn.push([
          { predicate: sh('path'), object: namedNode(property) },
          ...oneOf('class', targets),
          message(`${localOf(target)} ${localOf(property)}: every value must be an instance of ${either(targets.map(localOf))}.`),
        ])
      }
      const datatypes = new Map<string, string[]>()
      for (const p of node.data.dataProperties ?? []) {
        if (!p.name.trim() || !p.datatype) continue
        const iri = base + propertyLocalName(p.name)
        const listed = datatypes.get(iri) ?? []
        if (!listed.includes(p.datatype)) listed.push(p.datatype)
        datatypes.set(iri, listed)
      }
      for (const [property, types] of datatypes) {
        drawn.push([
          { predicate: sh('path'), object: namedNode(property) },
          ...oneOf('datatype', types),
          message(`${localOf(target)} ${localOf(property)}: every value must be ${either(types.map(shortName))}.`),
        ])
      }
      for (const axiom of node.data.axioms ?? []) {
        const parts = axiomShape(target, axiom)
        if (parts) (axiom.kind === 'disjointWith' ? excluded : drawn).push(parts)
      }
    }
    if (constraints.length === 0 && drawn.length === 0 && excluded.length === 0) continue

    // Named after the class's local name; a number keeps two classes with the same local name apart.
    const local = target.replace(/^.*[#/]/, '') || 'Unnamed'
    let name = `${local}Shape`
    for (let i = 2; names.has(name); i++) name = `${local}Shape${i}`
    names.add(name)
    const shape = namedNode(`${shapes}#${name}`)

    writer.addQuad(shape, type, sh('NodeShape'))
    writer.addQuad(shape, sh('targetClass'), namedNode(target))
    if (node.data.constraintsClosed && constraints.length > 0) {
      writer.addQuad(shape, sh('closed'), literal('true', namedNode(XSD + 'boolean')))
      writer.addQuad(shape, sh('ignoredProperties'), writer.list([type]) as unknown as Quad_Object)
    }
    for (const parts of drawn) writer.addQuad(shape, sh('property'), blank(parts))
    for (const parts of excluded) writer.addQuad(shape, sh('not'), blank([{ predicate: sh('property'), object: blank(parts) }]))
    for (const c of constraints) {
      const path = pathIri(c.path)
      const valueClass = c.path.type === 'object' && c.class !== undefined ? classIri.get(c.class) : undefined
      if (!path || (c.path.type === 'object' && c.class !== undefined && !valueClass)) continue
      const parts: { predicate: NamedNode; object: Quad_Object }[] = [{ predicate: sh('path'), object: namedNode(path) }]
      if (c.minCount !== undefined) parts.push({ predicate: sh('minCount'), object: count(c.minCount) })
      if (c.maxCount !== undefined) parts.push({ predicate: sh('maxCount'), object: count(c.maxCount) })
      if (valueClass) parts.push({ predicate: sh('class'), object: namedNode(valueClass) })
      if (c.path.type === 'data' && c.datatype) parts.push({ predicate: sh('datatype'), object: namedNode(c.datatype) })
      if (c.path.type === 'data') {
        if (c.pattern?.trim()) parts.push({ predicate: sh('pattern'), object: literal(c.pattern.trim()) })
        const allowed = (c.allowed ?? []).filter((a) => a.trim())
        if (allowed.length > 0) {
          // @types/n3 types list() as an array; at runtime it is one serialized `( … )` term.
          const list = writer.list(allowed.map((a) => constraintValue(a, c.datatype))) as unknown as Quad_Object
          parts.push({ predicate: sh('in'), object: list })
        }
        if (c.minValue?.trim()) parts.push({ predicate: sh('minInclusive'), object: constraintValue(c.minValue, c.datatype) })
        if (c.maxValue?.trim()) parts.push({ predicate: sh('maxInclusive'), object: constraintValue(c.maxValue, c.datatype) })
        if (c.minLength !== undefined) parts.push({ predicate: sh('minLength'), object: count(c.minLength) })
        if (c.maxLength !== undefined) parts.push({ predicate: sh('maxLength'), object: count(c.maxLength) })
      }
      if (c.message?.trim()) parts.push({ predicate: sh('message'), object: literal(c.message.trim()) })
      writer.addQuad(shape, sh('property'), writer.blank(parts) as unknown as Quad_Object)
    }
  }

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
