import type { Store, Term } from 'n3'
import { SH } from './shacl'
import { parseTurtle } from './turtle'
import { OWL, RDF, RDFS, SKOS, XSD, shortName } from './vocab'

/**
 * Checks on the ontology itself, before any data is judged against it: declarations that contradict each other,
 * hierarchies that say nothing, and gaps a reader would trip over. They read the exported OWL file (and shapes file),
 * so they see exactly what the export writes, kept statements from an import included. Nothing is inferred beyond
 * following subClassOf and subPropertyOf.
 *
 * The declaration checks and their severities follow open-ontologies' defects check
 * (https://github.com/fabio-rovai/open-ontologies, MIT, Copyright (c) 2026 Fabio Rovai).
 */

/** `error`: something can have no instances. `warning`: contradictions once data arrives, or a check that says nothing. `info`: only a reader is left uninformed. */
export type Severity = 'error' | 'warning' | 'info'

export type LintEntity = { iri: string; label: string }

export type Finding = {
  kind: string
  severity: Severity
  title: string
  explanation: string
  entities: LintEntity[]
}

/** The most entities listed on one grouped finding; the title still gives the total. */
export const MAX_LISTED = 50

const STANDARD = [RDF, RDFS, OWL, XSD, SKOS, SH]
const isStandard = (iri: string) => STANDARD.some((ns) => iri.startsWith(ns))

type Options = {
  /** IRIs of classes drawn as from another ontology: declared without a label on purpose. */
  outside?: Set<string>
}

/** Every finding for an exported OWL file and, when there is one, its shapes file; errors first. */
export function lintOntology(owl: string, shapes: string | null, base: string, { outside = new Set() }: Options = {}): Finding[] {
  const { store } = parseTurtle(owl, base)
  const label = labeller(store)
  const findings = [...declarationChecks(store, label), ...gapChecks(store, label, outside)]
  if (shapes) findings.push(...shapeChecks(store, parseTurtle(shapes, base).store, label))
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity])
}

function labeller(store: Store) {
  return (iri: string): LintEntity => {
    const named = store.getObjects(iri, RDFS + 'label', null)[0] ?? store.getObjects(iri, SKOS + 'prefLabel', null)[0]
    return { iri, label: named?.value || shortName(iri) }
  }
}

const named = (terms: Term[]) => terms.filter((t) => t.termType === 'NamedNode').map((t) => t.value)
const typed = (store: Store, type: string) => named(store.getSubjects(RDF + 'type', type, null))

/** Named-to-named edges of one predicate, as a map from subject to objects. */
function graphOf(store: Store, predicate: string): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const q of store.getQuads(null, predicate, null, null)) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode' || q.subject.value === q.object.value) continue
    graph.set(q.subject.value, [...(graph.get(q.subject.value) ?? []), q.object.value])
  }
  return graph
}

/** Groups of two or more nodes that all reach one another (Tarjan's strongly connected components). */
function cycles(graph: Map<string, string[]>): string[][] {
  let next = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const found: string[][] = []
  const visit = (v: string) => {
    index.set(v, next)
    low.set(v, next++)
    stack.push(v)
    onStack.add(v)
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        group.push(w)
      } while (w !== v)
      if (group.length > 1) found.push(group.sort())
    }
  }
  for (const v of graph.keys()) if (!index.has(v)) visit(v)
  return found
}

/** Everything above `start`, not counting itself unless a cycle leads back to it. */
function ancestors(graph: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>()
  const todo = [...(graph.get(start) ?? [])]
  while (todo.length) {
    const c = todo.pop()!
    if (seen.has(c)) continue
    seen.add(c)
    todo.push(...(graph.get(c) ?? []))
  }
  return seen
}

/** The items of an RDF list. */
function listItems(store: Store, head: Term): Term[] {
  const items: Term[] = []
  for (let node: Term | undefined = head; node && node.value !== RDF + 'nil' && items.length < 10000; node = store.getObjects(node, RDF + 'rest', null)[0]) {
    const first = store.getObjects(node, RDF + 'first', null)[0]
    if (first) items.push(first)
  }
  return items
}

/** Pairs of named classes declared disjoint, by owl:disjointWith or owl:AllDisjointClasses, as "a b" keys both ways. */
function disjointPairs(store: Store): Set<string> {
  const pairs = new Set<string>()
  const add = (a: string, b: string) => {
    if (a === b) return
    pairs.add(`${a} ${b}`)
    pairs.add(`${b} ${a}`)
  }
  for (const [a, bs] of graphOf(store, OWL + 'disjointWith')) for (const b of bs) add(a, b)
  for (const all of store.getSubjects(RDF + 'type', OWL + 'AllDisjointClasses', null)) {
    for (const list of store.getObjects(all, OWL + 'members', null)) {
      const members = named(listItems(store, list))
      for (const a of members) for (const b of members) add(a, b)
    }
  }
  return pairs
}

