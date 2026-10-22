import { Parser } from 'n3'
import { describe, expect, it } from 'vitest'
import { keptStatementsOf } from './keptStatements'
import { sampleOntology } from './model'
import { cypherString, prefixFor, toCypherScript } from './neo4j'
import { toTurtle } from './owl'
import { importOwl } from './owlImport'

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

  it('embeds the same Turtle as the OWL export of an imported file, with what the canvas does not draw', async () => {
    const source = `@prefix : <http://example.org/pizza#>. @prefix owl: <http://www.w3.org/2002/07/owl#>.
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>. @prefix dct: <http://purl.org/dc/terms/>.
      <http://example.org/pizza> a owl:Ontology; dct:title "Pizza"; owl:versionInfo "1.2".
      :Pizza a owl:Class; rdfs:label "Pizza". :Topping a owl:Class; rdfs:label "Topping".
      :madeIn a owl:ObjectProperty; rdfs:domain :Pizza; rdfs:range <http://example.org/places#Country>.
      :lunch a owl:NamedIndividual, :Pizza.
      [] a owl:AllDisjointClasses; owl:members (:Pizza :Topping).`
    const { iri, nodes, edges, kept } = importOwl(source)
    const imported = { iri, nodes, edges, kept }
    const ontology = await toTurtle({ ...imported, keptStatements: await keptStatementsOf(source, imported) })
    const script = toCypherScript({ iri, ontology, shapes: null })

    const inline = argumentOf(script, 'n10s.onto.import.inline')
    expect(inline).toBe(ontology)
    const triples = new Parser().parse(inline).map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`)
    expect(triples).toContain('http://example.org/places#Country http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#Class')
    expect(triples).toContain('http://example.org/pizza http://www.w3.org/2002/07/owl#versionInfo 1.2')
    expect(triples).toContain('http://example.org/pizza#lunch http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://example.org/pizza#Pizza')
    expect(triples.some((t) => t.endsWith('#AllDisjointClasses'))).toBe(true)
    expect(script).toMatch(/leaves out[^']*\n[^']*individuals, and the ontology header/)
  })

  it('adds a prefix for each of the project\'s other namespaces', () => {
    const script = toCypherScript({ iri: 'http://example.org/pizza#', ontology: '', shapes: null, namespaces: [{ prefix: 'rdl', iri: 'http://example.org/rdl/' }] })
    expect(script).toContain("CALL n10s.nsprefixes.add('rdl', 'http://example.org/rdl/');")
  })
})
