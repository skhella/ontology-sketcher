import { Parser, Store, type Quad, type Term } from 'n3'
import { listItems, manchester } from './manchester'
import type { KeptTriple } from './keptEdit'
import type { KeptProperty, KeptStatement } from './model'
import { OWL, RDF, RDFS, XSD, shortName } from './vocab'

/**
 * One statement as the panel writes it: `value` is text, `iri` the IRI it names when there is one to go to.
 * `edit` is the statement itself, for a plain one (named subject, IRI or literal object) the panel can change.
 */
export type HiddenLine = { predicate: string; value: string; iri?: string; edit?: KeptTriple }
/** A subject the canvas does not show (or not all of): its name, its IRI when it has one, and what is said about it. */
export type HiddenEntry = { iri?: string; name: string; lines: HiddenLine[] }

/**
 * Everything an import keeps for the export but the canvas doesn't draw (see keptStatements.ts and KeptProperty),
 * sorted into what a person looks for: individuals by class, properties drawn nowhere, class axioms the inspector
 * can't show (in Manchester syntax), other statements about things on the canvas, and the rest.
 */
export type HiddenItems = {
  individuals: { type?: string; typeName: string; entries: HiddenEntry[] }[]
  properties: (HiddenEntry & { kind: 'object' | 'data'; iri: string })[]
  axioms: { about: string; name: string; text: string }[]
  aboutDrawn: (HiddenEntry & { iri: string })[]
  other: HiddenEntry[]
  count: number
}

const TYPE = RDF + 'type'
const LABEL = RDFS + 'label'
const AXIOMS: Record<string, string> = { [RDFS + 'subClassOf']: 'SubClassOf', [OWL + 'equivalentClass']: 'EquivalentTo', [OWL + 'disjointWith']: 'DisjointWith' }

/**
 * Sorts the kept statements and properties of a project. `name` gives the name to show for an IRI (a class's label,
 * say); individuals are named by their own rdfs:label.
 */
export function hiddenItems(statements: KeptStatement[], kept: KeptProperty[], name: (iri: string) => string): HiddenItems {
  const parsed = statements.map((s) => ({ ...s, store: new Store(new Parser({ format: 'N-Triples' }).parse(s.ntriples)) }))
  // Individuals' own labels, so a link from one to another reads as a name.
  const labels = new Map<string, string>()
  for (const { store } of parsed) for (const q of store.getQuads(null, LABEL, null, null)) if (q.subject.termType === 'NamedNode') labels.set(q.subject.value, q.object.value)
  const named = (iri: string) => labels.get(iri) ?? name(iri)

  const keptIris = new Set(kept.map((p) => p.iri))
  const byType = new Map<string, HiddenEntry[]>()
  const properties: HiddenItems['properties'] = kept.map((p) => ({ iri: p.iri, kind: p.kind, name: p.label || named(p.iri), lines: keptLines(p, named) }))
  const axioms: HiddenItems['axioms'] = []
  const aboutDrawn: HiddenItems['aboutDrawn'] = []
  const other: HiddenEntry[] = []

  for (const { store, about } of parsed) {
    const subjects = store.getSubjects(null, null, null).filter((s) => s.termType === 'NamedNode' || !store.getQuads(null, null, s, null).length)
    for (const subject of subjects) {
      const quads = store.getQuads(subject, null, null, null)
      if (subject.termType === 'BlankNode') {
        other.push({ name: topLevelName(store, subject, named), lines: linesOf(store, quads, named, true) })
        continue
      }
      const iri = subject.value
      const types = quads.filter((q) => q.predicate.value === TYPE).map((q) => q.object.value)
      if (types.includes(OWL + 'NamedIndividual')) {
        const type = types.find((t) => t !== OWL + 'NamedIndividual') ?? ''
        // The class it is listed under and the label it is named by go without saying.
        const said = (q: Quad) => (q.predicate.value === TYPE && q.object.value === type) || (q.predicate.value === LABEL && q.object.value === labels.get(iri))
        const entry = { iri, name: named(iri), lines: linesOf(store, quads.filter((q) => !said(q)), named) }
        byType.set(type, [...(byType.get(type) ?? []), entry])
        continue
      }
      const property = properties.find((p) => p.iri === iri)
      if (property) {
        property.lines.push(...linesOf(store, quads, named))
        continue
      }
      // Axioms with a nested class expression; the other statements about a drawn class go with it.
      const rest: Quad[] = []
      for (const q of quads) {
        if (AXIOMS[q.predicate.value] && q.object.termType === 'BlankNode') axioms.push({ about: iri, name: named(iri), text: `${AXIOMS[q.predicate.value]} ${manchester(store, q.object, named)}` })
        else rest.push(q)
      }
      if (rest.length === 0) continue
      const entry = { iri, name: named(iri), lines: linesOf(store, rest, named) }
      if (about && !keptIris.has(iri)) aboutDrawn.push(entry)
      else other.push(entry)
    }
  }

  const individuals = [...byType]
    .map(([type, entries]) => ({ ...(type && { type }), typeName: type ? named(type) : 'No class', entries: entries.sort(byName) }))
    .sort((a, b) => a.typeName.localeCompare(b.typeName))
  const count =
    individuals.reduce((n, g) => n + g.entries.length, 0) + properties.length + axioms.length + aboutDrawn.length + other.length
  return { individuals, properties: properties.sort(byName), axioms, aboutDrawn: aboutDrawn.sort(byName), other, count }
}

