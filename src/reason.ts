import type { Store, Term } from 'n3'
import { parseTurtle } from './turtle'
import { OWL, RDF, RDFS, shortName } from './vocab'

/**
 * A small, explained reasoner for the class hierarchy: which named superclasses follow from the ontology besides the
 * ones drawn, and which statements each rests on, the way Protégé shows an inferred superclass with its explanation.
 * It reads the exported OWL file and applies a few sound rules, each a step from one class to a superclass:
 *
 * - A subClassOf B, and A equivalentTo B (both ways), between named classes;
 * - A subClassOf (or equivalentTo) B and C and …: A is under each named part;
 * - A subClassOf p some X (also min or exactly n ≥ 1, or p value x), where p or a property above it has domain D:
 *   A is under D; an inverse's range counts as a domain;
 *
 * then follows steps one after another. It is not a complete OWL reasoner: it never finds a class unsatisfiable and
 * ignores unions, negation and property chains. The explanation is the shortest chain of steps.
 */

/** A superclass of `sub` the ontology implies without stating it, and the stated axioms it follows from. */
export type Inference = { sub: string; sup: string; because: string[] }

type Step = { to: string; because: string[] }

const THING = OWL + 'Thing'
const EXISTENTIAL = [OWL + 'someValuesFrom', OWL + 'hasValue']
const AT_LEAST_ONE = [OWL + 'minCardinality', OWL + 'minQualifiedCardinality', OWL + 'cardinality', OWL + 'qualifiedCardinality']

function listItems(store: Store, head: Term): Term[] {
  const items: Term[] = []
  for (let node: Term | undefined = head; node && node.value !== RDF + 'nil' && items.length < 1000; node = store.getObjects(node, RDF + 'rest', null)[0]) {
    const first = store.getObjects(node, RDF + 'first', null)[0]
    if (first) items.push(first)
  }
  return items
}

export type Reasoning = {
  /** Every inferred superclass, by subclass IRI, in order of how many steps it takes. */
  inferred: Map<string, Inference[]>
  /** Every stated superclass by subclass IRI, following subClassOf between named classes. */
  stated: Map<string, Set<string>>
}

