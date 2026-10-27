import { Parser, type Quad, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { keptStatementsOf } from './keptStatements'
import { planImport, saveLayout } from './layout'
import type { Ontology } from './model'
import { toTurtle } from './owl'
import { importOwl } from './owlImport'
import { saveCanvas, workspaceFrom, type Workspace } from './pages'
import { defaultEdge } from './skos'

const EX = 'http://example.org/zoo#'
const OWL = 'http://www.w3.org/2002/07/owl#'

// Value lists as OWL individuals: labels, SKOS annotations, data values and links between individuals.
const source = `
  @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix skos: <http://www.w3.org/2004/02/skos/core#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix : <${EX}> .
  <http://example.org/zoo> a owl:Ontology .
  skos:altLabel a owl:AnnotationProperty . skos:notation a owl:AnnotationProperty .
  :Diet a owl:Class ; rdfs:label "Diet" . :Size a owl:Class ; rdfs:label "Size" .
  :Animal a owl:Class ; rdfs:label "Animal" .
  :eats a owl:ObjectProperty ; rdfs:label "eats" ; rdfs:domain :Animal ; rdfs:range :Diet .
  :ordinal a owl:DatatypeProperty ; rdfs:label "ordinal" ; rdfs:domain :Size ; rdfs:range xsd:integer .
  :goesWith a owl:ObjectProperty ; rdfs:label "goes with" ; rdfs:domain :Diet ; rdfs:range :Diet .
  :meat a owl:NamedIndividual , :Diet ; rdfs:label "Meat" ; skos:altLabel "Fleisch"@de ; :goesWith :bones .
  :bones a owl:NamedIndividual , :Diet ; rdfs:label "Bones" .
  :small a owl:NamedIndividual , :Size ; rdfs:label "small" ; skos:notation "S" ; :ordinal 1 .
  :large a owl:NamedIndividual , :Size ; rdfs:label "large" ; rdfs:comment "Over 100 kg." ; :ordinal 3 .
`

/** Triples as sorted lines, blank nodes written out inline. */
function canonical(turtle: string): string[] {
  const quads = new Parser().parse(turtle)
  const bySubject = new Map<string, Quad[]>()
  for (const q of quads) bySubject.set(q.subject.value, [...(bySubject.get(q.subject.value) ?? []), q])
  const referenced = new Set(quads.filter((q) => q.object.termType === 'BlankNode').map((q) => q.object.value))
  const term = (t: Term): string =>
    t.termType === 'BlankNode'
      ? `[${(bySubject.get(t.value) ?? []).map((q) => `${q.predicate.value} ${term(q.object)}`).sort().join('; ')}]`
      : t.termType === 'Literal'
        ? JSON.stringify([t.value, t.language, t.datatype.value])
        : t.value
  return [...new Set(quads.filter((q) => q.subject.termType !== 'BlankNode' || !referenced.has(q.subject.value)).map((q) => `${term(q.subject)} ${q.predicate.value} ${term(q.object)}`))].sort()
}

async function importAll(text: string): Promise<Ontology> {
  const { iri, nodes, edges, kept } = importOwl(text)
  const imported = { iri, nodes, edges, kept }
  return { ...imported, keptStatements: await keptStatementsOf(text, imported) }
}

describe('individuals', () => {
  it('draws each individual as a box with an arrow to its class, and keeps its labels and values', () => {
    const { nodes, edges, summary } = importOwl(source)
    const byLabel = (label: string) => nodes.find((n) => n.data.label === label)!
    expect(nodes.filter((n) => n.data.kind === 'individual').map((n) => n.data.label).sort()).toEqual(['Bones', 'Meat', 'large', 'small'])
    expect(summary.individuals).toBe(4)
    expect(summary.skipped).toEqual([])
    const label = (id: string) => nodes.find((n) => n.id === id)!.data.label
    expect(edges.filter((e) => e.data?.kind === 'instanceOf').map((e) => `${label(e.source)} ${label(e.target)}`).sort()).toEqual([
      'Bones Diet',
      'Meat Diet',
      'large Size',
      'small Size',
    ])
    expect(byLabel('Meat').data).toMatchObject({
      iri: 'meat',
      annotations: [{ property: 'http://www.w3.org/2004/02/skos/core#altLabel', value: 'Fleisch', lang: 'de' }],
      values: [{ property: EX + 'goesWith', value: EX + 'bones', kind: 'iri' }],
    })
    expect(byLabel('small').data.values).toEqual([{ property: EX + 'ordinal', value: '1', kind: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }])
  })

  it('writes them back from the canvas, so nothing about them needs keeping', async () => {
    const ontology = await importAll(source)
    expect(ontology.keptStatements).toEqual([])
    const back = canonical(await toTurtle(ontology))
    expect(canonical(source).filter((line) => !back.includes(line))).toEqual([])
    expect(back.filter((line) => !canonical(source).includes(line))).toEqual([])
  })

  it('makes an individual an instance of a class it is connected to, and writes what is edited', async () => {
    expect(defaultEdge({ label: 'Rex', kind: 'individual' }, { label: 'Dog' })).toEqual({ kind: 'instanceOf', label: 'type' })
    const ontology = await importAll(source)
    const small = ontology.nodes.find((n) => n.data.label === 'small')!
    small.data = { ...small.data, label: 'tiny', iri: undefined, values: [{ property: EX + 'ordinal', value: '0', kind: 'literal', datatype: 'http://www.w3.org/2001/XMLSchema#integer' }] }
    const back = new Parser().parse(await toTurtle(ontology)).filter((q) => q.subject.value === EX + 'Tiny')
    expect(back.map((q) => [q.predicate.value.replace(/^.*[#/]/, ''), q.object.value])).toEqual(
      expect.arrayContaining([
        ['type', OWL + 'NamedIndividual'],
        ['type', EX + 'Size'],
        ['label', 'tiny'],
        ['notation', 'S'],
        ['ordinal', '0'],
      ]),
    )
  })

  it('puts imported individuals on pages of their own, each next to its class', () => {
    const imported = importOwl(source)
    const fresh = workspaceFrom('Page 1', [], [])
    const { pages } = planImport(imported, { iri: imported.iri, workspace: fresh.workspace, pageId: fresh.pageId }, 6)
    const individualsPage = pages.find((p) => p.name?.startsWith('Individuals'))!
    expect(individualsPage.name).toBe('Individuals: Diet, Size')
    expect(individualsPage.nodes.map((n) => n.data.label).sort()).toEqual(['Bones', 'Diet', 'Meat', 'Size', 'large', 'small'])
    expect(pages.flatMap((p) => p.nodes).filter((n) => n.data.kind === 'individual')).toHaveLength(4)
  })

  it('adds individuals a saved layout does not know on their own page, not the first one', async () => {
    // Saved with only the classes drawn, as an older export would have been.
    const classesOnly = importOwl(source.replace(/^\s*:(meat|bones|small|large) .*$/gm, ''))
    const fresh = workspaceFrom('Page 1', [], [])
    const [page] = planImport(classesOnly, { iri: classesOnly.iri, workspace: fresh.workspace, pageId: fresh.pageId }).pages
    const ws: Workspace = saveCanvas(fresh.workspace, fresh.pageId, page.nodes, page.edges)
    const imported = { ...importOwl(source), layout: saveLayout(ws, [fresh.pageId], classesOnly.iri) }
    const { pages } = planImport(imported, { iri: imported.iri, workspace: workspaceFrom('Page 1', [], []).workspace, pageId: fresh.pageId })
    expect(pages[0].nodes.some((n) => n.data.kind === 'individual')).toBe(false)
    expect(pages[1].name).toBe('Individuals: Diet, Size')
  })

  it('adds SKOS concepts a saved layout does not know on vocabulary pages, each scheme with its concepts', async () => {
    const vocabulary = `
      :Sizes a skos:ConceptScheme ; skos:prefLabel "Sizes" .
      :Tiny a skos:Concept ; skos:prefLabel "Tiny" ; skos:inScheme :Sizes .
      :Huge a skos:Concept ; skos:prefLabel "Huge" ; skos:inScheme :Sizes .
      :Loose a skos:Concept ; skos:prefLabel "Loose" .
    `
    const classesOnly = importOwl(source.replace(/^\s*:(meat|bones|small|large) .*$/gm, ''))
    const fresh = workspaceFrom('Page 1', [], [])
    const [page] = planImport(classesOnly, { iri: classesOnly.iri, workspace: fresh.workspace, pageId: fresh.pageId }).pages
    const ws: Workspace = saveCanvas(fresh.workspace, fresh.pageId, page.nodes, page.edges)
    const imported = { ...importOwl(source.replace(/^\s*:(meat|bones|small|large) .*$/gm, '') + vocabulary), layout: saveLayout(ws, [fresh.pageId], classesOnly.iri) }
    const { pages } = planImport(imported, { iri: imported.iri, workspace: workspaceFrom('Page 1', [], []).workspace, pageId: fresh.pageId })
    expect(pages[0].nodes.some((n) => n.data.kind)).toBe(false)
    // With one scheme, a concept in none belongs to it (see conceptSchemes).
    expect(pages.slice(1).map((p) => [p.name, p.nodes.map((n) => n.data.label).sort()])).toEqual([['Vocabulary: Sizes', ['Huge', 'Loose', 'Sizes', 'Tiny']]])
  })
})
