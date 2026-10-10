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


  it('ignores visual style and edge curves', async () => {
    const styled = {
      ...sampleOntology,
      nodes: sampleOntology.nodes.map((n) => ({ ...n, data: { ...n.data, style: { stroke: '#e03131', fill: '#ffec99' } } })),
      edges: sampleOntology.edges.map((e) => ({ ...e, data: { ...e.data!, style: { strokeWidth: 4 }, bend: { x: 10, y: 30 } } })),
    }
    expect(await toTurtle(styled)).toBe(await toTurtle(sampleOntology))
  })
})

describe('localName', () => {
  it('camel-cases labels and falls back for empty input', () => {
    expect(localName('tomato topping')).toBe('TomatoTopping')
    expect(localName('  ')).toBe('Unnamed')
  })
})

describe('toTurtle annotations and IRIs', () => {
  const SKOS = 'http://www.w3.org/2004/02/skos/core#'
  const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
  const annotated = {
    ...sampleOntology,
    nodes: sampleOntology.nodes.map((n) =>
      n.id === 'pizza'
        ? {
            ...n,
            data: {
              ...n.data,
              iri: 'PizzaDish',
              annotations: [
                { property: SKOS + 'definition', value: 'A flat baked bread with toppings.', lang: 'en' },
                { property: RDFS + 'comment', value: 'Root class.' },
                { property: RDFS + 'seeAlso', value: 'https://en.wikipedia.org/wiki/Pizza' },
                { property: SKOS + 'altLabel', value: '  ' },
              ],
            },
          }
        : n,
    ),
    edges: sampleOntology.edges.map((e) =>
      e.id === 'e3'
        ? { ...e, data: { ...e.data!, iri: 'http://example.org/food#hasIngredient', annotations: [{ property: SKOS + 'definition', value: 'Links a pizza to a topping.' }] } }
        : e,
    ),
  }

  it('writes annotations, uses IRI overrides and declares non-built-in annotation properties', async () => {
    const quads = new Parser().parse(await toTurtle(annotated))
    const find = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object)

    const definition = find(`${P}PizzaDish`, SKOS + 'definition')
    expect(definition).toHaveLength(1)
    expect(definition[0].value).toBe('A flat baked bread with toppings.')
    expect((definition[0] as { language: string }).language).toBe('en')
    expect(find(`${P}PizzaDish`, RDFS + 'comment')[0].value).toBe('Root class.')
    expect(find(`${P}PizzaDish`, RDFS + 'seeAlso')[0].termType).toBe('NamedNode')
    expect(find(`${P}PizzaDish`, SKOS + 'altLabel')).toHaveLength(0)
    expect(find(`${P}Margherita`, RDFS + 'subClassOf')[0].value).toBe(`${P}PizzaDish`)

    const prop = 'http://example.org/food#hasIngredient'
    expect(find(prop, RDFS + 'domain')[0].value).toBe(`${P}PizzaDish`)
    expect(find(prop, SKOS + 'definition')[0].value).toBe('Links a pizza to a topping.')

    expect(find(SKOS + 'definition', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')[0].value).toBe('http://www.w3.org/2002/07/owl#AnnotationProperty')
    expect(find(RDFS + 'comment', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toHaveLength(0)
  })

  it('leaves the export of an unannotated canvas unchanged', async () => {
    expect(await toTurtle(sampleOntology)).not.toContain('skos')
  })
})
