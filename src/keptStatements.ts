import { Parser, Store, Writer, type Quad, type Term } from 'n3'
import { localName, propertyLocalName, type KeptStatement, type Ontology } from './model'
import { dataPropertyIri, entityIri, toTurtle } from './owl'
import { LAYOUT_PROPERTIES } from './savedLayout'
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
    // The layout and what is said about its property are written afresh on export, under the current name.
    const { subject, predicate } = s.quads[0]
    if (written.has(s.key) || LAYOUT_PROPERTIES.has(predicate.value) || LAYOUT_PROPERTIES.has(subject.value)) continue
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
  // A list is written as its items in order, sorted unless order is what it says (a property chain): the exporter
  // may write the classes of a union in another order than the file did, and it is still the same statement.
  const inline = (term: Term, seen: Set<string>, ordered = false): string => {
    if (term.termType === 'Literal') return JSON.stringify([term.value, term.language, term.datatype.value])
    if (term.termType !== 'BlankNode') return `<${term.value}>`
    if (seen.has(term.value)) return '[…]'
    const inner = new Set([...seen, term.value])
    const items = listItems(store, term)
    if (items) {
      const written = items.map((item) => inline(item, inner))
      return `(${(ordered ? written : written.sort()).join(' ')})`
    }
    return `[${store
      .getQuads(term, null, null, null)
      .map((q) => `<${q.predicate.value}> ${inline(q.object, inner, q.predicate.value === PROPERTY_CHAIN)}`)
      .sort()
      .join('; ')}]`
  }
  const out: { key: string; quads: Quad[] }[] = []
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.subject.termType === 'BlankNode') continue
    const rest = q.object.termType === 'BlankNode' ? describe(store, q.object) : []
    out.push({ key: `<${q.subject.value}> <${q.predicate.value}> ${inline(q.object, new Set(), q.predicate.value === PROPERTY_CHAIN)}`, quads: [q, ...rest] })
  }
  for (const subject of store.getSubjects(null, null, null).filter((s) => s.termType === 'BlankNode' && !referenced.has(s.value))) {
    out.push({ key: inline(subject, new Set()), quads: describe(store, subject) })
  }
  return out
}

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const PROPERTY_CHAIN = 'http://www.w3.org/2002/07/owl#propertyChainAxiom'

/** The items of a well-formed RDF list (rdf:first and rdf:rest only, ending in rdf:nil); undefined for any other node. */
function listItems(store: Store, head: Term): Term[] | undefined {
  const items: Term[] = []
  const seen = new Set<string>()
  let node = head
  while (!(node.termType === 'NamedNode' && node.value === RDF + 'nil')) {
    if (node.termType !== 'BlankNode' || seen.has(node.value)) return undefined
    seen.add(node.value)
    const quads = store.getQuads(node, null, null, null)
    const first = quads.find((q) => q.predicate.value === RDF + 'first')
    const rest = quads.find((q) => q.predicate.value === RDF + 'rest')
    if (quads.length !== 2 || !first || !rest) return undefined
    items.push(first.object)
    node = rest.object
  }
  return items
}

function nTriples(quads: Quad[]): Promise<string> {
  const writer = new Writer({ format: 'N-Triples' })
  writer.addQuads(quads)
  return new Promise((resolve, reject) => writer.end((error, result) => (error ? reject(error) : resolve(result))))
}
