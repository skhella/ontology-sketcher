import { DataFactory, Parser, Writer, type Quad } from 'n3'
import type { KeptStatement } from './model'

const { literal, namedNode, quad } = DataFactory

/** A plain statement kept from an import (named subject, an IRI or literal object), as the Not on the canvas panel edits it. */
export type KeptTriple = { subject: string; predicate: string; object: { kind: 'iri' | 'literal'; value: string; lang?: string; datatype?: string } }

const toQuad = (t: KeptTriple): Quad =>
  quad(
    namedNode(t.subject),
    namedNode(t.predicate),
    t.object.kind === 'iri' ? namedNode(t.object.value) : literal(t.object.value, t.object.lang?.trim() || (t.object.datatype ? namedNode(t.object.datatype) : undefined)),
  )
const parse = (s: KeptStatement) => new Parser({ format: 'N-Triples' }).parse(s.ntriples)
const write = (quads: Quad[]) => new Writer({ format: 'N-Triples' }).quadsToString(quads)

/**
 * The kept statements with one triple changed: `old` taken out (when given) and `next` put in (when given), in the same
 * kept statement, or else with other statements about its subject, or else in a new one `about` a drawn class or property.
 * A statement left empty goes. Undo, autosave and the export all read the result like any kept statement.
 */
export function editKeptTriple(statements: KeptStatement[], old: KeptTriple | undefined, next: KeptTriple | undefined, about?: string): KeptStatement[] {
  const result = [...statements]
  let home = -1
  if (old) {
    const target = toQuad(old)
    home = result.findIndex((s) => parse(s).some((q) => q.equals(target)))
    if (home >= 0) {
      const rest = parse(result[home]).filter((q) => !q.equals(target))
      result[home] = { ...result[home], ntriples: write(rest) }
    }
  }
  if (next) {
    const added = toQuad(next)
    if (home < 0) home = result.findIndex((s) => parse(s).some((q) => q.subject.equals(added.subject)))
    if (home >= 0) result[home] = { ...result[home], ntriples: write([...parse(result[home]), added]) }
    else result.push({ ntriples: write([added]), ...(about && { about }) })
  }
  return result.filter((s) => s.ntriples.trim())
}

/**
 * Names for the panel's editors from projectNames: a name that doesn't read back to its IRI is written as <IRI>, and
 * reading takes <IRI>, a web or urn IRI as it is, or a name projectNames knows; an unknown prefix is not an IRI.
 */
export function editNaming({ name, resolve }: { name: (iri: string) => string; resolve: (text: string) => string | undefined }) {
  const read = (text: string) => {
    const t = text.trim()
    const bracketed = /^<([^<>\s]+)>$/.exec(t)
    if (bracketed) return bracketed[1]
    if (/^(https?|urn):\S+$/i.test(t)) return t
    const iri = resolve(t)
    return iri && iri !== t ? iri : undefined
  }
  return { name: (iri: string) => (read(name(iri)) === iri ? name(iri) : `<${iri}>`), resolve: read }
}

/**
 * The kept statements with an IRI changed from `from` to `to` wherever it appears, and in `about`, so what an import kept
 * about a class or individual follows it when it is renamed (its IRI comes from its label unless set on its own).
 */
export function renameInKept(statements: KeptStatement[], from: string, to: string): KeptStatement[] {
  if (from === to) return statements
  const rename = (t: Quad['subject'] | Quad['predicate'] | Quad['object']) => (t.termType === 'NamedNode' && t.value === from ? namedNode(to) : t)
  return statements.map((s) => {
    if (!s.ntriples.includes(`<${from}>`) && s.about !== from) return s
    const quads = parse(s).map((q) => quad(rename(q.subject) as Quad['subject'], rename(q.predicate) as Quad['predicate'], rename(q.object) as Quad['object']))
    return { ...s, ntriples: write(quads), ...(s.about === from && { about: to }) }
  })
}