export function inferSuperclasses(owl: string, base: string): Reasoning {
  const { store } = parseTurtle(owl, base)
  const name = (iri: string) => store.getObjects(iri, RDFS + 'label', null)[0]?.value ?? shortName(iri)
  const named = (t: Term) => t.termType === 'NamedNode'
  const steps = new Map<string, Step[]>()
  const step = (from: string, to: string, because: string[]) => {
    if (from === to || to === THING) return
    steps.set(from, [...(steps.get(from) ?? []), { to, because }])
  }

  // The domains a property passes on: its own, those of properties above it, and the ranges of its inverses.
  const domains = (p: string, seen = new Set<string>()): { domain: string; because: string[] }[] => {
    if (seen.has(p)) return []
    seen.add(p)
    const own = store.getObjects(p, RDFS + 'domain', null).filter(named).map((d) => ({ domain: d.value, because: [`${name(p)} domain ${name(d.value)}`] }))
    const inverse = [...store.getObjects(p, OWL + 'inverseOf', null), ...store.getSubjects(OWL + 'inverseOf', p, null)]
      .filter(named)
      .flatMap((q) => store.getObjects(q, RDFS + 'range', null).filter(named).map((r) => ({ domain: r.value, because: [`${name(p)} inverse of ${name(q.value)}`, `${name(q.value)} range ${name(r.value)}`] })))
    const above = store
      .getObjects(p, RDFS + 'subPropertyOf', null)
      .filter(named)
      .flatMap((q) => domains(q.value, seen).map((d) => ({ domain: d.domain, because: [`${name(p)} subPropertyOf ${name(q.value)}`, ...d.because] })))
    return [...own, ...inverse, ...above]
  }

  // What a class expression on the right of A's axiom makes A a kind of; `said` is the axiom in words.
  const fromExpression = (a: string, e: Term, said: string) => {
    if (named(e)) return step(a, e.value, [said])
    const parts = store.getObjects(e, OWL + 'intersectionOf', null)[0]
    for (const part of parts ? listItems(store, parts) : []) {
      if (named(part)) step(a, part.value, [said])
    }
    const p = store.getObjects(e, OWL + 'onProperty', null)[0]
    if (!p || !named(p)) return
    const existential = EXISTENTIAL.some((q) => store.countQuads(e, q, null, null) > 0)
    const atLeastOne = AT_LEAST_ONE.some((q) => store.getObjects(e, q, null).some((n) => Number(n.value) >= 1))
    if (!existential && !atLeastOne) return
    for (const { domain, because } of domains(p.value)) step(a, domain, [said, ...because])
  }

  const words = (e: Term): string => {
    if (named(e)) return name(e.value)
    const p = store.getObjects(e, OWL + 'onProperty', null)[0]
    if (p) {
      const some = store.getObjects(e, OWL + 'someValuesFrom', null)[0]
      if (some) return `${name(p.value)} some ${words(some)}`
      const value = store.getObjects(e, OWL + 'hasValue', null)[0]
      if (value) return `${name(p.value)} value ${words(value)}`
      for (const [q, word] of [['minCardinality', 'min'], ['minQualifiedCardinality', 'min'], ['cardinality', 'exactly'], ['qualifiedCardinality', 'exactly']]) {
        const n = store.getObjects(e, OWL + q, null)[0]
        const filler = store.getObjects(e, OWL + 'onClass', null)[0]
        if (n) return `${name(p.value)} ${word} ${n.value}${filler ? ' ' + words(filler) : ''}`
      }
    }
    const parts = store.getObjects(e, OWL + 'intersectionOf', null)[0]
    if (parts) return listItems(store, parts).map(words).join(' and ')
    return '…'
  }

  for (const q of store.getQuads(null, RDFS + 'subClassOf', null, null)) {
    if (named(q.subject)) fromExpression(q.subject.value, q.object, `${name(q.subject.value)} subClassOf ${words(q.object)}`)
  }
  for (const q of store.getQuads(null, OWL + 'equivalentClass', null, null)) {
    const said = (a: Term, b: Term) => `${name(a.value)} equivalentTo ${words(b)}`
    if (named(q.subject)) fromExpression(q.subject.value, q.object, said(q.subject, q.object))
    if (named(q.object) && named(q.subject)) step(q.object.value, q.subject.value, [said(q.subject, q.object)])
  }

  // Shortest chains of steps from each class, by breadth-first search; stated superclasses are left out.
  const statedUp = new Map<string, string[]>()
  for (const q of store.getQuads(null, RDFS + 'subClassOf', null, null)) {
    if (named(q.subject) && named(q.object)) statedUp.set(q.subject.value, [...(statedUp.get(q.subject.value) ?? []), q.object.value])
  }
  const stated = new Map<string, Set<string>>()
  for (const start of statedUp.keys()) {
    const seen = new Set<string>()
    const todo = [...statedUp.get(start)!]
    while (todo.length) {
      const c = todo.pop()!
      if (seen.has(c)) continue
      seen.add(c)
      todo.push(...(statedUp.get(c) ?? []))
    }
    seen.delete(start)
    stated.set(start, seen)
  }
  const inferred = new Map<string, Inference[]>()
  for (const start of steps.keys()) {
    const because = new Map<string, string[]>([[start, []]])
    const queue = [start]
    while (queue.length) {
      const from = queue.shift()!
      for (const { to, because: why } of steps.get(from) ?? []) {
        if (because.has(to)) continue
        because.set(to, [...because.get(from)!, ...why])
        queue.push(to)
      }
    }
    const found = [...because]
      .filter(([sup]) => sup !== start && !stated.get(start)?.has(sup))
      .map(([sup, why]) => ({ sub: start, sup, because: why.filter((w, i) => why.indexOf(w) === i) }))
    if (found.length > 0) inferred.set(start, found)
  }
  return { inferred, stated }
}

/**
 * The inferred superclasses of `sub` worth drawing as an arrow: the most specific ones, leaving out any that another
 * superclass of `sub`, stated or inferred, is already under (unless the two are equivalent).
 */
export function inferredArrows({ inferred, stated }: Reasoning, sub: string): Inference[] {
  const above = (c: string) => new Set([...(inferred.get(c) ?? []).map((i) => i.sup), ...(stated.get(c) ?? [])])
  const all = inferred.get(sub) ?? []
  const supers = above(sub)
  return all.filter((i) => ![...supers].some((b) => b !== i.sup && above(b).has(i.sup) && !above(i.sup).has(b)))
}
