import type { Edge, Node } from '@xyflow/react'
import type { Point } from './sketch/curve'
import type { SketchStyle } from './sketch/style'

/**
 * An annotation assertion on a class or property, e.g. skos:definition "…"@en.
 * `property` is a full IRI; `lang` is an optional language tag for literal values.
 */
export type Annotation = { property: string; value: string; lang?: string }

/**
 * What a class or property carries besides its label.
 * `namespace`, when set, is the base IRI the entity lives in instead of the ontology IRI, e.g. a reference data library.
 * `iri`, when set, replaces the IRI derived from the label: a full IRI, or a local name after the namespace.
 * `labelLang` is the language tag of the label (rdfs:label, or skos:prefLabel on a concept or scheme).
 */
export type EntityData = { iri?: string; namespace?: string; labelLang?: string; annotations?: Annotation[] }

/** A namespace classes and properties can live in besides the ontology's own, written as `@prefix prefix: <iri>`. */
export type Namespace = { prefix: string; iri: string }

/** OWL restriction keywords, in Manchester syntax. Cardinalities take `n`; `filler` is optional for them. */
export type Quantifier = 'some' | 'only' | 'min' | 'max' | 'exactly'

/**
 * A class expression: a named class (a node id) or a restriction on an object property.
 * `property` is the id of an edge drawing that property; edges with the same label are one property.
 */
export type ClassExpression =
  | { type: 'class'; ref: string }
  | { type: 'restriction'; quantifier: Quantifier; property: string; n?: number; filler?: string }

export type AxiomKind = 'subClassOf' | 'equivalentClass' | 'disjointWith'

/** A class axiom with this class on the left, e.g. Pizza subClassOf hasTopping some Topping. */
export type ClassAxiom = { kind: AxiomKind; expression: ClassExpression }

/**
 * An owl:DatatypeProperty listed on a class, like a property key on a Neo4j node.
 * The class is its domain; `datatype` is a full IRI such as xsd:string. Classes listing the same name share one property.
 * Its IRI is derived from `name` unless `iri` says otherwise, as for classes (see EntityData).
 */
export type DataProperty = EntityData & { name: string; datatype: string; functional?: boolean }

/**
 * An object or data property the canvas does not draw, kept from an imported ontology so the export writes it back,
 * e.g. one whose range is skos:Concept or a class from another ontology, or one without a domain.
 * `iri` is a full IRI; `domains` and `ranges` are full IRIs of classes or datatypes, several being alternatives
 * (an owl:unionOf); `subPropertyOf` and `inverseOf` are full IRIs of other properties. All export as they came in.
 */
export type KeptProperty = Omit<EntityData, 'iri' | 'namespace'> & {
  kind: 'object' | 'data'
  iri: string
  label: string
  domains?: string[]
  ranges?: string[]
  characteristics?: Characteristic[]
  subPropertyOf?: string[]
  inverseOf?: string[]
}

/** A property value on a concept or scheme, e.g. :freq-3 :ordinal 2; `property` and an IRI `value` are full IRIs. */
export type PropertyValue = { property: string; value: string; kind: 'iri' | 'literal'; datatype?: string; lang?: string }

/**
 * A SHACL property shape on a class: a rule the class's instance data must follow for one property.
 * Unlike an axiom it is not used for inference; a validator reports data that breaks it.
 * `path` is an object property (the id of an edge drawing it) or a data property (its name, as listed on classes).
 * `class` (a node id) applies to object properties; `datatype` (a full IRI) and the value rules below to data properties.
 * `allowed`, `minValue` and `maxValue` are typed text, read as literals of `datatype`.
 */
export type PropertyConstraint = {
  path: { type: 'object'; property: string } | { type: 'data'; name: string }
  minCount?: number
  maxCount?: number
  class?: string
  datatype?: string
  message?: string
  /** A regular expression every value must match (sh:pattern). */
  pattern?: string
  /** The only values allowed (sh:in); blank entries are ignored. */
  allowed?: string[]
  /** Lowest and highest allowed value, both included (sh:minInclusive, sh:maxInclusive). */
  minValue?: string
  maxValue?: string
  /** Shortest and longest allowed text, in characters (sh:minLength, sh:maxLength). */
  minLength?: number
  maxLength?: number
}

/**
 * What a node stands for besides an OWL class: a SKOS concept or concept scheme, both exported as individuals (see skos.ts).
 * A node without a kind is a class.
 */
export type NodeKind = 'concept' | 'scheme'

/** SKOS mapping properties, linking a concept to a concept in another scheme or vocabulary. */
export type MappingKind = 'exactMatch' | 'closeMatch' | 'broadMatch' | 'narrowMatch' | 'relatedMatch'

/** A mapping to a concept outside this ontology; `iri` is a full IRI or prefix:local. */
export type Mapping = { kind: MappingKind; iri: string }

