import { DataFactory, type Quad } from 'n3'
import { localName, type ClassData, type ClassNode, type EdgeKind, type EntityData, type MappingKind, type NodeKind, type Ontology, type PropertyValue, type RelationEdge, type SkosEdgeKind } from './model'
import type { SketchStyle } from './sketch/style'
import { expandIri, OWL, RDF, SKOS } from './vocab'

/**
 * SKOS concept schemes on the canvas. Concepts and schemes are nodes with a `kind`; the SKOS relations
 * between them are edges. They export as individuals into the same file as the OWL classes, so the
 * ontology stays OWL 2 DL: skos:Concept and skos:ConceptScheme are declared classes, and the SKOS
 * relations declared object properties.
 */

const { literal, namedNode, quad } = DataFactory

export const SKOS_EDGE_KINDS: SkosEdgeKind[] = ['broader', 'narrower', 'related', 'topConceptOf']

export const MAPPING_KINDS: MappingKind[] = ['exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch']

export function isSkosEdge(kind: EdgeKind | undefined): kind is SkosEdgeKind {
  return !!kind && (SKOS_EDGE_KINDS as string[]).includes(kind)
}

/** What the canvas calls each kind of node, for buttons, prompts and the inspector. */
export const NODE_KIND_NAMES: Record<NodeKind | 'class', string> = { class: 'Class', concept: 'Concept', scheme: 'Concept scheme', individual: 'Individual' }

/** How new concepts and schemes look, so they stand apart from classes whatever shape classes use. */
export const NODE_KIND_STYLES: Record<NodeKind, SketchStyle> = {
  concept: { fill: '#b2f2bb', stroke: '#2f9e44' },
  scheme: { fill: '#ffec99', stroke: '#f08c00', strokeStyle: 'dashed' },
  individual: { fill: '#fcc2d7', stroke: '#c2255c' },
}

/** The edge a new connection makes: SKOS relations between concepts and schemes, an individual's class, subClassOf otherwise. */
export function defaultEdge(source: ClassData | undefined, target: ClassData | undefined): { kind: EdgeKind; label: string } {
  if (source?.kind === 'individual' && !target?.kind) return { kind: 'instanceOf', label: 'type' }
  if (source?.kind === 'concept' && target?.kind === 'concept') return { kind: 'broader', label: 'broader' }
  if (source?.kind === 'concept' && target?.kind === 'scheme') return { kind: 'topConceptOf', label: 'topConceptOf' }
  return { kind: 'subClassOf', label: '' }
}

/**
 * The schemes each concept is in, as scheme node ids: those it lists in `inScheme`, plus every scheme
 * that one of its hierarchy's top concepts belongs to (a hierarchy being concepts joined by broader or
 * narrower edges, in either direction). When there is exactly one scheme, concepts in no scheme go into it.
 */
