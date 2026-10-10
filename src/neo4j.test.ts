import { Parser } from 'n3'
import { describe, expect, it } from 'vitest'
import { sampleOntology } from './model'
import { cypherString, prefixFor, toCypherScript } from './neo4j'
import { toTurtle } from './owl'

/** Reads a Cypher single-quoted literal back, the way Neo4j does for the escapes cypherString writes. */
function unquote(literal: string): string {
  expect(literal.startsWith("'") && literal.endsWith("'")).toBe(true)
  return literal.slice(1, -1).replace(/\\(.)/g, '$1')
}

/** The string literal passed to a procedure call in the script. */
function argumentOf(script: string, procedure: string): string {
  const match = script.match(new RegExp(`CALL ${procedure.replace(/\./g, '\\.')}\\(('(?:[^'\\\\]|\\\\.)*')`))
  expect(match, procedure).not.toBeNull()
  return unquote(match![1])
}

describe('cypherString', () => {
  it('escapes backslashes and quotes so the text comes back unchanged', () => {
    const text = `:A rdfs:label "It's a \\"pizza\\"; see http://x.org//y"@en.\n:B rdfs:comment """two\nlines \\\\ ok""".`
    const literal = cypherString(text)
    expect(literal.slice(1, -1)).not.toMatch(/(^|[^\\])(\\\\)*'/)
    expect(unquote(literal)).toBe(text)
  })
})

describe('prefixFor', () => {
  it('takes the last segment of the ontology IRI', () => {
    expect(prefixFor('http://example.org/pizza#')).toBe('pizza')
    expect(prefixFor('https://w3id.org/my-onto/')).toBe('myonto')
    expect(prefixFor('urn:x:Food')).toBe('food')
  })

  it('falls back to onto when nothing usable is left', () => {
    expect(prefixFor('http://example.org/2024/')).toBe('onto')
    expect(prefixFor('')).toBe('onto')
  })
})

describe('toCypherScript', () => {
  it('sets up n10s and imports the ontology Turtle unchanged', async () => {
    const ontology = await toTurtle(sampleOntology)
    const script = toCypherScript({ iri: sampleOntology.iri, ontology, shapes: null })

    expect(script).toContain('CREATE CONSTRAINT n10s_unique_uri IF NOT EXISTS FOR (r:Resource) REQUIRE r.uri IS UNIQUE;')
    expect(script).toContain('CALL n10s.graphconfig.init({')
    expect(script).toContain("CALL n10s.nsprefixes.add('pizza', 'http://example.org/pizza#');")
    expect(script.indexOf('graphconfig.init')).toBeLessThan(script.indexOf('onto.import'))

    const imported = argumentOf(script, 'n10s.onto.import.inline')
    expect(imported).toBe(ontology)
    expect(() => new Parser().parse(imported)).not.toThrow()
    expect(script).not.toContain('n10s.validation.shacl.import')
  })

  it('imports the shapes after the ontology when there are any', () => {
    const shapes = '@prefix sh: <http://www.w3.org/ns/shacl#>.\n<http://example.org/s> a sh:NodeShape.\n'
    const script = toCypherScript({ iri: 'http://example.org/pizza#', ontology: '', shapes })

    expect(argumentOf(script, 'n10s.validation.shacl.import.inline')).toBe(shapes)
    expect(script.indexOf('onto.import')).toBeLessThan(script.indexOf('shacl.import'))
  })
})
