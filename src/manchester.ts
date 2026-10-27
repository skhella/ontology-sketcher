import type { Store, Term } from 'n3'
import { OWL, RDF } from './vocab'

const XSD_FACETS: Record<string, string> = {
  minInclusive: '>=',
  maxInclusive: '<=',
  minExclusive: '>',
  maxExclusive: '<',
  length: 'length',
  minLength: 'minLength',
  maxLength: 'maxLength',
  pattern: 'pattern',
}

/**
 * A class expression (or data range) written in Manchester syntax, as Protégé shows it: `hasPart some Pump`,
 * `uses only (GuideWord or Criteria)`, `not Pump`, `{red, green}`, `xsd:integer[>= 0]`.
 * `name` writes a named term; a blank node it can't read is written as `[…]`.
 */
export function manchester(store: Store, term: Term, name: (iri: string) => string): string {
  return write(term, new Set(), false)

  function write(t: Term, seen: Set<string>, nested: boolean): string {
    if (t.termType === 'NamedNode') return quoteName(name(t.value))
    if (t.termType === 'Literal') return JSON.stringify(t.value)
    if (t.termType !== 'BlankNode' || seen.has(t.value)) return '[…]'
    const inner = new Set([...seen, t.value])
    const one = (p: string) => store.getObjects(t, p, null)[0]
    const sub = (x: Term) => write(x, inner, true)
    const group = (s: string) => (nested ? `(${s})` : s)

    for (const [predicate, word] of [
      [OWL + 'unionOf', 'or'],
      [OWL + 'intersectionOf', 'and'],
    ] as const) {
      const list = one(predicate)
      const items = list && listItems(store, list)
      if (items) return group(items.map(sub).join(` ${word} `))
    }
    const complement = one(OWL + 'complementOf') ?? one(OWL + 'datatypeComplementOf')
    if (complement) return `not ${sub(complement)}`
    const oneOf = one(OWL + 'oneOf')
    const members = oneOf && listItems(store, oneOf)
    if (members) return `{${members.map((m) => write(m, inner, false)).join(', ')}}`
    const onDatatype = one(OWL + 'onDatatype')
    const facets = one(OWL + 'withRestrictions')
    const facetList = facets && listItems(store, facets)
    if (onDatatype && facetList) {
      const written = facetList.flatMap((f) =>
        store.getQuads(f, null, null, null).map((q) => `${XSD_FACETS[q.predicate.value.replace(/^.*#/, '')] ?? name(q.predicate.value)} ${q.object.value}`),
      )
      return `${name(onDatatype.value)}[${written.join(', ')}]`
    }

    const property = one(OWL + 'onProperty')
    if (property) {
      const p = sub(property) // a blank one is `inverse q`, see below
      const some = one(OWL + 'someValuesFrom')
      if (some) return group(`${p} some ${sub(some)}`)
      const only = one(OWL + 'allValuesFrom')
      if (only) return group(`${p} only ${sub(only)}`)
      const value = one(OWL + 'hasValue')
      if (value) return group(`${p} value ${value.termType === 'Literal' ? JSON.stringify(value.value) : sub(value)}`)
      if (one(OWL + 'hasSelf')) return group(`${p} Self`)
      const filler = one(OWL + 'onClass') ?? one(OWL + 'onDataRange')
      for (const [predicate, word] of [
        ['minCardinality', 'min'],
        ['maxCardinality', 'max'],
        ['cardinality', 'exactly'],
        ['minQualifiedCardinality', 'min'],
        ['maxQualifiedCardinality', 'max'],
        ['qualifiedCardinality', 'exactly'],
      ] as const) {
        const n = one(OWL + predicate)
        if (n) return group(`${p} ${word} ${n.value}${filler && /qualified/i.test(predicate) ? ` ${sub(filler)}` : ''}`)
      }
    }
    const inverseOf = one(OWL + 'inverseOf')
    if (inverseOf) return `inverse ${sub(inverseOf)}`
    return '[…]'
  }
}

/** A name as Manchester syntax writes it: in single quotes when it has a space or other character a name can't, e.g. 'has part'. */
export function quoteName(name: string): string {
  return /^[\p{L}\p{N}_:.#/-]+$/u.test(name) && !KEYWORDS.has(name) ? name : `'${name.replace(/'/g, "\\'")}'`
}

export const KEYWORDS = new Set(['and', 'or', 'not', 'some', 'only', 'value', 'min', 'max', 'exactly', 'Self', 'inverse', 'that'])

/** The items of a well-formed RDF list; undefined for any other node. */
export function listItems(store: Store, head: Term): Term[] | undefined {
  const items: Term[] = []
  const seen = new Set<string>()
  let node = head
  while (!(node.termType === 'NamedNode' && node.value === RDF + 'nil')) {
    if (node.termType !== 'BlankNode' || seen.has(node.value)) return undefined
    seen.add(node.value)
    const first = store.getObjects(node, RDF + 'first', null)[0]
    const rest = store.getObjects(node, RDF + 'rest', null)[0]
    if (!first || !rest) return undefined
    items.push(first)
    node = rest
  }
  return items
}
