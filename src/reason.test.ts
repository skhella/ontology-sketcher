import { describe, expect, it } from 'vitest'
import { sampleOntology } from './model'
import { toTurtle } from './owl'
import { inferredArrows, inferSuperclasses } from './reason'

const Z = 'http://example.org/zoo#'
const head = `@prefix : <${Z}> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n`
const zoo =
  head +
  `:Animal a owl:Class ; rdfs:label "Animal" . :Mammal a owl:Class ; rdfs:label "Mammal" ; rdfs:subClassOf :Animal .
   :Cat a owl:Class ; rdfs:label "Cat" ; rdfs:subClassOf :Mammal .
   :Keeper a owl:Class ; rdfs:label "Keeper" . :Person a owl:Class ; rdfs:label "Person" .
   :feeds a owl:ObjectProperty ; rdfs:label "feeds" ; rdfs:domain :Keeper ; rdfs:range :Animal .
   :cares a owl:ObjectProperty ; rdfs:label "cares for" ; rdfs:subPropertyOf :feeds .
   :fedBy a owl:ObjectProperty ; rdfs:label "fed by" ; owl:inverseOf :feeds .
   :Vet a owl:Class ; rdfs:label "Vet" ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :cares ; owl:someValuesFrom :Animal ] .
   :Lion a owl:Class ; rdfs:label "Lion" ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :fedBy ; owl:minQualifiedCardinality 1 ; owl:onClass :Keeper ] .
   :Puma a owl:Class ; rdfs:label "Puma" ; owl:equivalentClass :Cougar . :Cougar a owl:Class ; rdfs:label "Cougar" ; rdfs:subClassOf :Cat .
   :Staff a owl:Class ; rdfs:label "Staff" ; owl:equivalentClass [ owl:intersectionOf ( :Person :Keeper ) ] .
   :Visitor a owl:Class ; rdfs:label "Visitor" ; rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :feeds ; owl:allValuesFrom :Animal ] .`

describe('inferSuperclasses', () => {
  const { inferred } = inferSuperclasses(zoo, Z)
  const of = (c: string) => (inferred.get(Z + c) ?? []).map((i) => [i.sup.replace(Z, ''), i.because])

  it('leaves out what the stated hierarchy already says, however many steps up', () => {
    expect(of('Cat')).toEqual([])
  })

  it('infers a superclass from a property domain, through a super-property', () => {
    expect(of('Vet')).toEqual([['Keeper', ['Vet subClassOf cares for some Animal', 'cares for subPropertyOf feeds', 'feeds domain Keeper']]])
  })

  it("uses an inverse's range as a domain, for at-least-one restrictions", () => {
    expect(of('Lion')).toEqual([['Animal', ['Lion subClassOf fed by min 1 Keeper', 'fed by inverse of feeds', 'feeds range Animal']]])
  })

  it('follows equivalences both ways and the parts of an intersection', () => {
    expect(of('Puma').map(([c]) => c)).toEqual(['Cougar', 'Cat', 'Mammal', 'Animal'])
    expect(of('Cougar').map(([c]) => c)).toEqual(['Puma'])
    expect(of('Puma')[3]).toEqual(['Animal', ['Puma equivalentTo Cougar', 'Cougar subClassOf Cat', 'Cat subClassOf Mammal', 'Mammal subClassOf Animal']])
    expect(of('Staff')).toEqual([
      ['Person', ['Staff equivalentTo Person and Keeper']],
      ['Keeper', ['Staff equivalentTo Person and Keeper']],
    ])
  })

  it('draws nothing from a universal restriction, which holds even with no values', () => {
    expect(of('Visitor')).toEqual([])
  })

  it('finds nothing to add to the sample', async () => {
    expect(inferSuperclasses(await toTurtle(sampleOntology), 'http://example.org/pizza#').inferred.size).toBe(0)
  })
})

describe('inferredArrows', () => {
  it('keeps only the most specific inferred superclasses', () => {
    const reasoning = inferSuperclasses(zoo, Z)
    expect(inferredArrows(reasoning, Z + 'Cat')).toEqual([])
    expect(inferredArrows(reasoning, Z + 'Puma').map((i) => i.sup.replace(Z, ''))).toEqual(['Cougar'])
    expect(inferredArrows(reasoning, Z + 'Lion').map((i) => i.sup.replace(Z, ''))).toEqual(['Animal'])
  })
})