function declarationChecks(store: Store, label: (iri: string) => LintEntity): Finding[] {
  const findings: Finding[] = []
  const has = (iri: string, type: string) => store.countQuads(iri, RDF + 'type', type, null) > 0

  for (const p of typed(store, OWL + 'TransitiveProperty').filter((p) => has(p, OWL + 'FunctionalProperty'))) {
    findings.push({
      kind: 'transitive_and_functional',
      severity: 'warning',
      title: `${label(p).label} is both transitive and functional`,
      explanation:
        'A transitive property chains and a functional property allows one value, so any chain of two forces the two values to be the same individual. It is consistent now and will produce contradictions as soon as instances arrive.',
      entities: [label(p)],
    })
  }
  for (const p of typed(store, OWL + 'SymmetricProperty').filter((p) => has(p, OWL + 'AsymmetricProperty'))) {
    findings.push({
      kind: 'symmetric_and_asymmetric',
      severity: 'error',
      title: `${label(p).label} is both symmetric and asymmetric`,
      explanation: 'Symmetric requires the reverse link and asymmetric forbids it, so the property can never hold between two individuals.',
      entities: [label(p)],
    })
  }
  for (const q of store.getQuads(null, OWL + 'inverseOf', null, null)) {
    const p = q.subject.value
    if (q.subject.termType !== 'NamedNode' || q.object.value !== p || has(p, OWL + 'SymmetricProperty')) continue
    findings.push({
      kind: 'self_inverse',
      severity: 'info',
      title: `${label(p).label} is its own inverse`,
      explanation: 'A property that is its own inverse is symmetric. Mark it symmetric to say so, or the inverse was a slip.',
      entities: [label(p)],
    })
  }

  const subClass = graphOf(store, RDFS + 'subClassOf')
  for (const group of cycles(subClass)) {
    findings.push({
      kind: 'subclass_cycle',
      severity: 'warning',
      title: `Subclass cycle: ${group.map((c) => label(c).label).join(', ')}`,
      explanation: 'Classes on a subclass cycle are all equivalent, which is almost never what a hierarchy was meant to say.',
      entities: group.map(label),
    })
  }
  for (const group of cycles(graphOf(store, RDFS + 'subPropertyOf'))) {
    findings.push({
      kind: 'sub_property_cycle',
      severity: 'warning',
      title: `Sub-property cycle: ${group.map((p) => label(p).label).join(', ')}`,
      explanation: 'Properties on a sub-property cycle are all equivalent, so the hierarchy says nothing.',
      entities: group.map(label),
    })
  }

  const disjoint = disjointPairs(store)
  if (disjoint.size > 0) {
    for (const c of [...subClass.keys()].sort()) {
      const above = [...ancestors(subClass, c)].filter((a) => a !== c).sort()
      for (const a of above.filter((a) => disjoint.has(`${c} ${a}`))) {
        findings.push({
          kind: 'disjoint_with_ancestor',
          severity: 'error',
          title: `${label(c).label} is disjoint with its ancestor ${label(a).label}`,
          explanation: 'A class that is a kind of something it is also disjoint with can have no instances at all.',
          entities: [label(c), label(a)],
        })
      }
      for (const [i, a] of above.entries()) {
        for (const b of above.slice(i + 1).filter((b) => disjoint.has(`${a} ${b}`))) {
          findings.push({
            kind: 'inherited_disjoint',
            severity: 'error',
            title: `${label(c).label} is under both ${label(a).label} and ${label(b).label}, which are disjoint`,
            explanation: 'The class sits under two ancestors declared disjoint, so it can have no instances.',
            entities: [label(c), label(a), label(b)],
          })
        }
      }
    }
  }
  return findings
}

/** Missing labels, domains and ranges, one finding per kind listing every entity it applies to. */
function gapChecks(store: Store, label: (iri: string) => LintEntity, outside: Set<string>): Finding[] {
  const own = (iris: string[]) => [...new Set(iris)].filter((i) => !isStandard(i) && !outside.has(i)).sort()
  const classes = own(typed(store, OWL + 'Class'))
  const properties = own([...typed(store, OWL + 'ObjectProperty'), ...typed(store, OWL + 'DatatypeProperty')])
  const unlabelled = [...classes, ...properties].filter((i) => store.countQuads(i, RDFS + 'label', null, null) + store.countQuads(i, SKOS + 'prefLabel', null, null) === 0)
  const without = (predicate: string) => properties.filter((p) => store.countQuads(p, predicate, null, null) === 0)
  const group = (kind: string, iris: string[], what: string, explanation: string): Finding[] =>
    iris.length === 0
      ? []
      : [{ kind, severity: 'info', title: `${iris.length} ${what}`, explanation, entities: iris.slice(0, MAX_LISTED).map(label) }]
  return [
    ...group('missing_label', unlabelled, unlabelled.length === 1 ? 'class or property has no label' : 'classes or properties have no label', 'Without rdfs:label, other tools show only the IRI.'),
    ...group('missing_domain', without(RDFS + 'domain'), without(RDFS + 'domain').length === 1 ? 'property has no domain' : 'properties have no domain', 'The property may be used on anything. Fine on purpose, but often a forgotten arrow end.'),
    ...group('missing_range', without(RDFS + 'range'), without(RDFS + 'range').length === 1 ? 'property has no range' : 'properties have no range', 'The property may point at anything. Fine on purpose, but often a forgotten arrow end.'),
  ]
}

