import { Parser, Store, Writer, type Quad, type Term } from 'n3'

/** A parsed Turtle file: its triples and the prefixes it declared, to write parts of it back in the same style. */
export type TurtleFile = { store: Store; prefixes: Record<string, string> }

/** Parses Turtle, resolving relative IRIs against `base`. Throws the parser's error when it does not parse. */
export function parseTurtle(text: string, base: string): TurtleFile {
  const prefixes: Record<string, string> = {}
  const quads = new Parser({ baseIRI: base }).parse(text, null, (prefix, iri) => {
    prefixes[prefix] = iri.value
  })
  return { store: new Store(quads), prefixes }
}

/**
 * The triples about `subject` and, recursively, about the blank nodes they point at (nested
 * descriptions and RDF lists), so the subject can be written out on its own without losing anything.
 * `follow` also takes in named nodes it accepts, such as shapes a shape refers to by IRI.
 */
export function describe(store: Store, subject: Term, follow: (term: Term) => boolean = () => false, seen = new Set<string>()): Quad[] {
  if (seen.has(subject.id)) return []
  seen.add(subject.id)
  const quads = store.getQuads(subject, null, null, null)
  const deeper = quads.filter((q) => q.object.termType === 'BlankNode' || (q.object.termType === 'NamedNode' && follow(q.object)))
  return [...quads, ...deeper.flatMap((q) => describe(store, q.object, follow, seen))]
}

/** Writes triples as Turtle with the given prefixes. */
export function writeTurtle(quads: Quad[], prefixes: Record<string, string>): Promise<string> {
  const writer = new Writer({ prefixes })
  writer.addQuads(quads)
  return new Promise((resolve, reject) => writer.end((error, result) => (error ? reject(error) : resolve(result))))
}
