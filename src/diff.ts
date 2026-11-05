import type { Quad, Store, Term } from 'n3'
import { LAYOUT_PROPERTIES, edgeKey, parseLayout, type SavedLayout } from './savedLayout'
import { parseTurtle } from './turtle'
import { DCTERMS, OWL, RDF, RDFS, SKOS, shortName } from './vocab'

/**
 * What changed between two versions of an ontology, read from their Turtle: an earlier file and the canvas's export.
 * Each named class, property or concept is added, removed or changed (its own statements differ); arrows between
 * classes are added or removed. The layout annotation is left out: moving a box is not a change to the ontology.
 */

export type Status = 'added' | 'removed' | 'changed'

/** One statement about an entity, as a reader would say it, e.g. "subClassOf Animal" or "label "Dog"@en". */
export type StatementChange = { sign: '+' | '-'; text: string }

/** The other half of a probable rename, and why it is thought one: see findRenames. */
export type RenameLink = { iri: string; label: string; why: string }

export type EntityDiff = {
  iri: string
  label: string
  kind: 'class' | 'property' | 'other'
  status: Status
  changes: StatementChange[]
  /** On an added entity: the removed (or replaced) one it probably is, under its new name. */
  renamedFrom?: RenameLink
  /** On a removed or replaced entity: the added one it probably became. */
  renamedTo?: RenameLink
}

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

/** Statements that say one term replaces another, as [predicate, its name, true when the subject is the old term]. */
const REPLACED: [string, string, boolean][] = [
  [DCTERMS + 'isReplacedBy', 'dcterms:isReplacedBy', true],
  ['http://purl.obolibrary.org/obo/IAO_0100001', 'term replaced by', true],
  [DCTERMS + 'replaces', 'dcterms:replaces', false],
]
const EQUIVALENT = [OWL + 'equivalentClass', OWL + 'equivalentProperty']

/** A name compared loosely: lower case, without separators, so "has_topping" and "hasTopping" are the same. */
const loose = (name: string) => name.toLowerCase().replace(/[\s_\-.]/g, '')

/** How alike two names are, from 0 to 1, by edit distance. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return 1 - row[b.length] / Math.max(a.length, b.length)
}

/** Names this alike or more count as a probable rename when nothing in the files says so. */
export const SIMILAR_NAME = 0.8

/**
 * Pairs removed entities with added ones of the same kind that are probably the same thing under a new IRI. A
 * statement in either file that one replaces the other (dcterms:isReplacedBy, dcterms:replaces, OBO "term replaced by")
 * or that they are equivalent is the surest sign, and then the old term may also still be there, only changed; failing
 * that, the same or a similar label or local name. Each entity is in at most one pair, the surest first.
 */
function findRenames(entities: EntityDiff[], stores: Store[]) {
  const added = entities.filter((e) => e.status === 'added' && e.kind !== 'other')
  const said = (from: string, to: string): string | undefined => {
    for (const store of stores) {
      for (const [p, name, subjectIsOld] of REPLACED) {
        const [s, o] = subjectIsOld ? [from, to] : [to, from]
        if (store.countQuads(s, p, o, null) > 0) return `marked ${name}`
      }
      for (const p of EQUIVALENT) if (store.countQuads(from, p, to, null) + store.countQuads(to, p, from, null) > 0) return `marked ${shortName(p)}`
    }
  }
  const pairs: { from: EntityDiff; to: EntityDiff; score: number; why: string }[] = []
  for (const from of entities) {
    if (from.status === 'added' || from.kind === 'other') continue
    for (const to of added) {
      if (to.kind !== from.kind) continue
      const why = said(from.iri, to.iri)
      if (why) {
        pairs.push({ from, to, score: 2, why })
        continue
      }
      if (from.status !== 'removed') continue
      const byName = similarity(loose(shortName(from.iri).replace(/^[\w-]*:/, '')), loose(shortName(to.iri).replace(/^[\w-]*:/, '')))
      const byLabel = similarity(loose(from.label), loose(to.label))
      const score = Math.max(byName, byLabel)
      if (score >= SIMILAR_NAME) pairs.push({ from, to, score, why: score === 1 ? (byName === 1 ? 'same local name' : 'same label') : 'similar name' })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  for (const { from, to, why } of pairs) {
    if (from.renamedTo || to.renamedFrom) continue
    from.renamedTo = { iri: to.iri, label: to.label, why }
    to.renamedFrom = { iri: from.iri, label: from.label, why }
  }
}

/** A probable rename in words, e.g. "Probably renamed from Margherita (similar name)", or nothing. */
export function renameNote(e: EntityDiff): string | undefined {
  if (e.renamedFrom) return `Probably renamed from ${e.renamedFrom.label} (${e.renamedFrom.why})`
  if (e.renamedTo) return `Probably renamed to ${e.renamedTo.label} (${e.renamedTo.why})`
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
  findRenames(entities, [now.store, old.store])

  const useLayout = !!old.layout && !!now.layout
  const was = arrows(old, useLayout)
  const is = arrows(now, useLayout)
  const arrowDiffs: ArrowDiff[] = [
    ...[...is].filter(([k]) => !was.has(k)).map(([key, a]) => ({ key, ...a, status: 'added' as const })),
    ...[...was].filter(([k]) => !is.has(k)).map(([key, a]) => ({ key, ...a, status: 'removed' as const })),
  ]
  return { entities, arrows: arrowDiffs, ...(old.layout && { oldLayout: old.layout }), ...(now.layout && { newLayout: now.layout }) }
}

/**
 * Turtle text with its blank node labels renumbered in the order they first appear, so two exports that differ only
 * in the labels the writer happened to pick (it counts on from earlier exports) come out equal.
 */
export function blankNodesNumbered(turtle: string): string {
  const ids = new Map<string, string>()
  return turtle.replace(/_:[A-Za-z0-9_](?:[\w.-]*[\w-])?/g, (label) => {
    let id = ids.get(label)
    if (!id) ids.set(label, (id = `_:b${ids.size}`))
    return id
  })
}
