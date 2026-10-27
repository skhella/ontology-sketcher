import { describe, expect, it } from 'vitest'
import { importIntoProject, LIBRARY } from './library'
import { toTurtle } from './owl'

const ZOO = 'http://example.org/zoo#'
const zoo = `@prefix : <${ZOO}> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix dcterms: <http://purl.org/dc/terms/> .
  <http://example.org/zoo> a owl:Ontology ; dcterms:title "Zoo" ; owl:versionInfo "1.0" .
  :Animal a owl:Class ; rdfs:label "Animal" .
  :Lion a owl:Class ; rdfs:label "Big cat" ; rdfs:subClassOf :Animal .
  :eats a owl:ObjectProperty ; rdfs:label "eats" ; rdfs:domain :Animal ; rdfs:range :Animal .
  :weight a owl:DatatypeProperty ; rdfs:domain :Animal .`

describe('importIntoProject', () => {
  it('keeps the project IRI and the imported IRIs, and leaves out the imported ontology header', async () => {
    const project = { iri: 'http://example.org/plant#', namespaces: [{ prefix: 'zoo', iri: 'http://example.org/other#' }] }
    const { result, statements } = await importIntoProject(zoo, project, 'zoo')
    expect(result.iri).toBe(project.iri)
    // zoo is taken by another namespace of the project, so the imported one gets a prefix of its own.
    expect(result.namespaces.map((n) => n.iri)).toEqual([ZOO])
    expect(result.namespaces[0].prefix).not.toBe('zoo')
    const turtle = await toTurtle({ iri: project.iri, nodes: result.nodes, edges: result.edges, kept: result.kept, keptStatements: statements, namespaces: [...project.namespaces, ...result.namespaces] })
    for (const iri of ['Animal', 'Lion', 'eats', 'weight']) expect(turtle).toContain(`${result.namespaces[0].prefix}:${iri}`)
    expect(turtle).not.toContain('versionInfo')
    expect(turtle).not.toContain('<http://example.org/zoo>')
    expect(turtle).toContain('<http://example.org/plant> a owl:Ontology')
  })

  it('lists only Turtle sources', () => {
    for (const entry of LIBRARY) expect(entry.url).toMatch(/\.ttl$/)
  })
})
