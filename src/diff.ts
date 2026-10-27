import type { Quad, Store, Term } from 'n3'
import { LAYOUT_PROPERTIES, edgeKey, parseLayout, type SavedLayout } from './savedLayout'
import { parseTurtle } from './turtle'
import { OWL, RDF, RDFS, SKOS, shortName } from './vocab'

/**
 * What changed between two versions of an ontology, read from their Turtle: an earlier file and the canvas's export.
 * Each named class, property or concept is added, removed or changed (its own statements differ); arrows between
 * classes are added or removed. The layout annotation is left out: moving a box is not a change to the ontology.
 */

export type Status = 'added' | 'removed' | 'changed'

/** One statement about an entity, as a reader would say it, e.g. "subClassOf Animal" or "label "Dog"@en". */
export type StatementChange = { sign: '+' | '-'; text: string }

export type EntityDiff = { iri: string; label: string; kind: 'class' | 'property' | 'other'; status: Status; changes: StatementChange[] }

/** An arrow between two classes, by edgeKey (see savedLayout.ts). */
export type ArrowDiff = { key: string; source: string; kind: string; label: string; target: string; status: 'added' | 'removed' }

export type OntologyDiff = {
  entities: EntityDiff[]
  arrows: ArrowDiff[]
  /** The earlier file's layout, when it was exported by Ontology Sketcher: where removed classes used to be drawn. */
  oldLayout?: SavedLayout
  /** The later file's layout, likewise: where added classes are drawn. */
  newLayout?: SavedLayout
}

type Version = { store: Store; layout?: SavedLayout }

function read(text: string, base: string): Version {
  const { store } = parseTurtle(text, base)
  let layout: SavedLayout | undefined
  for (const q of store.getQuads(null, null, null, null)) {
    if (LAYOUT_PROPERTIES.has(q.predicate.value)) {
      layout ??= parseLayout(q.object.value)
      store.removeQuad(q)
    }
  }
  // The layout property's own label and comment come and go with it.
  for (const p of LAYOUT_PROPERTIES) store.removeQuads(store.getQuads(p, null, null, null))
  return { store, layout }
}

/** A blank node's description as one string, nested and sorted, so equal descriptions compare equal across files. */
function canonical(store: Store, term: Term, depth = 0): string {
  if (term.termType === 'NamedNode') return `<${term.value}>`
  if (term.termType === 'Literal') return JSON.stringify([term.value, term.language || term.datatype.value])
  if (depth > 20) return '[…]'
  const parts = store.getQuads(term, null, null, null).map((q) => `${q.predicate.value} ${canonical(store, q.object, depth + 1)}`)
  return `[${parts.sort().join('; ')}]`
}

function labelOf(store: Store, iri: string): string | undefined {
  return (store.getObjects(iri, RDFS + 'label', null)[0] ?? store.getObjects(iri, SKOS + 'prefLabel', null)[0])?.value
}

function listItems(store: Store, head: Term): Term[] {
  const items: Term[] = []
  for (let node: Term | undefined = head; node && node.value !== RDF + 'nil' && items.length < 1000; node = store.getObjects(node, RDF + 'rest', null)[0]) {
    const first = store.getObjects(node, RDF + 'first', null)[0]
    if (first) items.push(first)
  }
  return items
}

const QUANTIFIERS: [string, string][] = [
  [OWL + 'someValuesFrom', 'some'],
  [OWL + 'allValuesFrom', 'only'],
  [OWL + 'hasValue', 'value'],
  [OWL + 'minQualifiedCardinality', 'min'],
  [OWL + 'maxQualifiedCardinality', 'max'],
  [OWL + 'qualifiedCardinality', 'exactly'],
  [OWL + 'minCardinality', 'min'],
  [OWL + 'maxCardinality', 'max'],
  [OWL + 'cardinality', 'exactly'],
]

/** A term in words: a name, a quoted literal, or a class expression in Manchester style. */
function words(store: Store, term: Term, depth = 0): string {
  if (term.termType === 'NamedNode') return labelOf(store, term.value) ?? shortName(term.value)
  if (term.termType === 'Literal') return `"${term.value}"${term.language ? '@' + term.language : ''}`
  if (depth > 5) return '…'
  const one = (p: string) => store.getObjects(term, p, null)[0]
  const property = one(OWL + 'onProperty')
  if (property) {
    for (const [p, word] of QUANTIFIERS) {
      const value = one(p)
      if (!value) continue
      const filler = one(OWL + 'onClass') ?? one(OWL + 'onDataRange')
      const amount = value.termType === 'Literal' && word !== 'value' ? value.value : words(store, value, depth + 1)
      return [words(store, property, depth + 1), word, amount, filler && words(store, filler, depth + 1)].filter(Boolean).join(' ')
    }
  }
  for (const [p, joiner] of [[OWL + 'unionOf', ' or '], [OWL + 'intersectionOf', ' and '], [OWL + 'oneOf', ', ']] as const) {
    const list = one(p)
    if (list) return `(${listItems(store, list).map((t) => words(store, t, depth + 1)).join(joiner)})`
  }
  const complement = one(OWL + 'complementOf')
  if (complement) return `not ${words(store, complement, depth + 1)}`
  return '[…]'
}

