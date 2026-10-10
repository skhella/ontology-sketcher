import { DataFactory, Parser, Store, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { importedOntologyIri, localName, sampleOntology, type ClassAxiom, type Ontology } from './model'
import { entityIri, toTurtle } from './owl'

const P = 'http://example.org/pizza#'
const { namedNode } = DataFactory
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'

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

describe('entityIri', () => {
  it('puts the local name after the namespace the entity was created in, else after the ontology IRI', () => {
    const ns = 'https://w3id.org/aizop#'
    expect(entityIri(P, {}, 'Pizza')).toBe(P + 'Pizza')
    expect(entityIri(P, { namespace: ns }, 'Pizza')).toBe(ns + 'Pizza')
    expect(entityIri(P, { namespace: ns, iri: 'Pie' }, 'Pizza')).toBe(ns + 'Pie')
    expect(entityIri(P, { namespace: ns, iri: 'http://other.org/X' }, 'Pizza')).toBe('http://other.org/X')
  })

  it('exports classes created in another namespace under it', async () => {
    const ns = 'https://w3id.org/aizop#'
    const ontology: Ontology = {
      ...sampleOntology,
      nodes: sampleOntology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, namespace: ns } } : n)),
    }
    const store = new Store(new Parser().parse(await toTurtle(ontology)))
    expect(store.has(DataFactory.quad(namedNode(ns + 'Pizza'), namedNode(RDF_TYPE), namedNode(OWL_CLASS)))).toBe(true)
    expect(store.has(DataFactory.quad(namedNode(P + 'Margherita'), namedNode(RDFS_SUBCLASS), namedNode(ns + 'Pizza')))).toBe(true)
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

describe('toTurtle with a property drawn between several class pairs', () => {
  const OWL = 'http://www.w3.org/2002/07/owl#'
  const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  const cls = (id: string) => ({ id, type: 'owlClass' as const, position: { x: 0, y: 0 }, data: { label: id } })
  const hasPart = (id: string, source: string, target: string) =>
    ({ id, type: 'relation' as const, source, target, data: { kind: 'objectProperty' as const, label: 'has part' } })
  const parts: Ontology = {
    iri: P,
    nodes: ['Building', 'Floor', 'Room', 'Band', 'Singer', 'Drummer'].map(cls),
    edges: [
      hasPart('a', 'Building', 'Floor'),
      hasPart('b', 'Floor', 'Room'),
      hasPart('c', 'Band', 'Singer'),
      hasPart('d', 'Band', 'Drummer'),
    ],
  }

  const parse = async (ontology: Ontology) => {
    const quads = new Parser().parse(await toTurtle(ontology))
    const objects = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
    const list = (head: string): string[] => (head === RDF + 'nil' ? [] : [objects(head, RDF + 'first')[0], ...list(objects(head, RDF + 'rest')[0])])
    return { quads, objects, union: (node: string) => list(objects(node, OWL + 'unionOf')[0]) }
  }

  it('declares and labels the property once, with a union as its domain and range', async () => {
    const { objects, union } = await parse(parts)
    expect(objects(`${P}hasPart`, RDF + 'type')).toEqual([OWL + 'ObjectProperty'])
    expect(objects(`${P}hasPart`, RDFS + 'label')).toEqual(['has part'])

    const [domain] = objects(`${P}hasPart`, RDFS + 'domain')
    const [range] = objects(`${P}hasPart`, RDFS + 'range')
    expect(objects(`${P}hasPart`, RDFS + 'domain')).toHaveLength(1)
    expect(objects(domain, RDF + 'type')).toEqual([OWL + 'Class'])
    expect(union(domain)).toEqual([`${P}Building`, `${P}Floor`, `${P}Band`])
    expect(union(range)).toEqual([`${P}Floor`, `${P}Room`, `${P}Singer`, `${P}Drummer`])
  })

  it('keeps what each class can have as parts as an allValuesFrom restriction', async () => {
    const { objects, union } = await parse(parts)
    const onlyValues = (source: string) => {
      const [restriction] = objects(`${P}${source}`, RDFS + 'subClassOf')
      expect(objects(restriction, RDF + 'type')).toEqual([OWL + 'Restriction'])
      expect(objects(restriction, OWL + 'onProperty')).toEqual([`${P}hasPart`])
      return objects(restriction, OWL + 'allValuesFrom')[0]
    }
    expect(onlyValues('Building')).toBe(`${P}Floor`)
    expect(onlyValues('Floor')).toBe(`${P}Room`)
    expect(union(onlyValues('Band'))).toEqual([`${P}Singer`, `${P}Drummer`])
  })

  it('adds no restrictions when one class uses the property with several targets', async () => {
    const band = { ...parts, edges: parts.edges.filter((e) => e.source === 'Band') }
    const { quads, objects, union } = await parse(band)
    expect(objects(`${P}hasPart`, RDFS + 'domain')).toEqual([`${P}Band`])
    expect(union(objects(`${P}hasPart`, RDFS + 'range')[0])).toEqual([`${P}Singer`, `${P}Drummer`])
    expect(quads.some((q) => q.object.value === OWL + 'Restriction')).toBe(false)
  })
})

describe('importedOntologyIri', () => {
  it('names a placeholder IRI after the imported file and keeps one the user set', () => {
    expect(importedOntologyIri(sampleOntology.iri, '2026-08-12 - City Map - import-ready.excalidraw')).toBe(
      'http://example.org/2026-08-12-city-map-import-ready#',
    )
    expect(importedOntologyIri(sampleOntology.iri, '.excalidraw')).toBe('http://example.org/ontology#')
    expect(importedOntologyIri('https://w3id.org/example#', 'other.excalidraw')).toBe('https://w3id.org/example#')
  })
})

describe('toTurtle class axioms', () => {
  const OWL = 'http://www.w3.org/2002/07/owl#'
  const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
  const XSD = 'http://www.w3.org/2001/XMLSchema#'
  const axioms: Record<string, ClassAxiom[]> = {
    margherita: [
      { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'some', property: 'e3', filler: 'tomato' } },
      { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'exactly', property: 'e3', n: 2, filler: 'topping' } },
    ],
    pizza: [
      { kind: 'disjointWith', expression: { type: 'class', ref: 'topping' } },
      { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'min', property: 'e3', n: 1 } },
      { kind: 'equivalentClass', expression: { type: 'class', ref: 'deleted-node' } },
      { kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'only', property: 'deleted-edge', filler: 'topping' } },
    ],
  }
  const withAxioms = {
    ...sampleOntology,
    nodes: sampleOntology.nodes.map((n) => ({ ...n, data: { ...n.data, axioms: axioms[n.id] } })),
  }

  it('writes named-class axioms and inline restrictions, skipping ones that point at deleted elements', async () => {
    const turtle = await toTurtle(withAxioms)
    const store = new Store(new Parser().parse(turtle))
    const one = (s: Term | string, p: string) => {
      const objects = store.getObjects(typeof s === 'string' ? namedNode(s) : s, namedNode(p), null)
      expect(objects).toHaveLength(1)
      return objects[0]
    }

    expect(one(`${P}Pizza`, OWL + 'disjointWith').value).toBe(`${P}Topping`)
    expect(store.getObjects(namedNode(`${P}Pizza`), namedNode(OWL + 'equivalentClass'), null)).toHaveLength(0)

    const restrictions = (s: string) =>
      store.getObjects(namedNode(s), namedNode(RDFS + 'subClassOf'), null).filter((o) => o.termType === 'BlankNode')
    expect(restrictions(`${P}Pizza`)).toHaveLength(1)
    const min = restrictions(`${P}Pizza`)[0]
    expect(one(min, OWL + 'onProperty').value).toBe(`${P}hasTopping`)
    expect(one(min, OWL + 'minCardinality')).toMatchObject({ value: '1', datatype: { value: XSD + 'nonNegativeInteger' } })

    const has = (p: string) => restrictions(`${P}Margherita`).find((r) => store.countQuads(r, namedNode(p), null, null) > 0)!
    const some = has(OWL + 'someValuesFrom')
    const exactly = has(OWL + 'qualifiedCardinality')
    expect(one(some, OWL + 'someValuesFrom').value).toBe(`${P}TomatoTopping`)
    expect(one(exactly, OWL + 'qualifiedCardinality').value).toBe('2')
    expect(one(exactly, OWL + 'onClass').value).toBe(`${P}Topping`)
  })
})

