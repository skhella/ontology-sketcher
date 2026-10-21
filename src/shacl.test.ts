import { DataFactory, Parser, Store, type Term } from 'n3'
import Validator from 'shacl-engine/Validator.js'
import { describe, expect, it } from 'vitest'
import { sampleOntology, type Ontology, type PropertyConstraint } from './model'
import { toTurtle } from './owl'
import { hasConstraints, hasShapes, SH, toShaclTurtle } from './shacl'

const P = 'http://example.org/pizza#'
const S = 'http://example.org/pizza/shapes#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

function withConstraints(byNode: Record<string, PropertyConstraint[]>, dataProperties = true): Ontology {
  return {
    ...sampleOntology,
    nodes: sampleOntology.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        ...(dataProperties && n.id === 'pizza' && { dataProperties: [{ name: 'name', datatype: XSD + 'string' }] }),
        ...(byNode[n.id] && { constraints: byNode[n.id] }),
      },
    })),
  }
}

const pizzaRules = withConstraints({
  pizza: [
    { path: { type: 'object', property: 'e3' }, minCount: 1, class: 'topping', message: 'A pizza needs a topping.' },
    { path: { type: 'data', name: 'name' }, maxCount: 1, datatype: XSD + 'string' },
  ],
})

const triplesOf = (turtle: string) => new Parser().parse(turtle).map((q) => [q.subject.value, q.predicate.value, q.object.value].join(' '))

