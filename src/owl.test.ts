import { Parser } from 'n3'
import { describe, expect, it } from 'vitest'
import { localName, sampleOntology } from './model'
import { toTurtle } from './owl'

const P = 'http://example.org/pizza#'

describe('toTurtle', () => {
  it('emits parseable Turtle with classes, subclass axioms and object properties', async () => {
    const turtle = await toTurtle(sampleOntology)
    const triples = new Parser().parse(turtle).map((q) => [q.subject.value, q.predicate.value, q.object.value].join(' '))

    expect(triples).toContain('http://example.org/pizza http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#Ontology')
    expect(triples).toContain(`${P}TomatoTopping http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#Class`)
    expect(triples).toContain(`${P}Margherita http://www.w3.org/2000/01/rdf-schema#subClassOf ${P}Pizza`)
    expect(triples).toContain(`${P}hasTopping http://www.w3.org/2000/01/rdf-schema#domain ${P}Pizza`)
    expect(triples).toContain(`${P}hasTopping http://www.w3.org/2000/01/rdf-schema#range ${P}Topping`)
  })
})

describe('localName', () => {
  it('camel-cases labels and falls back for empty input', () => {
    expect(localName('tomato topping')).toBe('TomatoTopping')
    expect(localName('  ')).toBe('Unnamed')
  })
})
