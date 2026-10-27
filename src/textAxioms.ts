import { DataFactory, Parser, Store, Writer, type Quad } from 'n3'
import { manchester } from './manchester'
import { parseManchester } from './manchesterParse'
import type { AxiomKind, KeptStatement } from './model'
import { describe } from './turtle'
import { OWL, RDFS } from './vocab'

/**
 * Class axioms the inspector's rows can't hold (unions, intersections, complements, nested restrictions), kept from an
 * import as statements (see keptStatements.ts) and edited as Manchester syntax text. Each is found by the kept statement
 * it is in (`statement`, an index) and its place among that statement's axioms (`n`).
 */
export type TextAxiom = { statement: number; n: number; kind: AxiomKind; text: string }

const { namedNode, quad } = DataFactory
const key = (q: Quad) => `${q.subject.id} ${q.predicate.id} ${q.object.id}`

const PREDICATE: Record<AxiomKind, string> = { subClassOf: RDFS + 'subClassOf', equivalentClass: OWL + 'equivalentClass', disjointWith: OWL + 'disjointWith' }
const KIND = new Map(Object.entries(PREDICATE).map(([k, p]) => [p, k as AxiomKind]))

const parse = (s: KeptStatement) => new Store(new Parser({ format: 'N-Triples' }).parse(s.ntriples))
// A class expression is a blank node; a named class is an arrow or a row in the inspector.
const axiomQuads = (store: Store, classIri: string) =>
  store.getQuads(classIri, null, null, null).filter((q) => KIND.has(q.predicate.value) && q.object.termType === 'BlankNode')

/** The text axioms on a class, `name` naming each IRI in them (a label, or prefix:local). */
export function textAxioms(statements: KeptStatement[], classIri: string, name: (iri: string) => string): TextAxiom[] {
  return statements.flatMap((s, statement) => {
    if (!s.ntriples.includes(`<${classIri}>`)) return []
    const store = parse(s)
    return axiomQuads(store, classIri).map((q, n) => ({ statement, n, kind: KIND.get(q.predicate.value)!, text: manchester(store, q.object, name) }))
  })
}

/** The statements without one text axiom, and the blank nodes only it used. */
export function removeTextAxiom(statements: KeptStatement[], classIri: string, axiom: Pick<TextAxiom, 'statement' | 'n'>): KeptStatement[] {
  const s = statements[axiom.statement]
  const store = parse(s)
  const target = axiomQuads(store, classIri)[axiom.n]
  if (!target) return statements
  const gone = new Set([target, ...describe(store, target.object)].map(key))
  const rest = store.getQuads(null, null, null, null).filter((q) => !gone.has(key(q)))
  const next = [...statements]
  if (rest.length === 0) next.splice(axiom.statement, 1)
  else next[axiom.statement] = { ...s, ntriples: new Writer({ format: 'N-Triples' }).quadsToString(rest) }
  return next
}

/**
 * The statements with a text axiom added (or, with `replacing`, put in place of one), read from Manchester syntax with
 * `resolve` (see parseManchester). Throws, leaving nothing changed, when the text can't be read.
 */
export function setTextAxiom(
  statements: KeptStatement[],
  classIri: string,
  kind: AxiomKind,
  text: string,
  resolve: (name: string) => string | undefined,
  replacing?: Pick<TextAxiom, 'statement' | 'n'>,
): KeptStatement[] {
  const { root, quads } = parseManchester(text, resolve)
  if (root.termType !== 'BlankNode') throw new Error('A single class is an arrow or a row above; write an expression here, e.g. hasPart some Pump')
  const triples = new Writer({ format: 'N-Triples' }).quadsToString([quad(namedNode(classIri), namedNode(PREDICATE[kind]), root), ...quads])
  const added: KeptStatement = { ntriples: triples, about: classIri }
  const without = replacing ? removeTextAxiom(statements, classIri, replacing) : statements
  return [...without, added]
}