describe('toTurtle property details', () => {
  const OWL = 'http://www.w3.org/2002/07/owl#'
  const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  const XSD = 'http://www.w3.org/2001/XMLSchema#'
  const ontology: Ontology = {
    ...sampleOntology,
    nodes: sampleOntology.nodes.map((n) =>
      n.id === 'pizza'
        ? { ...n, data: { ...n.data, dataProperties: [{ name: 'price', datatype: XSD + 'decimal', functional: true }, { name: 'name', datatype: XSD + 'string' }] } }
        : n.id === 'topping'
          ? { ...n, data: { ...n.data, dataProperties: [{ name: 'name', datatype: XSD + 'string' }, { name: ' ', datatype: XSD + 'string' }] } }
          : n,
    ),
    edges: [
      ...sampleOntology.edges.map((e) => (e.id === 'e3' ? { ...e, data: { ...e.data!, characteristics: ['inverseFunctional' as const], inverseOf: 'e4' } } : e)),
      { id: 'e4', type: 'relation', source: 'topping', target: 'pizza', data: { kind: 'objectProperty', label: 'is topping of', subPropertyOf: 'e3', characteristics: ['functional'] } },
      { id: 'e5', type: 'relation', source: 'tomato', target: 'topping', data: { kind: 'objectProperty', label: 'is topping of' } },
      { id: 'e6', type: 'relation', source: 'margherita', target: 'tomato', data: { kind: 'annotationProperty', label: 'inspired by' } },
    ],
  }

  it('writes characteristics, inverseOf and subPropertyOf once per property', async () => {
    const store = new Store(new Parser().parse(await toTurtle(ontology)))
    const objects = (s: string, p: string) => store.getObjects(namedNode(s), namedNode(p), null).map((o) => o.value)

    expect(objects(`${P}hasTopping`, RDF + 'type').sort()).toEqual([OWL + 'InverseFunctionalProperty', OWL + 'ObjectProperty'])
    expect(objects(`${P}hasTopping`, OWL + 'inverseOf')).toEqual([`${P}isToppingOf`])
    expect(objects(`${P}isToppingOf`, RDF + 'type').sort()).toEqual([OWL + 'FunctionalProperty', OWL + 'ObjectProperty'])
    expect(objects(`${P}isToppingOf`, RDFS + 'subPropertyOf')).toEqual([`${P}hasTopping`])
  })

  it('asserts annotation-property edges between the classes', async () => {
    const store = new Store(new Parser().parse(await toTurtle(ontology)))
    const objects = (s: string, p: string) => store.getObjects(namedNode(s), namedNode(p), null).map((o) => o.value)
    expect(objects(`${P}inspiredBy`, RDF + 'type')).toEqual([OWL + 'AnnotationProperty'])
    expect(objects(`${P}Margherita`, `${P}inspiredBy`)).toEqual([`${P}TomatoTopping`])
    expect(objects(`${P}inspiredBy`, RDFS + 'domain')).toEqual([])
  })

  it('writes data properties with their class as domain and a datatype range', async () => {
    const quads = new Parser().parse(await toTurtle(ontology))
    const objects = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
    expect(objects(`${P}price`, RDF + 'type').sort()).toEqual([OWL + 'DatatypeProperty', OWL + 'FunctionalProperty'])
    expect(objects(`${P}price`, RDFS + 'domain')).toEqual([`${P}Pizza`])
    expect(objects(`${P}price`, RDFS + 'range')).toEqual([XSD + 'decimal'])

    const [domain] = objects(`${P}name`, RDFS + 'domain')
    const list = (head: string): string[] => (head === RDF + 'nil' ? [] : [objects(head, RDF + 'first')[0], ...list(objects(head, RDF + 'rest')[0])])
    expect(list(objects(domain, OWL + 'unionOf')[0])).toEqual([`${P}Pizza`, `${P}Topping`])
    expect(objects(`${P}name`, RDFS + 'range')).toEqual([XSD + 'string'])
    expect(objects(`${P}Unnamed`, RDF + 'type')).toEqual([])
  })
})