describe('toShaclTurtle', () => {
  it('writes only the shapes graph header when nothing says what data should look like', async () => {
    const hierarchy = { ...sampleOntology, edges: sampleOntology.edges.filter((e) => e.data?.kind === 'subClassOf') }
    expect(hasConstraints(sampleOntology)).toBe(false)
    expect(hasShapes(sampleOntology)).toBe(true)
    expect(hasShapes(hierarchy)).toBe(false)
    const triples = triplesOf(await toShaclTurtle(hierarchy))
    expect(triples).toEqual([
      'http://example.org/pizza/shapes http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#Ontology',
      'http://example.org/pizza/shapes http://www.w3.org/2002/07/owl#imports http://example.org/pizza',
    ])
  })

  it('writes a node shape per constrained class with one property shape per constraint', async () => {
    expect(hasConstraints(pizzaRules)).toBe(true)
    const turtle = await toShaclTurtle(pizzaRules)
    const store = new Store(new Parser().parse(turtle))
    const { namedNode } = DataFactory
    const one = (s: string | null, p: string, o: string | null) => store.getQuads(s && namedNode(s), namedNode(p), o && namedNode(o), null)

    expect(one(S + 'PizzaShape', SH + 'targetClass', P + 'Pizza')).toHaveLength(1)
    expect(one(null, SH + 'targetClass', null)).toHaveLength(1)
    const props = one(S + 'PizzaShape', SH + 'property', null).map((q) => q.object)
    expect(props).toHaveLength(4)
    const fields = (node: (typeof props)[number]) =>
      Object.fromEntries(store.getQuads(node, null, null, null).map((q) => [q.predicate.value.replace(SH, ''), q.object.value]))

    // The arrow and the listed data property first, then the constraint rows.
    expect(props.map(fields)).toEqual([
      { path: P + 'hasTopping', class: P + 'Topping', message: 'Pizza hasTopping: every value must be an instance of Topping.' },
      { path: P + 'name', datatype: XSD + 'string', message: 'Pizza name: every value must be xsd:string.' },
      { path: P + 'hasTopping', minCount: '1', class: P + 'Topping', message: 'A pizza needs a topping.' },
      { path: P + 'name', maxCount: '1', datatype: XSD + 'string' },
    ])
  })

  it('leaves out constraints on deleted properties or classes and keeps shape names apart', async () => {
    const ontology = withConstraints({
      pizza: [
        { path: { type: 'object', property: 'gone' }, minCount: 1 },
        { path: { type: 'object', property: 'e3' }, class: 'gone' },
        { path: { type: 'data', name: ' ' }, minCount: 1 },
      ],
      margherita: [{ path: { type: 'object', property: 'e3' }, minCount: 2 }],
      tomato: [{ path: { type: 'object', property: 'e3' }, maxCount: 0 }],
    })
    // Two classes whose IRIs end in the same local name.
    ontology.nodes = ontology.nodes.map((n) => (n.id === 'tomato' ? { ...n, data: { ...n.data, iri: 'http://other.example/Margherita' } } : n))
    const triples = triplesOf(await toShaclTurtle(ontology))

    expect(triples).toContain(`${S}PizzaShape ${SH}targetClass ${P}Pizza`)
    // Only the arrow's and the data property's rules are left on Pizza.
    expect(triples.filter((t) => t.startsWith(`${S}PizzaShape ${SH}property`))).toHaveLength(2)
    expect(triples).toContain(`${S}MargheritaShape ${SH}targetClass ${P}Margherita`)
    expect(triples).toContain(`${S}MargheritaShape2 ${SH}targetClass http://other.example/Margherita`)
  })

  it('writes value rules as typed literals and a closed shape that still allows rdf:type', async () => {
    const ontology = withConstraints({
      pizza: [
        { path: { type: 'data', name: 'name' }, datatype: XSD + 'string', pattern: ' ^[A-Z] ', allowed: ['Lunch', ' Dinner', ''], minLength: 2, maxLength: 20 },
        { path: { type: 'data', name: 'price' }, minValue: '4.5', maxValue: '30' },
        { path: { type: 'object', property: 'e3' }, pattern: 'ignored' },
      ],
    })
    ontology.nodes = ontology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, constraintsClosed: true } } : n))
    const quads = new Parser().parse(await toShaclTurtle(ontology))
    const store = new Store(quads)
    const { namedNode } = DataFactory
    const objects = (s: Term | undefined, p: string) => store.getObjects(s ?? null, namedNode(p), null)
    const list = (head: Term | undefined) => {
      const items: Term[] = []
      for (let at = head; at && at.value !== RDF + 'nil'; at = objects(at, RDF + 'rest')[0]) items.push(objects(at, RDF + 'first')[0])
      return items
    }
    const shape = namedNode(S + 'PizzaShape')
    expect(objects(shape, SH + 'closed').map((o) => o.id)).toEqual([`"true"^^${XSD}boolean`])
    expect(list(objects(shape, SH + 'ignoredProperties')[0]).map((o) => o.value)).toEqual([RDF + 'type'])

    const [name, price, topping] = objects(shape, SH + 'property').slice(2)
    expect(objects(name, SH + 'pattern').map((o) => o.value)).toEqual(['^[A-Z]'])
    expect(list(objects(name, SH + 'in')[0]).map((o) => o.id)).toEqual(['"Lunch"', '"Dinner"']) // xsd:string is the plain literal's type
    expect(objects(name, SH + 'minLength').map((o) => o.value)).toEqual(['2'])
    expect(objects(name, SH + 'maxLength').map((o) => o.value)).toEqual(['20'])
    // Without a datatype, numbers compare as numbers.
    expect(objects(price, SH + 'minInclusive').map((o) => o.id)).toEqual([`"4.5"^^${XSD}decimal`])
    expect(objects(price, SH + 'maxInclusive').map((o) => o.id)).toEqual([`"30"^^${XSD}decimal`])
    // Value rules belong to data properties only.
    expect(objects(topping, SH + 'pattern')).toEqual([])
  })

  it('catches broken sample data when validated with shacl-engine', async () => {
    const parse = (turtle: string) => new Parser().parse(turtle)
    const shapes = new Store(parse(await toShaclTurtle(pizzaRules)))
    // The ontology goes in with the data so sh:class counts a TomatoTopping as a Topping.
    // (Subclass targets, a Margherita checked as a Pizza, need it in the shapes graph too; see validate.ts.)
    const data = new Store([
      ...parse(await toTurtle(pizzaRules)),
      ...parse(`
        @prefix : <${P}> .
        :lunch a :Margherita ; :name "Lunch" ; :hasTopping :t1 .
        :t1 a :TomatoTopping .
        :bare a :Pizza ; :name "A", "B" .
        :odd a :Pizza ; :hasTopping :rock .
        :rock a :Stone .
      `),
    ])
    const factory = { ...DataFactory, dataset: (quads?: Iterable<never>) => new Store(quads ? [...quads] : undefined) }
    const report = await new Validator(shapes, { factory }).validate({ dataset: data })

    expect(report.conforms).toBe(false)
    const found = report.results.map((r) => `${r.focusNode.value.replace(P, '')} ${r.constraintComponent.value.replace(SH, '')}`).sort()
    // :rock breaks both the arrow's sh:class and the constraint row's.
    expect(found).toEqual(['bare MaxCountConstraintComponent', 'bare MinCountConstraintComponent', 'odd ClassConstraintComponent', 'odd ClassConstraintComponent'])
  })
})
