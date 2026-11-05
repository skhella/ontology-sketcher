import { describe, expect, it } from 'vitest'
import { blankNodesNumbered, diffOntologies, type OntologyDiff } from './diff'
import { canvasDiff, focusAround, GHOST, onlyStatus, pagesOnlyInFile } from './diffCanvas'
import { saveLayout } from './layout'
import { sampleOntology, type Ontology } from './model'
import { toTurtle } from './owl'
import { workspaceFrom, type Workspace } from './pages'

const P = 'http://example.org/pizza#'

/** The sample's export with its layout, as Ontology Sketcher writes it. */
async function exported(ontology: Ontology) {
  const { workspace, pageId } = workspaceFrom('Page 1', ontology.nodes, ontology.edges)
  return { text: await toTurtle(ontology, saveLayout(workspace, [pageId], P)), workspace, pageId }
}

// Margherita removed, Pizza given a comment, Cheese added under Topping, has topping made functional.
const edited: Ontology = {
  ...sampleOntology,
  nodes: [
    ...sampleOntology.nodes
      .filter((n) => n.id !== 'margherita')
      .map((n) => (n.id === 'pizza' ? { ...n, data: { ...n.data, annotations: [{ property: 'http://www.w3.org/2000/01/rdf-schema#comment', value: 'A dish' }] } } : n)),
    { id: 'cheese', type: 'owlClass', position: { x: 700, y: 260 }, data: { label: 'Cheese' } },
  ],
  edges: [
    ...sampleOntology.edges
      .filter((e) => e.id !== 'e1')
      .map((e) => (e.id === 'e3' ? { ...e, data: { ...e.data!, characteristics: ['functional' as const] } } : e)),
    { id: 'e4', type: 'relation', source: 'cheese', target: 'topping', data: { kind: 'subClassOf', label: '' } },
  ],
}

const HEAD = `@prefix : <${P}> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix dcterms: <http://purl.org/dc/terms/> .
  :Pizza a owl:Class ; rdfs:label "Pizza" .`

describe('probable renames', () => {
  const renames = (before: string, after: string) =>
    diffOntologies(HEAD + before, HEAD + after, P)
      .entities.filter((e) => e.renamedFrom)
      .map((e) => [e.renamedFrom!.label, e.label, e.renamedFrom!.why])

  it('pairs a removed class with an added one of a similar name, both ways', () => {
    const diff = diffOntologies(HEAD + ':Margherita a owl:Class ; rdfs:subClassOf :Pizza .', HEAD + ':Margarita a owl:Class ; rdfs:subClassOf :Pizza .', P)
    expect(diff.entities.find((e) => e.status === 'added')!.renamedFrom).toMatchObject({ iri: P + 'Margherita', why: 'similar name' })
    expect(diff.entities.find((e) => e.status === 'removed')!.renamedTo).toMatchObject({ iri: P + 'Margarita', why: 'similar name' })
  })

  it('sees the same label under a new IRI, and separators that differ', () => {
    expect(renames(':Old1 a owl:Class ; rdfs:label "Topping" .', ':Topping a owl:Class ; rdfs:label "Topping" .')).toEqual([['Topping', 'Topping', 'same label']])
    expect(renames(':has_topping a owl:ObjectProperty .', ':hasTopping a owl:ObjectProperty .')).toEqual([['has_topping', 'hasTopping', 'same local name']])
  })

  it('trusts dcterms:isReplacedBy and equivalence over names, even when the old term stays', () => {
    expect(renames(':Old a owl:Class .', ':Old a owl:Class ; dcterms:isReplacedBy :Brand . :Brand a owl:Class .')).toEqual([['Old', 'Brand', 'marked dcterms:isReplacedBy']])
    expect(renames(':Cheese a owl:Class . :Tomatoe a owl:Class .', ':Fromage a owl:Class ; owl:equivalentClass :Cheese . :Tomato a owl:Class .')).toEqual([
      ['Cheese', 'Fromage', 'marked owl:equivalentClass'],
      ['Tomatoe', 'Tomato', 'similar name'],
    ])
  })

  it('leaves unlike names, and a class and a property, unpaired', () => {
    expect(renames(':Margherita a owl:Class .', ':Hawaii a owl:Class .')).toEqual([])
    expect(renames(':topping a owl:Class .', ':toppings a owl:ObjectProperty .')).toEqual([])
  })
})

