import { Parser, type Quad, type Term } from 'n3'
import { describe, expect, it } from 'vitest'
import { layoutOntology, planImport, saveLayout } from './layout'
import { linkPage, loadCanvas, saveCanvas, workspaceFrom } from './pages'
import { sampleOntology, type ClassNode, type Ontology, type RelationEdge } from './model'
import { toTurtle } from './owl'
import { keptStatementsOf } from './keptStatements'
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
    expect(byLabel('Dish').data.namespace).toBe('http://example.org/food#')
    expect(byLabel('Dish').data.iri).toBeUndefined()
    expect(imported.namespaces).toEqual([{ prefix: 'food', iri: 'http://example.org/food#' }])
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
    expect(nodes.map((n) => n.data.label).sort()).toEqual(['Cat', 'Leo', 'Lion'])
    const lion = nodes.find((n) => n.data.label === 'Lion')!
    expect(lion.data.axioms).toEqual([{ kind: 'subClassOf', expression: { type: 'restriction', quantifier: 'some', property: edges.find((e) => e.data?.label === 'eats')!.id } }])
    // The union on Cat is an axiom the inspector shows as text, so nothing is left unshown.
    expect(summary.axioms).toBe(2)
    expect(summary.skipped).toEqual([])
    expect(describeOwlImport(summary)).toContain('1 individual,')
    expect(describeOwlImport(summary)).not.toContain('Not shown')
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

  it('spreads arrows meeting one class over the dots beside the one they would share', () => {
    const nodes: ClassNode[] = ['Pizza', 'Margherita', 'Hawaiian', 'Calzone'].map((label, i) => ({ id: `c${i}`, type: 'owlClass', position: { x: 0, y: 0 }, data: { label } }))
    const edges: RelationEdge[] = [1, 2, 3].map((i) => ({ id: `s${i}`, type: 'relation', source: `c${i}`, target: 'c0', data: { kind: 'subClassOf', label: '' } }))
    const laid = layoutOntology(nodes, edges)
    const x = (id: string) => laid.nodes.find((n) => n.id === id)!.position.x
    const leftToRight = [...edges].sort((a, b) => x(a.source) - x(b.source)).map((e) => laid.edges.find((l) => l.id === e.id)!.targetHandle)
    expect(leftToRight).toEqual(['bottom-left', 'bottom', 'bottom-right'])
    expect(laid.edges.every((e) => e.sourceHandle === 'top')).toBe(true)
    // Arrows that already have dots, as from a saved layout, keep them.
    const saved = edges.map((e) => ({ ...e, sourceHandle: 'top', targetHandle: 'bottom' }))
    expect(layoutOntology(nodes, saved).edges.map((e) => e.targetHandle)).toEqual(['bottom', 'bottom', 'bottom'])
  })

  it('lays out several arrows between the same two classes', () => {
    // dagre used to fail on this ("Not possible to find intersection inside of the rectangle").
    const nodes: ClassNode[] = ['Pizza', 'Topping', 'Base'].map((label, i) => ({ id: `c${i}`, type: 'owlClass', position: { x: 0, y: 0 }, data: { label } }))
    const edges: RelationEdge[] = ['has topping', 'has spicy topping', 'has main topping'].map((label, i) => ({
      id: `p${i}`,
      type: 'relation',
      source: 'c1',
      target: 'c2',
      data: { kind: 'objectProperty', label },
    }))
    const laid = layoutOntology(nodes, edges)
    expect(laid.edges.map((e) => e.id)).toEqual(['p0', 'p1', 'p2'])
    expect(laid.nodes.find((n) => n.id === 'c1')!.position.y).toBeLessThan(laid.nodes.find((n) => n.id === 'c2')!.position.y)
  })

  it('keeps classes already on the page where they are, with their ids and look', async () => {
    const nodes = sampleOntology.nodes.map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, style: { fill: '#ffec99' } } } : n))
    const { workspace, pageId } = workspaceFrom('Page 1', nodes, sampleOntology.edges)
    // The file adds Calzone under Pizza.
    const file = (await toTurtle(sampleOntology)) + `\n<${P}Calzone> a <http://www.w3.org/2002/07/owl#Class> ; <${RDFS}subClassOf> <${P}Pizza> .`
    const { pages, kept } = planImport(importOwl(file), { iri: P, workspace, pageId })
    expect(pages).toHaveLength(1)
    expect(kept).toBe(4)
    const placed = pages[0]
    for (const n of nodes) expect(placed.nodes.find((p) => p.id === n.id)?.position).toEqual(n.position)
    expect(placed.nodes.find((n) => n.id === 'pizza')?.data.style).toEqual({ fill: '#ffec99' })
    expect(placed.edges.map((e) => e.id)).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']))
    const calzone = placed.nodes.find((n) => n.data.label === 'Calzone')!
    expect(calzone.position.y).toBeGreaterThan(nodes.find((n) => n.id === 'pizza')!.position.y)
  })
})

