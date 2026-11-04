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
 * The reference and style checks follow ontology-quality-suite's check registry
 * (https://github.com/pwin/consolidated-ontology-quality-suite-python, MIT OR Apache-2.0, Copyright (c) 2026 pwin).
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
  const findings = [...declarationChecks(store, label), ...gapChecks(store, label, outside), ...referenceChecks(store, label), ...styleChecks(store, label, outside, base)]
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

/** Predicates whose object is a class, property or datatype the statement relies on, as opposed to an annotation. */
const REFERENCING = [
  RDF + 'type',
  RDFS + 'subClassOf',
  RDFS + 'subPropertyOf',
  RDFS + 'domain',
  RDFS + 'range',
  OWL + 'equivalentClass',
  OWL + 'equivalentProperty',
  OWL + 'disjointWith',
  OWL + 'propertyDisjointWith',
  OWL + 'inverseOf',
  OWL + 'onProperty',
  OWL + 'someValuesFrom',
  OWL + 'allValuesFrom',
  OWL + 'onClass',
  OWL + 'onDataRange',
  OWL + 'complementOf',
  RDF + 'first',
]

/** Grouped findings of one kind, listing every entity it applies to; see gapChecks. */
function grouped(label: (iri: string) => LintEntity, severity: Severity, kind: string, iris: string[], one: string, many: string, explanation: string): Finding[] {
  return iris.length === 0 ? [] : [{ kind, severity, title: `${iris.length} ${iris.length === 1 ? one : many}`, explanation, entities: iris.slice(0, MAX_LISTED).map(label) }]
}

/**
 * Terms the axioms rely on that the file never declares, and deprecated terms still relied on. Both look at the objects
 * of subClassOf, domain, range, restrictions, lists in class expressions, rdf:type and the like, never at annotations.
 */
function referenceChecks(store: Store, label: (iri: string) => LintEntity): Finding[] {
  const deprecated = new Set(named(store.getSubjects(OWL + 'deprecated', null, null)).filter((d) => store.getObjects(d, OWL + 'deprecated', null).some((o) => o.value === 'true')))
  const undeclared = new Set<string>()
  const stillUsed = new Set<string>()
  for (const p of REFERENCING) {
    for (const q of store.getQuads(null, p, null, null)) {
      const o = q.object
      if (o.termType !== 'NamedNode' || isStandard(o.value)) continue
      if (store.countQuads(o, RDF + 'type', null, null) === 0) undeclared.add(o.value)
      if (deprecated.has(o.value) && !deprecated.has(q.subject.value)) stillUsed.add(o.value)
    }
  }
  const imports = store.countQuads(null, OWL + 'imports', null, null) > 0
  return [
    ...grouped(
      label,
      'warning',
      'undeclared_term',
      [...undeclared].sort(),
      'term is used but never declared',
      'terms are used but never declared',
      `An axiom refers to it, but nothing says whether it is a class, a property or a datatype: a typo, a renamed term, or one from another ontology${imports ? ' (perhaps an imported one)' : ' that is not imported'}. Other tools may guess its kind or reject the file.`,
    ),
    ...grouped(
      label,
      'warning',
      'deprecated_in_use',
      [...stillUsed].sort(),
      'deprecated term is still in use',
      'deprecated terms are still in use',
      'It is marked owl:deprecated, yet other classes or properties still rely on it. Point them at its replacement.',
    ),
  ]
}

/** Equivalent classes also stated as subclasses, properties with several inverses, and names or labels that break the house style. */
function styleChecks(store: Store, label: (iri: string) => LintEntity, outside: Set<string>, base: string): Finding[] {
  const own = (iris: string[]) => [...new Set(iris)].filter((i) => !isStandard(i) && !outside.has(i)).sort()
  const redundant = new Set<string>()
  for (const q of store.getQuads(null, OWL + 'equivalentClass', null, null)) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue
    if (store.countQuads(q.subject, RDFS + 'subClassOf', q.object, null) > 0) redundant.add(q.subject.value)
    if (store.countQuads(q.object, RDFS + 'subClassOf', q.subject, null) > 0) redundant.add(q.object.value)
  }
  const inverses = new Map<string, Set<string>>()
  for (const q of store.getQuads(null, OWL + 'inverseOf', null, null)) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode' || q.subject.value === q.object.value) continue
    for (const [a, b] of [[q.subject.value, q.object.value], [q.object.value, q.subject.value]]) inverses.set(a, (inverses.get(a) ?? new Set()).add(b))
  }
  const manyInverses = own([...inverses].filter(([, of]) => of.size > 1).map(([p]) => p))

  // Only names this ontology gives, under its own IRI: terms reused from another ontology keep that one's style.
  // Opaque identifiers such as BFO_0000001 have no case to follow.
  const homes = [base, ...named(store.getSubjects(RDF + 'type', OWL + 'Ontology', null))].map((iri) => iri.replace(/[#/]$/, ''))
  const local = (iri: string) => (homes.some((h) => iri.startsWith(h + '#') || iri.startsWith(h + '/')) ? iri.replace(/^.*[#/]/, '') : '')
  const opaque = (name: string) => /^[A-Za-z]*_?\d+$/.test(name)
  const classes = own(typed(store, OWL + 'Class'))
  const properties = own([...typed(store, OWL + 'ObjectProperty'), ...typed(store, OWL + 'DatatypeProperty')])
  const badClassNames = classes.filter((c) => local(c) && !opaque(local(c)) && !/^[A-Z][A-Za-z0-9]*$/.test(local(c)))
  const badPropertyNames = properties.filter((p) => local(p) && !opaque(local(p)) && !/^[a-z][A-Za-z0-9]*$/.test(local(p)))

  // Labels without a language tag only matter in an ontology whose other labels have one.
  const labels = [...classes, ...properties].flatMap((i) => store.getObjects(i, RDFS + 'label', null).map((l) => ({ i, tagged: l.termType === 'Literal' && !!l.language })))
  const untagged = labels.some((l) => l.tagged) ? own(labels.filter((l) => !l.tagged).map((l) => l.i)) : []

  return [
    ...grouped(label, 'info', 'redundant_subclass', [...redundant].sort(), 'class is stated as both equivalent to and a subclass of the same class', 'classes are stated as both equivalent to and a subclass of the same class', 'Equivalence already makes each class a subclass of the other, so the subClassOf says nothing more. Keep one of the two.'),
    ...grouped(label, 'info', 'several_inverses', manyInverses, 'property has more than one inverse', 'properties have more than one inverse', 'Its inverses are then all the same property. Usually one inverse was meant, or the others should be sub-properties.'),
    ...grouped(label, 'info', 'class_name_case', badClassNames, 'class name is not in UpperCamelCase', 'class names are not in UpperCamelCase', 'Class local names usually start with a capital and have no spaces or separators, e.g. PizzaTopping. Only the IRI is meant; the label can be anything.'),
    ...grouped(label, 'info', 'property_name_case', badPropertyNames, 'property name is not in lowerCamelCase', 'property names are not in lowerCamelCase', 'Property local names usually start with a small letter and have no separators, e.g. hasTopping. Only the IRI is meant; the label can be anything.'),
    ...grouped(label, 'info', 'label_without_language', untagged, 'label has no language tag', 'labels have no language tag', 'Other labels in this ontology have a language tag, such as @en. Without one, tools cannot tell which language this label is in.'),
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