describe('diffOntologies', () => {
  it('finds nothing between two exports of the same ontology, even after moving a class', async () => {
    const before = await exported(sampleOntology)
    const moved = await exported({ ...sampleOntology, nodes: sampleOntology.nodes.map((n) => ({ ...n, position: { x: n.position.x + 50, y: 0 } })) })
    expect(diffOntologies(before.text, moved.text, P)).toMatchObject({ entities: [], arrows: [] })
  })

  it('lists added, changed and removed classes and properties, and the arrows that came and went', async () => {
    const diff = diffOntologies((await exported(sampleOntology)).text, (await exported(edited)).text, P)
    expect(diff.entities.map((e) => [e.status, e.label, e.changes.map((c) => `${c.sign} ${c.text}`)])).toEqual([
      ['added', 'Cheese', ['+ a owl:Class', '+ label "Cheese"', '+ subClassOf Topping']],
      ['changed', 'has topping', ['+ a owl:FunctionalProperty']],
      ['changed', 'Pizza', ['+ comment "A dish"']],
      ['removed', 'Margherita', ['- a owl:Class', '- label "Margherita"', '- subClassOf Pizza']],
    ])
    expect(diff.arrows.map((a) => [a.status, a.source.replace(P, ''), a.kind, a.target.replace(P, '')])).toEqual([
      ['added', 'Cheese', 'subClassOf', 'Topping'],
      ['removed', 'Margherita', 'subClassOf', 'Pizza'],
    ])
  })

  it('reads arrows from the triples when a file has no layout, and restrictions in words', async () => {
    const plain = `@prefix : <${P}> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      :Pizza a owl:Class ; rdfs:label "Pizza" . :Topping a owl:Class ; rdfs:label "Topping" .
      :hasTopping a owl:ObjectProperty ; rdfs:label "has topping" ; rdfs:domain :Pizza ; rdfs:range :Topping .`
    const more = plain + `\n:Pizza rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :hasTopping ; owl:minQualifiedCardinality 1 ; owl:onClass :Topping ] .`
    const diff = diffOntologies(plain, more, P)
    expect(diff.entities.map((e) => [e.status, e.label, e.changes.map((c) => c.text)])).toEqual([['changed', 'Pizza', ['subClassOf has topping min 1 Topping']]])
    expect(diff.arrows).toEqual([])
  })
})

describe('canvasDiff', () => {
  it('colours what changed on the page and draws removed classes and arrows where they were', async () => {
    const before = await exported(sampleOntology)
    const after = await exported(edited)
    const diff = diffOntologies(before.text, after.text, P)
    const page = { nodes: edited.nodes, edges: edited.edges }
    const shown = canvasDiff(diff, after.workspace, after.pageId, P, page)
    expect(Object.fromEntries(shown.nodes)).toEqual({ pizza: 'changed', cheese: 'added' })
    expect(Object.fromEntries(shown.edges)).toEqual({ e3: 'changed', e4: 'added' })
    expect(shown.ghostNodes.map((n) => [n.id, n.data.label, n.position])).toEqual([[GHOST + P + 'Margherita', 'Margherita', { x: 80, y: 260 }]])
    expect(shown.ghostEdges.map((e) => [e.source, e.target, e.data?.kind])).toEqual([[GHOST + P + 'Margherita', 'pizza', 'subClassOf']])
  })

  it('reads the file as the newer version: its extra classes are added ghosts, and the canvas extras are removed', async () => {
    const older = await exported(sampleOntology)
    const newer = await exported(edited)
    const diff = diffOntologies(newer.text, older.text, P)
    const shown = canvasDiff(diff, newer.workspace, newer.pageId, P, { nodes: edited.nodes, edges: edited.edges }, true)
    expect(Object.fromEntries(shown.nodes)).toEqual({ pizza: 'changed', cheese: 'removed' })
    expect(Object.fromEntries(shown.edges)).toEqual({ e3: 'changed', e4: 'removed' })
    expect(shown.ghostNodes.map((n) => [n.id, n.className])).toEqual([[GHOST + P + 'Margherita', 'diff-ghost diff-added']])
    expect(shown.ghostEdges.map((e) => [e.source, e.target, e.className])).toEqual([[GHOST + P + 'Margherita', 'pizza', 'diff-ghost diff-added']])
  })

  it('keeps what changed on each coloured class and ghost, for its tag', async () => {
    const before = await exported(sampleOntology)
    const after = await exported(edited)
    const diff = diffOntologies(before.text, after.text, P)
    const shown = canvasDiff(diff, after.workspace, after.pageId, P, { nodes: edited.nodes, edges: edited.edges })
    const ghostArrow = shown.ghostEdges[0].id
    expect([...shown.changes.keys()].sort()).toEqual(['cheese', 'e3', 'e4', GHOST + P + 'Margherita', ghostArrow, 'pizza'].sort())
    expect(shown.changes.get('pizza')).toBe(diff.entities.find((e) => e.label === 'Pizza'))
    expect(shown.changes.get(GHOST + P + 'Margherita')?.status).toBe('removed')
    // Arrows: a changed property's own changes, and an arrow one version lacks said as the statement it stands for.
    expect(shown.changes.get('e3')?.status).toBe('changed')
    expect(shown.changes.get('e4')?.status).toBe('added')
    expect(shown.changes.get(ghostArrow)).toMatchObject({ label: 'Margherita → Pizza', status: 'removed', changes: [{ sign: '-', text: 'subClassOf Pizza' }] })
  })
})

