export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
export const OWL = 'http://www.w3.org/2002/07/owl#'
export const SKOS = 'http://www.w3.org/2004/02/skos/core#'
export const DCTERMS = 'http://purl.org/dc/terms/'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'

/** Datatypes offered for data properties, most used first. */
export const DATATYPES = [
  XSD + 'string',
  XSD + 'boolean',
  XSD + 'integer',
  XSD + 'decimal',
  XSD + 'double',
  XSD + 'date',
  XSD + 'dateTime',
  XSD + 'anyURI',
  XSD + 'nonNegativeInteger',
  RDF + 'langString',
  RDFS + 'Literal',
]

/** Prefixes the editor knows, for showing and typing compact IRIs. */
export const PREFIXES: Record<string, string> = { rdf: RDF, rdfs: RDFS, owl: OWL, xsd: XSD, skos: SKOS, dcterms: DCTERMS }

export const SKOS_DEFINITION = SKOS + 'definition'
export const RDFS_COMMENT = RDFS + 'comment'

/** Annotation properties offered in the inspector's picker, most used first. */
export const ANNOTATION_PROPERTIES = [
  SKOS_DEFINITION,
  RDFS_COMMENT,
  SKOS + 'prefLabel',
  SKOS + 'altLabel',
  SKOS + 'example',
  SKOS + 'note',
  SKOS + 'editorialNote',
  RDFS + 'seeAlso',
  RDFS + 'isDefinedBy',
  DCTERMS + 'source',
  DCTERMS + 'creator',
  OWL + 'versionInfo',
]

/** OWL 2's built-in annotation properties; every other one must be declared owl:AnnotationProperty. */
export const BUILT_IN_ANNOTATION_PROPERTIES = new Set([
  RDFS + 'label',
  RDFS_COMMENT,
  RDFS + 'seeAlso',
  RDFS + 'isDefinedBy',
  OWL + 'deprecated',
  OWL + 'versionInfo',
  OWL + 'priorVersion',
  OWL + 'backwardCompatibleWith',
  OWL + 'incompatibleWith',
])

/** Annotation properties whose values point at a resource; an absolute IRI value is written as an IRI, not text. */
export const IRI_VALUED = new Set([RDFS + 'seeAlso', RDFS + 'isDefinedBy'])

const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/

export function isAbsoluteIri(text: string): boolean {
  return ABSOLUTE_IRI.test(text)
}

/** Shows an IRI as prefix:local when a known prefix matches. */
export function compactIri(iri: string): string {
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if (iri.startsWith(ns) && iri.length > ns.length) return `${prefix}:${iri.slice(ns.length)}`
  }
  return iri
}

/**
 * Reads what a person typed as an IRI: prefix:local for a known prefix, a full IRI,
 * or a bare name taken as a local name after `base` (the ontology IRI).
 */
export function expandIri(text: string, base: string): string {
  const t = text.trim()
  const colon = t.indexOf(':')
  if (colon > 0 && PREFIXES[t.slice(0, colon)] !== undefined) return PREFIXES[t.slice(0, colon)] + t.slice(colon + 1)
  if (isAbsoluteIri(t)) return t
  return base + t
}

/** The readable end of an IRI: Topping for http://example.org/pizza#Topping, xsd:string for XSD's. */
export function shortName(iri: string): string {
  const compact = compactIri(iri)
  return compact !== iri ? compact : iri.replace(/^.*[#/]/, '') || iri
}
