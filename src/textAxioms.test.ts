import { Parser, Store } from 'n3'
import { describe, expect, it } from 'vitest'
import { keptStatementsOf } from './keptStatements'
import { manchester } from './manchester'
import { parseManchester } from './manchesterParse'
import type { Ontology } from './model'
import { toTurtle } from './owl'
import { importOwl } from './owlImport'
import { removeTextAxiom, setTextAxiom, textAxioms } from './textAxioms'

const EX = 'http://example.org/zoo#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const NAMES: Record<string, string> = { Cat: EX + 'Cat', Dog: EX + 'Dog', Pet: EX + 'Pet', 'has part': EX + 'hasPart', likes: EX + 'likes', tom: EX + 'tom', rex: EX + 'rex', age: EX + 'age', 'xsd:integer': XSD + 'integer' }
const resolve = (name: string) => NAMES[name]
const name = (iri: string) => Object.entries(NAMES).find(([, i]) => i === iri)?.[0] ?? iri

/** Reads the text and writes it again. */
function again(text: string): string {
  const { root, quads } = parseManchester(text, resolve)
  return manchester(new Store(quads), root, name)
}

describe('parseManchester', () => {
  it('reads what manchester() writes', () => {
    for (const text of [
      'likes only (Cat or Dog)',
      'Cat and (likes some Dog)',
      'not Cat',
      '{tom, rex}',
      "'has part' some (Cat and not Dog)",
      "'has part' exactly 4 Cat",
      'likes max 2',
      'inverse likes value tom',
      'age value "3"',
      'age some xsd:integer[>= 0, <= 9]',
      'likes Self',
    ]) {
      expect(again(text)).toBe(text)
    }
  })

  it('says what it could not read', () => {
    expect(() => parseManchester('likes only (Cat or Horse)', resolve)).toThrow('Unknown name "Horse"')
    expect(() => parseManchester('likes often Cat', resolve)).toThrow('Unexpected "often"')
    expect(() => parseManchester('likes only (Cat', resolve)).toThrow('Expected ")" at the end')
  })
})

const source = `
  @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix : <${EX}> .
  <http://example.org/zoo> a owl:Ontology .
  :Cat a owl:Class ; rdfs:label "Cat" . :Dog a owl:Class ; rdfs:label "Dog" . :Keeper a owl:Class ; rdfs:label "Keeper" .
  :Pet a owl:Class ; rdfs:label "Pet" ; rdfs:comment "Kept with the axiom." ;
    rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :likes ; owl:allValuesFrom [ a owl:Class ; owl:unionOf ( :Cat :Dog ) ] ] .
  :likes a owl:ObjectProperty ; rdfs:label "likes" ; rdfs:domain :Keeper ; rdfs:range :Pet .
`

async function importAll(): Promise<Ontology> {
  const { iri, nodes, edges, kept } = importOwl(source)
  return { iri, nodes, edges, kept, keptStatements: await keptStatementsOf(source, { iri, nodes, edges, kept }) }
}

describe('text axioms', () => {
  it('lists, edits and removes the axioms of a class that rows cannot hold, and the export follows', async () => {
    const ontology = await importAll()
    const statements = ontology.keptStatements!
    const [axiom] = textAxioms(statements, EX + 'Pet', name)
    expect(axiom).toMatchObject({ kind: 'subClassOf', text: 'likes only (Cat or Dog)' })

    const edited = setTextAxiom(statements, EX + 'Pet', 'equivalentClass', 'likes some Cat', resolve, axiom)
    expect(textAxioms(edited, EX + 'Pet', name).map((a) => [a.kind, a.text])).toEqual([['equivalentClass', 'likes some Cat']])
    const turtle = await toTurtle({ ...ontology, keptStatements: edited })
    expect(turtle).toContain('owl:someValuesFrom :Cat')
    expect(turtle).not.toContain('unionOf')

    const removed = removeTextAxiom(edited, EX + 'Pet', textAxioms(edited, EX + 'Pet', name)[0])
    expect(textAxioms(removed, EX + 'Pet', name)).toEqual([])
    // Whatever else was kept stays, and no blank node is left over.
    const left = new Parser().parse(removed.map((s) => s.ntriples).join(''))
    expect(left.every((q) => q.subject.termType !== 'BlankNode')).toBe(true)
  })

  it('refuses text it cannot read, or a single class, and changes nothing', async () => {
    const { keptStatements } = await importAll()
    expect(() => setTextAxiom(keptStatements!, EX + 'Pet', 'subClassOf', 'likes only Horse', resolve)).toThrow('Unknown name "Horse"')
    expect(() => setTextAxiom(keptStatements!, EX + 'Pet', 'subClassOf', 'Cat', resolve)).toThrow(/single class/)
  })
})