/** What the export writes for a kept property besides its label: why it can't be an arrow is in what's missing. */
function keptLines(p: KeptProperty, name: (iri: string) => string): HiddenLine[] {
  const or = (iris: string[] | undefined) => (iris?.length ? { value: iris.map(name).join(' or '), ...(iris.length === 1 && { iri: iris[0] }) } : { value: 'none' })
  return [
    { predicate: 'domain', ...or(p.domains) },
    { predicate: 'range', ...or(p.ranges) },
    ...(p.characteristics ?? []).map((c) => ({ predicate: 'a', value: c })),
    ...(p.subPropertyOf ?? []).map((iri) => ({ predicate: 'subPropertyOf', value: name(iri), iri })),
    ...(p.inverseOf ?? []).map((iri) => ({ predicate: 'inverseOf', value: name(iri), iri })),
    ...(p.annotations ?? []).map((a) => ({ predicate: name(a.property), value: a.lang ? `${a.value}@${a.lang}` : a.value })),
  ]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** The statements of one subject as lines; `all` keeps rdf:type (for a blank node, where the type says what it is). */
function linesOf(store: Store, quads: Quad[], name: (iri: string) => string, all = false): HiddenLine[] {
  return quads
    .filter((q) => all || q.predicate.value !== TYPE || ![OWL + 'NamedIndividual'].includes(q.object.value))
    .map((q) => ({ predicate: q.predicate.value === TYPE ? 'a' : name(q.predicate.value), ...valueOf(store, q.object, name), ...editOf(q) }))
}

function editOf(q: Quad): { edit?: KeptTriple } {
  if (q.subject.termType !== 'NamedNode') return {}
  const base = { subject: q.subject.value, predicate: q.predicate.value }
  if (q.object.termType === 'NamedNode') return { edit: { ...base, object: { kind: 'iri', value: q.object.value } } }
  if (q.object.termType !== 'Literal') return {}
  const { value, language, datatype } = q.object
  return { edit: { ...base, object: { kind: 'literal', value, ...(language ? { lang: language } : datatype.value !== XSD + 'string' && { datatype: datatype.value }) } } }
}

function valueOf(store: Store, term: Term, name: (iri: string) => string): { value: string; iri?: string } {
  if (term.termType === 'NamedNode') return { value: name(term.value), iri: term.value }
  if (term.termType === 'Literal') {
    const suffix = term.language ? `@${term.language}` : term.datatype.value !== XSD + 'string' ? ` (${shortName(term.datatype.value)})` : ''
    return { value: `${term.value}${suffix}` }
  }
  const items = listItems(store, term)
  if (items) return { value: items.map((i) => valueOf(store, i, name).value).join(', ') }
  return { value: manchester(store, term, name) }
}

/** What a statement with no named subject is, e.g. "Disjoint classes" for an owl:AllDisjointClasses. */
function topLevelName(store: Store, subject: Term, name: (iri: string) => string): string {
  const type = store.getObjects(subject, TYPE, null)[0]
  if (!type) return 'Statement'
  const known: Record<string, string> = {
    [OWL + 'AllDisjointClasses']: 'Disjoint classes',
    [OWL + 'AllDisjointProperties']: 'Disjoint properties',
    [OWL + 'AllDifferent']: 'Different individuals',
    [OWL + 'NegativePropertyAssertion']: 'Negative property assertion',
    [OWL + 'Axiom']: 'Annotated axiom',
  }
  return known[type.value] ?? name(type.value)
}