describe('layout saved in the export', () => {
  // Two pages: Pizza and Topping with the property on the first, the subclasses on the second.
  const styled = sampleOntology.nodes.map((n) => (n.id === 'topping' ? { ...n, data: { ...n.data, style: { fill: '#b2f2bb', shape: 'oval' as const } } } : n))
  const curved = sampleOntology.edges.map((e) => (e.id === 'e3' ? { ...e, sourceHandle: 'right', targetHandle: 'left', data: { ...e.data!, bend: { x: 0, y: -40 } } } : e))
  const first = workspaceFrom('Main', styled.filter((n) => ['pizza', 'topping'].includes(n.id)), curved.filter((e) => e.id === 'e3'))
  const secondId = 'page-2'
  const workspace = saveCanvas(
    { ...first.workspace, pages: [...first.workspace.pages, { id: secondId, name: 'Kinds', nodes: [], edges: [] }] },
    secondId,
    styled.map((n) => ({ ...n, position: { x: n.position.x + 7, y: n.position.y + 300 } })),
    curved.filter((e) => e.id !== 'e3'),
  )
  const pageIds = workspace.pages.map((p) => p.id)

  it('leaves the OWL unchanged apart from one annotation', async () => {
    const ontology = { iri: P, nodes: styled, edges: curved }
    const plain = canonical(await toTurtle(ontology))
    const withLayout = canonical(await toTurtle(ontology, saveLayout(workspace, pageIds, P)))
    expect(withLayout.filter((line) => !plain.includes(line)).sort().reverse()).toEqual([
      'https://w3id.org/ontology-sketcher#layout http://www.w3.org/2000/01/rdf-schema#label ["Ontology Sketcher layout","en","http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"]',
      expect.stringMatching(/^https:\/\/w3id.org\/ontology-sketcher#layout http:\/\/www.w3.org\/2000\/01\/rdf-schema#comment \["How Ontology Sketcher drew/),
      'https://w3id.org/ontology-sketcher#layout http://www.w3.org/1999/02/22-rdf-syntax-ns#type http://www.w3.org/2002/07/owl#AnnotationProperty',
      expect.stringMatching(/^http:\/\/example.org\/pizza https:\/\/w3id.org\/ontology-sketcher#layout /),
    ])
  })

  it('reads the layout from files saved under its earlier name, and saves it under the current one', async () => {
    const OLD = 'https://github.com/skhella/ontology-sketcher#layout'
    const turtle = (await toTurtle({ iri: P, nodes: styled, edges: curved }, saveLayout(workspace, pageIds, P))).replaceAll(
      'https://w3id.org/ontology-sketcher#layout',
      OLD,
    )
    const imported = importOwl(turtle)
    expect(imported.layout?.pages.map((p) => p.name)).toEqual(['Main', 'Kinds'])
    const ontology = { ...imported, keptStatements: await keptStatementsOf(turtle, imported) }
    const again = await toTurtle(ontology, imported.layout)
    expect(again).not.toContain(OLD)
    expect(importOwl(again).layout).toEqual(imported.layout)
  })

  it('brings back pages, positions, colours, dots and curves', async () => {
    const turtle = await toTurtle({ iri: P, nodes: styled, edges: curved }, saveLayout(workspace, pageIds, P))
    const fresh = workspaceFrom('Page 1', [], [])
    const { pages } = planImport(importOwl(turtle), { iri: P, workspace: fresh.workspace, pageId: fresh.pageId })
    expect(pages.map((p) => p.name)).toEqual(['Main', 'Kinds'])
    for (const [page, id] of [[pages[0], first.pageId], [pages[1], secondId]] as const) {
      const before = loadCanvas(workspace, id)
      expect(page.nodes.map((n) => [n.data.label, n.position, n.data.style]).sort()).toEqual(before.nodes.map((n) => [n.data.label, n.position, n.data.style]).sort())
      expect(page.edges).toHaveLength(before.edges.length)
    }
    const property = pages[0].edges[0]
    expect(property).toMatchObject({ sourceHandle: 'right', targetHandle: 'left', data: { label: 'has topping', bend: { x: 0, y: -40 } } })
  })

  it('brings back a class drawn differently on each page with the look of that page', async () => {
    const shaded = { fill: '#a5d8ff', fillStyle: 'cross-hatch' as const }
    const plain = { fill: 'transparent' }
    const restyle = (id: string, look: (n: ClassNode) => ClassNode['data']['style']) =>
      saveCanvas(workspace, id, loadCanvas(workspace, id).nodes.map((n) => ({ ...n, data: { ...n.data, style: look(n) } })), loadCanvas(workspace, id).edges)
    // Main: Pizza shaded, Topping plain. Kinds: Pizza without a look of its own, Topping shaded.
    let ws = restyle(first.pageId, (n) => (n.id === 'pizza' ? shaded : plain))
    ws = saveCanvas(ws, secondId, loadCanvas(ws, secondId).nodes.map((n) => ({ ...n, data: { ...n.data, style: n.id === 'topping' ? shaded : undefined } })), loadCanvas(ws, secondId).edges)
    const turtle = await toTurtle({ iri: P, nodes: styled, edges: curved }, saveLayout(ws, pageIds, P))
    const fresh = workspaceFrom('Page 1', [], [])
    const { pages } = planImport(importOwl(turtle), { iri: P, workspace: fresh.workspace, pageId: fresh.pageId })
    const styleOf = (page: number, label: string) => pages[page].nodes.find((n) => n.data.label === label)?.data.style
    expect([styleOf(0, 'Pizza'), styleOf(0, 'Topping')]).toEqual([shaded, plain])
    expect([styleOf(1, 'Pizza'), styleOf(1, 'Topping')]).toEqual([undefined, shaded])
  })

  it('brings back which class a page is the detail page of', async () => {
    const linked = linkPage(workspace, secondId, 'topping')
    const turtle = await toTurtle({ iri: P, nodes: styled, edges: curved }, saveLayout(linked, pageIds, P))
    const fresh = workspaceFrom('Page 1', [], [])
    const { pages } = planImport(importOwl(turtle), { iri: P, workspace: fresh.workspace, pageId: fresh.pageId })
    expect(pages[0].classId).toBeUndefined()
    expect(pages[1].nodes.find((n) => n.id === pages[1].classId)?.data.label).toBe('Topping')
  })

  it('places classes the layout does not know on its first page', async () => {
    const turtle = (await toTurtle({ iri: P, nodes: styled, edges: curved }, saveLayout(workspace, [first.pageId], P))) +
      `\n<${P}Calzone> a <http://www.w3.org/2002/07/owl#Class> ; <${RDFS}subClassOf> <${P}Pizza> .`
    const fresh = workspaceFrom('Page 1', [], [])
    const { pages } = planImport(importOwl(turtle), { iri: P, workspace: fresh.workspace, pageId: fresh.pageId })
    expect(pages).toHaveLength(1)
    expect(pages[0].nodes.map((n) => n.data.label).sort()).toEqual(['Calzone', 'Margherita', 'Pizza', 'Tomato Topping', 'Topping'])
  })
})

describe('large ontologies', () => {
  // Three trees: Animal with 30 kinds, Plant with 30, Place with 3; a property links Animal to Place.
  const nodes: ClassNode[] = []
  const edges: RelationEdge[] = []
  for (const [root, n] of [['Animal', 30], ['Plant', 30], ['Place', 3]] as const) {
    nodes.push(cls(root))
    for (let i = 0; i < n; i++) {
      nodes.push(cls(`${root}${i}`))
      edges.push(rel(`${root}-${i}`, `${root}${i}`, root, { kind: 'subClassOf', label: '' }))
    }
  }
  edges.push(rel('livesIn', 'Animal', 'Place', { kind: 'objectProperty', label: 'lives in' }))

  it('adds an overview and a page per branch, drawing every arrow somewhere', async () => {
    const imported = importOwl(await toTurtle({ iri: P, nodes, edges }))
    const fresh = workspaceFrom('Page 1', [], [])
    const { pages } = planImport(imported, { iri: P, workspace: fresh.workspace, pageId: fresh.pageId }, 40)
    // Place is small enough to share Animal's page.
    expect(pages.map((p) => p.name)).toEqual(['Overview', 'Animal · Place', 'Plant'])
    expect(pages.every((p) => p.nodes.length <= 40)).toBe(true)
    const drawn = new Set(pages.flatMap((p) => p.edges.map((e) => e.id)))
    expect(drawn.size).toBe(imported.edges.length)
    // Every class is on a page, so saving the pages keeps the whole ontology.
    expect(new Set(pages.flatMap((p) => p.nodes.map((n) => n.id))).size).toBe(imported.nodes.length)
  })
})

describe('namespaces', () => {
  it('keeps classes and properties in other namespaces, with their prefixes', async () => {
    const RDL = 'http://example.org/rdl/'
    const ontology: Ontology = {
      iri: P,
      namespaces: [{ prefix: 'rdl', iri: RDL }],
      nodes: [cls('pizza', 'Pizza'), cls('cheese', 'Cheese', { namespace: RDL }), cls('mozzarella', 'Mozzarella', { namespace: RDL, iri: 'Mozz' })],
      edges: [rel('e1', 'pizza', 'cheese', { kind: 'objectProperty', label: 'has cheese', namespace: RDL })],
    }
    const turtle = await toTurtle(ontology)
    expect(turtle).toContain('@prefix rdl: <http://example.org/rdl/>.')
    expect(turtle).toContain('rdl:Cheese a owl:Class')
    expect(turtle).toContain('rdl:Mozz a owl:Class')
    expect(turtle).toContain('rdl:hasCheese a owl:ObjectProperty')

    const imported = importOwl(turtle)
    expect(imported.iri).toBe(P)
    expect(imported.namespaces).toEqual([{ prefix: 'rdl', iri: RDL }])
    const byLabel = (label: string) => imported.nodes.find((n) => n.data.label === label)!.data
    expect(byLabel('Pizza').namespace).toBeUndefined()
    expect(byLabel('Cheese').namespace).toBe(RDL)
    expect(byLabel('Cheese').iri).toBeUndefined()
    expect(byLabel('Mozzarella')).toMatchObject({ namespace: RDL, iri: 'Mozz' })
    expect(imported.edges[0].data).toMatchObject({ namespace: RDL })
    expect(canonical(await toTurtle(imported))).toEqual(canonical(turtle))
  })
})

describe('importOwl keeps what the canvas does not draw', () => {
  const EX = 'http://example.org/lab#'
  const source = `
    @prefix owl: <http://www.w3.org/2002/07/owl#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix ext: <http://example.org/other#> .
    @prefix : <${EX}> .
    <http://example.org/lab> a owl:Ontology .
    :Sample a owl:Class ; rdfs:label "Sample"@en , "Probe"@de ; rdfs:comment "Something measured."@en .
    :Task a owl:Class ; rdfs:label "Task"@en .
    :casNo a owl:DatatypeProperty ; rdfs:domain :Sample ; rdfs:range xsd:string ;
      rdfs:label "CAS number"@en ; rdfs:comment "As printed on the label."@en .
    :ordinal a owl:DatatypeProperty , owl:FunctionalProperty ; rdfs:range xsd:integer ; rdfs:label "ordinal"@en .
    :status a owl:ObjectProperty ; rdfs:domain :Task ; rdfs:range skos:Concept ; rdfs:label "status"@en ; rdfs:comment "Where the task is."@en .
    :runsOn a owl:ObjectProperty ; rdfs:domain :Task ; rdfs:range [ a owl:Class ; owl:unionOf ( ext:Machine ext:Robot ) ] .
    :dependsOn a owl:ObjectProperty , owl:TransitiveProperty ; rdfs:label "depends on"@en .
    :blockedBy a owl:ObjectProperty ; rdfs:subPropertyOf :dependsOn ; rdfs:label "blocked by"@en .
    :Statuses a skos:ConceptScheme ; skos:prefLabel "Statuses"@en .
    :open a skos:Concept ; skos:prefLabel "open"@en , "offen"@de ; skos:inScheme :Statuses ; :ordinal 1 ; :dependsOn :done .
    :done a skos:Concept ; skos:prefLabel "done"@en ; skos:inScheme :Statuses ; :ordinal 2 .
  `

  it('keeps data property IRIs, labels with their language and other annotations', () => {
    const { nodes } = importOwl(source)
    const sample = nodes.find((n) => n.data.label === 'Sample')!.data
    expect(sample.labelLang).toBe('en')
    expect(sample.annotations).toContainEqual({ property: RDFS + 'label', value: 'Probe', lang: 'de' })
    expect(sample.dataProperties).toEqual([
      {
        name: 'CAS number',
        datatype: XSD + 'string',
        labelLang: 'en',
        iri: 'casNo',
        annotations: [{ property: RDFS + 'comment', value: 'As printed on the label.', lang: 'en' }],
      },
    ])
    const open = nodes.find((n) => n.data.label === 'open')!.data
    expect(open.annotations).toContainEqual({ property: SKOS + 'prefLabel', value: 'offen', lang: 'de' })
    expect(open.values).toEqual([
      { property: EX + 'ordinal', value: '1', kind: 'literal', datatype: XSD + 'integer' },
      { property: EX + 'dependsOn', value: EX + 'done', kind: 'iri' },
    ])
  })

  it('draws arrows to outside classes, and keeps the properties it still cannot draw', () => {
    const { nodes, edges, kept, summary } = importOwl(source)
    // A range in another ontology, or skos:Concept, gets a dashed box with no label of its own.
    const outside = nodes.filter((n) => n.data.outside)
    expect(outside.map((n) => n.data.label)).toEqual(['skos:Concept', 'Machine', 'Robot'])
    expect(outside.find((n) => n.data.label === 'Machine')!.data).toMatchObject({ namespace: 'http://example.org/other#', style: { strokeStyle: 'dashed' } })
    const label = (id: string) => nodes.find((n) => n.id === id)!.data.label
    const arrows = edges.filter((e) => e.data?.kind === 'objectProperty').map((e) => `${label(e.source)} ${e.data!.label} ${label(e.target)}`)
    expect(arrows).toEqual(['Task status skos:Concept', 'Task runsOn Machine', 'Task runsOn Robot'])

    expect(kept.map((p) => p.iri.replace(EX, ''))).toEqual(['dependsOn', 'blockedBy', 'ordinal'])
    expect(kept.find((p) => p.iri === EX + 'ordinal')).toMatchObject({ kind: 'data', ranges: [XSD + 'integer'], characteristics: ['functional'] })
    expect(summary.skipped).toEqual([
      '2 object properties that cannot be drawn as arrows (kept for the export)',
      '1 data properties without a domain class (kept for the export)',
    ])
  })

  it('writes all of it back', async () => {
    const imported = importOwl(source)
    const turtle = await toTurtle({ iri: imported.iri, nodes: imported.nodes, edges: imported.edges, kept: imported.kept })
    const back = canonical(turtle)
    const missing = canonical(source).filter((line) => !back.includes(line) && !line.startsWith('http://example.org/lab '))
    expect(missing).toEqual([])
    // Importing the export again changes nothing.
    const again = importOwl(turtle)
    expect(canonical(await toTurtle({ iri: again.iri, nodes: again.nodes, edges: again.edges, kept: again.kept }))).toEqual(back)
  })
})