/**
 * A named OWL class drawn as a box on the canvas, or with `kind` a SKOS concept or scheme. `style` is visual only.
 * `axioms` adds to the subClassOf edges drawn on the canvas; `constraints` export as a SHACL node shape, see shacl.ts,
 * which `constraintsClosed` closes: instances may then use only the constrained properties (and rdf:type).
 * `inScheme` lists scheme node ids a concept belongs to besides those its hierarchy reaches, see skos.ts.
 * `mappings` link a concept to outside concepts; `values` are other property values on a concept or scheme.
 */
export type ClassData = EntityData & {
  label: string
  kind?: NodeKind
  inScheme?: string[]
  mappings?: Mapping[]
  values?: PropertyValue[]
  axioms?: ClassAxiom[]
  dataProperties?: DataProperty[]
  constraints?: PropertyConstraint[]
  /** Shapes for this class imported from a shapes file that rows can't hold, as Turtle; exported unchanged. */
  extraShapes?: string
  constraintsClosed?: boolean
  style?: SketchStyle
}
export type ClassNode = Node<ClassData, 'owlClass'>

/**
 * Edge kinds the canvas understands.
 * - subClassOf: source rdfs:subClassOf target
 * - objectProperty: an owl:ObjectProperty with domain = source, range = target
 * - annotationProperty: an owl:AnnotationProperty asserted between the two classes (source property target)
 * - broader, narrower, related: the SKOS relation between two concepts (source skos:broader target)
 * - topConceptOf: a concept (source) is a top concept of a scheme (target)
 */
export type EdgeKind = 'subClassOf' | 'objectProperty' | 'annotationProperty' | SkosEdgeKind
export type SkosEdgeKind = 'broader' | 'narrower' | 'related' | 'topConceptOf'

/** OWL object property characteristics; each exports as rdf:type owl:<Name>Property. */
export type Characteristic = 'functional' | 'inverseFunctional' | 'transitive' | 'symmetric' | 'asymmetric' | 'reflexive' | 'irreflexive'

/**
 * `iri` and `annotations` describe the property and are ignored on subClassOf edges.
 * `characteristics`, `inverseOf` and `subPropertyOf` apply to object properties; the last two hold the id of an edge
 * drawing the other property. Edges with the same label are one property, and the inspector keeps these in step on all of them.
 * `style` and `bend` (offset of the curve's midpoint, see sketch/curve.ts) are visual only.
 */
export type RelationData = EntityData & {
  kind: EdgeKind
  label: string
  characteristics?: Characteristic[]
  inverseOf?: string
  subPropertyOf?: string
  style?: SketchStyle
  bend?: Point
}
export type RelationEdge = Edge<RelationData, 'relation'>

export type Ontology = {
  iri: string
  /** Other namespaces of the project, see EntityData.namespace. */
  namespaces?: Namespace[]
  nodes: ClassNode[]
  edges: RelationEdge[]
  /** Properties from an import the canvas does not draw. */
  kept?: KeptProperty[]
}

/** Turns a free-text label into a local name usable after the ontology IRI. */
export function localName(label: string): string {
  const words = label.trim().split(/[^A-Za-z0-9_]+/).filter(Boolean)
  if (words.length === 0) return 'Unnamed'
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
}

export function propertyLocalName(label: string): string {
  const name = localName(label)
  return name[0].toLowerCase() + name.slice(1)
}

/**
 * The ontology IRI after importing `fileName`: a placeholder under http://example.org/ (like the sample's)
 * is replaced by one named after the file, so imported classes don't end up in the pizza namespace.
 * An IRI the user set themselves is kept.
 */
export function importedOntologyIri(current: string, fileName: string): string {
  if (!current.startsWith('http://example.org/')) return current
  const slug = fileName
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-')
  return `http://example.org/${slug || 'ontology'}#`
}

export const sampleOntology: Ontology = {
  iri: 'http://example.org/pizza#',
  nodes: [
    { id: 'pizza', type: 'owlClass', position: { x: 80, y: 60 }, data: { label: 'Pizza' } },
    { id: 'topping', type: 'owlClass', position: { x: 460, y: 60 }, data: { label: 'Topping' } },
    { id: 'margherita', type: 'owlClass', position: { x: 80, y: 260 }, data: { label: 'Margherita' } },
    { id: 'tomato', type: 'owlClass', position: { x: 460, y: 260 }, data: { label: 'Tomato Topping' } },
  ],
  edges: [
    { id: 'e1', type: 'relation', source: 'margherita', target: 'pizza', data: { kind: 'subClassOf', label: '' } },
    { id: 'e2', type: 'relation', source: 'tomato', target: 'topping', data: { kind: 'subClassOf', label: '' } },
    { id: 'e3', type: 'relation', source: 'pizza', target: 'topping', data: { kind: 'objectProperty', label: 'has topping' } },
  ],
}
