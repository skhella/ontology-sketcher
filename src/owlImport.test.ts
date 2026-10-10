import { Parser, type Quad, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { layoutOntology, placeImport } from './layout'
import { sampleOntology, type ClassNode, type Ontology, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { describeOwlImport, importOwl } from './owlImport'

const P = 'http://example.org/pizza#'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'

/**
 * Turtle as a sorted list of lines with blank nodes written out inline, so two exports compare equal
 * whatever order their triples come in and whatever their blank nodes are called.
 */
function canonical(turtle: string): string[] {
  const quads = new Parser().parse(turtle)
  const bySubject = new Map<string, Quad[]>()
  for (const q of quads) bySubject.set(q.subject.value, [...(bySubject.get(q.subject.value) ?? []), q])
  const term = (t: Term): string =>
    t.termType === 'BlankNode'
      ? `[${(bySubject.get(t.value) ?? []).map((q) => `${q.predicate.value} ${term(q.object)}`).sort().join('; ')}]`
      : t.termType === 'Literal'
        ? JSON.stringify([t.value, t.language, t.datatype.value])
        : t.value
  return quads
    .filter((q) => q.subject.termType !== 'BlankNode')
    .map((q) => `${q.subject.value} ${q.predicate.value} ${term(q.object)}`)
    .sort()
}

async function roundTrip(ontology: Ontology) {
  const turtle = await toTurtle(ontology)
  const imported = importOwl(turtle)
  return { turtle, imported, again: await toTurtle({ iri: imported.iri, nodes: imported.nodes, edges: imported.edges }) }
}

const cls = (id: string, label = id, extra: Partial<ClassNode['data']> = {}): ClassNode => ({ id, type: 'owlClass', position: { x: 0, y: 0 }, data: { label, ...extra } })
const rel = (id: string, source: string, target: string, data: RelationEdge['data']): RelationEdge => ({ id, type: 'relation', source, target, data })

// Most of what the inspector edits, in one ontology.
const rich: Ontology = {
  iri: P,
  nodes: [
    cls('pizza', 'Pizza', {
      iri: 'PizzaDish',
      annotations: [
        { property: SKOS + 'definition', value: 'A flat baked bread with toppings.', lang: 'en' },
        { property: RDFS + 'seeAlso', value: 'https://en.wikipedia.org/wiki/Pizza' },
      ],
      dataProperties: [
        { name: 'diameter', datatype: XSD + 'decimal', functional: true },
        { name: 'name', datatype: XSD + 'string' },
      ],
      axioms: [
        { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'some', property: 'hasBase', filler: 'base' } },
        { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'max', property: 'hasBase', n: 1 } },
        { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'min', property: 'hasTopping', n: 1, filler: 'topping' } },
      ],
    }),
    cls('base', 'Pizza Base', { dataProperties: [{ name: 'name', datatype: XSD + 'string' }] }),
    cls('topping', 'Topping', { axioms: [{ kind: 'disjointWith', expression: { type: 'class', ref: 'base' } }] }),
    cls('veg', 'Vegetarian Pizza', {
      axioms: [{ kind: 'equivalentClass', expression: { type: 'restriction', quantifier: 'only', property: 'hasTopping', filler: 'vegTopping' } }],
    }),
    cls('vegTopping', 'Vegetable Topping'),
    cls('ext', 'Dish', { iri: 'http://example.org/food#Dish' }),
    cls('crusts', 'Crust Types', { kind: 'scheme' }),
    cls('crust', 'Crust', { kind: 'concept', labelLang: 'en', mappings: [{ kind: 'exactMatch', iri: 'http://www.wikidata.org/entity/Q1' }] }),
    cls('thin', 'Thin Crust', { kind: 'concept', annotations: [{ property: SKOS + 'altLabel', value: 'Roman', lang: 'it' }] }),
  ],
  edges: [
    rel('sub1', 'veg', 'pizza', { kind: 'subClassOf', label: '' }),
    rel('sub2', 'vegTopping', 'topping', { kind: 'subClassOf', label: '' }),
    rel('sub3', 'pizza', 'ext', { kind: 'subClassOf', label: '' }),
    rel('hasBase', 'pizza', 'base', { kind: 'objectProperty', label: 'has base', characteristics: ['functional'], subPropertyOf: 'hasIngredient' }),
    rel('hasTopping', 'pizza', 'topping', { kind: 'objectProperty', label: 'has topping', inverseOf: 'toppingOf' }),
    rel('toppingOf', 'topping', 'pizza', { kind: 'objectProperty', label: 'topping of' }),
    // One property between two pairs: the export writes union domain and range plus per-source restrictions.
    rel('hasIngredient', 'pizza', 'topping', { kind: 'objectProperty', label: 'has ingredient', characteristics: ['transitive'] }),
    rel('hasIngredient2', 'topping', 'vegTopping', { kind: 'objectProperty', label: 'has ingredient' }),
    rel('inspired', 'veg', 'ext', { kind: 'annotationProperty', label: 'inspired by' }),
    rel('top', 'crust', 'crusts', { kind: 'topConceptOf', label: 'topConceptOf' }),
    rel('broader', 'thin', 'crust', { kind: 'broader', label: 'broader' }),
  ],
}