describe('onlyStatus', () => {
  it('keeps only the classes, arrows, ghosts and tags of one kind of change, or everything for all', async () => {
    const before = await exported(sampleOntology)
    const after = await exported(edited)
    const diff = diffOntologies(before.text, after.text, P)
    const shown = canvasDiff(diff, after.workspace, after.pageId, P, { nodes: edited.nodes, edges: edited.edges })
    expect(onlyStatus(shown, 'all')).toBe(shown)
    const added = onlyStatus(shown, 'added')
    expect([Object.fromEntries(added.nodes), Object.fromEntries(added.edges), added.ghostNodes, added.ghostEdges]).toEqual([{ cheese: 'added' }, { e4: 'added' }, [], []])
    expect([...added.changes.keys()].sort()).toEqual(['cheese', 'e4'])
    const changed = onlyStatus(shown, 'changed')
    expect([Object.fromEntries(changed.nodes), Object.fromEntries(changed.edges), changed.ghostNodes.length]).toEqual([{ pizza: 'changed' }, { e3: 'changed' }, 0])
    const removed = onlyStatus(shown, 'removed')
    expect([removed.nodes.size, removed.edges.size]).toEqual([0, 0])
    expect(removed.ghostNodes.map((n) => n.id)).toEqual([GHOST + P + 'Margherita'])
    expect(removed.ghostEdges.map((e) => [e.source, e.target])).toEqual([[GHOST + P + 'Margherita', 'pizza']])
    expect(removed.changes.size).toBe(2)
  })
})

describe('pagesOnlyInFile', () => {
  const plant = { iri: P + 'Plant', label: 'Plant', kind: 'class' as const, changes: [] }
  const layout = {
    version: 1 as const,
    pages: [
      { name: 'Page 1', nodes: [], edges: [] },
      { name: 'Plants', nodes: [{ iri: P + 'Plant', x: 0, y: 0 }], edges: [] },
      { name: 'Empty', nodes: [], edges: [] },
    ],
  }
  const ws = { pages: [{ id: 'a', name: 'Page 1', nodes: [], edges: [] }] } as unknown as Workspace

  it('names the file pages the canvas lacks that hold classes only the file has', () => {
    const older: OntologyDiff = { entities: [{ ...plant, status: 'removed' }], arrows: [], oldLayout: layout }
    expect(pagesOnlyInFile(older, ws)).toEqual(['Plants'])
    const newer: OntologyDiff = { entities: [{ ...plant, status: 'added' }], arrows: [], newLayout: layout }
    expect(pagesOnlyInFile(newer, ws, true)).toEqual(['Plants'])
    // Read as the older file, there is no earlier layout to draw ghosts from.
    expect(pagesOnlyInFile(newer, ws)).toEqual([])
  })
})

describe('focusAround', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: GHOST + 'g' }]
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'ca', source: 'c', target: 'a' },
    { id: 'cd', source: 'c', target: 'd' },
    { id: GHOST + 'ag', source: 'a', target: GHOST + 'g' },
  ]

  it('keeps a class, its arrows either way, and the classes at their other ends, ghosts included', () => {
    expect(focusAround('a', nodes, edges)).toEqual(new Set(['a', 'ab', 'b', 'ca', 'c', GHOST + 'ag', GHOST + 'g']))
  })

  it('keeps an arrow and its two classes only', () => {
    expect(focusAround('cd', nodes, edges)).toEqual(new Set(['cd', 'c', 'd']))
    expect(focusAround(GHOST + 'ag', nodes, edges)).toEqual(new Set([GHOST + 'ag', 'a', GHOST + 'g']))
  })

  it('keeps nothing in focus for something not drawn', () => {
    expect(focusAround('x', nodes, edges)).toBeUndefined()
  })
})

describe('blankNodesNumbered', () => {
  it('makes two exports that differ only in blank node labels equal', () => {
    const a = ':A owl:equivalentClass _:b553_n3-1744.\n_:b553_n3-1744 a rdfs:Datatype; owl:onDatatype _:x.'
    const b = ':A owl:equivalentClass _:b306_n3-1744.\n_:b306_n3-1744 a rdfs:Datatype; owl:onDatatype _:y.'
    expect(blankNodesNumbered(a)).toBe(blankNodesNumbered(b))
    expect(blankNodesNumbered(a)).toBe(':A owl:equivalentClass _:b0.\n_:b0 a rdfs:Datatype; owl:onDatatype _:b1.')
    expect(blankNodesNumbered(a)).not.toBe(blankNodesNumbered(b.replace('onDatatype _:y', 'onDatatype _:b306_n3-1744')))
  })
})
