import { Parser, type Quad, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { keptStatementsOf } from './keptStatements'
import type { Ontology } from './model'
import { toTurtle } from './owl'
import { importOwl } from './owlImport'

const EX = 'http://example.org/zoo#'

// What the canvas can't show: union and intersection axioms, n-ary disjointness, keys, property chains and
// equivalences, individuals, a datatype definition, the ontology header and an annotation property's label.
const source = `
  @prefix owl: <http://www.w3.org/2002/07/owl#> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
  @prefix : <${EX}> .
  <http://example.org/zoo> a owl:Ontology ; rdfs:label "Zoo"@en ; owl:versionInfo "1.0" ; owl:imports <http://example.org/animals> .
  :Animal a owl:Class . :Cat a owl:Class ; rdfs:label "Cat"@en . :Dog a owl:Class ; rdfs:label "Dog"@en .
  :Pet a owl:Class ; rdfs:label "Pet"@en ; owl:equivalentClass [ a owl:Class ; owl:unionOf ( :Cat :Dog ) ] .
  :Cat rdfs:subClassOf [ a owl:Class ; owl:intersectionOf ( :Animal [ a owl:Restriction ; owl:onProperty :chases ; owl:someValuesFrom :Animal ] ) ] .
  [] a owl:AllDisjointClasses ; owl:members ( :Cat :Dog :Pet ) .
  :Animal owl:hasKey ( :chases ) .
  :chases a owl:ObjectProperty ; rdfs:domain :Animal ; rdfs:range :Animal ; owl:propertyChainAxiom ( :chases :chases ) .
  :hunts a owl:ObjectProperty ; rdfs:domain :Animal ; rdfs:range :Animal ; owl:equivalentProperty :chases .
  :tom a owl:NamedIndividual , :Cat ; :chases :rex . :rex a :Dog ; owl:sameAs :rexy .
  :age a rdfs:Datatype ; owl:equivalentClass [ a rdfs:Datatype ; owl:onDatatype xsd:integer ; owl:withRestrictions ( [ xsd:minInclusive 0 ] ) ] .
  :nickname a owl:AnnotationProperty ; rdfs:label "nickname"@en .
  :Cat :nickname "kitty" .
`

/** Triples as sorted lines, blank nodes written out inline, so graphs compare whatever their blank nodes are called. */
function canonical(turtle: string): string[] {
  const quads = new Parser().parse(turtle)
  const bySubject = new Map<string, Quad[]>()
  for (const q of quads) bySubject.set(q.subject.value, [...(bySubject.get(q.subject.value) ?? []), q])
  const referenced = new Set(quads.filter((q) => q.object.termType === 'BlankNode').map((q) => q.object.value))
  const term = (t: Term): string =>
    t.termType === 'BlankNode'
      ? `[${(bySubject.get(t.value) ?? []).map((q) => `${q.predicate.value} ${term(q.object)}`).sort().join('; ')}]`
      : t.termType === 'Literal'
        ? JSON.stringify([t.value, t.language, t.datatype.value])
        : t.value
  return quads
    .filter((q) => q.subject.termType !== 'BlankNode' || !referenced.has(q.subject.value))
    .map((q) => `${term(q.subject)} ${q.predicate.value} ${term(q.object)}`)
    .filter((line, i, all) => all.indexOf(line) === i)
    .sort()
}

async function importAll(text: string): Promise<Ontology> {
  const { iri, nodes, edges, kept } = importOwl(text)
  const imported = { iri, nodes, edges, kept }
  return { ...imported, keptStatements: await keptStatementsOf(text, imported) }
}

describe('keptStatementsOf', () => {
  it('keeps every statement the canvas does not show, so the export gives back the whole file', async () => {
    const ontology = await importAll(source)
    const back = canonical(await toTurtle(ontology))
    expect(canonical(source).filter((line) => !back.includes(line))).toEqual([])
    // Nothing is made up: Animal had no label and gets none.
    expect(back.filter((line) => line.startsWith(EX + 'Animal http://www.w3.org/2000/01/rdf-schema#label'))).toEqual([])
  })

  it('keeps nothing for what the canvas shows, and gives the same file when imported again', async () => {
    const turtle = await toTurtle(await importAll(source))
    const again = await importAll(turtle)
    expect(canonical(await toTurtle(again))).toEqual(canonical(turtle))
    const plain = await importAll(`
      @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix : <${EX}> .
      <http://example.org/zoo> a owl:Ontology . :Cat a owl:Class ; rdfs:subClassOf :Animal . :Animal a owl:Class .`)
    expect(plain.keptStatements).toEqual([])
  })

  it('keeps nothing for a union the export writes in another order, so the domain is written once', async () => {
    for (const classes of [':Cat :Dog', ':Dog :Cat']) {
      const ontology = await importAll(`
        @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix : <${EX}> .
        <http://example.org/zoo> a owl:Ontology . :Cat a owl:Class . :Dog a owl:Class .
        :age a owl:DatatypeProperty ; rdfs:domain [ a owl:Class ; owl:unionOf ( ${classes} ) ] ; rdfs:range xsd:integer .`)
      expect(ontology.keptStatements).toEqual([])
      const domains = new Parser().parse(await toTurtle(ontology)).filter((q) => q.subject.value === EX + 'age' && q.predicate.value.endsWith('#domain'))
      expect(domains).toHaveLength(1)
    }
  })

  it('writes typed and IRI annotation values back as they were, not as a second text value', async () => {
    const ontology = await importAll(`
      @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix : <${EX}> .
      <http://example.org/zoo> a owl:Ontology . :Cat a owl:Class ; owl:deprecated true ; :since "2026-10-27"^^xsd:date ; :source <http://example.org/book> .
      :since a owl:AnnotationProperty . :source a owl:AnnotationProperty .`)
    const cat = ontology.nodes.find((n) => n.data.label === 'Cat')!
    expect(cat.data.annotations).toEqual([
      { property: 'http://www.w3.org/2002/07/owl#deprecated', value: 'true', datatype: 'http://www.w3.org/2001/XMLSchema#boolean' },
      { property: EX + 'since', value: '2026-10-27', datatype: 'http://www.w3.org/2001/XMLSchema#date' },
      { property: EX + 'source', value: 'http://example.org/book', iri: true },
    ])
    const about = new Parser().parse(await toTurtle(ontology)).filter((q) => q.subject.value === EX + 'Cat' && !q.predicate.value.endsWith('#type'))
    expect(about.map((q) => [q.predicate.value, q.object.termType, q.object.termType === 'Literal' ? q.object.datatype.value : ''])).toEqual([
      ['http://www.w3.org/2002/07/owl#deprecated', 'Literal', 'http://www.w3.org/2001/XMLSchema#boolean'],
      [EX + 'since', 'Literal', 'http://www.w3.org/2001/XMLSchema#date'],
      [EX + 'source', 'NamedNode', ''],
    ])
  })

  it('leaves out statements about a class once it is gone', async () => {
    const ontology = await importAll(source)
    expect(ontology.keptStatements!.find((s) => s.about === EX + 'Pet')?.ntriples).toContain('unionOf')
    const withoutPet = { ...ontology, nodes: ontology.nodes.filter((n) => n.data.label !== 'Pet') }
    const back = canonical(await toTurtle(withoutPet))
    expect(back.some((line) => line.startsWith(EX + 'Pet '))).toBe(false)
    // Statements about no single class, such as the disjointness of all three, stay.
    expect(back.some((line) => line.includes('AllDisjointClasses'))).toBe(true)
  })
})
