import { DataFactory, type Quad, type Quad_Object } from 'n3'
import { KEYWORDS } from './manchester'
import { OWL, RDF, RDFS, XSD } from './vocab'

const { blankNode, literal, namedNode, quad } = DataFactory

const FACETS: Record<string, string> = {
  '>=': 'minInclusive',
  '<=': 'maxInclusive',
  '>': 'minExclusive',
  '<': 'maxExclusive',
  length: 'length',
  minLength: 'minLength',
  maxLength: 'maxLength',
  pattern: 'pattern',
}

/** `quoted` marks a name written in single quotes, which is never a keyword. */
type Token = { kind: 'name' | 'string' | 'number' | 'punct'; text: string; lang?: string; quoted?: boolean }

/**
 * Reads a class expression in Manchester syntax, as `manchester()` writes it, into triples: `uses only (A or B)`,
 * `hasPart some (Pump and not Valve)`, `{red, green}`, `leg exactly 4 Leg`, `age some xsd:integer[>= 0]`.
 * `resolve` turns a name (a label, prefix:local or a full IRI in <>) into an IRI, or undefined when it knows none.
 * Returns the expression's root (a named class or a blank node) and the triples under it; throws with a short
 * message on text it can't read.
 */
export function parseManchester(text: string, resolve: (name: string) => string | undefined): { root: Quad_Object; quads: Quad[] } {
  const tokens = tokenize(text)
  let at = 0
  const quads: Quad[] = []
  const peek = () => tokens[at]
  const next = () => tokens[at++]
  const isWord = (t: Token | undefined, word: string) => t?.kind === 'name' && !t.quoted && t.text === word
  const keyword = (t: Token) => !t.quoted && KEYWORDS.has(t.text)
  const expect = (text: string) => {
    const t = next()
    if (t?.text !== text) throw new Error(`Expected "${text}"${t ? ` before "${t.text}"` : ' at the end'}`)
  }
  const iriOf = (t: Token | undefined): string => {
    if (!t || t.kind !== 'name' || keyword(t)) throw new Error(t ? `Expected a name, not "${t.text}"` : 'Expected a name at the end')
    const iri = t.text.startsWith('<') ? t.text.slice(1, -1) : resolve(t.text)
    if (!iri) throw new Error(`Unknown name "${t.text}"`)
    return iri
  }
  const node = (parts: [string, Quad_Object][]) => {
    const b = blankNode()
    for (const [p, o] of parts) quads.push(quad(b, namedNode(p), o))
    return b
  }
  const list = (items: Quad_Object[]): Quad_Object => {
    let rest: Quad_Object = namedNode(RDF + 'nil')
    for (const item of [...items].reverse()) rest = node([[RDF + 'first', item], [RDF + 'rest', rest]])
    return rest
  }
  const startsPrimary = (t: Token | undefined) => !!t && ((t.kind === 'name' && !keyword(t)) || t.text === '(' || t.text === '{' || isWord(t, 'not') || isWord(t, 'inverse'))
  const literalOf = (t: Token) => {
    if (t.kind === 'string') return literal(t.text, t.lang)
    if (t.kind === 'number') return literal(t.text, namedNode(XSD + (t.text.includes('.') ? 'decimal' : 'integer')))
    throw new Error(`Expected a value, not "${t.text}"`)
  }

  function expression(): Quad_Object {
    const parts = [conjunction()]
    while (isWord(peek(), 'or')) {
      next()
      parts.push(conjunction())
    }
    return parts.length === 1 ? parts[0] : node([[RDF + 'type', namedNode(OWL + 'Class')], [OWL + 'unionOf', list(parts)]])
  }

  function conjunction(): Quad_Object {
    const parts = [primary()]
    while (isWord(peek(), 'and') || isWord(peek(), 'that')) {
      next()
      parts.push(primary())
    }
    return parts.length === 1 ? parts[0] : node([[RDF + 'type', namedNode(OWL + 'Class')], [OWL + 'intersectionOf', list(parts)]])
  }

  function primary(): Quad_Object {
    const t = peek()
    if (!t) throw new Error('Expected a class at the end')
    if (isWord(t, 'not')) {
      next()
      return node([[RDF + 'type', namedNode(OWL + 'Class')], [OWL + 'complementOf', primary()]])
    }
    if (t.text === '(') {
      next()
      const inner = expression()
      expect(')')
      return inner
    }
    if (t.text === '{') {
      next()
      const members: Quad_Object[] = [namedNode(iriOf(next()))]
      while (peek()?.text === ',') {
        next()
        members.push(namedNode(iriOf(next())))
      }
      expect('}')
      return node([[RDF + 'type', namedNode(OWL + 'Class')], [OWL + 'oneOf', list(members)]])
    }
    // A property (or `inverse p`) followed by a quantifier is a restriction; a name alone is a class or datatype.
    let property: Quad_Object
    if (isWord(t, 'inverse')) {
      next()
      property = node([[OWL + 'inverseOf', namedNode(iriOf(next()))]])
    } else {
      const iri = iriOf(next())
      const quantifier = peek()
      if (!quantifier || quantifier.kind !== 'name' || quantifier.quoted || !['some', 'only', 'value', 'min', 'max', 'exactly', 'Self'].includes(quantifier.text)) {
        return peek()?.text === '[' ? facets(iri) : namedNode(iri)
      }
      property = namedNode(iri)
    }
    const word = next()
    const restriction: [string, Quad_Object][] = [
      [RDF + 'type', namedNode(OWL + 'Restriction')],
      [OWL + 'onProperty', property],
    ]
    if (word?.text === 'some' || word?.text === 'only') return node([...restriction, [OWL + (word.text === 'some' ? 'someValuesFrom' : 'allValuesFrom'), primary()]])
    if (word?.text === 'Self') return node([...restriction, [OWL + 'hasSelf', literal('true', namedNode(XSD + 'boolean'))]])
    if (word?.text === 'value') {
      const v = next()
      if (!v) throw new Error('Expected a value at the end')
      return node([...restriction, [OWL + 'hasValue', v.kind === 'name' ? namedNode(iriOf(v)) : literalOf(v)]])
    }
    if (word?.text === 'min' || word?.text === 'max' || word?.text === 'exactly') {
      const n = next()
      if (n?.kind !== 'number' || !/^\d+$/.test(n.text)) throw new Error(`Expected a whole number after "${word.text}"`)
      const count = literal(n.text, namedNode(XSD + 'nonNegativeInteger'))
      const name = { min: 'minCardinality', max: 'maxCardinality', exactly: 'cardinality' }[word.text]
      if (!startsPrimary(peek())) return node([...restriction, [OWL + name, count]])
      const filler = primary()
      const dataRange = filler.termType === 'NamedNode' && (filler.value.startsWith(XSD) || filler.value === RDFS + 'Literal')
      const qualified = name.replace(/^(min|max)Cardinality$/, '$1QualifiedCardinality').replace(/^cardinality$/, 'qualifiedCardinality')
      return node([...restriction, [OWL + qualified, count], [OWL + (dataRange ? 'onDataRange' : 'onClass'), filler]])
    }
    throw new Error(`Expected some, only, value, min, max, exactly or Self${word ? `, not "${word.text}"` : ''}`)
  }

  // A datatype restricted by facets, e.g. xsd:integer[>= 0, <= 10].
  function facets(datatype: string): Quad_Object {
    expect('[')
    const restrictions: Quad_Object[] = []
    do {
      if (peek()?.text === ',') next()
      const facet = next()
      const value = next()
      if (!facet || !FACETS[facet.text] || !value) throw new Error('Expected a facet such as >= 0')
      restrictions.push(node([[XSD + FACETS[facet.text], literalOf(value)]]))
    } while (peek()?.text === ',')
    expect(']')
    return node([[RDF + 'type', namedNode(RDFS + 'Datatype')], [OWL + 'onDatatype', namedNode(datatype)], [OWL + 'withRestrictions', list(restrictions)]])
  }

  const root = expression()
  if (at < tokens.length) throw new Error(`Unexpected "${tokens[at].text}"`)
  return { root, quads }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\s+|(<[^>\s]*>)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"(?:@([A-Za-z0-9-]+))?|(-?\d+(?:\.\d+)?)(?![\p{L}_:])|(>=|<=|[()[\]{},<>])|([\p{L}\p{N}_:.#/-]+)/uy
  let at = 0
  while (at < text.length) {
    pattern.lastIndex = at
    const m = pattern.exec(text)
    if (!m) throw new Error(`Can't read "${text.slice(at, at + 12)}"`)
    at = pattern.lastIndex
    if (m[1]) tokens.push({ kind: 'name', text: m[1] })
    else if (m[2] !== undefined) tokens.push({ kind: 'name', text: m[2].replace(/\\(.)/g, '$1'), quoted: true })
    else if (m[3] !== undefined) tokens.push({ kind: 'string', text: m[3].replace(/\\(.)/g, '$1'), ...(m[4] && { lang: m[4] }) })
    else if (m[5]) tokens.push({ kind: 'number', text: m[5] })
    else if (m[6]) tokens.push({ kind: 'punct', text: m[6] })
    else if (m[7]) tokens.push({ kind: 'name', text: m[7] })
  }
  return tokens
}
