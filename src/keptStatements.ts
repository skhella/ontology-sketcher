import { Parser, Store, Writer, type Quad, type Term } from 'n3'
import { localName, propertyLocalName, type KeptStatement, type Ontology } from './model'
import { dataPropertyIri, entityIri, toTurtle } from './owl'
import { LAYOUT_PROPERTY } from './savedLayout'
import { describe } from './turtle'

/**
 * The statements of an imported ontology that the canvas does not stand for, so the export can write them back
 * unchanged (see KeptStatement): whatever exporting the imported canvas leaves out of the file it came from.
 * A statement is a triple with a named subject, or a blank node no triple points at (such as an owl:AllDisjointClasses),
 * each with the blank nodes it uses; statements about the same subject are kept together.
 */
export async function keptStatementsOf(source: string, imported: Ontology): Promise<KeptStatement[]> {
  const sourceStore = new Store(new Parser().parse(source))
  const exported = new Store(new Parser().parse(await toTurtle(imported)))
  const written = new Set(statements(exported).map((s) => s.key))

  const base = imported.iri
  const entities = new Set([
    ...imported.nodes.map((n) => entityIri(base, n.data, localName(n.data.label))),
    ...imported.nodes.flatMap((n) => (n.data.dataProperties ?? []).map((p) => dataPropertyIri(base, p))),
    ...imported.edges.flatMap((e) => (e.data && e.data.kind !== 'subClassOf' ? [entityIri(base, e.data, propertyLocalName(e.data.label))] : [])),
    ...(imported.kept ?? []).map((p) => p.iri),
  ])

  const bySubject = new Map<string, Quad[]>()
  for (const s of statements(sourceStore)) {
    if (written.has(s.key) || s.quads[0].predicate.value === LAYOUT_PROPERTY) continue
    const subject = s.quads[0].subject
    const group = subject.termType === 'NamedNode' ? subject.value : `_:${subject.value}`
    bySubject.set(group, [...(bySubject.get(group) ?? []), ...s.quads])
  }
  return Promise.all(
    [...bySubject].map(async ([subject, quads]) => ({ ntriples: await nTriples(quads), ...(entities.has(subject) && { about: subject }) })),
  )
}

/** The statements of a graph, each with a key that is the same for the same statement in another graph. */
function statements(store: Store): { key: string; quads: Quad[] }[] {
  const referenced = new Set(store.getQuads(null, null, null, null).filter((q) => q.object.termType === 'BlankNode').map((q) => q.object.value))
  // A blank node written out with everything it holds, so two graphs naming it differently still agree.
  const inline = (term: Term, seen: Set<string>): string => {
    if (term.termType === 'Literal') return JSON.stringify([term.value, term.language, term.datatype.value])
    if (term.termType !== 'BlankNode') return `<${term.value}>`
    if (seen.has(term.value)) return '[…]'
    const inner = new Set([...seen, term.value])
    return `[${store
      .getQuads(term, null, null, null)
      .map((q) => `<${q.predicate.value}> ${inline(q.object, inner)}`)
      .sort()
      .join('; ')}]`
  }
  const out: { key: string; quads: Quad[] }[] = []
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.subject.termType === 'BlankNode') continue
    const rest = q.object.termType === 'BlankNode' ? describe(store, q.object) : []
    out.push({ key: `<${q.subject.value}> <${q.predicate.value}> ${inline(q.object, new Set())}`, quads: [q, ...rest] })
  }
  for (const subject of store.getSubjects(null, null, null).filter((s) => s.termType === 'BlankNode' && !referenced.has(s.value))) {
    out.push({ key: inline(subject, new Set()), quads: describe(store, subject) })
  }
  return out
}

function nTriples(quads: Quad[]): Promise<string> {
  const writer = new Writer({ format: 'N-Triples' })
  writer.addQuads(quads)
  return new Promise((resolve, reject) => writer.end((error, result) => (error ? reject(error) : resolve(result))))
}