/** The statements about each named subject, by a canonical key, with their text. */
function statements(store: Store): Map<string, Map<string, string>> {
  const bySubject = new Map<string, Map<string, string>>()
  for (const q of store.getQuads(null, null, null, null) as Quad[]) {
    if (q.subject.termType !== 'NamedNode') continue
    const key = `${q.predicate.value} ${canonical(store, q.object)}`
    const text = q.predicate.value === RDF + 'type' ? `a ${words(store, q.object)}` : `${shortName(q.predicate.value).replace(/^\w+:/, '')} ${words(store, q.object)}`
    let own = bySubject.get(q.subject.value)
    if (!own) bySubject.set(q.subject.value, (own = new Map()))
    own.set(key, text)
  }
  return bySubject
}

function kindOf(store: Store, iri: string): EntityDiff['kind'] {
  const types = store.getObjects(iri, RDF + 'type', null).map((t) => t.value)
  if (types.includes(OWL + 'Class') || types.includes(RDFS + 'Class')) return 'class'
  if ([OWL + 'ObjectProperty', OWL + 'DatatypeProperty', OWL + 'AnnotationProperty', RDF + 'Property'].some((t) => types.includes(t))) return 'property'
  return 'other'
}

/**
 * Arrows between classes. From the layouts when both files carry one, as the canvas drew them; otherwise from the
 * triples: subClassOf between named classes, and each object property from every domain class to every range class.
 */
function arrows(version: Version, useLayout: boolean): Map<string, Omit<ArrowDiff, 'status' | 'key'>> {
  const found = new Map<string, Omit<ArrowDiff, 'status' | 'key'>>()
  const add = (source: string, kind: string, label: string, target: string) => found.set(edgeKey(source, kind, label, target), { source, kind, label, target })
  if (useLayout) {
    for (const page of version.layout!.pages) for (const e of page.edges) add(e.source, e.kind, e.label, e.target)
    return found
  }
  const { store } = version
  const classes = (t: Term) => (t.termType === 'NamedNode' ? [t.value] : listItems(store, store.getObjects(t, OWL + 'unionOf', null)[0] ?? t).filter((x) => x.termType === 'NamedNode').map((x) => x.value))
  for (const q of store.getQuads(null, RDFS + 'subClassOf', null, null)) {
    if (q.subject.termType === 'NamedNode' && q.object.termType === 'NamedNode') add(q.subject.value, 'subClassOf', '', q.object.value)
  }
  for (const p of store.getSubjects(RDF + 'type', OWL + 'ObjectProperty', null)) {
    const label = labelOf(store, p.value) ?? shortName(p.value)
    for (const d of store.getObjects(p, RDFS + 'domain', null).flatMap(classes))
      for (const r of store.getObjects(p, RDFS + 'range', null).flatMap(classes)) add(d, 'objectProperty', label, r)
  }
  return found
}

/** The differences from `before` to `after`, both Turtle; entities sorted added, changed, removed, then by label. */
export function diffOntologies(before: string, after: string, base: string): OntologyDiff {
  const old = read(before, base)
  const now = read(after, base)
  const oldStatements = statements(old.store)
  const newStatements = statements(now.store)
  const entities: EntityDiff[] = []
  for (const iri of new Set([...oldStatements.keys(), ...newStatements.keys()])) {
    const was = oldStatements.get(iri) ?? new Map<string, string>()
    const is = newStatements.get(iri) ?? new Map<string, string>()
    const changes: StatementChange[] = [
      ...[...was].filter(([k]) => !is.has(k)).map(([, text]) => ({ sign: '-' as const, text })),
      ...[...is].filter(([k]) => !was.has(k)).map(([, text]) => ({ sign: '+' as const, text })),
    ]
    if (changes.length === 0) continue
    // Only subjects declared in one of the files count as entities: a bare annotation on the ontology header stays a change to it.
    const store = is.size > 0 ? now.store : old.store
    const status: Status = was.size === 0 ? 'added' : is.size === 0 ? 'removed' : 'changed'
    entities.push({ iri, label: labelOf(store, iri) ?? labelOf(old.store, iri) ?? shortName(iri), kind: kindOf(store, iri), status, changes })
  }
  const rank: Record<Status, number> = { added: 0, changed: 1, removed: 2 }
  entities.sort((a, b) => rank[a.status] - rank[b.status] || a.label.localeCompare(b.label))

  const useLayout = !!old.layout && !!now.layout
  const was = arrows(old, useLayout)
  const is = arrows(now, useLayout)
  const arrowDiffs: ArrowDiff[] = [
    ...[...is].filter(([k]) => !was.has(k)).map(([key, a]) => ({ key, ...a, status: 'added' as const })),
    ...[...was].filter(([k]) => !is.has(k)).map(([key, a]) => ({ key, ...a, status: 'removed' as const })),
  ]
  return { entities, arrows: arrowDiffs, ...(old.layout && { oldLayout: old.layout }), ...(now.layout && { newLayout: now.layout }) }
}
