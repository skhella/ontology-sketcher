import { Parser } from 'n3'
import { describe, expect, it } from 'vitest'
import { sampleOntology, type ClassNode, type EdgeKind, type NodeKind, type Ontology, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { conceptSchemes, defaultEdge } from './skos'

const P = 'http://example.org/pizza#'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const OWL = 'http://www.w3.org/2002/07/owl#'

const node = (id: string, label: string, kind?: NodeKind, inScheme?: string[]): ClassNode => ({
  id,
  type: 'owlClass',
  position: { x: 0, y: 0 },
  data: { label, ...(kind && { kind }), ...(inScheme && { inScheme }) },
})
const edge = (source: string, target: string, kind: EdgeKind): RelationEdge => ({
  id: `${source}-${kind}-${target}`,
  type: 'relation',
  source,
  target,
  data: { kind, label: kind },
})

// A small crust thesaurus next to the pizza classes: Crust is the top concept, Thin and Thick are narrower.
const thesaurus: Ontology = {
  ...sampleOntology,
  nodes: [
    ...sampleOntology.nodes,
    node('crusts', 'Crust Types', 'scheme'),
    node('crust', 'Crust', 'concept'),
    node('thin', 'Thin Crust', 'concept'),
    node('thick', 'Thick Crust', 'concept'),
    node('flatbread', 'Flatbread', 'concept'),
  ],
  edges: [
    ...sampleOntology.edges,
    edge('crust', 'crusts', 'topConceptOf'),
    edge('thin', 'crust', 'broader'),
    edge('crust', 'thick', 'narrower'),
    edge('thin', 'flatbread', 'related'),
  ],
}

async function triples(ontology: Ontology): Promise<string[]> {
  return new Parser().parse(await toTurtle(ontology)).map((q) => [q.subject.value, q.predicate.value, q.object.value].join(' '))
}

describe('SKOS export', () => {
  it('exports concepts and schemes as individuals with prefLabels, next to the classes', async () => {
    const t = await triples(thesaurus)
    expect(t).toContain(`${P}ThinCrust ${RDF_TYPE} ${SKOS}Concept`)
    expect(t).toContain(`${P}ThinCrust ${RDF_TYPE} ${OWL}NamedIndividual`)
    expect(t).toContain(`${P}ThinCrust ${SKOS}prefLabel Thin Crust`)
    expect(t).toContain(`${P}CrustTypes ${RDF_TYPE} ${SKOS}ConceptScheme`)
    expect(t).not.toContain(`${P}ThinCrust ${RDF_TYPE} ${OWL}Class`)
    expect(t).toContain(`${P}Pizza ${RDF_TYPE} ${OWL}Class`)
  })

  it('exports the drawn relations and hierarchy membership', async () => {
    const t = await triples(thesaurus)
    expect(t).toContain(`${P}ThinCrust ${SKOS}broader ${P}Crust`)
    expect(t).toContain(`${P}Crust ${SKOS}narrower ${P}ThickCrust`)
    expect(t).toContain(`${P}ThinCrust ${SKOS}related ${P}Flatbread`)
    expect(t).toContain(`${P}Crust ${SKOS}topConceptOf ${P}CrustTypes`)
    expect(t).toContain(`${P}CrustTypes ${SKOS}hasTopConcept ${P}Crust`)
    for (const c of ['Crust', 'ThinCrust', 'ThickCrust', 'Flatbread']) expect(t).toContain(`${P}${c} ${SKOS}inScheme ${P}CrustTypes`)
  })

  it('declares the SKOS vocabulary it uses, so the file stays OWL 2 DL', async () => {
    const t = await triples(thesaurus)
    expect(t).toContain(`${SKOS}Concept ${RDF_TYPE} ${OWL}Class`)
    expect(t).toContain(`${SKOS}ConceptScheme ${RDF_TYPE} ${OWL}Class`)
    expect(t).toContain(`${SKOS}broader ${RDF_TYPE} ${OWL}ObjectProperty`)
    expect(t).toContain(`${SKOS}inScheme ${RDF_TYPE} ${OWL}ObjectProperty`)
    expect(t).toContain(`${SKOS}prefLabel ${RDF_TYPE} ${OWL}AnnotationProperty`)
    expect(await toTurtle(thesaurus)).toContain('@prefix skos: <http://www.w3.org/2004/02/skos/core#>.')
  })

  it('leaves the OWL export unchanged when there are no concepts', async () => {
    expect(await toTurtle(sampleOntology)).not.toContain('skos')
  })

  it('never exports a SKOS edge between classes as an object property', async () => {
    const t = await triples({ ...sampleOntology, edges: [edge('margherita', 'pizza', 'broader')] })
    expect(t.some((x) => x.includes('broader'))).toBe(false)
  })
})

describe('SKOS labels and mappings', () => {
  const labelled: Ontology = {
    ...thesaurus,
    nodes: thesaurus.nodes.map((n) =>
      n.id === 'thin'
        ? {
            ...n,
            data: {
              ...n.data,
              labelLang: 'en',
              annotations: [
                { property: SKOS + 'prefLabel', value: 'Dünner Boden', lang: 'de' },
                { property: SKOS + 'altLabel', value: 'Crispy Crust', lang: 'en' },
                { property: SKOS + 'hiddenLabel', value: 'thin-crust' },
                { property: SKOS + 'notation', value: 'C.1' },
              ],
              mappings: [
                { kind: 'exactMatch' as const, iri: 'http://www.wikidata.org/entity/Q1' },
                { kind: 'closeMatch' as const, iri: 'skos:Example' },
                { kind: 'broadMatch' as const, iri: '  ' },
              ],
            },
          }
        : n,
    ),
  }

  it('tags the prefLabel and keeps other labels and the notation', async () => {
    const quads = new Parser().parse(await toTurtle(labelled)).filter((q) => q.subject.value === P + 'ThinCrust')
    const labels = quads.filter((q) => q.predicate.value.startsWith(SKOS) && q.object.termType === 'Literal')
    const show = (q: (typeof labels)[number]) => `${q.predicate.value.slice(SKOS.length)} ${q.object.value}@${'language' in q.object ? q.object.language : ''}`
    expect(labels.map(show).sort()).toEqual(
      ['altLabel Crispy Crust@en', 'hiddenLabel thin-crust@', 'notation C.1@', 'prefLabel Dünner Boden@de', 'prefLabel Thin Crust@en'].sort(),
    )
  })

  it('exports mappings to outside IRIs and skips empty ones', async () => {
    const t = await triples(labelled)
    expect(t).toContain(`${P}ThinCrust ${SKOS}exactMatch http://www.wikidata.org/entity/Q1`)
    expect(t).toContain(`${P}ThinCrust ${SKOS}closeMatch ${SKOS}Example`)
    expect(t).toContain(`${SKOS}exactMatch ${RDF_TYPE} ${OWL}ObjectProperty`)
    expect(t.some((x) => x.includes('broadMatch'))).toBe(false)
  })
})

describe('conceptSchemes', () => {
  it('spreads a top concept scheme over its hierarchy and keeps explicit choices', () => {
    const nodes = [node('a', 'A', 'scheme'), node('b', 'B', 'scheme'), node('top', 'Top', 'concept'), node('child', 'Child', 'concept'), node('lone', 'Lone', 'concept', ['b'])]
    const edges = [edge('top', 'a', 'topConceptOf'), edge('child', 'top', 'broader')]
    const schemes = conceptSchemes(nodes, edges)
    expect([...schemes.get('child')!]).toEqual(['a'])
    expect([...schemes.get('lone')!]).toEqual(['b'])
  })

  it('puts concepts in no scheme into the only scheme there is', () => {
    const schemes = conceptSchemes([node('s', 'S', 'scheme'), node('c', 'C', 'concept')], [])
    expect([...schemes.get('c')!]).toEqual(['s'])
  })
})

describe('defaultEdge', () => {
  it('picks broader between concepts, topConceptOf into a scheme, subClassOf otherwise', () => {
    expect(defaultEdge({ label: 'a', kind: 'concept' }, { label: 'b', kind: 'concept' }).kind).toBe('broader')
    expect(defaultEdge({ label: 'a', kind: 'concept' }, { label: 'b', kind: 'scheme' }).kind).toBe('topConceptOf')
    expect(defaultEdge({ label: 'a' }, { label: 'b' }).kind).toBe('subClassOf')
  })
})