describe('importOwl', () => {
  it('round-trips the sample ontology', async () => {
    const { turtle, imported, again } = await roundTrip(sampleOntology)
    expect(canonical(again)).toEqual(canonical(turtle))
    expect(imported.iri).toBe(P)
    expect(imported.summary).toMatchObject({ classes: 4, subClassOf: 2, objectProperties: 1, skipped: [] })
  })

  it('round-trips axioms, properties, annotations, IRIs and SKOS', async () => {
    const { turtle, imported, again } = await roundTrip(rich)
    expect(canonical(again)).toEqual(canonical(turtle))
    expect(imported.summary.skipped).toEqual([])

    const byLabel = (label: string) => imported.nodes.find((n) => n.data.label === label)!
    expect(byLabel('Pizza').data.iri).toBe('PizzaDish')
    expect(byLabel('Dish').data.iri).toBe('http://example.org/food#Dish')
    expect(byLabel('Pizza').data.axioms).toHaveLength(3)
    expect(byLabel('Pizza').data.dataProperties).toEqual([
      { name: 'diameter', datatype: XSD + 'decimal', functional: true },
      { name: 'name', datatype: XSD + 'string' },
    ])
    expect(byLabel('Crust').data).toMatchObject({ kind: 'concept', labelLang: 'en' })
    // The per-source restriction becomes arrows again, not an axiom on Pizza.
    expect(imported.edges.filter((e) => e.data?.label === 'has ingredient').map((e) => [e.source, e.target])).toEqual([
      [byLabel('Pizza').id, byLabel('Topping').id],
      [byLabel('Topping').id, byLabel('Vegetable Topping').id],
    ])
  })

  it('reads a hand-written file: undeclared superclasses, owl:Thing fillers, and what it cannot show', () => {
    const { nodes, edges, summary, iri } = importOwl(`
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix ex: <http://example.org/zoo/> .
      <http://example.org/zoo> a owl:Ontology .
      ex:Lion a owl:Class ; rdfs:subClassOf ex:Cat , [ a owl:Restriction ; owl:onProperty ex:eats ; owl:someValuesFrom owl:Thing ] .
      ex:Cat rdfs:subClassOf [ owl:unionOf ( ex:Lion ex:Lion ) ] .
      ex:eats a owl:ObjectProperty ; rdfs:domain ex:Lion ; rdfs:range ex:Cat .
      ex:Leo a owl:NamedIndividual , ex:Lion .
    `)
    expect(iri).toBe('http://example.org/zoo/')
    expect(nodes.map((n) => n.data.label).sort()).toEqual(['Cat', 'Lion'])
    const lion = nodes.find((n) => n.data.label === 'Lion')!
    expect(lion.data.axioms).toEqual([{ kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'some', property: edges.find((e) => e.data?.label === 'eats')!.id } }])
    expect(summary.skipped).toEqual(['1 class axioms the inspector cannot show (unions, intersections, nested restrictions)', '1 individuals'])
    expect(describeOwlImport(summary)).toContain('Not shown: 1 class axioms')
  })

  it('explains RDF/XML and broken Turtle', () => {
    expect(() => importOwl('<?xml version="1.0"?><rdf:RDF/>')).toThrow(/RDF\/XML/)
    expect(() => importOwl('@prefix : <x> . :a :b')).toThrow(/not valid Turtle/)
  })
})

describe('layout', () => {
  it('puts superclasses above their subclasses and attaches arrows to facing dots', () => {
    const { nodes, edges } = layoutOntology(sampleOntology.nodes, sampleOntology.edges)
    const y = (id: string) => nodes.find((n) => n.id === id)!.position.y
    expect(y('pizza')).toBeLessThan(y('margherita'))
    expect(y('topping')).toBeLessThan(y('tomato'))
    expect(edges.find((e) => e.id === 'e1')).toMatchObject({ sourceHandle: 'top', targetHandle: 'bottom' })
  })

  it('keeps classes already on the page where they are, with their ids and look', async () => {
    const current = {
      iri: P,
      nodes: sampleOntology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, style: { fill: '#ffec99' } } } : n)),
      edges: sampleOntology.edges,
    }
    // The file adds Calzone under Pizza.
    const file = (await toTurtle(sampleOntology)) + `\n<${P}Calzone> a <http://www.w3.org/2002/07/owl#Class> ; <${RDFS}subClassOf> <${P}Pizza> .`
    const placed = placeImport(importOwl(file), current)
    expect(placed.kept).toBe(4)
    for (const n of current.nodes) expect(placed.nodes.find((p) => p.id === n.id)?.position).toEqual(n.position)
    expect(placed.nodes.find((n) => n.id === 'pizza')?.data.style).toEqual({ fill: '#ffec99' })
    expect(placed.edges.map((e) => e.id)).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']))
    const calzone = placed.nodes.find((n) => n.data.label === 'Calzone')!
    expect(calzone.position.y).toBeGreaterThan(current.nodes.find((n) => n.id === 'pizza')!.position.y)
  })
})