/** Shapes that point at a class or property the ontology does not declare, or use a rule of the wrong kind for it. */
function shapeChecks(owl: Store, shapes: Store, label: (iri: string) => LintEntity): Finding[] {
  const declared = (iri: string, types: string[]) => isStandard(iri) || types.some((t) => owl.countQuads(iri, RDF + 'type', t, null) > 0)
  const classTypes = [OWL + 'Class', RDFS + 'Class']
  const objectTypes = [OWL + 'ObjectProperty']
  const dataTypes = [OWL + 'DatatypeProperty']
  const anyProperty = [...objectTypes, ...dataTypes, OWL + 'AnnotationProperty', RDF + 'Property']
  const shapeName = (shape: Term) => {
    const node = shapes.getSubjects(SH + 'property', shape, null)[0] ?? shape
    return node.termType === 'NamedNode' ? shortName(node.value) : 'a shape'
  }
  const unknownClasses = new Map<string, Set<string>>()
  const unknownProperties = new Map<string, Set<string>>()
  const note = (map: Map<string, Set<string>>, iri: string, shape: Term) => map.set(iri, (map.get(iri) ?? new Set()).add(shapeName(shape)))
  const findings: Finding[] = []

  for (const predicate of [SH + 'targetClass', SH + 'class']) {
    for (const q of shapes.getQuads(null, predicate, null, null)) {
      if (q.object.termType === 'NamedNode' && !declared(q.object.value, classTypes)) note(unknownClasses, q.object.value, q.subject)
    }
  }
  for (const q of shapes.getQuads(null, SH + 'path', null, null)) {
    // A plain property, or one step back along it (sh:inversePath); other paths are left alone.
    const path = q.object.termType === 'BlankNode' ? shapes.getObjects(q.object, SH + 'inversePath', null)[0] : q.object
    if (path?.termType !== 'NamedNode') continue
    const p = path.value
    if (!declared(p, anyProperty)) {
      note(unknownProperties, p, q.subject)
      continue
    }
    const rule = (r: string) => shapes.countQuads(q.subject, SH + r, null, null) > 0
    const data = owl.countQuads(p, RDF + 'type', OWL + 'DatatypeProperty', null) > 0
    const object = owl.countQuads(p, RDF + 'type', OWL + 'ObjectProperty', null) > 0
    if ((object && rule('datatype')) || (data && rule('class'))) {
      findings.push({
        kind: 'shape_wrong_rule',
        severity: 'warning',
        title: object
          ? `${shapeName(q.subject)} asks for a datatype on ${label(p).label}, an object property`
          : `${shapeName(q.subject)} asks for a class on ${label(p).label}, a data property`,
        explanation: object
          ? 'Object property values are individuals, never literals, so every value breaks a datatype rule.'
          : 'Data property values are literals, never individuals of a class, so every value breaks a class rule.',
        entities: [label(p)],
      })
    }
  }
  for (const [iri, where] of unknownClasses) {
    findings.push({
      kind: 'shape_unknown_class',
      severity: 'warning',
      title: `${[...where].join(', ')} ${where.size === 1 ? 'refers' : 'refer'} to ${shortName(iri)}, which the ontology does not declare`,
      explanation: 'The rule targets or requires a class that is not in the ontology: a typo, a renamed class, or one from an ontology that is not imported.',
      entities: [{ iri, label: shortName(iri) }],
    })
  }
  for (const [iri, where] of unknownProperties) {
    findings.push({
      kind: 'shape_unknown_property',
      severity: 'warning',
      title: `${[...where].join(', ')} ${where.size === 1 ? 'constrains' : 'constrain'} ${shortName(iri)}, which the ontology does not declare`,
      explanation: 'The rule is about a property that is not in the ontology: a typo, a renamed property, or one from an ontology that is not imported.',
      entities: [{ iri, label: shortName(iri) }],
    })
  }
  return findings
}
