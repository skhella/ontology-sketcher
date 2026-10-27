import { describe, expect, it } from 'vitest'
import { hiddenItems } from './hiddenItems'
import { keptStatementsOf } from './keptStatements'
import { importOwl } from './owlImport'
import { shortName } from './vocab'

const EX = 'http://example.org/zoo#'

// What the canvas can't show: individuals with values and links, a union axiom, n-ary disjointness, a property
// with no domain or range, a mapping on a class and the ontology header.
const source = `
  @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix skos: <http://www.w3.org/2004/02/skos/core#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix : <${EX}> .
  <http://example.org/zoo> a owl:Ontology ; owl:versionInfo "1.0" .
  :Cat a owl:Class ; rdfs:label "Cat" . :Dog a owl:Class ; rdfs:label "Dog" . :Keeper a owl:Class ; rdfs:label "Keeper" .
  :Pet a owl:Class ; rdfs:label "Pet" ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :likes ; owl:allValuesFrom [ a owl:Class ; owl:unionOf ( :Cat :Dog ) ] ] .
  :likes a owl:ObjectProperty ; rdfs:label "likes" ; rdfs:domain :Keeper ; rdfs:range :Pet .
  :relatedTo a owl:ObjectProperty ; rdfs:label "related to" .
  :age a owl:DatatypeProperty ; rdfs:label "age" ; rdfs:domain :Cat ; rdfs:range xsd:integer .
  [] a owl:AllDisjointClasses ; owl:members ( :Cat :Dog :Keeper ) .
  :Dog skos:closeMatch <http://example.org/other#Hound> .
  :tom a owl:NamedIndividual , :Cat ; rdfs:label "Tom" ; :age 3 ; :likes :rex .
  :rex a owl:NamedIndividual , :Dog ; rdfs:label "Rex" .
`

async function hidden() {
  const result = importOwl(source)
  const statements = await keptStatementsOf(source, { iri: result.iri, nodes: result.nodes, edges: result.edges, kept: result.kept })
  const labels = new Map(result.nodes.map((n) => [EX + n.data.label, n.data.label]))
  return hiddenItems(statements, result.kept, (iri) => labels.get(iri) ?? shortName(iri))
}

describe('hiddenItems', () => {
  it('lists kept individuals by class, with their values and links by name', () => {
    // Individuals are drawn as boxes (see individuals.test.ts); a statement kept about one, e.g. punned with a class, is listed.
    const ntriples = [
      `<${EX}tom> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#NamedIndividual> .`,
      `<${EX}tom> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${EX}Cat> .`,
      `<${EX}tom> <http://www.w3.org/2000/01/rdf-schema#label> "Tom" .`,
      `<${EX}tom> <${EX}likes> <${EX}rex> .`,
      `<${EX}tom> <${EX}age> "3"^^<http://www.w3.org/2001/XMLSchema#integer> .`,
      `<${EX}rex> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#NamedIndividual> .`,
      `<${EX}rex> <http://www.w3.org/2000/01/rdf-schema#label> "Rex" .`,
    ]
    const { individuals } = hiddenItems([{ ntriples: ntriples.slice(0, 5).join('\n') }, { ntriples: ntriples.slice(5).join('\n') }], [], shortName)
    expect(individuals.map((g) => [g.typeName, g.entries.map((e) => e.name)])).toEqual([
      ['Cat', ['Tom']],
      ['No class', ['Rex']],
    ])
    const tom = individuals[0].entries[0]
    expect(tom.iri).toBe(EX + 'tom')
    expect(tom.lines).toContainEqual({ predicate: 'likes', value: 'Rex', iri: EX + 'rex' })
    expect(tom.lines).toContainEqual({ predicate: 'age', value: '3 (xsd:integer)' })
  })

  it('has no individuals to list once an import draws them', async () => {
    expect((await hidden()).individuals).toEqual([])
  })

  it('writes class axioms the inspector cannot show in Manchester syntax', async () => {
    expect((await hidden()).axioms).toEqual([{ about: EX + 'Pet', name: 'Pet', text: 'SubClassOf likes only (Cat or Dog)' }])
  })

  it('lists properties drawn nowhere with what they lack, and the other statements', async () => {
    const { properties, aboutDrawn, other, count } = await hidden()
    expect(properties).toEqual([
      { iri: EX + 'relatedTo', kind: 'object', name: 'related to', lines: [{ predicate: 'domain', value: 'none' }, { predicate: 'range', value: 'none' }] },
    ])
    expect(aboutDrawn).toEqual([{ iri: EX + 'Dog', name: 'Dog', lines: [{ predicate: 'skos:closeMatch', value: 'Hound', iri: 'http://example.org/other#Hound' }] }])
    expect(other.map((e) => e.name).sort()).toEqual(['Disjoint classes', 'zoo'])
    expect(other.find((e) => e.name === 'Disjoint classes')!.lines).toContainEqual({ predicate: 'owl:members', value: 'Cat, Dog, Keeper' })
    expect(count).toBe(1 + 1 + 1 + 2)
  })
})