export function conceptSchemes(nodes: ClassNode[], edges: RelationEdge[]): Map<string, Set<string>> {
  const concepts = nodes.filter((n) => n.data.kind === 'concept')
  const schemeIds = new Set(nodes.filter((n) => n.data.kind === 'scheme').map((n) => n.id))
  const conceptIds = new Set(concepts.map((n) => n.id))
  const result = new Map(concepts.map((n) => [n.id, new Set((n.data.inScheme ?? []).filter((s) => schemeIds.has(s)))]))

  const neighbours = new Map(concepts.map((n) => [n.id, [] as string[]]))
  const tops = new Map<string, Set<string>>()
  for (const e of edges) {
    if ((e.data?.kind === 'broader' || e.data?.kind === 'narrower') && conceptIds.has(e.source) && conceptIds.has(e.target)) {
      neighbours.get(e.source)!.push(e.target)
      neighbours.get(e.target)!.push(e.source)
    } else if (e.data?.kind === 'topConceptOf' && conceptIds.has(e.source) && schemeIds.has(e.target)) {
      if (!tops.has(e.source)) tops.set(e.source, new Set())
      tops.get(e.source)!.add(e.target)
    }
  }

  // Spread each top concept's schemes over its whole hierarchy.
  for (const [top, schemes] of tops) {
    const seen = new Set([top])
    const queue = [top]
    while (queue.length > 0) {
      const id = queue.pop()!
      for (const s of schemes) result.get(id)!.add(s)
      for (const next of neighbours.get(id)!) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
  }

  if (schemeIds.size === 1) {
    const [only] = schemeIds
    for (const schemes of result.values()) if (schemes.size === 0) schemes.add(only)
  }
  return result
}

/** A property value as an RDF term: an IRI, or a literal with its language or datatype. */
export function valueTerm(v: PropertyValue) {
  return v.kind === 'iri' ? namedNode(v.value) : literal(v.value, v.lang?.trim() || (v.datatype ? namedNode(v.datatype) : undefined))
}

const PREDICATE: Record<SkosEdgeKind, string> = {
  broader: SKOS + 'broader',
  narrower: SKOS + 'narrower',
  related: SKOS + 'related',
  topConceptOf: SKOS + 'topConceptOf',
}

/**
 * The SKOS triples for the ontology's concepts and schemes. `iriOf` gives a node's IRI and
 * `annotate` its annotation triples, both as the OWL export makes them for classes.
 * Returns the triples, the annotation properties they use, which the OWL export declares, and the SKOS relation
 * properties they use, so kept statements about those (their declarations) are written back.
 */
export function skosQuads(
  ontology: Ontology,
  iriOf: (data: EntityData, local: string) => string,
  annotate: (subject: string, data: EntityData) => Quad[],
): { quads: Quad[]; annotationProperties: string[]; properties: string[] } {
  const members = ontology.nodes.filter((n) => n.data.kind === 'concept' || n.data.kind === 'scheme')
  if (members.length === 0) return { quads: [], annotationProperties: [], properties: [] }

  const type = namedNode(RDF + 'type')
  const iri = new Map(members.map((n) => [n.id, iriOf(n.data, localName(n.data.label))]))
  const node = (id: string) => namedNode(iri.get(id)!)
  const declarations: Quad[] = []
  const usedProperties = new Set<string>()
  // Relations by subject node id, written after that node's own triples so Turtle groups them.
  const relations = new Map<string, Quad[]>()
  const relate = (s: string, p: string, o: string) => {
    usedProperties.add(p)
    if (!relations.has(s)) relations.set(s, [])
    relations.get(s)!.push(quad(node(s), namedNode(p), node(o)))
  }

  for (const [concept, schemes] of conceptSchemes(ontology.nodes, ontology.edges)) {
    for (const scheme of schemes) relate(concept, SKOS + 'inScheme', scheme)
  }

  // Mappings point outside the canvas, at an IRI typed in the inspector.
  for (const n of members) {
    for (const m of n.data.kind === 'concept' ? (n.data.mappings ?? []) : []) {
      if (!m.iri.trim()) continue
      usedProperties.add(SKOS + m.kind)
      if (!relations.has(n.id)) relations.set(n.id, [])
      relations.get(n.id)!.push(quad(node(n.id), namedNode(SKOS + m.kind), namedNode(expandIri(m.iri, ontology.iri))))
    }
  }

  // Other property values, e.g. :freq-3 :ordinal 2; the properties are declared where they are defined, not here.
  for (const n of members) {
    for (const v of n.data.values ?? []) {
      if (!v.property.trim() || !v.value.trim()) continue
      if (!relations.has(n.id)) relations.set(n.id, [])
      relations.get(n.id)!.push(quad(node(n.id), namedNode(v.property), valueTerm(v)))
    }
  }

  for (const e of ontology.edges) {
    const kind = e.data?.kind
    if (!isSkosEdge(kind) || !iri.has(e.source) || !iri.has(e.target)) continue
    const fromConcept = ontology.nodes.find((n) => n.id === e.source)?.data.kind === 'concept'
    const toKind = ontology.nodes.find((n) => n.id === e.target)?.data.kind
    if (!fromConcept || (kind === 'topConceptOf') !== (toKind === 'scheme')) continue
    relate(e.source, PREDICATE[kind], e.target)
    if (kind === 'topConceptOf') relate(e.target, SKOS + 'hasTopConcept', e.source)
  }

  // A concept imported without a label gets none until it is given one, see EntityData.unlabelled.
  const unlabelled = (n: ClassNode) => n.data.unlabelled && n.data.label === iri.get(n.id)!.replace(/^.*[#/]/, '')
  const body = members.flatMap((n) => [
    quad(node(n.id), type, namedNode(OWL + 'NamedIndividual')),
    quad(node(n.id), type, namedNode(SKOS + (n.data.kind === 'concept' ? 'Concept' : 'ConceptScheme'))),
    ...(unlabelled(n) ? [] : [quad(node(n.id), namedNode(SKOS + 'prefLabel'), literal(n.data.label, n.data.labelLang?.trim() || undefined))]),
    ...annotate(iri.get(n.id)!, n.data),
    ...(relations.get(n.id) ?? []),
  ])

  // Declared once, also when a box on the canvas stands for skos:Concept (see ClassData.outside).
  const drawn = new Set(ontology.nodes.filter((n) => !n.data.kind).map((n) => iriOf(n.data, localName(n.data.label))))
  if (!drawn.has(SKOS + 'Concept')) declarations.push(quad(namedNode(SKOS + 'Concept'), type, namedNode(OWL + 'Class')))
  if (members.some((n) => n.data.kind === 'scheme') && !drawn.has(SKOS + 'ConceptScheme')) declarations.push(quad(namedNode(SKOS + 'ConceptScheme'), type, namedNode(OWL + 'Class')))
  // A property an import already declared (skos:broader as an annotation property, say) keeps that declaration, which the
  // export writes back with the kept statements; only an undeclared one is declared an object property here.
  const declared = (p: string) =>
    (ontology.keptStatements ?? []).some((s) =>
      [OWL + 'AnnotationProperty', OWL + 'ObjectProperty'].some((t) => s.ntriples.includes(`<${p}> <${RDF}type> <${t}> .`)),
    )
  for (const p of usedProperties) if (!declared(p)) declarations.push(quad(namedNode(p), type, namedNode(OWL + 'ObjectProperty')))

  return { quads: [...declarations, ...body], annotationProperties: [SKOS + 'prefLabel'], properties: [...usedProperties] }
}
