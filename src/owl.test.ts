import { DataFactory, Parser, Store, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { importedOntologyIri, localName, sampleOntology, type ClassAxiom, type Ontology } from './model'
import { toTurtle } from './owl'
import { toShaclTurtle } from './shacl'

const P = 'http://example.org/pizza#'
const { namedNode } = DataFactory

describe('toTurtle', () => {
  it('emits parseable Turtle with classes, subclass axioms and object properties', async () => {
    const turtle = await toTurtle(sampleOntology)
    const triples = new Parser().parse(turtle).map((q) => [q.subject.value, q.predicate.value, q.object.value].join(' '))

    expect(triples).toContain('http://example.org/pizza http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#Ontology')
    expect(triples).toContain(`${P}TomatoTopping http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#Class`)
    expect(triples).toContain(`${P}Margherita http://www.w3.org/2000/01/rdf-schema#subClassOf ${P}Pizza`)
    expect(triples).toContain(`${P}hasTopping http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#ObjectProperty`)
  })

  it('writes an inference-safe TBox: no restrictions, domains, ranges or unions', async () => {
    const turtle = await toTurtle(sampleOntology)
    for (const term of ['owl:Restriction', 'owl:allValuesFrom', 'rdfs:domain', 'rdfs:range', 'owl:unionOf', 'Restriction', 'domain', 'range', 'unionOf']) {
      expect(turtle).not.toContain(term)
    }
  })

  it('needs an absolute base IRI', async () => {
    expect(() => toTurtle({ ...sampleOntology, iri: '' })).toThrow(/base IRI/)
    expect(() => toTurtle({ ...sampleOntology, iri: 'pizza#' })).toThrow(/base IRI/)
  })

  it('writes the version and the sketch it comes from into the ontology header', async () => {
    const quads = new Parser().parse(await toTurtle(sampleOntology, undefined, { versionInfo: '2026-10-21T18:00:00.000Z', comment: 'From pizza.sketcher.json.' }))
    const header = (p: string) => quads.filter((q) => q.subject.value === 'http://example.org/pizza' && q.predicate.value === p).map((q) => q.object.value)
    expect(header('http://www.w3.org/2002/07/owl#versionInfo')).toEqual(['2026-10-21T18:00:00.000Z'])
    expect(header('http://www.w3.org/2000/01/rdf-schema#comment')).toEqual(['From pizza.sketcher.json.'])
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
    expect(find(prop, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')[0].value).toBe('http://www.w3.org/2002/07/owl#ObjectProperty')
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

  const SH = 'http://www.w3.org/ns/shacl#'
  const parse = async (ontology: Ontology) => {
    const quads = [...new Parser().parse(await toTurtle(ontology)), ...new Parser().parse(await toShaclTurtle(ontology))]
    const objects = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
    const list = (head: string): string[] => (head === RDF + 'nil' ? [] : [objects(head, RDF + 'first')[0], ...list(objects(head, RDF + 'rest')[0])])
    // The classes a node shape allows as values of hasPart: its sh:class, or the sh:class of each sh:or member.
    const allowed = (source: string) => {
      const [shape] = quads.filter((q) => q.predicate.value === SH + 'targetClass' && q.object.value === `${P}${source}`).map((q) => q.subject.value)
      const [property] = objects(shape, SH + 'property').filter((p) => objects(p, SH + 'path')[0] === `${P}hasPart`)
      const or = objects(property, SH + 'or')[0]
      return { values: or ? list(or).map((m) => objects(m, SH + 'class')[0]) : objects(property, SH + 'class'), property }
    }
    return { quads, objects, allowed }
  }

  it('declares and labels the property once, without a domain or range', async () => {
    const { objects } = await parse(parts)
    expect(objects(`${P}hasPart`, RDF + 'type')).toEqual([OWL + 'ObjectProperty'])
    expect(objects(`${P}hasPart`, RDFS + 'label')).toEqual(['has part'])
    expect(objects(`${P}hasPart`, RDFS + 'domain')).toEqual([])
    expect(objects(`${P}hasPart`, RDFS + 'range')).toEqual([])
  })

  it('keeps what each class can have as parts as a shape, not a restriction', async () => {
    const { quads, objects, allowed } = await parse(parts)
    expect(quads.some((q) => q.object.value === OWL + 'Restriction' || q.predicate.value === OWL + 'unionOf')).toBe(false)
    expect(allowed('Building').values).toEqual([`${P}Floor`])
    expect(allowed('Floor').values).toEqual([`${P}Room`])
    expect(allowed('Band').values).toEqual([`${P}Singer`, `${P}Drummer`])
    expect(objects(allowed('Band').property, SH + 'message')).toEqual(['Band hasPart: every value must be an instance of Singer or Drummer.'])
    // An arrow says nothing about how many.
    expect(quads.some((q) => [SH + 'minCount', SH + 'maxCount'].includes(q.predicate.value))).toBe(false)
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

  it('writes named-class axioms, and restrictions as shapes, skipping ones that point at deleted elements', async () => {
    const SH = 'http://www.w3.org/ns/shacl#'
    const turtle = await toTurtle(withAxioms)
    const store = new Store([...new Parser().parse(turtle), ...new Parser().parse(await toShaclTurtle(withAxioms))])
    const objects = (s: Term | string, p: string) => store.getObjects(typeof s === 'string' ? namedNode(s) : s, namedNode(p), null)
    const one = (s: Term | string, p: string) => {
      expect(objects(s, p)).toHaveLength(1)
      return objects(s, p)[0]
    }

    expect(one(`${P}Pizza`, OWL + 'disjointWith').value).toBe(`${P}Topping`)
    expect(objects(`${P}Pizza`, OWL + 'equivalentClass')).toHaveLength(0)
    expect(turtle).not.toContain('Restriction')
    expect(turtle).not.toContain('xsd:')

    // Property shapes from the axioms, by class; the arrow's own sh:class rule comes first on Pizza.
    const shapeOf = (cls: string) => store.getSubjects(namedNode(SH + 'targetClass'), namedNode(`${P}${cls}`), null)[0]
    const fromAxioms = (cls: string) => objects(shapeOf(cls), SH + 'property').filter((p) => objects(p, SH + 'message')[0]?.value.startsWith('From the class axiom'))
    expect(fromAxioms('Pizza')).toHaveLength(1)
    const min = fromAxioms('Pizza')[0]
    expect(one(min, SH + 'path').value).toBe(`${P}hasTopping`)
    expect(one(min, SH + 'minCount')).toMatchObject({ value: '1', datatype: { value: XSD + 'integer' } })
    expect(one(min, SH + 'message').value).toBe('From the class axiom Pizza subClassOf hasTopping min 1.')

    const [some, exactly] = fromAxioms('Margherita')
    expect(one(one(some, SH + 'qualifiedValueShape'), SH + 'class').value).toBe(`${P}TomatoTopping`)
    expect(one(some, SH + 'qualifiedMinCount').value).toBe('1')
    expect(one(one(exactly, SH + 'qualifiedValueShape'), SH + 'class').value).toBe(`${P}Topping`)
    expect(one(exactly, SH + 'qualifiedMinCount').value).toBe('2')
    expect(one(exactly, SH + 'qualifiedMaxCount').value).toBe('2')
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

  it('declares data properties, with the classes listing them and their datatype as shapes', async () => {
    const SH = 'http://www.w3.org/ns/shacl#'
    const quads = new Parser().parse(await toTurtle(ontology))
    const objects = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
    expect(objects(`${P}price`, RDF + 'type').sort()).toEqual([OWL + 'DatatypeProperty', OWL + 'FunctionalProperty'])
    expect(objects(`${P}price`, RDFS + 'label')).toEqual(['price'])
    expect(objects(`${P}price`, RDFS + 'domain')).toEqual([])
    expect(objects(`${P}name`, RDFS + 'range')).toEqual([])
    expect(objects(`${P}Unnamed`, RDF + 'type')).toEqual([])

    const shapes = new Parser().parse(await toShaclTurtle(ontology))
    const value = (s: string, p: string) => shapes.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value)
    const datatypes = (cls: string) => {
      const [shape] = shapes.filter((q) => q.predicate.value === SH + 'targetClass' && q.object.value === `${P}${cls}`).map((q) => q.subject.value)
      return value(shape, SH + 'property').filter((p) => value(p, SH + 'datatype').length).map((p) => [value(p, SH + 'path')[0], value(p, SH + 'datatype')[0]])
    }
    expect(datatypes('Pizza')).toEqual([[`${P}price`, XSD + 'decimal'], [`${P}name`, XSD + 'string']])
    expect(datatypes('Topping')).toEqual([[`${P}name`, XSD + 'string']])
  })
})
