import { DataFactory, Writer, type Quad, type Quad_Object } from 'n3'
import { localName, propertyLocalName, type Characteristic, type ClassExpression, type EntityData, type Ontology } from './model'
import { namespacePrefixes } from './namespaces'
import { LAYOUT_PROPERTY, type SavedLayout } from './savedLayout'
import { isSkosEdge, skosQuads } from './skos'
import { BUILT_IN_ANNOTATION_PROPERTIES, expandIri, IRI_VALUED, isAbsoluteIri, OWL, PREFIXES, RDF, RDFS } from './vocab'

const { literal, namedNode, quad } = DataFactory

/** The IRI of a class or property: its own `iri` when set, else `localName` after its namespace (the ontology IRI by default). */
export function entityIri(base: string, data: EntityData, local: string): string {
  const namespace = data.namespace?.trim() || base
  return data.iri?.trim() ? expandIri(data.iri, namespace) : namespace + local
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

/** What the ontology header says about the export: owl:versionInfo (a timestamp) and an rdfs:comment naming the sketch. */
export type OntologyHeader = { versionInfo?: string; comment?: string }

/**
 * Serializes the canvas model as an OWL 2 ontology in Turtle: an inference-safe TBox of named classes, rdfs:subClassOf
 * between them, property declarations, labels, annotations and the axioms drawn between named classes.
 * Arrows, data property datatypes and restriction axioms say what instance data should look like; under OWL's
 * open world they would add types to the data instead of checking it, so they go to the SHACL shapes (shacl.ts),
 * and this file has no owl:Restriction, rdfs:domain, rdfs:range or owl:unionOf.
 * With `layout`, the pages and positions go along as one annotation on the ontology (see savedLayout.ts),
 * so importing the file draws it the same way. Throws when the ontology IRI is not an absolute IRI.
 */
export function toTurtle(ontology: Ontology, layout?: SavedLayout, header: OntologyHeader = {}): Promise<string> {
  const base = ontology.iri
  if (!isAbsoluteIri(base)) throw new Error('the ontology needs a base IRI, such as https://w3id.org/my-ontology#')
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
  const prefixes: Record<string, string> = { '': base, ...namespacePrefixes(ontology.namespaces, base), owl: OWL, rdf: RDF, rdfs: RDFS }
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if ([...usedAnnotationProperties].some((p) => p.startsWith(ns))) prefixes[prefix] = ns
  }
  const writer = new Writer({ prefixes })
  const type = namedNode(RDF + 'type')
  const label = namedNode(RDFS + 'label')

  const annotate = (subject: string, data: EntityData) => quads.push(...annotationQuads(subject, data))

  quads.push(quad(namedNode(ontologyIri), type, namedNode(OWL + 'Ontology')))
  if (header.versionInfo) quads.push(quad(namedNode(ontologyIri), namedNode(OWL + 'versionInfo'), literal(header.versionInfo)))
  if (header.comment) quads.push(quad(namedNode(ontologyIri), namedNode(RDFS + 'comment'), literal(header.comment)))
  if (layout) {
    usedAnnotationProperties.add(LAYOUT_PROPERTY)
    quads.push(quad(namedNode(ontologyIri), namedNode(LAYOUT_PROPERTY), literal(JSON.stringify(layout))))
  }

  const classIri = new Map<string, string>()
  const annotationProperties = new Set<string>()
  // Per object property IRI: its labels and the edges drawn with it.
  const properties = new Map<string, { labels: Set<string>; edges: string[] }>()
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

  // A named class; undefined for a restriction (exported as a shape, see shacl.ts) or a deleted class.
  const expression = (e: ClassExpression): Quad_Object | undefined => (e.type === 'class' && classIri.has(e.ref) ? namedNode(classIri.get(e.ref)!) : undefined)

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
        property = { labels: new Set(), edges: [] }
        properties.set(iri, property)
        quads.push(quad(namedNode(iri), type, namedNode(OWL + 'ObjectProperty')))
      }
      // Declared and labelled once, however many arrows carry the property.
      if (!property.labels.has(edge.data.label)) {
        property.labels.add(edge.data.label)
        quads.push(quad(namedNode(iri), label, literal(edge.data.label)))
      }
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

  // Data properties listed on classes; classes sharing a name share the property. Which classes list it and its datatype are shapes.
  const dataProperties = new Map<string, { label: string; functional: boolean }>()
  for (const node of ontology.nodes) {
    for (const p of node.data.dataProperties ?? []) {
      if (!p.name.trim()) continue
      const iri = base + propertyLocalName(p.name)
      const entry = dataProperties.get(iri) ?? { label: p.name.trim(), functional: false }
      entry.functional ||= !!p.functional
      dataProperties.set(iri, entry)
    }
  }

  // OWL 2 DL wants every annotation property that isn't built in declared, e.g. skos:definition.
  const declarations = [...usedAnnotationProperties]
    .filter((p) => !BUILT_IN_ANNOTATION_PROPERTIES.has(p))
    .map((p) => quad(namedNode(p), type, namedNode(OWL + 'AnnotationProperty')))

  writer.addQuads([quads[0], ...declarations, ...quads.slice(1), ...skos.quads])

  for (const [iri, { label: name, functional }] of dataProperties) {
    writer.addQuad(namedNode(iri), type, namedNode(OWL + 'DatatypeProperty'))
    if (functional) writer.addQuad(namedNode(iri), type, namedNode(OWL + 'FunctionalProperty'))
    writer.addQuad(namedNode(iri), label, literal(name))
  }

  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)))
  })
}
