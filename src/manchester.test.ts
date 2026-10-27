import { Parser, Store } from 'n3'
import { describe, expect, it } from 'vitest'
import { manchester } from './manchester'

const EX = 'http://example.org/zoo#'
const name = (iri: string) => iri.replace(/^.*[#/]/, '')

function expression(turtle: string): string {
  const store = new Store(
    new Parser().parse(`@prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix : <${EX}> . ${turtle}`),
  )
  const [axiom] = store.getQuads(EX + 'X', null, null, null)
  return manchester(store, axiom.object, name)
}

describe('manchester', () => {
  it('writes restrictions, unions and intersections as Protégé shows them', () => {
    expect(expression(':X :is [ a owl:Restriction ; owl:onProperty :uses ; owl:allValuesFrom [ a owl:Class ; owl:unionOf ( :GuideWord :Criteria ) ] ] .')).toBe(
      'uses only (GuideWord or Criteria)',
    )
    expect(expression(':X :is [ a owl:Class ; owl:intersectionOf ( :Animal [ a owl:Restriction ; owl:onProperty :chases ; owl:someValuesFrom :Cat ] ) ] .')).toBe(
      'Animal and (chases some Cat)',
    )
    expect(expression(':X :is [ a owl:Class ; owl:complementOf :Cat ] .')).toBe('not Cat')
    expect(expression(':X :is [ a owl:Class ; owl:oneOf ( :red :green ) ] .')).toBe('{red, green}')
  })

  it('writes cardinalities, values, inverse properties and datatype facets', () => {
    expect(expression(':X :is [ a owl:Restriction ; owl:onProperty :leg ; owl:qualifiedCardinality 4 ; owl:onClass :Leg ] .')).toBe('leg exactly 4 Leg')
    expect(expression(':X :is [ a owl:Restriction ; owl:onProperty :leg ; owl:maxCardinality 2 ] .')).toBe('leg max 2')
    expect(expression(':X :is [ a owl:Restriction ; owl:onProperty [ owl:inverseOf :owns ] ; owl:hasValue :tom ] .')).toBe('inverse owns value tom')
    expect(expression(':X :is [ a owl:Restriction ; owl:onProperty :age ; owl:hasValue 3 ] .')).toBe('age value "3"')
    expect(expression(':X :is [ owl:onDatatype xsd:integer ; owl:withRestrictions ( [ xsd:minInclusive 0 ] ) ] .')).toBe('integer[>= 0]')
  })
})
